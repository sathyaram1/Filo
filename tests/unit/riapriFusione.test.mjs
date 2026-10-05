// «Chiedi di nuovo la fusione» (#1038): una pratica ferma in design/l5 senza nessuna richiesta sul server.
// Il main rilegge ramo e stato dal documento, la punta da GitHub, e chiede a `ownerMerge` con l'id della
// pratica. Qui: la logica con dipendenze finte, e il gestore VERO del main contro un server finto.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'feedbackStatus.js'));
require(join(ROOT, 'src', 'shared', 'manageReview.js'));
const MR = globalThis.SN_MANAGE_REVIEW;
const { riapriFusione, puntaDaGitHub, esitoDaRisposta } = require(join(ROOT, 'src', 'main', 'services', 'riapriFusione.js'));

const SHA = 'a1b2c3d4'.repeat(5);
const FERMA = { _id: 'fb-952', branch: 'worker/Te5j-952', status: 'design', statusReason: 'l5' };

function deps(over = {}) {
  const chiamate = [];
  return {
    chiamate,
    d: {
      feedbackId: 'fb-952',
      leggiPratica: async () => ({ ...FERMA }),
      puntaDelRamo: async () => ({ stato: 'ok', sha: SHA }),
      chiedi: async (data) => { chiamate.push(data); return { ok: true, result: 'blocked', reason: 'guard_the_guards', requestId: 'req-952' }; },
      normalizeStatus: (fb) => MR.normalizeStatus(fb),
      ...over,
    },
  };
}

test('ferma senza richiesta: chiede la fusione del ramo della pratica, con la punta di GitHub e l’id', async () => {
  const { d, chiamate } = deps();
  const r = await riapriFusione(d);
  assert.deepEqual(chiamate, [{ branch: 'worker/Te5j-952', feedbackId: 'fb-952', sha: SHA }]);
  assert.equal(r.esito, 'richiesta');
  assert.equal(r.requestId, 'req-952');
});

test('una pratica non più ferma al cancello non fa partire niente', async () => {
  for (const doc of [{ ...FERMA, status: 'working', statusReason: null }, { ...FERMA, statusReason: 'secaudit' }]) {
    const { d, chiamate } = deps({ leggiPratica: async () => doc });
    assert.equal((await riapriFusione(d)).esito, 'non_ferma');
    assert.equal(chiamate.length, 0);
  }
});

test('ramo assente (sul documento o su GitHub) o col nome storto: niente richiesta, si dice', async () => {
  for (const over of [
    { leggiPratica: async () => ({ ...FERMA, branch: '' }) },
    { leggiPratica: async () => ({ ...FERMA, branch: '--force' }) },
    { leggiPratica: async () => ({ ...FERMA, branch: 'a/../b' }) },
    { puntaDelRamo: async () => ({ stato: 'assente' }) },
  ]) {
    const { d, chiamate } = deps(over);
    assert.equal((await riapriFusione(d)).esito, 'ramo_assente');
    assert.equal(chiamate.length, 0);
  }
});

test('GitHub muto: si chiede lo stesso, senza sha (la punta la risolve il server)', async () => {
  const { d, chiamate } = deps({ puntaDelRamo: async () => ({ stato: 'ignota', motivo: 'http_503' }) });
  await riapriFusione(d);
  assert.deepEqual(chiamate, [{ branch: 'worker/Te5j-952', feedbackId: 'fb-952' }]);
});

test('pratica che non c’è, o id mancante', async () => {
  assert.equal((await riapriFusione(deps({ leggiPratica: async () => null }).d)).esito, 'feedback_assente');
  assert.equal((await riapriFusione(deps({ feedbackId: '  ' }).d)).ok, false);
});

test('esitoDaRisposta: blocco senza richiesta è un esito suo, non una richiesta', () => {
  assert.equal(esitoDaRisposta({ ok: true, result: 'blocked', reason: 'x' }).esito, 'senza_richiesta');
  assert.equal(esitoDaRisposta({ ok: true, result: 'blocked', requestId: ' ' }).esito, 'senza_richiesta');
  assert.equal(esitoDaRisposta({ ok: true, result: 'merged', sha: SHA }).esito, 'fuso');
  assert.equal(esitoDaRisposta({ ok: true, result: 'conflict' }).esito, 'conflitto');
  assert.equal(esitoDaRisposta({ ok: true, result: 'stale' }).esito, 'ramo_mosso');
  assert.equal(esitoDaRisposta({ ok: true, result: 'unit_rossi' }).esito, 'unit_rossi');
  assert.equal(esitoDaRisposta({ ok: false, reason: 'github_no_token' }).esito, 'senza_credenziale');
  assert.equal(esitoDaRisposta({ ok: false, reason: 'github_502' }).esito, 'server_giu');
  assert.equal(esitoDaRisposta({ ok: true, result: 'boh' }).esito, 'inatteso');
});

test('puntaDaGitHub: 404 è un ramo assente, 200 dà lo sha, e le barre del nome restano barre', async () => {
  let url = '';
  const finto = (status, body) => async (u) => { url = u; return { status, ok: status === 200, json: async () => body }; };
  assert.deepEqual(await puntaDaGitHub('worker/x y', { fetchImpl: finto(404, {}), base: 'https://gh', repo: 'o/r' }), { stato: 'assente' });
  assert.equal(url, 'https://gh/repos/o/r/git/ref/heads/worker/x%20y');
  assert.deepEqual(await puntaDaGitHub('worker/1', { fetchImpl: finto(200, { object: { sha: SHA } }), base: 'https://gh', repo: 'o/r' }), { stato: 'ok', sha: SHA });
  assert.equal((await puntaDaGitHub('worker/1', { fetchImpl: finto(200, [{ object: { sha: SHA } }]), base: 'https://gh', repo: 'o/r' })).stato, 'ignota');
  assert.equal((await puntaDaGitHub('worker/1', { fetchImpl: async () => { throw new TypeError('fetch failed'); }, base: 'https://gh', repo: 'o/r' })).stato, 'ignota');
});

