// #829 giro 1 — Anthropic giù è un guasto del fornitore, non un «nessun host ammesso», anche nei contatori giornalieri.

import { test, expect } from '../../fixtures/electron.mjs';

test('r1 un 503 o un 504 di Anthropic si conta come guasto del servizio, come prima', async ({ app }) => {
  const tipi = await app.evaluate(async () => {
    const OR = globalThis.SN_PROVIDER_OPENROUTER;
    const K = globalThis.SN_CONTATORI;
    const vero = globalThis.fetch;
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'retry-after': '0' } });
    let stato = 503;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/endpoints')) return json({ data: { endpoints: [{ provider_name: 'Anthropic', tag: 'anthropic' }, { provider_name: 'DeepInfra', tag: 'deepinfra' }] } });
      if (u.includes('/chat/completions')) return json({ error: { code: stato, message: 'Provider returned error' } }, stato);
      return json({ data: {} });
    };
    OR.forgetModelHosts();
    const tipo = async (model) => {
      try {
        await OR.complete({ apiKey: 'k-test', model, messages: [{ role: 'user', content: 'ciao' }], providerRouting: { ignore: ['google'] } });
        return 'risposto';
      } catch (e) { return K.tipoErrore(e); }
    };
    try {
      const out = {};
      out.claude503 = await tipo('anthropic/claude-haiku-4.5');
      out.llama503 = await tipo('meta-llama/llama-3.3-70b-instruct');
      stato = 504;
      out.claude504 = await tipo('anthropic/claude-haiku-4.5');
      return out;
    } finally { globalThis.fetch = vero; }
  });
  expect(tipi.llama503).toBe('fornitore');
  expect(tipi.claude503).toBe('fornitore');
  expect(tipi.claude504).toBe('tempo');
});
