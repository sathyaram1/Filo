// Giro di verifica locale del ramo claude/link-invito — giro 4.
//
// Il giro 2 ha guardato a occhio la pagina di chi GENERA gli inviti. Qui si
// guarda l'altra, quella che vede chiunque: «I tuoi inviti» nella pagina
// Crediti. Tre inviti in tre stati diversi (vuoto, a metà con tre persone
// dentro, pieno), a finestra stretta e nei due temi: il link non deve uscire
// dallo schermo né essere tagliato, e le righe di chi è entrato devono
// starci.

import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../fixtures/electron.mjs';

const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots');
mkdirSync(SHOTS, { recursive: true });

const INVITI = [
  { code: 'AAAA2222', max: 3, used: 0, uses: [] },
  {
    code: 'BBBB3333', max: 3, used: 2,
    uses: [
      { pseudonym: 'fedebb0012ab34cd', at: '2026-09-17T10:00:00.000Z' },
      { pseudonym: '0a1b2c3d4e5f6071', at: '2026-09-18T21:30:00.000Z' },
    ],
  },
  {
    code: 'CCCC4444', max: 3, used: 3,
    uses: [
      { pseudonym: 'aaaabbbbccccdddd', at: '2026-09-10T08:00:00.000Z' },
      { pseudonym: 'eeeeffff00001111', at: '2026-09-11T08:00:00.000Z' },
      { pseudonym: '2222333344445555', at: '2026-09-12T08:00:00.000Z' },
    ],
  },
];

let server;

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
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
      if (auth !== 'Bearer anon-id-token') return json(res, 401, { error: { message: 'no auth' } });
      if (url === '/walletState') {
        return json(res, 200, {
          result: {
            hasWallet: true, pseudonym: 'abcdef0123456789',
            balance: { credits: 5000, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 },
            stale: false, dailyCredits: 100, invites: INVITI,
          },
        });
      }
      if (url === '/walletPendingInvite') return json(res, 200, { result: { status: 'none' } });
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

test('«I tuoi inviti» resta leggibile a finestra stretta, nei due temi', async ({ app, openTab }) => {
  test.setTimeout(180000);
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { w.unmaximize(); w.setSize(560, 860); }
  });

  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#invites > li')).toHaveCount(INVITI.length, { timeout: 30000 });

  // Quanti sono entrati, riga per riga: è la cosa chiesta.
  await expect(page.locator('#invites > li').nth(0).locator('.sn-wallet-invite-state')).toHaveText('entrati 0 su 3');
  await expect(page.locator('#invites > li').nth(1).locator('.sn-wallet-invite-state')).toHaveText('entrati 2 su 3');
  await expect(page.locator('#invites > li').nth(2).locator('.sn-wallet-invite-state')).toHaveText('entrati 3 su 3');
  // Chi è entrato si vede uno per uno, non solo contato.
  await expect(page.locator('#invites > li').nth(2).locator('.sn-wallet-invite-who')).toHaveCount(3);

  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => { window.SN_PAGE_BOOTSTRAP.applyTheme(t); }, tema);
    await page.waitForTimeout(300);
    const sborda = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sborda, `la pagina esce di ${sborda} pixel a destra`).toBeLessThanOrEqual(1);
    const tagliati = await page.evaluate(() => Array.from(document.querySelectorAll('.sn-wallet-invite-link'))
      .filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent));
    expect(tagliati, 'link tagliati').toEqual([]);
    await page.screenshot({ path: join(SHOTS, `giro4-inviti-crediti-${tema}.png`), fullPage: true });
  }
});
