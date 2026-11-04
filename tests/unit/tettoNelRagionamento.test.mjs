// #1302 — i tetti di partenza reggono un modello che ragiona; un tetto finito nel ragionamento si dice a parte, e
// «Continua» riparte con un tetto più largo su ogni superficie (la richiesta di seguito è la stessa ovunque).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
require('../../src/shared/chatErrors.js');
require('../../src/shared/lunghezzaRisposte.js');
require('../../src/main/services/providers/openrouter.js');
const CE = globalThis.SN_CHAT_ERRORS;
const LR = globalThis.SN_LUNGHEZZA_RISPOSTE;
const OR_VERO = globalThis.SN_PROVIDER_OPENROUTER;

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

function cancello() {
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
  const { Gate, tetti, catena } = cancello();
  const seguito = [{ role: 'user', content: 'domanda' }, { role: 'assistant', content: 'mezza' }, { role: 'user', content: CE.CHIEDI_SEGUITO }];
  await Gate.stream({ action: 'filo_chat', messages: seguito, onDelta: () => {} });
  await Gate.complete({ action: 'help', messages: seguito });
  await Gate.stream({ action: 'filo_chat', messages: [{ role: 'user', content: [{ type: 'text', text: `Contesto\n${CE.CHIEDI_SEGUITO_HOME}` }] }, { role: 'tool', content: 'esito' }], onDelta: () => {} });
  await Gate.complete({ action: 'help', messages: [{ role: 'user', content: 'una domanda nuova' }] });
  assert.deepEqual(tetti, [32768, 32768, 32768, 16384]);
  assert.equal(catena[0].maxTokens, 16384, 'la catena di chi chiama non cambia');
  assert.equal(LR.perSeguito(LR.LIMITI[1]), LR.LIMITI[1]);
});
