// Verifica indipendente (giro 2) del feedback #598 — spec temporaneo, da togliere.
import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { argomentiScala } from './helpers/scala.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');
const SHOTS = join(APP_ROOT, 'tests', '.shots');

const PSEUDO = 'abcdef0123456789';
const REDEEM_MESSAGES = {
  invalid_code: 'Questo codice non esiste. Controlla di averlo copiato tutto.',
  code_used: 'Questo codice è già stato usato.',
  own_code: 'È un tuo codice: dallo a qualcun altro.',
  already_in: 'Hai già i tuoi crediti su questa installazione.',
  invites_exhausted: 'Per ora i posti sono finiti: riprova fra qualche giorno.',
  global_cap: 'Per ora non possiamo dare altri crediti: riprova fra qualche giorno.',
  missing_exchange_rate: 'Il server non è ancora pronto (manca il cambio del giorno): riprova fra qualche minuto.',
  not_configured: 'Il server non è ancora configurato per i crediti.',
  provider_error: 'Il servizio dei modelli non ha risposto: riprova fra poco.',
  internal: 'Qualcosa è andato storto sul server: riprova.',
  not_reachable: 'Non riesco a raggiungere il server: controlla la connessione.',
};

function b64(o) { return Buffer.from(JSON.stringify(o)).toString('base64url'); }
function fakeJwt(uid) { return `${b64({ alg: 'none' })}.${b64({ user_id: uid, sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`; }

const NO_WALLET = { hasWallet: false, invitesOpen: true, configured: true };
const WITH_WALLET = (extra = {}) => ({
  hasWallet: true, pseudonym: PSEUDO, stale: false, disabled: false, dailyCredits: 100,
  balance: { credits: 5000, creditsGranted: 5000, limitUsd: 3.85, usageUsd: 0, remainingUsd: 3.85, eurUsd: 1.1, eurPerCredit: 0.0007 },
  invites: [{ code: 'AAAA-BBBB', used: false }, { code: 'CCCC-DDDD', used: false }, { code: 'EEEE-FFFF', used: true, usedAt: '2026-09-08T10:00:00Z' }],
  ...extra,
});

// Il server finto: identità, rinnovo token e funzioni wallet*.
const srv = {
  uid: 'uid-verifica-1', signups: 0, refreshes: 0, calls: [], identityMode: 'ok', down: false,
  state: NO_WALLET, redeemDelay: 0,
  redeemResult: (code) => ({ status: 'ok', key: 'sk-or-v1-personale-di-prova', pseudonym: PSEUDO, credits: 5000, inviteCodes: ['AAAA-BBBB', 'CCCC-DDDD', 'EEEE-FFFF'] }),
  reissueResult: () => ({ status: 'ok', key: 'sk-or-v1-nuova', pseudonym: PSEUDO }),
  base: '',
};
let server;

function readBody(req) {
  return new Promise((r) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => r(s)); });
}

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    const raw = await readBody(req);
    if (srv.down) { res.destroy(); return; }
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (url === '/accounts:signUp') {
      if (srv.identityMode === 'admin_only') return json(400, { error: { message: 'ADMIN_ONLY_OPERATION' } });
      srv.signups++;
      return json(200, { idToken: fakeJwt(srv.uid), refreshToken: 'rt-' + srv.uid, expiresIn: '3600', localId: srv.uid });
    }
    if (url === '/token') {
      srv.refreshes++;
      return json(200, { id_token: fakeJwt(srv.uid), expires_in: '3600', user_id: srv.uid, refresh_token: 'rt-' + srv.uid });
    }
    let data = {};
    try { data = JSON.parse(raw || '{}').data || {}; } catch (_) {}
    srv.calls.push({ url, data, auth: req.headers.authorization || '' });
    if (!req.headers.authorization) return json(401, { error: { message: 'unauthenticated' } });
    if (url === '/walletState') return json(200, { result: srv.state });
    if (url === '/walletRedeem') {
      if (srv.redeemDelay) await new Promise((r) => setTimeout(r, srv.redeemDelay));
      const r = srv.redeemResult(data.code);
      if (r && r.httpStatus) return json(r.httpStatus, { error: { message: 'boom' } });
      if (r && r.status === 'ok') srv.state = WITH_WALLET();
      return json(200, { result: r });
    }
    if (url === '/walletReissue') return json(200, { result: srv.reissueResult() });
    return json(403, { error: { message: 'permission-denied' } });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  srv.base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = srv.base;
  process.env.FILO_IDENTITY_ENDPOINT = `${srv.base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${srv.base}/token`;
  delete process.env.FILO_DEFAULT_OPENROUTER_KEY;
  delete process.env.FILO_DEFAULT_TAVILY_KEY;
  mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(async () => { await new Promise((r) => server.close(r)); });
