// Un guasto passeggero del servizio dei token non annulla l'identità dell'installazione (#1085): la pagina
// Crediti dice che il servizio non risponde e, tornato, tutto funziona come prima. Solo un token revocato
// offre di ricominciare, e ricominciare chiede il sì sul posto. Server e identità sono un HTTP locale.

import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { test, expect, chiudiApp } from './fixtures/electron.mjs';
import { cartellaTemporanea, togliCartella } from './helpers/percorsi.mjs';
import { argomentiScala } from './helpers/scala.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let server;
let modoToken = 'ok';
const visti = { signUp: 0, token: 0 };

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const RISPOSTE_TOKEN = {
  'chiave-api': [400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }],
  503: [503, { error: { code: 503, message: 'The service is currently unavailable.', status: 'UNAVAILABLE' } }],
  revocato: [400, { error: { code: 400, message: 'INVALID_REFRESH_TOKEN', status: 'INVALID_ARGUMENT' } }],
};

test.beforeAll(async () => {
  server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const url = req.url.split('?')[0];
      if (url === '/accounts:signUp') {
        visti.signUp += 1;
        const n = visti.signUp;
        return json(res, 200, { idToken: `anon-id-${n}`, refreshToken: `anon-refresh-${n}`, expiresIn: '3600', localId: `anon-uid-${n}` });
      }
      if (url === '/token') {
        visti.token += 1;
        const guasto = RISPOSTE_TOKEN[modoToken];
        if (guasto) return json(res, guasto[0], guasto[1]);
        return json(res, 200, { id_token: `anon-id-${visti.signUp}`, refresh_token: `anon-refresh-${visti.signUp}`, expires_in: '3600', user_id: `anon-uid-${visti.signUp}` });
      }
      if (!/^Bearer anon-id-/.test(req.headers.authorization || '')) return json(res, 401, { error: { message: 'no auth' } });
      if (url === '/walletState') return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
});

test.afterAll(async () => {
  delete process.env.FILO_FUNCTIONS_BASE;
  delete process.env.FILO_IDENTITY_ENDPOINT;
  delete process.env.FILO_SECURE_TOKEN_ENDPOINT;
  await new Promise((r) => server.close(r));
});

test.beforeEach(() => { modoToken = 'ok'; });

const DA_CREDITI = { tab: { id: 6, url: 'filo://credits/credits.html' }, url: 'filo://credits/credits.html' };

