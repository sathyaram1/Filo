// I contatori delle chiamate ai modelli (#1464): le fasce di contesto, cache, ragionamento e uscita, i ripieghi, la
// spesa e gli adattamenti, da quello che il router risponde fino al numero nell'ora. La spedizione e il servizio con
// disco e orologio finti: tests/unit/contatoriInvio.test.mjs; la forma accettata dalle regole: firestoreRulesContatori.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['constants', 'tasti', 'modelUsage', 'wallet', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'contatoriGiornalieri', 'chatErrors']) {
  require(join(ROOT, 'src', 'shared', `${f}.js`));
}
require(join(ROOT, 'src', 'main', 'services', 'modelGate.js'));
require(join(ROOT, 'src', 'main', 'services', 'providers', 'openrouter.js'));
const C = globalThis.SN_CONTATORI;
const A = globalThis.SN_CONST.ACTIONS;
const OR = globalThis.SN_PROVIDER_OPENROUTER;
beforeEach(() => OR.forgetReasoningRefusals());

const M = 'deepseek/deepseek-v4-pro';
const doc = (ora) => C.documentoChiamate({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-15T09', app: '0.2.249', os: 'win', dati: ora });
const voci = (d, campo, f) => (d[campo][f] ? C.leggiModelli(campo, d[campo][f]).map((x) => `${x.modello}|${x.resto}|${x.n}`) : []);

test('ogni misura va nella sua fascia, e quella senza dato non entra', () => {
  const ora = C.oraVuota();
  const chat = (c) => C.registraChiamata(ora, 'filo-chat', { modello: M, ...c });
  chat({ ingresso: 2048, cacheLetti: 0, cacheDetta: true, ragionamento: 0, uscita: 256, fine: 'stop', tentativo: 1 });
  chat({ ingresso: 2049, cacheLetti: 513, cacheDetta: true, ragionamento: 1025, uscita: 257, fine: 'length', tentativo: 2, ricominciata: true });
  chat({ ingresso: 200000, cacheLetti: 200000, cacheDetta: true, ragionamento: null, uscita: 20000, fine: 'content_filter', tentativo: 7 });
  chat({ ingresso: 10000, cacheDetta: false, uscita: 5000, fine: null, tentativo: 3 });
  chat({ ingresso: 10000, cacheLetti: 5000, cacheDetta: true, uscita: 10, fine: 'tool_calls', tentativo: 4, ragionamentoTolto: true });
  // Una voce senza token né fine (la lettura ad alta voce): nessuna misura, se non la spesa.
  C.registraChiamata(ora, 'tts', { modello: 'openai/gpt-4o-mini-tts', ingresso: null, uscita: null, spesa: { usd: 0.0002, origine: 'router' } });
  const d = doc(ora);
  assert.deepEqual(voci(d, 'contesto', 'filo-chat'), [`${M}|t2k|1`, `${M}|t8k|1`, `${M}|oltre|1`, `${M}|t16k|2`]);
  assert.deepEqual(C.leggiModelli('cache', d.cache['filo-chat']).map((x) => [x.resto, x.n]), [['zero', 1], ['q50', 2], ['q100', 1], ['nd', 1]],
    'uno zero detto, un quarto e un capello, tutto, non detto, metà');
  assert.deepEqual(C.leggiModelli('ragionamento', d.ragionamento['filo-chat']).map((x) => [x.resto, x.n]), [['r0', 1], ['r4k', 1], ['nd', 1]],
    'il ragionamento entra solo quando la risposta lo porta (anche come «non detto»)');
  assert.deepEqual(C.leggiModelli('uscita', d.uscita['filo-chat']).map((x) => [x.resto, x.n]),
    [['o256|stop', 1], ['o1k|length', 1], ['oltre|filtro', 1], ['o16k|altro', 1], ['o256|tool_calls', 1]]);
  assert.deepEqual(C.leggiModelli('ripieghi', d.ripieghi['filo-chat']).map((x) => [x.resto, x.n]),
    [['t1|no', 1], ['t2|si', 1], ['t4_oltre|no', 2], ['t3|no', 1]]);
  assert.deepEqual(voci(d, 'adattamenti', 'filo-chat'), [`${M}|ragionamento_tolto|1`]);
  assert.deepEqual(voci(d, 'spesa', 'tts'), ['openai/gpt-4o-mini-tts|router|20']);
  for (const c of ['contesto', 'cache', 'ragionamento', 'uscita', 'ripieghi']) assert.equal(d[c].tts, undefined, `${c}: la voce non ha quel dato`);
  assert.equal(C.validaChiamate(d).ok, true, C.validaChiamate(d).motivo);
});

test('la spesa si somma con la virgola e si arrotonda quando parte, per modello e origine; un costo nullo non entra', () => {
  const ora = C.oraVuota();
  for (let i = 0; i < 100; i++) C.registraSpesa(ora, 'archive-embed', 'openai/text-embedding-3-small', 'router', 0.000002);
  C.registraSpesa(ora, 'filo-chat', M, 'stima', 0.0123456);
  C.registraSpesa(ora, 'filo-chat', M, 'tardiva', 0.001);
  assert.equal(C.registraSpesa(ora, 'filo-chat', M, 'router', 0), false);
  assert.equal(C.registraSpesa(ora, 'filo-chat', M, 'regalo', 1), false);
  assert.equal(C.registraSpesa(ora, 'filo-chat', M, 'router', -3), false);
  const d = doc(ora);
  assert.deepEqual(voci(d, 'spesa', 'archive-embed'), ['openai/text-embedding-3-small|router|20'], 'cento chiamate da due decimillesimi di centesimo non si perdono');
  assert.deepEqual(voci(d, 'spesa', 'filo-chat'), [`${M}|stima|1235`, `${M}|tardiva|100`]);
});

test('le chiamate per uso stanno in cinque fasce', () => {
  const ora = C.oraVuota();
  for (const n of [1, 2, 3, 5, 6, 12, 13, 400]) C.registraChiamate(ora, 'filo-chat', n);
  assert.equal(C.registraChiamate(ora, 'filo-chat', 0), false);
  assert.equal(C.registraChiamate(ora, 'una-funzione-che-non-esiste', 1), false);
  assert.deepEqual(C.leggiChiamate(doc(ora).chiamate['filo-chat']), { c1: 1, c2: 1, c3_5: 2, c6_12: 2, oltre: 2 });
});

test('oltre il tetto dell’ora il modello diventa «altro»: il conto resta intero e un nome strano non esce', () => {
  const ora = C.oraVuota();
  for (let i = 0; i < C.TETTO_MODELLI_ORA + 20; i++) C.registraChiamata(ora, 'help', { modello: `prova/modello-${i}`, ingresso: 100 });
  C.registraChiamata(ora, 'help', { modello: 'Il Mio Modello Preferito!', ingresso: 100 });
  C.registraChiamata(ora, 'help', { modello: 'prova/modello-3', ingresso: 100 });
  const l = C.leggiModelli('contesto', doc(ora).contesto.help);
  assert.equal(l.filter((x) => x.modello !== 'altro').length, C.TETTO_MODELLI_ORA);
  assert.equal(l.find((x) => x.modello === 'altro').n, 21, 'i venti in più e il nome scritto a mano');
  assert.equal(l.find((x) => x.modello === 'prova/modello-3').n, 2, 'un modello già nell’ora continua a contare');
  assert.equal(l.reduce((a, x) => a + x.n, 0), C.TETTO_MODELLI_ORA + 22);
  // Un disco manomesso non scavalca il tetto né gli elenchi chiusi.
  ora.contesto.help['un testo qualunque|t2k'] = 4;
  ora.contesto.help[`${M}|t3k`] = 4;
  ora.contesto['appunti di mario'] = { [`${M}|t2k`]: 1 };
  const d = doc(ora);
  assert.equal(C.validaChiamate(d).ok, true, C.validaChiamate(d).motivo);
  assert.equal(d.contesto['appunti di mario'], undefined);
  assert.ok(!/t3k|un testo/.test(d.contesto.help));
});

// ── Il router: i numeri che la risposta porta ─────────────────────────────
function withFetch(impl, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = orig; });
}
function sse(events) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) { for (const e of events) c.enqueue(enc.encode(`data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`)); c.close(); },
  });
}
const usoRouter = (extra) => ({ prompt_tokens: 12000, completion_tokens: 900, cost: 0.004, ...extra });

