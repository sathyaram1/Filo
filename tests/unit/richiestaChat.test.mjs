// La richiesta della chat in quattro blocchi (SPEC-CONTESTO § La richiesta, fase 3 #1562): strumenti uguali per tutti,
// parte fissa uguale byte per byte, CONTESTO dell'utente fotografato, tratto vivo che cresce solo in coda con quello che
// è successo davanti a ogni messaggio. Il turno si compone come in handlers.js, sul filo vero in una cartella temporanea.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
require('../../src/shared/capabilities.js');
require('../../src/shared/constants.js');
require('../../src/shared/contenutoEsterno.js');
require('../../src/shared/chatArchive.js');
require('../../src/shared/filoEventi.js');
require('../../src/shared/filoApp.js');
require('../../src/shared/filoContesto.js');
require('../../src/shared/filoTrattoVivo.js');
require('../../src/shared/cambi.js');
require('../../src/shared/actionLevels.js');
require('../../src/shared/actionTools.js');
require('../../src/shared/sistema.js');
require('../../src/shared/filoState.js');
require('../../src/main/services/providers/openrouter.js');
globalThis.SN_CONST = { ...globalThis.SN_CONST, STORAGE_KEYS: { ...globalThis.SN_CONST.STORAGE_KEYS, FILO_CHATS: 'filo_chats' } };
globalThis.chrome = { storage: { local: { async get(k) { return { [k]: undefined }; }, async set() {}, async remove() {} } } };

const { creaFilo } = require('../../src/main/services/ilFilo.js');
require('../../src/main/services/filoChats.js');
require('../../src/main/services/conversazioniApp.js');
const Contesto = require('../../src/main/services/contestoFilo.js');

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
const json = (x) => JSON.stringify(x);

