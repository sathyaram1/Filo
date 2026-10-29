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
require('../../src/shared/filoTrattoVivo.js');
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
const TV = globalThis.SN_TRATTO_VIVO;
// Il CONTESTO dell'utente come lo fotografa il main (contestoFilo.fotografa), stile compreso.
const utenteDi = (profilo, stile = 'Rispondi in modo asciutto.') => TV.parteUtente(TV.sezioniUtente({
  capacita: CAPS, sistema: 'linux', profilo, stile, files: '(nessuno)',
  statoSezioni: [{ chiave: 'TAB APERTE', testo: 'TAB APERTE\n(nessuna)' }],
}), { ts: '2026-10-21T09:00:00Z' });
const SISTEMA = PROMPTS.filoChatStatic() + utenteDi('Si chiama Mario.');
const TRATTO = [
  { role: 'user', content: '[lun 20 ott 2026, 10:02 · chat ab12] ciao' },
  { role: 'assistant', content: 'Ciao Mario!', reasoning_details: [{ type: 'reasoning.text', text: 'saluto', signature: 'firma' }] },
  { role: 'user', content: '[lun 20 ott 2026, 10:05 · chat ab12] apri wikipedia' },
  { role: 'assistant', content: 'Aperta.' },
];
const DOMANDA = { role: 'user', content: '[mar 21 ott 2026, 09:14 · chat ab12] che tempo fa domani?' };
const GIRO = [
  { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'CERCA_WEB', arguments: '{"q":"meteo"}' } }] },
  { role: 'tool', tool_call_id: 'c1', content: 'Domani sole, 18 gradi.' },
];

// La stessa richiesta che compone il main (handlers.js, ramo FILO_CHAT col tratto: SN_FILO_CONTESTO.richiesta).
function richiestaChat({ tratto = TRATTO, giro = [], domanda = DOMANDA, sistema = SISTEMA } = {}) {
  return FC.richiesta({ sistema, tratto, domanda: { ...domanda }, giro });
}

const testoDi = (m) => (typeof m.content === 'string' ? m.content : m.content.map((p) => p.text || '').join(''));
const conPunto = (m) => Array.isArray(m.content) && m.content.some((p) => p && p.cache_control);
const indiceDomanda = (msgs) => FC.indiceDellaDomanda(msgs);

test('la parte fissa è uguale byte per byte per due utenti e due turni, e non contiene gli inizi delle parti che cambiano', () => {
  const fissa = PROMPTS.filoChatStatic();
  assert.equal(PROMPTS.filoChatStatic(), fissa);
  for (const inizio of C.INIZI_VARIABILI_CHAT) assert.ok(!fissa.includes(inizio), `la parte fissa contiene ${inizio}`);
  const anna = PROMPTS.filoChatStatic() + utenteDi('Si chiama Anna.', '');
  assert.ok(anna.startsWith(fissa) && SISTEMA.startsWith(fissa));
  assert.ok(utenteDi('x').startsWith(C.INIZIO_PARTE_UTENTE));
  assert.ok(PROMPTS.filoChatOnboarding({ onboarding: '- scopri il nome' }).startsWith(C.INIZIO_ACCOGLIENZA));
  assert.ok(PROMPTS.filoChatContext({}).startsWith(C.INIZIO_CONTESTO_CHAT));
});

test('chat: un punto a fine parte fissa e uno a fine CONTESTO (un\'ora), uno a fine tratto, uno sull\'ultimo messaggio', () => {
  const msgs = richiestaChat();
  const piano = FC.pianoDellaCache(ACTIONS.FILO_CHAT, msgs);
  assert.deepEqual(piano.punti, [
    { indice: 0, caratteri: PROMPTS.filoChatStatic().length, durata: '1h' },
    { indice: 0, durata: '1h' },
    { indice: indiceDomanda(msgs) - 1 },
    { indice: msgs.length - 1 },
  ]);
  assert.equal(msgs[indiceDomanda(msgs) - 1].content, 'Aperta.');
  assert.equal(indiceDomanda(msgs), msgs.length - 1);
  assert.ok(piano.punti.length <= 4, 'Anthropic ne prende al più quattro');
});

