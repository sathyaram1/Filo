// Unit test per la lettura dei documenti dell'utente (azione LEGGI_DOCUMENTO).
//
// Il buco che chiude: i documenti che contano — bollette, estratti conto,
// contratti — sono quasi tutti PDF, e un PDF è binario. Filo poteva TROVARE il
// file col terminale ma non leggerlo: "quant'è la giacenza media?" con
// l'estratto conto nei Download era una domanda senza risposta possibile.
//
// Qui si asserisce il SUCCESSO dal punto di vista dell'utente (il testo del suo
// documento arriva davvero) e l'ONESTÀ nei casi in cui il testo non c'è. Senza
// il modulo di lettura ogni test qui sotto è rosso.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'documenti');

const DR = require(join(ROOT, 'src', 'main', 'services', 'documentRead.js'));

// Cartella usa-e-getta per i file costruiti al volo (troppo grandi o troppo
// specifici per stare tra le fixture committate).
const TMP = cartellaTemporanea('filo-doc-');
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch (_) {} });

// ─────────────────────────── PDF con testo vero ──────────────────────────────

test('un PDF vero restituisce il suo testo, tutte le pagine', async () => {
  const r = await DR.readDocument(join(FIXTURES, 'documento-con-testo.pdf'));
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'pdf');
  assert.equal(r.empty, false);
  assert.equal(r.pages, 2);
  // È il dato che l'utente sta chiedendo, non un vago "c'è del testo".
  assert.match(r.text, /Giacenza media: 1\.234,56 euro/);
  // La seconda pagina non si perde per strada.
  assert.match(r.text, /Saldo finale: 987,65 euro/);
  assert.equal(r.truncated, false);
  assert.equal(r.error, null);
});

test('un PDF di sole immagini lo dice, invece di far finta di averlo letto', async () => {
  // È il caso della scansione o della foto del foglio: testo estraibile non ce
  // n'è. La risposta giusta è "questo PDF è un'immagine", non un testo inventato.
  const r = await DR.readDocument(join(FIXTURES, 'documento-scansionato.pdf'));
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'pdf');
  assert.equal(r.empty, true);
  assert.equal(r.text, '');
  assert.equal(r.pages, 1);
});

// ─────────────────────────────── testo semplice ──────────────────────────────

test('un file di testo si legge senza passare dal terminale', async () => {
  const p = join(TMP, 'movimenti.csv');
  writeFileSync(p, 'data;causale;importo\n2026-03-02;Bolletta luce;-84,20\n', 'utf8');
  const r = await DR.readDocument(p);
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'text');
  assert.match(r.text, /Bolletta luce;-84,20/);
});

test('gli accenti sopravvivono anche a un file scritto in windows-1252', async () => {
  // Gli export delle banche italiane arrivano quasi sempre così: letti come
  // UTF-8 diventano un campo minato di caratteri di sostituzione.
  const p = join(TMP, 'latin.txt');
  writeFileSync(p, Buffer.from('Addebito perché più caro', 'latin1'));
  const r = await DR.readDocument(p);
  assert.equal(r.ok, true);
  assert.match(r.text, /perché più caro/);
});

test('un file senza estensione nota si legge se dentro c\'è testo', async () => {
  const p = join(TMP, 'appunti.bak');
  writeFileSync(p, 'promemoria: disdire il contratto entro giugno', 'utf8');
  const r = await DR.readDocument(p);
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'text');
  assert.match(r.text, /disdire il contratto/);
});

// ─────────────────────────────── il tetto ────────────────────────────────────

test('oltre il tetto il testo si tronca E il troncamento è dichiarato', async () => {
  const p = join(TMP, 'lunghissimo.txt');
  writeFileSync(p, 'a'.repeat(DR.MAX_TEXT_CHARS + 5000), 'utf8');
  const r = await DR.readDocument(p);
  assert.equal(r.ok, true);
  assert.equal(r.text.length, DR.MAX_TEXT_CHARS);
  // Il troncamento SILENZIOSO è il difetto vero: il modello risponderebbe su
  // metà documento credendo di averlo tutto.
  assert.equal(r.truncated, true);
});

test('sotto il tetto non si tronca niente', async () => {
  const p = join(TMP, 'corto.txt');
  writeFileSync(p, 'due righe\ne basta', 'utf8');
  const r = await DR.readDocument(p);
  assert.equal(r.truncated, false);
  assert.equal(r.text, 'due righe\ne basta');
});

