// I punti di cache della chat (#1412, SPEC-CONTESTO § La richiesta): dove stanno, che solo i modelli Anthropic li
// ricevono, che il testo mandato resta identico carattere per carattere, e che i token scritti in cache si registrano.
// Senza i punti, su Haiku 5.5 ogni messaggio ripaga strumenti e parte fissa (~37 000 token) e la cronologia dice «riuso 0%».

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/capabilities.js');
require('../../src/shared/constants.js');
require('../../src/shared/contenutoEsterno.js');
require('../../src/shared/filoContesto.js');
require('../../src/shared/guardianoStatico.js');
require('../../src/main/services/providers/openrouter.js');
require('../../src/main/services/providers/index.js');
require('../../src/main/services/modelGate.js');

const C = globalThis.SN_CONST;
const FC = globalThis.SN_FILO_CONTESTO;
const OR = globalThis.SN_PROVIDER_OPENROUTER;
const { ACTIONS, PROMPTS } = C;
const HAIKU = 'anthropic/claude-haiku-5.5';
const APERTO = 'deepseek/deepseek-v4-pro';

const CAPS = globalThis.SN_CAPABILITIES.renderIndexForPrompt();
const BASE = { capacita: CAPS, sistema: 'linux', profilo: 'Si chiama Mario.', stato: 'Data: martedì 21 ottobre 2026, 09:14', files: '(nessuno)' };
const TRATTO = [
  { role: 'user', content: '[lun 20/10 10:02 · chat ab12] ciao' },
  { role: 'assistant', content: 'Ciao Mario!', reasoning_details: [{ type: 'reasoning.text', text: 'saluto', signature: 'firma' }] },
  { role: 'user', content: '[lun 20/10 10:05 · chat ab12] apri wikipedia' },
  { role: 'assistant', content: 'Aperta.' },
];
const DOMANDA = { role: 'user', content: '[mar 21/10 09:14 · chat ab12] che tempo fa domani?' };
const GIRO = [
  { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'CERCA_WEB', arguments: '{"q":"meteo"}' } }] },
  { role: 'tool', tool_call_id: 'c1', content: 'Domani sole, 18 gradi.' },
];

// La stessa richiesta che compone il main (handlers.js, ramo FILO_CHAT col tratto), stile dell'utente compreso.
function richiestaChat({ onboarding = '', tratto = TRATTO, giro = [] } = {}) {
  const p = { ...BASE, onboarding, onboardingTurns: 1, onboardingMax: 5 };
  const messages = [
    ...FC.assembla({
      tratto: [{ role: 'system', content: PROMPTS.filoChatStatic(p) + PROMPTS.filoChatOnboarding(p) }, ...tratto],
      scheda: [],
      contesto: FC.coda({ contesto: PROMPTS.filoChatContext({ ...p, onboarding: '' }), chatCorrente: 'ab12cd34' }),
      domanda: DOMANDA,
    }),
    ...giro,
  ];
  return C.injectAgentStyle(messages, ACTIONS.FILO_CHAT, 'Rispondi in modo asciutto.');
}

const indiceCoda = (msgs) => msgs.findIndex((m) => m.role === 'user' && String(m.content).startsWith(FC.INTESTAZIONE_CODA));
const testoDi = (m) => (typeof m.content === 'string' ? m.content : m.content.map((p) => p.text || '').join(''));
const conPunto = (m) => Array.isArray(m.content) && m.content.some((p) => p && p.cache_control);

test('gli inizi delle parti che cambiano sono quelli che i prompt scrivono davvero, e la parte fissa non ne contiene', () => {
  const [accoglienza, contesto] = C.INIZI_VARIABILI_CHAT;
  assert.ok(PROMPTS.filoChatOnboarding({ onboarding: '- scopri il nome' }).startsWith(accoglienza));
  assert.ok(PROMPTS.filoChatContext({}).startsWith(contesto));
  assert.ok(FC.coda({ contesto: 'x' }).startsWith(FC.INTESTAZIONE_CODA));
  const fissa = PROMPTS.filoChatStatic(BASE);
  for (const inizio of [...C.INIZI_VARIABILI_CHAT, FC.INTESTAZIONE_CODA]) assert.ok(!fissa.includes(inizio), `la parte fissa contiene ${inizio}`);
});

