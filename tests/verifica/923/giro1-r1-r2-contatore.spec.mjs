// Verifica #923 giro 1: il giro di Gestione vero contro un Firestore in memoria con le regole del contatore.
// r2: un contatore mancante rinasce sotto i numeri dati. La prova di r1 è tolta per decisione dell'owner: la cura sta in un feedback a parte.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aspettaChe } from '../../helpers/attese.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);

const percorsoAuth = require.resolve(resolve(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
require.cache[percorsoAuth] = {
  id: percorsoAuth, filename: percorsoAuth, loaded: true, exports: {
    isAdmin: () => true,
    isSignedIn: () => true,
    getIdToken: async () => 'token-owner',
    getProfile: () => ({ email: 'owner@example.invalid' }),
    getTokenClaims: () => ({ email: 'owner@example.invalid' }),
    getUid: () => 'uid',
    uid: () => 'uid',
    signIn: async () => ({}),
    signOut: async () => ({}),
  },
};

for (const m of ['constants', 'feedbackPublicKey', 'feedbackCrypto', 'feedback', 'feedbackThread', 'feedbackPublicView', 'manageReview', 'feedbackStatus', 'feedbackTransitions']) {
  require(resolve(ROOT, 'src', 'shared', `${m}.js`));
}
const FB = globalThis.SN_FEEDBACK;
require(resolve(ROOT, 'src', 'shared', 'messages.js'));
const { MSG } = globalThis.SN_MSG;

const memoria = new Map();
globalThis.SN_STORAGE = {
  async getRaw(k, dflt) { return memoria.has(k) ? memoria.get(k) : dflt; },
  async setRaw(k, v) { memoria.set(k, v); },
};
process.env.FILO_FEEDBACK_PRIVKEY = 'chiave-finta-per-la-prova';

const register = require(resolve(ROOT, 'src', 'main', 'services', 'handlers', 'auth.js'));
const ensureVero = FB.ensureSeqCounter;

// `contatore: null` = il documento del contatore non esiste (404).
function firestore({ contatore, documenti }) {
  const db = { contatore, versione: 1, documenti: documenti.map((d) => ({ ...d })) };
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const metodo = opts.method || 'GET';
    const owner = /^Bearer /.test(String((opts.headers && opts.headers.Authorization) || ''));
    const corpo = opts.body ? JSON.parse(opts.body) : {};
    const risposta = (status, json) => ({ ok: status < 300, status, json: async () => json, text: async () => JSON.stringify(json) });
    if (u.pathname.endsWith('/counters/feedbackSeq')) {
      if (metodo === 'GET') {
        if (db.contatore === null) return risposta(404, { error: 'NOT_FOUND' });
        return risposta(200, { fields: { value: { integerValue: String(db.contatore) } }, updateTime: `v${db.versione}` });
      }
      const nuovo = Number(corpo.fields.value.integerValue);
      const attesa = u.searchParams.get('currentDocument.updateTime');
      if (attesa && attesa !== `v${db.versione}`) return risposta(400, { error: 'FAILED_PRECONDITION' });
      if (!owner && !(db.contatore !== null && nuovo === db.contatore + 1 && nuovo <= 1000000)) return risposta(403, { error: 'PERMISSION_DENIED' });
      db.contatore = nuovo;
      db.versione += 1;
      return risposta(200, {});
    }
    if (u.pathname.endsWith(':runQuery')) {
      if (!owner) return risposta(403, { error: 'PERMISSION_DENIED' });
      const top = db.documenti.filter((d) => Number.isInteger(d.seq)).sort((a, b) => b.seq - a.seq)[0];
      return risposta(200, top ? [{ document: { name: `x/feedback/${top._id}`, fields: { seq: { integerValue: String(top.seq) } } } }] : [{ readTime: 'T' }]);
    }
    throw new Error(`domanda non prevista: ${metodo} ${u.pathname}`);
  };

  const giro = { finito: false };
  FB.list = async () => db.documenti.map((d) => ({ ...d }));
  FB.listResolved = async () => [];
  FB.listAllPublic = async () => [];
  FB.listPublic = FB.listAllPublic;
  FB.forgetAllPublic = () => {};
  FB.getMany = async () => [];
  FB.publishPublicCard = async () => true;
  FB.unpublishPublicCard = async () => true;
  FB.ensureSeqCounter = async (...a) => { try { return await ensureVero(...a); } finally { giro.finito = true; } };

  const porte = new Map();
  register((tipo, h) => porte.set(tipo, h), { MSG, broadcastToTabs: () => {}, broadcastToFiloPages: () => {} });
  return { db, porta: porte.get(MSG.FEEDBACK_FETCH), giro };
}

const feedback = (id, seq, extra = {}) => ({
  _id: id, seq, subSeq: 0, name: `Segnalazione ${id}`, status: 'new', statusPublic: 'open',
  createdAt: new Date(Date.UTC(2026, 9, 1) - seq * 1000).toISOString(), ...extra,
});

async function apriGestione(f) {
  const r = await f.porta({ op: 'list', pageSize: FB.LIST_PAGE_SIZE, fields: FB.CAMPI_LISTA }, null, 'filo://manage/manage.html');
  expect(r.ok).toBe(true);
  await aspettaChe(() => f.giro.finito, { cosa: 'il giro di Gestione non è arrivato al contatore', oltreMs: 30000 });
}

test('r2 un contatore che manca rinasce sopra i numeri già dati, non sul solo numero provato', async () => {
  const f = firestore({
    contatore: null,
    documenti: [
      feedback('owner', 880, { senderProof: 'admin' }),
      feedback('utente', 900),
    ],
  });
  await apriGestione(f);
  expect(f.db.contatore, 'il prossimo feedback riprenderebbe un numero già dato').toBeGreaterThanOrEqual(900);
});
