// La proiezione degli elenchi: cosa si scarica per ELENCARE e cosa solo per
// APRIRE. Non deve fermare: guarda i due elenchi e firestore.rules.
// La regola narrata sta nel commento di CAMPI_LISTA in src/shared/feedback.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
require(resolve(ROOT, 'src', 'shared', 'feedback.js'));
const FB = globalThis.SN_FEEDBACK;

// I campi che le regole Firestore nominano negli `hasOnly` del feedback: è
// l'elenco di tutto ciò che un client può scrivere su un documento, cioè di
// tutto ciò che un elenco potrebbe voler mostrare.
function campiDalleRegole() {
  const rules = readFileSync(resolve(ROOT, 'firestore.rules'), 'utf8');
  // Solo il blocco della collezione `feedback`: le altre (le schede pubbliche,
  // i crediti) hanno campi loro, che qui non c'entrano.
  const da = rules.indexOf('match /feedback/{');
  const a = rules.indexOf('match /feedback-public/{');
  assert.ok(da > 0 && a > da, 'firestore.rules: blocco della collezione feedback non trovato');
  const blocco = rules.slice(da, a);
  // I blocchi `hasOnly([...])` delle sotto-mappe (una voce di `livelli`, un
  // voto) nominano chiavi di un'altra cosa, non campi del documento.
  const esclusi = new Set([
    'esito', 'at', 'ruolo', 'by', 'testo',      // una voce di `livelli`
    'l3', 'l4',                                  // le chiavi di `livelli`
    'vote', 'credibilitySnapshot',               // una voce di `votes`
  ]);
  const out = new Set();
  for (const m of blocco.matchAll(/hasOnly\(\s*\[([\s\S]*?)\]\s*\)/g)) {
    for (const q of m[1].matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'/g)) {
      if (!esclusi.has(q[1])) out.add(q[1]);
    }
  }
  assert.ok(out.size > 20, 'firestore.rules: elenco dei campi del feedback non riconosciuto');
  return out;
}

test('nessun campo sta in tutte e due le liste', () => {
  const doppi = FB.CAMPI_LISTA.filter((f) => FB.CAMPI_DETTAGLIO.includes(f));
  assert.deepEqual(doppi, [], `campi in entrambe le liste: ${doppi.join(', ')}`);
});

test('ogni campo che le regole ammettono sta in una delle due liste', () => {
  const noti = new Set([...FB.CAMPI_LISTA, ...FB.CAMPI_DETTAGLIO]);
  const fuori = [...campiDalleRegole()].filter((f) => !noti.has(f)).sort();
  assert.deepEqual(fuori, [], 'campi nuovi in firestore.rules che nessun elenco chiede più: '
    + `aggiungili a CAMPI_LISTA (se una riga li mostra, ordina o filtra) o a CAMPI_DETTAGLIO — ${fuori.join(', ')}`);
});

test('i campi che pesano non stanno nella proiezione', () => {
  for (const f of ['notes', 'livelli', 'reviewComment', 'images', 'files']) {
    assert.ok(FB.CAMPI_DETTAGLIO.includes(f), `${f} deve restare fuori dagli elenchi`);
    assert.ok(!FB.CAMPI_LISTA.includes(f), `${f} non va chiesto da un elenco`);
  }
});

test('i campi che una riga mostra, ordina o filtra ci sono', () => {
  // `pipeline` da solo vale il test: lo scrive il server con l'SDK admin, le
  // regole non lo nominano, e da lì viene il colore del bordo di ogni riga.
  for (const f of ['_id_non_e_un_campo'].slice(1).concat([
    'pipeline', 'status', 'statusPublic', 'statusReason', 'priority', 'starred',
    'name', 'text', 'seq', 'subSeq', 'createdAt', 'resolvedAt', 'resolvedInVersion',
    'clientId', 'userNote', 'votes', 'reopenRequests', 'blockReason',
    'reviewDecision', 'mergePreapproved', 'stalls', 'workingResets', 'claimedBy', 'beatAt',
  ])) {
    assert.ok(FB.CAMPI_LISTA.includes(f), `${f} serve alle righe d'elenco`);
  }
});

test('una riga proiettata si riconosce, una intera no', () => {
  assert.equal(FB.soloLista({ _id: 'x', _proiezione: true }), true);
  assert.equal(FB.soloLista({ _id: 'x' }), false);
  assert.equal(FB.soloLista(null), false);
});
