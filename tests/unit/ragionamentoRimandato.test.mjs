// Il ragionamento rimandato a Claude (#1552): parte solo se system, strumenti e messaggi prima di lui sono quelli con
// cui è nato. Sui conti Anthropic nati dal 31/08/2026 un prefisso cambiato è un 400, e via OpenRouter la chiave
// dell'owner ripiegava in silenzio sui crediti del router. Gli altri modelli ricevono il ragionamento come prima.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/capabilities.js');
require('../../src/shared/constants.js');
require('../../src/shared/actionLevels.js');
require('../../src/shared/actionTools.js');
require('../../src/shared/contenutoEsterno.js');
require('../../src/shared/filoContesto.js');
require('../../src/main/services/providers/openrouter.js');

const C = globalThis.SN_CONST;
const FC = globalThis.SN_FILO_CONTESTO;
const OR = globalThis.SN_PROVIDER_OPENROUTER;
const Tools = globalThis.SN_ACTION_TOOLS;
const { ACTIONS, PROMPTS } = C;
const HAIKU = 'anthropic/claude-haiku-5.5';
const APERTO = 'deepseek/deepseek-v4-pro';
const STRUMENTI = [{ type: 'function', function: { name: 'CERCA_WEB', parameters: {} } }];

const pensiero = (n) => ({ type: 'reasoning.text', text: `pensiero ${n}`, signature: `firma-${n}`, format: 'anthropic-claude-v1', index: 0 });
const soloDelFornitore = (rd) => (rd || []).filter((d) => d.type !== 'filo.impronta');

// Una chiamata vera del fornitore, col router finto: torna il corpo partito e la risposta come la legge Filo.
async function chiama({ model = HAIKU, messages, tools = STRUMENTI, cache = null, n, chiamate = null }) {
  let corpo = null;
  const orig = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    corpo = JSON.parse(opts.body);
    const message = { content: chiamate ? '' : `Risposta ${n}.`, reasoning_details: [pensiero(n)], ...(chiamate ? { tool_calls: chiamate } : {}) };
    return { ok: true, status: 200, json: async () => ({ provider: 'Anthropic', choices: [{ message, finish_reason: chiamate ? 'tool_calls' : 'stop' }], usage: {} }) };
  };
  try {
    const r = await OR.complete({ apiKey: 'k', model, messages, tools, cache });
    return { corpo, r };
  } finally { globalThis.fetch = orig; }
}

const risposta = (r) => Tools.assistantMessage({ text: r.text, toolCalls: r.toolCalls, reasoningDetails: r.reasoningDetails });
const conRagionamento = (corpo) => corpo.messages.map((m, i) => (m.reasoning_details ? i : -1)).filter((i) => i >= 0);

// Una conversazione che cresce solo in coda, col system e gli strumenti fermi: n turni, ognuno con la sua risposta.
async function conversazione(turni, { model = HAIKU, system = 'Sei Filo.' } = {}) {
  const messages = [{ role: 'system', content: system }];
  for (let n = 1; n <= turni; n++) {
    messages.push({ role: 'user', content: `domanda ${n}` });
    const { r } = await chiama({ model, messages, n });
    messages.push(risposta(r));
  }
  return messages;
}

test('la risposta porta l\'impronta del suo prefisso, che non esce mai verso il router', async () => {
  const messages = await conversazione(2);
  const { corpo, r } = await chiama({ messages: [...messages, { role: 'user', content: 'domanda 3' }], n: 3 });
  assert.equal(r.reasoningDetails.filter((d) => d.type === 'filo.impronta').length, 1);
  assert.deepEqual(soloDelFornitore(r.reasoningDetails), [pensiero(3)]);
  assert.ok(!JSON.stringify(corpo).includes('filo.impronta'), 'l\'impronta è uscita verso il router');
  const aperto = await chiama({ model: APERTO, messages: [...messages, { role: 'user', content: 'domanda 3' }], n: 3 });
  assert.ok(!JSON.stringify(aperto.corpo).includes('filo.impronta'));
});

test('storia che cresce in coda: ogni turno passato riporta il suo ragionamento, intatto', async () => {
  const messages = await conversazione(2);
  const { corpo } = await chiama({ messages: [...messages, { role: 'user', content: 'domanda 3' }], n: 3 });
  assert.deepEqual(conRagionamento(corpo), [2, 4]);
  assert.deepEqual(corpo.messages[2].reasoning_details, [pensiero(1)]);
  assert.deepEqual(corpo.messages[4].reasoning_details, [pensiero(2)]);
});