for (const metodo of ['complete', 'streamComplete']) {
  const risposta = (usage) => (metodo === 'complete'
    ? new Response(JSON.stringify({ provider: 'DeepInfra', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage }), { status: 200 })
    : new Response(sse([{ provider: 'DeepInfra', choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }, { choices: [], usage }, '[DONE]']), { status: 200 }));
  const chiama = (extra) => OR[metodo]({ apiKey: 'k', model: M, messages: [{ role: 'user', content: 'ciao' }], ...(extra || {}) });

  test(`${metodo}: ragionamento e cache detti, o non detti, arrivano distinti`, async () => {
    const detti = await withFetch(async () => risposta(usoRouter({
      prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 700 },
    })), () => chiama());
    assert.equal(detti.usage.cacheDetta, true, 'uno zero detto è uno zero');
    assert.equal(detti.usage.cachedPromptTokens, 0);
    assert.equal(detti.usage.reasoningTokens, 700);
    assert.equal(detti.ragionamentoTolto, undefined);
    const muti = await withFetch(async () => risposta(usoRouter()), () => chiama());
    assert.equal(muti.usage.cacheDetta, false, 'senza il campo l’host non l’ha detto');
    assert.equal(muti.usage.reasoningTokens, null);
  });

  test(`${metodo}: la richiesta rifatta senza ragionamento lo dice, quella che parte già senza no`, async () => {
    const tools = [{ type: 'function', function: { name: 'CERCA_WEB', parameters: { type: 'object', properties: {} } } }];
    const rifiuta = async (_u, opts) => (JSON.parse(opts.body).reasoning
      ? new Response(JSON.stringify({ error: { code: 404, message: 'No endpoints found that can handle the requested parameters.' } }), { status: 404 })
      : risposta(usoRouter()));
    const extra = { tools, reasoning: 'medium', ...(metodo === 'streamComplete' ? { onReasoning: () => {} } : {}) };
    await withFetch(rifiuta, async () => {
      assert.equal((await chiama(extra)).ragionamentoTolto, true);
      assert.equal((await chiama(extra)).ragionamentoTolto, undefined, 'il rifiuto ricordato non costa una richiesta in più');
    });
  });
}

