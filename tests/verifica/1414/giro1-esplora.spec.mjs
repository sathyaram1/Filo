// Esplorazione della verifica di #1414: owner vero (sessione simulata), menu, link della pagina Crediti, vecchi
// indirizzi con varianti, sezioni nuove in chiaro e scuro.

import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDellaScheda } from '../../helpers/schede.mjs';
import { GESTIONE, apriScheda } from '../../helpers/gestione.mjs';

const SHOTS = 'tests/.shots/verifica-1414';
const OWNER_EMAIL = 'owner@prova.test';
const OWNER_REFRESH = 'rt-owner';
let server;

function b64url(s) { return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function jwt(uid, extra = {}) {
  return `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ user_id: uid, sub: uid, ...extra }))}.firma`;
}
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      if (url === '/accounts:signUp') return json(res, 200, { idToken: jwt('anon-1'), refreshToken: 'rt-anon', expiresIn: '3600', localId: 'anon-1' });
      if (url === '/token') {
        const rt = new URLSearchParams(raw).get('refresh_token');
        if (rt === OWNER_REFRESH) return json(res, 200, { id_token: jwt('owner-1', { email: OWNER_EMAIL }), refresh_token: rt, expires_in: '3600', user_id: 'owner-1' });
        return json(res, 200, { id_token: jwt('anon-1'), refresh_token: rt, expires_in: '3600', user_id: 'anon-1' });
      }
      if (url === '/walletState') return json(res, 200, { result: { hasWallet: true, isOwner: true, invitesOpen: true, configured: true, credits: 100 } });
      if (url === '/walletOverview') {
        return json(res, 200, { result: {
          config: { invitesRemaining: 9, entryCredits: 5000, dailyCredits: 100, eurUsd: 1.2, eurUsdAt: '2026-09-10', maxGrantUsd: 50 },
          totals: { users: 3, totalLimitUsd: 4.2, maxGrantUsd: 50 },
          ownerInvites: [{ code: 'ABCDEFGH', used: false, createdAt: '2026-09-10T09:00:00.000Z' }],
          users: [{ pseudonym: 'abcdef0123456789', balance: { credits: 5000, creditsGranted: 5000, usageUsd: 0.2 }, invitedBy: 'owner', createdAt: '2026-09-10T08:00:00.000Z', usage: { rows: 0 } }],
        } });
      }
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
  process.env.FILO_ADMIN_EMAILS = OWNER_EMAIL;
});

test.afterAll(async () => {
  for (const k of ['FILO_FUNCTIONS_BASE', 'FILO_IDENTITY_ENDPOINT', 'FILO_SECURE_TOKEN_ENDPOINT', 'FILO_ADMIN_EMAILS']) delete process.env[k];
  await new Promise((r) => server.close(r));
});

async function simulaOwner(app) {
  return app.evaluate(async ({}, o) => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    const cfg = req('./auth/config');
    const store = req('./auth/token-store');
    const ga = req('./auth/google-auth');
    cfg.secureTokenEndpoint = o.tokenEndpoint;
    store.save({ refreshToken: o.refresh, email: o.email, name: 'Owner di prova', picture: '' });
    ga.restore();
    await ga.getIdToken();
    return ga.isAdmin();
  }, { tokenEndpoint: process.env.FILO_SECURE_TOKEN_ENDPOINT, refresh: OWNER_REFRESH, email: OWNER_EMAIL });
}

const popupAperti = (app) => app.windows().filter((w) => { try { return !w.isClosed() && w.url().startsWith('data:text/html'); } catch (_) { return false; } });
async function vociDelMenu(app, shell, bottone) {
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) { try { if (w.webContents.getURL().startsWith('data:text/html')) w.destroy(); } catch (_) {} }
  });
  await expect.poll(() => popupAperti(app).length).toBe(0);
  await shell.evaluate((id) => document.getElementById(id).click(), bottone);
  await expect.poll(() => popupAperti(app).length).toBe(1);
  const popup = popupAperti(app)[0];
  await popup.waitForSelector('.item .lbl');
  return popup.locator('.item .lbl').allInnerTexts();
}

async function apriIndirizzo(app, shell, url) {
  const aperta = await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let page = null;
  await expect.poll(async () => Boolean(page = await paginaDellaScheda(app, aperta.id, (w) => w.url().startsWith(GESTIONE))),
    { message: `${url} non è arrivato in Gestione`, timeout: 15_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

test('owner vero: menu, link dai Crediti, varianti dei vecchi indirizzi, sezioni in chiaro e scuro', async ({ app, shell, openTab }) => {
  expect(await simulaOwner(app)).toBe(true);
  await expect.poll(async () => (await vociDelMenu(app, shell, 'nav-apps')).includes('Gestione'), { timeout: 15_000 }).toBe(true);
  console.log('APPS', await vociDelMenu(app, shell, 'nav-apps'));
  console.log('SETTINGS', await vociDelMenu(app, shell, 'nav-settings'));

  // Pagina Crediti → link «Inviti e utenti →».
  const crediti = await openTab('filo://credits/credits.html');
  const link = crediti.locator('#ownerLink a');
  await expect(link).toBeVisible({ timeout: 15_000 });
  await link.click();
  await expect.poll(() => crediti.url(), { timeout: 10_000 }).toContain('manage/manage.html');
  await expect(crediti.locator('.mg-sezione--active[data-sezione="utenti"]')).toBeVisible({ timeout: 10_000 });
  await expect(crediti.locator('#ownerSection')).toBeVisible({ timeout: 15_000 });
  console.log('NUMERI', await crediti.locator('#ownerNumeri').innerText());
  await crediti.waitForTimeout(1500);
  for (const tema of ['light', 'dark']) {
    await crediti.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await crediti.waitForTimeout(300);
    await crediti.screenshot({ path: `${SHOTS}/utenti-${tema}.png` });
  }
  // Indietro torna ai Crediti.
  await crediti.goBack();
  await expect.poll(() => crediti.url(), { timeout: 10_000 }).toContain('credits/credits.html');

  // Varianti dei vecchi indirizzi.
  for (const url of [
    'filo://credits/owner.html?da=avviso', 'filo://CREDITS/owner.html', 'filo://credits/Owner.html',
    'filo://admin-defaults', 'filo://admin-defaults/', 'filo://admin-defaults/admin-defaults.html#sec-keys',
  ]) {
    let esito = 'ok';
    try {
      const p = await apriIndirizzo(app, shell, url);
      const sez = await p.locator('.mg-sezione--active').getAttribute('data-sezione').catch(() => null);
      esito = `sezione=${sez}`;
    } catch (e) { esito = 'FALLITO ' + String(e.message).split('\n')[0]; }
    console.log('INDIRIZZO', url, '→', esito);
  }

  // Gestione aperta normalmente: barra delle sezioni.
  const g = await openTab(GESTIONE);
  await g.waitForTimeout(3000);
  await apriScheda(g, 'predefiniti');
  await g.waitForTimeout(2500);
  for (const tema of ['light', 'dark']) {
    await g.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await g.waitForTimeout(300);
    await g.screenshot({ path: `${SHOTS}/predefiniti-owner-${tema}.png` });
  }
  await apriScheda(g, 'automation');
  await g.waitForTimeout(1500);
  await g.screenshot({ path: `${SHOTS}/automation-dark.png` });
  await apriScheda(g, 'crediti');
  await g.waitForTimeout(1500);
  await g.screenshot({ path: `${SHOTS}/routine-crediti-dark.png` });
  await g.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'light'));
  await g.screenshot({ path: `${SHOTS}/routine-crediti-light.png` });
});