test.beforeEach(() => {
  srv.calls = []; srv.state = NO_WALLET; srv.down = false; srv.identityMode = 'ok'; srv.redeemDelay = 0;
  srv.uid = 'uid-' + Math.random().toString(36).slice(2, 10);
  srv.redeemResult = () => ({ status: 'ok', key: 'sk-or-v1-personale-di-prova', pseudonym: PSEUDO, credits: 5000, inviteCodes: ['AAAA-BBBB', 'CCCC-DDDD', 'EEEE-FFFF'] });
});

const CREDITS_URL = 'filo://credits/credits.html';
const walletState = (page) => page.evaluate(() => chrome.runtime.sendMessage({ type: 'wallet_state' }));
const callsTo = (name) => srv.calls.filter((c) => c.url === '/' + name).length;

async function launchOwn(userData) {
  return electron.launch({
    args: [...argomentiScala, '.'], cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
  });
}
async function openIn(app, url) {
  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  const target = new URL(url).hostname;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const deadline = Date.now() + 10_000;
  let page = null;
  while (Date.now() < deadline) {
    page = app.windows().find((w) => { try { return new URL(w.url()).hostname === target; } catch (_) { return false; } });
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!page) throw new Error('nessuna window per ' + url);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  return page;
}

test('installazione nuova: niente saldo finto, invito in cima, home e chat indicano l’invito', async ({ openTab }) => {
  const page = await openTab(CREDITS_URL);
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#hero')).toBeHidden();
  await expect(page.locator('#refillHint')).toBeHidden();
  await expect(page.locator('#offlineHint')).toBeHidden();
  await expect(page.locator('#invitesSection')).toBeHidden();
  await expect(page.locator('#ownerSection')).toBeHidden();
  await expect(page.locator('#walletNote')).toBeHidden();
  const ws = await walletState(page);
  expect(ws.keySource).toBe('none');
  expect(ws.hasPersonalKey).toBe(false);
  expect(ws.identity.ok).toBe(true);
  expect(ws.server.hasWallet).toBe(false);
  // Il primo elemento visibile della pagina, dopo il titolo, è il campo dell'invito
  const firstVisible = await page.evaluate(() => {
    const els = [...document.querySelectorAll('main > *')].filter((e) => !e.hidden && e.id !== 'title');
    return els.map((e) => e.id);
  });
  expect(firstVisible[0]).toBe('wallet');
  await page.screenshot({ path: join(SHOTS, 'v598-nuova-chiaro.png') });
  await page.evaluate(() => window.SN_STORAGE.updateSettings({ theme: 'dark' }));
  await page.reload();
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: join(SHOTS, 'v598-nuova-scuro.png') });

  // Home: il messaggio dice dell'invito, non del login
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 20000 });
  const homeText = await home.locator('body').innerText();
  expect(homeText).not.toMatch(/Accedi con un profilo/i);
  // Chat: la prima domanda
  const input = home.locator('#input');
  await input.fill('ciao, che ore sono?');
  await input.press('Enter');
  await expect(home.locator('body')).toContainText(/codice d.invito/i, { timeout: 20000 });
  await expect(home.locator('body')).not.toContainText(/Accedi con un profilo/i);
  await home.screenshot({ path: join(SHOTS, 'v598-home-chat-senza-chiave.png') });
});

