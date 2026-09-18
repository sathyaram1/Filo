// TEMPORANEO — diagnostica, si cancella prima della critica.
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';

let server;
let visto = { redeems: [] };
let riscattato = false;

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
        return json(res, 200, { result: { hasWallet: true, pseudonym: 'abcdef0123456789', balance: { credits: 5000, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 }, stale: false, dailyCredits: 100, invites: [
          { code: 'AAAA2222', max: 3, used: 1, uses: [{ pseudonym: 'fedebb00cafe1234', at: '2026-09-17T10:00:00.000Z' }] },
          { code: 'BBBB3333', max: 3, used: 0, uses: [] },
          { code: 'CCCC4444', max: 3, used: 3, uses: [{ pseudonym: 'aaa1', at: '2026-09-10T10:00:00.000Z' }, { pseudonym: 'bbb2', at: '2026-09-11T10:00:00.000Z' }, { pseudonym: 'ccc3', at: '2026-09-12T10:00:00.000Z' }] },
        ] } });
      }
      if (url === '/walletPendingInvite') return json(res, 200, { result: { status: 'none' } });
      if (url === '/walletRedeem') {
        visto.redeems.push(String((body.data && body.data.code) || ''));
        riscattato = true;
        return json(res, 200, { result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0 } });
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

test.beforeEach(() => { visto = { redeems: [] }; riscattato = false; });

test.afterAll(async () => {
  for (const k of ['FILO_FUNCTIONS_BASE', 'FILO_IDENTITY_ENDPOINT', 'FILO_SECURE_TOKEN_ENDPOINT']) delete process.env[k];
  await new Promise((r) => server.close(r));
});

test('riscatto A MANO: la home già aperta si aggiorna?', async ({ app, openTab }) => {
  let home = null;
  const scad = Date.now() + 25000;
  while (Date.now() < scad && !home) {
    home = app.windows().find((w) => { try { return new URL(w.url()).hostname === 'newtab'; } catch (_) { return false; } }) || null;
    if (!home) await new Promise((r) => setTimeout(r, 200));
  }
  const prima = await home.evaluate(() => document.body.innerText.slice(0, 160));
  console.log('HOME PRIMA:', JSON.stringify(prima));
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 20000 });
  await page.fill('#inviteCode', 'ABCD-EFGH');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toContainText('riscattato', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 6000));
  const dopo = await home.evaluate(() => document.body.innerText.slice(0, 160));
  console.log('HOME DOPO RISCATTO A MANO:', JSON.stringify(dopo));
});

test('foto della pagina Crediti con gli inviti, tema chiaro e scuro, e finestra stretta', async ({ app, openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 20000 });
  await page.fill('#inviteCode', 'ABCD-EFGH');
  await page.click('#redeemBtn');
  await expect(page.locator('#invites > li')).toHaveCount(3, { timeout: 20000 });
  mkdirSync('tests/.shots', { recursive: true });
  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); }, tema);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/.shots/verifica-651-crediti-${tema}.png`, fullPage: true });
  }
  // Finestra stretta: il link è lungo, la riga deve reggere.
  const win = app.windows()[0];
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setBounds({ width: 620, height: 800 }); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/.shots/verifica-651-crediti-stretto.png', fullPage: true });
  const overflow = await page.evaluate(() => {
    const li = document.querySelector('#invites > li');
    const row = li && li.querySelector('.sn-wallet-invite-row');
    const link = li && li.querySelector('.sn-wallet-invite-link');
    return {
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      rowW: row ? row.getBoundingClientRect().width : 0,
      linkW: link ? link.getBoundingClientRect().width : 0,
      linkScrollW: link ? link.scrollWidth : 0,
      stato: li ? li.querySelector('.sn-wallet-invite-state').textContent : '',
      chi: li ? li.querySelector('.sn-wallet-invite-who').textContent : '',
    };
  });
  console.log('LARGHEZZE:', JSON.stringify(overflow));
  expect(win).toBeTruthy();
});
