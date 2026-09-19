// SONDA TEMPORANEA del sesto giro — da cancellare: non asserisce niente di
// utile, serve solo a capire in che stato si trova l'app dopo il riscatto
// automatico del primo avvio.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { confirmText, clickConfirm, CONFIRM_HOST } from '../../helpers/confirm.mjs';

const CODICE = 'ABCDEFGH';
let server;
let riscattato = false;
const redeems = [];

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      const auth = req.headers.authorization || '';
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
      if (auth !== 'Bearer anon-id-token') return json(res, 401, { error: { message: 'no auth' } });
      if (url === '/walletState') {
        if (!riscattato) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, { result: { hasWallet: true, pseudonym: 'abcdef0123456789', balance: { credits: 5000, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 }, stale: false, dailyCredits: 100, invites: [] } });
      }
      if (url === '/walletPendingInvite') return json(res, 200, { result: { status: 'ok', code: CODICE } });
      if (url === '/walletRedeem') {
        redeems.push(String((body.data && body.data.code) || ''));
        riscattato = true;
        return json(res, 200, { result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0, cutReason: null } });
      }
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
  for (const k of ['FILO_FUNCTIONS_BASE', 'FILO_IDENTITY_ENDPOINT', 'FILO_SECURE_TOKEN_ENDPOINT']) delete process.env[k];
  await new Promise((r) => server.close(r));
});

test('sonda: com’è messo l’onboarding dopo il riscatto automatico', async ({ app, shell }) => {
  test.setTimeout(300000);
  await expect.poll(() => redeems.length, { timeout: 90000, intervals: [400] }).toBeGreaterThan(0);

  let home = null;
  const scad = Date.now() + 30000;
  while (Date.now() < scad && !home) {
    home = app.windows().find((x) => { try { return new URL(x.url()).hostname === 'newtab'; } catch (_) { return false; } }) || null;
    if (!home) await new Promise((r) => setTimeout(r, 150));
  }
  await expect(home.locator(CONFIRM_HOST)).toBeVisible({ timeout: 90000 });
  await expect.poll(() => confirmText(home), { timeout: 30000 }).toContain('Benvenuto');
  await clickConfirm(home, 'ok');

  const dati = await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    let chiave = '';
    try { chiave = require('./src/main/auth/wallet-store').personalKey(); } catch (e) { chiave = 'ERR ' + e.message; }
    let onb = null;
    try { onb = await globalThis.SN_FILO_MEMORY.getOnboarding(); } catch (e) { onb = 'ERR ' + e.message; }
    return {
      provider: s.provider, useDefaultModels: s.useDefaultModels,
      chiaviUtente: Object.keys(s.apiKeys || {}),
      personale: chiave ? chiave.slice(0, 8) + '…' : '(vuota)',
      onboarding: onb && typeof onb === 'object' ? { done: onb.done, turni: (onb.thread || []).length } : onb,
    };
  });
  console.log('SONDA app:', JSON.stringify(dati));

  const primaDi = new Set(app.windows());
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  let seconda = null;
  const s2 = Date.now() + 30000;
  while (Date.now() < s2 && !seconda) {
    seconda = app.windows().find((w) => { if (primaDi.has(w)) return false; try { return new URL(w.url()).hostname === 'newtab'; } catch (_) { return false; } }) || null;
    if (!seconda) await new Promise((r) => setTimeout(r, 150));
  }
  await new Promise((r) => setTimeout(r, 12000));
  const stato = await seconda.getAttribute('body', 'data-state');
  const bolle = await seconda.locator('.dash-bubble-filo').count();
  const testo = bolle ? await seconda.locator('.dash-bubble-filo').first().innerText() : '(nessuna bolla)';
  console.log('SONDA scheda nuova:', JSON.stringify({ stato, bolle, testo: testo.slice(0, 120) }));

  const statoHome = await home.getAttribute('body', 'data-state');
  console.log('SONDA home:', JSON.stringify({ statoHome }));
  expect(true).toBe(true);
});

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>Il tuo invito a Filo</title></head>
<body style="margin:0;font:16px sans-serif;padding:40px">
<h1>Hai un invito</h1>
<p>Codice: ABCD-EFGH</p>
<p><a id="apri" href="filo://invito/${CODICE}">Apri in Filo</a></p>
<p><a id="web" href="https://filo.red/i/ABCD-EFGH">https://filo.red/i/ABCD-EFGH</a></p>
</body></html>`;

test('sonda: cosa offre il tasto destro e cosa fa il clic, dentro Filo', async ({ app, openTab, testServer }) => {
  test.setTimeout(240000);

  const pagina = await testServer.openReady(openTab, PAGINA);

  // 1. Il menu del tasto destro sul collegamento d'invito del sito.
  await pagina.locator('#web').click({ button: 'right' });
  const menu = pagina.locator('.sn-menu');
  await expect(menu).toBeVisible({ timeout: 20000 });
  console.log('SONDA menu web:', JSON.stringify((await menu.innerText()).replace(/\s+/g, ' | ')));
  await pagina.keyboard.press('Escape').catch(() => {});

  // 2. Il menu del tasto destro sul pulsante che apre Filo.
  await pagina.locator('#apri').click({ button: 'right' });
  await expect(menu).toBeVisible({ timeout: 20000 });
  console.log('SONDA menu apri:', JSON.stringify((await menu.innerText()).replace(/\s+/g, ' | ')));
  await pagina.keyboard.press('Escape').catch(() => {});

  // 3. Il clic vero sul pulsante: dove si finisce.
  const prima = app.windows().map((w) => w.url());
  await pagina.locator('#apri').click({ timeout: 15000 }).catch((e) => console.log('SONDA clic errore:', e.message));
  await new Promise((r) => setTimeout(r, 10000));
  const dopo = app.windows().map((w) => w.url());
  console.log('SONDA finestre prima:', JSON.stringify(prima));
  console.log('SONDA finestre dopo:', JSON.stringify(dopo));
  console.log('SONDA riscatti:', JSON.stringify(redeems));
  try { console.log('SONDA scheda:', pagina.url(), '—', await pagina.title()); } catch (e) { console.log('SONDA scheda sparita'); }
  expect(true).toBe(true);
});
