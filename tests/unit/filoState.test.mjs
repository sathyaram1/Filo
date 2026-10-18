// Unit test per src/shared/filoState.js — la sezione CREDITI del "Filo State"
// che finisce nel prompt della chat.
//
// Feedback #359: l'utente vuole poter chiedere a Filo in chat quanti crediti gli
// restano, senza aprire la pagina Crediti. Perché Filo possa rispondere, il saldo
// deve essere presente nel contesto che l'agente riceve (il Filo State). Questi
// test asseriscono che renderForPrompt (funzione pura, no Electron) includa il
// saldo quando c'è, e che ometta la sezione quando il saldo non è disponibile.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'filoState.js'));

const FS = globalThis.SN_FILO_STATE;

// Stato minimo valido per renderForPrompt (i campi che tocca sempre).
function baseState(extra = {}) {
  return {
    time: { humanNow: '2026-07-29 mercoledì 10:00', timeSinceLastInteractionMin: null, session: null },
    tabs: [],
    timers: [],
    notifications: [],
   
    dashboard: null,
    ...extra,
  };
}

test('filoState si registra su globalThis con la sua API', () => {
  assert.ok(FS);
  assert.equal(typeof FS.renderForPrompt, 'function');
  assert.equal(typeof FS.assemble, 'function');
});

test('renderForPrompt include il saldo crediti quando presente', () => {
  const text = FS.renderForPrompt(baseState({ credits: { balance: 842 } }));
  assert.match(text, /CREDITI/, 'manca la sezione CREDITI');
  assert.match(text, /842/, 'manca il saldo nel testo del prompt');
});

test('renderForPrompt omette la sezione CREDITI quando il saldo non è disponibile', () => {
  const text = FS.renderForPrompt(baseState({ credits: null }));
  assert.doesNotMatch(text, /CREDITI/, 'la sezione CREDITI non deve comparire senza saldo');
});

test('renderForPrompt mostra anche un saldo pari a zero (non lo tratta come assente)', () => {
  const text = FS.renderForPrompt(baseState({ credits: { balance: 0 } }));
  assert.match(text, /CREDITI/);
  assert.match(text, /Saldo: 0 crediti/);
});

// #816 — con un portafoglio la chat dice il saldo del SERVER (quello della
// pagina Crediti) e la quota vera, non il vecchio conteggio locale con la sua
// ricarica «di 100 a mezzanotte».
require(join(__dirname, '..', '..', 'src', 'shared', 'wallet.js'));

async function assembleCon({ wallet, locale }) {
  const prima = { WM: globalThis.SN_WALLET_MAIN, C: globalThis.SN_CREDITS, M: globalThis.SN_FILO_MEMORY };
  const chiamate = [];
  globalThis.SN_WALLET_MAIN = wallet === undefined ? undefined : {
    saldoPerChat: async (opts) => { chiamate.push(opts); return wallet; },
  };
  globalThis.SN_CREDITS = { getPublic: async () => ({ balance: locale }) };
  globalThis.SN_FILO_MEMORY = {
    getSession: async () => ({}), listTimers: async () => [], listNotifications: async () => [],
    getDashboardCache: async () => null,
  };
  try {
    const { state, stateText } = await FS.assemble({ creditiFreschi: true });
    return { state, stateText, chiamate };
  } finally {
    globalThis.SN_WALLET_MAIN = prima.WM;
    globalThis.SN_CREDITS = prima.C;
    globalThis.SN_FILO_MEMORY = prima.M;
  }
}

test('portafoglio a 4.321,5 con quota 100: la chat dice quelli, non il conteggio locale', async () => {
  const { stateText, chiamate } = await assembleCon({
    wallet: { balance: 4321.5, dailyCredits: 100, lastKnown: '', readAt: null, usingOwnKey: false, keyMissing: false },
    locale: 777,
  });
  assert.match(stateText, /Saldo: 4\.?321,5 crediti/, "la cifra della pagina Crediti (Intl it-IT non raggruppa le quattro cifre)");
  assert.match(stateText, /ne arrivano altri 100/);
  assert.doesNotMatch(stateText, /777/, 'il conteggio locale non deve entrare');
  assert.doesNotMatch(stateText, /mezzanotte/, 'la ricarica locale non vale per il portafoglio');
  assert.deepEqual(chiamate, [{ fresco: true }], 'un turno di chat chiede il saldo di adesso');
});

