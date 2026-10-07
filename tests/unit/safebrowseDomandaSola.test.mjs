// L'arrivo su una pagina e la pagina stessa chiedono il verdetto a pochi millisecondi (#813.1): finché la prima domanda
// a una fonte di rete è in volo, la seconda la aspetta invece di rifarla, e il verdetto arriva a tutte e due.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SB = require('../../src/main/services/safebrowse/index.js');

test('due verifiche dello stesso sito in volo insieme fanno una domanda sola per fonte, e tutte e due vedono la risposta', async () => {
  for (const c of Object.values(SB._caches)) c.m.clear();
  SB._gsbLookup.clear();
  const url = 'https://conto-verifica-accesso.com/login';
  const inLista = SB.gsb.hashesOf(url).find((h) => h.expr === 'conto-verifica-accesso.com/login');
  const chiamate = { gsb: 0, rdap: 0, ct: 0 };
  let rispondi;
  const risposta = new Promise((ok) => { rispondi = ok; });
  const cercaVera = SB.net.hashesSearch;
  // La ricerca a prefissi vera, con la rete finta: la memoria è quella che usa Filo.
  SB.net.hashesSearch = async (prefissi) => {
    chiamate.gsb++;
    await risposta;
    const matches = prefissi.includes(inLista.prefix) ? [{ hash: inLista.full, threatType: 'SOCIAL_ENGINEERING', category: 'phishing' }] : [];
    return { ok: true, matches, cacheMs: 300_000 };
  };
  try {
    SB.configure({ gsbKey: 'chiave-finta', enableNetwork: false, enableSandbox: false });
    SB.setProviders({
      rdap: async () => { chiamate.rdap++; await risposta; return 400; },
      ct: async () => { chiamate.ct++; await risposta; return null; },
      llm: null, sandbox: null,
    });
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
  } finally {
    SB.net.hashesSearch = cercaVera;
    SB._gsbLookup.clear();
    SB.setProviders({ gsb: null, rdap: null, ct: null });
  }
});
