// Cosa vede chi scrive «/users» adesso che l'elenco arriva a pagine (#679):
// il conto vero degli iscritti, quali sta guardando, e come chiedere i
// prossimi. Se una pagina non si potesse chiedere, l'owner vedrebbe
// cinquanta iscritti su centoventi e nessun modo di vedere gli altri.
//
// Senza il fix è ROSSO: il comando chiedeva tutto e stampava «Utenti
// registrati (50)», che è anche una bugia sul numero.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'messages.js'));
require(join(ROOT, 'src', 'pages', 'dashboard', 'dashboard-comandi.js'));
const MSG = globalThis.SN_MSG.MSG;
const C = globalThis.SN_DASH_COMANDI;

const TUTTI = Array.from({ length: 120 }, (_, i) => ({
  email: `utente${String(i).padStart(3, '0')}@esempio.it`,
  name: '',
  balance: 100 + i,
}));

let righe = [];
let richieste = [];

beforeEach(() => {
  righe = [];
  richieste = [];
  C.init({
    send: async (msg) => {
      richieste.push(msg);
      if (msg.type !== MSG.OWNER_LIST_USERS) return { ok: true };
      const dopo = String(msg.after || '');
      const pagina = TUTTI.filter((u) => !dopo || u.email > dopo).slice(0, 50);
      return {
        ok: true,
        users: pagina,
        total: TUTTI.length,
        next: pagina.length >= 50 ? pagina[pagina.length - 1].email : '',
      };
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
});

async function comando(testo) {
  C.handleSlashCommand(testo);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  return righe[righe.length - 1] || '';
}

test('«/users» dice quanti sono in tutto e quali sta mostrando', async () => {
  const riga = await comando('/users');
  assert.match(riga, /Utenti registrati 1-50 di 120:/);
  assert.ok(riga.includes(TUTTI[0].email) && riga.includes(TUTTI[49].email));
  assert.ok(!riga.includes(TUTTI[50].email));
  assert.match(riga, /\/users altri/, 'chi legge deve sapere come vedere i prossimi');
});

test('«/users altri» continua da dove era, fino all’ultimo', async () => {
  await comando('/users');
  const seconda = await comando('/users altri');
  assert.match(seconda, /Utenti registrati 51-100 di 120:/);
  assert.ok(seconda.includes(TUTTI[50].email));
  const terza = await comando('/users altri');
  assert.match(terza, /Utenti registrati 101-120 di 120:/);
  assert.ok(terza.includes(TUTTI[119].email), 'l’ultimo iscritto deve poter essere visto');
  assert.ok(!/\/users altri/.test(terza), 'finiti gli utenti non si offre una pagina che non c’è');
});

test('«/users» riparte da capo dopo che si sono viste altre pagine', async () => {
  await comando('/users');
  await comando('/users altri');
  const riga = await comando('/users');
  assert.match(riga, /Utenti registrati 1-50 di 120:/);
  assert.equal(richieste[richieste.length - 1].after, '', 'la ripartenza non porta con sé il segnalibro di prima');
});

test('«/users altri» senza aver chiesto niente non lascia a mani vuote', async () => {
  const riga = await comando('/users altri');
  assert.match(riga, /\/users/);
  assert.equal(richieste.length, 0, 'e non fa partire una richiesta senza segnalibro');
});

test('«/users» resta un comando riconosciuto anche con «altri» dietro', () => {
  assert.equal(C.classifyInput('/users'), 'filo');
  assert.equal(C.classifyInput('/users altri'), 'filo');
});

// Con un numero di iscritti multiplo della pagina l'ultima pagina piena è
// anche l'ultima, e il server manda comunque il segnalibro. Il totale è già
// sullo schermo: invitare a chiedere «gli altri» quando non ce ne sono manda
// l'owner a sbattere (#679, secondo giro).
test('con esattamente una pagina di iscritti non si offre una pagina che non c’è', async () => {
  const cinquanta = TUTTI.slice(0, 50);
  C.init({
    send: async (msg) => {
      richieste.push(msg);
      if (msg.type !== MSG.OWNER_LIST_USERS) return { ok: true };
      const dopo = String(msg.after || '');
      const pagina = cinquanta.filter((u) => !dopo || u.email > dopo).slice(0, 50);
      return { ok: true, users: pagina, total: cinquanta.length, next: pagina.length >= 50 ? pagina[pagina.length - 1].email : '' };
    },
    bubblesEl: null,
    inputEl: { value: '', classList: { toggle() {} } },
    makeBubble: () => null,
    goHome() {}, goThread() {},
    autoGrowInput() {}, refreshLive() {},
    archiviaRiga: (testo) => { righe.push(String(testo)); },
    chatDellaRiga: () => 'chat-1',
    inChatAperta: () => false,
  });
  const riga = await comando('/users');
  assert.match(riga, /Utenti registrati 1-50 di 50:/);
  assert.ok(!/\/users altri/.test(riga), 'sono tutti qui: non si invita a chiederne altri');
});
