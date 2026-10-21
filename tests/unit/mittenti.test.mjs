// Sentinella §10 (SPEC-DOMANDE.md): la mappatura delle etichette di mittente sulle classi, su un campione di etichette
// vere, e il modulo come unico lettore del prefisso. Il server incorpora lo stesso file (bake-shared): i casi valgono
// per entrambi. Gemello: filo-security functions/test/mittenti-solo-statistica.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'mittenti.js'));
const M = globalThis.SN_MITTENTI;

// [etichetta, prova, classe, ruolo]: le etichette che stanno oggi sui feedback (SPEC-DOMANDE.md §10 e chi le scrive).
const CAMPIONE = [
  ['owner:5f0c2a9e-1b7d-4c1e-9a33-0d2b7e9c1f40', 'admin', 'owner', ''],
  ['local:claude', 'admin', 'sessione_locale', ''],
  ['routine:residuo', 'server', 'routine', 'residuo'],
  ['routine:new-work', 'server', 'routine', 'new-work'],
  ['routine:fixer', 'server', 'routine', 'fixer'],
  ['routine:prober', 'server', 'routine', 'prober'],
  ['routine:verifier', 'server', 'routine', 'verifier'],
  ['routine:secaudit', 'server', 'routine', 'secaudit'],
  ['routine:routine', 'server', 'routine', 'ignoto'],
  ['routine:routine:nice-wozniak', 'server', 'routine', 'ignoto'],
  ['routine:nice-wozniak', 'server', 'routine', 'ignoto'],
  ['routine', 'server', 'routine', 'ignoto'],
  ['agent:costruzione', 'server', 'server', ''],
  ['agent:google/gemma-4-31b-it', undefined, 'test', ''],
  ['agent:gemma-4-31b-it', 'admin', 'test', ''],
  ['non-provato:agent:gemma-4-31b-it', undefined, 'test', ''],
  ['test:canale', undefined, 'test', ''],
  ['verifica-3e', undefined, 'test', ''],
  ['auto:complaint', undefined, 'filo_per_utente', ''],
  ['auto:capability-gap:uncommandable-12', undefined, 'filo_per_utente', ''],
  ['filo:chat', undefined, 'filo_per_utente', ''],
  ['anon-k3j9x2', undefined, 'utente', ''],
  ['7c9e6679-7425-40de-944b-e07fc1f90ae7', undefined, 'utente', ''],
  ['uid:Qm2x9Lr', undefined, 'utente', ''],
  ['tester@example.com', undefined, 'utente', ''],
  ['', undefined, 'utente', ''],
  // Un nome riservato senza prova è un utente, comunque si presenti (#912).
  ['owner:me', undefined, 'utente', ''],
  ['local:claude', undefined, 'utente', ''],
  ['routine:residuo', undefined, 'utente', ''],
  ['non-provato:owner:me', 'admin', 'utente', ''],
  ['non-provato:routine:fixer', 'server', 'utente', ''],
  ['agent:costruzione', 'admin', 'test', ''],
];

test('ogni etichetta del campione finisce nella sua classe, il ruolo solo sulle routine', () => {
  for (const [clientId, senderProof, classe, ruolo] of CAMPIONE) {
    const m = M.classifica({ clientId, senderProof });
    assert.deepEqual(m, { classe, ruolo }, `${clientId || '(vuoto)'} con prova ${senderProof}`);
    assert.ok(M.CLASSI.includes(m.classe));
  }
});

test('un mittente ancora cifrato non si classifica: niente classe inventata', () => {
  assert.equal(M.classifica({ clientId: 'FENC1:AbCdEf', senderProof: 'admin' }), null);
  assert.equal(M.mittenteDi({ clientId: 'FENC1:AbCdEf' }), null);
});

test('la classe scritta dal server vince sul calcolo, anche col mittente cifrato', () => {
  assert.deepEqual(M.mittenteDi({ clientId: 'FENC1:x', mittenteClasse: 'routine', mittenteRuolo: 'fixer' }), { classe: 'routine', ruolo: 'fixer' });
  assert.deepEqual(M.mittenteDi({ clientId: 'utente-1', mittenteClasse: 'owner' }), { classe: 'owner', ruolo: '' });
  // Una classe scritta male non vale: si ricalcola.
  assert.deepEqual(M.mittenteDi({ clientId: 'filo:chat', mittenteClasse: 'admin' }), { classe: 'filo_per_utente', ruolo: '' });
  assert.deepEqual(M.mittenteDi({ clientId: 'x', mittenteClasse: 'routine', mittenteRuolo: '<b>' }), { classe: 'routine', ruolo: 'ignoto' });
});

test('i campi da scrivere: il ruolo solo per una routine', () => {
  assert.deepEqual(M.campiDi({ classe: 'routine', ruolo: 'residuo' }), { mittenteClasse: 'routine', mittenteRuolo: 'residuo' });
  assert.deepEqual(M.campiDi({ classe: 'utente', ruolo: '' }), { mittenteClasse: 'utente' });
  assert.equal(M.campiDi(null), null);
  assert.equal(M.campiDi({ classe: 'admin' }), null);
});

test('la provenienza per il giudice di priorità: il tetto solo alle routine e ai rilievi automatici dell\'app', () => {
  const p = (clientId, senderProof) => M.provenienza({ clientId, senderProof });
  assert.equal(p('routine:fixer', 'server').automatico, true);
  assert.equal(p('auto:complaint').automatico, true);
  assert.equal(p('filo:chat').automatico, false);
  assert.equal(p('local:claude', 'admin').automatico, false);
  assert.equal(p('routine:fixer').automatico, false, 'senza prova è un utente, senza tetto');
  assert.equal(p('routine:verifier', 'server').testo.includes('verificatore'), true);
  assert.equal(p('anon-1').testo, 'un utente');
});

test('il modulo non parla di permessi: nessuna fiducia, nessun gruppo dell\'automatica', () => {
  const src = readFileSync(join(ROOT, 'src', 'shared', 'mittenti.js'), 'utf8').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(src, /fiducia|fidato|autoApprove|attack|spam/);
});

test('l\'app non ha più un «mittente fidato» dal prefisso', () => {
  for (const rel of ['src/shared/manageReview.js', 'src/shared/feedbackThread.js', 'src/pages/manage/manage.js', 'src/shared/feedbackStats.js']) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    assert.doesNotMatch(src, /isTrustedClient|isTrustedIdentity/, `${rel} decide ancora la fiducia dal mittente`);
  }
});
