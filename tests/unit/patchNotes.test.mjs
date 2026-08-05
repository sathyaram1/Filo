// Unit test per src/shared/patchNotes.js — la SINGOLA SORGENTE del recap
// aggiornamento (popup all'avvio) e del calcolo "quante patch sei indietro".
// Logica pura → niente Electron, gira in millisecondi via `npm run test:unit`.
//
// COME FUNZIONA IL CHANGELOG (e perché i test sono questi)
// Le note si scrivono nel blocco "in lavorazione" (`unreleased: true`, sempre il
// primo della lista), MAI sotto un numero di versione: la versione in
// package.json è quella dell'ULTIMA release già pubblicata, quindi una nota
// messa lì sotto non la vedrebbe nessuno (chi ha già quella versione la salta, e
// la build che la portava è uscita prima che la nota esistesse). È la release a
// timbrare il blocco con il numero giusto, via scripts/stamp-patch-notes.mjs.
//
// Guardie anti-regressione (il changelog diventa "muto" se queste vanno rosse):
//   1. Il primo blocco è SEMPRE quello "in lavorazione": chi scrive una nota ha
//      un posto certo dove metterla e non deve inventare un numero di versione.
//   2. Nessun blocco rilasciato è più recente di package.json (una nota
//      attribuita a una versione che non esiste ancora non la vede nessuno).
//   3. Il timbro funziona davvero: dato un blocco in lavorazione, la release
//      produce un blocco con la versione che sta uscendo e chi aggiorna lo vede
//      nel recap (asserzione di SUCCESSO: è il meccanismo che rende visibili le
//      note, se si rompe il recap torna vuoto — era il feedback #308).
//   4. Un rilascio di sola manutenzione (nessuna nota in lavorazione) NON è un
//      errore: package.json può restare avanti al changelog, e in quel caso il
//      recap non deve mostrare nulla. Prima questo caso lasciava la guardia
//      rossa in permanenza, e una guardia sempre rossa non segnala più niente.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src', 'shared', 'patchNotes.js');
const STAMP = join(ROOT, 'scripts', 'stamp-patch-notes.mjs');

require(SRC);
const PN = globalThis.SN_PATCH_NOTES;

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

test('si registra su globalThis con la sua API', () => {
  assert.ok(PN, 'SN_PATCH_NOTES assente');
  for (const fn of ['since', 'countBehind', 'latestVersion', 'cmpVersion', 'released', 'pending']) {
    assert.equal(typeof PN[fn], 'function', `manca ${fn}()`);
  }
  assert.ok(Array.isArray(PN.NOTES) && PN.NOTES.length > 0);
});

test('il primo blocco è sempre quello "in lavorazione" (posto certo dove scrivere)', () => {
  // Se questo diventa rosso: la release ha timbrato senza rimettere in cima il
  // blocco vuoto, oppure qualcuno l'ha rimosso. Senza di lui chi scrive una nota
  // è costretto a inventare un numero di versione — ed è così che le note
  // finiscono sotto una versione già uscita e non le vede nessuno.
  const first = PN.NOTES[0];
  assert.ok(first && first.unreleased === true,
    'il primo blocco del changelog deve essere quello "in lavorazione" (unreleased: true)');
  assert.ok(!first.version, 'il blocco "in lavorazione" non deve avere un numero di versione');
  assert.ok(PN.pending() === first, 'pending() deve tornare il blocco "in lavorazione"');
});

test('nessun blocco rilasciato è più recente della versione dell’app', () => {
  // Una nota attribuita a una versione che non è ancora uscita non la vedrebbe
  // nessuno: il recap mostra solo fino alla versione installata.
  for (const n of PN.released()) {
    assert.ok(
      PN.cmpVersion(n.version, pkg.version) <= 0,
      `il blocco ${n.version} è più recente di package.json (${pkg.version})`);
  }
});

test('un rilascio di sola manutenzione non rompe nulla (app avanti al changelog)', () => {
  // package.json PUÒ essere più avanti dell'ultimo blocco: succede quando una
  // release non conteneva niente di visibile all'utente. In quel caso il recap
  // deve essere vuoto, non una sezione senza contenuto.
  const latest = PN.latestVersion();
  assert.ok(PN.cmpVersion(latest, pkg.version) <= 0,
    `il changelog (${latest}) non può essere più avanti dell'app (${pkg.version})`);
  assert.deepEqual(PN.since(latest, pkg.version), [],
    'tra l’ultima versione con note e quella dell’app non ci devono essere note fantasma');
});

test('nessun blocco rilasciato è vuoto (almeno una feature o un fix)', () => {
  for (const n of PN.released()) {
    const nFeat = Array.isArray(n.features) ? n.features.length : 0;
    const nFix = Array.isArray(n.fixes) ? n.fixes.length : 0;
    assert.ok(nFeat + nFix > 0, `il blocco ${n.version} non ha né features né fixes`);
  }
});

test('le versioni sono ordinate dalla più recente alla più vecchia, senza duplicati', () => {
  const rel = PN.released();
  for (let i = 1; i < rel.length; i++) {
    const prev = rel[i - 1].version;
    const cur = rel[i].version;
    assert.ok(
      PN.cmpVersion(prev, cur) > 0,
      `ordine/duplicato errato: ${prev} non è strettamente più recente di ${cur}`);
  }
});

test('since() ignora il blocco "in lavorazione" (l’utente vede solo ciò che ha)', () => {
  const notes = PN.since('0.0.1', pkg.version);
  for (const n of notes) {
    assert.ok(n.version, 'una nota senza versione non deve finire nel recap');
    assert.ok(!n.unreleased, 'il blocco in lavorazione non deve finire nel recap');
  }
});

