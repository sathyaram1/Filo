// Il cancello dei modelli (#591) conta anche i tentativi rotti a metà: il fornitore li fa pagare per quanto il modello
// aveva già scritto. Il costo lo si chiede dopo, con l'id della generazione, come per voce e dettatura.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
require('../../src/main/services/providers/openrouter.js');
const OR_VERO = globalThis.SN_PROVIDER_OPENROUTER;

test('una risposta in streaming rotta a metà porta con sé l\'id della generazione', async () => {
  const enc = new TextEncoder();
  let letture = 0;
  const body = new ReadableStream({
    pull(controller) {
      letture++;
      if (letture === 1) controller.enqueue(enc.encode(`data: ${JSON.stringify({ id: 'gen-rotta', choices: [{ delta: { content: 'Una risposta' } }] })}\n\n`));
      else controller.error(new Error('connessione interrotta'));
    },
  });
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response(body, { status: 200 });
  try {
    await assert.rejects(
      OR_VERO.streamComplete({ apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'ciao' }], onDelta: () => {} }),
      (err) => err.generationId === 'gen-rotta',
    );
  } finally { globalThis.fetch = orig; }
});

// #1302: il fornitore che si ferma per errore mentre il modello ragionava (niente testo) fa pagare il ragionamento.
test('una risposta fermata per errore durante il ragionamento porta l\'id della generazione', async () => {
  const enc = new TextEncoder();
  const righe = [
    { id: 'gen-pensava', choices: [{ delta: { reasoning: 'Sto pensando a lungo...' } }] },
    { id: 'gen-pensava', choices: [{ delta: {}, finish_reason: 'error' }] },
  ].map((o) => `data: ${JSON.stringify(o)}\n\n`).join('');
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Blob([enc.encode(righe)]).stream(), { status: 200 });
  try {
    await assert.rejects(
      OR_VERO.streamComplete({ apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'ciao' }], onReasoning: () => {} }),
      (err) => err.status === 502 && err.generationId === 'gen-pensava',
    );
  } finally { globalThis.fetch = orig; }
});

function cancelloConFornitoreFinto({ secondoRiesce }) {
  let tentativi = 0;
  globalThis.SN_PROVIDER_OPENROUTER = {
    streamComplete: async ({ onDelta }) => {
      tentativi++;
      if (tentativi === 1 || !secondoRiesce) {
        onDelta('Una risposta lunga che si interrompe');
        const e = new Error('stream interrotto');
        e.status = 502;
        e.generationId = `gen-rotta-${tentativi}`;
        throw e;
      }
      onDelta('Risposta completa');
      return { text: 'Risposta completa', usage: { promptTokens: 1000, completionTokens: 400, costUsd: 0.004 }, servedBy: 'DeepInfra' };
    },
    lookupServedBy: async ({ generationId }) => ({ servedBy: 'DeepInfra', costUsd: generationId.startsWith('gen-rotta') ? 0.003 : null }),
  };
  delete require.cache[require.resolve('../../src/main/services/providers/index.js')];
  require('../../src/main/services/providers/index.js');
  delete require.cache[require.resolve('../../src/main/services/modelGate.js')];
  require('../../src/main/services/modelGate.js');
  const registrati = [];
  const costs = { isOverLimit: async () => false, record: async (r) => { registrati.push(Number(r.usage.costUsd) || 0); return 0; } };
  const Gate = globalThis.SN_MODEL_GATE.create({
    getSettings: async () => ({}),
    buildChain: () => [{ provider: 'openrouter', model: 'm1', apiKey: 'k' }, { provider: 'openrouter', model: 'm2', apiKey: 'k' }],
    modelFor: () => 'm1',
    costs,
    auditDelaysMs: [5, 10, 20],
  });
  return { Gate, registrati };
}

test('il tentativo rotto prima del ripiego entra nel conto del mese insieme alla risposta finale', async () => {
  const { Gate, registrati } = cancelloConFornitoreFinto({ secondoRiesce: true });
  const r = await Gate.stream({ action: 'filo_chat', messages: [{ role: 'user', content: 'x' }], onDelta: () => {}, onReset: () => {} });
  assert.equal(r.model, 'm2');
  await new Promise((ok) => setTimeout(ok, 80));
  assert.deepEqual(registrati.sort(), [0.003, 0.004]);
});

test('se tutti i tentativi si rompono il loro costo entra comunque nel conto', async () => {
  const { Gate, registrati } = cancelloConFornitoreFinto({ secondoRiesce: false });
  await assert.rejects(Gate.stream({ action: 'filo_chat', messages: [{ role: 'user', content: 'x' }], onDelta: () => {}, onReset: () => {} }));
  await new Promise((ok) => setTimeout(ok, 80));
  assert.deepEqual(registrati, [0.003, 0.003]);
});
