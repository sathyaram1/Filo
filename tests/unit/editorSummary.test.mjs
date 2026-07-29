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

const STORE = globalThis.SN_EDITOR_STORE;
const SUM = globalThis.SN_EDITOR_SUMMARY;

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
  const lines = prompt.split('\n').filter(Boolean);
  assert.equal(lines.length, 2, 'una riga per file');
  assert.ok(prompt.includes('[f1] Romanzo:'));
  assert.ok(prompt.includes('[f2] Ricette:'));
  // Il testo integrale NON deve comparire: nessun token del corpo.
  assert.ok(!prompt.includes('ALFA0'), 'il corpo del file 1 non entra nel contesto');
  assert.ok(!prompt.includes('BETA0'), 'il corpo del file 2 non entra nel contesto');
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