// ── Il gestore vero del main, contro un server finto ─────────────────────────

let server;
let rispostaFusione = null;
let statoFusione = 200;
let ramoSuGitHub = true;
const arrivate = [];
let handlers;
let MSG;

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/repos/')) {
        arrivate.push({ url: req.url });
        if (!ramoSuGitHub) { res.statusCode = 404; return res.end('{}'); }
        return res.end(JSON.stringify({ object: { sha: SHA } }));
      }
      let data = {};
      try { data = JSON.parse(raw).data || {}; } catch (_) {}
      arrivate.push({ url: req.url, data });
      if (req.url === '/ownerMerge') {
        res.statusCode = statoFusione;
        return res.end(JSON.stringify(statoFusione === 200 ? { result: rispostaFusione } : { error: { message: 'non trovato', status: 'NOT_FOUND' } }));
      }
      res.end(JSON.stringify({ result: { ok: true, pending: [], failed: [], recent: [] } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_GITHUB_API = base;

  const authPath = require.resolve(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
  require.cache[authPath] = {
    id: authPath, filename: authPath, loaded: true,
    exports: {
      isSignedIn: () => true,
      isAdmin: () => true,
      getIdToken: async () => 'token-di-prova',
      getProfile: () => ({ email: 'owner@esempio' }),
      getUid: async () => 'uid-owner',
      getAccessToken: async () => '',
      onChange: () => () => {},
    },
  };
  require(join(ROOT, 'src', 'shared', 'constants.js'));
  require(join(ROOT, 'src', 'shared', 'messages.js'));
  MSG = globalThis.SN_MSG.MSG;
  // Il documento come lo legge il main: ramo e stato della pratica, non quelli che dice la pagina.
  globalThis.SN_FEEDBACK = { getMany: async (ids) => ids.filter((id) => id === FERMA._id).map(() => ({ ...FERMA })) };

  const register = require(join(ROOT, 'src', 'main', 'services', 'handlers', 'auth.js'));
  handlers = new Map();
  register((type, fn) => handlers.set(type, fn), {
    MSG, broadcastToTabs() {}, broadcastToFiloPages() {}, broadcastLiveUpdate() {},
  });
});

after(async () => {
  delete process.env.FILO_FUNCTIONS_BASE;
  delete process.env.FILO_GITHUB_API;
  delete globalThis.SN_FEEDBACK;
  await new Promise((r) => server.close(r));
});

function riapri(msg, origine = 'filo://manage/manage.html') {
  const h = handlers.get(MSG.MERGE_APPROVAL_REOPEN);
  assert.ok(h, 'il main non registra il gestore');
  return h({ type: MSG.MERGE_APPROVAL_REOPEN, ...msg }, { isShell: true }, origine);
}

test('gestore: il ramo viene dal documento, non dalla pagina; al server arrivano ramo, punta e pratica', async () => {
  arrivate.length = 0;
  rispostaFusione = { ok: true, result: 'blocked', reason: 'guard_the_guards', requestId: 'req-952' };
  const r = await riapri({ feedbackId: 'fb-952', branch: 'main' });
  assert.equal(r.esito, 'richiesta', JSON.stringify(r));
  assert.equal(r.requestId, 'req-952');
  const gh = arrivate.find((a) => a.url.startsWith('/repos/'));
  assert.match(gh.url, /\/git\/ref\/heads\/worker\/Te5j-952$/);
  const fusione = arrivate.find((a) => a.url === '/ownerMerge');
  assert.deepEqual(fusione.data, { branch: 'worker/Te5j-952', feedbackId: 'fb-952', sha: SHA });
});

test('gestore: il server ferma ma non registra la richiesta → si dice, non «richiesta aperta»', async () => {
  rispostaFusione = { ok: true, result: 'blocked', reason: 'guard_the_guards' };
  const r = await riapri({ feedbackId: 'fb-952' });
  assert.equal(r.esito, 'senza_richiesta');
  assert.equal(MR.esitoRiapriFusione(r, '').kind, 'err');
});

test('gestore: ramo sparito da GitHub → niente richiesta al server', async () => {
  arrivate.length = 0;
  ramoSuGitHub = false;
  try {
    const r = await riapri({ feedbackId: 'fb-952' });
    assert.equal(r.esito, 'ramo_assente');
    assert.equal(arrivate.filter((a) => a.url === '/ownerMerge').length, 0);
  } finally { ramoSuGitHub = true; }
});

test('gestore: funzione non pubblicata (404) detta per nome', async () => {
  statoFusione = 404;
  try {
    assert.equal((await riapri({ feedbackId: 'fb-952' })).esito, 'non_pubblicata');
  } finally { statoFusione = 200; }
});

test('gestore: un sito visitato non arriva a chiedere niente', async () => {
  arrivate.length = 0;
  const r = await riapri({ feedbackId: 'fb-952' }, 'https://evil.example/pagina');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'forbidden');
  assert.equal(arrivate.length, 0);
});
