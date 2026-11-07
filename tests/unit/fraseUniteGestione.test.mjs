// La frase di un pacchetto scritta dalla Gestione (feedback_update { userNote }) arriva alle sue unite a ogni livello,
// con la stessa regola della riga di comando (SN_FB_ATTESE.uniteDellaFrase). Handler vero, SN_FEEDBACK finto.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let handlers;
let MSG;

before(() => {
  const authPath = require.resolve(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
  require.cache[authPath] = {
    id: authPath, filename: authPath, loaded: true,
    exports: {
      isSignedIn: () => true, isAdmin: () => true, getIdToken: async () => 'token-di-prova',
      getProfile: () => ({ email: 'owner@esempio' }), getUid: async () => 'uid-owner', getAccessToken: async () => '',
      getTokenClaims: () => ({ email: 'owner@esempio' }), onChange: () => () => {},
    },
  };
  for (const f of ['constants.js', 'messages.js', 'feedbackTransitions.js', 'feedbackStatus.js', 'feedbackAttese.js']) require(join(ROOT, 'src', 'shared', f));
  MSG = globalThis.SN_MSG.MSG;
  const register = require(join(ROOT, 'src', 'main', 'services', 'handlers', 'auth.js'));
  handlers = new Map();
  register((type, fn) => handlers.set(type, fn), { MSG, broadcastToTabs() {}, broadcastLiveUpdate() {}, broadcastToFiloPages() {} });
});

function feedbackFinto(docs) {
  const scritte = [];
  globalThis.SN_FEEDBACK = {
    statusToPublic: (s) => (['done', 'archived'].includes(s) ? 'closed' : 'open'),
    getMany: async (ids) => ids.map((id) => docs[id]).filter(Boolean).map((d) => ({ ...d })),
    updateStatus: async (id, campi) => { scritte.push([id, campi.userNote]); },
  };
  return scritte;
}

test('la frase salvata su un pacchetto dalla Gestione arriva alle unite chiuse da lui, anche dentro un pacchetto unito', async () => {
  const fatto = (id, extra) => ({ _id: id, status: 'done', statusReason: 'pacchetto', ...extra });
  const scritte = feedbackFinto({
    P: { _id: 'P', status: 'done', unisce: [{ id: 'Q', num: '901' }, { id: 'R', num: '903' }] },
    Q: fatto('Q', { waitsFor: [{ id: 'P', num: '900' }], unisce: [{ id: 'U', num: '902' }] }),
    U: fatto('U', { waitsFor: [{ id: 'Q', num: '901' }] }),
    R: fatto('R', { waitsFor: [{ id: 'X', num: '700' }] }),
  });
  const r = await handlers.get(MSG.FEEDBACK_UPDATE)({ type: MSG.FEEDBACK_UPDATE, id: 'P', userNote: '  Ora il menu si apre.  ' }, { isShell: true }, 'filo://manage/manage.html');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.unite, { aggiornate: ['901', '902'], fallite: [] }, '#903 l\'ha chiusa un altro pacchetto');
  assert.deepEqual(scritte, [['P', '  Ora il menu si apre.  '], ['Q', 'Ora il menu si apre.'], ['U', 'Ora il menu si apre.']]);
});

test('una frase vuota, o su un feedback che non unisce niente, non tocca nessun altro', async () => {
  const scritte = feedbackFinto({ A: { _id: 'A', status: 'done' }, P: { _id: 'P', status: 'done', unisce: [{ id: 'Q', num: '901' }] } });
  const h = handlers.get(MSG.FEEDBACK_UPDATE);
  assert.deepEqual(await h({ type: MSG.FEEDBACK_UPDATE, id: 'A', userNote: 'Fatto.' }, { isShell: true }, 'filo://manage/manage.html'), { ok: true });
  assert.deepEqual(await h({ type: MSG.FEEDBACK_UPDATE, id: 'P', userNote: '' }, { isShell: true }, 'filo://manage/manage.html'), { ok: true });
  assert.deepEqual(scritte.map(([id]) => id), ['A', 'P']);
});