test('la quota detta è quella del server: cambiata la manopola, cambia la riga', async () => {
  const { stateText } = await assembleCon({
    wallet: { balance: 4321.5, dailyCredits: 250, lastKnown: '' },
    locale: 777,
  });
  assert.match(stateText, /ne arrivano altri 250/);
});

test('server muto: la chat ha l\'ultimo saldo noto e sa che deve dirlo', async () => {
  const { stateText } = await assembleCon({
    wallet: { balance: 4000, dailyCredits: 100, lastKnown: 'server', readAt: '2026-09-28T08:12:00.000Z' },
    locale: 777,
  });
  assert.match(stateText, /Saldo: 4\.?000 crediti/);
  assert.match(stateText, /ultimo saldo noto, letto il 28 set/);
  assert.match(stateText, /non risponde/);
});

test('portafoglio senza nessuna lettura: niente cifra inventata, né quella locale', async () => {
  const { stateText } = await assembleCon({ wallet: { balance: null, dailyCredits: null }, locale: 777 });
  assert.match(stateText, /CREDITI/);
  assert.match(stateText, /non riesco a leggerlo/);
  assert.doesNotMatch(stateText, /777/);
});

test('senza portafoglio resta il conteggio locale, com\'era', async () => {
  const { stateText } = await assembleCon({ wallet: null, locale: 842 });
  assert.match(stateText, /Saldo: 842 crediti \(si ricaricano di \d+ ogni giorno a mezzanotte\)/);
});

test('una lettura solo vecchia (la home non ne chiede un\'altra) si data, senza dire che il server tace', async () => {
  const { stateText } = await assembleCon({
    wallet: { balance: 4000, dailyCredits: 100, lastKnown: 'old', readAt: '2026-09-28T08:12:00.000Z' },
    locale: 777,
  });
  assert.match(stateText, /Saldo: 4\.?000 crediti \(lo tiene il server; letto il 28 set alle \d\d:\d\d\)/);
  assert.doesNotMatch(stateText, /non risponde/);
});

// #868 — la home e il creatore di lezioni non hanno il filo davanti: ricevono gli ultimi messaggi, e il taglio si dichiara.
test('conversazioni recenti: solo le ultime 24 ore, le più nuove, il testo lungo con «…» e quanti ne restano fuori', () => {
  const ora = Date.parse('2026-10-07T12:00:00Z');
  const ts = (oreFa) => new Date(ora - oreFa * 3600000).toISOString();
  const msgs = [{ role: 'user', text: 'di due giorni fa', ts: ts(48) }];
  for (let i = 0; i < 45; i++) msgs.push({ role: i % 2 ? 'filo' : 'user', text: `messaggio ${i}`, ts: ts(10 - i * 0.1) });
  msgs.push({ role: 'user', text: 'x'.repeat(500), ts: ts(0.01) });
  const c = FS.conversazioniRecenti(msgs, ora);
  assert.equal(c.righe.length, 40);
  assert.equal(c.tolti, 6);
  assert.ok(!c.righe.some((r) => r.includes('di due giorni fa')));
  assert.ok(c.righe[c.righe.length - 1].endsWith('…'));
  const testo = FS.testoConversazioni(c);
  assert.match(testo, /CONVERSAZIONI RECENTI/);
  assert.match(testo, /più 6 messaggi più vecchi/);
  assert.ok(!FS.renderForPrompt(baseState()).includes('CONVERSAZIONI RECENTI'), 'senza conversazioni la sezione non c\'è (la chat ha il filo)');
  assert.ok(FS.renderForPrompt(baseState({ conversazioni: c })).includes('messaggio 44'));
});