test('gli strumenti sono gli stessi per ogni sistema, ogni ruolo e ogni chiamata', () => {
  assert.equal(json(Tools.definitions()), json(STRUMENTI));
  // Lo stesso computer che si dice Mac, Windows o Linux: niente nelle descrizioni dipende da lui.
  const vero = Object.getOwnPropertyDescriptor(process, 'platform');
  try {
    for (const sistema of ['darwin', 'win32', 'linux']) {
      Object.defineProperty(process, 'platform', { value: sistema, configurable: true });
      assert.equal(json(Tools.definitions()), json(STRUMENTI), `gli strumenti cambiano su ${sistema}`);
    }
  } finally { Object.defineProperty(process, 'platform', vero); }
  assert.ok(STRUMENTI.some((d) => d.function.name === 'ONBOARDING'), 'lo strumento dell\'intervista manca fuori dall\'intervista');
  assert.ok(!/C:\\|\/Users\/|\/home\//.test(json(STRUMENTI)), 'negli strumenti c\'è un percorso di un sistema solo');
});

test('ordine dei blocchi: parte fissa, CONTESTO dell\'utente, tratto vivo, domanda; quattro punti di cache al posto giusto', async () => {
  azzera();
  await turno({ testo: 'ciao', minutiFa: 30 });
  const { messages, corpo } = await turno({ testo: 'che tempo fa?', minutiFa: 20 });
  const sys = messages[0].content;
  assert.equal(messages[0].role, 'system');
  assert.ok(sys.startsWith(PROMPTS.filoChatStatic()), 'la parte fissa non apre la richiesta');
  assert.equal(sys.indexOf(C.INIZIO_PARTE_UTENTE), PROMPTS.filoChatStatic().length, 'il CONTESTO dell\'utente non viene subito dopo la parte fissa');
  for (const [i, m] of messages.slice(1).entries()) assert.notEqual(m.role, 'system', `un secondo system al posto ${i + 1}`);
  assert.match(testoDi(messages.at(-1)), /^\[\w{3} \d+ \w{3} \d{4}, \d\d:\d\d · chat ab12\] che tempo fa\?$/);
  // Fissa e CONTESTO un'ora, fine del tratto, ultimo messaggio: quattro, il massimo di Anthropic.
  const [fissa, utente] = corpo.messages[0].content;
  assert.deepEqual(fissa, { type: 'text', text: PROMPTS.filoChatStatic(), cache_control: { type: 'ephemeral', ttl: '1h' } });
  assert.ok(utente.text.startsWith(C.INIZIO_PARTE_UTENTE));
  assert.deepEqual(utente.cache_control, { type: 'ephemeral', ttl: '1h' });
  const segnati = corpo.messages.map((m, i) => (Array.isArray(m.content) && m.content.some((p) => p.cache_control) ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(segnati, [0, messages.length - 2, messages.length - 1]);
  // L'ora al minuto non sta più prima della storia.
  assert.doesNotMatch(sys, /Data: |Ultima interazione|min fa/);
});

test('la parte fissa è identica byte per byte fra due utenti diversi e fra due turni', async () => {
  azzera();
  const mario = await turno({ testo: 'ciao', minutiFa: 30 });
  const mario2 = await turno({ testo: 'come va?', minutiFa: 25 });
  azzera();
  const anna = await turno({ chat: 'zz99', testo: 'buongiorno', minutiFa: 10, sezioni: sezioniDi({ profilo: 'Si chiama Anna.', sistema: 'darwin' }) });
  const fissa = (r) => r.corpo.messages[0].content[0];
  assert.equal(json(fissa(mario)), json(fissa(mario2)));
  assert.equal(json(fissa(mario)), json(fissa(anna)));
  assert.notEqual(mario.messages[0].content, anna.messages[0].content, 'il CONTESTO di due utenti è lo stesso: la prova non prova niente');
  // Anche su un altro sistema: la parte fissa non sa su che computer gira.
  const vero = Object.getOwnPropertyDescriptor(process, 'platform');
  try {
    for (const sistema of ['darwin', 'win32', 'linux']) {
      Object.defineProperty(process, 'platform', { value: sistema, configurable: true });
      assert.equal(PROMPTS.filoChatStatic(), fissa(mario).text, `la parte fissa cambia su ${sistema}`);
    }
  } finally { Object.defineProperty(process, 'platform', vero); }
});

test('il tratto vivo di un turno è il prefisso di quello del turno dopo, e il ragionamento del turno prima torna a Claude', async () => {
  const f = azzera();
  // Una cosa successa prima del primo messaggio: è sua, e il turno dopo (col tratto che ora parte da lì) la ritrova.
  await f.importa(E.riga(E.crea(E.TIPI.TIMER_SCATTATO, { timer: 't0', nome: 'tè', genere: 'timer' }, { ts: fa(35), dispositivo: 'd', autore: 'automazione' })));
  const uno = await turno({ testo: 'ciao', minutiFa: 30 });
  assert.match(testoDi(uno.messages.at(-1)), /suonato il timer «tè»/);
  const due = await turno({ testo: 'che tempo fa?', minutiFa: 20 });
  const tre = await turno({ testo: 'e domani?', minutiFa: 10 });
  assert.equal(json(due.messages.slice(0, uno.messages.length)), json(uno.messages), 'il turno 2 ha riscritto il turno 1');
  assert.equal(json(tre.messages.slice(0, due.messages.length)), json(due.messages), 'il turno 3 ha riscritto il turno 2');
  assert.equal(due.messages.length, uno.messages.length + 2);
  // Le risposte dei turni prima partono col loro ragionamento: il prefisso con cui sono nate è intatto.
  assert.deepEqual(conRagionamento(tre.corpo), [2, 4]);
  assert.deepEqual(tre.corpo.messages[2].reasoning_details, [pensiero('ciao')]);
});

test('un turno con strumenti torna com\'era: giro, esiti e ragionamento di ogni passo', async () => {
  azzera();
  const uno = await turno({ testo: 'che tempo fa?', minutiFa: 30, giro: 'Domani sole, 18 gradi.' });
  const due = await turno({ testo: 'grazie', minutiFa: 20 });
  assert.equal(json(due.messages.slice(0, uno.messages.length)), json(uno.messages));
  const [tc, esito, finale] = due.messages.slice(uno.messages.length, uno.messages.length + 3);
  assert.equal(tc.tool_calls[0].id, 'c1');
  assert.equal(esito.role, 'tool');
  assert.equal(esito.content, 'Domani sole, 18 gradi.');
  assert.equal(finale.content, 'Risposta che tempo fa?.');
  assert.deepEqual(conRagionamento(due.corpo), [uno.messages.length, uno.messages.length + 2], 'il ragionamento dei passi del turno prima non torna');
});

test('un messaggio già mandato torna com\'era: la riga dell\'Editor che continua, un messaggio lunghissimo', async () => {
  azzera();
  const App = globalThis.SN_CONVERSAZIONI_APP;
  await turno({ testo: 'ciao', minutiFa: 30 });
  await App.annota({ app: 'editor', rif: 'doc1', soggetto: 'Tesi', messaggi: [{ role: 'user', text: 'riassumi' }, { role: 'filo', text: 'ecco' }] });
  // La riga sta all'ora in cui la conversazione dell'Editor è cominciata, adesso: i turni dopo vengono più tardi.
  const due = await turno({ testo: 'secondo', minutiFa: -5 });
  await App.annota({ app: 'editor', rif: 'doc1', soggetto: 'Tesi', messaggi: [{ role: 'user', text: 'accorcia' }, { role: 'filo', text: 'fatto' }] });
  await App.rinomina({ app: 'editor', rif: 'doc1', soggetto: 'Tesi finale' });
  const lungo = `${'parola '.repeat(20000)}fine`;
  const tre = await turno({ testo: lungo, minutiFa: -10 });
  assert.equal(json(tre.messages.slice(0, due.messages.length)), json(due.messages), 'la riga dell\'Editor ha riscritto il tratto');
  assert.ok(testoDi(tre.messages.at(-1)).endsWith(lungo));
  const quattro = await turno({ testo: 'ok', minutiFa: -15 });
  assert.equal(json(quattro.messages.slice(0, tre.messages.length)), json(tre.messages), 'il messaggio lungo è tornato accorciato');
  // Alla fotografia dopo (qui la cache fredda) la riga si rifà com'è adesso.
  Contesto.fotografa({ incognito: false, sezioni: sezioniDi(), ancora: null, durata: '5m', ora: Date.now() + 60 * 60000 });
  const c = await Contesto.componi({ chatId: 'ab12', userMessage: null, storia: [], tetti: TETTI, osserva: () => '', incognito: false });
  assert.match(c.messaggi.map(testoDi).join('\n'), /«Tesi finale»: 4 messaggi/);
});

test('quello che succede fra due messaggi entra davanti al messaggio dopo, e ci resta', async () => {
  const f = azzera();
  await turno({ testo: 'ciao', minutiFa: 30 });
  await f.importa(E.riga(E.crea(E.TIPI.TIMER_SCATTATO, { timer: 't1', nome: 'pasta', genere: 'timer' }, { ts: fa(25), dispositivo: 'd', autore: 'automazione' })));
  await f.transazione((t) => t.scrivi([t.evento(E.TIPI.CAMBIO, {
    cambio: 'c9z8y7x6w5', ambito: 'impostazioni', via: 'interfaccia', dove: 'preferences', cambi: [{ chiave: 'theme', prima: 'light', dopo: 'dark' }],
  }, { autore: 'utente', ts: fa(24) })]));
  // Un'azione della chat dentro il suo turno la racconta il turno: non torna fra le cose successe.
  await f.importa(E.riga(E.crea(E.TIPI.AZIONE, { nome: 'CERCA_WEB', parametri: { q: 'x' }, esito: { eseguita: true }, chat: 'ab12' }, { ts: fa(29.8), dispositivo: 'd', autore: 'filo' })));
  const due = await turno({ testo: 'cosa è successo?', minutiFa: 20 });
  const domanda = testoDi(due.messages.at(-1));
  assert.ok(domanda.indexOf(C.INIZIO_DA_FILO) > 0 && domanda.indexOf(C.INIZIO_MESSAGGIO_UTENTE) > domanda.indexOf(C.INIZIO_DA_FILO));
  assert.match(domanda, /suonato il timer «pasta»/);
  assert.match(domanda, /cambio dalle Preferenze c9z8y7x6w5: tema: chiaro → scuro/, 'il cambio arriva senza l\'id che serve ad ANNULLA_CAMBIO');
  assert.doesNotMatch(domanda, /CERCA_WEB/);
  assert.ok(domanda.indexOf('<<<FILO_ACCADUTI>>>') < domanda.indexOf('suonato il timer'), 'le cose successe non sono in busta');
  assert.ok(domanda.endsWith(`${C.INIZIO_MESSAGGIO_UTENTE}\ncosa è successo?`));
  const tre = await turno({ testo: 'ok', minutiFa: 10 });
  assert.equal(json(tre.messages.slice(0, due.messages.length)), json(due.messages), 'il messaggio con le cose successe è cambiato al turno dopo');
});

test('il CONTESTO resta fermo: una sezione cambiata arriva nella domanda, e al turno dopo è ancora lì', async () => {
  azzera();
  const uno = await turno({ testo: 'ciao', minutiFa: 30 });
  const due = await turno({ testo: 'apro YouTube', minutiFa: 20, sezioni: sezioniDi({ schede: '1. Gmail\n2. YouTube', lezioni: '- Non beve caffè.' }) });
  assert.equal(due.messages[0].content, uno.messages[0].content, 'il CONTESTO è stato riscritto per un cambio');
  const domanda = testoDi(due.messages.at(-1));
  assert.match(domanda, /Cambiato da quando è stato scritto il CONTESTO/);
  assert.match(domanda, /2\. YouTube/);
  assert.match(domanda, /MEMORIA, righe nuove[\s\S]*Non beve caffè\./);
  assert.ok(domanda.indexOf('<<<MEMORIA_FILO>>>') < domanda.indexOf('Non beve caffè.'), 'la memoria nuova arriva fuori dalla sua busta');
  const tre = await turno({ testo: 'ok', minutiFa: 10, sezioni: sezioniDi({ schede: '1. Gmail\n2. YouTube', lezioni: '- Non beve caffè.' }) });
  assert.equal(json(tre.messages.slice(0, due.messages.length)), json(due.messages));
  assert.doesNotMatch(testoDi(tre.messages.at(-1)), /Cambiato da quando/, 'una sezione già detta torna a ogni messaggio');
});

test('una riga della memoria tolta rifà la fotografia: non resta davanti al modello, nemmeno nei messaggi di prima', async () => {
  azzera();
  await turno({ testo: 'ciao', minutiFa: 40, sezioni: sezioniDi({ lezioni: '- Vive a Lisbona.' }) });
  const due = await turno({ testo: 'ok', minutiFa: 30, sezioni: sezioniDi({ lezioni: '- Vive a Lisbona.\n- Ha un gatto.' }) });
  assert.match(testoDi(due.messages.at(-1)), /Ha un gatto/);
  const tre = await turno({ testo: 'dimentica Lisbona', minutiFa: 20, sezioni: sezioniDi({ lezioni: '- Ha un gatto.' }) });
  const tutto = tre.messages.map(testoDi).join('\n');
  assert.doesNotMatch(tutto, /Lisbona\./, 'la riga dimenticata è ancora davanti al modello');
  assert.match(tre.messages[0].content, /Ha un gatto/);
  assert.equal(tre.foto.nuova, true);
  assert.equal(tutto.split('Ha un gatto').length - 1, 1, 'la memoria nuova è sia nel CONTESTO sia nel messaggio di prima');
});

test('con la cache fredda (fermo più della sua durata) il CONTESTO si rifotografa', async () => {
  azzera();
  const uno = await turno({ testo: 'ciao', minutiFa: 30 });
  const ancora = await Contesto.componi({ chatId: 'ab12', userMessage: null, storia: [], tetti: TETTI, osserva: () => '', incognito: false });
  const fredda = Contesto.fotografa({ incognito: false, sezioni: sezioniDi(), ancora: ancora.ancora, durata: '5m', ora: Date.now() + 6 * 60000 });
  assert.equal(fredda.nuova, true);
  assert.ok(fredda.epoca > uno.foto.epoca);
});

test('uno stile di scrittura nuovo o cambiato rifà la fotografia: sta nel CONTESTO, mai in un messaggio', async () => {
  azzera();
  const uno = await turno({ testo: 'ciao', minutiFa: 30, sezioni: TV.sezioniUtente({ sistema: 'linux', capacita: CAPS, profilo: 'Mario' }) });
  const due = await turno({ testo: 'ok', minutiFa: 20, sezioni: TV.sezioniUtente({ sistema: 'linux', capacita: CAPS, profilo: 'Mario', stile: 'Dammi del tu.' }) });
  assert.equal(due.foto.nuova, true);
  assert.notEqual(due.messages[0].content, uno.messages[0].content);
  assert.match(due.messages[0].content, /<<<STILE_UTENTE>>>\nDammi del tu\./);
  assert.doesNotMatch(testoDi(due.messages.at(-1)), /STILE_UTENTE/);
});

// Le copie per rimandare un turno com'era vivono quanto il suo messaggio nel tratto, non per numero: oltre il
// trecentesimo turno la più vecchia, dimenticata, riscriveva il tratto dall'inizio a ogni messaggio (#1562).
test('trecentoventi turni brevi sotto i tetti: nessun turno riscrive quelli di prima', async () => {
  azzera();
  const sezioni = sezioniDi();
  let prima = null;
  const rotture = [];
  for (let i = 0; i < 320; i++) {
    const chat = 'ab12';
    const testo = `t${i}`;
    await Chats.append(chat, { role: 'user', text: testo, ts: fa(2000 - i * 6) });
    const componi = () => Contesto.componi({ chatId: chat, userMessage: testo, storia: [], tetti: TETTI, osserva: () => '', incognito: false });
    let c = await componi();
    const foto = Contesto.fotografa({ incognito: false, sezioni, ancora: c.ancora, durata: '1h' });
    if (foto.epoca !== c.epoca) c = await componi();
    const messages = FC.richiesta({ sistema: PROMPTS.filoChatStatic() + foto.testo, tratto: c.messaggi, domanda: c.domanda({ stato: foto.cambiate, epoca: foto.epoca }) });
    const dopo = await Chats.append(chat, { role: 'filo', text: `Fatto ${testo}.`, ts: fa(2000 - i * 6 - 0.2) });
    const ts = dopo.messages.at(-1).ts;
    const extra = i % 2 ? [] : [Tools.assistantMessage({ text: '', toolCalls: [{ id: `c${i}`, name: 'TIMER', arguments: '{"secondi":300}' }], reasoningDetails: [pensiero(i)] }), Tools.toolMessage(`c${i}`, 'timer messo')];
    Contesto.ricordaEsiti(chat, ts, { azioni: [], reasoningDetails: [pensiero(i)] });
    Contesto.ricordaGiro(chat, ts, { messaggi: extra, testo: `Fatto ${testo}.`, reasoningDetails: [pensiero(i)], azioni: [], seguiti: [] });
    if (prima && json(messages.slice(0, prima.length)) !== json(prima)) rotture.push(i + 1);
    prima = messages;
  }
  assert.ok(FC.caratteriDi(prima) / FC.CARATTERI_PER_TOKEN < TETTI.token * 0.75, 'la prova è uscita dal tetto in token');
  assert.deepEqual(rotture, [], `i turni ${rotture.slice(0, 5).join(', ')} riscrivono quelli di prima`);
});

// Gli strumenti non mandano il modello a sezioni che la chat non riceve più (lo STATO di prima, rifatto a ogni messaggio).
test('le sezioni dello STATO che gli strumenti nominano ci sono nello STATO della chat', () => {
  const chiavi = globalThis.SN_FILO_STATE.sezioni({ tabs: [], timers: [], notifications: [] }, { perChat: true }).map((s) => s.chiave);
  for (const k of ['TEMPO', 'CAMBI RECENTI', 'CONVERSAZIONI RECENTI']) {
    if (json(STRUMENTI).includes(`${k} dello STATO`) || json(STRUMENTI).includes(`dai ${k}`)) assert.ok(chiavi.includes(k), `gli strumenti nominano ${k}, che la chat non riceve`);
  }
});

// Il CONTESTO resta fermo: un numero che cambia di poco senza tornare non si dà per «letto adesso».
test('la batteria scesa da 84 a 75: il modello ha davanti il 75% di adesso, non l\'84% del CONTESTO', async () => {
  azzera();
  const stato = (livello) => globalThis.SN_FILO_STATE.sezioni({
    tabs: [], timers: [], notifications: [], sistema: { batteria: { livello, inCarica: false }, rete: { online: true, tipo: 'cavo' } },
  }, { perChat: true });
  const conBatteria = (livello) => TV.sezioniUtente({ sistema: 'linux', profilo: 'Mario', statoSezioni: stato(livello) });
  const uno = await turno({ testo: 'ciao', minutiFa: 50, sezioni: conBatteria(84) });
  const due = await turno({ testo: 'quanta batteria ho?', minutiFa: 0, sezioni: conBatteria(75) });
  assert.match(testoDi(due.messages.at(-1)), /Cambiato da quando[\s\S]*Batteria: 75%/);
  assert.equal(due.messages[0].content, uno.messages[0].content, 'la batteria ha riscritto il CONTESTO');
});
