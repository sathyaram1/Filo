// Il cancello dei modelli (#591) conta anche i tentativi rotti a metà: il fornitore li fa pagare per quanto il modello
// aveva già scritto. Il costo lo si chiede dopo, con l'id della generazione, come per voce e dettatura.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
require('../../src/shared/chatErrors.js');
require('../../src/shared/lunghezzaRisposte.js');
require('../../src/main/services/providers/openrouter.js');
const OR_VERO = globalThis.SN_PROVIDER_OPENROUTER;
const CE = globalThis.SN_CHAT_ERRORS;
const LR = globalThis.SN_LUNGHEZZA_RISPOSTE;

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

// #1302 — i tetti di partenza reggono un modello che ragiona; un tetto finito nel ragionamento si dice a parte, e
// «Continua» riparte con un tetto più largo su ogni superficie (la richiesta di seguito è la stessa ovunque).
test('i tetti di partenza lasciano spazio al ragionamento a sforzo alto', () => {
  assert.ok(LR.DI_SERIE.conversazioni >= 65536);
  assert.ok(LR.DI_SERIE.testi >= 65536);
  assert.ok(LR.DI_SERIE.brevi >= 32768);
});

test('un tetto speso quasi tutto nel ragionamento ha la sua nota, e chi legge come dati lo sa', () => {
  assert.equal(CE.motivoFine('length', { reasoningTokens: 15000, completionTokens: 16384 }), 'tetto_ragionamento');
  assert.equal(CE.motivoFine('length', { reasoningTokens: 200, completionTokens: 16384 }), 'length');
  assert.equal(CE.motivoFine('length', {}), 'length');
  assert.equal(CE.motivoFine('stop', { reasoningTokens: 15000, completionTokens: 16000 }), 'stop');
  assert.ok(CE.troncata('tetto_ragionamento'));
  assert.match(CE.rispostaInterrotta('tetto_ragionamento'), /ragionando/);
  assert.ok(CE.eFraseInterrotta(CE.rispostaInterrotta('tetto_ragionamento')));
  assert.match(CE.erroreTagliata('tetto_ragionamento').message, /ragionando/);
});

test('il fornitore dice «tetto nel ragionamento» quando l\'uso lo mostra', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: 'Comincio a' }, finish_reason: 'length' }],
    usage: { prompt_tokens: 50, completion_tokens: 16384, completion_tokens_details: { reasoning_tokens: 16000 } },
  }), { status: 200 });
  try {
    const r = await OR_VERO.complete({ apiKey: 'k', model: 'acme/m', messages: [{ role: 'user', content: 'difficile' }], maxTokens: 16384 });
    assert.equal(r.finishReason, 'tetto_ragionamento');
  } finally { globalThis.fetch = orig; }
});

// Le chat ricevono in streaming, e l'uso arriva in un pezzo a parte dopo quello che dice «length».
test('anche in streaming il tetto speso ragionando si riconosce dall\'uso', async () => {
  const enc = new TextEncoder();
  const flusso = (reasoning) => [
    { id: 'gen-s', choices: [{ delta: { reasoning: 'Ci penso a lungo...' } }] },
    { id: 'gen-s', choices: [{ delta: { content: 'Comincio a' } }] },
    { id: 'gen-s', choices: [{ delta: {}, finish_reason: 'length' }] },
    { id: 'gen-s', choices: [], usage: { prompt_tokens: 50, completion_tokens: 16384, completion_tokens_details: { reasoning_tokens: reasoning } } },
  ].map((o) => `data: ${JSON.stringify(o)}\n\n`).join('') + 'data: [DONE]\n\n';
  const orig = globalThis.fetch;
  try {
    for (const [reasoning, atteso] of [[16000, 'tetto_ragionamento'], [300, 'length']]) {
      globalThis.fetch = async () => new Response(new Blob([enc.encode(flusso(reasoning))]).stream(), { status: 200 });
      const r = await OR_VERO.streamComplete({ apiKey: 'k', model: 'acme/m', messages: [{ role: 'user', content: 'difficile' }], maxTokens: 16384, onDelta: () => {}, onReasoning: () => {} });
      assert.equal(r.text, 'Comincio a');
      assert.equal(r.finishReason, atteso);
    }
  } finally { globalThis.fetch = orig; }
});

function cancelloColTetto() {
  const tetti = [];
  globalThis.SN_PROVIDER_OPENROUTER = {
    complete: async ({ maxTokens }) => { tetti.push(maxTokens); return { text: 'ok', usage: {} }; },
    streamComplete: async ({ maxTokens }) => { tetti.push(maxTokens); return { text: 'ok', usage: {} }; },
    lookupServedBy: async () => null,
  };
  delete require.cache[require.resolve('../../src/main/services/providers/index.js')];
  require('../../src/main/services/providers/index.js');
  delete require.cache[require.resolve('../../src/main/services/modelGate.js')];
  require('../../src/main/services/modelGate.js');
  const catena = [{ provider: 'openrouter', model: 'm1', apiKey: 'k', maxTokens: 16384 }];
  const Gate = globalThis.SN_MODEL_GATE.create({
    getSettings: async () => ({}), buildChain: () => catena, modelFor: () => 'm1',
    costs: { isOverLimit: async () => false, record: async () => 0 }, auditDelaysMs: [5],
  });
  return { Gate, tetti, catena };
}

test('«Continua» riparte col tetto doppio, in streaming e no; una domanda qualunque col suo', async () => {
  const { Gate, tetti, catena } = cancelloColTetto();
  const seguito = [{ role: 'user', content: 'domanda' }, { role: 'assistant', content: 'mezza' }, { role: 'user', content: CE.CHIEDI_SEGUITO }];
  await Gate.stream({ action: 'filo_chat', messages: seguito, onDelta: () => {} });
  await Gate.complete({ action: 'help', messages: seguito });
  await Gate.stream({ action: 'filo_chat', messages: [{ role: 'user', content: [{ type: 'text', text: `Contesto\n${CE.CHIEDI_SEGUITO_HOME}` }] }, { role: 'tool', content: 'esito' }], onDelta: () => {} });
  await Gate.complete({ action: 'help', messages: [{ role: 'user', content: 'una domanda nuova' }] });
  assert.deepEqual(tetti, [32768, 32768, 32768, 16384]);
  assert.equal(catena[0].maxTokens, 16384, 'la catena di chi chiama non cambia');
  assert.equal(LR.perSeguito(LR.LIMITI[1]), LR.LIMITI[1]);
});
