// Verifica #1562 — giro 3, rilievo 1: un turno passato si rende in modo diverso secondo la storia della scheda che chiede
// (una conferma data dopo, una risposta fermata), che cambia fra le schede e scorre: il tratto si riscrive da lì.


import { test, expect } from '@playwright/test';
const after = test.afterAll;
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
require('../../../src/shared/capabilities.js');
require('../../../src/shared/constants.js');
require('../../../src/shared/contenutoEsterno.js');
require('../../../src/shared/chatArchive.js');
require('../../../src/shared/filoEventi.js');
require('../../../src/shared/filoApp.js');
require('../../../src/shared/filoContesto.js');
require('../../../src/shared/filoTrattoVivo.js');
require('../../../src/shared/cambi.js');
require('../../../src/shared/actionLevels.js');
require('../../../src/shared/actionTools.js');
require('../../../src/shared/sistema.js');
require('../../../src/shared/filoState.js');
require('../../../src/main/services/providers/openrouter.js');
globalThis.SN_CONST = { ...globalThis.SN_CONST, STORAGE_KEYS: { ...globalThis.SN_CONST.STORAGE_KEYS, FILO_CHATS: 'filo_chats' } };
globalThis.chrome = { storage: { local: { async get(k) { return { [k]: undefined }; }, async set() {}, async remove() {} } } };

const { creaFilo } = require('../../../src/main/services/ilFilo.js');
require('../../../src/main/services/filoChats.js');
require('../../../src/main/services/conversazioniApp.js');
const Contesto = require('../../../src/main/services/contestoFilo.js');

const C = globalThis.SN_CONST;
const { ACTIONS, PROMPTS } = C;
const E = globalThis.SN_FILO_EVENTI;
const FC = globalThis.SN_FILO_CONTESTO;
const TV = globalThis.SN_TRATTO_VIVO;
const OR = globalThis.SN_PROVIDER_OPENROUTER;
const Tools = globalThis.SN_ACTION_TOOLS;
const Chats = globalThis.SN_FILO_CHATS;
const HAIKU = 'anthropic/claude-haiku-5.5';
const CAPS = globalThis.SN_CAPABILITIES.renderIndexForPrompt();
const TETTI = { giorni: 3, token: 100000 };
const STRUMENTI = Tools.definitions();

const cartelle = [];
after(() => { for (const c of cartelle) togliCartella(c); });
function azzera() {
  const cartella = cartellaTemporanea('richiesta-chat-');
  cartelle.push(cartella);
  globalThis.SN_IL_FILO = creaFilo({ cartella });
  Contesto.dimentica(null);
  Contesto.azzeraAncore();
  return globalThis.SN_IL_FILO;
}

const ORA = Date.now();
const fa = (min) => new Date(ORA - min * 60000).toISOString();
const pensiero = (n) => ({ type: 'reasoning.text', text: `pensiero ${n}`, signature: `firma-${n}`, format: 'anthropic-claude-v1', index: 0 });

// Una chiamata vera del fornitore col router finto: il corpo partito e la risposta come la legge Filo.
async function chiama(messages, n, chiamate = null) {
  let corpo = null;
  const orig = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    corpo = JSON.parse(opts.body);
    const message = { content: chiamate ? '' : `Risposta ${n}.`, reasoning_details: [pensiero(n)], ...(chiamate ? { tool_calls: chiamate } : {}) };
    return { ok: true, status: 200, json: async () => ({ provider: 'Anthropic', choices: [{ message, finish_reason: chiamate ? 'tool_calls' : 'stop' }], usage: {} }) };
  };
  try {
    const r = await OR.complete({ apiKey: 'k', model: HAIKU, messages, tools: STRUMENTI, cache: FC.pianoDellaCache(ACTIONS.FILO_CHAT, messages) });
    return { corpo, r };
  } finally { globalThis.fetch = orig; }
}

const sezioniDi = ({ profilo = 'Si chiama Mario.', lezioni = '', schede = '1. Gmail', sistema = 'linux' } = {}) => TV.sezioniUtente({
  sistema, capacita: CAPS, profilo, lezioni, stile: 'Rispondi asciutto.', files: '(nessuno)',
  statoSezioni: [{ chiave: 'TAB APERTE', testo: `TAB APERTE\n${schede}` }, { chiave: 'PROCESSI ATTIVI', testo: 'PROCESSI ATTIVI\n(nessuno)' }],
});

