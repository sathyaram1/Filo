// #1353 — il saldo che la chat dice non fa aspettare il turno: vale l'ultima lettura finita, una vecchia si rilegge in
// sottofondo (una alla volta), e «il server dei crediti non risponde» arriva solo da una lettura fallita davvero.
// Con la chiave propria il conteggio locale non è un saldo; al riscatto chi lo vedeva sente dire dove va.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/wallet.js');
require('../../src/shared/contenutoEsterno.js');
require('../../src/shared/filoState.js');
const W = globalThis.SN_WALLET;
const FS = globalThis.SN_FILO_STATE;

const ORA = Date.parse('2026-10-21T10:00:00.000Z');
const statoServer = (credits, extra = {}) => ({
  ok: true, identity: { ok: true }, hasPersonalKey: true, usingOwnKey: false,
  server: { hasWallet: true, balance: { credits }, dailyCredits: 100, ...extra },
});

// Il pezzo del main: una lettura che l'utente non deve aspettare, e l'ultima finita che quella aggiorna.
function main({ ultima = null, disco = null } = {}) {
  const m = { ultima, disco, letture: 0, chiudi: null, ora: ORA };
  m.rilettore = W.rilettoreSaldo({
    leggi: () => { m.letture += 1; return new Promise((ok) => { m.chiudi = (state) => { m.ultima = { at: m.ora, state }; ok(state); }; }); },
    ultima: () => m.ultima,
    now: () => m.ora,
  });
  // Un turno di chat: chiede la rilettura e risponde subito con quello che c'è.
  m.turno = () => { m.rilettore.rileggi(); return W.saldoPerChat({ lettura: m.ultima, disco: m.disco, now: m.ora }); };
  return m;
}

test('saldo letto più di un minuto fa: il turno risponde subito con quello, e la lettura nuova parte in sottofondo', async () => {
  const m = main({ ultima: { at: ORA - 61_000, state: statoServer(4321.5) } });
  const s = m.turno();
  assert.equal(s.balance, 4321.5, 'il turno ha il saldo, non una promessa da aspettare');
  assert.equal(s.lastKnown, 'old', 'è l\'ultimo saldo noto, non quello di adesso');
  assert.equal(s.readAt, new Date(ORA - 61_000).toISOString());
  assert.equal(m.letture, 1, 'la rilettura è partita');

  // Un altro turno mentre il server ci pensa: niente seconda lettura, niente «non risponde».
  m.ora += 4_000;
  const ancora = m.turno();
  assert.equal(m.letture, 1);
  assert.equal(ancora.lastKnown, 'old');

  // La lettura arriva: il turno dopo ha il saldo di adesso.
  m.chiudi(statoServer(4300));
  await new Promise((r) => setImmediate(r));
  const dopo = m.turno();
  assert.equal(dopo.balance, 4300);
  assert.equal(dopo.lastKnown, '');
  assert.equal(m.letture, 1, 'una lettura di meno di un minuto non si rifà');
});

test('un server lento non diventa mai «non risponde»: lo diventa una lettura finita male', async () => {
  const m = main({ ultima: { at: ORA - 120_000, state: statoServer(900) } });
  for (let i = 0; i < 5; i++) {
    m.ora += 30_000;
    assert.notEqual(m.turno().lastKnown, 'server', `turno ${i}: il server sta solo rispondendo piano`);
  }
  assert.equal(m.letture, 1, 'una lettura alla volta, anche se tarda minuti');

  // Il server risponde con un errore: lo stato della pagina è l'ultimo letto, segnato vecchio.
  m.chiudi(statoServer(900, { cached: true, stale: true, readAt: new Date(ORA - 120_000).toISOString() }));
  await new Promise((r) => setImmediate(r));
  const fallita = m.turno();
  assert.equal(fallita.lastKnown, 'server');
  assert.equal(fallita.balance, 900);

  // Lettura fallita senza nessuno stato del server (identità offline) e con il disco: anche lei è un errore vero.
  const senza = W.saldoPerChat({ lettura: { at: ORA, state: { ok: true, identity: { ok: false } } }, disco: { hasWallet: true, balance: { credits: 800 }, readAt: new Date(ORA - 3600_000).toISOString() }, now: ORA });
  assert.equal(senza.lastKnown, 'server');
  assert.equal(senza.balance, 800);
});

test('nessuna lettura ancora finita: il disco vale come saldo vecchio, e senza disco non si dice che il server tace', () => {
  const disco = { hasWallet: true, balance: { credits: 5000 }, dailyCredits: 100, readAt: new Date(ORA - 86_400_000).toISOString() };
  const s = W.saldoPerChat({ lettura: null, disco, now: ORA });
  assert.equal(s.balance, 5000);
  assert.equal(s.lastKnown, 'old');
  assert.deepEqual(W.saldoPerChat({ lettura: null, disco: null, now: ORA }), { balance: null, nonRisponde: false });
  assert.deepEqual(W.saldoPerChat({ lettura: { at: ORA, state: { ok: true, identity: { ok: false } } }, disco: null, now: ORA }), { balance: null, nonRisponde: true });
  // Senza portafoglio sul server, o con l'identità annullata, vale il conteggio locale.
  assert.equal(W.saldoPerChat({ lettura: { at: ORA, state: { server: { hasWallet: false } } }, now: ORA }), null);
  assert.equal(W.saldoPerChat({ lettura: { at: ORA, state: { identity: { lost: true } } }, disco, now: ORA }), null);
});

