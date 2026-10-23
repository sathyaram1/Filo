// #1519 — in «Inviti e utenti» chi è entrato coi codici di una persona sta sotto di lei, e la colonna «Ha invitato»
// dice quanti e in quanto tempo: un tester che fa entrare tre identità in due ore si vede. Il numero apre le persone
// contate (clic, tastiera, tasto destro) e resta lo stesso pulsante quando la vista si rilegge. Server finto in HTTP.

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';
import { GESTIONE, ricaricaSu } from './helpers/gestione.mjs';

const OWNER_EMAIL = 'owner@prova.test';
const OWNER_REFRESH = 'rt-owner';
const T = 'tttt000000000001';
const stato = { extra: [] };
let server;

const persona = (pseudonym, invitedBy, createdAt) => ({
  pseudonym, invitedBy, createdAt,
  balance: { credits: 5000, creditsGranted: 5000, usageUsd: 0 }, usage: { rows: 0 },
});
const PERSONE = () => [
  persona(T, 'owner', '2026-10-01T08:00:00.000Z'),
  persona('rrrr000000000002', 'owner', '2026-10-10T08:00:00.000Z'),
  persona('aaaa000000000011', T, '2026-10-21T10:00:00.000Z'),
  persona('aaaa000000000012', T, '2026-10-21T10:20:00.000Z'),
  persona('aaaa000000000013', T, '2026-10-21T11:40:00.000Z'),
  persona('bbbb000000000021', 'aaaa000000000012', '2026-10-22T09:00:00.000Z'),
  ...stato.extra,
];

