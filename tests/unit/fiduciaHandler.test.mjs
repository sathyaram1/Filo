// Le due porte della pagina sulla corsia di un lavoro (#1424), nel main (handlers/auth.js): «💻 Lavoro locale» firma il
// segno `locale:<email>` (un `by` senza prefisso vale lavoro server, che concede solo il server), e il sì della fiducia
// riporta alla pagina se il server ha fatto ripartire il lavoro e il suo avviso. Harness di domandeHandler.test.mjs.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let server;
let rispondi = () => ({ status: 200, body: { result: { ok: true } } });
let ricevute = [];
let scritture = [];
let email = 'owner@esempio';
let handlers;
let MSG;

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let data = {};
      try { data = JSON.parse(raw).data || {}; } catch (_) {}
      ricevute.push({ path: req.url, data });
      const r = rispondi(data);
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.FILO_FUNCTIONS_BASE = `http://127.0.0.1:${server.address().port}`;

  const authPath = require.resolve(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
  require.cache[authPath] = {
    id: authPath, filename: authPath, loaded: true,
    exports: {
      isSignedIn: () => true, isAdmin: () => true, getIdToken: async () => 'token-di-prova',
      getProfile: () => ({ email }), getUid: async () => 'uid-owner', getAccessToken: async () => '',
      getTokenClaims: () => ({ email }), onChange: () => () => {},
    },
  };
  require(join(ROOT, 'src', 'shared', 'constants.js'));
  require(join(ROOT, 'src', 'shared', 'messages.js'));
  MSG = globalThis.SN_MSG.MSG;
  // Il deposito dei feedback finto: si guarda solo cosa il main ci scrive. Senza la vista pubblica la scheda non si rifà.
  globalThis.SN_FEEDBACK = {
    updateStatus: async (id, campi) => { scritture.push({ id, campi }); },
    statusToPublic: () => 'open',
    getMany: async () => [],
  };
  const register = require(join(ROOT, 'src', 'main', 'services', 'handlers', 'auth.js'));
  handlers = new Map();
  register((type, fn) => handlers.set(type, fn), { MSG, broadcastToTabs() {}, broadcastToFiloPages() {}, broadcastLiveUpdate() {} });
});

after(async () => {
  delete process.env.FILO_FUNCTIONS_BASE;
  delete globalThis.SN_FEEDBACK;
  await new Promise((r) => server.close(r));
});

function chiama(msg) {
  const h = handlers.get(msg.type);
  assert.ok(h, `il main non registra ${msg.type}`);
  ricevute = [];
  scritture = [];
  return h(msg, { isShell: true }, 'filo://manage/manage.html');
}

test('«💻 Lavoro locale»: il segno si firma `locale:` più l’email, così vale lavoro locale e mai lavoro server', async () => {
  email = 'owner@esempio';
  const r = await chiama({ type: MSG.FEEDBACK_UPDATE, id: 'fb-1', status: 'todo', localOnly: true, localApproval: true, by: 'server' });
  assert.equal(r.ok, true);
  assert.equal(r.by, 'locale:owner@esempio');
  assert.equal(scritture.length, 1);
  assert.equal(scritture[0].campi.localOnly.by, 'locale:owner@esempio', 'il `by` della pagina non passa');
  assert.ok(scritture[0].campi.localOnly.at > 0);
  assert.equal(scritture[0].campi.localApproval.by, 'owner@esempio');
  // Il segno lo legge la regola condivisa come lavoro locale.
  require(join(ROOT, 'src', 'shared', 'feedbackStatus.js'));
  require(join(ROOT, 'src', 'shared', 'manageReview.js'));
  const MR = globalThis.SN_MANAGE_REVIEW;
  assert.equal(MR.isLavoroLocale({ localOnly: scritture[0].campi.localOnly }), true);
  assert.equal(MR.isLavoroServer({ localOnly: scritture[0].campi.localOnly }), false);
});

test('«💻 Lavoro locale»: senza email il segno resta locale, e non supera il tetto delle regole', async () => {
  email = '';
  const senza = await chiama({ type: MSG.FEEDBACK_UPDATE, id: 'fb-2', localOnly: true });
  assert.equal(senza.by, 'locale:owner');
  email = `${'x'.repeat(200)}@esempio`;
  const lunga = await chiama({ type: MSG.FEEDBACK_UPDATE, id: 'fb-3', localOnly: true });
  assert.equal(lunga.by.length, 120);
  assert.match(lunga.by, /^locale:/);
  email = 'owner@esempio';
  // Togliere il segno resta togliere.
  await chiama({ type: MSG.FEEDBACK_UPDATE, id: 'fb-4', localOnly: false });
  assert.equal(scritture[0].campi.localOnly, null);
});

test('il sì della fiducia porta alla pagina «ripartito», «già» e l’avviso del server; il resto no', async () => {
  rispondi = () => ({ status: 200, body: { result: { ok: true, gia: true, ripartito: true, avviso: '  Il testo viene da fuori.  ', interno: 'x' } } });
  const r = await chiama({ type: MSG.FIDUCIA_SEGNA, feedbackId: 'fb-9' });
  assert.deepEqual(r, { ok: true, fiducia: 'fidato', gia: true, ripartito: true, avviso: 'Il testo viene da fuori.' });
  assert.equal(ricevute[0].path, '/ownerFiducia');
  assert.deepEqual(ricevute[0].data, { op: 'segna', feedbackId: 'fb-9' });

  rispondi = () => ({ status: 200, body: { result: { ok: true } } });
  assert.deepEqual(await chiama({ type: MSG.FIDUCIA_SEGNA, feedbackId: 'fb-9' }), { ok: true, fiducia: 'fidato' });
  rispondi = () => ({ status: 200, body: { result: { ok: true, ripartito: 'sì', avviso: 3 } } });
  assert.deepEqual(await chiama({ type: MSG.FIDUCIA_SEGNA, feedbackId: 'fb-9' }), { ok: true, fiducia: 'fidato' }, 'solo i tipi attesi');
});