test('riscatto: codice sporco, saldo e codici dal server, chiave personale in uso, precedenza alla propria', async ({ openTab }) => {
  const page = await openTab(CREDITS_URL);
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  await page.locator('#inviteCode').fill('  ab cd-efgh ');
  await page.locator('#redeemBtn').click();
  await expect(page.locator('#redeemMsg')).toContainText('Invito riscattato', { timeout: 15000 });
  const redeems = srv.calls.filter((c) => c.url === '/walletRedeem');
  expect(redeems.length).toBe(1);
  expect(redeems[0].data.code).toBe('ab cd-efgh');
  expect(redeems[0].auth).toMatch(/^Bearer /);
  await expect(page.locator('#redeemForm')).toBeHidden();
  await expect(page.locator('#hero')).toBeVisible();
  await expect(page.locator('#balance')).toHaveText('5.000');
  await expect(page.locator('#refillHint')).toHaveText(/\+100 crediti ogni giorno, e si accumulano/);
  await expect(page.locator('#offlineHint')).toBeHidden();
  await expect(page.locator('#invites li')).toHaveCount(3);
  await expect(page.locator('#invites li').nth(0).locator('.sn-wallet-code')).toHaveText('AAAA-BBBB');
  await expect(page.locator('#invites li').nth(2)).toHaveClass(/is-used/);
  await expect(page.locator('#invites li').nth(2).locator('.sn-wallet-code')).toBeDisabled();
  await page.locator('#invites li').nth(0).locator('.sn-wallet-code').click();
  await expect(page.locator('#invites li').nth(0).locator('.sn-wallet-code')).toHaveText('Copiato');
  await expect(page.locator('#invites li').nth(0).locator('.sn-wallet-code')).toHaveText('AAAA-BBBB', { timeout: 3000 });
  let ws = await walletState(page);
  expect(ws.hasPersonalKey).toBe(true);
  expect(ws.keySource).toBe('personal');
  expect(ws.pseudonym).toBe(PSEUDO);
  expect(ws.usingOwnKey).toBe(false);
  await page.screenshot({ path: join(SHOTS, 'v598-portafoglio-chiaro.png') });

  // La chiave in chiaro non deve stare nelle impostazioni
  const settings = await page.evaluate(() => window.SN_STORAGE.getSettings());
  expect(JSON.stringify(settings)).not.toContain('sk-or-v1-personale');

  // Tema scuro
  await page.evaluate(() => window.SN_STORAGE.updateSettings({ theme: 'dark' }));
  await page.reload();
  await expect(page.locator('#balance')).toHaveText('5.000', { timeout: 15000 });
  await page.screenshot({ path: join(SHOTS, 'v598-portafoglio-scuro.png') });

  // Chiave propria: ha la precedenza, e la pagina lo dice
  await page.evaluate(() => window.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'sk-or-v1-mia' } }));
  await page.reload();
  await expect(page.locator('#walletNote')).toContainText('Stai usando la tua chiave OpenRouter', { timeout: 15000 });
  ws = await walletState(page);
  expect(ws.keySource).toBe('own');
  expect(ws.usingOwnKey).toBe(true);
  // Tolta la chiave, si torna alla personale
  await page.evaluate(() => window.SN_STORAGE.updateSettings({ apiKeys: { openrouter: '' } }));
  await page.reload();
  await expect(page.locator('#balance')).toHaveText('5.000', { timeout: 15000 });
  ws = await walletState(page);
  expect(ws.keySource).toBe('personal');
  await expect(page.locator('#walletNote')).toBeHidden();
});

test('riscatto: esiti d’errore, doppio clic, vuoto, testo lungo, HTML', async ({ openTab }) => {
  const page = await openTab(CREDITS_URL);
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  const input = page.locator('#inviteCode');
  const msg = page.locator('#redeemMsg');
  for (const status of Object.keys(REDEEM_MESSAGES).filter((s) => s !== 'not_reachable')) {
    srv.redeemResult = () => ({ status });
    const before = callsTo('walletRedeem');
    await input.fill('XXXX-YYYY');
    await input.press('Enter');
    await expect(msg).toHaveText(REDEEM_MESSAGES[status], { timeout: 10000 });
    await expect(msg).toHaveClass(/is-error/);
    await expect(input).toBeEnabled();
    await expect(page.locator('#redeemBtn')).toBeEnabled();
    expect(callsTo('walletRedeem')).toBe(before + 1);
  }
  // esito sconosciuto → internal
  srv.redeemResult = () => ({ status: 'qualcosa_di_nuovo' });
  await input.fill('XXXX-YYYY'); await input.press('Enter');
  await expect(msg).toHaveText(REDEEM_MESSAGES.internal, { timeout: 10000 });
  // HTTP 500
  srv.redeemResult = () => ({ httpStatus: 500 });
  await input.fill('XXXX-YYYY'); await input.press('Enter');
  await expect(msg).toHaveText(REDEEM_MESSAGES.not_reachable, { timeout: 10000 });
  // HTTP 403 (funzione che rifiuta)
  srv.redeemResult = () => ({ httpStatus: 403 });
  await input.fill('XXXX-YYYY'); await input.press('Enter');
  await expect(msg).toHaveText(REDEEM_MESSAGES.not_reachable, { timeout: 10000 });
  // server che chiude la connessione
  srv.down = true;
  await input.fill('XXXX-YYYY'); await input.press('Enter');
  await expect(msg).toHaveText(REDEEM_MESSAGES.not_reachable, { timeout: 10000 });
  srv.down = false;
  // vuoto e soli spazi: nessuna richiesta
  srv.redeemResult = () => ({ status: 'invalid_code' });
  let before = callsTo('walletRedeem');
  await input.fill(''); await page.locator('#redeemBtn').click();
  await input.fill('     '); await page.locator('#redeemBtn').click();
  await page.waitForTimeout(500);
  expect(callsTo('walletRedeem')).toBe(before);
  // 10.000 caratteri, HTML, emoji
  await input.fill('A'.repeat(10000)); await input.press('Enter');
  await expect(msg).toHaveText(REDEEM_MESSAGES.invalid_code, { timeout: 10000 });
  await input.fill('<img src=x onerror="document.title=\'XSS\'">😀'); await input.press('Enter');
  await expect(msg).toHaveText(REDEEM_MESSAGES.invalid_code, { timeout: 10000 });
  expect(await page.title()).not.toBe('XSS');
  // doppio clic e Invio durante l'attesa: una sola richiesta
  srv.redeemDelay = 1500;
  before = callsTo('walletRedeem');
  await input.fill('XXXX-YYYY');
  await page.locator('#redeemBtn').click();
  await page.locator('#redeemBtn').click({ force: true }).catch(() => {});
  await input.press('Enter').catch(() => {});
  await page.keyboard.press('Enter');
  await expect(msg).toHaveText(REDEEM_MESSAGES.invalid_code, { timeout: 10000 });
  await page.waitForTimeout(300);
  expect(callsTo('walletRedeem')).toBe(before + 1);
  await page.screenshot({ path: join(SHOTS, 'v598-errore.png') });
});

