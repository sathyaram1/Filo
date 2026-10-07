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
require(resolve(ROOT, 'src', 'shared', 'messages.js'));
const { MSG } = globalThis.SN_MSG;

// La memoria locale del main: qui basta una mappa.
const memoria = new Map();
globalThis.SN_STORAGE = {
  async getRaw(k, dflt) { return memoria.has(k) ? memoria.get(k) : dflt; },
  async setRaw(k, v) { memoria.set(k, v); },
};

// Senza chiave privata il giro si ferma prima di guardare la bacheca: qui i
// dati sono in chiaro, quindi la chiave non deve decifrare niente — deve solo
// esserci, come sulla macchina dell'owner.
process.env.FILO_FEEDBACK_PRIVKEY = 'chiave-finta-per-la-prova';

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
// più il registro di cosa il giro ha chiesto alla collezione. La memoria
// locale si azzera solo quando lo si chiede: fra un giro e l'altro è proprio
// lei a ricordare da quando ricontrollare le chiusure.
function apparecchia(feedbacks, schede, { azzeraMemoria = true } = {}) {
  if (azzeraMemoria) memoria.clear();
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

// Il giro parte due secondi dopo il caricamento. `maxSeq` è la sua ultima
// lettura: quando arriva, il giro è finito.
async function aspettaIlGiro(conto) {
  for (let i = 0; i < 80; i += 1) {
    if (conto.chiamate.includes('maxSeq')) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 100));
  }
  return conto.chiamate.includes('maxSeq');
}

const CARICA = { op: 'list', pageSize: FB.LIST_PAGE_SIZE, fields: FB.CAMPI_LISTA };
const DA_GESTIONE = 'filo://manage/manage.html';

test('una sola apertura di Gestione legge le schede pubbliche una volta sola', async () => {
  const feedbacks = Array.from({ length: 30 }, (_, i) => feedbackChiuso(i + 1));
  const { conto, porta } = apparecchia(feedbacks, []);
  assert.ok(porta, 'la porta di lettura dei feedback deve esistere');

  const r = await porta(CARICA, null, DA_GESTIONE);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 30);
  // La proiezione arriva fino alla query: è lì che si risparmiano i byte.
  assert.deepEqual(conto.campiChiesti, FB.CAMPI_LISTA);

  assert.equal(await aspettaIlGiro(conto), true, 'il giro della bacheca non è partito');
  const letture = conto.chiamate.filter((c) => c === 'listAllPublic').length;
  assert.equal(letture, 1, 'la seconda passata sulle schede era una lettura pagata due volte');
  // E i feedback non si rileggono: il giro riusa le righe del caricamento.
  assert.equal(conto.chiamate.filter((c) => c === 'list').length, 1);
  // Le schede si scrivono comunque: il risparmio non toglie niente al lavoro.
  assert.equal(conto.scritte.length, 30);
});

test('al giro dopo si chiedono le chiusure NUOVE, non le ultime cinquecento', async () => {
  const vecchi = Array.from({ length: 30 }, (_, i) => feedbackChiuso(i + 1, { resolvedAt: '2026-09-10T10:00:00Z' }));
  const primo = apparecchia(vecchi, []);
  await primo.porta(CARICA, null, DA_GESTIONE);
  assert.equal(await aspettaIlGiro(primo.conto), true);
  assert.deepEqual(primo.conto.since, [''], 'il primo giro non ha una data da cui ripartire');

  // Stessa memoria, giro nuovo: ora la data c'è. Una segnalazione chiusa DOPO
  // arriva; quelle chiuse prima non vengono nemmeno rilette.
  const chiusoOggi = feedbackChiuso(900, { _id: 'chiuso-oggi', resolvedAt: new Date().toISOString() });
  const secondo = apparecchia([...vecchi, chiusoOggi], [], { azzeraMemoria: false });
  await secondo.porta(CARICA, null, DA_GESTIONE);
  assert.equal(await aspettaIlGiro(secondo.conto), true);

  assert.equal(secondo.conto.since.length, 1);
  assert.notEqual(secondo.conto.since[0], '', 'la data dell_ultimo giro riuscito non è arrivata');
  assert.ok(Date.parse(secondo.conto.since[0]) <= Date.now(), 'data non valida');
  // Il feedback chiuso oggi ha la sua scheda.
  assert.ok(secondo.conto.scritte.some((s) => s.id === 'chiuso-oggi'),
    'una segnalazione chiusa dopo l_ultimo giro deve finire in bacheca');
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

test('una segnalazione fuori pagina con lo stato illeggibile non perde la scheda', async () => {
  // Il feedback della scheda c'è, ma il suo stato non si è potuto leggere: per
  // chi fa il piano è indistinguibile da uno cancellato. Toglierle la scheda
  // vorrebbe dire far sparire un fix buono dalla bacheca.
  const inPagina = Array.from({ length: 3 }, (_, i) => feedbackChiuso(i + 1));
  const illeggibile = {
    ...feedbackChiuso(900),
    _id: 'fb-cifrato',
    status: 'FENC1:blob-che-questa-macchina-non-apre',
    createdAt: '2020-01-01T00:00:00.000Z', // vecchio: fuori dalla pagina
  };
  const schede = [{
    _id: 'fb-cifrato', seq: 900, subSeq: 0, name: 'Un fix già in bacheca',
    status: 'done', statusPublic: 'closed', resolvedInVersion: '0.2.70',
  }];
  const { conto, porta } = apparecchia([...inPagina, illeggibile], schede);
  // La pagina per data d'invio si ferma ai tre recenti: il cifrato entra solo
  // come «scheda fuori pagina».
  await porta({ ...CARICA, pageSize: 3 }, null, DA_GESTIONE);
  assert.equal(await aspettaIlGiro(conto), true);
  assert.deepEqual(conto.tolte, [], 'la scheda di un fix illeggibile non si toglie');
});
