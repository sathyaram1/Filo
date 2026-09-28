// #708.1 giro 2, rilievo 1 — su KDE Filo usa solo KWallet (di proposito), quindi l'avviso
// non deve consigliare GNOME Keyring: installarlo lì non fa ricordare niente.

import { test, expect } from '../../fixtures/electron.mjs';

test.skip(process.platform !== 'linux', 'il consiglio sul portachiavi è solo di Linux');

test('su KDE senza KWallet l\'avviso consiglia KWallet, non GNOME Keyring', async ({ app, shell }) => {
  await app.evaluate(({ shell: sh, safeStorage }) => {
    process.env.XDG_CURRENT_DESKTOP = 'KDE';
    process.env.KDE_FULL_SESSION = 'true';
    safeStorage.isEncryptionAvailable = () => false;
    safeStorage.getSelectedStorageBackend = () => 'kwallet5';
    globalThis.__urlConsenso = null;
    sh.openExternal = async (url) => { globalThis.__urlConsenso = url; };
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const jwt = `${b64({ alg: 'none' })}.${b64({ user_id: 'u', sub: 'u', email: 'kde@prova.test' })}.x`;
    const vero = globalThis.fetch;
    const risposta = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    globalThis.fetch = async (input, init) => {
      const u = String(input && input.url ? input.url : input);
      if (u.startsWith('https://oauth2.googleapis.com/token')) return risposta({ id_token: jwt, access_token: 'a' });
      if (u.includes('accounts:signInWithIdp')) {
        return risposta({ idToken: jwt, refreshToken: 'rt', email: 'kde@prova.test', displayName: 'K', photoUrl: '', expiresIn: '3600' });
      }
      return vero(input, init);
    };
  });
  await shell.evaluate(() => { window.__esitoLogin = window.filoShell.auth.signIn(); });
  let url = null;
  const scade = Date.now() + 10_000;
  while (!url && Date.now() < scade) {
    url = await app.evaluate(() => globalThis.__urlConsenso);
    if (!url) await new Promise((r) => setTimeout(r, 100));
  }
  const p = new URL(url).searchParams;
  const ritorno = new URL(p.get('redirect_uri'));
  ritorno.searchParams.set('code', 'c');
  ritorno.searchParams.set('state', p.get('state'));
  await fetch(ritorno);
  expect((await shell.evaluate(() => window.__esitoLogin)).ok).toBe(true);

  const avviso = shell.locator('.shell-notif-msg', { hasText: 'dovrai accedere di nuovo' });
  await expect(avviso).toHaveCount(1, { timeout: 8_000 });
  await expect(avviso).toContainText('KWallet');
  await expect(avviso).not.toContainText('GNOME Keyring');
});
