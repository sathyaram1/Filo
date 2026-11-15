// Gestione → Utenti mostra gli account anonimi (#2067): quanti sono, quanti nati dentro le corse delle prove, e la
// pulizia dei mai tornati senza portafoglio, che parte solo dopo un secondo sì e si ferma dal tasto. Server e identità
// sono un HTTP locale.

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';
import { GESTIONE, ricaricaSu } from './helpers/gestione.mjs';

const OWNER_EMAIL = 'owner@prova.test';
const OWNER_REFRESH = 'rt-owner';

const CENSIMENTO = () => ({
  at: '2026-11-15T10:00:00.000Z', completo: true,
  totale: 245_160, anonimi: 245_155, conAccesso: 5, anonimiSenzaPortafoglio: 245_150, maiRientrati: 245_000, cancellabili: 230_000,
  portafogli: 5,
  criteri: { etaMinimaGiorni: 14, rientroOre: 1, natiPrimaDi: '2026-11-01T10:00:00.000Z' },
  origine: {
    giorni: 30, totale: 200_000, fuori: 2_000, ultime24h: 15_700,
    perWorkflow: { 'suite.yml': 197_000, 'verifica-linux.yml': 600, 'release.yml': 400 },
    perGiorno: [{ giorno: '2026-11-14', nati: 15_700, inCorsa: 15_650 }, { giorno: '2026-11-13', nati: 14_000, inCorsa: 13_990 }],
  },
  corse: { 'suite.yml': { lette: 700, completo: true }, 'verifica-linux.yml': { lette: 580, completo: true }, 'release.yml': { lette: 30, completo: true } },
});

const stato = { censimento: null, pulizia: null, chiamate: [], guasto: false };
let server;

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
        return json(res, 200, { result: {
          config: { invitesRemaining: 9, entryCredits: 5000, dailyCredits: 100, eurUsd: 1.2, eurPerCredit: 0.0007, eurUsdAt: '2026-10-15', maxGrantUsd: 50 },
          totals: { users: 0, totalLimitUsd: 0, maxGrantUsd: 50, maxGrantCredits: 59523, grantedCredits: 0, liveCredits: 0 },
          ownerInvites: [], users: [],
        } });
      }
      if (url === '/ownerAccountAnonimi') {
        const data = (JSON.parse(raw || '{}').data) || {};
        stato.chiamate.push(data);
        if (stato.guasto) return json(res, 500, { error: { message: 'INTERNAL' } });
        if (data.op === 'cancella') {
          stato.pulizia = { stato: 'in_corso', chiestaIl: '2026-11-15T11:00:00.000Z', attesi: data.attesi, cancellati: 30_000, falliti: 0 };
        }
        if (data.op === 'ferma' && stato.pulizia) stato.pulizia = { ...stato.pulizia, stato: 'fermata', fermataIl: '2026-11-15T11:01:00.000Z' };
        return json(res, 200, { result: { ok: true, censimento: stato.censimento, pulizia: stato.pulizia } });
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

test.beforeEach(() => { stato.censimento = CENSIMENTO(); stato.pulizia = null; stato.chiamate = []; stato.guasto = false; });

async function apriOwner(app, openTab) {
  const owner = await app.evaluate(async ({}, o) => {
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
  expect(owner).toBe(true);
  const page = await openTab(`${GESTIONE}#utenti`);
  await page.waitForFunction(() => { const s = document.getElementById('ownerSection'); return s && !s.hidden; }, null, { timeout: 15_000 });
  return page;
}

const riquadro = (page, nome) => page.locator('#ownerAnonimi .sn-wallet-numero')
  .filter({ has: page.locator('.sn-wallet-numero-nome', { hasText: nome }) });
const riga = (page) => page.locator('#ownerAnonimiPulizia');

test('i numeri degli account anonimi e da dove nascono', async ({ app, openTab }) => {
  const page = await apriOwner(app, openTab);
  await expect(page.locator('#ownerAnonimi .sn-wallet-numero')).toHaveCount(4, { timeout: 15_000 });
  await expect(riquadro(page, 'account anonimi').locator('.sn-wallet-numero-valore')).toHaveText('245.155');
  await expect(riquadro(page, 'mai tornati, senza portafoglio').locator('.sn-wallet-numero-valore')).toHaveText('245.000');
  const prove = riquadro(page, 'nati dentro le prove in 30 giorni');
  await expect(prove.locator('.sn-wallet-numero-valore')).toHaveText('99%');
  await expect(prove.locator('.sn-wallet-numero-nota')).toHaveText('198.000 su 200.000');
  await expect(prove).toHaveAttribute('title', /Suite delle prove: 197\.000\nVerifica Linux: 600\nRilasci: 400\nFuori dalle prove: 2\.000/);
  await expect(riquadro(page, 'nati nel giorno prima del conto').locator('.sn-wallet-numero-valore')).toHaveText('15.700');
  const tasto = riga(page).getByRole('button', { name: 'Cancella 230.000 account' });
  await expect(tasto).toBeVisible();
  await expect(tasto).toHaveAttribute('title', /senza portafoglio, mai tornati dopo la prima ora e nati prima del 1 nov\. Non si torna indietro\./);
  expect(stato.chiamate.every((c) => c.op === 'stato')).toBe(true);
  await page.locator('#ownerAnonimiTitle').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/account-anonimi-chiaro.png' });

  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'update_settings', settings: { theme: 'dark' } }));
  await ricaricaSu(page, 'utenti');
  await expect(page.locator('#ownerAnonimi .sn-wallet-numero')).toHaveCount(4, { timeout: 15_000 });
  await page.locator('#ownerAnonimiTitle').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/account-anonimi-scuro.png' });
});

