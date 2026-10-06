// #708.1 — senza portachiavi di sistema l'accesso vale solo fino alla chiusura:
// chi accede lo deve sapere SUBITO, non scoprirlo riaprendo Filo.
// Il login gira davvero (loopback, scambio del codice, Firebase) con le risposte
// di rete finte nel main; la cifratura del sistema si spegne o accende a comando.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '.shots');
const EMAIL = 'chi.accede@prova.test';

// `backend`: il portachiavi che Chromium ha scelto (qui Playwright impone quello di ripiego).
async function preparaLogin(app, { cifra, backend = 'gnome_libsecret' }) {
  await app.evaluate(({ shell, safeStorage }, { cifra, email, backend }) => {
    globalThis.__urlConsenso = null;
    shell.openExternal = async (url) => { globalThis.__urlConsenso = url; };
    safeStorage.isEncryptionAvailable = () => cifra;
    safeStorage.getSelectedStorageBackend = () => backend;
    if (cifra) {
      safeStorage.encryptString = (s) => Buffer.from(String(s), 'utf8');
      safeStorage.decryptString = (b) => Buffer.from(b).toString('utf8');
    }
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
  }, { cifra, email: EMAIL, backend });
}

// Avvia il login come fa la shell e completa il ritorno dal browser di sistema.
async function accedi(app, shell) {
  await app.evaluate(() => { globalThis.__urlConsenso = null; });
  await shell.evaluate(() => { window.__esitoLogin = window.filoShell.auth.signIn(); });
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
  return shell.evaluate(() => window.__esitoLogin);
}

async function vociMenuAccount(app, shell) {
  await shell.evaluate(() => document.getElementById('nav-account').click());
  const scade = Date.now() + 8_000;
  while (Date.now() < scade) {
    const popup = app.windows().find((w) => w.url().startsWith('data:text/html'));
    if (popup) {
      try {
        await popup.locator('.item').first().waitFor({ timeout: 1000 });
        return await popup.locator('.item').allInnerTexts();
      } catch (_) { /* popup non ancora pronto */ }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return [];
}

test('senza portachiavi: all\'accesso Filo dice subito che non verrà ricordato', async ({ app, shell, avvisi }) => {
  await preparaLogin(app, { cifra: false });
  const esito = await accedi(app, shell);
  expect(esito.ok, esito.error).toBe(true);
  expect(esito.profile.email).toBe(EMAIL);
  expect(esito.remembered).toBe(false);

  const vista = await avvisi();
  const avviso = vista.locator('.shell-notif-msg', { hasText: 'dovrai accedere di nuovo' });
  await expect(avviso).toBeVisible({ timeout: 8_000 });
  await expect(avviso).toContainText('portachiavi di sistema');
  if (process.platform === 'linux') {
    await expect(avviso).toContainText('GNOME Keyring');
    await expect(avviso).not.toContainText('KWallet');
  } else await expect(avviso).not.toContainText('GNOME Keyring');
  // Resta finché non lo si chiude: chi era nel browser a dare il consenso lo trova al ritorno.
  await shell.waitForTimeout(6_500);
  await expect(avviso).toBeVisible();
  mkdirSync(SHOTS, { recursive: true });
  await vista.screenshot({ path: join(SHOTS, 'accesso-non-ricordato.png') });

  const stato = await shell.evaluate(() => window.filoShell.auth.status());
  expect(stato.signedIn).toBe(true);
  expect(stato.remembered).toBe(false);

  const voci = await vociMenuAccount(app, shell);
  expect(voci.join('\n')).toContain('Accesso valido fino alla chiusura di Filo');
});

// Su KDE Filo usa solo KWallet: consigliare GNOME Keyring lì non fa ricordare niente.
test('su KDE senza KWallet l\'avviso consiglia KWallet e non GNOME Keyring', async ({ app, shell, avvisi }) => {
  test.skip(process.platform !== 'linux', 'il consiglio sul portachiavi è solo di Linux');
  await preparaLogin(app, { cifra: false, backend: 'kwallet5' });
  const esito = await accedi(app, shell);
  expect(esito.ok, esito.error).toBe(true);
  const vista = await avvisi();
  const avviso = vista.locator('.shell-notif-msg', { hasText: 'dovrai accedere di nuovo' });
  await expect(avviso).toBeVisible({ timeout: 8_000 });
  await expect(avviso).toContainText('KWallet');
  await expect(avviso).not.toContainText('GNOME Keyring');
});

// Con la cifratura di ripiego imposta da chi lancia Filo nessun portachiavi servirebbe.
test('con il ripiego imposto l\'avviso non consiglia niente da installare', async ({ app, shell, avvisi }) => {
  await preparaLogin(app, { cifra: false, backend: 'basic_text' });
  const esito = await accedi(app, shell);
  expect(esito.ok, esito.error).toBe(true);
  const vista = await avvisi();
  const avviso = vista.locator('.shell-notif-msg', { hasText: 'dovrai accedere di nuovo' });
  await expect(avviso).toBeVisible({ timeout: 8_000 });
  await expect(avviso).not.toContainText('installa');
});

test('col portachiavi: nessun avviso, e il menu account non ne parla', async ({ app, shell }) => {
  await preparaLogin(app, { cifra: true });
  const esito = await accedi(app, shell);
  expect(esito.ok, esito.error).toBe(true);
  expect(esito.remembered).toBe(true);

  const voci = await vociMenuAccount(app, shell);
  expect(voci.join('\n')).toContain(EMAIL);
  expect(voci.join('\n')).not.toContain('fino alla chiusura');
  await expect(shell.locator('.shell-notif-msg', { hasText: 'portachiavi' })).toHaveCount(0);
});

test('uscita e nuovo accesso: l\'avviso se ne va all\'uscita e non si raddoppia al rientro', async ({ app, shell }) => {
  await preparaLogin(app, { cifra: false });
  await accedi(app, shell);
  const avviso = shell.locator('.shell-notif-msg', { hasText: 'dovrai accedere di nuovo' });
  await expect(avviso).toHaveCount(1, { timeout: 8_000 });

  await shell.evaluate(() => window.filoShell.auth.signOut());
  await expect(avviso).toHaveCount(0, { timeout: 5_000 });

  const esito = await accedi(app, shell);
  expect(esito.remembered).toBe(false);
  await expect(avviso).toHaveCount(1, { timeout: 8_000 });
  const ancora = await accedi(app, shell);
  expect(ancora.ok).toBe(true);
  await shell.waitForTimeout(1_000);
  await expect(avviso).toHaveCount(1);
});
