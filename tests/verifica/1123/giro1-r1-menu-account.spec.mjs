// #1123 giro 1, rilievo 1: il menu dell'account aspetta il rinnovo del token prima di aprirsi.
import { test, expect } from '../../fixtures/electron.mjs';
import { googleFinto, risposteFinte, schedeSu, indirizzoDellAccesso } from '../../helpers/googleFinto.mjs';

const EMAIL = 'chi.accede@prova.test';

async function paginaDi(app, prefisso) {
  const scade = Date.now() + 10_000;
  while (Date.now() < scade) {
    const p = app.windows().find((w) => { try { return w.url().startsWith(prefisso + '?'); } catch (_) { return false; } });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('nessuna pagina d\'accesso');
}

test('r1 menu dell\'account: si apre senza aspettare la rete', async ({ app, shell, testServer }) => {
  const pagina = await googleFinto(app, testServer);
  await app.evaluate((_e, email) => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const jwt = `${b64({ alg: 'none' })}.${b64({ user_id: 'uid-prova', sub: 'uid-prova', email })}.x`;
    const vero = globalThis.fetch;
    const risposta = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    globalThis.fetch = async (input, init) => {
      const u = String(input && input.url ? input.url : input);
      if (u.startsWith('https://oauth2.googleapis.com/token')) return risposta({ id_token: jwt });
      if (u.includes('accounts:signInWithIdp')) return risposta({ idToken: jwt, refreshToken: 'rt', email, displayName: 'X', expiresIn: '60' });
      if (u.includes('securetoken')) { await new Promise((r) => setTimeout(r, 4000)); return risposta({ id_token: jwt, expires_in: '3600' }); }
      return vero(input, init);
    };
  }, EMAIL);
  await shell.evaluate(() => { window.__esito = window.filoShell.auth.signIn(); });
  await (await paginaDi(app, pagina)).locator('#continua').click();
  expect((await shell.evaluate(() => window.__esito)).ok).toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) { try { if (w.webContents.getURL().startsWith('data:text/html')) w.destroy(); } catch (_) {} }
  });
  const t0 = Date.now();
  await shell.evaluate(() => document.getElementById('nav-account').click());
  let ms = null;
  const scade = Date.now() + 10_000;
  while (Date.now() < scade) {
    const popup = app.windows().find((w) => { try { return w.url().startsWith('data:text/html'); } catch (_) { return false; } });
    if (popup) { try { await popup.locator('.item').first().waitFor({ timeout: 200 }); ms = Date.now() - t0; break; } catch (_) {} }
    await new Promise((r) => setTimeout(r, 50));
  }
  expect(ms).not.toBeNull();
  expect(ms, 'il menu aspetta il rinnovo del token').toBeLessThan(1500);
});
