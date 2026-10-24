// Gli avvisi all'owner fra le notifiche della home (#855): tetto dei regali oltre l'80% e il 95%, ingressi con invito
// quasi finiti, quote del giorno rifiutate, scarti della riconciliazione. Una carta per caso e per soglia, che non si
// ridice a ogni avvio e apre «Inviti e utenti»; chi non è owner non fa partire nessuna lettura, un server muto nessun
// avviso. Server e identità sono un HTTP locale; la logica sta in tests/unit/avvisiOwner.test.mjs.

import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmSync } from 'node:fs';
import { _electron as electron } from '@playwright/test';
import { test, expect, aspettaFinestra, chiudiApp } from './fixtures/electron.mjs';
import { cartellaTemporanea, togliCartella } from './helpers/percorsi.mjs';
import { argomentiScala } from './helpers/scala.mjs';
import { GESTIONE } from './helpers/gestione.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(APP_ROOT, 'tests', '.shots');
const OWNER_EMAIL = 'owner@prova.test';
const OWNER_REFRESH = 'rt-owner';
const TETTO = 100000;
const PSEUDONIMI = ['aaaa000000000001', 'bbbb000000000002', 'cccc000000000003'];

const INIZIO = () => ({ dati: 20000, inviti: 9, rifiutate: undefined, segnati: [], giu: false, letture: 0 });
let stato = INIZIO();
let server;

function vista() {
  const result = {
    config: { invitesRemaining: stato.inviti, entryCredits: 5000, dailyCredits: 100, eurUsd: 1.2, eurPerCredit: 0.0007, eurUsdAt: '2026-10-16', maxGrantUsd: 84 },
    totals: { users: PSEUDONIMI.length, totalLimitUsd: 10, maxGrantUsd: 84, maxGrantCredits: TETTO, grantedCredits: stato.dati, liveCredits: 9000 },
    ownerInvites: [],
    users: PSEUDONIMI.map((p, i) => ({
      pseudonym: p, balance: { credits: 3000, creditsGranted: 5000, usageUsd: 0.5 }, invitedBy: 'owner', createdAt: `2026-09-0${i + 1}T08:00:00.000Z`,
      reconcile: stato.segnati.includes(p) ? { flagged: true, driftUsd: 0.42 } : { flagged: false, driftUsd: 0 },
      usage: { rows: 1, byAction: { chat: 0.5 }, byDay: { '2026-10-15': 0.5 } },
    })),
    reconcile: { lastRunAt: '2026-10-16T09:00:00.000Z', summary: { flagged: stato.segnati.length, errors: 0 } },
  };
  if (stato.rifiutate !== undefined) result.daily = { lastRunAt: '2026-10-16T03:00:00.000Z', summary: { granted: 1, refused: stato.rifiutate, errors: 0 } };
  return result;
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
        stato.letture += 1;
        if (stato.giu) return json(res, 503, { error: { message: 'unavailable' } });
        return json(res, 200, { result: vista() });
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

test.beforeEach(() => { stato = INIZIO(); });

// Due avvii sulla stessa cartella dati sono una riapertura di Filo. La sessione dell'owner finto non si tiene: dove il
// sistema sa cifrarla, all'avvio dopo Filo la rinnoverebbe col servizio vero prima che la prova lo sostituisca, e
// la perderebbe. Ogni avvio parte da non-owner e lo diventa, come il primo.
function avvia(userData) {
  for (const f of ['auth.bin', 'accesso-owner-caduto']) rmSync(join(userData, f), { force: true });
  return electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test', FILO_TEST_ACCOLTO: '1' },
  });
}

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

// La home dell'avvio chiede da non-owner; da owner la si riapre, come all'avvio della copia dell'owner. Si scioglie
// quando la home ha avuto risposta: a quel punto gli avvisi della stessa lettura sono già scritti.
async function homeChiesta(home) {
  await home.waitForFunction(() => window.__filoDashActions && window.__filoDashActions.allarmeOwnerChiesto, null, { timeout: 0 });
  await home.evaluate(() => window.__filoDashActions.allarmeOwnerChiesto());
}
async function homeDellAvvio(app) {
  const home = await aspettaFinestra(app, (w) => w.url().startsWith('filo://newtab'), 'la home dell’avvio non è nata');
  await homeChiesta(home);
  return home;
}
async function diventaOwner(app, home) {
  expect(await simulaOwner(app)).toBe(true);
  await home.reload();
  await homeChiesta(home);
}