test('server dei crediti giù e posti finiti: ognuno con la sua nota', async ({ openTab }) => {
  srv.state = { hasWallet: false, invitesOpen: false, configured: true };
  const page = await openTab(CREDITS_URL);
  await expect(page.locator('#walletNote')).toContainText('posti sono finiti', { timeout: 15000 });
  await expect(page.locator('#redeemForm')).toBeVisible();
  // Il server sparisce: la pagina lo dice e il campo resta
  srv.down = true;
  await page.reload();
  await expect(page.locator('#walletNote')).toContainText('server dei crediti non risponde', { timeout: 15000 });
  await expect(page.locator('#redeemForm')).toBeVisible();
  srv.down = false;
});

test('portafoglio sul server ma chiave non qui: la nuova chiave si chiede dalla pagina', async ({ openTab }) => {
  srv.state = WITH_WALLET({ invites: [] });
  const page = await openTab(CREDITS_URL);
  await expect(page.locator('#walletNote')).toContainText('chiave personale non è su questo computer', { timeout: 15000 });
  await expect(page.locator('#reissueBtn')).toBeVisible();
  await expect(page.locator('#redeemForm')).toBeHidden();
  await expect(page.locator('#balance')).toHaveText('5.000');
  let ws = await walletState(page);
  expect(ws.hasPersonalKey).toBe(false);
  expect(ws.keySource).toBe('none');
  await page.locator('#reissueBtn').click();
  await expect(page.locator('#walletNote')).toContainText('Nuova chiave pronta', { timeout: 15000 });
  expect(callsTo('walletReissue')).toBe(1);
  await expect(page.locator('#reissueBtn')).toBeHidden();
  ws = await walletState(page);
  expect(ws.hasPersonalKey).toBe(true);
  expect(ws.keySource).toBe('personal');
  expect(ws.pseudonym).toBe(PSEUDO);
  // Server che rifiuta la nuova chiave: la nota lo dice e il bottone resta
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'wallet_state' }));
});

test('crediti finiti: un avviso con la quota di domani, non uno per chiamata; owner negato senza login', async ({ app, openTab, testServer }) => {
  srv.state = WITH_WALLET();
  const page = await openTab(CREDITS_URL);
  await expect(page.locator('#balance')).toHaveText('5.000', { timeout: 15000 });
  const web = await testServer.openReady(openTab, '<html><body><h1>Pagina di prova</h1><p>testo</p></body></html>');
  await app.evaluate(() => globalThis.SN_WALLET_MAIN.outOfCreditsNotice());
  await expect(web.locator('.sn-toast')).toHaveCount(1, { timeout: 10000 });
  await expect(web.locator('.sn-toast')).toContainText('I crediti di Filo sono finiti (domani ne arrivano 100)');
  await expect(web.locator('.sn-toast')).toContainText('tua chiave OpenRouter');
  await app.evaluate(() => globalThis.SN_WALLET_MAIN.outOfCreditsNotice());
  await app.evaluate(() => globalThis.SN_WALLET_MAIN.outOfCreditsNotice());
  await web.waitForTimeout(500);
  await expect(web.locator('.sn-toast')).toHaveCount(1);
  await web.screenshot({ path: join(SHOTS, 'v598-toast-crediti-finiti.png') });

  // Comandi owner senza login: negati, e il server non viene nemmeno chiamato
  for (const type of ['wallet_owner_invites', 'wallet_owner_overview', 'wallet_owner_grant']) {
    const r = await page.evaluate((t) => chrome.runtime.sendMessage({ type: t, count: 5, pseudonym: 'x', credits: 10 }), type);
    expect(r).toEqual({ ok: false, error: 'not_admin' });
  }
  expect(callsTo('walletCreateInvites') + callsTo('walletOverview') + callsTo('walletGrant')).toBe(0);
  await expect(page.locator('#ownerSection')).toBeHidden();
});