// ── La catena: quale tentativo ha risposto, e se la risposta è ricominciata ─────
test('la catena dice quale tentativo ha risposto e se la risposta è ricominciata a metà', async () => {
  require(join(ROOT, 'src', 'main', 'services', 'providers', 'index.js'));
  const P = globalThis.SN_PROVIDERS;
  const prima = globalThis.SN_PROVIDER_FINTO;
  let n = 0;
  globalThis.SN_PROVIDER_FINTO = {
    complete: async ({ model }) => { if (model === 'a/uno') throw Object.assign(new Error('rotto'), { status: 400 }); return { text: 'ok' }; },
    streamComplete: async ({ model, onDelta }) => {
      n += 1;
      if (model === 'a/uno') { onDelta('mez'); throw Object.assign(new Error('rotto'), { status: 400 }); }
      onDelta('ok');
      return { text: 'ok' };
    },
  };
  try {
    const catena = [{ provider: 'finto', model: 'a/uno' }, { provider: 'finto', model: 'a/due' }];
    const c = await P.completeWithFallback({ attempts: catena, messages: [] });
    assert.deepEqual([c.model, c.tentativo], ['a/due', 2]);
    const s = await P.streamCompleteWithFallback({ attempts: catena, messages: [], onDelta: () => {}, onReset: () => {} });
    assert.deepEqual([s.model, s.tentativo, s.ricominciata], ['a/due', 2, true]);
    const pulita = await P.streamCompleteWithFallback({ attempts: catena.slice(1), messages: [], onDelta: () => {} });
    assert.deepEqual([pulita.tentativo, pulita.ricominciata], [1, false]);
    assert.equal(n, 3);
  } finally {
    globalThis.SN_PROVIDER_FINTO = prima;
  }
});

// ── Il cancello: i numeri del tentativo che ha servito vanno al contatore ─────
function cancello({ provider, pricing = null, audit = [0] } = {}) {
  const ricevute = [];
  const tardive = [];
  const contatore = {
    apri: (action) => ({
      visto() {}, errore() {}, fine() {},
      chiamata: (info) => ricevute.push({ action, info }),
      tardiva: (modello, usd) => tardive.push({ action, modello, usd }),
    }),
  };
  globalThis.SN_PROVIDERS = provider;
  const G = globalThis.SN_MODEL_GATE.create({
    getSettings: async () => ({ pricing: pricing ? { [M]: pricing } : {} }),
    buildChain: () => [{ provider: 'finto', model: 'a/uno' }, { provider: 'finto', model: M }],
    modelFor: () => 'x',
    costs: { isOverLimit: async () => false, record: async () => 0, estimateCostEur: globalThis.SN_COSTS_STIMA },
    contatore: () => contatore,
    auditDelaysMs: audit,
  });
  return { G, ricevute, tardive };
}
// La stima del listino com'è in costTracker.js (in dollari con un cambio di 1).
globalThis.SN_COSTS_STIMA = ({ usage, pricing, usdToEur }) => {
  const d = Number(usage && usage.costUsd);
  if (d > 0) return d * usdToEur;
  return (((usage.promptTokens || 0) / 1e6) * pricing.input + ((usage.completionTokens || 0) / 1e6) * pricing.output) * usdToEur;
};

