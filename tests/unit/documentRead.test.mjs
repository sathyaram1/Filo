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
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'documenti');

const DR = require(join(ROOT, 'src', 'main', 'services', 'documentRead.js'));

// Cartella usa-e-getta per i file costruiti al volo (troppo grandi o troppo
// specifici per stare tra le fixture committate).
const TMP = mkdtempSync(join(tmpdir(), 'filo-doc-'));
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
