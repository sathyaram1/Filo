// «/users» e «/gift» della home parlano col portafoglio (#895): le persone
// esistono per pseudonimo, il regalo passa dalla stessa strada del «Regala»
// della pagina «Inviti e utenti», e un'email non regala niente.
//
// Senza il fix è ROSSO: /gift scriveva nel vecchio conteggio per email, che col
// portafoglio non si vede, e /users elencava indirizzi email.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'messages.js'));
require(join(ROOT, 'src', 'shared', 'wallet.js'));
require(join(ROOT, 'src', 'pages', 'dashboard', 'dashboard-comandi.js'));
const MSG = globalThis.SN_MSG.MSG;
const C = globalThis.SN_DASH_COMANDI;
// I numeri si scrivono con la regola della pagina Crediti (#816), qualunque sia l'ICU che gira.
const fmt = (n) => globalThis.SN_WALLET.formatCredits(n);

const pseudo = (i) => `${i.toString(16).padStart(4, '0')}c0ffee12abcd`;
// Dalla più nuova: la persona 0 è entrata per ultima.
function persone(n) {
  return Array.from({ length: n }, (_, i) => ({
    pseudonym: pseudo(i),
    balance: { credits: 5000 + i, creditsGranted: 5000, usageUsd: 0 },
    invitedBy: i % 3 === 0 ? 'owner' : (i % 3 === 1 ? pseudo(i + 1) : undefined),
    createdAt: new Date(Date.UTC(2026, 8, 1) + (1000 - i) * 60000).toISOString(),
  }));
}

let tutti = [];
let righe = [];
let richieste = [];
let vista = null;   // (msg) => risposta di WALLET_OWNER_OVERVIEW
let regalo = null;  // (msg) => risposta di WALLET_OWNER_GRANT

function inizia(n = 120) {
  tutti = persone(n);
  righe = [];
  richieste = [];
  vista = () => ({ ok: true, overview: { users: tutti.slice().reverse() } });
  regalo = (msg) => {
    const p = tutti.find((u) => u.pseudonym === msg.pseudonym);
    if (!p) return { ok: true, result: { ok: false, reason: 'no_wallet' } };
    p.balance = { ...p.balance, credits: p.balance.credits + msg.credits };
    return { ok: true, result: { ok: true, credits: msg.credits } };
  };
  C.init({
    send: async (msg) => {
      richieste.push(msg);
      if (msg.type === MSG.WALLET_OWNER_OVERVIEW) return JSON.parse(JSON.stringify(vista(msg)));
      if (msg.type === MSG.WALLET_OWNER_GRANT) return regalo(msg);
      return { ok: true };
    },
    bubblesEl: null,
    inputEl: { value: '', classList: { toggle() {} } },
    makeBubble: () => null,
    goHome() {}, goThread() {},
    autoGrowInput() {}, refreshLive() {},
    archiviaRiga: (testo) => { righe.push(String(testo)); },
    chatDellaRiga: () => 'chat-1',
    // La chat non è a schermo: la riga si raccoglie dall'archivio, senza DOM.
    inChatAperta: () => false,
  });
}

beforeEach(() => inizia());

async function comando(testo) {
  C.handleSlashCommand(testo);
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  return righe[righe.length - 1] || '';
}
const di = (tipo) => richieste.filter((r) => r.type === tipo);

test('«/users» mostra pseudonimi, saldi e chi ha invitato, nessuna email, cinquanta per volta', async () => {
  const riga = await comando('/users');
  assert.match(riga, /^Persone con un portafoglio 1-50 di 120:/);
  assert.ok(riga.includes(`• ${pseudo(0)} — ${fmt(5000)} crediti, invitata da te`), riga);
  assert.ok(riga.includes(`• ${pseudo(1)} — ${fmt(5001)} crediti, invitata da ${pseudo(2)}`), riga);
  assert.ok(riga.includes(`• ${pseudo(2)} — ${fmt(5002)} crediti\n`), 'senza chi ha invitato la riga non inventa niente');
  assert.ok(riga.includes(`• ${pseudo(49)}`) && !riga.includes(`• ${pseudo(50)}`));
  assert.ok(!riga.includes('@'));
  assert.match(riga, /\/users altri/, 'chi legge deve sapere come vedere le prossime');
  assert.equal(di(MSG.WALLET_OWNER_OVERVIEW).length, 1);
});

