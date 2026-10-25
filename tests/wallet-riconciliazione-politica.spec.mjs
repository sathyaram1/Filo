// La riconciliazione che legge il consumo della chiave dal router (#1520), vista dall'owner: la riga di una persona dice
// perché è segnata (fuori politica, consumo non registrato, righe in eccesso) e la sua scheda mostra, accanto alle righe
// scritte dall'app, quello che il router ha fatto pagare per modello e fornitore, con gli usi fuori politica in evidenza.
// Server dei crediti, identità e Firestore sono un HTTP locale, come in wallet-owner-manopole.spec.mjs.

import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/electron.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';
import { GESTIONE } from './helpers/gestione.mjs';

const OWNER_EMAIL = 'owner@prova.test';
const OWNER_REFRESH = 'rt-owner';
const FUORI = 'aaaa000000000001';
const SCARTO = 'bbbb000000000002';
const ECCESSO = 'cccc000000000003';
const PULITO = 'dddd000000000004';

let server;
let base = '';
// Chi l'owner ha segnato come visto: da lì la riconciliazione non lo segna più per gli usi già letti.
const visti = new Set();
const ackChiesti = [];
// Quello che la scheda mostrava quando l'owner ha premuto «Visto»: il server segna visto solo quello.
const ackMostrati = [];
const conVisto = (p) => (visti.has(p.pseudonym)
  ? { ...p, reconcile: { ...p.reconcile, flagged: false, reasons: [], offPolicy: [] } }
  : p);

function b64url(s) { return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function jwt(uid, extra = {}) {
  return `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ user_id: uid, sub: uid, ...extra }))}.firma`;
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Il tester della segnalazione: 1 $ su GPT-5 servito da Azure con la chiave fuori da Filo, righe dell'app per 1 $ su
// DeepSeek. Lo scarto torna, la politica no.
const USO_FUORI = { model: 'openai/gpt-5', provider: 'Azure', usd: 1, requests: 3, violation: 'model' };
const persona = (pseudonym, reconcile) => ({
  pseudonym, balance: { credits: 4000, creditsGranted: 5000, usageUsd: 1, limitUsd: 4.2 },
  invitedBy: 'owner', createdAt: '2026-10-01T08:00:00.000Z', reconcile,
  usage: { rows: 2, byAction: { chat: 1 }, byDay: { '2026-10-20': 1 } },
});
const PERSONE = [
  persona(FUORI, { flagged: true, driftUsd: 0, reasons: ['off_policy'], offPolicy: [USO_FUORI] }),
  // Un segno di prima della riconciliazione per modello: nessun motivo scritto, solo lo scarto positivo.
  persona(SCARTO, { flagged: true, driftUsd: 0.42 }),
  persona(ECCESSO, { flagged: true, driftUsd: -1, reasons: ['excess_rows'] }),
  persona(PULITO, { flagged: false, driftUsd: 0 }),
];
// Il consumo per modello e fornitore che il server legge dal router: arriva in disordine, la scheda lo ordina per spesa.
const ROUTER = {
  [FUORI]:{ rows: [{ model: 'deepseek/deepseek-v4-pro', provider: 'DeepInfra', usd: 0.0031, requests: 1 }, USO_FUORI] },
  [ECCESSO]: { error: 'HTTP 503' },
};

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      if (url === '/accounts:signUp') {
        return json(res, 200, { idToken: jwt('anon-1'), refreshToken: 'rt-anon', expiresIn: '3600', localId: 'anon-1' });
      }
      if (url === '/token') {
        const rt = new URLSearchParams(raw).get('refresh_token');
        if (rt === OWNER_REFRESH) return json(res, 200, { id_token: jwt('owner-1', { email: OWNER_EMAIL }), refresh_token: rt, expires_in: '3600', user_id: 'owner-1' });
        return json(res, 200, { id_token: jwt('anon-1'), refresh_token: rt, expires_in: '3600', user_id: 'anon-1' });
      }
      if (url.includes('/databases/(default)/documents/')) {
        return json(res, 200, { name: url.split('/databases/(default)/documents/')[1], fields: {} });
      }
      if (url === '/walletState') return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
      if (url === '/walletOverview') {
        return json(res, 200, {
          result: {
            config: { invitesRemaining: 9, entryCredits: 5000, dailyCredits: 100, eurPerCredit: 0.0007, eurUsd: 1.17, eurUsdAt: '2026-10-20', maxGrantUsd: 57.33 },
            totals: { users: PERSONE.length, totalLimitUsd: 16.8, maxGrantUsd: 57.33 },
            ownerInvites: [],
            reconcile: { lastRunAt: '2026-10-21T09:00:00.000Z', summary: { flagged: 3, errors: 0 } },
            users: PERSONE.map(conVisto),
          },
        });
      }
      if (url === '/walletUserDetail') {
        const lei = PERSONE.map(conVisto).find((p) => body.data && p.pseudonym === body.data.pseudonym);
        if (!lei) return json(res, 200, { result: { found: false } });
        const detail = {
          found: true, pseudonym: lei.pseudonym, balance: lei.balance, createdAt: lei.createdAt, invitedBy: 'owner',
          reconcile: lei.reconcile, usage: { rows: 2, byAction: { chat: 1 }, byDay: { '2026-10-20': 1 } },
          grants: [], invites: [],
          rows: [{ at: '2026-10-20T10:00:00.000Z', action: 'chat', model: 'deepseek/deepseek-v4-pro', servedBy: 'DeepInfra', promptTokens: 1200, completionTokens: 300, costUsd: 1, credits: 1222 }],
        };
        if (ROUTER[lei.pseudonym]) detail.router = ROUTER[lei.pseudonym];
        return json(res, 200, { result: detail });
      }
      if (url === '/walletAckOffPolicy') {
        const p = String((body.data && body.data.pseudonym) || '');
        ackChiesti.push(p);
        ackMostrati.push(body.data && body.data.shown);
        const lei = PERSONE.find((x) => x.pseudonym === p);
        if (!lei) return json(res, 200, { result: { ok: false, reason: 'no_wallet' } });
        visti.add(p);
        return json(res, 200, { result: { ok: true, reconcile: conVisto(lei).reconcile } });
      }
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
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

async function dirottaFirestore(app, b) {
  await app.evaluate((_, indirizzo) => {
    if (globalThis.__filoFetchVero) return;
    const vero = globalThis.fetch;
    globalThis.__filoFetchVero = vero;
    globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/firestore\.googleapis\.com/, indirizzo), init);
  }, b);
}

