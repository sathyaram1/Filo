// #1085 giro 3 — un rinnovo della sessione Google respinto da un proxy (403) non è la risposta del server
// alla chiamata che l'owner stava facendo: anche il segno del mittente deve dire che l'accesso non risponde.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/messages.js');
const guasti = require('../../../src/main/auth/guastiAccesso.js');

test('r1 segno del mittente con il rinnovo respinto da un proxy 403: niente «errore 403 del server»', async () => {
  const percorso = require.resolve('../../../src/main/auth/google-auth.js');
  require.cache[percorso] = {
    id: percorso, filename: percorso, loaded: true,
    exports: {
      isAdmin: () => true, isSignedIn: () => true,
      getIdToken: async () => { throw guasti.nonRaggiungibile(403); },
    },
  };
  const register = require('../../../src/main/services/handlers/auth.js');
  const porte = {};
  const ctx = new Proxy({ MSG: globalThis.SN_MSG.MSG, isAdmin: () => true }, {
    get: (t, k) => (k in t ? t[k] : () => {}),
  });
  try { register((tipo, fn) => { porte[tipo] = fn; }, ctx); } catch (_) {}
  const porta = porte[globalThis.SN_MSG.MSG.FEEDBACK_SENDER_FLAG];
  expect(porta).toBeTruthy();
  const r = await porta({ feedbackId: 'abc', action: 'read' }, { isShell: true }, 'filo://manage');
  expect(r.ok).toBe(false);
  expect(r.error).not.toMatch(/403/);
  expect(r.error).toMatch(/accesso/i);
});