test('l\'intervista di benvenuto sta nella domanda: il system in cache non la contiene', () => {
  const onb = PROMPTS.filoChatOnboarding({ onboarding: '- scopri il nome', onboardingTurns: 1, onboardingMax: 5 });
  const msgs = richiestaChat({ domanda: { role: 'user', content: `[mar 21 ott 2026, 09:14 · chat ab12]\n${TV.preambolo({ turno: onb })}\nciao` } });
  const piano = FC.pianoDellaCache(ACTIONS.FILO_CHAT, msgs);
  assert.ok(!msgs[0].content.includes('scopri il nome'));
  assert.deepEqual(piano.punti.slice(0, 2), [{ indice: 0, caratteri: PROMPTS.filoChatStatic().length, durata: '1h' }, { indice: 0, durata: '1h' }]);
  assert.equal(indiceDomanda(msgs), msgs.length - 1, 'la domanda col blocco di Filo in testa non si riconosce');
});

test('richiesta senza filo: l\'ora e l\'intervista restano fuori dalla parte in cache', () => {
  const sys = `${SISTEMA}\n\n${PROMPTS.filoChatContext({ adesso: 'mar 21 ott 2026, 09:14', onboarding: '- scopri il nome' })}`;
  const msgs = [{ role: 'system', content: sys }, { role: 'user', content: 'che tempo fa domani?' }];
  const piano = FC.pianoDellaCache(ACTIONS.FILO_CHAT, msgs);
  const inCache = sys.slice(0, piano.punti[1].caratteri);
  assert.ok(!inCache.includes('09:14') && !inCache.includes('scopri il nome'), 'nella parte in cache è finito un dato che cambia');
  assert.ok(inCache.includes('Si chiama Mario.'), 'il CONTESTO dell\'utente è rimasto fuori dalla cache');
  assert.ok(sys.slice(piano.punti[1].caratteri).startsWith(C.INIZIO_CONTESTO_CHAT));
  assert.deepEqual(piano.punti.slice(2), [{ indice: 1 }]);
});

test('i giri di strumenti spostano l\'ultimo punto sull\'esito; un messaggio vuoto non prende mai un punto', () => {
  const msgs = richiestaChat({ giro: GIRO, tratto: [...TRATTO, { role: 'assistant', content: '   ' }] });
  const piano = FC.pianoDellaCache(ACTIONS.FILO_CHAT, msgs);
  assert.equal(piano.punti[2].indice, indiceDomanda(msgs) - 2, 'il tratto finisce con una risposta vuota: il punto va su quella prima');
  assert.equal(piano.punti[3].indice, msgs.length - 1);
  assert.equal(msgs[msgs.length - 1].role, 'tool');
});

test('le altre funzioni non hanno piano: un prompt che cambia tutto pagherebbe scritture mai rilette', () => {
  assert.equal(FC.pianoDellaCache(ACTIONS.HELP, [{ role: 'system', content: 'x'.repeat(5000) }, DOMANDA]), null);
  assert.equal(FC.pianoDellaCache(ACTIONS.FILO_LESSON, [{ role: 'user', content: 'lezione' }]), null);
  assert.equal(FC.pianoDellaCache(ACTIONS.FILO_CHAT, []), null);
});

// #1580 — il correttore: le regole nel system, uguali a ogni chiamata, il testo che cambia nel messaggio dell'utente.
// Le stesse richieste che compone il main (handlers.js, rami SPELLCHECK_SEMANTIC e SPELLCHECK_CONTEXT).
const richiestaRapida = (nuovo) => [
  { role: 'system', content: PROMPTS.spellcheckErroriSistema() },
  { role: 'user', content: PROMPTS.spellcheckErrori({ prima: 'Caro Marco,', nuovo, luogo: { sito: 'mail.example' } }) },
];
const richiestaRagionata = (nuovo) => [
  { role: 'system', content: PROMPTS.spellcheckSuggerimentiSistema({ ripetizioni: true }) },
  { role: 'user', content: PROMPTS.spellcheckSuggerimenti({ nuovo, oggi: new Date(2026, 9, 21) }) },
];

test('correttore: un punto sul system dei due controlli, uguale da una chiamata all\'altra', () => {
  for (const [action, richiesta] of [[ACTIONS.SPELLCHECK_SEMANTIC, richiestaRapida], [ACTIONS.SPELLCHECK_CONTEXT, richiestaRagionata]]) {
    const uno = richiesta('vado con Zanzottera');
    const due = richiesta('vado con Zanzottera al mare');
    assert.deepEqual(FC.pianoDellaCache(action, uno), { punti: [{ indice: 0 }] }, action);
    assert.equal(uno[0].content, due[0].content, `${action}: il system cambia col testo`);
    assert.ok(!uno[0].content.includes('Zanzottera') && uno[1].content.includes('Zanzottera'), `${action}: il testo sta nel messaggio dell'utente`);
  }
  assert.equal(FC.pianoDellaCache(ACTIONS.SPELLCHECK_SEMANTIC, [{ role: 'user', content: 'solo testo' }]), null);
});