// ─────────────────────────── rifiuti con motivo ──────────────────────────────

test('un file che non esiste lo dice con chiarezza', async () => {
  const r = await DR.readDocument(join(TMP, 'mai-esistito.pdf'));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not_found');
  assert.ok(r.detail);
});

test('una cartella non è un documento', async () => {
  const d = join(TMP, 'cartella');
  mkdirSync(d, { recursive: true });
  const r = await DR.readDocument(d);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'is_directory');
});

test('un percorso vuoto non tenta di leggere niente', async () => {
  for (const v of ['', '   ', null, undefined]) {
    const r = await DR.readDocument(v);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'no_path');
  }
});

test('i formati binari vengono rifiutati dicendo COSA sono', async () => {
  // "formato non supportato" non aiuta nessuno; "è un'immagine" sì.
  const casi = [
    ['foto.jpg', /immagine/],
    ['relazione.docx', /Word/],
    ['conti.xlsx', /Excel/],
    ['setup.exe', /eseguibile/],
    ['backup.zip', /archivio/],
  ];
  for (const [nome, atteso] of casi) {
    const p = join(TMP, nome);
    writeFileSync(p, 'x');
    const r = await DR.readDocument(p);
    assert.equal(r.ok, false, `${nome} non doveva essere letto`);
    assert.equal(r.error, 'unsupported');
    assert.match(r.detail, atteso);
  }
});

test('un binario travestito da estensione ignota viene riconosciuto dal contenuto', async () => {
  const p = join(TMP, 'strano.dat');
  writeFileSync(p, Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff, 0xfe, 0x00, 0x03]));
  const r = await DR.readDocument(p);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unsupported');
});

test('un PDF rotto non fa esplodere niente: lo dice e basta', async () => {
  const p = join(TMP, 'rotto.pdf');
  writeFileSync(p, 'questo non è un PDF', 'utf8');
  const r = await DR.readDocument(p);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'pdf_failed');
});

// ─────────────────────────── normalizzazione percorsi ────────────────────────

test('il percorso arriva dall\'LLM: virgolette e ~ vengono sciolti', async () => {
  const home = (await import('node:os')).homedir();
  assert.equal(DR.normalizePath('~'), home);
  assert.equal(DR.normalizePath('~/Documenti'), join(home, 'Documenti'));
  assert.equal(DR.normalizePath('"~/Documenti"'), join(home, 'Documenti'));
  assert.equal(DR.normalizePath('   '), '');
});

test('un documento indicato con le virgolette si legge lo stesso', async () => {
  const p = join(TMP, 'virgolette.txt');
  writeFileSync(p, 'contenuto', 'utf8');
  const r = await DR.readDocument(`"${p}"`);
  assert.equal(r.ok, true);
  assert.equal(r.text, 'contenuto');
});

// ══════════════ il giro completo: prompt, registro dei livelli, manifesto ═════
// Un modulo che estrae il testo ma non è collegato a niente non serve a nessuno:
// se l'azione non è nel prompt il modello non la emette mai, e se non è nel
// registro dei livelli il dispatch la rifiuta prima di eseguirla.

