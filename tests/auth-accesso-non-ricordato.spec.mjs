// #708.1 — senza portachiavi di sistema l'accesso vale solo fino alla chiusura:
// chi accede lo deve sapere SUBITO, non scoprirlo riaprendo Filo.
// Il login gira davvero (loopback, scambio del codice, Firebase) con le risposte
// di rete finte nel main; la cifratura del sistema si spegne o accende a comando.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { googleFinto, risposteFinte, schedeSu, indirizzoDellAccesso, rispondiAlLoopback } from './helpers/googleFinto.mjs';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '.shots');
const EMAIL = 'chi.accede@prova.test';

// `backend`: il portachiavi che Chromium ha scelto (qui Playwright impone quello di ripiego).
// Le pagine d'accesso di Google sono finte e si aprono in una scheda (#1123).
let paginaAccesso = '';
async function preparaLogin(app, testServer, { cifra, backend = 'gnome_libsecret' }) {
  paginaAccesso = await googleFinto(app, testServer);
  await risposteFinte(app, EMAIL);
  await app.evaluate(({ safeStorage }, { cifra, backend }) => {
    safeStorage.isEncryptionAvailable = () => cifra;
    safeStorage.getSelectedStorageBackend = () => backend;
    if (cifra) {
      safeStorage.encryptString = (s) => Buffer.from(String(s), 'utf8');
      safeStorage.decryptString = (b) => Buffer.from(b).toString('utf8');
    }
  }, { cifra, backend });
}

// Avvia il login come fa la shell e completa il ritorno al loopback, come lo farebbe Google.
async function accedi(app, shell) {
  await expect.poll(() => schedeSu(app, paginaAccesso).then((s) => s.length)).toBe(0);
  await shell.evaluate(() => { window.__esitoLogin = window.filoShell.auth.signIn(); });
  const url = await indirizzoDellAccesso(app, paginaAccesso);
  expect(url, 'il login deve aprire la pagina d\'accesso in una scheda').toBeTruthy();
  await rispondiAlLoopback(url);
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

test('senza portachiavi: all\'accesso Filo dice subito che non verrà ricordato', async ({ app, shell, avvisi, testServer }) => {
  await preparaLogin(app, testServer, { cifra: false });
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
  // Resta finché non lo si chiude: chi era sulla pagina di Google lo trova al ritorno.
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
test('su KDE senza KWallet l\'avviso consiglia KWallet e non GNOME Keyring', async ({ app, shell, avvisi, testServer }) => {
  test.skip(process.platform !== 'linux', 'il consiglio sul portachiavi è solo di Linux');
  await preparaLogin(app, testServer, { cifra: false, backend: 'kwallet5' });
  const esito = await accedi(app, shell);
  expect(esito.ok, esito.error).toBe(true);
  const vista = await avvisi();
  const avviso = vista.locator('.shell-notif-msg', { hasText: 'dovrai accedere di nuovo' });
  await expect(avviso).toBeVisible({ timeout: 8_000 });
  await expect(avviso).toContainText('KWallet');
  await expect(avviso).not.toContainText('GNOME Keyring');
});

// Con la cifratura di ripiego imposta da chi lancia Filo nessun portachiavi servirebbe.
test('con il ripiego imposto l\'avviso non consiglia niente da installare', async ({ app, shell, avvisi, testServer }) => {
  await preparaLogin(app, testServer, { cifra: false, backend: 'basic_text' });
  const esito = await accedi(app, shell);
  expect(esito.ok, esito.error).toBe(true);
  const vista = await avvisi();
  const avviso = vista.locator('.shell-notif-msg', { hasText: 'dovrai accedere di nuovo' });
  await expect(avviso).toBeVisible({ timeout: 8_000 });
  await expect(avviso).not.toContainText('installa');
});

test('col portachiavi: nessun avviso, e il menu account non ne parla', async ({ app, shell, testServer }) => {
  await preparaLogin(app, testServer, { cifra: true });
  const esito = await accedi(app, shell);
  expect(esito.ok, esito.error).toBe(true);
  expect(esito.remembered).toBe(true);

  const voci = await vociMenuAccount(app, shell);
  expect(voci.join('\n')).toContain(EMAIL);
  expect(voci.join('\n')).not.toContain('fino alla chiusura');
  await expect(shell.locator('.shell-notif-msg', { hasText: 'portachiavi' })).toHaveCount(0);
});

test('uscita e nuovo accesso: l\'avviso se ne va all\'uscita e non si raddoppia al rientro', async ({ app, shell, testServer }) => {
  await preparaLogin(app, testServer, { cifra: false });
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
