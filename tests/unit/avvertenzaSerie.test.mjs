// Il verificatore che corregge, giro 9 su #561: le critiche più vecchie tolte
// dalla serie dal server vengono DETTE a chi legge il fascicolo, invece di
// passare per inesistenti (la ricetta chiede di ri-provare le porte di ogni
// giro passato: un giro sparito in silenzio è una porta data per chiusa).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialAwarenessNote, buildPayload } from '../../scripts/dispatch.mjs';

const storia = (n) => Array.from({ length: n }, (_, i) => ({ verdict: 'critica', critique: `porta ${i}` }));

test('l\'avvertenza di serie dice quante critiche mancano e conta i giri anche su quelle', () => {
  const v = serialAwarenessNote('verifier', storia(40), 3);
  assert.match(v, /3 critiche più vecchie NON sono nel fascicolo/);
  assert.match(v, /non vanno date per chiuse/);
  assert.match(v, /giro 44 di verifica/, '40 in serie + 3 tolte = 43 giri passati');
  const f = serialAwarenessNote('fixer', storia(40), 1);
  assert.match(f, /Una critica più vecchia NON è nel fascicolo/);
  assert.match(f, /rimandato indietro 41 volte/);
  assert.doesNotMatch(serialAwarenessNote('verifier', storia(5), 0), /NON sono nel fascicolo/, 'niente tolto, niente avviso');
  assert.doesNotMatch(serialAwarenessNote('verifier', storia(5)), /NON/, 'il terzo argomento è facoltativo');
});

test('il conto delle critiche tolte viaggia nel payload di chi vede la serie, e non oltre', () => {
  const v = buildPayload({ role: 'verifier', branch: 'b', id: 'x', num: '#1' }, { feedback: {}, history: storia(2), historyDropped: 4 });
  assert.equal(v.historyDropped, 4);
  const f = buildPayload({ role: 'fixer', branch: 'b', id: 'x', num: '#1' }, { feedback: {}, history: storia(2), historyDropped: 4 });
  assert.equal(f.historyDropped, 4);
  const s = buildPayload({ role: 'secaudit', branch: 'b', id: 'x', num: '#1' }, { diff: '', history: storia(2), historyDropped: 4 });
  assert.equal(s.historyDropped, undefined);
  assert.equal(buildPayload({ role: 'verifier', branch: 'b' }, { feedback: {}, history: [] }).historyDropped, 0);
});