test('oltre il tetto: i turni rimasti dopo il taglio vanno senza ragionamento, quelli nati dopo lo riportano', async () => {
  const messages = await conversazione(3);
  // Il tetto taglia il primo scambio: il turno 4 nasce sul tratto tagliato.
  const tagliato = [messages[0], ...messages.slice(3)];
  const quarto = await chiama({ messages: [...tagliato, { role: 'user', content: 'domanda 4' }], n: 4 });
  assert.deepEqual(conRagionamento(quarto.corpo), [], 'un turno rimasto dopo il taglio ha portato il suo ragionamento');
  assert.equal(quarto.corpo.messages.length, tagliato.length + 1, 'il testo dei turni rimasti parte lo stesso');

  const dopo = [...tagliato, { role: 'user', content: 'domanda 4' }, risposta(quarto.r), { role: 'user', content: 'domanda 5' }];
  const { corpo } = await chiama({ messages: dopo, n: 5 });
  assert.deepEqual(conRagionamento(corpo), [6], 'solo il turno nato dopo il taglio riporta il ragionamento');
  assert.deepEqual(corpo.messages[6].reasoning_details, [pensiero(4)]);
});

test('una parte fissa o strumenti diversi: nessun turno passato porta il ragionamento', async () => {
  const messages = await conversazione(2);
  const domanda = { role: 'user', content: 'domanda 3' };
  const nuovoSystem = await chiama({ messages: [{ role: 'system', content: 'Sei Filo.\nUna riga in più.' }, ...messages.slice(1), domanda], n: 3 });
  assert.deepEqual(conRagionamento(nuovoSystem.corpo), []);
  const altriStrumenti = await chiama({ messages: [...messages, domanda], tools: [...STRUMENTI, { type: 'function', function: { name: 'TIMER', parameters: {} } }], n: 3 });
  assert.deepEqual(conRagionamento(altriStrumenti.corpo), []);
});

test('i ragionamenti davanti contano come il testo: chi è nato senza resta valido, rimessi lo invalidano', async () => {
  const messages = await conversazione(2);
  // Il turno 3 nasce col ragionamento del turno 1 già tolto. Il turno 2 l'aveva davanti e non parte più: Anthropic
  // ammetterebbe un taglio dalla testa, la regola è più stretta e non manda mai un blocco in dubbio.
  const senzaPrimo = messages.map((m, i) => (i === 2 ? { role: m.role, content: m.content } : m));
  const terzo = await chiama({ messages: [...senzaPrimo, { role: 'user', content: 'domanda 3' }], n: 3 });
  assert.deepEqual(conRagionamento(terzo.corpo), []);
  const quarta = [...senzaPrimo, { role: 'user', content: 'domanda 3' }, risposta(terzo.r), { role: 'user', content: 'domanda 4' }];
  assert.deepEqual(conRagionamento((await chiama({ messages: quarta, n: 4 })).corpo), [6]);
  // Rimesso il ragionamento del turno 1, il turno 3 (nato senza) non vale più; il turno 2 invece lo aveva davanti.
  const rimesso = quarta.map((m, i) => (i === 2 ? messages[2] : m));
  assert.deepEqual(conRagionamento((await chiama({ messages: rimesso, n: 4 })).corpo), [2, 4]);
});

test('gli altri modelli ricevono il ragionamento come prima, anche dopo un taglio', async () => {
  const messages = await conversazione(3, { model: APERTO });
  const tagliato = [messages[0], ...messages.slice(3), { role: 'user', content: 'domanda 4' }];
  const { corpo } = await chiama({ model: APERTO, messages: tagliato, n: 4 });
  assert.deepEqual(conRagionamento(corpo), [2, 4]);
  assert.deepEqual(corpo.messages[2].reasoning_details, [pensiero(2)]);
});

// La richiesta come la compone il main per la chat (handlers.js, ramo FILO_CHAT col tratto del filo).
const ORA = Date.parse('2026-10-21T10:00:00Z');
const CHAT = 'ab12cd34';
const BASE = { capacita: globalThis.SN_CAPABILITIES.renderIndexForPrompt(), sistema: 'linux', profilo: 'Si chiama Mario.', files: '(nessuno)' };
function richiestaChat({ filo, esiti = null, stato, domanda, onboarding = '' }) {
  const p = { ...BASE, stato, onboarding, onboardingTurns: 1, onboardingMax: 5 };
  const f = FC.finestra(filo, { ora: ORA, giorni: 3, token: 100000, chatCorrente: CHAT, esiti });
  const messages = FC.assembla({
    tratto: [{ role: 'system', content: PROMPTS.filoChatStatic(p) + PROMPTS.filoChatOnboarding(p) }, ...f.messaggi],
    contesto: FC.coda({ contesto: PROMPTS.filoChatContext({ ...p, onboarding: '' }), chatCorrente: CHAT }),
    domanda: { role: 'user', content: domanda },
  });
  return C.injectAgentStyle(messages, ACTIONS.FILO_CHAT, 'Rispondi in modo asciutto.');
}
const ts = (min) => new Date(ORA - min * 60000).toISOString();

