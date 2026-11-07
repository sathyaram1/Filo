// La porta del main verso ownerManutentore (handlers/auth.js, SPEC-MANUTENTORE § 9): il recap del giorno e la N del
// manutentore per Gestione → Automazioni. Due letture indipendenti: senza la N il recap resta. Harness di
// routineCrediti.test.mjs: handler vero, server HTTP locale.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── La porta del main ────────────────────────────────────────────────────────

let server;
let rispondi = () => ({ status: 200, body: { result: { ok: true } } });
let ricevute = [];
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
      getProfile: () => ({ email: 'owner@esempio' }), getUid: async () => 'uid-owner', getAccessToken: async () => '',
      onChange: () => () => {},
    },
  };
  require(join(ROOT, 'src', 'shared', 'constants.js'));
  require(join(ROOT, 'src', 'shared', 'messages.js'));
  MSG = globalThis.SN_MSG.MSG;
  const register = require(join(ROOT, 'src', 'main', 'services', 'handlers', 'auth.js'));
  handlers = new Map();
  register((type, fn) => handlers.set(type, fn), { MSG, broadcastToTabs() {}, broadcastToFiloPages() {}, broadcastLiveUpdate() {} });
});

after(async () => {
  delete process.env.FILO_FUNCTIONS_BASE;
  await new Promise((r) => server.close(r));
});

function chiama(msg) {
  const h = handlers.get(msg.type);
  assert.ok(h, `il main non registra ${msg.type}`);
  ricevute = [];
  return h(msg, { isShell: true }, 'filo://manage/manage.html');
}


const RECAP = { ok: true, recap: [{ giorno: '2026-10-31', testo: 'Fusioni: 7.', at: '2026-10-31T07:00:00Z' }, { giorno: 'storto', testo: 'x' }, { giorno: '2026-10-30', testo: 3 }] };
const STATO = { ok: true, parallelismo: 4, parallelismoEffettivo: 4, freno: 20, taccuino: 'mai alla pagina', segnali: [{ id: 's' }] };

test('il recap e la N arrivano alla pagina; i fogli storti no, e lo stato porta solo i tre numeri', async () => {
  rispondi = (d) => ({ status: 200, body: { result: d.op === 'recap' ? RECAP : STATO } });
  const r = await chiama({ type: MSG.MANUTENTORE_RECAP_GET });
  assert.deepEqual(ricevute.map((x) => [x.path, x.data.op]).sort(), [['/ownerManutentore', 'recap'], ['/ownerManutentore', 'stato']]);
  assert.equal(ricevute.find((x) => x.data.op === 'recap').data.limite, 30);
  assert.deepEqual(r, { ok: true, recap: [{ giorno: '2026-10-31', testo: 'Fusioni: 7.', at: '2026-10-31T07:00:00Z' }], stato: { parallelismo: 4, parallelismoEffettivo: 4, freno: 20 } });
});

test('senza la N il recap resta; senza il recap si dice perché; una funzione non pubblicata si dice', async () => {
  rispondi = (d) => (d.op === 'recap' ? { status: 200, body: { result: RECAP } } : { status: 500, body: {} });
  const r = await chiama({ type: MSG.MANUTENTORE_RECAP_GET });
  assert.equal(r.ok, true);
  assert.equal(r.stato, null);
  assert.equal(r.recap.length, 1);
  rispondi = () => ({ status: 404, body: {} });
  const n = await chiama({ type: MSG.MANUTENTORE_RECAP_GET });
  assert.equal(n.ok, false);
  assert.match(n.error, /non è ancora pubblicato sul server/);
  rispondi = () => ({ status: 200, body: { result: { ok: false, reason: 'malformed', detail: 'giorno è YYYY-MM-DD' } } });
  assert.deepEqual(await chiama({ type: MSG.MANUTENTORE_RECAP_GET }), { ok: false, error: 'giorno è YYYY-MM-DD' });
});