test('il cancello passa al contatore i numeri della risposta, mai il testo', async () => {
  const usage = { promptTokens: 30000, completionTokens: 2000, cachedPromptTokens: 24000, cacheDetta: true, reasoningTokens: 5000, costUsd: 0.02 };
  const { G, ricevute } = cancello({
    provider: {
      getProvider: () => ({}),
      streamCompleteWithFallback: async ({ onDelta }) => {
        onDelta('segreto');
        return { text: 'segreto', model: M, tentativo: 2, ricominciata: true, ragionamentoTolto: true, finishReason: 'tool_calls', usage };
      },
    },
  });
  await G.stream({ action: A.FILO_CHAT, messages: [], onDelta: () => {} });
  assert.equal(ricevute.length, 1);
  assert.deepEqual(ricevute[0].info, {
    modello: M, ingresso: 30000, cacheLetti: 24000, cacheDetta: true, ragionamento: 5000, uscita: 2000, fine: 'tool_calls',
    tentativo: 2, ricominciata: true, ragionamentoTolto: true, spesa: { usd: 0.02, origine: 'router' },
  });
  assert.ok(!JSON.stringify(ricevute).includes('segreto'));
  const ora = C.oraVuota();
  C.registraChiamata(ora, 'filo-chat', ricevute[0].info);
  const d = doc(ora);
  assert.deepEqual(voci(d, 'cache', 'filo-chat'), [`${M}|q100|1`]);
  assert.deepEqual(voci(d, 'ripieghi', 'filo-chat'), [`${M}|t2|si|1`]);
  assert.deepEqual(voci(d, 'spesa', 'filo-chat'), [`${M}|router|2000`]);
  delete globalThis.SN_PROVIDERS;
});

test('senza costo del router la spesa è la stima del listino; senza token detti non si misura il contesto', async () => {
  const { G, ricevute } = cancello({
    pricing: { input: 0.4, output: 0.8 },
    provider: {
      getProvider: () => ({}),
      completeWithFallback: async () => ({ text: 'x', model: M, tentativo: 1, finishReason: 'stop', usage: { promptTokens: 1000000, completionTokens: 500000, cacheDetta: false, reasoningTokens: null } }),
    },
  });
  await G.complete({ action: A.EXPLAIN, messages: [] });
  assert.deepEqual(ricevute[0].info.spesa, { usd: 0.8, origine: 'stima' });
  const vuota = cancello({
    provider: { getProvider: () => ({}), completeWithFallback: async () => ({ text: 'x', model: M, tentativo: 1, finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } }) },
  });
  await vuota.G.complete({ action: A.EXPLAIN, messages: [] });
  const info = vuota.ricevute[0].info;
  assert.deepEqual([info.ingresso, info.uscita, info.ragionamento, info.spesa], [null, null, undefined, null]);
  delete globalThis.SN_PROVIDERS;
});

test('la voce paga dopo: il costo arriva al contatore come spesa tardiva, anche a chiamata chiusa', async () => {
  const P = {
    synthesizeSpeech: async () => ({ audioBase64: 'AA', generationId: 'gen-1' }),
    lookupServedBy: async () => ({ servedBy: 'OpenAI', costUsd: 0.0007 }),
  };
  const { G, ricevute, tardive } = cancello({ provider: { getProvider: () => P } });
  await G.call({ action: A.TTS, method: 'synthesizeSpeech', attempt: { provider: 'finto', model: 'openai/gpt-4o-mini-tts' }, args: { text: 'ciao' } });
  assert.equal(ricevute.length, 1);
  assert.equal(ricevute[0].info.spesa, null, 'il costo non c’è ancora');
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(tardive, [{ action: A.TTS, modello: 'openai/gpt-4o-mini-tts', usd: 0.0007 }]);
  delete globalThis.SN_PROVIDERS;
});

test('i classificatori: una misura per richiesta servita, col tentativo della catena', async () => {
  require(join(ROOT, 'src', 'shared', 'codaAdattiva.js'));
  const P = {
    decisions: async ({ model }) => {
      if (model === 'a/uno') throw Object.assign(new Error('giù'), { status: 400 });
      return { answers: { a: 1 }, model, usage: { promptTokens: 3000, completionTokens: 2, cachedPromptTokens: 0, cacheDetta: true, costUsd: 0.0001 } };
    },
  };
  const { G, ricevute } = cancello({ provider: { getProvider: () => P } });
  const r = await G.decideAll({ action: A.FILO_TAB_TRIAGE, requests: [{ state: 'a', questions: {} }, { state: 'b', questions: {} }], parallel: 2 });
  assert.equal(r.model, M);
  assert.equal(ricevute.length, 1, 'un giro, una consegna');
  assert.equal(ricevute[0].info.length, 2);
  for (const i of ricevute[0].info) {
    assert.deepEqual([i.modello, i.ingresso, i.tentativo, i.fine, i.ragionamento, i.spesa.origine], [M, 3000, 2, undefined, undefined, 'router']);
  }
  delete globalThis.SN_PROVIDERS;
});
