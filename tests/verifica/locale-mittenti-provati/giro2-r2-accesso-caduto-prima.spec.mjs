// Verifica locale «mittenti provati», giro 2, rilievo 2: se l'accesso dell'owner è già caduto quando manda un
// feedback (il rinnovo l'ha fatto fallire un'altra parte di Filo), il feedback non parte da anonimo senza dirglielo.
// Rete finta nel main: niente Firestore vero; l'owner è una sessione finta nella cartella dati isolata.
import { test, expect } from '../../fixtures/electron.mjs';
import { resolve } from 'node:path';

const MAIN = resolve('src/main/main.js');

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

test('accesso dell\'owner revocato e scoperto altrove: il suo feedback dal riquadro non parte da utente anonimo in silenzio', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate((_e, MAIN) => {
    const req = process.getBuiltinModule('module').createRequire(MAIN);
    const cfg = req('./auth/config');
    req('./auth/token-store').save({ refreshToken: 'rt-revocato', email: cfg.adminEmails[0], name: 'Owner' });
    req('./auth/google-auth').restore();
    const t = { create: [] };
    globalThis.__g2 = t;
    const J = (s, b) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      const m = (init.method || 'GET').toUpperCase();
      if (u.includes('securetoken')) return J(400, { error: { message: 'TOKEN_EXPIRED' } });
      if (u.includes('/counters/')) return J(404, {});
      if (u.includes('/documents/feedback') && m === 'POST') {
        t.create.push(init.headers && init.headers.Authorization ? 'admin' : 'anonimo');
        return J(200, { name: 'projects/p/databases/(default)/documents/feedback/nuovo' });
      }
      return J(404, {});
    };
    globalThis.SN_FEEDBACK_OUTBOX.init({ backoffMin: 50, backoffMax: 100 });
  }, MAIN);
  expect(await app.evaluate((_e, MAIN) => process.getBuiltinModule('module').createRequire(MAIN)('./auth/google-auth').isAdmin(), MAIN)).toBe(true);

  // Un'altra parte di Filo chiede il token per prima: il rinnovo fallisce e la sessione si chiude.
  await app.evaluate(async (_e, MAIN) => {
    const ga = process.getBuiltinModule('module').createRequire(MAIN)('./auth/google-auth');
    await ga.getIdToken().catch(() => {});
  }, MAIN);

  const page = await newtabPage(app);
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  await page.locator('.sn-fb-text').fill('Feedback dell\'owner dopo che il suo accesso è caduto');
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 4_000 });

  await new Promise((r) => setTimeout(r, 3_000));
  const create = await app.evaluate(() => globalThis.__g2.create);
  expect(create, 'il feedback dell\'owner è partito da anonimo, come quello di un utente qualunque').not.toContain('anonimo');
});
