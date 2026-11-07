// #1680.1 giro 9, rilievo 1: dalla Gestione la frase scritta su un pacchetto arriva alle unite, ma toglierla le lascia
// con la frase vecchia. Handler vero, SN_FEEDBACK finto, come tests/unit/fraseUniteGestione.test.mjs.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = resolve('.');

function handlerVero() {
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
  const MSG = globalThis.SN_MSG.MSG;
  const handlers = new Map();
  require(join(ROOT, 'src', 'main', 'services', 'handlers', 'auth.js'))((type, fn) => handlers.set(type, fn), {
    MSG, broadcastToTabs() {}, broadcastLiveUpdate() {}, broadcastToFiloPages() {},
  });
  return { h: handlers.get(MSG.FEEDBACK_UPDATE), MSG };
}

test('r1 la frase tolta da un pacchetto nella Gestione sparisce anche dalle unite che lui ha chiuso', async () => {
  const { h, MSG } = handlerVero();
  const docs = {
    P: { _id: 'P', status: 'done', unisce: [{ id: 'Q', num: '901' }] },
    Q: { _id: 'Q', status: 'done', statusReason: 'pacchetto', waitsFor: [{ id: 'P', num: '900' }], userNote: 'Frase sbagliata.' },
  };
  globalThis.SN_FEEDBACK = {
    statusToPublic: (s) => (['done', 'archived'].includes(s) ? 'closed' : 'open'),
    getMany: async (ids) => ids.map((id) => docs[id]).filter(Boolean).map((d) => ({ ...d })),
    updateStatus: async (id, campi) => { if ('userNote' in campi) docs[id].userNote = campi.userNote; },
  };
  const via = { isShell: true };
  expect((await h({ type: MSG.FEEDBACK_UPDATE, id: 'P', userNote: 'Frase sbagliata.' }, via, 'filo://manage/manage.html')).ok).toBe(true);
  expect(docs.Q.userNote).toBe('Frase sbagliata.');
  // L'owner si accorge che la frase non va e la toglie dal pacchetto: chi ha segnalato #901 non deve più leggerla.
  expect((await h({ type: MSG.FEEDBACK_UPDATE, id: 'P', userNote: '' }, via, 'filo://manage/manage.html')).ok).toBe(true);
  expect(docs.P.userNote).toBe('');
  expect(docs.Q.userNote, 'l\'unita #901 mostra ancora la frase tolta dal pacchetto').toBe('');
});
