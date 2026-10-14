// #1097 giro 3 — un rifiuto che riguarda il tetto di lunghezza si racconta per la sua causa: il tetto solo quando è lui,
// e col nome del tetto anche quando il fornitore non scrive i numeri.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/constants.js');
require('../../../src/shared/wallet.js');
require('../../../src/shared/chatErrors.js');
require('../../../src/main/services/providers/index.js');
require('../../../src/main/services/providers/openrouter.js');
const OR = globalThis.SN_PROVIDER_OPENROUTER;
const CE = globalThis.SN_CHAT_ERRORS;

const risposta = (status, message) => ({
  status, ok: false, text: async () => JSON.stringify({ error: { message } }), headers: { get: () => null },
});
const host = (n, params, maxOut) => ({ provider_name: n, tag: n.toLowerCase(), supported_parameters: params, max_completion_tokens: maxOut });

async function frase(status, message, opts, endpoints) {
  OR.forgetModelHosts();
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (endpoints && String(url).endsWith('/endpoints')) return new Response(JSON.stringify({ data: { endpoints } }), { status: 200 });
    throw new Error('rete finta assente');
  };
  try {
    const e = await OR.httpError(risposta(status, message), { apiKey: 'k', model: 'acme/m', ...opts });
    return CE.sentence(CE.fromResponse({ error: e.message, code: e.code || 'UNKNOWN', maxTokens: e.maxTokens, finestra: e.finestra }));
  } finally { globalThis.fetch = orig; }
}

test('r1 chat con gli strumenti: un fornitore regge strumenti e un tetto più lungo, la frase non dà la colpa al tetto', async () => {
  const s = await frase(404, 'No endpoints found that can handle the requested parameters.', { tools: true, maxTokens: 16384 },
    [host('A', ['tools', 'max_tokens'], 65536), host('B', ['max_tokens'], 65536)]);
  expect(s).not.toMatch(/abbassa il tetto/);
});

test('r1 «context_length_exceeded» senza numeri nomina il tetto, non un guasto da riprovare', async () => {
  const s = await frase(400, 'context_length_exceeded', { tools: false, maxTokens: 16384 });
  expect(s).toMatch(/tetto/);
  expect(s).not.toMatch(/Riprova/);
});

test('r1 testo più tetto oltre la memoria, nella forma «input length and max_tokens exceed context limit», dice la memoria', async () => {
  const s = await frase(400, 'input length and `max_tokens` exceed context limit: 190000 + 32000 > 200000, decrease input length or `max_tokens` and try again',
    { tools: false, maxTokens: 32000 });
  expect(s).toMatch(/memoria/);
});
