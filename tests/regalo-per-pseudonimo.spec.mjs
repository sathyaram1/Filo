// Il regalo di crediti per pseudonimo (#895): la persona trova il proprio
// pseudonimo nella pagina Crediti e lo copia; l'owner scrive «/gift NUMERO
// INIZIO» nella home e i crediti arrivano sul portafoglio, per la stessa strada
// del «Regala» della pagina «Inviti e utenti»; «/users» elenca pseudonimi e
// saldi, mai un'email.
//
// Server dei crediti e identità sono un HTTP locale (come in
// wallet-owner-page.spec.mjs). L'owner regala alla propria installazione: così
// la stessa app fa vedere sia la risposta della home sia il movimento nella
// pagina Crediti di chi riceve.

import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/electron.mjs';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '.shots');
const OWNER_EMAIL = 'owner@prova.test';
const OWNER_REFRESH = 'rt-owner';
const MIO = 'f00dbabe12345678';
const ALTRI = [
  { pseudonym: 'f00e000000000001', balance: { credits: 120, creditsGranted: 5000, usageUsd: 3 }, invitedBy: 'owner', createdAt: '2026-09-20T08:00:00.000Z' },
  { pseudonym: 'a1b2c3d4e5f60718', balance: { credits: 4000, creditsGranted: 5000, usageUsd: 0.7 }, invitedBy: MIO, createdAt: '2026-09-21T08:00:00.000Z' },
];
let server;
let stato;