test('chat: un punto a fine parte fissa (un\'ora), uno a fine tratto, uno sull\'ultimo messaggio', () => {
  const msgs = richiestaChat();
  const piano = FC.pianoDellaCache(ACTIONS.FILO_CHAT, msgs);
  assert.deepEqual(piano.punti, [
    { indice: 0, durata: '1h' },
    { indice: indiceCoda(msgs) - 1 },
    { indice: msgs.length - 1 },
  ]);
  assert.equal(msgs[indiceCoda(msgs) - 1].content, 'Aperta.');
  assert.equal(msgs[msgs.length - 1], DOMANDA);
});

test('accoglienza in corso: il punto della parte fissa cade dove comincia l\'intervista, che cambia a ogni messaggio', () => {
  const msgs = richiestaChat({ onboarding: '- scopri il nome' });
  const [sys] = FC.pianoDellaCache(ACTIONS.FILO_CHAT, msgs).punti;
  const testo = msgs[0].content;
  assert.equal(sys.caratteri, testo.indexOf(C.INIZI_VARIABILI_CHAT[0]));
  assert.ok(testo.slice(0, sys.caratteri).includes('Rispondi in modo asciutto.'), 'lo stile dell\'utente sta nella parte fissa');
  assert.ok(!testo.slice(0, sys.caratteri).includes('scopri il nome'));
});

test('richiesta senza filo: STATO e ora restano fuori dalla parte in cache', () => {
  const p = { ...BASE, onboarding: '' };
  const msgs = C.injectAgentStyle([{ role: 'system', content: PROMPTS.filoChat(p) }, DOMANDA], ACTIONS.FILO_CHAT, 'Asciutto.');
  const piano = FC.pianoDellaCache(ACTIONS.FILO_CHAT, msgs);
  const fissa = msgs[0].content.slice(0, piano.punti[0].caratteri);
  assert.ok(!fissa.includes('09:14') && !fissa.includes('Mario'), 'nella parte in cache è finito un dato che cambia');
  assert.ok(msgs[0].content.slice(piano.punti[0].caratteri).startsWith(C.INIZI_VARIABILI_CHAT[1]));
  assert.deepEqual(piano.punti.slice(1), [{ indice: 1 }]);
});

test('i giri di strumenti spostano l\'ultimo punto sull\'esito; un messaggio vuoto non prende mai un punto', () => {
  const msgs = richiestaChat({ giro: GIRO, tratto: [...TRATTO, { role: 'assistant', content: '   ' }] });
  const piano = FC.pianoDellaCache(ACTIONS.FILO_CHAT, msgs);
  assert.equal(piano.punti[1].indice, indiceCoda(msgs) - 2, 'il tratto finisce con una risposta vuota: il punto va su quella prima');
  assert.equal(piano.punti[2].indice, msgs.length - 1);
  assert.equal(msgs[msgs.length - 1].role, 'tool');
});

test('le altre funzioni non hanno piano: un prompt che cambia tutto pagherebbe scritture mai rilette', () => {
  assert.equal(FC.pianoDellaCache(ACTIONS.HELP, [{ role: 'system', content: 'x'.repeat(5000) }, DOMANDA]), null);
  assert.equal(FC.pianoDellaCache(ACTIONS.FILO_LESSON, [{ role: 'user', content: 'lezione' }]), null);
  assert.equal(FC.pianoDellaCache(ACTIONS.FILO_CHAT, []), null);
});

function sse(events) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      c.enqueue(enc.encode('data: [DONE]\n\n'));
      c.close();
    },
  });
}

async function corpiDi(fn, risposte) {
  const corpi = [];
  const orig = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (url, opts) => {
    corpi.push(JSON.parse(opts.body));
    const r = risposte[Math.min(n++, risposte.length - 1)];
    return typeof r === 'function' ? r() : r;
  };
  try { await fn(); } finally { globalThis.fetch = orig; }
  return corpi;
}