test('la chiave API ruotata o un 503 non annullano l’identità: la pagina dice che il servizio non risponde, e tornato si riparte senza perdere niente', async ({ app, openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  const nota = page.locator('#walletNote');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  const nate = visti.signUp;
  expect(nate).toBeGreaterThan(0);

  for (const modo of ['chiave-api', '503']) {
    modoToken = modo;
    const prima = visti.token;
    await app.evaluate(() => globalThis.SN_WALLET_MAIN.expireIdentityForTest());
    await page.reload();
    await expect(nota).toContainText('non risponde', { timeout: 15000 });
    expect(visti.token).toBeGreaterThan(prima);
    await expect(nota).not.toContainText('annullata');
    await expect(page.locator('#resetIdentityBtn')).toBeHidden();
    await expect(page.locator('#redeemForm')).toBeVisible();
  }

  // Il servizio torna: la stessa identità si rinnova, nessuna nuova.
  modoToken = 'ok';
  await page.reload();
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  await expect(nota).toBeHidden();
  expect(visti.signUp).toBe(nate);

  // Con l'identità a posto nemmeno il canale, col sì, la butta via.
  const r = await app.evaluate(async (_, s) => globalThis.SN_HANDLE_MESSAGE({ type: 'wallet_reset_identity', confermato: true }, s), DA_CREDITI);
  expect(r.status).toBe('identity_ok');
  await page.reload();
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  expect(visti.signUp).toBe(nate);
});

test('un token revocato: la pagina offre di ricominciare, chiede il sì, «Annulla» non tocca niente, il sì crea l’identità nuova', async ({ app, openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  const nota = page.locator('#walletNote');
  const ricomincia = page.locator('#resetIdentityBtn');
  const domanda = page.locator('#resetIdentityConfirm');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  const nate = visti.signUp;

  modoToken = 'revocato';
  await app.evaluate(() => globalThis.SN_WALLET_MAIN.expireIdentityForTest());
  await page.reload();
  await expect(nota).toContainText('annullata', { timeout: 15000 });
  await expect(ricomincia).toBeVisible();
  await expect(page.locator('#redeemForm')).toBeHidden();

  // Senza il sì il canale non ricomincia.
  const senzaSi = await app.evaluate(async (_, s) => globalThis.SN_HANDLE_MESSAGE({ type: 'wallet_reset_identity' }, s), DA_CREDITI);
  expect(senzaSi.status).toBe('needs_confirm');
  expect(visti.signUp).toBe(nate);

  await ricomincia.click();
  await expect(domanda).toBeVisible();
  await expect(ricomincia).toBeHidden();
  await expect(page.locator('#resetIdentityNo')).toBeFocused();
  mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/identita-ricomincia-domanda.png' });
  await page.click('#resetIdentityNo');
  await expect(ricomincia).toBeVisible();
  await expect(domanda).toBeHidden();
  expect(visti.signUp).toBe(nate);

  // Il doppio clic su «Ricomincia» apre la domanda e basta.
  await ricomincia.dblclick();
  await expect(domanda).toBeVisible();
  await page.waitForTimeout(500);
  expect(visti.signUp).toBe(nate);
  await expect(nota).toContainText('annullata');

  await page.click('#resetIdentityYes');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  await expect(nota).toBeHidden();
  await expect(ricomincia).toBeHidden();
  await expect(domanda).toBeHidden();
  expect(visti.signUp).toBe(nate + 1);
});

// Le righe del registro d'uso in coda sono del portafoglio che si lascia: nessuna passerebbe più (#1601).
test('ricominciare con dei consumi ancora da registrare li toglie dalla coda, e la pagina dice quanti', async ({ app, openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  modoToken = 'revocato';
  await app.evaluate(() => globalThis.SN_WALLET_MAIN.expireIdentityForTest());
  await app.evaluate(async () => {
    const riga = (action) => globalThis.SN_WALLET.usageRow({ pseudonym: 'abcdef0123456789', action, model: 'm', servedBy: 'Fake', usage: {}, costUsd: 0.0001, credits: 0.2 });
    await globalThis.SN_STORAGE.setRaw('walletUsageQueue', [riga('UNO'), riga('DUE'), riga('TRE')]);
    await globalThis.SN_WALLET_MAIN.rileggiCodaPerTest();
  });
  expect((await app.evaluate(() => globalThis.SN_WALLET_MAIN.usageLogStatus())).pending).toBe(3);

  await page.reload();
  await expect(page.locator('#walletNote')).toContainText('annullata', { timeout: 15000 });
  await expect(page.locator('#usageLogNote')).toBeHidden();
  await page.click('#resetIdentityBtn');
  await page.click('#resetIdentityYes');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#usageLogNote')).toHaveText('3 consumi non sono stati registrati: tolti ricominciando con un nuovo invito.');
  const stato = await app.evaluate(() => globalThis.SN_WALLET_MAIN.usageLogStatus());
  expect(stato).toMatchObject({ pending: 0, discarded: 3, discardedBy: { ricomincia: 3 } });
  expect(await app.evaluate(() => globalThis.SN_STORAGE.getRaw('walletUsageQueue', null))).toBeNull();
  mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/1601-ricomincia-registro.png' });
});

// La cartella dati va preparata PRIMA dell'avvio (l'identità si legge lì), quindi Filo si lancia qui.
test('identità illeggibile con un portafoglio su disco: nessuna identità nuova in silenzio, la pagina lo dice, e ricominciare mette da parte il portafoglio', async () => {
  const userData = cartellaTemporanea('filo-identita-illeggibile-');
  writeFileSync(join(userData, 'identity.bin'), Buffer.from('cifrato da un altro portachiavi'));
  writeFileSync(join(userData, 'wallet.bin'), Buffer.from('anche questo'));
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
  });
  try {
    const shell = await primaFinestra(app);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), 'filo://credits/credits.html');
    await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://credits/')), { timeout: 10000 }).toBe(true);
    const page = app.windows().find((w) => w.url().startsWith('filo://credits/'));
    const nate = visti.signUp;

    await expect(page.locator('#walletNote')).toContainText('non riesce più a leggere', { timeout: 15000 });
    await expect(page.locator('#resetIdentityBtn')).toBeVisible();
    await expect(page.locator('#redeemForm')).toBeHidden();
    expect(visti.signUp).toBe(nate);
    expect(existsSync(join(userData, 'wallet.bin'))).toBe(true);

    await page.click('#resetIdentityBtn');
    await page.click('#resetIdentityYes');
    await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#walletNote')).toBeHidden();
    expect(visti.signUp).toBe(nate + 1);
    // Niente è stato cancellato: il portafoglio e l'identità di prima stanno accanto, con un altro nome.
    expect(existsSync(join(userData, 'wallet.bin'))).toBe(false);
    expect(existsSync(join(userData, 'wallet.bin.prev'))).toBe(true);
    expect(readdirSync(userData).some((n) => n.startsWith('identity.bin.'))).toBe(true);
  } finally {
    await chiudiApp(app);
    try { togliCartella(userData); } catch (_) {}
  }
});
