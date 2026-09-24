// Il giro che tiene in pari la bacheca DENTRO Filo: quante letture costa una
// sola apertura di Gestione, e cosa chiede la seconda volta.
// Non deve fermare: la collezione è un doppio in memoria, niente rete.
// La regola narrata sta in `syncPublicView` (src/main/services/handlers/auth.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

// L'identità: qui siamo l'owner, sempre. Va messa nella cache dei moduli
// PRIMA di caricare l'handler, che la prende al caricamento.
const percorsoAuth = require.resolve(resolve(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
require.cache[percorsoAuth] = {
  id: percorsoAuth, filename: percorsoAuth, loaded: true, exports: {
    isAdmin: () => true,
    isSignedIn: () => true,
    getIdToken: async () => 'token-finto',
    getProfile: () => ({ email: 'owner@example.invalid' }),
    getTokenClaims: () => ({ email: 'owner@example.invalid' }),
    getUid: () => 'uid',
    uid: () => 'uid',
    signIn: async () => ({}),
    signOut: async () => ({}),
  },
};

for (const m of ['constants', 'feedback', 'feedbackCrypto', 'feedbackThread', 'feedbackPublicView', 'manageReview', 'feedbackStatus', 'feedbackTransitions']) {
  require(resolve(ROOT, 'src', 'shared', `${m}.js`));
}
const FB = globalThis.SN_FEEDBACK;
const MSG = require(resolve(ROOT, 'src', 'shared', 'messages.js')).MSG
  || globalThis.SN_MESSAGES || require(resolve(ROOT, 'src', 'shared', 'messages.js'));

// La memoria locale del main: qui basta una mappa.
const memoria = new Map();
globalThis.SN_STORAGE = {
  async getRaw(k, dflt) { return memoria.has(k) ? memoria.get(k) : dflt; },
  async setRaw(k, v) { memoria.set(k, v); },
};

const register = require(resolve(ROOT, 'src', 'main', 'services', 'handlers', 'auth.js'));

function feedbackChiuso(i, extra = {}) {
  return {
    _id: `fb${i}`,
    seq: i,
    subSeq: 0,
    name: `Segnalazione ${i}`,
    status: 'done',
    statusPublic: 'closed',
    resolvedInVersion: '0.2.70',
    createdAt: new Date(Date.UTC(2026, 8, 20) - i * 3600_000).toISOString(),
    resolvedAt: '2026-09-10T10:00:00Z',
    ...extra,
  };
}

// Registra gli handler su una porta finta e restituisce quello dei feedback,
// più il registro di cosa il giro ha chiesto alla collezione.
function apparecchia(feedbacks, schede) {
  memoria.clear();
  const conto = { letti: 0, chiamate: [], since: [], scritte: [], tolte: [] };
  const perData = feedbacks.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  FB.list = async ({ pageSize, fields }) => {
    conto.chiamate.push('list');
    conto.campiChiesti = fields || null;
    const righe = perData.slice(0, pageSize).map((f) => ({ ...f }));
    conto.letti += righe.length;
    return righe;
  };
  FB.listResolved = async ({ sinceIso }) => {
    conto.chiamate.push('listResolved');
    conto.since.push(String(sinceIso || ''));
    const righe = sinceIso
      ? feedbacks.filter((f) => String(f.resolvedAt || '') > sinceIso)
      : feedbacks.slice();
    conto.letti += righe.length;
    return righe.map((f) => ({ ...f }));
  };
  FB.listAllPublic = async () => { conto.chiamate.push('listAllPublic'); return schede.map((c) => ({ ...c })); };
  FB.listPublic = FB.listAllPublic;
  FB.forgetAllPublic = () => {};
  FB.getMany = async (ids) => {
    conto.chiamate.push(`getMany:${ids.length}`);
    const trovati = feedbacks.filter((f) => ids.includes(f._id));
    conto.letti += trovati.length;
    return trovati.map((f) => ({ ...f }));
  };
  FB.publishPublicCard = async (id, card) => { conto.scritte.push({ id, card }); return true; };
  FB.unpublishPublicCard = async (id) => { conto.tolte.push(id); return true; };
  FB.maxSeq = async () => { conto.chiamate.push('maxSeq'); conto.letti += 1; return feedbacks.length; };
  FB.ensureSeqCounter = async () => true;

  const porte = new Map();
  register((tipo, h) => porte.set(tipo, h), {
    MSG,
    broadcastToTabs: () => {},
    broadcastToFiloPages: () => {},
  });
  return { conto, porta: porte.get(MSG.FEEDBACK_FETCH) };
}

// Il giro parte due secondi dopo il caricamento: qui si aspetta che finisca.
async function aspettaIlGiro() {
  for (let i = 0; i < 60; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 100));
    if (globalThis.__sincroFatta) return;
  }
}

test('una sola apertura di Gestione non legge due volte le schede pubbliche', async () => {
  process.env.FILO_FEEDBACK_PRIVKEY = '';
  const feedbacks = Array.from({ length: 30 }, (_, i) => feedbackChiuso(i + 1));
  const schede = [];
  const { conto, porta } = apparecchia(feedbacks, schede);
  assert.ok(porta, 'la porta di lettura dei feedback deve esistere');

  const r = await porta({ op: 'list', pageSize: FB.LIST_PAGE_SIZE, fields: FB.CAMPI_LISTA }, null, 'filo://manage/manage.html');
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 30);
  // La proiezione arriva fino alla query: è lì che si risparmiano i byte.
  assert.deepEqual(conto.campiChiesti, FB.CAMPI_LISTA);

  // Il caricamento legge le schede una volta sola (per riunire voti e
  // riaperture). La seconda passata, quella che il giro faceva subito dopo
  // con `fresh`, non c'è più: il giro riusa queste.
  await new Promise((res) => setTimeout(res, 2500));
  const letture = conto.chiamate.filter((c) => c === 'listAllPublic').length;
  assert.ok(letture <= 1, `schede pubbliche lette ${letture} volte in un caricamento solo`);
});

test('il giro leggero del battito non tocca le schede pubbliche', async () => {
  const feedbacks = Array.from({ length: 5 }, (_, i) => feedbackChiuso(i + 1));
  const { conto, porta } = apparecchia(feedbacks, []);
  const r = await porta({ op: 'versions', pageSize: FB.LIST_PAGE_SIZE, fields: ['__name__'] }, null, 'filo://manage/manage.html');
  assert.equal(r.ok, true);
  assert.equal(conto.chiamate.filter((c) => c === 'listAllPublic').length, 0);
});

test('chi non arriva da una superficie di Filo non legge i feedback', async () => {
  const { porta } = apparecchia([feedbackChiuso(1)], []);
  const r = await porta({ op: 'list' }, null, 'https://sito.invalid/');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'forbidden');
});
