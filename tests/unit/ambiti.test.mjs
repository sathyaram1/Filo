// Gli ambiti dei biglietti (#1153, SPEC-DOMANDE.md §5): l'elenco chiuso, la triade su ogni ambito iniziale e su ogni
// proposta, le vietate che nessun ambito può avere, le operazioni fuori ambito o non ancora attive rifiutate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'ambiti.js'));
const A = globalThis.SN_AMBITI;

test('nessun ambito iniziale mette insieme testo non fidato, dati privati e azioni verso l’esterno', () => {
  for (const [nome, a] of Object.entries(A.INIZIALI)) {
    assert.equal(A.rompeTriade(a.puo, a.soloPuliti), false, nome);
    for (const op of a.puo) assert.ok(A.OPERAZIONI[op], `${nome}: ${op} non è nell’elenco chiuso`);
  }
});

test('le operazioni vietate non esistono nell’elenco, e nessun ambito né proposta le può avere', () => {
  for (const v of Object.keys(A.VIETATE)) {
    assert.equal(A.OPERAZIONI[v], undefined, v);
    assert.equal(A.consente(Object.keys(A.INIZIALI), v).errore, 'operazione_vietata');
    assert.equal(A.validaProposta({ nome: 'prova_vietata', operazioni: ['feedback.metadati', v], nonPuo: 'altro' }).errore, 'operazione_vietata');
  }
});

test('chi riceve testo riservato gira nell’ambiente dei riservati; lavoro, server e unione no', () => {
  const riservati = A.elenco().filter((a) => a.riservato).map((a) => a.nome).sort();
  assert.deepEqual(riservati, ['audit', 'coda', 'domande', 'gestione_lavoro', 'posta', 'rami']);
});

test('fuori ambito, sconosciuta e non ancora attiva sono rifiuti diversi; le universali valgono per tutti', () => {
  assert.deepEqual(A.consente(['coda'], 'coda.leggi'), { ok: true });
  assert.equal(A.consente(['coda'], 'feedback.leggi').errore, 'fuori_ambito');
  assert.equal(A.consente(['coda'], 'unisci.scrivi').errore, 'fuori_ambito');
  assert.equal(A.consente(['coda'], 'coda.scrivi').errore, 'operazione_sconosciuta');
  assert.equal(A.consente(['coda'], 'taccuino.scrivi').errore, 'operazione_non_attiva');
  assert.equal(A.consente(['posta'], 'posta.leggi').errore, 'fuori_ambito', 'un ambito non ancora attivo non dà niente');
  assert.deepEqual(A.consente([], 'segnala'), { ok: true });
  assert.deepEqual(A.consente(['lavoro'], 'rapporto'), { ok: true });
});

test('una proposta d’ambito: nome nuovo, operazioni dell’elenco, «non può» scritto, triade rispettata', () => {
  const buona = A.validaProposta({ nome: 'lettore_code', operazioni: ['feedback.metadati', 'feedback.leggi', 'feedback.metadati'], nonPuo: 'scrivere' });
  assert.equal(buona.errore, 'operazione_doppia');
  const ok = A.validaProposta({ nome: 'lettore_code', operazioni: ['feedback.metadati', 'feedback.leggi'], nonPuo: 'scrivere' });
  assert.deepEqual(ok, { ok: true, ambito: { nome: 'lettore_code', operazioni: ['feedback.metadati', 'feedback.leggi'], nonPuo: 'scrivere', riservato: true } });
  assert.equal(A.validaProposta({ nome: 'coda', operazioni: ['feedback.metadati'], nonPuo: 'x' }).errore, 'nome_esistente');
  assert.equal(A.validaProposta({ nome: 'Coda!', operazioni: ['feedback.metadati'], nonPuo: 'x' }).errore, 'nome_non_valido');
  assert.equal(A.validaProposta({ nome: 'spia', operazioni: ['feedback.leggi', 'ramo.spingi'], nonPuo: 'x' }).errore, 'triade');
  assert.equal(A.validaProposta({ nome: 'muto', operazioni: ['feedback.metadati'], nonPuo: '  ' }).errore, 'nonpuo_mancante');
  assert.equal(A.validaProposta({ nome: 'muto', operazioni: ['segnala'], nonPuo: 'x' }).errore, 'operazione_universale');
});

test('un ambito approvato vale come gli iniziali; uno che il server rifiuterebbe non vale neppure se scritto', () => {
  const approvati = { lettore_code: { operazioni: ['feedback.metadati'], nonPuo: 'scrivere' }, spia: { operazioni: ['feedback.leggi', 'ramo.spingi'], nonPuo: '' } };
  assert.deepEqual(A.consente(['lettore_code'], 'feedback.metadati', approvati), { ok: true });
  assert.equal(A.ambitoDi('spia', approvati), null);
  assert.ok(A.attivi(approvati).includes('lettore_code'));
  assert.ok(!A.attivi(approvati).includes('spia'));
  assert.ok(!A.attivi().includes('posta'), 'la posta aspetta la casella');
});
