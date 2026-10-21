// Lo strumento che confronta l'italiano dei modelli sulla chat (#1398) gira senza rete su un fornitore finto: parla col
// prompt vero dell'intervista, esegue le spunte, tiene grezzo e tenuto per ogni giro, somma i costi e si ferma su un escluso.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provaModello, conFetchRegistrato, rapporto, TURNI } from '../agent/italiano-chat.mjs';

const enc = new TextEncoder();
function sse(eventi) {
  const byte = enc.encode(eventi.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n');
  // Tagliato a metà di «è» e a metà parola, come può fare la rete.
  const taglio = byte.indexOf(0xa8);
  const pezzi = taglio > 0 ? [byte.subarray(0, taglio), byte.subarray(taglio)] : [byte];
  let i = 0;
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => '', body: { getReader: () => ({ read: async () => (i < pezzi.length ? { done: false, value: pezzi[i++] } : { done: true }) }) } };
}

function fornitoreFinto({ host = 'Fireworks' } = {}) {
  const corpi = [];
  const fetch = async (_url, init) => {
    const b = JSON.parse(init.body);
    corpi.push(b);
    const primoGiro = b.messages[b.messages.length - 1].role === 'user';
    const usage = { prompt_tokens: 100, completion_tokens: 20, cost: 0.001 };
    if (primoGiro) {
      return sse([
        { id: 'g', provider: host, choices: [{ delta: { content: 'Piacere, è un' } }] },
        { id: 'g', provider: host, choices: [{ delta: { content: ' bel lavoro.' } }] },
        { id: 'g', provider: host, choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'ONBOARDING', arguments: '{"spunta":["profilo"]}' } }] }, finish_reason: 'tool_calls' }], usage },
      ]);
    }
    return sse([{ id: 'g', provider: host, choices: [{ delta: { content: 'Come vuoi che ti parli?' }, finish_reason: 'stop' }], usage }]);
  };
  return { fetch, corpi };
}

test('una conversazione su un fornitore finto: testo identico, spunte applicate, costi sommati', async () => {
  const f = fornitoreFinto();
  const e = await conFetchRegistrato(f.fetch, { temperature: 0.6 }, () => provaModello({ model: 'finto/uno', apiKey: 'k', turni: TURNI.slice(0, 2) }));
  assert.equal(e.errore, null);
  assert.equal(e.turni.length, 2);
  const [primo, secondo] = e.turni[0].giri;
  assert.equal(primo.testo, 'Piacere, è un bel lavoro.');
  assert.equal(primo.grezzo, primo.testo);
  assert.equal(primo.identico, true);
  assert.deepEqual(primo.strumenti.map((x) => x.nome), ['ONBOARDING']);
  assert.equal(secondo.testo, 'Come vuoi che ti parli?');
  assert.equal(e.diversi, 0);
  assert.equal(f.corpi.length, 4);
  assert.equal(f.corpi[0].temperature, 0.6);
  assert.ok(f.corpi[0].provider.ignore.length > 0, 'la lista di esclusione parte con la richiesta');
  const sistema = (b) => b.messages[0].content;
  assert.match(sistema(f.corpi[0]), /intervista in corso/);
  assert.match(sistema(f.corpi[0]), /\[ \] profilo/);
  assert.match(sistema(f.corpi[2]), /\[x\] profilo/, 'la spunta del primo turno arriva nel prompt del secondo');
  assert.ok(f.corpi[1].messages.some((m) => m.role === 'tool' && m.tool_call_id === 'c1'));
  assert.ok(Math.abs(e.costoUsd - 0.004) < 1e-9);
  assert.deepEqual(e.host, ['Fireworks']);
  assert.match(rapporto([e]), /\*\*Filo:\*\* Piacere, è un bel lavoro\./);
});

test('un fornitore escluso ferma la prova del modello', async () => {
  const f = fornitoreFinto({ host: 'DeepSeek' });
  const e = await conFetchRegistrato(f.fetch, null, () => provaModello({ model: 'finto/due', apiKey: 'k', turni: TURNI.slice(0, 1) }));
  assert.match(e.errore, /escluso/);
  assert.equal(f.corpi.length, 1);
});
