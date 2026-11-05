// Verifica #1302, giro 1, rilievo 1: con il tetto di serie largo, una conversazione oltre la memoria del modello
// (o che ci sta da sola, a pochi token dal bordo) è data come colpa del tetto e la chat della home non la accorcia.
// Rete finta per il router; la regola della home è quella di stringiDopoRifiuto (handlers.js).
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(join(process.cwd(), 'tests', 'unit', 'x.mjs'));
for (const f of ['constants', 'chatErrors', 'scryfallQuery', 'lunghezzaRisposte', 'filoContesto']) require(`../../src/shared/${f}.js`);
require('../../src/main/services/providers/index.js');
require('../../src/main/services/providers/openrouter.js');
const OR = globalThis.SN_PROVIDER_OPENROUTER;
const FC = globalThis.SN_FILO_CONTESTO;
const LR = globalThis.SN_LUNGHEZZA_RISPOSTE;

const msgOR = (finestra, testo, out) => `This endpoint's maximum context length is ${finestra} tokens. However, you requested about ${testo + out} tokens (${testo} of text input, ${out} in the output). Please reduce the length of either one, or use the "middle-out" transform to compress your prompt automatically.`;

async function chiamaCon(rifiuta) {
  OR.forgetModelHosts();
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/endpoints')) return new Response('{}', { status: 500 });
    const b = JSON.parse(init.body);
    const no = rifiuta(b.max_tokens || 0);
    if (no) return new Response(JSON.stringify({ error: { message: no } }), { status: 400 });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
  };
  try {
    await OR.complete({ apiKey: 'k', model: 'acme/x', messages: [{ role: 'user', content: 'ciao' }], maxTokens: LR.DI_SERIE.conversazioni });
    return null;
  } catch (e) { return e; } finally { globalThis.fetch = orig; }
}
const laHomeAccorcia = (e) => !!(e && (e.code !== 'TETTO_RISPOSTA' || e.stringibile) && FC.troppoLungo(e));

test('r1 conversazione da 100k token su un modello da 64k: la home la accorcia, come col tetto di 16384', async () => {
  const e = await chiamaCon((out) => msgOR(65536, 100000, out));
  expect(e).toBeTruthy();
  expect(laHomeAccorcia(e)).toBe(true);
});

test('r1 conversazione da 127.500 token su un modello da 128.000: il testo ci sta da solo, la home la accorcia', async () => {
  const e = await chiamaCon((out) => (out && 127500 + out > 128000 ? msgOR(128000, 127500, out) : null));
  expect(e).toBeTruthy();
  expect(laHomeAccorcia(e)).toBe(true);
});
