// Unit test per src/shared/editorSummary.js e per il ponte main
// services/editorFiles.js — il RIASSUNTO per file che entra nel contesto di Filo
// (#379.5) e la lettura ON-DEMAND del contenuto completo di un file.
//
// Asserisce il SUCCESSO della feature, non l'assenza di errori:
//   - con PIÙ file, il contesto costruito per Filo contiene UN riassunto per
//     file e NON il testo integrale (il corpo lungo non compare);
//   - un file senza riassunto AI ripiega su un estratto (contesto mai vuoto);
//   - la lettura on-demand (readFile) ritorna il CONTENUTO del file richiesto;
//   - il riassunto si rigenera solo quando il file cambia in modo significativo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED = join(__dirname, '..', '..', 'src', 'shared');
require(join(SHARED, 'editorStore.js'));
require(join(SHARED, 'editorVersions.js'));
require(join(SHARED, 'editorNotes.js'));
require(join(SHARED, 'editorSummary.js'));
require(join(SHARED, 'constants.js'));
require(join(SHARED, 'filoContesto.js'));

const STORE = globalThis.SN_EDITOR_STORE;
const SUM = globalThis.SN_EDITOR_SUMMARY;
const PROMPTS = globalThis.SN_CONST.PROMPTS;

// Costruisce un content serializzato (albero PM-like) da righe di testo.
function contentFromLines(lines) {
  return {
    type: 'doc',
    content: lines.map((ln) => ({ type: 'paragraph', content: ln ? [{ type: 'text', text: ln }] : [] })),
  };
}

// Un file serializzato con testo e (opzionalmente) un riassunto AI già presente.
function fileWith({ id, title, lines, summary, sigWords }) {
  const meta = { title: title || 'Documento senza titolo', created: '2026-01-01T00:00:00.000Z', version: 1 };
  if (summary) meta.summary = summary;
  if (sigWords != null) meta.summarySig = { words: sigWords, at: Date.now() };
  return { id, meta, content: contentFromLines(lines || []), comments: [], modules: [] };
}

function longBody(marker) {
  // ~80 parole, tutte riconoscibili dal marker, così possiamo verificare che il
  // corpo NON finisca nel contesto (mentre il riassunto sì).
  const w = [];
  for (let i = 0; i < 80; i++) w.push(`${marker}${i}`);
  return w.join(' ');
}

test('plainText estrae il testo dal content serializzato', () => {
  const c = contentFromLines(['Prima riga', 'Seconda riga']);
  const t = SUM.plainText(c);
  assert.ok(t.includes('Prima riga'));
  assert.ok(t.includes('Seconda riga'));
});

test('con più file il contesto ha UN riassunto per file e NON il testo integrale', () => {
  const collection = {
    version: STORE.COLLECTION_VERSION,
    activeId: 'f1',
    files: [
      fileWith({ id: 'f1', title: 'Romanzo', lines: [longBody('ALFA')], summary: 'Un racconto di fantasia su un viaggio.' }),
      fileWith({ id: 'f2', title: 'Ricette', lines: [longBody('BETA')], summary: 'Elenco di ricette di cucina italiana.' }),
    ],
  };
  const ctx = SUM.buildContextFiles(collection);
  // Un elemento per file.
  assert.equal(ctx.length, 2);
  assert.deepEqual(ctx.map((f) => f.id).sort(), ['f1', 'f2']);
  // Ogni file porta il SUO riassunto AI (non l'estratto).
  const byId = Object.fromEntries(ctx.map((f) => [f.id, f]));
  assert.equal(byId.f1.source, 'ai');
  assert.equal(byId.f1.summary, 'Un racconto di fantasia su un viaggio.');
  assert.equal(byId.f2.summary, 'Elenco di ricette di cucina italiana.');

  // Il blocco per il prompt: una riga per file, con id e titolo, e SENZA il
  // corpo integrale dei documenti.
  const prompt = SUM.renderForPrompt(ctx);
  const { inizio, fine } = globalThis.SN_ESTERNO.marcature('TESTO_SALVATO');
  const lines = prompt.slice(prompt.indexOf(inizio) + inizio.length, prompt.indexOf(fine)).split('\n').filter(Boolean);
  assert.equal(lines.length, 2, 'una riga per file, dentro il recinto');
  assert.ok(prompt.includes('[f1] Romanzo:'));
  assert.ok(prompt.includes('[f2] Ricette:'));
  // Il testo integrale NON deve comparire: nessun token del corpo.
  assert.ok(!prompt.includes('ALFA0'), 'il corpo del file 1 non entra nel contesto');
  assert.ok(!prompt.includes('BETA0'), 'il corpo del file 2 non entra nel contesto');
});

