// L'automatica per fiducia (SPEC-DOMANDE.md §10): con l'automatica accesa un feedback giudicato sicuro entra in coda da
// solo se l'interruttore della SUA fiducia lo ammette; il mittente non conta. Copia lato Filo (la Gestione mostra gli
// interruttori); decide filo-security functions/src/autoApprove.js, col gemello functions/test/autoApprove.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(resolve(ROOT, 'src', 'shared', 'feedbackThread.js'));
const TH = globalThis.SN_FEEDBACK_THREAD;

// [nome, fiducia, cfg, ammesso]. Copia esatta del gemello sul server.
const CASI = [
  ['master spento, fidato', 'fidato', { enabled: false }, false],
  ['master spento, mappa tutta accesa', 'non_fidato', { enabled: false, autoApprove: { fidato: true, non_fidato: true } }, false],
  ['master acceso senza mappa: tutti', 'non_fidato', { enabled: true }, true],
  ['fidati ammessi, non fidati no: fidato', 'fidato', { enabled: true, autoApprove: { fidato: true, non_fidato: false } }, true],
  ['fidati ammessi, non fidati no: non fidato', 'non_fidato', { enabled: true, autoApprove: { fidato: true, non_fidato: false } }, false],
  ['fiducia assente vale non fidato', undefined, { enabled: true, autoApprove: { fidato: true, non_fidato: false } }, false],
  ['fiducia ignota vale non fidato', 'quasi', { enabled: true, autoApprove: { fidato: true, non_fidato: false } }, false],
  ['solo i fidati spenti', 'fidato', { enabled: true, autoApprove: { fidato: false, non_fidato: true } }, false],
  ['mappa vecchia tutta accesa: fidato', 'fidato', { enabled: true, autoApprove: { owner: true, user: true, prober: true } }, true],
  ['mappa vecchia con gli utenti spenti: non fidato fermo', 'non_fidato', { enabled: true, autoApprove: { user: false } }, false],
  ['mappa vecchia con gli utenti spenti: fidato ammesso', 'fidato', { enabled: true, autoApprove: { user: false } }, true],
  ['mappa vecchia con Claude spento: fidato fermo', 'fidato', { enabled: true, autoApprove: { claude: false } }, false],
  ['mappa vecchia con Claude spento: non fidato fermo', 'non_fidato', { enabled: true, autoApprove: { claude: false } }, false],
  ['mappa vecchia con Filo spento: fidato ammesso', 'fidato', { enabled: true, autoApprove: { filo: false } }, true],
  ['la scelta nuova batte la mappa vecchia', 'non_fidato', { enabled: true, autoApprove: { user: false, non_fidato: true } }, true],
];

test('ogni caso della tabella condivisa col server', () => {
  for (const [nome, fiducia, cfg, atteso] of CASI) {
    assert.equal(TH.autoApproveAllowed(fiducia, cfg), atteso, nome);
  }
});

test('il gruppo è la fiducia, mai il mittente', () => {
  assert.deepEqual(TH.AUTO_APPROVE_GROUPS, ['fidato', 'non_fidato']);
  assert.equal(TH.autoApproveGroup('fidato'), 'fidato');
  assert.equal(TH.autoApproveGroup('non_fidato'), 'non_fidato');
  assert.equal(TH.autoApproveGroup(undefined), 'non_fidato');
  assert.equal(TH.autoApproveGroup('owner:abc'), 'non_fidato', 'un nome di mittente non è una fiducia');
});

test('resolveAutoApprove riempie i due gruppi, e senza mappa non inventa niente', () => {
  assert.equal(TH.resolveAutoApprove(undefined), null);
  assert.equal(TH.resolveAutoApprove(null), null);
  assert.deepEqual(TH.resolveAutoApprove({}), { fidato: true, non_fidato: true });
  assert.deepEqual(TH.resolveAutoApprove({ non_fidato: false }), { fidato: true, non_fidato: false });
  assert.deepEqual(TH.resolveAutoApprove({ prober: false }), { fidato: false, non_fidato: false });
});