test('dentro un giro di strumenti ogni messaggio dell\'assistente del turno riporta il suo ragionamento, coi punti di cache che si spostano', async () => {
  // Nel tratto c'è una risposta di ieri col suo ragionamento: è nata davanti a un'altra richiesta, quindi non parte.
  const filo = [
    { chat: CHAT, role: 'user', text: 'ciao', ts: ts(60) },
    { chat: CHAT, role: 'filo', text: 'Ciao Mario!', ts: ts(59) },
  ];
  const vecchio = (await chiama({ messages: [{ role: 'user', content: 'altro' }], n: 0 })).r.reasoningDetails;
  const esiti = (m) => (m.role === 'filo' ? { azioni: [], reasoningDetails: vecchio } : null);
  const inizio = richiestaChat({ filo, esiti, stato: 'Data: martedì 21 ottobre 2026, 10:00', domanda: 'che tempo fa domani?', onboarding: '- scopri il nome' });
  const giro = [];
  const turno = async (n, chiamate) => {
    const messages = [...inizio, ...giro];
    const out = await chiama({ messages, cache: FC.pianoDellaCache(ACTIONS.FILO_CHAT, messages), n, chiamate });
    if (chiamate) {
      giro.push(risposta(out.r), Tools.toolMessage(chiamate[0].id, `esito ${n}`));
    }
    return out.corpo;
  };
  const primo = await turno(1, [{ id: 'c1', type: 'function', function: { name: 'CERCA_WEB', arguments: '{"q":"meteo"}' } }]);
  assert.deepEqual(conRagionamento(primo), [], 'la risposta di ieri è partita col suo ragionamento');
  const secondo = await turno(2, [{ id: 'c2', type: 'function', function: { name: 'CERCA_WEB', arguments: '{"q":"meteo domani"}' } }]);
  assert.deepEqual(conRagionamento(secondo), [inizio.length], 'l\'ultimo messaggio dell\'assistente è partito senza ragionamento');
  assert.deepEqual(secondo.messages[inizio.length].reasoning_details, [pensiero(1)]);
  const terzo = await turno(3, null);
  assert.deepEqual(conRagionamento(terzo), [inizio.length, inizio.length + 2]);
  assert.deepEqual(terzo.messages[inizio.length + 2].reasoning_details, [pensiero(2)]);
  assert.ok(JSON.stringify(terzo.messages.at(-1)).includes('cache_control'), 'il punto di cache non si è spostato sull\'ultimo esito');
});

// Perché oggi verso Claude il ragionamento dei turni passati non torna mai: davanti alla domanda di un turno c'è il
// CONTESTO DI ADESSO, che al turno dopo non c'è più, e nel tratto la domanda prende ora e chat in testa.
test('chat vera: la risposta del turno prima è nel tratto col suo ragionamento, ma la richiesta davanti a lei è cambiata', async () => {
  const filo = [{ chat: CHAT, role: 'user', text: 'ciao', ts: ts(10) }];
  const primo = richiestaChat({ filo: [], stato: 'Data: martedì 21 ottobre 2026, 09:50', domanda: 'ciao' });
  const nato = await chiama({ messages: primo, cache: FC.pianoDellaCache(ACTIONS.FILO_CHAT, primo), n: 1 });
  filo.push({ chat: CHAT, role: 'filo', text: nato.r.text, ts: ts(9) });
  const esiti = (m) => (m.role === 'filo' ? { azioni: [], reasoningDetails: nato.r.reasoningDetails } : null);
  const dopo = richiestaChat({ filo, esiti, stato: 'Data: martedì 21 ottobre 2026, 10:00', domanda: 'e domani?' });
  const j = dopo.findIndex((m) => m.role === 'assistant');
  assert.ok(dopo[j].reasoning_details, 'il tratto non porta più il ragionamento: la prova non prova niente');

  const { corpo } = await chiama({ messages: dopo, cache: FC.pianoDellaCache(ACTIONS.FILO_CHAT, dopo), n: 2 });
  assert.deepEqual(conRagionamento(corpo), [], 'il ragionamento è partito con un prefisso diverso da quello con cui è nato');
  const testo = (m) => (typeof m.content === 'string' ? m.content : m.content.map((p) => p.text || '').join(''));
  assert.ok(testo(nato.corpo.messages.at(-2)).startsWith(FC.INTESTAZIONE_CODA), 'alla nascita il contesto di adesso stava davanti alla domanda');
  assert.notEqual(testo(corpo.messages[j - 1]), testo(nato.corpo.messages.at(-1)), 'nel tratto la domanda è la stessa di quando è nato');

  const aperto = await chiama({ model: APERTO, messages: dopo, n: 2 });
  assert.deepEqual(aperto.corpo.messages[j].reasoning_details, [pensiero(1)], 'un modello aperto ha perso il ragionamento');
});
