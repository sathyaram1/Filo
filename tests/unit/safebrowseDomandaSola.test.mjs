// L'arrivo su una pagina e la pagina stessa chiedono il verdetto a pochi millisecondi (#813.1): finché la prima domanda
// a una fonte di rete è in volo, la seconda la aspetta invece di rifarla, e il verdetto arriva a tutte e due.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SB = require('../../src/main/services/safebrowse/index.js');

test('due verifiche dello stesso sito in volo insieme fanno una domanda sola per fonte, e tutte e due vedono la risposta', async () => {
  for (const c of Object.values(SB._caches)) c.m.clear();
  const chiamate = { gsb: 0, rdap: 0, ct: 0 };
  let rispondi;
  const risposta = new Promise((ok) => { rispondi = ok; });
  SB.setProviders({
    gsb: async () => { chiamate.gsb++; await risposta; return { listed: true, category: 'phishing' }; },
    rdap: async () => { chiamate.rdap++; await risposta; return 400; },
    ct: async () => { chiamate.ct++; await risposta; return null; },
    llm: null, sandbox: null,
  });
  const url = 'https://conto-verifica-accesso.com/login';
  const visti = [];
  const a = SB.analyze(url, {}, (v) => visti.push(['arrivo', v.level]));
  const b = SB.analyze(url, { hasPassword: true }, (v) => visti.push(['pagina', v.level]));
  assert.equal(a.level, 'safe');
  assert.equal(b.level, 'safe');
  rispondi();
  await new Promise((ok) => setTimeout(ok, 20));
  // CT si chiede solo se RDAP non dà l'età: qui RDAP risponde.
  assert.deepEqual(chiamate, { gsb: 1, rdap: 1, ct: 0 });
  assert.deepEqual(visti.sort(), [['arrivo', 'pericoloso'], ['pagina', 'pericoloso']]);
  // A risposta arrivata la domanda successiva legge la memoria, non riparte.
  assert.equal(SB.analyze(url, {}, () => {}).level, 'pericoloso');
  assert.equal(chiamate.gsb, 1);
  SB.setProviders({ gsb: null, rdap: null, ct: null });
});