function b64url(s) { return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function jwt(uid, extra = {}) {
  return `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ user_id: uid, sub: uid, ...extra }))}.firma`;
}
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
      if (url === '/accounts:signUp') return json(res, 200, { idToken: jwt('anon-1'), refreshToken: 'rt-anon', expiresIn: '3600', localId: 'anon-1' });
      if (url === '/token') {
        const rt = new URLSearchParams(raw).get('refresh_token');
        if (rt === OWNER_REFRESH) return json(res, 200, { id_token: jwt('owner-1', { email: OWNER_EMAIL }), refresh_token: rt, expires_in: '3600', user_id: 'owner-1' });
        return json(res, 200, { id_token: jwt('anon-1'), refresh_token: rt, expires_in: '3600', user_id: 'anon-1' });
      }
      if (url === '/walletState') return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
      if (url === '/walletOverview') {
        return json(res, 200, {
          result: {
            config: { invitesRemaining: 9, entryCredits: 5000, dailyCredits: 100, eurUsd: 1.2, eurPerCredit: 0.0007, eurUsdAt: '2026-10-15', maxGrantUsd: 50, redeemsPerInviter: 3 },
            totals: { users: 6, totalLimitUsd: 10, maxGrantUsd: 50, maxGrantCredits: 59523, grantedCredits: 30000, liveCredits: 30000 },
            ownerInvites: [],
            users: PERSONE(),
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

test.beforeEach(() => { stato.extra = []; });

async function apriOwner(app, openTab) {
  const admin = await app.evaluate(async ({}, o) => {
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
  expect(admin).toBe(true);
  const page = await openTab(`${GESTIONE}#utenti`);
  await page.waitForFunction(() => { const s = document.getElementById('ownerSection'); return s && !s.hidden; }, null, { timeout: 15_000 });
  await expect(page.locator('#ownerUsers tbody tr.sn-wallet-user')).toHaveCount(6 + stato.extra.length, { timeout: 15_000 });
  return page;
}

const ordine = (page) => page.$$eval('#ownerUsers tbody tr.sn-wallet-user', (rows) => rows.map((r) => r.cells[0].textContent));
const visibili = (page) => page.$$eval('#ownerUsers tbody tr.sn-wallet-user', (rows) => rows.filter((r) => r.offsetParent !== null).map((r) => r.cells[0].textContent));
const rigaDi = (page, p) => page.locator(`#ownerUsers tbody tr.sn-wallet-user[data-pseudonym="${p}"]`);

test('chi è entrato coi codici di un tester sta sotto di lui, e il numero dice quanti e in quante ore', async ({ app, openTab }) => {
  const page = await apriOwner(app, openTab);
  await expect(page.locator('#ownerUsers thead th').nth(8)).toHaveText('Ha invitato');
  expect(await ordine(page)).toEqual([
    'rrrr000000000002', T, 'aaaa000000000013', 'aaaa000000000012', 'bbbb000000000021', 'aaaa000000000011',
  ]);
  const bottone = rigaDi(page, T).locator('.sn-wallet-invitati-btn');
  await expect(bottone).toHaveText('3 in 2 ore');
  await expect(bottone).toHaveAttribute('title', /^3 persone sono entrate coi suoi codici: la prima il 21 ott alle \d\d:\d\d, l’ultima il 21 ott alle \d\d:\d\d\. Clic per vedere solo loro\.$/);
  await expect(rigaDi(page, 'aaaa000000000012').locator('.sn-wallet-invitati-btn')).toHaveText('1');
  await expect(rigaDi(page, 'rrrr000000000002').locator('td').nth(8)).toHaveText('');
  // Il rientro cresce col livello: chi è entrato da un invitato sta più dentro di lui.
  const rientro = (p) => rigaDi(page, p).locator('td').first().evaluate((td) => parseFloat(getComputedStyle(td).paddingLeft));
  const [r0, r1, r2] = [await rientro(T), await rientro('aaaa000000000012'), await rientro('bbbb000000000021')];
  expect(r1).toBeGreaterThan(r0);
  expect(r2).toBeGreaterThan(r1);
  await page.screenshot({ path: 'tests/.shots/1519-invitati-chiaro.png', fullPage: true });

  // Il clic sul numero lascia le tre persone contate sotto il tester, senza aprire la sua scheda.
  await bottone.click();
  expect(await visibili(page)).toEqual([T, 'aaaa000000000013', 'aaaa000000000012', 'aaaa000000000011']);
  await expect(page.locator('#ownerFiltro')).toContainText(`Solo ${T} e le 3 persone entrate coi suoi codici.`);
  await page.screenshot({ path: 'tests/.shots/1519-invitati-filtro.png', fullPage: true });
  await expect(bottone).toHaveAttribute('aria-pressed', 'true');
  await expect(rigaDi(page, T)).toHaveAttribute('aria-expanded', 'false');
  // «Mostra tutte» rimette tutti, e il fuoco torna sul numero.
  await page.click('#ownerFiltroTogli');
  expect(await visibili(page)).toHaveLength(6);
  await expect(bottone).toBeFocused();
  await expect(bottone).toHaveAttribute('aria-pressed', 'false');

  // Da tastiera: Invio apre, Spazio chiude; la scheda del tester resta chiusa.
  await page.keyboard.press('Enter');
  expect(await visibili(page)).toHaveLength(4);
  await page.keyboard.press(' ');
  expect(await visibili(page)).toHaveLength(6);
  await expect(rigaDi(page, T)).toHaveAttribute('aria-expanded', 'false');

  // Tasto destro sul numero: le persone contate e il numero da copiare; sulla riga la stessa voce.
  await bottone.click({ button: 'right' });
  const menu = page.locator('.sn-wallet-ctx');
  await expect(menu.locator('.sn-select-option')).toHaveText(['Mostra le 3 persone che ha fatto entrare', 'Copia il numero']);
  await menu.locator('.sn-select-option').first().click();
  expect(await visibili(page)).toHaveLength(4);
  await page.click('#ownerFiltroTogli');
  await rigaDi(page, T).locator('td').nth(1).click({ button: 'right' });
  await expect(menu.locator('.sn-select-option').last()).toHaveText('Mostra le 3 persone che ha fatto entrare');
  await menu.locator('.sn-select-option').last().click();
  expect(await visibili(page)).toHaveLength(4);
  // Il tasto destro sul numero premuto offre di rimettere tutti.
  await bottone.click({ button: 'right' });
  await expect(menu.locator('.sn-select-option').first()).toHaveText('Mostra tutte le persone');
  await page.keyboard.press('Escape');
  await page.click('#ownerFiltroTogli');
  // Chi non ha fatto entrare nessuno non ha la voce.
  await rigaDi(page, 'rrrr000000000002').locator('td').nth(1).click({ button: 'right' });
  await expect(menu.locator('.sn-select-option')).toHaveCount(3);
  await page.keyboard.press('Escape');

  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'update_settings', settings: { theme: 'dark' } }));
  await ricaricaSu(page, 'utenti');
  await expect(rigaDi(page, T).locator('.sn-wallet-invitati-btn')).toHaveText('3 in 2 ore', { timeout: 15_000 });
  await page.screenshot({ path: 'tests/.shots/1519-invitati-scuro.png', fullPage: true });
});

test('un ingresso nuovo coi codici del tester entra sotto di lui alla rilettura: stesso pulsante, conto aggiornato, filtro vivo', async ({ app, openTab }) => {
  const page = await apriOwner(app, openTab);
  const bottone = rigaDi(page, T).locator('.sn-wallet-invitati-btn');
  await expect(bottone).toHaveText('3 in 2 ore');
  await bottone.click();
  await page.evaluate((p) => { window.__bottone = document.querySelector(`#ownerUsers tr[data-pseudonym="${p}"] .sn-wallet-invitati-btn`); }, T);

  stato.extra = [persona('aaaa000000000014', T, '2026-10-21T13:00:00.000Z')];
  await app.evaluate(() => globalThis.SN_BROADCAST_FILO({ type: globalThis.SN_MSG.MSG.CREDITS_CHANGED }));
  await expect(bottone).toHaveText('4 in 3 ore', { timeout: 15_000 });
  expect(await page.evaluate((p) => window.__bottone === document.querySelector(`#ownerUsers tr[data-pseudonym="${p}"] .sn-wallet-invitati-btn`), T)).toBe(true);
  expect((await ordine(page)).slice(1, 3)).toEqual([T, 'aaaa000000000014']);
  // Il filtro aperto conta anche chi è appena entrato.
  expect(await visibili(page)).toEqual([T, 'aaaa000000000014', 'aaaa000000000013', 'aaaa000000000012', 'aaaa000000000011']);
  await expect(page.locator('#ownerFiltro')).toContainText('e le 4 persone entrate coi suoi codici');
  await expect(rigaDi(page, 'aaaa000000000014')).toHaveClass(/is-invitato/);
});
