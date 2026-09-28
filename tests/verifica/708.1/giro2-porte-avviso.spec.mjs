// #708.1 giro 2 — le porte dell'avviso «accesso non ricordato», con la cifratura vera
// del contenitore (qui il portachiavi manca davvero): accesso da una pagina di Filo,
// riapertura, finestra incognito aperta accanto.

import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const EMAIL = 'chi.accede@prova.test';

async function lancia(userData) {
  return electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
}

// Solo la rete finta: la cifratura resta quella vera del sistema.
async function reteFinta(app) {
  await app.evaluate(({ shell }, { email }) => {
    globalThis.__urlConsenso = null;
    shell.openExternal = async (url) => { globalThis.__urlConsenso = url; };
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const jwt = `${b64({ alg: 'none' })}.${b64({ user_id: 'uid-prova', sub: 'uid-prova', email })}.x`;
    const vero = globalThis.fetch;
    const risposta = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    globalThis.fetch = async (input, init) => {
      const u = String(input && input.url ? input.url : input);
      if (u.startsWith('https://oauth2.googleapis.com/token')) return risposta({ id_token: jwt, access_token: 'a' });
      if (u.includes('accounts:signInWithIdp')) {
        return risposta({ idToken: jwt, refreshToken: 'rt-prova', email, displayName: 'Chi Accede', photoUrl: '', expiresIn: '3600' });
      }
      return vero(input, init);
    };
  }, { email: EMAIL });
}

async function completaConsenso(app) {
  let url = null;
  const scade = Date.now() + 10_000;
  while (!url && Date.now() < scade) {
    url = await app.evaluate(() => globalThis.__urlConsenso);
    if (!url) await new Promise((r) => setTimeout(r, 100));
  }
  expect(url, 'il login deve aprire il consenso nel browser di sistema').toBeTruthy();
  const p = new URL(url).searchParams;
  const ritorno = new URL(p.get('redirect_uri'));
  ritorno.searchParams.set('code', 'codice-prova');
  ritorno.searchParams.set('state', p.get('state'));
  await fetch(ritorno);
}

test('accesso da una pagina di Filo, portachiavi vero assente: avviso subito, e alla riapertura si è fuori', async () => {
  const userData = cartellaTemporanea('filo-708-');
  let app = await lancia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    expect(await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable())).toBe(false);
    await reteFinta(app);
    await shell.evaluate(() => window.filoShell.tabs.open('filo://redteam/redteam.html'));
    let pagina = null;
    const scade = Date.now() + 10_000;
    while (!pagina && Date.now() < scade) {
      pagina = app.windows().find((w) => w.url().startsWith('filo://redteam'));
      if (!pagina) await new Promise((r) => setTimeout(r, 100));
    }
    expect(pagina).toBeTruthy();
    await pagina.waitForLoadState('domcontentloaded');
    await pagina.evaluate(() => { window.__esito = new Promise((r) => chrome.runtime.sendMessage({ type: 'auth_signin' }, r)); });
    await completaConsenso(app);
    const esito = await pagina.evaluate(() => window.__esito);
    expect(esito.ok).toBe(true);
    const avviso = shell.locator('.shell-notif-msg', { hasText: 'dovrai accedere di nuovo' });
    await expect(avviso).toHaveCount(1, { timeout: 8_000 });

    await chiudiApp(app);
    app = await lancia(userData);
    const shell2 = await app.firstWindow();
    await shell2.waitForLoadState('domcontentloaded');
    const stato = await shell2.evaluate(() => window.filoShell.auth.status());
    expect(stato.signedIn).toBe(false);
  } finally {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

test('con una finestra incognito aperta: l\'avviso arriva in entrambe e all\'uscita se ne va da entrambe', async ({ app, shell }) => {
  await reteFinta(app);
  const prima = app.windows().length;
  await shell.evaluate(() => window.filoShell.window.openIncognito?.() ?? window.filoShell.openIncognito?.());
  let inco = null;
  const scade = Date.now() + 10_000;
  while (!inco && Date.now() < scade) {
    inco = app.windows().find((w) => w !== shell && /shell|index\.html/.test(w.url()) && w.url() !== shell.url() ? true : false) || null;
    if (!inco) {
      const tutte = app.windows();
      if (tutte.length > prima) inco = tutte.find((w) => w !== shell && w.url().startsWith('file:')) || null;
    }
    if (!inco) await new Promise((r) => setTimeout(r, 100));
  }
  test.skip(!inco, 'finestra incognito non trovata');
  await inco.waitForLoadState('domcontentloaded');
  await shell.evaluate(() => { window.__esitoLogin = window.filoShell.auth.signIn(); });
  await completaConsenso(app);
  await shell.evaluate(() => window.__esitoLogin);
  const a = shell.locator('.shell-notif-msg', { hasText: 'dovrai accedere di nuovo' });
  const b = inco.locator('.shell-notif-msg', { hasText: 'dovrai accedere di nuovo' });
  await expect(a).toHaveCount(1, { timeout: 8_000 });
  await expect(b).toHaveCount(1, { timeout: 8_000 });
  await shell.evaluate(() => window.filoShell.auth.signOut());
  await expect(a).toHaveCount(0, { timeout: 5_000 });
  await expect(b).toHaveCount(0, { timeout: 5_000 });
});
