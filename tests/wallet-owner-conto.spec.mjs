// La pagina «Inviti e utenti» dice se il conto OpenRouter regge e chi usa Filo (#820): residuo, caricato e speso del
// conto contro i crediti vivi e il tetto, l'allarme in cima quando non regge, attivi a 7 e 30 giorni che aprono le
// persone contate, l'ultimo uso di ognuno, i crediti spesi da tutti e il loro valore in euro. All'avvio l'owner riceve
// l'allarme una volta; chi non è owner non fa partire nessuna lettura. Server e identità sono un HTTP locale.

import { createServer } from 'node:http';
import { test, expect, aspettaFinestra } from './fixtures/electron.mjs';
import { CONFIRM_HOST, confirmText, clickConfirm } from './helpers/confirm.mjs';
import { GESTIONE, ricaricaSu } from './helpers/gestione.mjs';

const OWNER_EMAIL = 'owner@prova.test';
const OWNER_REFRESH = 'rt-owner';
const GIORNO = 24 * 60 * 60 * 1000;
const fa = (n) => new Date(Date.now() - n * GIORNO).toISOString().slice(0, 10);

const CONTO_SANO = { totalCreditsUsd: 60, totalUsageUsd: 30, readAt: '2026-10-15T08:30:00.000Z' };
const CONTO_CORTO = { totalCreditsUsd: 60, totalUsageUsd: 55.8, readAt: '2026-10-15T08:30:00.000Z' };
const stato = { account: CONTO_SANO, overview: 0 };
let server;