function nuovoStato() {
  return { riscattato: false, crediti: 5000, grants: [], richieste: [] };
}
function b64url(s) { return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function jwt(uid, extra = {}) {
  return `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ user_id: uid, sub: uid, ...extra }))}.firma`;
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

test.beforeAll(async () => {
  stato = nuovoStato();
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      const data = body.data || {};
      stato.richieste.push({ url, data });
      if (url === '/accounts:signUp') {
        return json(res, 200, { idToken: jwt('anon-1'), refreshToken: 'rt-anon', expiresIn: '3600', localId: 'anon-1' });
      }
      if (url === '/token') {
        const rt = new URLSearchParams(raw).get('refresh_token');
        if (rt === OWNER_REFRESH) return json(res, 200, { id_token: jwt('owner-1', { email: OWNER_EMAIL }), refresh_token: rt, expires_in: '3600', user_id: 'owner-1' });
        return json(res, 200, { id_token: jwt('anon-1'), refresh_token: rt, expires_in: '3600', user_id: 'anon-1' });
      }
      if (url === '/walletState') {
        if (!stato.riscattato) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, {
          result: {
            hasWallet: true, pseudonym: MIO, dailyCredits: 100, stale: false,
            balance: { credits: stato.crediti, creditsGranted: stato.crediti, limitUsd: 4.2, usageUsd: 0 },
            grants: stato.grants.concat([{ at: '2026-09-20T09:00:00.000Z', credits: 5000, why: 'entry' }]),
            invites: [],
          },
        });
      }
      if (url === '/walletRedeem') {
        stato.riscattato = true;
        return json(res, 200, {
          result: {
            status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: MIO, credits: 5000,
            entryCredits: 5000, migrated: 0, localRequested: 0, cutReason: null, inviteCodes: [],
          },
        });
      }
      if (url === '/walletOverview') {
        const mio = stato.riscattato
          ? [{ pseudonym: MIO, balance: { credits: stato.crediti, creditsGranted: stato.crediti, usageUsd: 0 }, invitedBy: 'owner', createdAt: '2026-09-22T08:00:00.000Z' }]
          : [];
        return json(res, 200, {
          result: {
            config: { invitesRemaining: 9, entryCredits: 5000, dailyCredits: 100, eurUsd: 1.2, eurUsdAt: '2026-09-10', maxGrantUsd: 50 },
            totals: { users: mio.length + ALTRI.length, totalLimitUsd: 12, maxGrantUsd: 50 },
            ownerInvites: [],
            users: mio.concat(ALTRI),
          },
        });
      }
      if (url === '/walletGrant') {
        if (data.pseudonym !== MIO || !stato.riscattato) return json(res, 200, { result: { ok: false, reason: 'no_wallet' } });
        stato.crediti += Number(data.credits) || 0;
        stato.grants.unshift({ at: new Date().toISOString(), credits: Number(data.credits), why: data.why });
        return json(res, 200, { result: { ok: true, credits: Number(data.credits) } });
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

test.beforeEach(() => { stato = nuovoStato(); });

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

async function riscatta(page) {
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15_000 });
  await page.fill('#inviteCode', 'ABCD-EFGH');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemForm')).toBeHidden({ timeout: 15_000 });
}

async function scriviNellaHome(page, comando) {
  const prima = await page.locator('.dash-bubble').count();
  await page.evaluate((cmd) => {
    const input = document.getElementById('input');
    input.value = cmd;
    document.getElementById('inputForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, comando);
  return prima;
}
const ultimaBolla = (page) => page.locator('.dash-bubble').last();
const leggiAppunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());

test('la pagina Crediti mostra il proprio pseudonimo solo con un portafoglio, e si copia col clic e dal tasto destro', async ({ app, openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#pseudonymRow')).toBeHidden();

  await riscatta(page);
  const riga = page.locator('#pseudonymRow');
  await expect(riga).toBeVisible();
  await expect(riga).toContainText('Il tuo pseudonimo');
  await expect(page.locator('#pseudonym')).toHaveText(MIO);
  // Si chiama pseudonimo, non codice: accanto stanno i codici d'invito.
  await expect(riga).not.toContainText(/codice/i);

  await app.evaluate(({ clipboard }) => clipboard.writeText(''));
  await page.click('#pseudonym');
  await expect(page.locator('#pseudonym')).toHaveText('Copiato');
  expect(await leggiAppunti(app)).toBe(MIO);
  await expect(page.locator('#pseudonym')).toHaveText(MIO, { timeout: 5_000 });

  await app.evaluate(({ clipboard }) => clipboard.writeText(''));
  await page.click('#pseudonym', { button: 'right' });
  const menu = page.locator('.sn-wallet-me-menu');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('regalo di crediti');
  await menu.getByRole('menuitem', { name: 'Copia lo pseudonimo' }).click();
  await expect(menu).toHaveCount(0);
  expect(await leggiAppunti(app)).toBe(MIO);

  // Il tasto destro sull'etichetta è lo stesso «voglio fare qualcosa qui»; Esc chiude.
  await page.locator('#pseudonymRow .sn-muted').click({ button: 'right' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // Dopo un ricaricamento c'è ancora.
  await page.reload();
  await expect(page.locator('#pseudonym')).toHaveText(MIO, { timeout: 15_000 });

  mkdirSync(SHOTS, { recursive: true });
  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => window.SN_PAGE_BOOTSTRAP.applyTheme(t), tema);
    await page.click('#pseudonym', { button: 'right' });
    await expect(menu).toBeVisible();
    await page.screenshot({ path: join(SHOTS, `regalo-pseudonimo-crediti-${tema}.png`) });
    await page.keyboard.press('Escape');
  }
});

test('«/gift NUMERO INIZIO» fa salire quel portafoglio e la persona vede il movimento; un’email non regala niente', async ({ app, openTab }) => {
  const crediti = await openTab('filo://credits/credits.html');
  await riscatta(crediti);
  await expect(crediti.locator('#balance')).toHaveText(await crediti.evaluate(() => window.SN_WALLET.formatCredits(5000)));
  expect(await simulaOwner(app)).toBe(true);

  const home = await openTab('filo://dashboard/dashboard.html');
  await expect(home.locator('#input')).toBeVisible({ timeout: 15_000 });
  const fmt = (n) => home.evaluate((x) => window.SN_WALLET.formatCredits(x), n);

  // Con l'email: nessun regalo, e la strada giusta.
  await scriviNellaHome(home, '/gift 500 mario@esempio.it');
  await expect(ultimaBolla(home)).toContainText('pseudonimo', { timeout: 10_000 });
  await expect(ultimaBolla(home)).toContainText('pagina Crediti');
  expect(stato.richieste.filter((r) => r.url === '/walletGrant')).toHaveLength(0);

  // «f00» è l'inizio di due persone: nessun regalo, e le nomina.
  await scriviNellaHome(home, '/gift 500 f00');
  await expect(ultimaBolla(home)).toContainText('non ho regalato niente', { timeout: 10_000 });
  await expect(ultimaBolla(home)).toContainText('f00e000000000001');
  expect(stato.richieste.filter((r) => r.url === '/walletGrant')).toHaveLength(0);

  // «f00d» è di una persona sola: il regalo parte e la risposta dice il saldo nuovo.
  await scriviNellaHome(home, '/gift 500 f00d');
  await expect(ultimaBolla(home)).toHaveText(`✓ Regalati 500 crediti a ${MIO}. Nuovo saldo: ${await fmt(5500)} crediti.`, { timeout: 15_000 });
  expect(stato.richieste.filter((r) => r.url === '/walletGrant').map((r) => r.data))
    .toEqual([{ pseudonym: MIO, credits: 500, why: 'owner' }]);

  // La persona (qui la stessa installazione) vede il saldo e il movimento.
  await expect(crediti.locator('#balance')).toHaveText(await fmt(5500), { timeout: 15_000 });
  const movimento = crediti.locator('#moves li').first();
  await expect(movimento).toContainText('+500');
  await expect(movimento).toContainText('Regalo di Filo');

  // La vista owner lo conta: la riga di quella persona è salita. (Le due pagine
  // hanno lo stesso host: ci si arriva dal rimando, come fa l'owner.)
  await crediti.click('#ownerLink a');
  await crediti.waitForURL(/owner\.html/);
  const rigaOwner = crediti.locator('#ownerUsers tbody tr.sn-wallet-user')
    .filter({ has: crediti.locator('td.sn-wallet-pseudonym', { hasText: MIO }) });
  await expect(rigaOwner).toContainText(await fmt(5500), { timeout: 15_000 });
});

test('«/users» elenca pseudonimi, saldi e chi ha invitato, senza email; «/help» dice i comandi nuovi', async ({ app, openTab }) => {
  const crediti = await openTab('filo://credits/credits.html');
  await riscatta(crediti);
  expect(await simulaOwner(app)).toBe(true);
  const home = await openTab('filo://dashboard/dashboard.html');
  await expect(home.locator('#input')).toBeVisible({ timeout: 15_000 });
  const fmt = (n) => home.evaluate((x) => window.SN_WALLET.formatCredits(x), n);

  await scriviNellaHome(home, '/users');
  const elenco = ultimaBolla(home);
  await expect(elenco).toContainText('Persone con un portafoglio 1-3 di 3:', { timeout: 15_000 });
  await expect(elenco).toContainText(`• ${MIO} — ${await fmt(5000)} crediti, invitata da te`);
  await expect(elenco).toContainText(`• a1b2c3d4e5f60718 — ${await fmt(4000)} crediti, invitata da ${MIO}`);
  await expect(elenco).toContainText('f00e000000000001');
  expect(await elenco.innerText()).not.toContain('@');

  await scriviNellaHome(home, '/users A1B2');
  await expect(ultimaBolla(home)).toHaveText(`Trovata:\n• a1b2c3d4e5f60718 — ${await fmt(4000)} crediti, invitata da ${MIO}`, { timeout: 15_000 });

  await scriviNellaHome(home, '/help');
  const aiuto = ultimaBolla(home);
  await expect(aiuto).toContainText('/gift NUMERO PSEUDONIMO', { timeout: 10_000 });
  await expect(aiuto).toContainText('/users INIZIO');
  await expect(aiuto).not.toContainText('EMAIL');
});