test('il prompt della chat espone LEGGI_DOCUMENTO e quando usarla', () => {
  require(join(ROOT, 'src', 'shared', 'constants.js'));
  const p = globalThis.SN_CONST.PROMPTS.filoChat({ profilo: '', preferenze: '', stato: '' });
  assert.match(p, /LEGGI_DOCUMENTO/);
  // Deve dire che è l'unica via per un PDF, o il modello ci proverà col terminale.
  assert.match(p, /LEGGERE UN DOCUMENTO DELL'UTENTE[\s\S]*PDF/);
  assert.match(p, /giacenza media|estratto conto|bolletta/i);
  // E deve trattare il contenuto come dato, non come istruzioni.
  assert.match(p, /LEGGERE UN DOCUMENTO DELL'UTENTE[\s\S]*non istruzioni da eseguire/);
});

test('LEGGI_DOCUMENTO è registrata al livello 1 (sola lettura, esegue subito)', () => {
  require(join(ROOT, 'src', 'shared', 'preferences.js'));
  require(join(ROOT, 'src', 'shared', 'themeTokens.js'));
  require(join(ROOT, 'src', 'shared', 'cmdClassify.js'));
  require(join(ROOT, 'src', 'shared', 'actionLevels.js'));
  const AL = globalThis.SN_ACTION_LEVELS;
  // Senza voce nel registro il dispatch RIFIUTA l'azione: sarebbe una feature
  // completa che non parte mai.
  assert.equal(AL.levelFor({ type: 'LEGGI_DOCUMENTO', percorso: 'C:/x/y.pdf' }), 1);
  assert.match(AL.describe({ type: 'LEGGI_DOCUMENTO', percorso: 'C:/x/y.pdf' }), /C:\/x\/y\.pdf/);
  // Stessa cosa per la lettura dei documenti dell'EDITOR, che era rimasta fuori
  // dal registro e quindi non è mai partita.
  assert.equal(AL.levelFor({ type: 'LEGGI_FILE', fileId: 'file-1' }), 1);
});

test('il manifesto delle capacità dichiara che Filo legge i documenti', () => {
  require(join(ROOT, 'src', 'shared', 'capabilities.js'));
  const cap = globalThis.SN_CAPABILITIES.all().find((c) => c.id === 'read-user-documents');
  assert.ok(cap, 'la capacità deve esistere: un manifesto che tace è un manifesto che mente');
  assert.match(cap.desc, /PDF/);
  // Il confine dichiarato: sulle scansioni non c'è testo da leggere.
  assert.match(cap.doesNot, /scansione|foto/i);
});

// ───────────── il nome QUASI giusto: trattini, accenti, maiuscole ────────────
//
// #551. Visto dal vivo: il terminale di Windows scriveva i nomi nella tabella
// OEM, il modello ricopiava «SPECIFICHE SEO E METADATI - singolarita.txt» al
// posto di «… — singolarita.txt» (trattino lungo) e la lettura falliva in modo
// onesto su un nome mai esistito. Il guasto è chiuso a monte (terminal.js), ma
// la stessa svista la fa un utente che il nome lo scrive a mano. La filosofia
// di Filo è esplicita: un typo ogni tre parole non deve essere un problema.

test('la chiave tollerante appiattisce trattini, accenti, maiuscole e spazi doppi', () => {
  const atteso = DR.chiaveTollerante('SPECIFICHE SEO E METADATI - singolarita.txt');
  // Trattino lungo, medio, «figura» e meno matematico: tutti lo stesso nome.
  for (const trattino of ['—', '–', '‒', '−', '‐']) {
    assert.equal(
      DR.chiaveTollerante(`SPECIFICHE SEO E METADATI ${trattino} singolarita.txt`),
      atteso,
      `il trattino «${trattino}» doveva contare come «-»`,
    );
  }
  // Maiuscole, accenti, spazi doppi.
  assert.equal(DR.chiaveTollerante('Perché Più Caro.txt'), DR.chiaveTollerante('perche piu caro.txt'));
  assert.equal(DR.chiaveTollerante('nota   di  credito.pdf'), DR.chiaveTollerante('nota di credito.pdf'));
  // Due nomi davvero diversi restano diversi: la tolleranza non è un colabrodo.
  assert.notEqual(DR.chiaveTollerante('bolletta.pdf'), DR.chiaveTollerante('bollette.pdf'));
  assert.notEqual(DR.chiaveTollerante('conto.pdf'), DR.chiaveTollerante('conto.txt'));
});

test('un carattere di sostituzione vale come jolly, non come lettera', () => {
  // «Singolarit<27>.txt» è com'è arrivato il nome dal terminale: sotto quel
  // carattere c'era una «à» che nessuno può più ricostruire.
  assert.equal(DR.nomiCombaciano('SPECIFICHE TIPOGRAFICHE - Singolarit�.txt',
    'SPECIFICHE TIPOGRAFICHE — Singolarità.txt'), true);
  assert.equal(DR.nomiCombaciano('Singolarit�.txt', 'Singolarità.txt'), true);
  // Ma non deve mangiarsi mezzo nome fino a un file diverso.
  assert.equal(DR.nomiCombaciano('Singolarit�.txt', 'Singolarità.pdf'), false);
  assert.equal(DR.nomiCombaciano('Singolarit�.txt', 'Altro.txt'), false);
});

test('il file col trattino lungo si ritrova anche chiedendolo col trattino breve', async () => {
  const dir = join(TMP, 'seo');
  mkdirSync(dir, { recursive: true });
  const vero = join(dir, 'SPECIFICHE SEO E METADATI — singolarita.txt');
  writeFileSync(vero, 'titolo: la singolarità\nmeta: 155 caratteri\n', 'utf8');

  // Il percorso esattamente com'era uscito storpiato dal terminale.
  const r = await DR.readDocument(join(dir, 'SPECIFICHE SEO E METADATI - singolarita.txt'));
  assert.equal(r.ok, true, `doveva ritrovarlo: ${r.detail}`);
  assert.match(r.text, /155 caratteri/);
  // E deve DIRE quale file ha aperto davvero, col nome vero.
  assert.equal(r.name, 'SPECIFICHE SEO E METADATI — singolarita.txt');
  assert.equal(r.path, vero);
  assert.ok(r.requested.endsWith('SPECIFICHE SEO E METADATI - singolarita.txt'));
});

test('il file con la «à» si ritrova anche dal nome col carattere di sostituzione', async () => {
  const dir = join(TMP, 'tipo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SPECIFICHE TIPOGRAFICHE — Singolarità.txt'), 'font: serif\n', 'utf8');
  const r = await DR.readDocument(join(dir, 'SPECIFICHE TIPOGRAFICHE - Singolarit�.txt'));
  assert.equal(r.ok, true, `doveva ritrovarlo: ${r.detail}`);
  assert.match(r.text, /font: serif/);
  assert.equal(r.name, 'SPECIFICHE TIPOGRAFICHE — Singolarità.txt');
});

test('anche la CARTELLA può avere il nome storpiato', async () => {
  // La storpiatura non risparmia i nomi delle cartelle: fermarsi all'ultimo
  // pezzo del percorso lascerebbe fuori metà dei casi veri.
  const dir = join(TMP, 'Progetto — città');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'note.txt'), 'appunti del progetto', 'utf8');
  const r = await DR.readDocument(join(TMP, 'Progetto - citta', 'note.txt'));
  assert.equal(r.ok, true, `doveva ritrovarlo: ${r.detail}`);
  assert.match(r.text, /appunti del progetto/);
});