test('«/users altri» sfoglia la stessa vista fino all’ultima persona, senza rileggerla', async () => {
  await comando('/users');
  const seconda = await comando('/users altri');
  assert.match(seconda, /^Persone con un portafoglio 51-100 di 120:/);
  assert.ok(seconda.includes(pseudo(50)));
  const terza = await comando('/users altri');
  assert.match(terza, /^Persone con un portafoglio 101-120 di 120:/);
  assert.ok(terza.includes(pseudo(119)), 'l’ultima persona deve poter essere vista');
  assert.ok(!/\/users altri/.test(terza), 'finite le persone non si offre una pagina che non c’è');
  assert.equal(di(MSG.WALLET_OWNER_OVERVIEW).length, 1);
  assert.match(await comando('/users altri'), /Non ho altre persone/);
});

test('«/users» riparte da capo e rilegge la vista', async () => {
  await comando('/users');
  await comando('/users altri');
  const riga = await comando('/users');
  assert.match(riga, /^Persone con un portafoglio 1-50 di 120:/);
  assert.equal(di(MSG.WALLET_OWNER_OVERVIEW).length, 2);
});

test('«/users altri» senza aver chiesto niente non lascia a mani vuote', async () => {
  const riga = await comando('/users altri');
  assert.match(riga, /\/users/);
  assert.equal(richieste.length, 0);
});

test('«/users» resta un comando riconosciuto, anche con qualcosa dietro', () => {
  assert.equal(C.classifyInput('/users'), 'filo');
  assert.equal(C.classifyInput('/users altri'), 'filo');
  assert.equal(C.classifyInput('/gift 500 0063'), 'filo');
});

test('con esattamente cinquanta persone non si offre una pagina che non c’è', async () => {
  inizia(50);
  const riga = await comando('/users');
  assert.match(riga, /1-50 di 50:/);
  assert.ok(!/\/users altri/.test(riga));
});

test('«/users INIZIO» cerca per inizio dello pseudonimo, in qualunque maiuscola', async () => {
  const una = await comando(`/users ${pseudo(98)}`);
  assert.equal(una, `Trovata:\n• ${pseudo(98)} — ${fmt(5098)} crediti`);
  const sedici = await comando('/users 006C');
  assert.equal(sedici, `Trovata:\n• ${pseudo(0x6c)} — ${fmt(5108)} crediti, invitata da te`);
  const gruppo = await comando('/users «006»');
  assert.match(gruppo, /^Persone con uno pseudonimo che comincia per «006» 1-16 di 16:/);
  assert.ok(!gruppo.includes(pseudo(0x70)));
});

test('una ricerca senza risultati lo dice e indica come vederle tutte', async () => {
  const riga = await comando('/users zz');
  assert.match(riga, /Nessuno ha uno pseudonimo che comincia per «zz»/);
  assert.match(riga, /\/users/);
  assert.match(await comando('/users altri'), /Non ho altre persone/);
});

test('«/users» con un’email dice che si cerca per pseudonimo, senza chiedere niente al server', async () => {
  const riga = await comando('/users mario@esempio.it');
  assert.match(riga, /pseudonimo/);
  assert.equal(richieste.length, 0);
});

test('«/users tutti» e «/users» a vuoto non filtrano; dopo una ricerca «/users» torna a tutti', async () => {
  assert.match(await comando('/users tutti'), /1-50 di 120:/);
  assert.match(await comando('/users   '), /1-50 di 120:/);
  await comando('/users 006');
  assert.match(await comando('/users'), /^Persone con un portafoglio 1-50 di 120:/);
});

test('un secondo «/users» dato mentre il primo viaggia vale al suo posto', async () => {
  C.handleSlashCommand('/users');
  const riga = await comando(`/users ${pseudo(5)}`);
  assert.match(riga, /^Trovata:/);
  assert.equal(righe.filter((r) => /Persone con un portafoglio 1-50/.test(r)).length, 0);
});

