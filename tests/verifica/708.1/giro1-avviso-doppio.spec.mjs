// #708.1 giro 1 — senza portachiavi: uscita e riaccesso non devono impilare due avvisi uguali.
import { test, expect } from '../../fixtures/electron.mjs';

const EMAIL = 'verifica@prova.test';

async function preparaLogin(app) {
  await app.evaluate(({ shell, safeStorage }, { email }) => {
    globalThis.__urlConsenso = null;
    shell.openExternal = async (url) => { globalThis.__urlConsenso = url; };
    safeStorage.isEncryptionAvailable = () => false;
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const jwt = `${b64({ alg: 'none' })}.${b64({ user_id: 'uid-v', sub: 'uid-v', email })}.x`;
    const vero = globalThis.fetch;
    const r = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    globalThis.fetch = async (input, init) => {
      const u = String(input && input.url ? input.url : input);
      if (u.startsWith('https://oauth2.googleapis.com/token')) return r({ id_token: jwt, access_token: 'a' });
      if (u.includes('accounts:signInWithIdp')) return r({ idToken: jwt, refreshToken: 'rt-v', email, displayName: 'V', photoUrl: '', expiresIn: '3600' });
      return vero(input, init);
    };
  }, { email: EMAIL });
}

async function accedi(app, shell) {
  await app.evaluate(() => { globalThis.__urlConsenso = null; });
  await shell.evaluate(() => { window.__esito = window.filoShell.auth.signIn(); });
  let url = null;
  const scade = Date.now() + 10_000;
  while (!url && Date.now() < scade) {
    url = await app.evaluate(() => globalThis.__urlConsenso);
    if (!url) await new Promise((res) => setTimeout(res, 100));
  }
  const p = new URL(url).searchParams;
  const ritorno = new URL(p.get('redirect_uri'));
  ritorno.searchParams.set('code', 'c');
  ritorno.searchParams.set('state', p.get('state'));
  await fetch(ritorno);
  return shell.evaluate(() => window.__esito);
}

test('uscita e riaccesso: l\'avviso torna, una volta sola a schermo', async ({ app, shell }) => {
  await preparaLogin(app);
  const primo = await accedi(app, shell);
  expect(primo.remembered).toBe(false);
  const avviso = shell.locator('.shell-notif-msg', { hasText: 'dovrai accedere di nuovo' });
  await expect(avviso).toHaveCount(1, { timeout: 8_000 });

  await shell.evaluate(() => window.filoShell.auth.signOut && window.filoShell.auth.signOut());
  const secondo = await accedi(app, shell);
  expect(secondo.ok).toBe(true);
  expect(secondo.remembered).toBe(false);
  await expect(avviso.first()).toBeVisible();
  await shell.waitForTimeout(1500);
  await expect(avviso).toHaveCount(1);
});
