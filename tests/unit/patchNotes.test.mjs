// Unit test per src/shared/patchNotes.js — la SINGOLA SORGENTE del recap
// aggiornamento (popup all'avvio) e del calcolo "quante patch sei indietro".
// Logica pura → niente Electron, gira in millisecondi via `npm run test:unit`.
//
// Guardie anti-regressione (il changelog è "muto" se questi assert diventano rossi):
//   1. latestVersion() DEVE combaciare con la versione di package.json: se il
//      changelog resta indietro, l'utente che aggiorna non vede il recap delle
//      novità (era il sintomo del feedback #308: changelog fermo a 0.2.114
//      mentre l'app era a 0.2.116).
//   2. Ogni versione del changelog DEVE avere almeno una voce (feature o fix):
//      un blocco vuoto renderebbe una sezione senza contenuto nel popup.
//   3. since() include davvero le note delle versioni ATTRAVERSATE da un
//      aggiornamento — in particolare la correzione di sicurezza uscita in
//      0.2.115 deve comparire per chi passa da 0.2.114 a una versione successiva
//      (asserzione di SUCCESSO: prima del fix era attribuita a 0.2.114 e quindi
//      esclusa da since('0.2.114', …), lasciando l'utente senza recap).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'patchNotes.js'));
const PN = globalThis.SN_PATCH_NOTES;

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

test('si registra su globalThis con la sua API', () => {
  assert.ok(PN, 'SN_PATCH_NOTES assente');
  for (const fn of ['since', 'countBehind', 'latestVersion', 'cmpVersion']) {
    assert.equal(typeof PN[fn], 'function', `manca ${fn}()`);
  }
  assert.ok(Array.isArray(PN.NOTES) && PN.NOTES.length > 0);
});

test('il changelog non promette versioni che non sono ancora uscite', () => {
  // ⚠️ Fino al 2026-08-07 qui si pretendeva che il changelog fosse ESATTAMENTE
  // alla versione dell'app. Sbagliato per due motivi:
  //
  //   1. le versioni escono da sole ogni 6 ore; se in mezzo c'è stato solo
  //      lavoro interno, quella versione NON deve avere una voce — è la regola
  //      scritta in CLAUDE.md § Patch notes ("il destinatario è l'utente
  //      comune"). Il changelog salta già delle versioni per questo;
  //   2. essendo il controllo che precede la pubblicazione, un rosso qui
  //      fermava TUTTE le versioni finché qualcuno non inventava una voce.
  //
  // L'errore vero è l'opposto: annunciare all'utente una novità in una versione
  // che non ha ancora. Quello resta vietato.
  assert.ok(
    PN.cmpVersion(PN.latestVersion(), pkg.version) <= 0,
    `il changelog annuncia la ${PN.latestVersion()} ma l'app è alla ${pkg.version}: l'utente leggerebbe di una novità che non ha`);
});

test('il conteggio delle novità regge anche se le ultime versioni non hanno voci', () => {
  // È la situazione normale con la regola di cui sopra: ciò che conta per
  // l'utente è "quante novità da quando ho aggiornato", non quante versioni.
  const oldest = PN.NOTES[PN.NOTES.length - 1].version;
  assert.equal(PN.countBehind(oldest), PN.NOTES.length - 1);
  assert.equal(PN.countBehind(PN.latestVersion()), 0);
});

test('nessun blocco del changelog è vuoto (almeno una feature o un fix)', () => {
  for (const n of PN.NOTES) {
    const nFeat = Array.isArray(n.features) ? n.features.length : 0;
    const nFix = Array.isArray(n.fixes) ? n.fixes.length : 0;
    assert.ok(nFeat + nFix > 0, `il blocco ${n.version} non ha né features né fixes`);
  }
});

test('le versioni sono ordinate dalla più recente alla più vecchia, senza duplicati', () => {
  for (let i = 1; i < PN.NOTES.length; i++) {
    const prev = PN.NOTES[i - 1].version;
    const cur = PN.NOTES[i].version;
    assert.ok(
      PN.cmpVersion(prev, cur) > 0,
      `ordine/duplicato errato: ${prev} non è strettamente più recente di ${cur}`);
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
