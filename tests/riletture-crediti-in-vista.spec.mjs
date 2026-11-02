// #2059 — i movimenti di crediti non rileggono dal server una vista che nessuno guarda. Gestione → Utenti: con la
// Gestione su un'altra scheda, o dietro un'altra scheda di Filo, nessuna walletOverview; al ritorno una, coi dati di
// adesso; le risposte pagate con la chiave propria non la fanno nemmeno invecchiare. Con Utenti davanti al più una
// lettura al minuto, e quella che raccoglie gli avvisi vede l'ultimo stato. La pagina Crediti dietro non chiede walletState.

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';
import { GESTIONE, apriScheda } from './helpers/gestione.mjs';

const OWNER_EMAIL = 'owner@prova.test';
const OWNER_REFRESH = 'rt-owner';
let server;
const conta = { overview: 0, state: 0 };
let persone = [];
let saldo = 4990;

function b64url(s) { return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function jwt(uid, extra = {}) {
  return `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ user_id: uid, sub: uid, ...extra }))}.firma`;
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
const persona = (pseudonym, createdAt) => ({
  pseudonym, balance: { credits: 5000, creditsGranted: 5000, usageUsd: 0 }, invitedBy: 'owner', createdAt, usage: { rows: 0 },
});

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      if (url === '/accounts:signUp') {
        return json(res, 200, { idToken: jwt('anon-1'), refreshToken: 'rt-anon', expiresIn: '3600', localId: 'anon-1' });
      }
      if (url === '/token') {
        const rt = new URLSearchParams(raw).get('refresh_token');
        if (rt === OWNER_REFRESH) return json(res, 200, { id_token: jwt('owner-1', { email: OWNER_EMAIL }), refresh_token: rt, expires_in: '3600', user_id: 'owner-1' });
        return json(res, 200, { id_token: jwt('anon-1'), refresh_token: rt, expires_in: '3600', user_id: 'anon-1' });
      }
      if (url === '/walletState') {
        conta.state += 1;
        return json(res, 200, {
          result: {
            hasWallet: true, pseudonym: 'abcdef0123456789', stale: false, dailyCredits: 100, invites: [],
            balance: { credits: saldo, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 },
            grants: [{ at: '2026-10-08T10:00:00.000Z', credits: 5000, why: 'entry' }],
          },
        });
      }
      if (url === '/walletOverview') {
        conta.overview += 1;
        return json(res, 200, {
          result: {
            config: { invitesRemaining: 9, entryCredits: 5000, dailyCredits: 100, eurUsd: 1.2, eurUsdAt: '2026-09-10', maxGrantUsd: 50 },
            totals: { users: persone.length, totalLimitUsd: 4.2, maxGrantUsd: 50 },
            ownerInvites: [],
            users: persone,
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

test.beforeEach(() => {
  persone = [persona('aaaa000000000001', '2026-10-01T08:00:00.000Z')];
  saldo = 4990;
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

// Gli avvisi come li manda il main: le risposte della chiave propria e i movimenti qualunque (consumo, regalo…).
const avvisi = (app, n, extra = {}) => app.evaluate((_, { n: quanti, extra: e }) => {
  for (let i = 0; i < quanti; i++) globalThis.SN_BROADCAST_FILO({ type: globalThis.SN_MSG.MSG.CREDITS_CHANGED, ...e });
}, { n, extra });
const schedaAttiva = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activeId);
const attiva = (shell, id) => shell.evaluate((x) => window.filoShell.tabs.activate(x), id);
const fermo = async (fn, ms = 3000) => { const prima = fn(); await new Promise((r) => setTimeout(r, ms)); return [prima, fn()]; };

// Le letture che Filo fa da sé dopo l'avvio (stato del portafoglio a 4 s, vista dell'owner a 6 s) e quelle
// dell'apertura sono finite: da qui si contano solo quelle dei movimenti.
async function letturePartiteDaSole(app, conteggio) {
  await expect.poll(() => app.evaluate(() => process.uptime()), { timeout: 30_000 }).toBeGreaterThan(9);
  await expect.poll(async () => (await fermo(conteggio, 1500)).reduce((a, b) => b - a), { timeout: 15_000 }).toBe(0);
}

async function apriUtenti(app, openTab) {
  expect(await simulaOwner(app)).toBe(true);
  const page = await openTab(`${GESTIONE}#utenti`);
  const id = await schedaAttiva(app);
  await expect(page.locator('#ownerUsers tr.sn-wallet-user')).toHaveCount(1, { timeout: 15_000 });
  await letturePartiteDaSole(app, () => conta.overview);
  return { page, id };
}

test('Gestione su un\'altra scheda: cento movimenti non leggono niente, il ritorno su Utenti legge una volta e mostra i dati di adesso', async ({ app, openTab }) => {
  const { page } = await apriUtenti(app, openTab);
  const righe = page.locator('#ownerUsers tr.sn-wallet-user');
  await apriScheda(page, 'contatori');
  await expect(page.locator('.mg-tab--active[data-tab="contatori"]')).toBeVisible();
  const base = conta.overview;

  // Le risposte della chiave propria e i rimedi dell'avviso non toccano quello che la vista mostra: tornarci non rilegge.
  await avvisi(app, 50, { ownKeyUsed: true });
  await avvisi(app, 20, { avvisoCrediti: true });
  let [, dopo] = await fermo(() => conta.overview);
  expect(dopo, 'con Utenti nascosta nessun movimento chiede la vista al server').toBe(base);
  await apriScheda(page, 'utenti');
  [, dopo] = await fermo(() => conta.overview, 2000);
  expect(dopo, 'niente di quello che la vista mostra è cambiato').toBe(base);

  // Un movimento vero con Utenti nascosta: nessuna lettura, e al ritorno una sola, coi dati di adesso.
  await apriScheda(page, 'contatori');
  persone = [persona('bbbb000000000002', '2026-10-02T08:00:00.000Z'), ...persone];
  await avvisi(app, 50);
  [, dopo] = await fermo(() => conta.overview);
  expect(dopo, 'con Utenti nascosta nessun movimento chiede la vista al server').toBe(base);

  await apriScheda(page, 'utenti');
  await expect(righe).toHaveCount(2, { timeout: 15_000 });
  await expect(righe.first()).toContainText('bbbb000000000002');
  expect(conta.overview).toBe(base + 1);
});

// Che il primo avviso dopo un minuto quieto legga subito lo prova lo unit (tests/unit/rilettoreVista.test.mjs): qui un
// avviso nato dall'accesso dell'owner può aver già preso il posto del minuto, e lo spec conta solo il tetto.
test('Utenti davanti: al più una lettura al minuto anche con cento movimenti, e la lettura dopo vede l\'ultimo stato', async ({ app, openTab }) => {
  const { page } = await apriUtenti(app, openTab);
  const righe = page.locator('#ownerUsers tr.sn-wallet-user');
  const base = conta.overview;

  await avvisi(app, 50, { ownKeyUsed: true });
  persone = [persona('cccc000000000003', '2026-10-03T08:00:00.000Z'), ...persone];
  await avvisi(app, 50);
  const [, dopo] = await fermo(() => conta.overview);
  expect(dopo - base, 'al più una lettura al minuto').toBeLessThanOrEqual(1);

  // Allo scadere (accorciato per lo spec) una lettura sola, che vede anche quello che è cambiato dopo gli avvisi.
  persone = [persona('dddd000000000004', '2026-10-04T08:00:00.000Z'), ...persone];
  await page.evaluate(() => window.__mgTest.tempiRiletturaUtenti(0));
  await expect(righe).toHaveCount(3, { timeout: 15_000 });
  await expect(righe.first()).toContainText('dddd000000000004');
  expect(conta.overview - base).toBeLessThanOrEqual(2);
});

test('Gestione dietro un\'altra scheda di Filo: i movimenti non leggono, tornarci rilegge una volta', async ({ app, openTab, shell }) => {
  const { page, id } = await apriUtenti(app, openTab);
  const righe = page.locator('#ownerUsers tr.sn-wallet-user');
  await openTab('filo://history/history.html');
  expect(await schedaAttiva(app)).not.toBe(id);
  const base = conta.overview;

  persone = [persona('ffff000000000006', '2026-10-06T08:00:00.000Z'), ...persone];
  await avvisi(app, 50);
  const [, dopo] = await fermo(() => conta.overview);
  expect(dopo, 'la Gestione dietro non chiede niente').toBe(base);

  await attiva(shell, id);
  await expect(righe.first()).toContainText('ffff000000000006', { timeout: 15_000 });
  expect(conta.overview).toBe(base + 1);
});

test('Crediti dietro un\'altra scheda non chiede il saldo al server; tornarci lo rilegge, e davanti una lettura alla volta', async ({ app, openTab, shell }) => {
  const page = await openTab('filo://credits/credits.html');
  const id = await schedaAttiva(app);
  await expect(page.locator('#balance')).toHaveText('4.990', { timeout: 15_000 });
  await letturePartiteDaSole(app, () => conta.state);

  await openTab('filo://history/history.html');
  const base = conta.state;
  saldo = 3210;
  await avvisi(app, 30);
  await avvisi(app, 30, { ownKeyUsed: true });
  const [, dopo] = await fermo(() => conta.state);
  expect(dopo, 'una pagina Crediti che nessuno guarda non chiama il server').toBe(base);

  await attiva(shell, id);
  await expect(page.locator('#balance')).toHaveText('3.210', { timeout: 15_000 });
  expect(conta.state).toBe(base + 1);

  // Davanti: trenta movimenti insieme sono una lettura in volo e una dopo, che vede l'ultimo saldo.
  saldo = 2000;
  await avvisi(app, 30);
  await expect(page.locator('#balance')).toHaveText('2.000', { timeout: 15_000 });
  await new Promise((r) => setTimeout(r, 1500));
  expect(conta.state).toBeLessThanOrEqual(base + 3);
});
