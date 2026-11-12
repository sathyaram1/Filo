// #923: il numero scelto da chi manda un feedback senza account non arriva al
// contatore. Il giro di Gestione gira davvero (src/main/services/handlers/auth.js)
// contro un Firestore in memoria che applica le regole del contatore. Le altre
// due porte (backfill, vista pubblica) stanno nei loro file di prova.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aspettaChe } from '../helpers/attese.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

// Qui siamo l'owner: l'identità va in cache PRIMA dell'handler, che la prende al caricamento.
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
// Il giro si ferma senza chiave privata; i dati qui sono in chiaro.
process.env.FILO_FEEDBACK_PRIVKEY = 'chiave-finta-per-la-prova';

const register = require(resolve(ROOT, 'src', 'main', 'services', 'handlers', 'auth.js'));
const ensureVero = FB.ensureSeqCounter;

// Firestore in memoria: la collezione dei feedback e il contatore, con le
// regole di firestore.rules sul contatore (owner: qualunque intero; chiunque
// altro: avanti di uno, fino a un milione, sulla versione che ha letto). `contatore: null`: non esiste.
function firestore({ contatore, documenti }) {
  const db = { contatore, versione: 1, documenti: documenti.map((d) => ({ ...d })), creati: [] };
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const metodo = opts.method || 'GET';
    const owner = /^Bearer /.test(String((opts.headers && opts.headers.Authorization) || ''));
    const corpo = opts.body ? JSON.parse(opts.body) : {};
    const risposta = (status, json) => ({ ok: status < 300, status, json: async () => json, text: async () => JSON.stringify(json) });
    if (u.pathname.endsWith('/counters/feedbackSeq')) {
      const stato = { fields: { value: { integerValue: String(db.contatore) } }, updateTime: `v${db.versione}` };
      if (metodo === 'GET') return db.contatore === null ? risposta(404, { error: 'NOT_FOUND' }) : risposta(200, stato);
      const nuovo = Number(corpo.fields.value.integerValue);
      const attesa = u.searchParams.get('currentDocument.updateTime');
      if (attesa && attesa !== stato.updateTime) return risposta(400, { error: 'FAILED_PRECONDITION' });
      if (!owner && !(db.contatore !== null && nuovo === db.contatore + 1 && nuovo <= 1000000)) return risposta(403, { error: 'PERMISSION_DENIED' });
      db.contatore = nuovo;
      db.versione += 1;
      return risposta(200, {});
    }
    if (u.pathname.endsWith(':runQuery')) {
      if (!owner) return risposta(403, { error: 'PERMISSION_DENIED' });
      const q = corpo.structuredQuery;
      assert.equal(q.orderBy[0].field.fieldPath, 'seq');
      const top = db.documenti.filter((d) => Number.isInteger(d.seq)).sort((a, b) => b.seq - a.seq)[0];
      return risposta(200, top ? [{ document: { name: `x/feedback/${top._id}`, fields: { seq: { integerValue: String(top.seq) } } } }] : [{ readTime: 'T' }]);
    }
    // La create passa da `:commit` (#1517): id e campi stanno nella scrittura.
    if (metodo === 'POST' && u.pathname.endsWith(':commit')) {
      const w = corpo.writes[0];
      const seq = w.update.fields.seq ? Number(w.update.fields.seq.integerValue) : null;
      const id = w.update.name.split('/').pop();
      db.creati.push({ id, seq, owner });
      return risposta(200, { writeResults: [{}] });
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
  // Quello vero, con un segnale di fine: è l'ultimo passo del giro.
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
  assert.equal(r.ok, true);
  await aspettaChe(() => f.giro.finito, { cosa: 'il giro di Gestione non è arrivato al contatore' });
}

test('un feedback anonimo a 1.000.000 non sposta il contatore, e il feedback dopo prende il 901', async () => {
  const f = firestore({
    contatore: 900,
    documenti: [
      feedback('owner', 880, { senderProof: 'admin' }),
      feedback('utente', 900),
      feedback('estraneo', 1000000),
    ],
  });
  await apriGestione(f);
  assert.equal(f.db.contatore, 900, 'il numero scelto da chi manda è arrivato al contatore');

  const r = await FB.submit({ text: 'il prossimo', submissionId: 'dopo-la-sincro' });
  assert.equal(r.seq, 901);
  assert.deepEqual(f.db.creati.map((c) => c.seq), [901]);
});

test('un numero con la prova del mittente oltre il contatore lo alza ancora, e solo fin lì', async () => {
  const f = firestore({
    contatore: 900,
    documenti: [
      feedback('owner', 950, { senderProof: 'admin' }),
      feedback('estraneo', 1000000),
    ],
  });
  await apriGestione(f);
  assert.equal(f.db.contatore, 950);
  assert.equal(await FB.nextSeq(), 951);
});

test('un contatore gonfiato di uno in uno torna ancora giù, fino al numero più alto in uso', async () => {
  const f = firestore({
    contatore: 5000,
    documenti: [
      feedback('owner', 880, { senderProof: 'admin' }),
      feedback('utente', 900),
    ],
  });
  await apriGestione(f);
  assert.equal(f.db.contatore, 900);
  assert.equal(await FB.nextSeq(), 901);
});

test('un contatore che manca rinasce oltre ogni numero in uso, non sul solo numero provato', async () => {
  const f = firestore({
    contatore: null,
    documenti: [
      feedback('owner', 880, { senderProof: 'admin' }),
      feedback('utente', 900),
    ],
  });
  await apriGestione(f);
  assert.equal(f.db.contatore, 900, 'dal solo numero provato i prossimi invii riprenderebbero numeri già dati');
  assert.equal(await FB.nextSeq(), 901);
});