const carte = (home) => home.locator('#accade .dash-carta[data-tipo="avviso"]');
const avvisiOwner = (app) => app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.listNotifications())
  .filter((n) => n.action && n.action.tipo === 'crediti-owner')
  .map((n) => ({ id: n.id, caso: n.action.caso, text: n.text })));

test('all’85% del tetto l’owner trova l’avviso nella home e il pulsante apre Inviti e utenti; riaperto Filo non se ne aggiunge un secondo, al 96% ne arriva uno nuovo', async () => {
  test.setTimeout(180_000);
  const userData = cartellaTemporanea('filo-test-');
  try {
    stato.dati = 85000;
    let app = await avvia(userData);
    let primo;
    try {
      const home = await homeDellAvvio(app);
      await diventaOwner(app, home);
      const carta = carte(home).filter({ hasText: 'I crediti regalati sono all\'85% del tetto, 85.000 su 100.000' });
      await expect(carta).toHaveCount(1, { timeout: 15_000 });
      await expect(carte(home)).toHaveCount(1);
      await expect(carta.locator('.dash-carta-az.principale')).toHaveText('Apri Inviti e utenti');
      [primo] = await avvisiOwner(app);
      expect(primo.caso).toBe('tetto');

      await carta.locator('.dash-carta-az.principale').click();
      // «Inviti e utenti» sta in Gestione (#1414): l'avviso apre quella scheda.
      const owner = await aspettaFinestra(app, (w) => w.url().startsWith(GESTIONE), 'Gestione non si è aperta');
      await expect(owner.locator('.mg-tab--active[data-tab="utenti"]')).toBeVisible({ timeout: 15_000 });
      await owner.waitForFunction(() => { const s = document.getElementById('ownerSection'); return s && !s.hidden; }, null, { timeout: 15_000 });
    } finally { await chiudiApp(app); }

    // Riaperto, stessa situazione: la lettura c'è, l'avviso resta quello di prima.
    app = await avvia(userData);
    try {
      const home = await homeDellAvvio(app);
      const prima = stato.letture;
      await diventaOwner(app, home);
      expect(stato.letture).toBeGreaterThan(prima);
      expect(await avvisiOwner(app)).toEqual([primo]);
      await expect(carte(home)).toHaveCount(1);
      stato.dati = 96000;
    } finally { await chiudiApp(app); }

    // Riaperto con la vista al 96%: un avviso nuovo, al posto di quello dell'85%.
    app = await avvia(userData);
    try {
      const home = await homeDellAvvio(app);
      await diventaOwner(app, home);
      await expect(carte(home).filter({ hasText: 'I crediti regalati sono al 96% del tetto, 96.000 su 100.000' })).toHaveCount(1, { timeout: 15_000 });
      await expect(carte(home)).toHaveCount(1);
      const [nuovo] = await avvisiOwner(app);
      expect(nuovo.id).not.toBe(primo.id);

      // Alzato il tetto, la lettura della pagina dell'owner (la sua, sempre fresca): l'avviso non è più vero e se ne va.
      stato.dati = 30000;
      const r = await home.evaluate(() => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.WALLET_OWNER_OVERVIEW }));
      expect(r.overview.totals.grantedCredits).toBe(30000);
      await expect.poll(() => avvisiOwner(app), { timeout: 15_000 }).toEqual([]);
      await expect(carte(home)).toHaveCount(0, { timeout: 15_000 });
    } finally { await chiudiApp(app); }
  } finally {
    try { togliCartella(userData); } catch (_) {}
  }
});