const PERSONE = () => [
  { pseudonym: 'aaaa000000000001', balance: { credits: 4000, creditsGranted: 5000, usageUsd: 1.5 }, invitedBy: 'owner', createdAt: '2026-09-01T08:00:00.000Z',
    usage: { rows: 9, byAction: { chat: 1.5 }, byDay: { [fa(40)]: 0.5, [fa(0)]: 1 } } },
  { pseudonym: 'bbbb000000000002', balance: { credits: 3000, creditsGranted: 3000, usageUsd: 0.25 }, invitedBy: 'owner', createdAt: '2026-09-02T08:00:00.000Z',
    usage: { rows: 2, byAction: { chat: 0.25 }, byDay: { [fa(3)]: 0.25 } } },
  { pseudonym: 'cccc000000000003', balance: { credits: 2000, creditsGranted: 2000, usageUsd: 0.1 }, invitedBy: 'owner', createdAt: '2026-09-03T08:00:00.000Z',
    usage: { rows: 1, byAction: { chat: 0.1 }, byDay: { [fa(20)]: 0.1 } } },
  { pseudonym: 'dddd000000000004', balance: { credits: 1000, creditsGranted: 2000, usageUsd: 0 }, invitedBy: 'owner', createdAt: '2026-09-04T08:00:00.000Z',
    usage: { rows: 0 } },
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
        stato.overview += 1;
        const result = {
          config: { invitesRemaining: 9, entryCredits: 5000, dailyCredits: 100, eurUsd: 1.2, eurPerCredit: 0.0007, eurUsdAt: '2026-10-15', maxGrantUsd: 50 },
          totals: { users: 4, totalLimitUsd: 10.08, maxGrantUsd: 50, maxGrantCredits: 59523, grantedCredits: 12000, liveCredits: 10000 },
          ownerInvites: [],
          users: PERSONE(),
        };
        if (stato.account !== undefined) result.account = stato.account;
        return json(res, 200, { result });
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

test.beforeEach(() => { stato.account = CONTO_SANO; stato.overview = 0; });

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

async function apriOwner(app, openTab) {
  expect(await simulaOwner(app)).toBe(true);
  const page = await openTab(`${GESTIONE}#utenti`);
  await page.waitForFunction(() => { const s = document.getElementById('ownerSection'); return s && !s.hidden; }, null, { timeout: 15_000 });
  await expect(page.locator('#ownerConto .sn-wallet-numero')).toHaveCount(4, { timeout: 15_000 });
  return page;
}

const riquadro = (page, nome) => page.locator('#ownerNumeri .sn-wallet-numero, #ownerConto .sn-wallet-numero')
  .filter({ has: page.locator('.sn-wallet-numero-nome', { hasText: nome }) });
const righeVisibili = (page) => page.locator('#ownerUsers tbody tr.sn-wallet-user:visible');
const giornoBreve = (g) => new Date(`${g}T00:00:00.000Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' });

test('il conto che regge: residuo, caricato e speso in dollari, crediti ed euro, margine sui vivi, nessun allarme', async ({ app, openTab }) => {
  const page = await apriOwner(app, openTab);
  await expect(page.locator('#ownerAllarme')).toBeHidden();
  await expect(riquadro(page, 'restano sul conto').locator('.sn-wallet-numero-valore')).toHaveText('30,00 $');
  await expect(riquadro(page, 'restano sul conto').locator('.sn-wallet-numero-nota')).toHaveText('35.714 crediti · 25,00 €');
  await expect(riquadro(page, 'caricati').locator('.sn-wallet-numero-valore')).toHaveText('60,00 $');
  await expect(riquadro(page, 'spesi dal conto').locator('.sn-wallet-numero-valore')).toHaveText('30,00 $');
  await expect(riquadro(page, 'crediti di margine sui vivi').locator('.sn-wallet-numero-valore')).toHaveText('25.714');
  await expect(page.locator('#ownerContoNota')).toContainText('Se tutti spendessero tutto quello che hanno, il conto regge.');
  await page.screenshot({ path: 'tests/.shots/wallet-owner-conto-chiaro.png', fullPage: true });

  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'update_settings', settings: { theme: 'dark' } }));
  await ricaricaSu(page, 'utenti');
  await expect(page.locator('#ownerConto .sn-wallet-numero')).toHaveCount(4, { timeout: 15_000 });
  await page.screenshot({ path: 'tests/.shots/wallet-owner-conto-scuro.png', fullPage: true });
});

test('sul conto restano meno dei crediti vivi: l’allarme sta in cima e i riquadri del conto lo dicono', async ({ app, openTab }) => {
  stato.account = CONTO_CORTO;
  const page = await apriOwner(app, openTab);
  const allarme = page.locator('#ownerAllarme');
  await expect(allarme).toBeVisible();
  await expect(allarme).toContainText('Sul conto OpenRouter restano 4,20 $, cioè 5.000 crediti, e le persone ne hanno 10.000 da spendere');
  await expect(riquadro(page, 'crediti vivi scoperti')).toHaveClass(/is-allarme/);
  await expect(riquadro(page, 'crediti vivi scoperti').locator('.sn-wallet-numero-valore')).toHaveText('5.000');
  await expect(riquadro(page, 'restano sul conto')).toHaveClass(/is-allarme/);
  // In cima vuol dire prima dei numeri.
  const sopra = await page.evaluate(() => document.getElementById('ownerAllarme').getBoundingClientRect().bottom
    <= document.getElementById('ownerNumeri').getBoundingClientRect().top);
  expect(sopra).toBe(true);
  await page.screenshot({ path: 'tests/.shots/wallet-owner-conto-allarme.png', fullPage: true });
});

test('dal conto che non regge si va a ricaricarlo: bottone nell’allarme e tasto destro sui riquadri del conto', async ({ app, openTab }) => {
  stato.account = CONTO_CORTO;
  const page = await apriOwner(app, openTab);
  // L'indirizzo chiesto dalla scheda, non quello caricato: in prova la rete verso OpenRouter può non esserci.
  const aperti = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w._filoTabs)
    .flatMap((w) => w._filoTabs.tabs.map((t) => `${t.url || ''} ${t.view ? t.view.webContents.getURL() : ''}`)));
  await page.locator('#ownerAllarme #ownerRicarica').click();
  await expect.poll(async () => (await aperti()).some((u) => u.includes('https://openrouter.ai/settings/credits')), { timeout: 15_000 }).toBe(true);

  await riquadro(page, 'restano sul conto').click({ button: 'right' });
  await expect(page.locator('.sn-wallet-ctx .sn-select-option', { hasText: 'Ricarica il conto su OpenRouter' })).toBeVisible();
  await expect(page.locator('.sn-wallet-ctx .sn-select-option', { hasText: 'Copia il numero' })).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/wallet-owner-conto-ricarica.png', fullPage: true });

  // Conto non letto: niente numero da copiare, la ricarica resta.
  stato.account = undefined;
  await ricaricaSu(page, 'utenti');
  await expect(page.locator('#ownerConto .sn-wallet-numero')).toHaveCount(4, { timeout: 15_000 });
  await expect(page.locator('#ownerRicarica')).toHaveCount(0);
  await riquadro(page, 'restano sul conto').click({ button: 'right' });
  await expect(page.locator('.sn-wallet-ctx .sn-select-option', { hasText: 'Ricarica il conto su OpenRouter' })).toBeVisible();
  await expect(page.locator('.sn-wallet-ctx .sn-select-option', { hasText: 'Copia il numero' })).toHaveCount(0);
});

test('conto non letto: trattini e una frase, mai uno zero; né col campo che manca né con OpenRouter che non risponde', async ({ app, openTab }) => {
  stato.account = undefined;
  const page = await apriOwner(app, openTab);
  for (const nome of ['restano sul conto', 'caricati', 'spesi dal conto']) {
    await expect(riquadro(page, nome).locator('.sn-wallet-numero-valore')).toHaveText('—');
  }
  await expect(page.locator('#ownerContoNota')).toContainText('Il server non manda ancora il saldo del conto OpenRouter');
  await expect(page.locator('#ownerAllarme')).toBeHidden();

  stato.account = { error: 'openrouter 503' };
  await ricaricaSu(page, 'utenti');
  await expect(page.locator('#ownerContoNota')).toContainText('Il saldo del conto OpenRouter non è arrivato', { timeout: 15_000 });
  await expect(riquadro(page, 'restano sul conto').locator('.sn-wallet-numero-valore')).toHaveText('—');
});

test('attivi a 7 e 30 giorni e ultimo uso tornano col consumo per giorno; i crediti spesi con la colonna «Speso», in euro al cambio', async ({ app, openTab }) => {
  const page = await apriOwner(app, openTab);
  await expect(riquadro(page, 'negli ultimi 7 giorni').locator('.sn-wallet-numero-valore')).toHaveText('2');
  await expect(riquadro(page, 'negli ultimi 30 giorni').locator('.sn-wallet-numero-valore')).toHaveText('3');

  const ultimo = await page.$$eval('#ownerUsers tbody tr.sn-wallet-user', (rows) => rows.map((r) => [r.cells[0].textContent, r.cells[7].textContent]));
  expect(Object.fromEntries(ultimo)).toEqual({
    aaaa000000000001: giornoBreve(fa(0)),
    bbbb000000000002: giornoBreve(fa(3)),
    cccc000000000003: giornoBreve(fa(20)),
    dddd000000000004: 'mai',
  });
  await expect(page.locator('#ownerUsers thead th').nth(7)).toHaveText('Ultimo uso');

  // 1,5 + 0,25 + 0,1 + 0 = 1,85 $; un credito costa 0,0007 € · 1,2 = 0,00084 $.
  const spesi = riquadro(page, 'crediti spesi');
  await expect(spesi.locator('.sn-wallet-numero-valore')).toHaveText('2.202,4');
  await expect(spesi.locator('.sn-wallet-numero-nota')).toHaveText('1,85 $ · 1,54 €');
  await expect(riquadro(page, 'crediti vivi').locator('.sn-wallet-numero-nota')).toHaveText('7,00 €');
  await expect(riquadro(page, 'crediti elargiti').locator('.sn-wallet-numero-nota')).toHaveText('8,40 €');
});

test('un numero di attivi apre le persone che ha contato: clic, tastiera e tasto destro, e «Mostra tutte» rimette il fuoco sul numero', async ({ app, openTab }) => {
  const page = await apriOwner(app, openTab);
  await expect(righeVisibili(page)).toHaveCount(4);
  const sette = riquadro(page, 'negli ultimi 7 giorni');
  await sette.click();
  await expect(righeVisibili(page)).toHaveCount(2);
  await expect(page.locator('#ownerFiltro')).toContainText('Solo le 2 persone che hanno usato Filo negli ultimi 7 giorni');
  await expect(sette).toHaveAttribute('aria-pressed', 'true');
  expect(await righeVisibili(page).evaluateAll((rows) => rows.map((r) => r.dataset.pseudonym).sort()))
    .toEqual(['aaaa000000000001', 'bbbb000000000002']);

  await page.click('#ownerFiltroTogli');
  await expect(righeVisibili(page)).toHaveCount(4);
  await expect(page.locator('#ownerFiltro')).toBeHidden();
  expect(await page.evaluate(() => document.activeElement && document.activeElement.dataset.giorni)).toBe('7');

  // Da tastiera, sul riquadro dei 30 giorni.
  const trenta = riquadro(page, 'negli ultimi 30 giorni');
  await trenta.focus();
  await page.keyboard.press('Enter');
  await expect(righeVisibili(page)).toHaveCount(3);

  // Il tasto destro offre la stessa cosa e il numero da copiare.
  await sette.click({ button: 'right' });
  const voce = page.locator('.sn-wallet-ctx .sn-select-option', { hasText: 'Mostra le 2 persone contate' });
  await expect(voce).toBeVisible();
  await expect(page.locator('.sn-wallet-ctx .sn-select-option', { hasText: 'Copia il numero' })).toBeVisible();
  await voce.click();
  await expect(righeVisibili(page)).toHaveCount(2);

  // Una rilettura della vista (un regalo, una manopola) tiene il filtro.
  const prima = stato.overview;
  await app.evaluate(() => globalThis.SN_BROADCAST_FILO({ type: globalThis.SN_MSG.MSG.CREDITS_CHANGED }));
  await expect.poll(() => stato.overview).toBeGreaterThan(prima);
  await expect(page.locator('#ownerUsers tbody tr.sn-wallet-user')).toHaveCount(4);
  await expect(righeVisibili(page)).toHaveCount(2);
  await expect(page.locator('#ownerFiltro')).toBeVisible();
});

test('all’avvio l’owner riceve l’allarme del conto una volta sola e da lì apre la pagina', async ({ app }) => {
  const home = await aspettaFinestra(app, (w) => w.url().startsWith('filo://newtab'), 'la home dell’avvio non è nata');
  await home.waitForFunction(() => window.__filoDashActions && window.__filoDashActions.ricompenseAvvio, null, { timeout: 0 });
  // La home dell'avvio chiede da non-owner: se chiedesse dopo il cambio, l'allarme andrebbe alla pagina che si ricarica.
  await home.evaluate(() => window.__filoDashActions.allarmeOwnerChiesto());
  stato.account = CONTO_CORTO;
  expect(await simulaOwner(app)).toBe(true);
  await home.reload();
  await expect(home.locator(CONFIRM_HOST)).toBeVisible({ timeout: 20_000 });
  expect(await confirmText(home)).toContain('Sul conto OpenRouter restano 4,20 $');
  await clickConfirm(home, 'ok');
  // L'allarme porta in Gestione, sulla scheda Inviti e utenti (#1414).
  const owner = await aspettaFinestra(app, (w) => w.url().startsWith(GESTIONE), 'Gestione non si è aperta');
  await expect(owner.locator('.mg-tab--active[data-tab="utenti"]')).toBeVisible({ timeout: 15_000 });
  await expect(owner.locator('#ownerAllarme')).toBeVisible({ timeout: 15_000 });

  // Stessa situazione: non si ridice, né a chi lo chiede di nuovo né a un'altra lettura del server.
  const lettureAvvio = stato.overview;
  const r = await owner.evaluate(() => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.WALLET_OWNER_ALARM_PENDING }));
  expect(r).toEqual({ ok: true, alarm: null });
  expect(stato.overview).toBe(lettureAvvio);
});

test('chi non è owner non fa partire nessuna lettura del conto, nemmeno all’avvio', async ({ app }) => {
  stato.account = CONTO_CORTO;
  const home = await aspettaFinestra(app, (w) => w.url().startsWith('filo://newtab'), 'la home dell’avvio non è nata');
  await home.waitForFunction(() => window.__filoDashActions && window.__filoDashActions.ricompenseAvvio, null, { timeout: 0 });
  await home.evaluate(() => window.__filoDashActions.ricompenseAvvio());
  const r = await home.evaluate(() => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.WALLET_OWNER_ALARM_PENDING }));
  expect(r).toEqual({ ok: true, alarm: null });
  await expect(home.locator(CONFIRM_HOST)).toBeHidden();
  expect(stato.overview).toBe(0);
});