// Un turno come lo fa handlers.js (turnoFiloChat): la domanda entra nel filo, il tratto si compone, il CONTESTO si
// fotografa, la domanda prende le sue note, la richiesta parte; la risposta entra nel filo col suo giro.
async function turno({ chat = 'ab12', testo, minutiFa, sezioni = sezioniDi(), giro = null }) {
  await Chats.append(chat, { role: 'user', text: testo, ts: fa(minutiFa) });
  const componi = () => Contesto.componi({ chatId: chat, userMessage: testo, storia: [], tetti: TETTI, osserva: () => '', incognito: false });
  let c = await componi();
  const foto = Contesto.fotografa({ incognito: false, sezioni, ancora: c.ancora, durata: '1h' });
  if (foto.epoca !== c.epoca) c = await componi();
  const domanda = c.domanda({ stato: foto.cambiate, epoca: foto.epoca });
  const inizio = FC.richiesta({ sistema: PROMPTS.filoChatStatic() + foto.testo, tratto: c.messaggi, domanda });
  const extra = [];
  let ultimo = null;
  if (giro) {
    const primo = await chiama(inizio, `${testo}-giro`, [{ id: 'c1', type: 'function', function: { name: 'CERCA_WEB', arguments: '{"q":"meteo"}' } }]);
    extra.push(Tools.assistantMessage({ text: '', toolCalls: primo.r.toolCalls, reasoningDetails: primo.r.reasoningDetails }), Tools.toolMessage('c1', giro));
  }
  ultimo = await chiama([...inizio, ...extra], testo);
  const dopo = await Chats.append(chat, { role: 'filo', text: ultimo.r.text, ts: fa(minutiFa - 0.5) });
  const risposta = dopo.messages[dopo.messages.length - 1];
  Contesto.ricordaEsiti(chat, risposta.ts, { azioni: [], reasoningDetails: ultimo.r.reasoningDetails });
  Contesto.ricordaGiro(chat, risposta.ts, { messaggi: extra, testo: ultimo.r.text, reasoningDetails: ultimo.r.reasoningDetails, azioni: [], seguiti: [] });
  return { messages: inizio, corpo: ultimo.corpo, foto };
}

const conRagionamento = (corpo) => corpo.messages.map((m, i) => (m.reasoning_details ? i : -1)).filter((i) => i >= 0);
const testoDi = (m) => (typeof m.content === 'string' ? m.content : (m.content || []).map((p) => p.text || '').join(''));
function riscritto(prima, dopo) {
  return prima.findIndex((m, i) => JSON.stringify(m) !== JSON.stringify(dopo[i]));
}

async function turnoStoria({ chat = 'ab12', testo, minutiFa, storia = [], sezioni = sezioniDi(), salva = true }) {
  await Chats.append(chat, { role: 'user', text: testo, ts: fa(minutiFa) });
  const componi = () => Contesto.componi({ chatId: chat, userMessage: testo, storia, tetti: TETTI, osserva: () => '', incognito: false });
  let c = await componi();
  const foto = Contesto.fotografa({ incognito: false, sezioni, ancora: c.ancora, durata: '1h' });
  if (foto.epoca !== c.epoca) c = await componi();
  const domanda = c.domanda({ stato: foto.cambiate, epoca: foto.epoca });
  const inizio = FC.richiesta({ sistema: PROMPTS.filoChatStatic() + foto.testo, tratto: c.messaggi, scheda: c.coda.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })), domanda });
  const ultimo = await chiama(inizio, testo);
  if (salva) {
    const dopo = await Chats.append(chat, { role: 'filo', text: ultimo.r.text, ts: fa(minutiFa - 0.5) });
    const risposta = dopo.messages[dopo.messages.length - 1];
    Contesto.ricordaEsiti(chat, risposta.ts, { azioni: [], reasoningDetails: ultimo.r.reasoningDetails });
    Contesto.ricordaGiro(chat, risposta.ts, { messaggi: [], testo: ultimo.r.text, reasoningDetails: ultimo.r.reasoningDetails, azioni: [], seguiti: [] });
  }
  return { messages: inizio, corpo: ultimo.corpo, testoRisposta: ultimo.r.text };
}

// Un turno di A con un'azione che chiede conferma; la conferma data dopo, nella scheda di A.
async function turnoConConferma({ chat, testo, minutiFa }) {
  await Chats.append(chat, { role: 'user', text: testo, ts: fa(minutiFa) });
  const c = await Contesto.componi({ chatId: chat, userMessage: testo, storia: [], tetti: TETTI, osserva: () => '', incognito: false });
  const foto = Contesto.fotografa({ incognito: false, sezioni: sezioniDi(), ancora: c.ancora, durata: '1h' });
  const domanda = c.domanda({ stato: foto.cambiate, epoca: foto.epoca });
  const inizio = FC.richiesta({ sistema: PROMPTS.filoChatStatic() + foto.testo, tratto: c.messaggi, domanda });
  const primo = await chiama(inizio, `${testo}-giro`, [{ id: 'c1', type: 'function', function: { name: 'ESEGUI_COMANDO', arguments: '{"comando":"ls"}' } }]);
  const extra = [Tools.assistantMessage({ text: '', toolCalls: primo.r.toolCalls, reasoningDetails: primo.r.reasoningDetails }), Tools.toolMessage('c1', 'aspetta la conferma dell\'utente')];
  const ultimo = await chiama([...inizio, ...extra], testo);
  const dopo = await Chats.append(chat, { role: 'filo', text: ultimo.r.text, ts: fa(minutiFa - 0.5) });
  const risposta = dopo.messages.at(-1);
  const azione = { type: 'ESEGUI_COMANDO', comando: 'ls', _callId: 'c1', _executed: false, _confirm: { level: 2, text: 'Eseguo ls?' } };
  Contesto.ricordaEsiti(chat, risposta.ts, { azioni: [azione], reasoningDetails: ultimo.r.reasoningDetails });
  Contesto.ricordaGiro(chat, risposta.ts, { messaggi: extra, testo: ultimo.r.text, reasoningDetails: ultimo.r.reasoningDetails, azioni: [azione], seguiti: [] });
  return { storia: [{ role: 'user', text: testo }, { role: 'filo', text: ultimo.r.text, actions: [{ ...azione, _executed: true, _confirmed: true, _output: { stdout: 'a.txt' } }] }] };
}