test('movimenti locali e saldo locale con il portafoglio attivo', async ({ app, openTab }) => {
  srv.state = WITH_WALLET();
  await app.evaluate(() => globalThis.SN_CREDITS.award({ kind: 'auto_feedback_bonus', credits: 10 }));
  const page = await openTab(CREDITS_URL);
  await expect(page.locator('#balance')).toHaveText('5.000', { timeout: 15000 });
  const movesHidden = await page.locator('#movesSection').isHidden();
  const movesText = movesHidden ? '' : await page.locator('#moves').innerText();
  console.log('MOVIMENTI con portafoglio: hidden=', movesHidden, 'testo=', JSON.stringify(movesText));
  const usageEmpty = await page.locator('#usageEmpty').isVisible();
  console.log('usageEmpty visibile:', usageEmpty);
  await page.screenshot({ path: join(SHOTS, 'v598-movimenti.png') });
});

test('identità non abilitata sul server: la pagina lo dice', async () => {
  srv.identityMode = 'admin_only';
  const userData = cartellaTemporanea('filo-v598-id-');
  const app = await launchOwn(userData);
  try {
    const page = await openIn(app, CREDITS_URL);
    await expect(page.locator('#walletNote')).toContainText('identità anonima non abilitata', { timeout: 15000 });
    await expect(page.locator('#redeemForm')).toBeVisible();
    // Riscatto tentato lo stesso: messaggio chiaro
    await page.locator('#inviteCode').fill('XXXX-YYYY');
    await page.locator('#redeemBtn').click();
    await expect(page.locator('#redeemMsg')).toHaveText(REDEEM_MESSAGES.not_reachable, { timeout: 10000 });
    // Il server si sblocca: al prossimo tentativo funziona senza riavviare
    srv.identityMode = 'ok';
    await page.locator('#inviteCode').fill('XXXX-YYYY');
    await page.locator('#redeemBtn').click();
    await expect(page.locator('#redeemMsg')).toContainText('Invito riscattato', { timeout: 15000 });
  } finally {
    await app.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
  }
});

test('riavvio: chiave personale e identità sopravvivono, la chiave non è in chiaro sul disco', async () => {
  const userData = cartellaTemporanea('filo-v598-restart-');
  let app = await launchOwn(userData);
  try {
    const page = await openIn(app, CREDITS_URL);
    await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
    await page.locator('#inviteCode').fill('ABCD-EFGH');
    await page.locator('#redeemBtn').click();
    await expect(page.locator('#redeemMsg')).toContainText('Invito riscattato', { timeout: 15000 });
    await app.close();
    const walletBin = join(userData, 'wallet.bin');
    const identityBin = join(userData, 'identity.bin');
    expect(existsSync(walletBin)).toBe(true);
    expect(existsSync(identityBin)).toBe(true);
    expect(readFileSync(walletBin, 'latin1')).not.toContain('sk-or-v1');
    expect(readFileSync(identityBin, 'latin1')).not.toContain('rt-uid');
    const signupsBefore = srv.signups;
    app = await launchOwn(userData);
    const page2 = await openIn(app, CREDITS_URL);
    await expect(page2.locator('#balance')).toHaveText('5.000', { timeout: 15000 });
    await expect(page2.locator('#redeemForm')).toBeHidden();
    const ws = await walletState(page2);
    expect(ws.hasPersonalKey).toBe(true);
    expect(ws.keySource).toBe('personal');
    expect(ws.pseudonym).toBe(PSEUDO);
    expect(srv.signups).toBe(signupsBefore);
    expect(srv.refreshes).toBeGreaterThan(0);
  } finally {
    await app.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
  }
});
