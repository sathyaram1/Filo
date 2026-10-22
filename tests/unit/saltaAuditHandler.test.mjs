// «Salta il controllo» passa dal main (src/main/services/handlers/auth.js): il commit che l'owner ha visto bocciato
// arriva al server insieme alla segnalazione, così il server salta solo quello (#1502). Stesso harness di
// mergeApprovalApproveHandler.test.mjs: handler vero, sessione da proprietario, server = un HTTP locale.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SHA = 'f00d'.repeat(10);

let server;
let handlers;
let MSG;
const arrivate = [];

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let data = {};
      try { data = JSON.parse(raw).data || {}; } catch (_) {}
      arrivate.push({ url: req.url, data });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: { ok: true, esito: 'fuso' } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.FILO_FUNCTIONS_BASE = `http://127.0.0.1:${server.address().port}`;

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
  const register = require(join(ROOT, 'src', 'main', 'services', 'handlers', 'auth.js'));
  handlers = new Map();
  register((type, fn) => handlers.set(type, fn), {
    MSG, broadcastToTabs() {}, broadcastToFiloPages() {}, broadcastLiveUpdate() {},
  });
});

after(async () => {
  delete process.env.FILO_FUNCTIONS_BASE;
  await new Promise((r) => server.close(r));
});

const salta = (extra) => handlers.get(MSG.LIVELLO4_SALTA)(
  Object.assign({ type: MSG.LIVELLO4_SALTA, feedbackId: 'fb1502' }, extra), { isShell: true }, 'filo://manage/manage.html');

test('il commit mostrato arriva al server col salto', async () => {
  arrivate.length = 0;
  const r = await salta({ sha: SHA });
  assert.equal(r.ok, true);
  assert.equal(arrivate.length, 1);
  assert.match(arrivate[0].url, /ownerSkipSecaudit/);
  assert.deepEqual(arrivate[0].data, { feedbackId: 'fb1502', sha: SHA });
});

test('uno sha storto si ferma nel main, senza chiamare il server', async () => {
  arrivate.length = 0;
  const r = await salta({ sha: 'main; rm -rf /' });
  assert.equal(r.ok, false);
  assert.match(r.error, /sha/);
  assert.equal(arrivate.length, 0);
});

test('senza sha (un pannello che non l’ha avuto dal server) parte la sola segnalazione', async () => {
  arrivate.length = 0;
  await salta({});
  assert.deepEqual(arrivate[0].data, { feedbackId: 'fb1502' });
});
