// #2193.1: «la pratica aspetta una domanda» e «il lavoro è già su main» si contano in un posto solo, che la Gestione
// usa e il server incorpora (domande.js, feedbackAttese.js). Qui la regola e la Gestione che la chiede; il server la
// prova con lo stesso modulo incorporato (functions/test/conti-condivisi-fusioni-2193.test.js in filo-security).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
require(join(ROOT, 'src', 'shared', 'feedbackTransitions.js'));
require(join(ROOT, 'src', 'shared', 'feedbackStatus.js'));
require(join(ROOT, 'src', 'shared', 'manageReview.js'));
const D = globalThis.SN_DOMANDE;
const A = globalThis.SN_FB_ATTESE;
const MR = globalThis.SN_MANAGE_REVIEW;

const SHA = 'b'.repeat(40);

test('aspetta una domanda: la domanda della fermata conta anche se non sta fra quelle che fermano', () => {
  // Il caso della segnalazione: fermata nata prima di `domandeBloccanti`, la domanda c'è solo come `domandaId`.
  assert.equal(D.domandaCheAspetta({ status: 'design', statusReason: 'clarify', domandaId: 'D-7' }), 'D-7');
  assert.equal(D.domandaCheAspetta({ status: 'design', statusReason: 'arenato', domandaId: 'D-8', domandeBloccanti: [] }), 'D-8');
  assert.equal(D.domandaCheAspetta({ status: 'aligned', statusReason: 'origine_chiusa', domandaId: 'D-9' }), 'D-9');
  // In coda la ferma la prima delle sue domande bloccanti, anche senza fermata.
  assert.equal(D.domandaCheAspetta({ status: 'todo', domandeBloccanti: ['D-3', 'D-4'] }), 'D-3');
  assert.equal(D.domandaCheAspetta({ status: 'revision_security', domandeBloccanti: ['storto', 'D-5'] }), 'D-5');
});

test('aspetta una domanda: niente senza una fermata che ne apra una o un id valido', () => {
  assert.equal(D.domandaCheAspetta({ status: 'design', statusReason: 'l5', domandaId: 'D-7' }), '');
  assert.equal(D.domandaCheAspetta({ status: 'design', statusReason: 'clarify', domandaId: 'D-0' }), '');
  assert.equal(D.domandaCheAspetta({ status: 'design', statusReason: 'clarify', domandaId: '<b>D-7</b>' }), '');
  assert.equal(D.domandaCheAspetta({ status: 'done', domandeBloccanti: ['D-3'] }), '');
  assert.equal(D.domandaCheAspetta(null), '');
});

test('la Gestione chiede la stessa regola: stesso esito su ogni forma, e la scheda dice «dopo la tua risposta»', () => {
  const forme = [
    { status: 'design', statusReason: 'clarify', domandaId: 'D-7' },
    { status: 'design', statusReason: 'l5', domandaId: 'D-7', domandeBloccanti: ['D-7'] },
    { status: 'todo', domandeBloccanti: ['D-3'] },
    { status: 'aligned', statusReason: 'origine_mancante', domandaId: 'D-2' },
    { status: 'working', domandaId: 'D-2', domandeBloccanti: ['D-2'] },
  ];
  for (const fb of forme) assert.equal(MR.aspettaDomanda(fb), D.domandaCheAspetta(fb), JSON.stringify(fb));
  const fallita = { id: 'r1', feedbackId: 'fb-1', branch: 'worker/x', origin: 'routine', used: true, outcome: 'conflict' };
  const fb = { _id: 'fb-1', status: 'design', statusReason: 'clarify', domandaId: 'D-7' };
  assert.equal(MR.statoFusione(fb, { fusioni: { failed: [fallita] }, fusioniLette: true }), 'attende_domanda');
});

test('lavoro su main: la fusione registrata, la versione, il «già risolto» o una richiesta fusa', () => {
  assert.equal(A.lavoroSuMain({ status: 'done', fusioneSha: SHA }), true);
  assert.equal(A.lavoroSuMain({ status: 'archived', resolvedInVersion: '0.2.100' }), true);
  assert.equal(A.lavoroSuMain({ status: 'done', statusReason: 'gia_risolto' }), true);
  assert.equal(A.lavoroSuMain({ status: 'done' }, [{ used: true, outcome: 'merged' }]), true);
  assert.equal(A.lavoroSuMain({ status: 'done' }, [{ id: 'r', data: { used: true, outcome: 'merged' } }]), true);
  // Lo stato cifrato (server senza chiave, trigger): vale lo statusPublic.
  assert.equal(A.lavoroSuMain({ status: 'FENC1:xyz', statusPublic: 'closed', fusioneSha: SHA }), true);
  assert.equal(A.lavoroSuMain({ statusPublic: 'closed', resolvedInVersion: '1.0.0' }), true);
});

test('lavoro su main: niente senza una prova, o con la pratica aperta', () => {
  assert.equal(A.lavoroSuMain({ status: 'done' }), false);
  assert.equal(A.lavoroSuMain({ status: 'done', fusioneSha: 'corto' }), false);
  assert.equal(A.lavoroSuMain({ status: 'done' }, [{ used: true, outcome: 'conflict' }, { used: false, outcome: 'merged' }]), false);
  assert.equal(A.lavoroSuMain({ status: 'archived', statusReason: 'gia_risolto' }), false);
  assert.equal(A.lavoroSuMain({ status: 'revision_security', fusioneSha: SHA, resolvedInVersion: '1.0.0' }), false);
  assert.equal(A.lavoroSuMain({ status: 'FENC1:xyz', statusPublic: 'open', fusioneSha: SHA }), false);
  assert.equal(A.lavoroSuMain({ missing: true }), false);
  assert.equal(A.lavoroSuMain(null), false);
});

test('la Gestione toglie la scheda della fusione non avvenuta col conto condiviso, anche con la fusione registrata', () => {
  const fallita = { id: 'r1', feedbackId: 'fb-1', branch: 'worker/x', origin: 'routine', used: true, outcome: 'conflict' };
  const opts = { fusioni: { failed: [fallita] }, fusioniLette: true };
  assert.notEqual(MR.statoFusione({ _id: 'fb-1', status: 'done', fusioneSha: SHA }, opts), 'riallineamento_fallito');
  assert.equal(MR.statoFusione({ _id: 'fb-1', status: 'done' }, opts), 'riallineamento_fallito');
});