const flusso = (usage) => ({
  ok: true, status: 200,
  body: sse([{ id: 'gen-1', provider: 'Anthropic', choices: [{ delta: { content: 'Sole.' } }] }, { provider: 'Anthropic', choices: [{ delta: {}, finish_reason: 'stop' }], usage }]),
});

test('Anthropic: i punti arrivano nel corpo come cache_control, e il testo mandato è identico', async () => {
  const msgs = richiestaChat({ onboarding: '- scopri il nome', giro: GIRO });
  const cache = FC.pianoDellaCache(ACTIONS.FILO_CHAT, msgs);
  let r;
  const [corpo] = await corpiDi(async () => {
    r = await OR.streamComplete({ apiKey: 'k', model: HAIKU, messages: msgs, cache, tools: [{ type: 'function', function: { name: 'CERCA_WEB', parameters: {} } }] });
  }, [flusso({ prompt_tokens: 41000, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 38500 } })]);

  assert.equal(corpo.messages.length, msgs.length, 'nessun messaggio aggiunto o tolto');
  corpo.messages.forEach((m, i) => assert.equal(testoDi(m), testoDi(msgs[i]), `testo cambiato nel messaggio ${i}`));
  assert.deepEqual(corpo.messages[0].content[0].cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.ok(corpo.messages[0].content[1].text.startsWith(C.INIZI_VARIABILI_CHAT[0]) && !corpo.messages[0].content[1].cache_control);
  const segnati = corpo.messages.map((m, i) => (conPunto(m) ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(segnati, [0, indiceCoda(msgs) - 1, msgs.length - 1]);
  assert.deepEqual(corpo.messages.at(-1).content, [{ type: 'text', text: 'Domani sole, 18 gradi.', cache_control: { type: 'ephemeral' } }]);
  assert.equal(corpo.messages.at(-1).tool_call_id, 'c1');
  assert.deepEqual(corpo.messages[2].reasoning_details, TRATTO[1].reasoning_details, 'il ragionamento rimandato resta intatto');
  assert.deepEqual(corpo.provider.only, ['anthropic', 'claude-on-aws'], 'Claude lo serve solo Anthropic (#904)');
  // Il registro: chi ha servito e quanto si è scritto in cache.
  assert.equal(r.servedBy, 'Anthropic');
  assert.equal(r.usage.cacheWriteTokens, 38500);
  assert.equal(r.usage.cachedPromptTokens, 0);
});

test('un modello aperto riceve i messaggi tali e quali, senza un solo cache_control', async () => {
  const msgs = richiestaChat({ giro: GIRO });
  const cache = FC.pianoDellaCache(ACTIONS.FILO_CHAT, msgs);
  const [corpo] = await corpiDi(() => OR.complete({ apiKey: 'k', model: APERTO, messages: msgs, cache }), [{
    ok: true, status: 200, json: async () => ({ provider: 'DeepInfra', choices: [{ message: { content: 'Sole.' } }], usage: { prompt_tokens: 100, completion_tokens: 2 } }),
  }]);
  assert.deepEqual(corpo.messages, JSON.parse(JSON.stringify(msgs)));
  assert.ok(!JSON.stringify(corpo).includes('cache_control'));
});

test('ripiego da Claude a un modello aperto nello stesso turno: il secondo corpo esce pulito', async () => {
  const msgs = richiestaChat();
  const cache = FC.pianoDellaCache(ACTIONS.FILO_CHAT, msgs);
  const corpi = await corpiDi(() => globalThis.SN_PROVIDERS.completeWithFallback({
    attempts: [{ provider: 'openrouter', apiKey: 'k', model: HAIKU }, { provider: 'openrouter', apiKey: 'k', model: APERTO }],
    messages: msgs, cache,
  }), [
    { ok: false, status: 400, text: async () => '{"error":{"message":"bad"}}', json: async () => ({ error: { message: 'bad' } }), clone() { return this; }, headers: new Map() },
    { ok: true, status: 200, json: async () => ({ provider: 'DeepInfra', choices: [{ message: { content: 'ok' } }], usage: {} }) },
  ]);
  const chat = corpi.filter((c) => Array.isArray(c.messages));
  assert.equal(chat.length, 2);
  assert.ok(JSON.stringify(chat[0]).includes('cache_control'));
  assert.ok(!JSON.stringify(chat[1]).includes('cache_control'));
});

test('lettura e scrittura in cache si registrano anche senza flusso; nessun dato vuol dire zero', () => {
  assert.equal(OR.cacheWriteTokens({ prompt_tokens_details: { cache_write_tokens: 1200 } }), 1200);
  assert.equal(OR.cacheWriteTokens({ prompt_tokens_details: { cached_tokens: 900 } }), 0);
  assert.equal(OR.cacheWriteTokens(null), 0);
  assert.equal(OR.cachedPromptTokens({ prompt_tokens_details: { cached_tokens: 900, cache_write_tokens: 10 } }), 900);
});

test('il cancello fa il piano sui messaggi già oscurati: il taglio cade giusto anche se un segreto ha cambiato lunghezza', async () => {
  const segreto = 'sk-or-v1-SEGRETISSIMO-0123456789';
  const msgs = richiestaChat({ onboarding: '- scopri il nome' });
  msgs[0] = { ...msgs[0], content: msgs[0].content.replace('Rispondi in modo asciutto.', `Rispondi in modo asciutto. ${segreto}`) };
  let visto = null;
  const prima = globalThis.SN_PROVIDERS;
  globalThis.SN_PROVIDERS = {
    ...prima,
    completeWithFallback: async ({ attempts, messages, cache }) => { visto = { messages, cache }; return { text: 'ok', provider: attempts[0].provider, model: attempts[0].model, usage: {} }; },
  };
  try {
    const gate = globalThis.SN_MODEL_GATE.create({
      getSettings: async () => ({}),
      buildChain: () => [{ provider: 'openrouter', apiKey: 'k', model: HAIKU }],
      modelFor: () => 'haiku',
      costs: { isOverLimit: async () => false, record: async () => 0 },
      segreti: async () => [segreto],
    });
    await gate.complete({ action: ACTIONS.FILO_CHAT, messages: msgs });
  } finally { globalThis.SN_PROVIDERS = prima; }
  assert.ok(!visto.messages[0].content.includes(segreto), 'il segreto è uscito');
  assert.equal(visto.cache.punti[0].caratteri, visto.messages[0].content.indexOf(C.INIZI_VARIABILI_CHAT[0]));
});

test('la durata della parte fissa segue le impostazioni: cinque minuti tolgono il ttl, un valore strano torna all\'ora', async () => {
  const msgs = richiestaChat();
  assert.deepEqual(FC.pianoDellaCache(ACTIONS.FILO_CHAT, msgs, { durata: '5m' }).punti[0], { indice: 0 });
  assert.deepEqual(FC.pianoDellaCache(ACTIONS.FILO_CHAT, msgs, { durata: 'sempre' }).punti[0], { indice: 0, durata: '1h' });
  const corpo5m = OR.conPuntiDiCache(HAIKU, msgs, FC.pianoDellaCache(ACTIONS.FILO_CHAT, msgs, { durata: '5m' }));
  assert.deepEqual(corpo5m[0].content[0].cache_control, { type: 'ephemeral' });

  let visto = null;
  const prima = globalThis.SN_PROVIDERS;
  globalThis.SN_PROVIDERS = {
    ...prima,
    completeWithFallback: async ({ attempts, cache }) => { visto = cache; return { text: 'ok', provider: attempts[0].provider, model: attempts[0].model, usage: {} }; },
  };
  try {
    const gate = globalThis.SN_MODEL_GATE.create({
      getSettings: async () => ({ contestoFilo: { cache: '5m' } }),
      buildChain: () => [{ provider: 'openrouter', apiKey: 'k', model: HAIKU }],
      modelFor: () => 'haiku',
      costs: { isOverLimit: async () => false, record: async () => 0 },
      durataCache: (s) => FC.tetti(s.contestoFilo, { cache: '1h' }).cache,
    });
    await gate.complete({ action: ACTIONS.FILO_CHAT, messages: msgs });
  } finally { globalThis.SN_PROVIDERS = prima; }
  assert.deepEqual(visto.punti[0], { indice: 0 });
});