test('la pulizia parte solo dopo il secondo sì, col numero letto sul tasto, e si ferma dal tasto', async ({ app, openTab }) => {
  const page = await apriOwner(app, openTab);
  const tasto = riga(page).getByRole('button', { name: 'Cancella 230.000 account' });
  await expect(tasto).toBeVisible({ timeout: 15_000 });

  await tasto.click();
  await expect(riga(page)).toContainText('Cancellare 230.000 account anonimi? Non si torna indietro');
  await riga(page).getByRole('button', { name: 'No' }).click();
  await expect(riga(page).getByRole('button', { name: 'Cancella 230.000 account' })).toBeVisible();
  await riga(page).getByRole('button', { name: 'Cancella 230.000 account' }).click();
  await page.keyboard.press('Escape');
  await expect(riga(page).getByRole('button', { name: 'Cancella 230.000 account' })).toBeVisible();
  expect(stato.chiamate.some((c) => c.op === 'cancella')).toBe(false);

  await riga(page).getByRole('button', { name: 'Cancella 230.000 account' }).click();
  await riga(page).getByRole('button', { name: 'Cancella', exact: true }).click();
  await expect(riga(page)).toContainText('Cancellati 30.000 su circa 230.000…', { timeout: 15_000 });
  expect(stato.chiamate.filter((c) => c.op === 'cancella')).toEqual([{ op: 'cancella', attesi: 230_000 }]);
  await page.locator('#ownerAnonimiTitle').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/account-anonimi-in-corso.png' });

  await riga(page).getByRole('button', { name: 'Ferma' }).click();
  await expect(riga(page)).toContainText('Pulizia fermata dopo 30.000.', { timeout: 15_000 });
  expect(stato.chiamate.filter((c) => c.op === 'ferma')).toHaveLength(1);
  // Fermata, il tasto torna: l'owner può riprenderla quando vuole.
  await expect(riga(page).getByRole('button', { name: 'Cancella 230.000 account' })).toBeVisible();
});

test('il server che non risponde lo dice e si rilegge; senza conto ancora fatto lo dice', async ({ app, openTab }) => {
  stato.guasto = true;
  const page = await apriOwner(app, openTab);
  await expect(riga(page)).toContainText('Il server dei crediti non risponde.', { timeout: 15_000 });
  await expect(page.locator('#ownerAnonimi .sn-wallet-numero')).toHaveCount(0);
  stato.guasto = false;
  stato.censimento = null;
  await riga(page).getByRole('button', { name: 'Riprova' }).click();
  await expect(riga(page)).toHaveText('Il server non li ha ancora contati.', { timeout: 15_000 });
  stato.censimento = CENSIMENTO();
  await ricaricaSu(page, 'utenti');
  await expect(page.locator('#ownerAnonimi .sn-wallet-numero')).toHaveCount(4, { timeout: 15_000 });
});