// Le richieste di fila: per ognuna, da quale messaggio riscrive quella prima (-1: la allunga soltanto).
function rotture(out, primo = 2) {
  const r = [];
  for (let k = 1; k < out.length; k++) {
    const i = riscritto(out[k - 1].messages, out[k].messages);
    if (i !== -1) r.push(`richiesta ${k + primo - 1} riscrive dal messaggio ${i} di ${out[k - 1].messages.length}`);
  }
  return r;
}

test('r1 un\'azione confermata dopo la risposta: dieci turni dopo, nella stessa chat, il tratto non si riscrive', async () => {
  azzera();
  const storia = [];
  const out = [];
  const conf = await turnoConConferma({ chat: 'aaaa1111', testo: 'elenca i file', minutiFa: 200 });
  storia.push(...conf.storia);
  for (let i = 0; i < 14; i++) {
    const testo = `domanda ${i}`;
    const t = await turnoStoria({ chat: 'aaaa1111', testo, minutiFa: 190 - i * 10, storia: [...storia] });
    storia.push({ role: 'user', text: testo }, { role: 'filo', text: t.testoRisposta });
    out.push(t);
  }
  expect(rotture(out)).toEqual([]);
  // Le risposte dei turni prima tornano col loro ragionamento: il prefisso con cui sono nate è intatto.
  expect(conRagionamento(out.at(-1).corpo).length).toBeGreaterThanOrEqual(14);
});

test('r1 un\'azione confermata in una scheda, con due chat alternate: passare da una all\'altra non riscrive il tratto', async () => {
  azzera();
  const storiaA = [];
  const storiaB = [];
  const out = [];
  out.push(await turnoStoria({ chat: 'aaaa1111', testo: 'ciao', minutiFa: 100, storia: [] }));
  storiaA.push({ role: 'user', text: 'ciao' }, { role: 'filo', text: out[0].testoRisposta });
  const conf = await turnoConConferma({ chat: 'aaaa1111', testo: 'elenca i file', minutiFa: 90 });
  // L'utente scrive in B, poi torna in A e conferma il comando: da lì A e B si alternano.
  const seq = [['bbbb2222', 'ciao da B'], ['aaaa1111', 'grazie'], ['bbbb2222', 'e tu?'], ['aaaa1111', 'ok']];
  let i = 0;
  for (const [chat, testo] of seq) {
    if (chat === 'aaaa1111' && storiaA.length === 2) storiaA.push(...conf.storia);
    const storia = chat === 'aaaa1111' ? storiaA : storiaB;
    const t = await turnoStoria({ chat, testo, minutiFa: 80 - i * 10, storia: [...storia] });
    storia.push({ role: 'user', text: testo }, { role: 'filo', text: t.testoRisposta });
    out.push(t);
    i++;
  }
  // La conferma che arriva cambia il turno una volta, al più; poi ogni passaggio da una scheda all'altra lo lascia com'è.
  expect(rotture(out.slice(2), 3)).toEqual([]);
});

test('r1 una risposta fermata a metà: il messaggio dopo la porta, e il turno dopo ancora non la toglie dal tratto', async () => {
  azzera();
  const storia = [];
  const uno = await turnoStoria({ testo: 'ciao', minutiFa: 40, storia: [] });
  storia.push({ role: 'user', text: 'ciao' }, { role: 'filo', text: uno.testoRisposta });
  await turnoStoria({ testo: 'scrivi un tema lungo', minutiFa: 30, storia: [...storia], salva: false });
  storia.push({ role: 'user', text: 'scrivi un tema lungo' }, { role: 'filo', text: 'C\'era una volta', actions: [], interrotto: true, fermato: true });
  const tre = await turnoStoria({ testo: 'lascia stare, che ore sono?', minutiFa: 20, storia: [...storia] });
  storia.push({ role: 'user', text: 'lascia stare, che ore sono?' }, { role: 'filo', text: tre.testoRisposta });
  const quattro = await turnoStoria({ testo: 'grazie', minutiFa: 10, storia: [...storia] });
  expect(rotture([tre, quattro], 4)).toEqual([]);
});