test('since() include le note delle versioni attraversate (recap dopo update)', () => {
  const oldV = '0.0.1';
  const notes = PN.since(oldV, pkg.version);
  assert.ok(notes.length > 0, 'un aggiornamento da 0.0.1 dovrebbe avere note da mostrare');
  // Escluse le versioni ≤ oldV, incluse quelle ≤ current.
  for (const n of notes) {
    assert.ok(PN.cmpVersion(n.version, oldV) > 0, `${n.version} non dovrebbe comparire (≤ oldSeen)`);
    assert.ok(PN.cmpVersion(n.version, pkg.version) <= 0, `${n.version} non dovrebbe comparire (> current)`);
  }
});

test('la correzione di sicurezza di 0.2.115 è visibile a chi aggiorna da 0.2.114 (feedback #308)', () => {
  // Prima del fix la voce era attribuita a 0.2.114 e quindi ESCLUSA da
  // since('0.2.114', …): l'utente che passava da 0.2.114 a 0.2.116 non vedeva
  // alcun recap. Ora deve comparire un blocco 0.2.115 con la correzione.
  const notes = PN.since('0.2.114', '0.2.116');
  assert.ok(notes.length > 0, 'aggiornando da 0.2.114 a 0.2.116 il recap non deve essere vuoto');
  const v115 = notes.find((n) => n.version === '0.2.115');
  assert.ok(v115, 'manca il blocco 0.2.115 (la correzione di sicurezza uscita in quella versione)');
  const testo = [...(v115.features || []), ...(v115.fixes || [])].join(' ').toLowerCase();
  assert.ok(
    testo.includes('sicurezza'),
    'il blocco 0.2.115 dovrebbe descrivere la correzione di sicurezza');
});

// ── Il timbro della release: è QUESTO che rende visibili le note ─────────────
// Ricostruisce il changelog reale con un dataset controllato (stesse funzioni,
// altre note), poi lancia lo script che la release lancia davvero.

const TMP = mkdtempSync(join(tmpdir(), 'filo-pn-'));

function fixture(name) {
  const src = readFileSync(SRC, 'utf8');
  const notes = `  const NOTES = [
    // ↓ IN LAVORAZIONE
    {
      unreleased: true,
      features: ['Novità scritta prima della release'],
      fixes: ['Correzione scritta prima della release'],
    },
    {
      version: '9.0.0', date: '2026-01-01',
      fixes: ['Correzione della versione precedente'],
    },
  ];`;
  const out = src.replace(/ {2}const NOTES = \[[\s\S]*?\n {2}\];/, notes);
  assert.notEqual(out, src, 'la sostituzione del dataset di prova non ha agganciato nulla');
  const file = join(TMP, name);
  writeFileSync(file, out, 'utf8');
  return file;
}

// Carica un changelog isolato senza sporcare quello vero per gli altri test.
function load(file) {
  const saved = globalThis.SN_PATCH_NOTES;
  delete require.cache[require.resolve(file)];
  require(file);
  const mod = globalThis.SN_PATCH_NOTES;
  globalThis.SN_PATCH_NOTES = saved;
  return mod;
}

test('la release timbra le note in lavorazione con la versione che sta uscendo', () => {
  const file = fixture('stamp.js');
  execFileSync(process.execPath, [STAMP, '9.0.1', '--file', file, '--date', '2026-02-02'],
    { encoding: 'utf8' });

  const M = load(file);
  assert.equal(M.latestVersion(), '9.0.1', 'le note dovevano finire sotto 9.0.1');

  // Il punto di tutto: chi aggiorna da 9.0.0 a 9.0.1 VEDE quelle note.
  const recap = M.since('9.0.0', '9.0.1');
  assert.equal(recap.length, 1, 'il recap di chi passa da 9.0.0 a 9.0.1 non deve essere vuoto');
  assert.deepEqual(recap[0].features, ['Novità scritta prima della release']);
  assert.deepEqual(recap[0].fixes, ['Correzione scritta prima della release']);
  assert.equal(recap[0].date, '2026-02-02');

  // …e resta un blocco vuoto in cima per le note successive.
  const pend = M.pending();
  assert.ok(pend, 'dopo il timbro deve tornare un blocco "in lavorazione" vuoto');
  assert.equal((pend.features || []).length + (pend.fixes || []).length, 0);
  assert.equal(M.NOTES[0], pend, 'il blocco in lavorazione deve tornare in cima');
});

test('un rilascio senza note in lavorazione non inventa blocchi vuoti', () => {
  const file = fixture('maint.js');
  execFileSync(process.execPath, [STAMP, '9.0.1', '--file', file, '--date', '2026-02-02'],
    { encoding: 'utf8' });
  const dopo = join(TMP, 'maint2.js');
  copyFileSync(file, dopo);
  const prima = readFileSync(dopo, 'utf8');

  // Seconda release senza che nessuno abbia scritto note: manutenzione pura.
  execFileSync(process.execPath, [STAMP, 'v9.0.2', '--file', dopo, '--date', '2026-03-03'],
    { encoding: 'utf8' });
  assert.equal(readFileSync(dopo, 'utf8'), prima, 'il changelog non doveva essere toccato');

  const M = load(dopo);
  assert.equal(M.latestVersion(), '9.0.1', 'nessun blocco per la versione di manutenzione');
  assert.deepEqual(M.since('9.0.1', '9.0.2'), [], 'niente recap per un rilascio senza novità');
});