// Sotto il minimo di Haiku 5.5 (512 token) il punto non mette niente in cache: la parte fissa deve starci sopra con
// margine. Il prompt di #1446 (circa 1.900 caratteri, ~490 token) restava sotto. 4,5 caratteri a token è il caso peggiore.
test('correttore: la parte fissa supera i 512 token che Haiku 5.5 mette in cache', () => {
  for (const [nome, testo] of [
    ['rapido', PROMPTS.spellcheckErroriSistema()],
    ['ragionato', PROMPTS.spellcheckSuggerimentiSistema({ ripetizioni: true })],
    ['ragionato senza ripetizioni', PROMPTS.spellcheckSuggerimentiSistema({ ripetizioni: false })],
  ]) assert.ok(testo.length / 4.5 > 512, `${nome}: ${testo.length} caratteri`);
});

test('correttore: col modello Anthropic il system parte col cache_control, con un modello aperto no', async () => {
  for (const [action, msgs] of [[ACTIONS.SPELLCHECK_SEMANTIC, richiestaRapida('oggi sonno andato')], [ACTIONS.SPELLCHECK_CONTEXT, richiestaRagionata('Ci vediamo martedì.')]]) {
    const cache = FC.pianoDellaCache(action, msgs);
    const risposta = () => ({ ok: true, status: 200, json: async () => ({ provider: 'Anthropic', choices: [{ message: { content: '[][][][nessuno]' } }], usage: {} }) });
    const [claude] = await corpiDi(() => OR.complete({ apiKey: 'k', model: HAIKU, messages: msgs, cache }), [risposta()]);
    assert.deepEqual(claude.messages[0].content, [{ type: 'text', text: msgs[0].content, cache_control: { type: 'ephemeral' } }], action);
    assert.equal(claude.messages[1].content, msgs[1].content, `${action}: il testo che cambia resta fuori dalla cache`);
    const [aperto] = await corpiDi(() => OR.complete({ apiKey: 'k', model: APERTO, messages: msgs, cache }), [risposta()]);
    assert.deepEqual(aperto.messages, msgs);
    assert.ok(!JSON.stringify(aperto).includes('cache_control'), action);
  }
});