async function apriOwner(app) {
  const shell = await primaFinestra(app);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `${GESTIONE}#utenti`);
  const deadline = Date.now() + 15_000;
  let page = null;
  while (Date.now() < deadline && !page) {
    page = app.windows().find((w) => { try { return w.url().startsWith(GESTIONE); } catch (_) { return false; } }) || null;
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  if (!page) throw new Error('apriOwner: nessuna finestra per ' + GESTIONE);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForFunction(() => {
    const s = document.getElementById('ownerSection');
    return s && !s.hidden;
  }, null, { timeout: 15_000 });
  return page;
}

const riga = (page, p) => page.locator(`#ownerUsers tr.sn-wallet-user[data-pseudonym="${p}"]`);
const schedaDi = (page, p) => page.locator(`#ownerUsers tr.sn-wallet-user-detail[data-pseudonym="${p}"] .sn-wallet-scheda`);

test('la riga dice perché la persona è segnata, e la scheda mostra il consumo del router con l’uso fuori politica', async ({ app }) => {
  expect(await simulaOwner(app)).toBe(true);
  await dirottaFirestore(app, base);
  const page = await apriOwner(app);
  await expect(page.locator('#ownerUsers tr.sn-wallet-user')).toHaveCount(4, { timeout: 15_000 });

  const registro = (p) => riga(page, p).locator('td').nth(4);
  await expect(registro(FUORI)).toHaveText('fuori politica 1 $');
  await expect(registro(FUORI)).toHaveClass(/is-flagged/);
  await expect(registro(SCARTO)).toHaveText('non registrato 0,42 $');
  await expect(registro(ECCESSO)).toHaveText('righe in eccesso 1 $');
  await expect(registro(PULITO)).toHaveText('ok');
  await expect(registro(PULITO)).not.toHaveClass(/is-flagged/);

  await riga(page, FUORI).click();
  const scheda = schedaDi(page, FUORI);
  await expect(scheda).toBeVisible({ timeout: 15_000 });
  await expect(scheda.locator('li', { hasText: 'Riconciliazione' })).toContainText('fuori politica 1 $');
  const router = scheda.locator('.sn-wallet-scheda-blocco', { hasText: 'Secondo il router' });
  const voci = router.locator('li');
  await expect(voci).toHaveCount(2);
  // Prima la spesa più alta: è l'uso fuori politica, scritto e colorato come tale.
  await expect(voci.nth(0)).toContainText('openai/gpt-5 · Azure · modello fuori politica');
  await expect(voci.nth(0)).toContainText('1 $');
  await expect(voci.nth(0)).toHaveClass(/is-flagged/);
  await expect(voci.nth(0)).toHaveAttribute('title', '3 chiamate');
  await expect(voci.nth(1)).toContainText('deepseek/deepseek-v4-pro · DeepInfra');
  await expect(voci.nth(1)).toContainText('0,0031 $');
  await expect(voci.nth(1)).not.toHaveClass(/is-flagged/);
  await expect(scheda.locator('.sn-wallet-scheda-blocco', { hasText: 'Dove sono andati i crediti' })).toContainText('chat');

  mkdirSync(join('tests', '.shots'), { recursive: true });
  await scheda.screenshot({ path: join('tests', '.shots', 'riconciliazione-politica-scheda.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await scheda.screenshot({ path: join('tests', '.shots', 'riconciliazione-politica-scheda-scura.png') });
  await page.emulateMedia({ colorScheme: 'light' });
});

test('un router che non ha risposto si dice, e senza consumo letto né usi segnati il blocco non c’è', async ({ app }) => {
  expect(await simulaOwner(app)).toBe(true);
  await dirottaFirestore(app, base);
  const page = await apriOwner(app);
  await expect(page.locator('#ownerUsers tr.sn-wallet-user')).toHaveCount(4, { timeout: 15_000 });

  await riga(page, ECCESSO).click();
  const eccesso = schedaDi(page, ECCESSO);
  await expect(eccesso).toBeVisible({ timeout: 15_000 });
  await expect(eccesso.locator('.sn-wallet-scheda-blocco', { hasText: 'Secondo il router' }))
    .toContainText('Il router non ha risposto: HTTP 503');

  await riga(page, SCARTO).click();
  const scarto = schedaDi(page, SCARTO);
  await expect(scarto).toBeVisible({ timeout: 15_000 });
  await expect(scarto.locator('li', { hasText: 'Riconciliazione' })).toContainText('non registrato 0,42 $');
  await expect(scarto.locator('.sn-wallet-scheda-blocco', { hasText: 'Movimenti' })).toBeVisible();
  await expect(scarto.locator('.sn-wallet-scheda-blocco', { hasText: 'Secondo il router' })).toHaveCount(0);
});

test('«Visto» sugli usi fuori politica: la persona non è più segnata, l’uso resta nella scheda', async ({ app }) => {
  visti.clear();
  ackChiesti.length = 0;
  ackMostrati.length = 0;
  expect(await simulaOwner(app)).toBe(true);
  await dirottaFirestore(app, base);
  const page = await apriOwner(app);
  await expect(page.locator('#ownerUsers tr.sn-wallet-user')).toHaveCount(4, { timeout: 15_000 });

  // Solo chi è segnato fuori politica ha il pulsante: le righe in eccesso non si spengono da qui.
  await riga(page, ECCESSO).click();
  await expect(schedaDi(page, ECCESSO)).toBeVisible({ timeout: 15_000 });
  await expect(schedaDi(page, ECCESSO).getByRole('button', { name: 'Visto' })).toHaveCount(0);

  await riga(page, FUORI).click();
  const scheda = schedaDi(page, FUORI);
  await expect(scheda).toBeVisible({ timeout: 15_000 });
  const visto = scheda.getByRole('button', { name: 'Visto' });
  await expect(visto).toHaveAttribute('title', 'Torna segnata solo per un uso nuovo');
  mkdirSync(join('tests', '.shots'), { recursive: true });
  await scheda.screenshot({ path: join('tests', '.shots', 'riconciliazione-politica-visto.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await scheda.screenshot({ path: join('tests', '.shots', 'riconciliazione-politica-visto-scura.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await visto.click();

  await expect(riga(page, FUORI).locator('td').nth(4)).toHaveText('ok', { timeout: 15_000 });
  expect(ackChiesti).toEqual([FUORI]);
  expect(ackMostrati).toEqual([[{ model: 'openai/gpt-5', provider: 'Azure', usd: 1, requests: 3 }]]);
  await expect(scheda.locator('li', { hasText: 'Riconciliazione' })).toContainText('torna', { timeout: 15_000 });
  const router = scheda.locator('.sn-wallet-scheda-blocco', { hasText: 'Secondo il router' });
  await expect(router.locator('li').nth(0)).toContainText('openai/gpt-5 · Azure · modello fuori politica');
  await expect(router.locator('li').nth(0)).toHaveClass(/is-flagged/);
  await expect(scheda.getByRole('button', { name: 'Visto' })).toHaveCount(0);
});
