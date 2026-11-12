// #1335 (ex #680.4): una pagina filo:// che chiede solo alcuni campi riceve quei campi, non il documento intero; un
// filtro che la porta delle pagine non sa portare si rifiuta a voce. Pagina, ponte e main veri; la rete è finta.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

const percorsoAuth = require.resolve(resolve(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
require.cache[percorsoAuth] = {
  id: percorsoAuth, filename: percorsoAuth, loaded: true, exports: {
    isAdmin: () => true, isSignedIn: () => true, getIdToken: async () => 'token-finto',
    getProfile: () => ({ email: 'owner@example.invalid' }), getTokenClaims: () => ({ email: 'owner@example.invalid' }),
    getUid: () => 'uid', uid: () => 'uid', signIn: async () => ({}), signOut: async () => ({}),
  },
};
for (const m of ['constants', 'feedback', 'feedbackCrypto', 'feedbackThread', 'feedbackPublicView', 'manageReview', 'feedbackStatus', 'feedbackTransitions', 'messages']) {
  require(resolve(ROOT, 'src', 'shared', `${m}.js`));
}
const FB = globalThis.SN_FEEDBACK;
const { MSG } = globalThis.SN_MSG;
globalThis.SN_STORAGE = { async getRaw(_k, d) { return d; }, async setRaw() {} };
const register = require(resolve(ROOT, 'src', 'main', 'services', 'handlers', 'auth.js'));
const porte = new Map();
register((tipo, h) => porte.set(tipo, h), { MSG, broadcastToTabs: () => {}, broadcastToFiloPages: () => {} });
const porta = porte.get(MSG.FEEDBACK_FETCH);

const NOME = (c, id) => `projects/filo-8b9cb/databases/(default)/documents/${c}/${id}`;
const INTERO = (id, i) => ({
  seq: { integerValue: String(i) }, status: { stringValue: 'done' }, statusPublic: { stringValue: 'closed' },
  text: { stringValue: 'testo cifrato lungo' }, notes: { stringValue: 'note' }, name: { stringValue: `Segnalazione ${i}` },
});
const DOCS = ['a', 'b', 'c'].map((id, i) => ({ name: NOME('feedback', id), fields: INTERO(id, i + 1), updateTime: '2026-10-01T00:00:00Z' }));
const SCHEDE = [{ name: NOME('feedback-public', 'a'), fields: { votes: { mapValue: { fields: { u: { mapValue: { fields: { vote: { stringValue: 'works' } } } } } } } } }];

const proietta = (doc, campi) => (campi && campi.length
  ? { ...doc, fields: Object.fromEntries(Object.entries(doc.fields).filter(([k]) => campi.includes(k))) }
  : doc);

// Firestore finto: onora select e mask come quello vero, e dice cosa gli è stato chiesto.
const chieste = [];
const veraFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const corpo = typeof init.body === 'string' ? JSON.parse(init.body) : {};
  const json = (dati) => ({ ok: true, status: 200, json: async () => dati, text: async () => JSON.stringify(dati) });
  if (u.includes(':runQuery')) {
    const sq = corpo.structuredQuery;
    const coll = sq.from[0].collectionId;
    const campi = sq.select ? sq.select.fields.map((f) => f.fieldPath) : null;
    chieste.push({ coll, campi });
    let arr = coll === 'feedback' ? DOCS : SCHEDE;
    const rif = sq.startAt && sq.startAt.values.find((v) => v.referenceValue);
    if (rif) arr = arr.filter((d) => d.name > rif.referenceValue.replace(/^.*?projects/, 'projects'));
    return json(arr.slice(0, sq.limit || arr.length).map((d) => ({ document: proietta(d, campi) })));
  }
  if (u.includes(':batchGet')) {
    const campi = corpo.mask ? corpo.mask.fieldPaths : null;
    chieste.push({ coll: 'batchGet', campi });
    return json(corpo.documents.map((n) => {
      const d = [...DOCS, ...SCHEDE].find((x) => n.endsWith(x.name.split('/documents/')[1]));
      return d ? { found: proietta(d, campi) } : { missing: n };
    }));
  }
  return { ok: false, status: 404, json: async () => ({}), text: async () => 'non gestito' };
};
after(() => { globalThis.fetch = veraFetch; delete globalThis.window; });

// Il ponte di una pagina filo://: il messaggio va al main, che legge senza il ponte (lì `window` non c'è).
globalThis.window = {
  filo: {
    message: async (m) => {
      const w = globalThis.window;
      delete globalThis.window;
      try { return await porta(m, null, 'filo://manage/manage.html'); } finally { globalThis.window = w; }
    },
  },
};

const CAMPI = ['seq', 'status'];
const campiDi = (riga) => Object.keys(riga).filter((k) => !k.startsWith('_')).sort();

test('una pagina che chiede due campi riceve due campi, da ogni lettura del ponte', async () => {
  const letture = {
    list: () => FB.list({ fields: CAMPI }),
    listAll: async () => (await FB.listAllPaged({ fields: CAMPI })).rows,
    'listAll della Gestione': async () => (await FB.listAllPaged({ fields: CAMPI, lista: true })).rows,
    getMany: () => FB.getMany(['a', 'b', 'c'], { fields: CAMPI }),
  };
  for (const [come, leggi] of Object.entries(letture)) {
    chieste.length = 0;
    // eslint-disable-next-line no-await-in-loop
    const righe = await leggi();
    assert.equal(righe.length, 3, `${come}: ${JSON.stringify(righe)}`);
    for (const r of righe) assert.deepEqual(campiDi(r), CAMPI, `${come}: la riga ${r._id} porta ${campiDi(r).join(', ')}`);
    const allaRete = chieste.filter((c) => c.coll !== 'feedback-public');
    assert.ok(allaRete.length > 0 && allaRete.every((c) => c.campi && c.campi.length === 2), `${come}: alla rete ${JSON.stringify(chieste)}`);
    assert.ok(!chieste.some((c) => c.coll === 'feedback-public'), `${come}: ha letto le schede pubbliche per campi che nessuno ha chiesto`);
  }
});

test('chi chiede i voti li riceve dalla scheda, come prima', async () => {
  const righe = await FB.list({ fields: ['seq', 'votes'] });
  const a = righe.find((r) => r._id === 'a');
  assert.deepEqual(campiDi(a), ['seq', 'votes']);
  assert.equal(a.votes.u.vote, 'works');
  const b = righe.find((r) => r._id === 'b');
  assert.deepEqual(campiDi(b), ['seq']);
});

test('un filtro sul server che la porta delle pagine non sa portare si rifiuta, invece di tornare tutto', async () => {
  await assert.rejects(
    () => FB.listAllPaged({ fields: CAMPI, uguale: { campo: 'statusPublic', valore: 'closed' } }),
    /filtro/,
  );
});