test('correttore: il cancello passa il piano della cache anche ai due controlli', async () => {
  let visto = null;
  const prima = globalThis.SN_PROVIDERS;
  globalThis.SN_PROVIDERS = {
    ...prima,
    completeWithFallback: async ({ attempts, cache }) => { visto = cache; return { text: 'ok', provider: attempts[0].provider, model: attempts[0].model, usage: {} }; },
  };
  try {
    const gate = globalThis.SN_MODEL_GATE.create({
      getSettings: async () => ({}),
      buildChain: () => [{ provider: 'openrouter', apiKey: 'k', model: HAIKU }],
      modelFor: () => 'haiku',
      costs: { isOverLimit: async () => false, record: async () => 0 },
    });
    await gate.complete({ action: ACTIONS.SPELLCHECK_SEMANTIC, messages: richiestaRapida('oggi sonno andato') });
  } finally { globalThis.SN_PROVIDERS = prima; }
  assert.deepEqual(visto, { punti: [{ indice: 0 }] });
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
  const msgs = richiestaChat({ giro: GIRO });
  const cache = FC.pianoDellaCache(ACTIONS.FILO_CHAT, msgs);
  let r;
  const [corpo] = await corpiDi(async () => {
    r = await OR.streamComplete({ apiKey: 'k', model: HAIKU, messages: msgs, cache, tools: [{ type: 'function', function: { name: 'CERCA_WEB', parameters: {} } }] });
  }, [flusso({ prompt_tokens: 41000, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 38500 } })]);

  assert.equal(corpo.messages.length, msgs.length, 'nessun messaggio aggiunto o tolto');
  corpo.messages.forEach((m, i) => assert.equal(testoDi(m), testoDi(msgs[i]), `testo cambiato nel messaggio ${i}`));
  const [fissa, utente] = corpo.messages[0].content;
  assert.equal(corpo.messages[0].content.length, 2);
  assert.equal(fissa.text, PROMPTS.filoChatStatic());
  assert.deepEqual(fissa.cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.ok(utente.text.startsWith(C.INIZIO_PARTE_UTENTE));
  assert.deepEqual(utente.cache_control, { type: 'ephemeral', ttl: '1h' });
  const segnati = corpo.messages.map((m, i) => (conPunto(m) ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(segnati, [0, indiceDomanda(msgs) - 1, msgs.length - 1]);
  assert.deepEqual(corpo.messages.at(-1).content, [{ type: 'text', text: 'Domani sole, 18 gradi.', cache_control: { type: 'ephemeral' } }]);
  assert.equal(corpo.messages.at(-1).tool_call_id, 'c1');
  assert.equal(corpo.messages[2].reasoning_details, undefined, 'senza il prefisso con cui è nato il ragionamento non parte verso Claude (#1552)');
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
  const sys = `${PROMPTS.filoChatStatic()}${utenteDi(`Si chiama Mario. ${segreto}`)}\n\n${PROMPTS.filoChatContext({ adesso: 'mar 21 ott 2026, 09:14' })}`;
  const msgs = [{ role: 'system', content: sys }, { ...DOMANDA }];
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
  assert.equal(visto.cache.punti[0].caratteri, PROMPTS.filoChatStatic().length);
  assert.equal(visto.cache.punti[1].caratteri, visto.messages[0].content.indexOf(C.INIZIO_CONTESTO_CHAT));
});

test('la durata della parte fissa segue le impostazioni: cinque minuti tolgono il ttl, un valore strano torna all\'ora', async () => {
  const msgs = richiestaChat();
  const fine = PROMPTS.filoChatStatic().length;
  assert.deepEqual(FC.pianoDellaCache(ACTIONS.FILO_CHAT, msgs, { durata: '5m' }).punti.slice(0, 2), [{ indice: 0, caratteri: fine }, { indice: 0 }]);
  assert.deepEqual(FC.pianoDellaCache(ACTIONS.FILO_CHAT, msgs, { durata: 'sempre' }).punti.slice(0, 2), [{ indice: 0, caratteri: fine, durata: '1h' }, { indice: 0, durata: '1h' }]);
  const corpo5m = OR.conPuntiDiCache(HAIKU, msgs, FC.pianoDellaCache(ACTIONS.FILO_CHAT, msgs, { durata: '5m' }));
  assert.deepEqual(corpo5m[0].content.map((p) => p.cache_control), [{ type: 'ephemeral' }, { type: 'ephemeral' }]);

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
  assert.deepEqual(visto.punti[0], { indice: 0, caratteri: fine });
});

// Il tratto vivo cresce solo in coda (SPEC-CONTESTO fase 3): esiti e ragionamento restano col loro messaggio, quindi il
// punto della storia sta sulla fine del tratto, e il turno dopo ritrova tutto quello che c'è fino a lì.
test('il punto della storia sta sull\'ultimo messaggio prima della domanda, e il turno dopo lo ritrova identico', () => {
  const ORA = Date.parse('2026-10-21T10:00:00Z');
  const chat = 'ab12cd34';
  const filo = Array.from({ length: 40 }, (_, i) => ({
    role: i % 2 ? 'filo' : 'user',
    text: i % 2 ? `Risposta ${i}.` : `Domanda ${i}?`,
    ts: new Date(ORA - (40 - i) * 60000).toISOString(),
    chat,
  }));
  const ragiona = (m) => (m.role === 'filo' ? { azioni: [], reasoningDetails: [{ type: 'reasoning.text', text: m.ts, signature: 'f' }] } : null);
  const richiesta = (n) => {
    const f = FC.finestra(filo.slice(0, n), { ora: ORA, giorni: 3, token: 100000, chatCorrente: chat, esiti: ragiona });
    return FC.richiesta({ sistema: SISTEMA, tratto: f.messaggi, domanda: FC.rendiMessaggio(filo[n], f.ultimo, { tetto: 100000, intero: true }) });
  };
  for (const n of [10, 20, 30]) {
    const adesso = richiesta(n);
    const storia = FC.pianoDellaCache(ACTIONS.FILO_CHAT, adesso).punti.find((p) => p.indice > 0 && p.indice < adesso.length - 1);
    assert.equal(storia && storia.indice, adesso.length - 2, `turno ${n}`);
    const dopo = richiesta(n + 2);
    assert.equal(JSON.stringify(dopo.slice(0, adesso.length)), JSON.stringify(adesso), `turno ${n}: la richiesta di prima non è il prefisso di quella dopo`);
  }
});
