// Gestione → Automazioni: il tetto totale delle verifiche (#2338) arriva davvero a config/routines e si rilegge da lì,
// lungo la strada vera del main (handler e scrittura Firestore), senza toccare i bilanci accanto.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let handlers;
let MSG;
let campi;
let patch;

before(() => {
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

/** Un config/routines finto: la GET lo legge, la PATCH scrive solo i campi della maschera. */
async function conFirestore(iniziali, fn) {
  campi = { ...iniziali };
  patch = [];
  const vero = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    assert.match(u, /config\/routines/, `una chiamata fuori da config/routines: ${u}`);
    if ((opts.method || 'GET') === 'PATCH') {
      const mask = [...new URL(u).searchParams.getAll('updateMask.fieldPaths')];
      const body = JSON.parse(opts.body).fields;
      patch.push({ mask, body });
      for (const k of mask) campi[k] = body[k];
    }
    return { ok: true, status: 200, async json() { return { fields: campi }; }, async text() { return ''; } };
  };
  try { return await fn(); } finally { global.fetch = vero; }
}

const chiama = (msg) => handlers.get(msg.type)(msg, { isShell: true }, 'filo://manage/manage.html');

test('il tetto salvato da Gestione arriva in config/routines, solo lui, e si rilegge', async () => {
  await conFirestore({ cap3: { integerValue: '3' }, cap2: { integerValue: '1' }, cap1: { integerValue: '0' }, tettoVerifiche: { integerValue: '6' } }, async () => {
    const letto = await chiama({ type: MSG.AUTOMATION_CAPS_GET });
    assert.equal(letto.tettoVerifiche, 6, JSON.stringify(letto));
    const r = await chiama({ type: MSG.AUTOMATION_CAPS_SET, tettoVerifiche: 9 });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.tettoVerifiche, 9);
    assert.deepEqual(patch.map((p) => p.mask), [['tettoVerifiche']]);
    assert.equal(Number(campi.tettoVerifiche.integerValue), 9);
    assert.equal(campi.cap3.integerValue, '3');
    assert.equal((await chiama({ type: MSG.AUTOMATION_CAPS_GET })).tettoVerifiche, 9);
  });
});

test('l’intervallo del tetto è uno: quello che il server incorpora, ripetuto in Gestione, nel campo e nel ruolo', async () => {
  const fs = await import('node:fs');
  require(join(ROOT, 'src', 'shared', 'verifierRound.js'));
  const R = globalThis.SN_VERIFIER_ROUND;
  const A = globalThis.SN_CONST.AUTOMATION;
  assert.deepEqual([A.TETTO_VERIFICHE_MIN, A.TETTO_VERIFICHE_MAX], [R.TETTO_MIN, R.TETTO_MAX]);
  const html = fs.readFileSync(join(ROOT, 'src', 'pages', 'manage', 'manage.html'), 'utf8');
  const campo = html.match(/id="mgTettoVerifiche"[^>]*>/s);
  assert.ok(campo, 'il campo del tetto in Gestione');
  assert.match(campo[0], new RegExp(`min="${R.TETTO_MIN}" max="${R.TETTO_MAX}"`));
  const ruolo = fs.readFileSync(join(ROOT, 'routines', 'roles', 'manutentore.md'), 'utf8');
  assert.match(ruolo, new RegExp(`il tetto da ${R.TETTO_MIN} a ${R.TETTO_MAX}`));
  assert.match(ruolo, new RegExp(`da un tetto di ${R.TETTO_PARTENZA} verifiche`));
  // Fuori intervallo il salvataggio lo riporta dentro, coi limiti della fonte.
  await conFirestore({ cap3: { integerValue: '3' } }, async () => {
    const r = await chiama({ type: MSG.AUTOMATION_CAPS_SET, tettoVerifiche: R.TETTO_MAX + 7 });
    assert.equal(r.tettoVerifiche, R.TETTO_MAX, JSON.stringify(r));
  });
});

test('un documento senza il tetto lo dà vuoto, e un tetto non numerico non si scrive', async () => {
  await conFirestore({ cap3: { integerValue: '3' } }, async () => {
    assert.equal((await chiama({ type: MSG.AUTOMATION_CAPS_GET })).tettoVerifiche, null);
    const r = await chiama({ type: MSG.AUTOMATION_CAPS_SET, tettoVerifiche: 'tanti' });
    assert.equal(r.ok, false);
    assert.match(r.error, /tettoVerifiche/);
    assert.deepEqual(patch, []);
  });
});