test('i quattro casi insieme: una carta ciascuno col numero, «Apri Inviti e utenti» e «Chiudi» anche dal tasto destro', async ({ app }) => {
  Object.assign(stato, { dati: 97000, inviti: 1, rifiutate: 3, segnati: ['aaaa000000000001', 'cccc000000000003'] });
  const home = await homeDellAvvio(app);
  await diventaOwner(app, home);
  await expect(carte(home)).toHaveCount(4, { timeout: 15_000 });
  // Il più grave in cima, ognuno col suo titolo.
  await expect(carte(home).locator('.dash-carta-tit')).toHaveText(['Tetto dei regali', 'Quota del giorno', 'Ingressi con invito', 'Registro d’uso']);
  await expect(carte(home).filter({ hasText: 'al 97% del tetto, 97.000 su 100.000' })).toHaveCount(1);
  await expect(carte(home).filter({ hasText: 'Resta 1 ingresso con invito' })).toHaveCount(1);
  await expect(carte(home).filter({ hasText: 'L\'ultima quota del giorno non è arrivata a 3 persone' })).toHaveCount(1);
  await expect(carte(home).filter({ hasText: 'scarto su 2 portafogli (aaaa000000000001, cccc000000000003)' })).toHaveCount(1);

  mkdirSync(SHOTS, { recursive: true });
  for (const tema of ['light', 'dark']) {
    await home.evaluate((t) => chrome.runtime.sendMessage({ type: 'update_settings', settings: { theme: t } }), tema);
    await expect(home.locator('html')).toHaveAttribute('data-sn-theme', tema);
    await home.mouse.move(5, 5);
    await home.waitForTimeout(300);
    await home.screenshot({ path: join(SHOTS, `wallet-owner-avvisi-${tema}.png`) });
  }

  const voci = home.locator('.dash-menu .dash-menu-voce');
  const inviti = carte(home).filter({ hasText: 'Resta 1 ingresso con invito' });
  await inviti.click({ button: 'right', position: { x: 30, y: 12 } });
  await expect(voci.filter({ hasText: 'Apri Inviti e utenti' })).toBeVisible();
  await expect(voci.filter({ hasText: 'Chiudi' }).first()).toBeVisible();
  await home.screenshot({ path: join(SHOTS, 'wallet-owner-avvisi-menu.png') });
  await home.keyboard.press('Escape');

  // Chiusa dall'owner, a una lettura nuova con la stessa situazione non torna.
  await inviti.locator('.dash-carta-az.secondaria').click();
  await expect(carte(home)).toHaveCount(3);
  const lette = stato.letture;
  await home.evaluate(() => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.WALLET_OWNER_OVERVIEW }));
  expect(stato.letture).toBeGreaterThan(lette);
  expect(await app.evaluate(() => globalThis.SN_WALLET_MAIN.controllaAvvisiOwner())).toBe('fatto');
  expect((await avvisiOwner(app)).map((n) => n.caso).sort()).toEqual(['giornaliera', 'scarto', 'tetto']);
  await expect(carte(home)).toHaveCount(3);

  // Il tasto destro apre la stessa pagina del pulsante.
  await carte(home).filter({ hasText: 'del tetto' }).click({ button: 'right', position: { x: 30, y: 12 } });
  await voci.filter({ hasText: 'Apri Inviti e utenti' }).click();
  const owner = await aspettaFinestra(app, (w) => w.url().startsWith(GESTIONE), 'il tasto destro non apre Gestione');
  await expect(owner.locator('.mg-tab--active[data-tab="utenti"]')).toBeVisible({ timeout: 15_000 });
});

test('chi non è owner non fa partire nessuna lettura: né la home, né il controllo dell’avvio, né quello delle sei ore', async ({ app }) => {
  Object.assign(stato, { dati: 99000, inviti: 0, rifiutate: 5, segnati: ['aaaa000000000001'] });
  const home = await homeDellAvvio(app);
  // Il controllo dell'avvio parte qualche secondo dopo: lo si lascia passare.
  await expect.poll(() => app.evaluate(() => process.uptime()), { timeout: 30_000 }).toBeGreaterThan(8);
  expect(await app.evaluate(() => globalThis.SN_WALLET_MAIN.controllaAvvisiOwner())).toBe('non_owner');
  expect(stato.letture).toBe(0);
  expect(await avvisiOwner(app)).toEqual([]);
  await expect(carte(home)).toHaveCount(0);
});

test('se il server non risponde non compare nessun avviso; al controllo dopo, con il server tornato, sì', async ({ app }) => {
  Object.assign(stato, { dati: 85000, giu: true });
  const home = await homeDellAvvio(app);
  await diventaOwner(app, home);
  expect(stato.letture).toBeGreaterThan(0);
  expect(await app.evaluate(() => globalThis.SN_WALLET_MAIN.controllaAvvisiOwner())).toBe('non_letta');
  expect(await avvisiOwner(app)).toEqual([]);
  await expect(carte(home)).toHaveCount(0);

  stato.giu = false;
  expect(await app.evaluate(() => globalThis.SN_WALLET_MAIN.controllaAvvisiOwner())).toBe('fatto');
  await expect(carte(home).filter({ hasText: 'all\'85% del tetto' })).toHaveCount(1, { timeout: 15_000 });
});