test('il prompt di chat di Filo inietta i riassunti dei file, non il testo integrale', () => {
  const collection = {
    version: STORE.COLLECTION_VERSION,
    activeId: 'f1',
    files: [
      fileWith({ id: 'f1', title: 'Romanzo', lines: [longBody('ALFA')], summary: 'Un racconto di fantasia su un viaggio.' }),
      fileWith({ id: 'f2', title: 'Ricette', lines: [longBody('BETA')], summary: 'Elenco di ricette di cucina italiana.' }),
    ],
  };
  const files = SUM.renderForPrompt(SUM.buildContextFiles(collection));
  const prompt = PROMPTS.filoChat({ profilo: '', preferenze: '', stato: '', files });
  // Il prompt annuncia la sezione FILE e contiene i riassunti dei due file…
  assert.ok(prompt.includes("FILE DELL'EDITOR"));
  assert.ok(prompt.includes('Un racconto di fantasia su un viaggio.'));
  assert.ok(prompt.includes('Elenco di ricette di cucina italiana.'));
  // …e descrive l'azione LEGGI_FILE per leggere un file per intero on-demand.
  assert.ok(prompt.includes('LEGGI_FILE'));
  // Ma NON il testo integrale dei documenti.
  assert.ok(!prompt.includes('ALFA0'));
  assert.ok(!prompt.includes('BETA0'));
});

test('un file senza riassunto AI ripiega su un estratto (contesto mai vuoto)', () => {
  const collection = {
    version: STORE.COLLECTION_VERSION,
    activeId: 'f1',
    files: [fileWith({ id: 'f1', title: 'Note veloci', lines: ['Comprare il latte e chiamare Marco'] })],
  };
  const ctx = SUM.buildContextFiles(collection);
  assert.equal(ctx.length, 1);
  assert.equal(ctx[0].source, 'excerpt');
  assert.ok(ctx[0].summary.includes('Comprare il latte'));
});

test('needsSummary: rigenera solo su cambiamento significativo', () => {
  // Sopra la soglia minima di parole, senza riassunto → serve.
  const noSummary = fileWith({ id: 'a', lines: [longBody('X')] });
  assert.equal(SUM.needsSummary(noSummary), true);

  // Sotto la soglia minima → non serve (il testo È la sintesi).
  const tiny = fileWith({ id: 'b', lines: ['Ciao mondo'] });
  assert.equal(SUM.needsSummary(tiny), false);

  // Riassunto fresco (firma = parole attuali) → non serve.
  const words = SUM.fileWords(noSummary);
  const fresh = fileWith({ id: 'c', lines: [longBody('X')], summary: 'Un riassunto.', sigWords: words });
  assert.equal(SUM.needsSummary(fresh), false);

  // Riassunto stantìo (il file è cresciuto molto dalla firma) → serve.
  const stale = fileWith({ id: 'd', lines: [longBody('X')], summary: 'Un riassunto.', sigWords: 1 });
  assert.equal(SUM.needsSummary(stale), true);
});

// ── Ponte main: services/editorFiles.js (lettura on-demand + elenco riassunti) ──
// Simuliamo l'archivio (chrome.storage.local) con la collezione dell'editor e
// verifichiamo che readFile ritorni il CONTENUTO del file richiesto e
// listFileSummaries un riassunto per file.
test('editorFiles.readFile ritorna il contenuto del file richiesto; listFileSummaries un riassunto per file', async () => {
  const collection = {
    version: STORE.COLLECTION_VERSION,
    activeId: 'f1',
    files: [
      fileWith({ id: 'f1', title: 'Diario', lines: ['Oggi ho iniziato un nuovo progetto.'], summary: 'Un diario personale.' }),
      fileWith({ id: 'f2', title: 'Spesa', lines: ['Latte, pane, uova.'], summary: 'Lista della spesa.' }),
    ],
  };
  const backing = { 'filo.editor.collection': collection };
  // Shim chrome.storage.local minimale (get/set su un oggetto in memoria).
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) { return { [key]: backing[key] }; },
        async set(obj) { Object.assign(backing, obj); },
      },
    },
  };
  const EF = require(join(__dirname, '..', '..', 'src', 'main', 'services', 'editorFiles.js'));

  const read = await EF.readFile('f1');
  assert.equal(read.ok, true);
  assert.equal(read.id, 'f1');
  assert.equal(read.title, 'Diario');
  assert.ok(read.text.includes('nuovo progetto'), 'il contenuto del file richiesto torna nella lettura on-demand');

  const readMissing = await EF.readFile('nope');
  assert.equal(readMissing.ok, false);

  const list = await EF.listFileSummaries();
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((f) => f.id).sort(), ['f1', 'f2']);
  assert.ok(list.every((f) => f.summary && f.summary.length), 'ogni file ha un riassunto nel contesto');
});