test('chi non è il proprietario si sente dire che il comando è riservato', async () => {
  vista = () => ({ ok: false, error: 'not_admin' });
  assert.match(await comando('/users'), /riservato al proprietario/);
  assert.match(await comando(`/gift 500 ${pseudo(3)}`), /riservato al proprietario/);
  assert.equal(di(MSG.WALLET_OWNER_GRANT).length, 0);
});

test('«/gift NUMERO INIZIO» regala alla persona per la strada del portafoglio e dice il saldo nuovo', async () => {
  const riga = await comando('/gift 500 0063');
  const [g] = di(MSG.WALLET_OWNER_GRANT);
  assert.deepEqual({ ...g }, { type: MSG.WALLET_OWNER_GRANT, pseudonym: pseudo(0x63), credits: 500, why: 'owner' });
  assert.equal(riga, `✓ Regalati 500 crediti a ${pseudo(0x63)}. Nuovo saldo: ${fmt(5599)} crediti.`);
  assert.equal(di(MSG.WALLET_OWNER_OVERVIEW).length, 2, 'il saldo nuovo si rilegge dopo il regalo');
});

test('lo pseudonimo intero, fra virgolette o con l’ordine rovesciato, e i numeri all’italiana', async () => {
  await comando(`/gift 10 «${pseudo(7)}».`);
  assert.equal(di(MSG.WALLET_OWNER_GRANT).at(-1).pseudonym, pseudo(7));
  await comando(`/gift ${pseudo(8)} 20`);
  assert.deepEqual([di(MSG.WALLET_OWNER_GRANT).at(-1).pseudonym, di(MSG.WALLET_OWNER_GRANT).at(-1).credits], [pseudo(8), 20]);
  await comando(`/gift 2.000 ${pseudo(9)}`);
  assert.equal(di(MSG.WALLET_OWNER_GRANT).at(-1).credits, 2000);
});

test('«/gift NUMERO EMAIL» non regala niente e dice dove la persona trova lo pseudonimo', async () => {
  const riga = await comando('/gift 500 mario@esempio.it');
  assert.equal(richieste.length, 0);
  assert.match(riga, /pseudonimo/);
  assert.match(riga, /pagina Crediti/);
  assert.match(riga, /nessun regalo/i);
});

test('un inizio di più persone non regala a nessuna e le nomina', async () => {
  const riga = await comando('/gift 10 006');
  assert.equal(di(MSG.WALLET_OWNER_GRANT).length, 0);
  assert.match(riga, /16 pseudonimi/);
  assert.ok(riga.includes(pseudo(0x60)));
  assert.match(riga, /e altri 6/, 'quelli oltre i primi dieci si contano, non spariscono');
  assert.match(riga, /nessun regalo fatto/);
});

test('un inizio che non è di nessuno, o due pseudonimi insieme, non regalano niente', async () => {
  assert.match(await comando('/gift 10 zz'), /Nessuno ha uno pseudonimo che comincia per «zz»/);
  const due = await comando(`/gift 10 ${pseudo(1)}, ${pseudo(2)}`);
  assert.ok(due.includes(pseudo(1)) && due.includes(pseudo(2)), due);
  assert.equal(di(MSG.WALLET_OWNER_GRANT).length, 0);
});

test('numero non valido o argomenti mancanti: si spiega l’uso, nessuna richiesta', async () => {
  assert.match(await comando('/gift abc zz'), /numero di crediti valido/);
  assert.match(await comando('/gift 0 0063'), /numero di crediti valido/);
  assert.match(await comando('/gift 500'), /Uso: \/gift NUMERO PSEUDONIMO/);
  assert.equal(richieste.length, 0);
});

test('un rifiuto del server lo dice; una risposta persa non finge che il regalo non sia arrivato', async () => {
  regalo = () => ({ ok: true, result: { ok: false, reason: 'missing_exchange_rate' } });
  assert.equal(await comando('/gift 10 0063'), 'Regalo non fatto: manca il cambio del giorno.');
  regalo = () => ({ ok: false, error: 'callable walletGrant 503' });
  const persa = await comando('/gift 10 0063');
  assert.match(persa, /^Non so se il regalo è arrivato/);
  assert.match(persa, /\/users 0063c0ffee12abcd/);
});
