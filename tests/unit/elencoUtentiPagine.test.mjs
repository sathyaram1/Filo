// L'elenco degli utenti dell'owner: una pagina per volta, tre campi, il totale
// contato dal server (#679).
//
// Il caso. `/users` scaricava fino a MILLE documenti `credits/<uid>` INTERI —
// saldo, aggregati per tipo d'uso, ricompense, costo in euro — per stampare
// email, nome e saldo, e il numero di iscritti era la lunghezza di quella
// lista. Con cento iscritti erano cento documenti interi per una riga a testa.
//
// Qui si guarda cosa va sul filo e cosa vede chi scrive il comando, con
// centoventi utenti finti: la prima pagina ne mostra cinquanta, il totale dice
// centoventi, e la pagina dopo arriva quando la si chiede.
//
// Senza il fix è ROSSO: la query non proiettava niente, non paginava e non
// contava.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// Sessione da proprietario al posto del modulo di accesso.
const authPath = require.resolve(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    isSignedIn: () => true,
    isAdmin: () => true,
    getIdToken: async () => 'finto-id-token',
    getProfile: () => ({ email: 'owner@esempio', name: 'Owner' }),
    getUid: async () => 'uid-owner',
    onChange: () => () => {},
  },
};

require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'messages.js'));
require(join(ROOT, 'src', 'shared', 'feedback.js'));
require(join(ROOT, 'src', 'main', 'services', 'creditStore.js'));
const MSG = globalThis.SN_MSG.MSG;

const register = require(join(ROOT, 'src', 'main', 'services', 'handlers', 'credits.js'));
const handlers = new Map();
register((type, fn) => handlers.set(type, fn), { MSG, broadcastToTabs() {} });
const elencoUtenti = handlers.get(MSG.OWNER_LIST_USERS);

// Centoventi utenti finti, in ordine di email come li rende Firestore.
const TUTTI = Array.from({ length: 120 }, (_, i) => ({
  email: `utente${String(i).padStart(3, '0')}@esempio.it`,
  name: `Persona ${i}`,
  balance: 100 + i,
}));

function documento(u) {
  return {
    document: {
      name: `credits/uid-${u.email}`,
      fields: {
        email: { stringValue: u.email },
        name: { stringValue: u.name },
        balance: { integerValue: String(u.balance) },
      },
    },
  };
}

let richieste = [];

// Firestore finto: risponde alla query di elenco rispettando limit e
// segnalibro, e alla query di conteggio col totale vero.
function reteFinta() {
  richieste = [];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    const body = JSON.parse(opts.body);
    richieste.push({ url: u, body });
    if (u.includes(':runAggregationQuery')) {
      return {
        ok: true, status: 200,
        json: async () => [{ result: { aggregateFields: { totale: { integerValue: String(TUTTI.length) } } } }],
        text: async () => '',
      };
    }
    const q = body.structuredQuery;
    const dopo = q.startAt ? q.startAt.values[0].stringValue : '';
    const pagina = TUTTI.filter((x) => !dopo || x.email > dopo).slice(0, q.limit);
    return { ok: true, status: 200, json: async () => pagina.map(documento), text: async () => '' };
  };
}

const daFilo = (msg) => elencoUtenti(msg, { isShell: false }, 'filo://newtab/');

beforeEach(() => { reteFinta(); });

test('la prima pagina ne mostra cinquanta, il totale dice centoventi', async () => {
  const r = await daFilo({});
  assert.equal(r.ok, true);
  assert.equal(r.users.length, 50);
  assert.equal(r.total, 120, 'il totale lo conta il server, non la lunghezza di quello che si è scaricato');
  assert.equal(r.users[0].email, TUTTI[0].email);
  assert.equal(r.next, TUTTI[49].email, 'il segnalibro per la pagina dopo è l’ultima email mostrata');
});

test('la pagina dopo arriva quando la si chiede, e l’ultima non ne promette altre', async () => {
  const p1 = await daFilo({});
  const p2 = await daFilo({ after: p1.next });
  assert.equal(p2.users.length, 50);
  assert.equal(p2.users[0].email, TUTTI[50].email, 'la seconda pagina riprende dove finiva la prima');
  const p3 = await daFilo({ after: p2.next });
  assert.equal(p3.users.length, 20, 'e l’ultima pagina rende quelli che restano');
  assert.equal(p3.users[19].email, TUTTI[119].email);
  assert.equal(p3.next, '', 'una pagina non piena è l’ultima: non deve offrire un «altri» che non esiste');
});

test('si scaricano solo i tre campi che la riga mostra, cinquanta alla volta', async () => {
  await daFilo({});
  const q = richieste.find((r) => r.url.includes(':runQuery')).body.structuredQuery;
  assert.deepEqual(q.select.fields.map((f) => f.fieldPath).sort(), ['balance', 'email', 'name'],
    'il saldo, il nome e l’email: il resto del documento (aggregati, ricompense, costo in euro) non deve viaggiare');
  assert.equal(q.limit, 50);
  assert.ok(!('offset' in q), 'l’offset a Firestore si paga come se i documenti saltati li avesse letti');
});

test('il totale si chiede con un conteggio, non scaricando i documenti', async () => {
  await daFilo({});
  const conta = richieste.find((r) => r.url.includes(':runAggregationQuery'));
  assert.ok(conta, 'senza la query di conteggio il totale tornerebbe a costare una lettura per iscritto');
  assert.deepEqual(conta.body.structuredAggregationQuery.aggregations, [{ alias: 'totale', count: {} }]);
  assert.ok(!conta.body.structuredAggregationQuery.structuredQuery.select,
    'un conteggio non proietta campi: non legge i documenti');
});

test('se il conteggio non arriva l’elenco si vede lo stesso', async () => {
  const vera = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes(':runAggregationQuery')) throw new Error('rete giù');
    return vera(url, opts);
  };
  const r = await daFilo({});
  assert.equal(r.ok, true);
  assert.equal(r.users.length, 50);
  assert.equal(r.total, null, 'senza totale si mostra l’elenco, non un errore');
});

test('un sito visitato non può chiedere l’elenco di chi usa Filo', async () => {
  const r = await elencoUtenti({}, { isShell: false }, 'https://sito-qualsiasi.example');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'forbidden');
});
