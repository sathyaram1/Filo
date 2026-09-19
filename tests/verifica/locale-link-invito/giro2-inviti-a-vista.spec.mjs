// Giro di verifica locale del ramo claude/link-invito — giro 2.
//
// La pagina di chi gestisce Filo è quella cambiata per ultima, e adesso ogni
// invito porta un indirizzo lungo accanto a una tabella larga. Qui si guarda
// che a finestra stretta e a tema scuro non si tagli e non esca dallo schermo,
// e restano le due catture da guardare a occhio.

import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../fixtures/electron.mjs';

const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots');
const OWNER_EMAIL = 'owner@prova.test';
const OWNER_REFRESH = 'rt-owner';
let server;

function b64url(s) { return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function jwt(uid, extra = {}) {
  return `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ user_id: uid, sub: uid, ...extra }))}.firma`;
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const INVITI = [
  { code: 'AAAA2222', max: 3, used: 1, uses: [{ pseudonym: 'fedebb00', at: '2026-09-17T10:00:00.000Z' }], createdAt: '2026-09-10T09:00:00.000Z' },
  { code: 'BBBB3333', max: 3, used: 0, uses: [], createdAt: '2026-09-10T09:00:00.000Z' },
  { code: 'CCCC4444', max: 3, used: 3, uses: [{ pseudonym: 'aa11bb22', at: '2026-09-17T10:00:00.000Z' }, { pseudonym: 'cc33dd44', at: '2026-09-17T11:00:00.000Z' }, { pseudonym: 'ee55ff66', at: '2026-09-17T12:00:00.000Z' }], createdAt: '2026-09-10T09:00:00.000Z' },
];

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      if (url === '/accounts:signUp') return json(res, 200, { idToken: jwt('anon-1'), refreshToken: 'rt-anon', expiresIn: '3600', localId: 'anon-1' });
      if (url === '/token') {
        const p = new URLSearchParams(raw);
        const rt = p.get('refresh_token');
        if (rt === OWNER_REFRESH) return json(res, 200, { id_token: jwt('owner-1', { email: OWNER_EMAIL }), refresh_token: rt, expires_in: '3600', user_id: 'owner-1' });
        return json(res, 200, { id_token: jwt('anon-1'), refresh_token: rt, expires_in: '3600', user_id: 'anon-1' });
      }
      if (url === '/walletState') return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
      if (url === '/walletPendingInvite') return json(res, 200, { result: { status: 'none' } });
      if (url === '/walletOverview') {
        return json(res, 200, {
          result: {
            config: { invitesRemaining: 9, entryCredits: 5000, dailyCredits: 100, eurUsd: 1.2, eurUsdAt: '2026-09-10', maxGrantUsd: 50 },
            totals: { users: 1, totalLimitUsd: 4.2, maxGrantUsd: 50 },
            ownerInvites: INVITI,
            users: [{ pseudonym: 'abcdef0123456789', balance: { credits: 5000, creditsGranted: 5000, usageUsd: 0 }, invitedBy: 'owner', createdAt: '2026-09-10T08:00:00.000Z', usage: { rows: 0 } }],
          },
        });
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

test('gli inviti restano leggibili a finestra stretta, nei due temi', async ({ app, openTab }) => {
  test.setTimeout(180000);
  await app.evaluate(async ({}, o) => {
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
  }, { tokenEndpoint: process.env.FILO_SECURE_TOKEN_ENDPOINT, refresh: OWNER_REFRESH, email: OWNER_EMAIL });

  // Finestra stretta, come chi tiene Filo a metà schermo.
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { w.unmaximize(); w.setSize(560, 860); }
  });

  const page = await openTab('filo://credits/owner.html');
  await page.waitForFunction(() => { const s = document.getElementById('ownerSection'); return s && !s.hidden; }, null, { timeout: 30000 });
  await expect(page.locator('#ownerCodes > li')).toHaveCount(INVITI.length, { timeout: 30000 });

  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => { window.SN_PAGE_BOOTSTRAP.applyTheme(t); }, tema);
    await page.waitForTimeout(300);
    // Niente barra orizzontale: un indirizzo lungo non deve spingere fuori la
    // pagina, o metà dei comandi finisce oltre il bordo.
    const sborda = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sborda, `la pagina esce di ${sborda} pixel a destra`).toBeLessThanOrEqual(1);
    // E il link si legge per intero, non tagliato a metà.
    const tagliati = await page.evaluate(() => Array.from(document.querySelectorAll('.sn-wallet-invite-link'))
      .filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent));
    expect(tagliati, 'link tagliati').toEqual([]);
    await page.screenshot({ path: join(SHOTS, `giro2-inviti-owner-${tema}.png`), fullPage: true });
  }
});