// #1475 — chat, titolo e riassunto dell'Editor leggono il documento intero: il vecchio tetto di 6000 caratteri tagliava
// in silenzio, e una domanda sulla fine di un documento lungo non trovava risposta.
test('un documento lungo arriva intero al modello, fino in fondo', () => {
  const fondo = 'La chiave del magazzino sta sotto il vaso di gerani.';
  const lungo = `${'Paragrafo di riempimento sul bilancio. '.repeat(3000)}\n${fondo}`;
  assert.ok(lungo.length > 100000);
  const r = SUM.testoAlModello(lungo);
  assert.equal(r.tagliato, false);
  assert.ok(r.testo.endsWith(fondo), 'la frase in fondo arriva al modello');
  assert.equal(SUM.notaTaglio(r), '', 'senza taglio niente nota per chi scrive');
  assert.equal(SUM.avvisoTaglio(r), '', 'senza taglio niente avviso per il modello');
});

test('il tetto è largo quanto il contesto di serie della chat di Filo, e oltre il taglio si dice', () => {
  globalThis.SN_FILO_CONTESTO || require(join(SHARED, 'filoContesto.js'));
  const FC = globalThis.SN_FILO_CONTESTO;
  assert.ok(SUM.TESTO_AL_MODELLO_MAX >= FC.TETTI_DI_SERIE.token * FC.CARATTERI_PER_TOKEN,
    'il documento non legge meno di quanto la chat di Filo legge di serie');
  const totale = SUM.TESTO_AL_MODELLO_MAX + 12345;
  const r = SUM.testoAlModello('a'.repeat(totale));
  assert.equal(r.tagliato, true);
  assert.equal(r.testo.length, SUM.TESTO_AL_MODELLO_MAX);
  assert.equal(r.totale, totale);
  assert.equal(SUM.notaTaglio(r), `Il documento è lungo: ho letto i primi 350.000 caratteri su ${totale.toLocaleString('it-IT')}.`);
  assert.match(SUM.notaTaglio(r, 'per il titolo'), /^Il documento è lungo: per il titolo ho letto i primi 350\.000 caratteri su /);
  assert.match(SUM.avvisoTaglio(r), /primi 350\.000 caratteri su .*Il resto non lo vedi/);
});

test('il taglio non spezza una emoji a metà', () => {
  const max = 10;
  const r = SUM.testoAlModello(`${'a'.repeat(max - 1)}😀 e poi altro`, max);
  assert.equal(r.tagliato, true);
  assert.equal(r.testo, 'a'.repeat(max - 1), 'la coppia surrogata resta fuori intera');
  assert.equal(r.letti, max - 1);
});

test('vuoto o soli spazi: niente da mandare', () => {
  for (const t of ['', '   \n\t ', null, undefined]) {
    const r = SUM.testoAlModello(t);
    assert.equal(r.testo, '');
    assert.equal(r.tagliato, false);
  }
});

// Un modello dalla finestra stretta rifiuta il documento intero: si rimanda più corto, dentro la finestra che il
// rifiuto dice, e il taglio si dice come oltre il tetto.
test('dopo un rifiuto per finestra il documento si rilegge dentro la finestra detta', () => {
  const testo = 'parola '.repeat(30000);
  const letto = SUM.testoAlModello(testo);
  const caratteri = letto.letti + 3000;
  const rifiuto = { ok: false, error: "OpenRouter 400: {\"error\":{\"message\":\"This endpoint's maximum context length is 32768 tokens. However, you requested about 61000 tokens (60000 of text input, 1000 in the output).\"}}" };
  const corto = SUM.rilettoDopoRifiuto(testo, letto, rifiuto, caratteri);
  assert.ok(corto && corto.tagliato);
  assert.ok(corto.letti < letto.letti * (32768 / 61000), `letti ${corto.letti}`);
  assert.ok(corto.letti > letto.letti * 0.3, `letti ${corto.letti}`);
  assert.equal(corto.totale, letto.totale);
  assert.match(SUM.notaTaglio(corto), /ho letto i primi/);
});

test('un altro errore, o un documento già minimo, non si rilegge', () => {
  const testo = 'parola '.repeat(30000);
  const letto = SUM.testoAlModello(testo);
  assert.equal(SUM.rilettoDopoRifiuto(testo, letto, { ok: false, error: 'OpenRouter 402: insufficient credits' }, letto.letti), null);
  const corto = SUM.testoAlModello('ciao '.repeat(300));
  const rifiuto = { ok: false, error: 'maximum context length is 1000 tokens. However, you requested about 5000 tokens' };
  assert.equal(SUM.rilettoDopoRifiuto('ciao '.repeat(300), corto, rifiuto, corto.letti + 20000), null);
});
