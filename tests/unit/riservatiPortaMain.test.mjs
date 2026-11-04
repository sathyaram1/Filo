// La routine riservati (#2069) nella porta del main: spenta e tetto arrivano al documento delle routine e tornano alla
// pagina, e l'ultima decisione del pacemaker passa dal server a Gestione insieme alle pause. Handler vero, rete finta:
// le chiamate a Firestore e alle callable si leggono come partono.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let handlers;
let MSG;
let chiamate = [];
let doc = {};
let pausa = {};
const fetchVero = globalThis.fetch;

const risposta = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const daFs = (v) => (typeof v === 'boolean' ? { booleanValue: v } : Number.isInteger(v) ? { integerValue: String(v) } : { stringValue: String(v) });
const aFs = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.booleanValue ?? (v.integerValue !== undefined ? Number(v.integerValue) : v.stringValue)]));

before(() => {
  process.env.FILO_FUNCTIONS_BASE = 'http://funzioni.prova';
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    chiamate.push({ url: u, method: opts.method || 'GET', body });
    if (u.startsWith('http://funzioni.prova/routineLog')) return risposta(200, { result: pausa });
    if (u.includes('/documents/config/routines')) {
      if (opts.method === 'PATCH') {
        const mask = [...new URL(u).searchParams.getAll('updateMask.fieldPaths')];
        for (const k of mask) doc[k] = aFs(body.fields)[k];
        return risposta(200, {});
      }
      return risposta(200, { fields: Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, daFs(v)])) });
    }
    return risposta(404, {});
  };
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
  require(join(ROOT, 'src', 'shared', 'routineSessioni.js'));
  MSG = globalThis.SN_MSG.MSG;
  const register = require(join(ROOT, 'src', 'main', 'services', 'handlers', 'auth.js'));
  handlers = new Map();
  register((type, fn) => handlers.set(type, fn), { MSG, broadcastToTabs() {}, broadcastToFiloPages() {}, broadcastLiveUpdate() {} });
});

after(() => {
  globalThis.fetch = fetchVero;
  delete process.env.FILO_FUNCTIONS_BASE;
});

function chiama(msg) {
  const h = handlers.get(msg.type);
  assert.ok(h, `il main non registra ${msg.type}`);
  chiamate = [];
  return h(msg, { isShell: true }, 'filo://manage/manage.html');
}

test('spenta e tetto vanno al documento delle routine, soli, e tornano alla pagina riletti', async () => {
  doc = { maxSessions: 4, accountAOff: true };
  const r = await chiama({ type: MSG.AUTOMATION_SESSIONS_SET, riservatiOff: true, riservatiTetto: '3' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const patch = chiamate.find((c) => c.method === 'PATCH');
  assert.ok(patch, 'nessuna scrittura partita');
  assert.deepEqual(new URL(patch.url).searchParams.getAll('updateMask.fieldPaths').sort(), ['riservatiOff', 'riservatiTetto']);
  assert.deepEqual([doc.riservatiOff, doc.riservatiTetto, doc.maxSessions, doc.accountAOff], [true, 3, 4, true]);
  assert.deepEqual([r.riservatiOff, r.riservatiTetto, r.maxSessions], [true, 3, 4]);
  const letto = await chiama({ type: MSG.AUTOMATION_SESSIONS_GET });
  assert.deepEqual([letto.riservatiOff, letto.riservatiTetto], [true, 3]);
  // Un tetto storto non parte.
  const storto = await chiama({ type: MSG.AUTOMATION_SESSIONS_SET, riservatiTetto: '0' });
  assert.equal(storto.ok, false);
  assert.equal(chiamate.filter((c) => c.method === 'PATCH').length, 0);
});

test('l’ultima decisione del pacemaker sulla riservati arriva alla pagina insieme alle pause di A e B', async () => {
  pausa = {
    pause: { riservatiA: { perche: 'http_402', finoMs: 5, account: 'A' }, riservatiB: { perche: 'http_429', finoMs: 6, account: 'B' } },
    voci: { riservati: { perche: 'riservati_paused', oggi: 2, percheMs: 7, oggiPerAccount: { A: 1, B: 1 } } },
    oraMs: 9,
  };
  const r = await chiama({ type: MSG.AUTOMATION_PAUSE_GET });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(chiamate[0].body, { data: { op: 'pause' } });
  assert.deepEqual(r.voci.riservati, { perche: 'riservati_paused', oggi: 2, percheMs: 7, oggiPerAccount: { A: 1, B: 1 } });
  assert.deepEqual([r.pause.riservatiA.perche, r.pause.riservatiB.perche], ['http_402', 'http_429']);
  assert.match(globalThis.SN_ROUTINE_SESSIONI.statoRiservati(r.voci.riservati), /^In pausa; accesa 2 volte oggi\.$/);
});
