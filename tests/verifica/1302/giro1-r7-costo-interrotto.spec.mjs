// Verifica #1302, giro 1, rilievo 7: una risposta che il fornitore interrompe per errore dopo aver ragionato e
// cominciato a scrivere va nei conti col suo costo, chiesto col riferimento della generazione. Rete finta.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(join(process.cwd(), 'tests', 'unit', 'x.mjs'));
for (const f of ['constants', 'chatErrors', 'lunghezzaRisposte']) require(`../../src/shared/${f}.js`);
require('../../src/main/services/providers/openrouter.js');
require('../../src/main/services/providers/index.js');
require('../../src/main/services/modelGate.js');

const enc = new TextEncoder();
const sse = (objs) => new Blob([enc.encode(objs.map((o) => `data: ${JSON.stringify(o)}\n\n`).join(''))]).stream();

test('r7 ragiona, scrive qualche parola, poi errore del fornitore: il costo pagato si registra', async () => {
  const orig = globalThis.fetch;
  const lookups = [];
  globalThis.fetch = async (url) => {
    url = String(url);
    if (url.includes('/generation')) {
      lookups.push(new URL(url).searchParams.get('id'));
      return new Response(JSON.stringify({ data: { provider_name: 'DeepInfra', total_cost: 0.003 } }), { status: 200 });
    }
    return new Response(sse([
      { id: 'g3', choices: [{ delta: { reasoning: 'penso a lungo' } }] },
      { id: 'g3', choices: [{ delta: { content: 'Ecco la mia ' } }] },
      { id: 'g3', error: { code: 502, message: 'Provider disconnected' }, choices: [{ delta: { content: '' }, finish_reason: 'error' }] },
    ]), { status: 200 });
  };
  const registrati = [];
  const avvisi = console.warn;
  console.warn = () => {};
  try {
    const Gate = globalThis.SN_MODEL_GATE.create({
      getSettings: async () => ({}),
      buildChain: () => [{ provider: 'openrouter', model: 'm1', apiKey: 'k' }],
      modelFor: () => 'm1',
      costs: { isOverLimit: async () => false, record: async (r) => { registrati.push(r.usage && r.usage.costUsd); return 0; } },
      auditDelaysMs: [5, 10, 20],
    });
    try {
      await Gate.stream({ action: 'filo_chat', messages: [{ role: 'user', content: 'x' }], onDelta: () => {}, onReset: () => {} });
    } catch (_) { /* un errore va bene: conta che il costo arrivi */ }
    await new Promise((ok) => setTimeout(ok, 200));
  } finally { globalThis.fetch = orig; console.warn = avvisi; }
  expect(lookups).toContain('g3');
  expect(registrati.some((c) => Number(c) > 0)).toBe(true);
});