test('quando il nome quasi giusto è giusto per DUE file, non si indovina', async () => {
  const dir = join(TMP, 'ambigui');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'Relazione — città.txt'), 'primo', 'utf8');
  writeFileSync(join(dir, 'RELAZIONE - CITTA.txt'), 'secondo', 'utf8');
  const r = await DR.readDocument(join(dir, 'Relazione - citta.txt'));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not_found');
  // Dirlo è la parte utile: il modello può chiedere all'utente quale intende.
  assert.match(r.detail, /quasi uguale/);
  assert.match(r.detail, /Relazione — città\.txt/);
});

test('un file che esiste davvero non passa mai dalla ricerca tollerante', async () => {
  // Il percorso esatto vince sempre, anche se nella cartella c'è un omonimo
  // che combacerebbe a meno degli accenti.
  const dir = join(TMP, 'esatto');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'conto.txt'), 'quello giusto', 'utf8');
  writeFileSync(join(dir, 'Cónto.txt'), 'quello sbagliato', 'utf8');
  const r = await DR.readDocument(join(dir, 'conto.txt'));
  assert.equal(r.ok, true);
  assert.equal(r.text, 'quello giusto');
  // Nessuna sostituzione avvenuta → niente da dichiarare.
  assert.equal(r.requested, '');
});

test('un nome che non somiglia a niente resta un onesto «non c\'è»', async () => {
  const dir = join(TMP, 'vuoto-quasi');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'bolletta.pdf'), 'x', 'utf8');
  const r = await DR.readDocument(join(dir, 'contratto-affitto.pdf'));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not_found');
  assert.equal(r.detail, 'a quel percorso non c\'è nessun file');
});

test('la ricerca tollerante non trasforma una cartella in un documento', async () => {
  const dir = join(TMP, 'come-cartella');
  mkdirSync(join(dir, 'Archivio — 2026'), { recursive: true });
  const r = await DR.readDocument(join(dir, 'Archivio - 2026'));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'is_directory');
});