test('una lettura fresca non si rifà; una che fallisce non blocca le prossime', async () => {
  const m = main({ ultima: { at: ORA - 10_000, state: statoServer(10) } });
  assert.equal(m.turno().lastKnown, '');
  assert.equal(m.letture, 0);
  const rotto = W.rilettoreSaldo({ leggi: () => { throw new Error('rete'); }, ultima: () => null });
  assert.equal(await rotto.rileggi(), null);
  let n = 0;
  const dopo = W.rilettoreSaldo({ leggi: async () => { n += 1; }, ultima: () => null });
  await dopo.rileggi();
  await dopo.rileggi();
  assert.equal(n, 2, 'finita una lettura, la prossima richiesta ne fa un\'altra');
});

test('nel prompt: un saldo solo vecchio è «l\'ultimo noto» senza «non risponde»; un saldo ignoto non accusa il server', () => {
  const testo = (credits) => FS.renderForPrompt({ time: { humanNow: 'x' }, tabs: [], timers: [], notifications: [], credits });
  const vecchio = testo({ wallet: true, balance: 4000, dailyCredits: 100, lastKnown: 'old', readAt: '2026-10-21T09:58:00.000Z' });
  assert.match(vecchio, /Saldo: 4\.?000 crediti \(lo tiene il server; letto il \d+ \S+ alle \d\d:\d\d\)\. È l'ultimo saldo noto/);
  assert.doesNotMatch(vecchio, /non risponde/);
  const ignoto = testo({ wallet: true, balance: null, nonRisponde: false });
  assert.match(ignoto, /Non dare una cifra/);
  assert.doesNotMatch(ignoto, /non risponde/);
  assert.match(testo({ wallet: true, balance: null, nonRisponde: true }), /il server dei crediti non risponde/);
});

// La sezione CREDITI che riceve un turno di chat, con un main finto: senza portafoglio, con la chiave che dice `fonte`.
async function creditiInChat(fonte) {
  const prima = { WM: globalThis.SN_WALLET_MAIN, C: globalThis.SN_CREDITS, M: globalThis.SN_FILO_MEMORY };
  globalThis.SN_WALLET_MAIN = { saldoPerChat: async () => null, keySource: async () => fonte };
  globalThis.SN_CREDITS = { getPublic: async () => ({ balance: 1010 }) };
  globalThis.SN_FILO_MEMORY = {
    getSession: async () => ({}), listTimers: async () => [], listNotifications: async () => [], getDashboardCache: async () => null,
  };
  try {
    const { stateText } = await FS.assemble({ creditiFreschi: true, sistema: false });
    return stateText.slice(stateText.indexOf('CREDITI'), stateText.indexOf('TAB APERTE'));
  } finally {
    globalThis.SN_WALLET_MAIN = prima.WM;
    globalThis.SN_CREDITS = prima.C;
    globalThis.SN_FILO_MEMORY = prima.M;
  }
}

test('con la chiave propria la chat dice che paga la chiave e che il conteggio non sono soldi suoi', async () => {
  const propria = await creditiInChat('own');
  assert.match(propria, /le richieste le paga quella chiave/);
  assert.match(propria, /crediti di prova su questo computer: 1010/);
  assert.match(propria, /Non sono soldi che l'utente spende e non sono il suo saldo/);
  assert.doesNotMatch(propria, /Saldo: 1010/, 'il conteggio non si presenta come il suo saldo');
  // Con la chiave di fabbrica il conteggio resta il saldo, com'era.
  assert.match(await creditiInChat('factory'), /Saldo: 1010 crediti \(si ricaricano di \d+ ogni giorno a mezzanotte\)/);
});

test('il conteggio locale è a schermo solo senza portafoglio e con la chiave propria o di fabbrica', () => {
  assert.equal(W.conteggioLocaleInVista({ keySource: 'own' }), true);
  assert.equal(W.conteggioLocaleInVista({ keySource: 'factory' }), true);
  for (const keySource of ['none', 'personal', '', undefined]) assert.equal(W.conteggioLocaleInVista({ keySource }), false, String(keySource));
  assert.equal(W.conteggioLocaleInVista({ keySource: 'own', hasWallet: true }), false);
  assert.equal(W.conteggioLocaleInVista({ keySource: 'factory', identityLost: true }), false);
});

test('al riscatto, chi vedeva il conteggio locale legge in una riga che lascia il posto ai crediti d\'ingresso, senza cifre perse', () => {
  const con = W.redeemOkMessage({ entryCredits: 5000, conteggioLocale: true });
  assert.equal(con, 'Invito riscattato: hai 5.000 crediti d’ingresso. Prendono il posto dei crediti di prova che Filo teneva su questo computer.');
  assert.equal(W.redeemOkMessage({ entryCredits: 5000 }), 'Invito riscattato: hai 5.000 crediti d’ingresso.');
  assert.match(W.redeemOkMessage({ conteggioLocale: true }), /^Invito riscattato: i tuoi crediti sono pronti\. Prendono il posto/);
  assert.equal(W.entryNoticeText({ credits: 5000, conteggioLocale: true }), 'Sei entrato con un invito: hai 5.000 crediti. Prendono il posto dei crediti di prova che Filo teneva su questo computer.');
  assert.equal(W.entryNoticeText({ credits: 5000 }), 'Sei entrato con un invito: hai 5.000 crediti.');
});
