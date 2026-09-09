// Spec TEMPORANEO della verifica indipendente del #598 (terzo giro). Va tolto
// prima di registrare la critica.
import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { argomentiScala } from './helpers/scala.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');
const OWNER_EMAIL = 'sathyarampontillo@gmail.com';

function b64(o) { return Buffer.from(JSON.stringify(o)).toString('base64url'); }
function fakeJwt(uid, extra = {}) {
  return `${b64({ alg: 'none' })}.${b64({ user_id: uid, sub: uid, exp: Math.floor(Date.now() / 1000) + 3600, ...extra })}.sig`;
}
function uidOf(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return null;
  try { return JSON.parse(Buffer.from(m[1].split('.')[1], 'base64url').toString('utf8')); } catch (_) { return null; }
}
function norm(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function fmt(c) { return `${c.slice(0, 4)}-${c.slice(4)}`; }

// Server finto: identità anonima, rinnovo token, funzioni wallet*.
async function mockServer() {
  const S = {
    signUps: 0, refreshes: 0, calls: [], lastBodies: [],
    wallets: new Map(), // uid → { pseudonym, key, credits, invites:[codes], keyN }
    invites: new Map([['ABCDEFGH', { ownerUid: 'owner', fromOwner: true }], ['BBBBBBBB', { ownerUid: 'owner', fromOwner: true }]]),
    cfg: { invitesRemaining: 10, dailyCredits: 100 },
    mode: {}, // { down, http, redeemStatus, delayMs, stateDown }
    keyN: 0,
  };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', async () => {
      const path = new URL(req.url, 'http://x').pathname.split('/').pop();
      const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (path === 'signUp') {
        S.signUps += 1;
        const uid = `anon-${S.signUps}`;
        return json({ idToken: fakeJwt(uid), refreshToken: `rt-${uid}`, expiresIn: '3600', localId: uid });
      }
      if (path === 'token') {
        S.refreshes += 1;
        const p = new URLSearchParams(body);
        const rt = p.get('refresh_token') || '';
        const uid = rt.replace(/^rt-/, '');
        if (rt === 'rt-owner') return json({ id_token: fakeJwt('owner', { email: OWNER_EMAIL, email_verified: true }), refresh_token: rt, expires_in: '3600', user_id: 'owner' });
        return json({ id_token: fakeJwt(uid), refresh_token: rt, expires_in: '3600', user_id: uid });
      }
      // funzioni wallet*
      S.calls.push(path);
      if (S.mode.down) { req.socket.destroy(); return; }
      if (S.mode.http) return json({ error: { message: 'boom' } }, S.mode.http);
      const auth = uidOf(req);
      if (!auth) return json({ error: { status: 'UNAUTHENTICATED', message: 'no auth' } }, 401);
      const uid = auth.user_id;
      let data = {};
      try { data = JSON.parse(body).data || {}; } catch (_) {}
      S.lastBodies.push({ path, data });
      if (S.mode.delayMs) await new Promise((r) => setTimeout(r, S.mode.delayMs));
      const w = S.wallets.get(uid);
      const stateOf = (w) => ({
        hasWallet: true, pseudonym: w.pseudonym,
        balance: { credits: w.credits, creditsGranted: w.credits, limitUsd: w.credits * 0.0007 * 1.1, usageUsd: 0, remainingUsd: w.credits * 0.0007 * 1.1, eurUsd: 1.1, eurPerCredit: 0.0007 },
        stale: false, usageReadAt: new Date().toISOString(), disabled: false, dailyCredits: S.cfg.dailyCredits,
        invites: w.invites.map((c) => ({ code: fmt(c), used: Boolean(S.invites.get(c)?.usedBy), usedAt: S.invites.get(c)?.usedAt || null })),
      });
      if (path === 'walletState') {
        if (S.mode.stateDown) { req.socket.destroy(); return; }
        if (!w) return json({ result: { hasWallet: false, invitesOpen: S.cfg.invitesRemaining > 0, configured: true } });
        return json({ result: stateOf(w) });
      }
      if (path === 'walletRedeem') {
        if (S.mode.redeemStatus) return json({ result: { status: S.mode.redeemStatus } });
        const code = norm(data.code);
        if (w) return json({ result: { status: 'already_in' } });
        if (code.length !== 8) return json({ result: { status: 'invalid_code' } });
        const inv = S.invites.get(code);
        if (!inv) return json({ result: { status: 'invalid_code' } });
        if (inv.usedBy) return json({ result: { status: 'code_used' } });
        if (inv.ownerUid === uid) return json({ result: { status: 'own_code' } });
        if (S.cfg.invitesRemaining <= 0) return json({ result: { status: 'invites_exhausted' } });
        const pseudonym = Buffer.from(uid).toString('hex').padEnd(16, '0').slice(0, 16);
        const mine = ['CODE' + String(S.keyN + 1).padStart(4, '0'), 'CODF' + String(S.keyN + 1).padStart(4, '0'), 'CODG' + String(S.keyN + 1).padStart(4, '0')].map(norm);
        for (const c of mine) S.invites.set(c, { ownerUid: uid, fromOwner: false });
        S.keyN += 1;
        const nw = { pseudonym, key: `sk-or-v1-personal-${S.keyN}-SEGRETO`, credits: 5000, invites: mine };
        S.wallets.set(uid, nw);
        inv.usedBy = uid; inv.usedAt = new Date().toISOString();
        S.cfg.invitesRemaining -= 1;
        return json({ result: { status: 'ok', key: nw.key, pseudonym, credits: 5000, inviteCodes: mine.map(fmt) } });
      }
      if (path === 'walletReissue') {
        if (!w) return json({ result: { status: 'no_wallet' } });
        S.keyN += 1;
        w.key = `sk-or-v1-personal-${S.keyN}-NUOVA`;
        return json({ result: { status: 'ok', key: w.key, pseudonym: w.pseudonym } });
      }
      const isAdmin = auth.email === OWNER_EMAIL;
      if (path === 'walletOverview' || path === 'walletGrant' || path === 'walletCreateInvites') {
        if (!isAdmin) return json({ error: { status: 'PERMISSION_DENIED', message: 'Riservato al proprietario.' } }, 403);
      }
      if (path === 'walletOverview') {
        const users = [...S.wallets.values()].map((u) => ({
          pseudonym: u.pseudonym, balance: { credits: u.credits, creditsGranted: u.credits, usageUsd: 0.12 },
          reconcile: { flagged: u.credits > 6000, driftUsd: 0.5 }, invitedBy: 'owner', createdAt: '2026-09-09T10:00:00Z', disabled: false,
        }));
        return json({ result: {
          config: { invitesRemaining: S.cfg.invitesRemaining, entryCredits: 5000, dailyCredits: 100, eurUsd: 1.1, eurUsdAt: '2026-09-09', maxGrantUsd: 50 },
          totals: { users: users.length, totalLimitUsd: users.length * 3.85, maxGrantUsd: 50 },
          users, ownerInvites: [...S.invites.entries()].filter(([, v]) => v.fromOwner).map(([c, v]) => ({ code: fmt(c), used: Boolean(v.usedBy) })),
          daily: { lastRunAt: '2026-09-09T03:10:00Z', summary: { granted: 2, refused: 1 } },
          reconcile: { lastRunAt: '2026-09-09T11:00:00Z', summary: { flagged: 0 } },
        } });
      }
      if (path === 'walletGrant') {
        const target = [...S.wallets.values()].find((u) => u.pseudonym === data.pseudonym);
        if (!target) return json({ result: { ok: false, reason: 'no_wallet' } });
        if (S.mode.grantReason) return json({ result: { ok: false, reason: S.mode.grantReason, totalLimitUsd: 49, deltaUsd: 3, maxGrantUsd: 50 } });
        target.credits += Number(data.credits) || 0;
        return json({ result: { ok: true, credits: Number(data.credits) || 0, newLimitUsd: 1 } });
      }
      if (path === 'walletCreateInvites') {
        const n = Math.max(1, Number(data.count) || 1);
        const codes = [];
        for (let i = 0; i < n; i++) { const c = norm('OWN' + String(S.invites.size + i).padStart(5, '0')); S.invites.set(c, { ownerUid: 'owner', fromOwner: true }); codes.push(fmt(c)); }
        return json({ result: { codes } });
      }
      json({ error: { message: `sconosciuta ${path}` } }, 404);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  S.base = `http://127.0.0.1:${server.address().port}`;
  S.close = () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); });
  return S;
}

async function launch(userData, env = {}) {
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test', ...env },
  });
  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  return { app, shell };
}
const envFor = (S) => ({ FILO_FUNCTIONS_BASE: S.base, FILO_IDENTITY_ENDPOINT: `${S.base}/signUp`, FILO_SECURE_TOKEN_ENDPOINT: `${S.base}/token` });
const OFFLINE = { FILO_FUNCTIONS_BASE: 'http://127.0.0.1:9', FILO_IDENTITY_ENDPOINT: 'http://127.0.0.1:9/signUp', FILO_SECURE_TOKEN_ENDPOINT: 'http://127.0.0.1:9/token' };

async function openTab(app, shell, url) {
  const target = new URL(url).hostname;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const page = app.windows().find((w) => { try { return new URL(w.url()).hostname === target; } catch (_) { return false; } });
    if (page) { await page.waitForLoadState('domcontentloaded').catch(() => {}); return page; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`nessuna window per ${url}`);
}
async function newtab(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}
const CREDITS = 'filo://credits/credits.html';
const keySource = (app) => app.evaluate(() => globalThis.SN_WALLET_MAIN.keySource());
const shot = (page, name) => page.screenshot({ path: `tests/.shots/v598-${name}.png`, fullPage: true }).catch(() => {});

async function redeemOk(app, shell, code = ' abcd-efgh ') {
  const page = await openTab(app, shell, CREDITS);
  await expect(page.locator('#redeemForm')).toBeVisible();
  await page.locator('#inviteCode').fill(code);
  await page.locator('#redeemBtn').click();
  await expect(page.locator('#redeemMsg')).toContainText('Invito riscattato', { timeout: 10_000 });
  return page;
}

test.describe.configure({ mode: 'serial' });

test('installazione nuova: nessuna chiave, home e chat chiedono l\'invito, pagina Crediti col campo in cima', async () => {
  test.setTimeout(90_000);
  const S = await mockServer();
  const userData = cartellaTemporanea('v598-a-');
  const { app, shell } = await launch(userData, envFor(S));
  try {
    expect(await keySource(app)).toBe('none');
    const eff = await app.evaluate(async () => { const s = await globalThis.SN_STORAGE.getSettings(); return { own: s.apiKeys?.openrouter || '' }; });
    expect(eff.own).toBe('');
    // home
    const home = await newtab(app);
    await expect(home.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 15_000 });
    await expect(home.locator('#homeMessage')).toContainText(/invito/i, { timeout: 15_000 });
    const homeTxt = await home.locator('#homeMessage').textContent();
    expect(homeTxt).not.toMatch(/accedi|profilo/i);
    // chat
    await home.locator('#input').fill('ciao, che ore sono?');
    await home.locator('#sendBtn').click();
    await expect(home.locator('.dash-bubble-filo').last()).toContainText(/invito/i, { timeout: 20_000 });
    const chatTxt = await home.locator('.dash-bubble-filo').last().textContent();
    expect(chatTxt).not.toMatch(/accedi con un profilo/i);
    await shot(home, 'home-senza-chiave');
    // pagina crediti
    const page = await openTab(app, shell, CREDITS);
    await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#hero')).toBeHidden();
    await expect(page.locator('#refillHint')).toBeHidden();
    await expect(page.locator('#offlineHint')).toBeHidden();
    await expect(page.locator('#invitesSection')).toBeHidden();
    await expect(page.locator('#ownerSection')).toBeHidden();
    const movesVisible = await page.locator('#movesSection').isVisible();
    const usageEmptyVisible = await page.locator('#usageEmpty').isVisible();
    console.log('SENZA CHIAVE: movimenti visibili =', movesVisible, 'usageEmpty visibile =', usageEmptyVisible);
    await shot(page, 'crediti-senza-chiave');
    // identità creata una sola volta anche con più letture
    await page.reload(); await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#redeemForm')).toBeVisible();
    expect(S.signUps).toBe(1);
    // il campo dell'invito è raggiungibile dal menu della shell?
    const shellHtml = await shell.evaluate(() => document.body.innerHTML.length);
    expect(shellHtml).toBeGreaterThan(0);
  } finally { await app.close().catch(() => {}); await S.close(); rmSync(userData, { recursive: true, force: true }); }
});

test('riscatto, saldo dal server, codici, chiave cifrata, riavvio con la stessa identità, precedenza della chiave propria', async () => {
  test.setTimeout(150_000);
  const S = await mockServer();
  const userData = cartellaTemporanea('v598-b-');
  let { app, shell } = await launch(userData, envFor(S));
  try {
    const page = await redeemOk(app, shell);
    await expect(page.locator('#redeemForm')).toBeHidden();
    await expect(page.locator('#hero')).toBeVisible();
    await expect(page.locator('#balance')).toHaveText('5.000');
    await expect(page.locator('#refillHint')).toContainText('+100 crediti ogni giorno, e si accumulano');
    await expect(page.locator('#invites li')).toHaveCount(3);
    await expect(page.locator('#offlineHint')).toBeHidden();
    expect(S.lastBodies.find((b) => b.path === 'walletRedeem').data.code).toBe('abcd-efgh');
    expect(await keySource(app)).toBe('personal');
    // clic su un codice → copiato
    await page.locator('#invites .sn-wallet-code').first().click();
    await expect(page.locator('#invites .sn-wallet-code').first()).toHaveText('Copiato');
    await shot(page, 'crediti-con-portafoglio');
    // tema scuro
    await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
    await page.reload(); await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#balance')).toHaveText('5.000');
    await shot(page, 'crediti-con-portafoglio-scuro');
    await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'light' }); });
    // chiave cifrata su disco, non in chiaro; non nelle impostazioni
    const walletBin = join(userData, 'wallet.bin');
    expect(existsSync(walletBin)).toBe(true);
    const raw = readFileSync(walletBin);
    expect(raw.includes('SEGRETO')).toBe(false);
    expect(raw.includes('sk-or-v1')).toBe(false);
    const storage = readFileSync(join(userData, 'storage.json'), 'utf8');
    expect(storage.includes('SEGRETO')).toBe(false);
    const settingsKey = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).apiKeys?.openrouter || '');
    expect(settingsKey).toBe('');
    // la chiave effettiva per i modelli è quella personale
    const effKey = await app.evaluate(() => globalThis.SN_WALLET_MAIN.readState().then((s) => s.keySource));
    expect(effKey).toBe('personal');
    // saldo locale? la pagina mostra i movimenti locali col portafoglio?
    console.log('CON PORTAFOGLIO: movimenti visibili =', await page.locator('#movesSection').isVisible(), 'usageEmpty =', await page.locator('#usageEmpty').isVisible());
    // stessa identità dopo il riavvio
    const signUpsPrima = S.signUps;
    await app.close();
    ({ app, shell } = await launch(userData, envFor(S)));
    const p2 = await openTab(app, shell, CREDITS);
    await expect(p2.locator('#balance')).toHaveText('5.000', { timeout: 15_000 });
    await expect(p2.locator('#redeemForm')).toBeHidden();
    expect(S.signUps).toBe(signUpsPrima);
    expect(S.refreshes).toBeGreaterThan(0);
    expect(await keySource(app)).toBe('personal');
    // riscatto di un secondo codice con un portafoglio già attivo: il modulo non c'è; via messaggio → already_in
    const again = await app.evaluate(() => globalThis.SN_HANDLE_MESSAGE({ type: 'wallet_redeem', code: 'BBBB-BBBB' }, { url: 'filo://credits/credits.html' }));
    expect(again.status).toBe('already_in');
    // chiave propria → precedenza
    await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'sk-or-v1-MIA' } }); });
    expect(await keySource(app)).toBe('own');
    await p2.reload(); await p2.waitForLoadState('domcontentloaded');
    await expect(p2.locator('#walletNote')).toContainText('Stai usando la tua chiave OpenRouter', { timeout: 10_000 });
    await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: '' } }); });
    expect(await keySource(app)).toBe('personal');
    // home con la chiave personale: non chiede più l'invito
    const home = await newtab(app);
    await expect(home.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 15_000 });
    const homeTxt = await home.locator('#homeMessage').textContent({ timeout: 15_000 });
    console.log('HOME CON PORTAFOGLIO:', homeTxt);
    expect(homeTxt).not.toMatch(/codice d.invito/i);
  } finally { await app.close().catch(() => {}); await S.close(); rmSync(userData, { recursive: true, force: true }); }
});

test('esiti d\'errore del riscatto, stress sugli input, doppio clic', async () => {
  test.setTimeout(150_000);
  const S = await mockServer();
  const userData = cartellaTemporanea('v598-c-');
  const { app, shell } = await launch(userData, envFor(S));
  try {
    const page = await openTab(app, shell, CREDITS);
    await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 10_000 });
    const input = page.locator('#inviteCode');
    const btn = page.locator('#redeemBtn');
    const msg = page.locator('#redeemMsg');
    const tryCode = async (code) => {
      await input.fill(code);
      await btn.click();
      await expect(msg).not.toHaveText('Un attimo…', { timeout: 10_000 });
      await expect(msg).toBeVisible();
      await expect(input).toBeEnabled();
      await expect(btn).toBeEnabled();
      return (await msg.textContent()).trim();
    };
    // vuoto e soli spazi: niente richiesta
    const prima = S.calls.filter((c) => c === 'walletRedeem').length;
    await input.fill(''); await btn.click();
    await input.fill('     '); await btn.click();
    await page.waitForTimeout(500);
    expect(S.calls.filter((c) => c === 'walletRedeem').length).toBe(prima);
    // inesistente
    expect(await tryCode('ZZZZ-ZZZZ')).toContain('non esiste');
    // 10.000 caratteri, HTML, emoji
    expect(await tryCode('x'.repeat(10_000))).toContain('non esiste');
    expect(await tryCode('<script>alert(1)</script><b>ciao</b>')).toContain('non esiste');
    expect(await page.locator('#redeemMsg b').count()).toBe(0);
    expect(await tryCode('😀😀😀😀-😀😀😀😀')).toContain('non esiste');
    // stati del server
    const attesi = {
      code_used: 'già stato usato', own_code: 'tuo codice', already_in: 'già i tuoi crediti', invites_exhausted: 'posti sono finiti',
      global_cap: 'non possiamo dare altri crediti', missing_exchange_rate: 'cambio', not_configured: 'non è ancora configurato',
      provider_error: 'non ha risposto', internal: 'andato storto', boh_sconosciuto: 'andato storto',
    };
    for (const [st, frase] of Object.entries(attesi)) {
      S.mode.redeemStatus = st;
      const t = await tryCode('ABCD-EFGH');
      expect(t, st).toContain(frase);
    }
    S.mode.redeemStatus = null;
    S.mode.http = 500;
    expect(await tryCode('ABCD-EFGH')).toContain('raggiungere il server');
    S.mode.http = 403;
    expect(await tryCode('ABCD-EFGH')).toContain('raggiungere il server');
    S.mode.http = null;
    S.mode.down = true;
    expect(await tryCode('ABCD-EFGH')).toContain('raggiungere il server');
    S.mode.down = false;
    // doppio clic e Invio durante l'attesa → una sola richiesta
    S.mode.delayMs = 1500;
    const n0 = S.calls.filter((c) => c === 'walletRedeem').length;
    await input.fill('abcd efgh');
    await btn.dblclick();
    await input.press('Enter').catch(() => {});
    await btn.click({ force: true }).catch(() => {});
    await expect(msg).toContainText('Invito riscattato', { timeout: 10_000 });
    expect(S.calls.filter((c) => c === 'walletRedeem').length - n0).toBe(1);
    await expect(page.locator('#balance')).toHaveText('5.000');
    // il codice usato dal server: tolleranza spazi/minuscole lato server (qui: mock normalizza come il vero)
    // il codice già usato da un altro → code_used (secondo utente non simulabile qui: stesso uid → already_in)
  } finally { await app.close().catch(() => {}); await S.close(); rmSync(userData, { recursive: true, force: true }); }
});

test('portafoglio attivo ma server dei crediti giù, e Filo del tutto offline', async () => {
  test.setTimeout(150_000);
  const S = await mockServer();
  const userData = cartellaTemporanea('v598-d-');
  let { app, shell } = await launch(userData, envFor(S));
  try {
    await redeemOk(app, shell);
    await app.close();
    // 1) identità ok, funzioni wallet giù
    S.mode.stateDown = true;
    ({ app, shell } = await launch(userData, envFor(S)));
    let page = await openTab(app, shell, CREDITS);
    await expect(page.locator('#wallet')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    console.log('SERVER GIU: form invito visibile =', await page.locator('#redeemForm').isVisible(), '| saldo =', await page.locator('#balance').textContent(), '| refill =', await page.locator('#refillHint').textContent(), '| nota =', await page.locator('#walletNote').textContent());
    await expect(page.locator('#redeemForm')).toBeHidden();
    await expect(page.locator('#balance')).toHaveText('5.000');
    await expect(page.locator('#walletNote')).toContainText(/non risponde/i);
    await expect(page.locator('#refillHint')).not.toContainText('mezzanotte');
    await shot(page, 'crediti-server-giu');
    await app.close();
    S.mode.stateDown = false;
    // 2) tutto offline (identità, rinnovo token, funzioni: porta chiusa)
    ({ app, shell } = await launch(userData, OFFLINE));
    page = await openTab(app, shell, CREDITS);
    await expect(page.locator('#wallet')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    const off = {
      form: await page.locator('#redeemForm').isVisible(), balance: await page.locator('#balance').textContent(),
      refill: await page.locator('#refillHint').isVisible() ? await page.locator('#refillHint').textContent() : '(nascosto)',
      nota: await page.locator('#walletNote').textContent(), hero: await page.locator('#hero').isVisible(), offlineHint: await page.locator('#offlineHint').isVisible(),
    };
    console.log('OFFLINE TOTALE:', JSON.stringify(off));
    await shot(page, 'crediti-offline-totale');
    // RILIEVO: offline totale → modulo dell'invito e saldo locale tornano (vedi log)
  } finally { await app.close().catch(() => {}); await S.close(); rmSync(userData, { recursive: true, force: true }); }
});

test('chiave non su questo computer: nota e nuova chiave', async () => {
  test.setTimeout(120_000);
  const S = await mockServer();
  const userData = cartellaTemporanea('v598-e-');
  let { app, shell } = await launch(userData, envFor(S));
  try {
    await redeemOk(app, shell);
    await app.close();
    rmSync(join(userData, 'wallet.bin'), { force: true });
    ({ app, shell } = await launch(userData, envFor(S)));
    expect(await keySource(app)).toBe('none');
    const page = await openTab(app, shell, CREDITS);
    await expect(page.locator('#walletNote')).toContainText('chiave personale non è su questo computer', { timeout: 15_000 });
    await expect(page.locator('#reissueBtn')).toBeVisible();
    await expect(page.locator('#redeemForm')).toBeHidden();
    await expect(page.locator('#balance')).toHaveText('5.000');
    await shot(page, 'crediti-chiave-assente');
    await page.locator('#reissueBtn').click();
    await expect(page.locator('#walletNote')).toContainText('Nuova chiave pronta', { timeout: 10_000 });
    await expect(page.locator('#reissueBtn')).toBeHidden();
    expect(await keySource(app)).toBe('personal');
    expect(readFileSync(join(userData, 'wallet.bin')).includes('NUOVA')).toBe(false);
    // il server fa: nuova chiave 2
    expect(S.calls.filter((c) => c === 'walletReissue').length).toBe(1);
  } finally { await app.close().catch(() => {}); await S.close(); rmSync(userData, { recursive: true, force: true }); }
});

test('crediti finiti (402): una sola chiamata, niente ripiego, avviso una volta con la quota di domani; 429 ripiega', async () => {
  test.setTimeout(150_000);
  const S = await mockServer();
  const userData = cartellaTemporanea('v598-f-');
  const { app, shell } = await launch(userData, envFor(S));
  try {
    await redeemOk(app, shell);
    // pagina web per il toast
    const srv = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><html><body><h1>pagina</h1><p>testo</p></body></html>'); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const web = await openTab(app, shell, `http://127.0.0.1:${srv.address().port}/`);
    await web.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 }).catch(() => {});

    const r = await app.evaluate(async () => {
      const P = globalThis.SN_PROVIDERS;
      const prov = P.getProvider('openrouter');
      const orig = { complete: prov.complete, streamComplete: prov.streamComplete };
      const out = {};
      const mk = (status) => { let n = 0; const fn = async ({ onDelta }) => { n += 1; if (onDelta && n === 1) onDelta('mezzo '); const e = new Error(`OpenRouter ${status}: {"error":{"message":"Key limit exceeded"}}`); e.status = status; throw e; }; fn.count = () => n; return fn; };
      const attempts = [{ provider: 'openrouter', model: 'a/uno', apiKey: 'k' }, { provider: 'openrouter', model: 'b/due', apiKey: 'k' }];
      for (const status of [402, 429]) {
        prov.complete = mk(status);
        let err = null;
        try { await P.completeWithFallback({ attempts, messages: [{ role: 'user', content: 'x' }] }); } catch (e) { err = String(e.message); }
        out[`complete${status}`] = { calls: prov.complete.count(), err };
        prov.streamComplete = mk(status);
        err = null;
        try { await P.streamCompleteWithFallback({ attempts, messages: [{ role: 'user', content: 'x' }], onDelta: () => {} }); } catch (e) { err = String(e.message); }
        out[`stream${status}`] = { calls: prov.streamComplete.count(), err };
      }
      prov.complete = orig.complete; prov.streamComplete = orig.streamComplete;
      return out;
    });
    console.log('402/429:', JSON.stringify(r));
    expect(r.complete402.calls).toBe(1);
    expect(r.stream402.calls).toBe(1);
    expect(r.complete429.calls).toBe(2);
    expect(r.stream429.calls).toBe(2);
    await expect(web.locator('.sn-toast')).toContainText(/crediti di Filo sono finiti/i, { timeout: 8_000 });
    const toastTxt = await web.locator('.sn-toast').first().textContent();
    console.log('TOAST:', toastTxt);
    expect(toastTxt).toContain('100');
    expect(await web.locator('.sn-toast').count()).toBe(1);

    // il cammino vero della chat: il modello risponde 402 → la bolla dice crediti finiti, una chiamata sola
    const home = await newtab(app);
    await expect(home.locator('#input')).toBeVisible({ timeout: 15_000 });
    const chat = await app.evaluate(async () => {
      const P = globalThis.SN_PROVIDERS;
      const prov = P.getProvider('openrouter');
      const orig = prov.streamComplete;
      let n = 0;
      prov.streamComplete = async () => { n += 1; const e = new Error('OpenRouter 402: {"error":{"message":"Insufficient credits"}}'); e.status = 402; throw e; };
      globalThis.__restore598 = () => { prov.streamComplete = orig; };
      globalThis.__count598 = () => n;
      return true;
    });
    expect(chat).toBe(true);
    await home.locator('#input').fill('dimmi una cosa');
    await home.locator('#sendBtn').click();
    await expect(home.locator('.dash-bubble').last()).toContainText(/crediti/i, { timeout: 25_000 });
    const bubble = await home.locator('.dash-bubble').last().textContent();
    const n = await app.evaluate(() => globalThis.__count598());
    console.log('CHAT 402: chiamate =', n, '| bolla =', bubble);
    expect(n).toBe(1);
    await shot(home, 'chat-crediti-finiti');
    await app.evaluate(() => globalThis.__restore598());
    srv.close();
  } finally { await app.close().catch(() => {}); await S.close(); rmSync(userData, { recursive: true, force: true }); }
});

test('cancello sull\'origine dei messaggi wallet; owner senza login negato', async () => {
  test.setTimeout(90_000);
  const S = await mockServer();
  const userData = cartellaTemporanea('v598-g-');
  const { app } = await launch(userData, envFor(S));
  try {
    const r = await app.evaluate(async () => {
      const H = globalThis.SN_HANDLE_MESSAGE;
      const web = { url: 'https://evil.example/pagina', tab: { url: 'https://evil.example/pagina' } };
      const filo = { url: 'filo://credits/credits.html' };
      const out = {};
      for (const t of ['wallet_state', 'wallet_redeem', 'wallet_reissue', 'wallet_owner_overview', 'wallet_owner_grant', 'wallet_owner_invites']) {
        out[`web:${t}`] = await H({ type: t, code: 'ABCD-EFGH', count: 1 }, web);
      }
      out['filo:state'] = await H({ type: 'wallet_state' }, filo);
      out['filo:owner_invites'] = await H({ type: 'wallet_owner_invites', count: 1 }, filo);
      out['filo:owner_overview'] = await H({ type: 'wallet_owner_overview' }, filo);
      out['filo:owner_grant'] = await H({ type: 'wallet_owner_grant', pseudonym: 'x', credits: 1 }, filo);
      return out;
    });
    console.log('ORIGINE:', JSON.stringify(r));
    for (const k of Object.keys(r).filter((k) => k.startsWith('web:'))) expect(r[k], k).toEqual({ ok: false, error: 'forbidden' });
    expect(r['filo:state'].ok).toBe(true);
    for (const k of ['filo:owner_invites', 'filo:owner_overview', 'filo:owner_grant']) expect(r[k], k).toEqual({ ok: false, error: 'not_admin' });
    expect(S.calls.filter((c) => /Overview|Grant|CreateInvites/.test(c)).length).toBe(0);
    expect(S.calls.filter((c) => c === 'walletRedeem').length).toBe(0);
  } finally { await app.close().catch(() => {}); await S.close(); rmSync(userData, { recursive: true, force: true }); }
});

test('sezione owner della pagina Crediti (login simulato nel main)', async () => {
  test.setTimeout(150_000);
  const S = await mockServer();
  const userData = cartellaTemporanea('v598-h-');
  let { app, shell } = await launch(userData, envFor(S));
  try {
    // un utente riscatta (così la tabella ha una riga)
    await redeemOk(app, shell);
    // sessione Google finta: token-store + endpoint di rinnovo dirottato sul mock
    const ok = await app.evaluate(async ({ app }, base) => {
      const req = process.mainModule && process.mainModule.require ? process.mainModule.require.bind(process.mainModule) : null;
      if (!req) return { ok: false, why: 'no mainModule.require' };
      try {
        const path = req('node:path');
        const root = app.getAppPath();
        const cfg = req(path.join(root, 'src/main/auth/config.js'));
        cfg.secureTokenEndpoint = `${base}/token`;
        const store = req(path.join(root, 'src/main/auth/token-store.js'));
        store.save({ refreshToken: 'rt-owner', email: 'sathyarampontillo@gmail.com', name: 'Owner', picture: '' });
        const ga = req(path.join(root, 'src/main/auth/google-auth.js'));
        ga.restore();
        return { ok: true, admin: ga.isAdmin() };
      } catch (e) { return { ok: false, why: String(e && e.message || e) }; }
    }, S.base);
    console.log('LOGIN FINTO:', JSON.stringify(ok));
    if (!ok.ok || !ok.admin) { test.info().annotations.push({ type: 'skip', description: 'login owner non simulabile: ' + JSON.stringify(ok) }); return; }
    const page = await openTab(app, shell, CREDITS);
    await expect(page.locator('#ownerSection')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#ownerTotals')).toContainText('utenti', { timeout: 15_000 });
    console.log('OWNER TOTALI:', await page.locator('#ownerTotals').textContent());
    await expect(page.locator('#ownerUsers tbody tr')).toHaveCount(1);
    const row = await page.locator('#ownerUsers tbody tr').textContent();
    console.log('OWNER RIGA:', row);
    console.log('OWNER RUNS:', await page.locator('#ownerRuns').textContent());
    // genera codici
    await page.locator('#ownerInviteCount').fill('3');
    await page.locator('#ownerInvitesBtn').click();
    await expect(page.locator('#ownerMsg')).toContainText('3 codici nuovi', { timeout: 10_000 });
    await expect(page.locator('#ownerCodes li')).toHaveCount(3);
    const sent = S.lastBodies.filter((b) => b.path === 'walletCreateInvites').pop();
    expect(sent.data.count).toBe(3);
    // regalo
    const pseudonym = [...S.wallets.values()][0].pseudonym;
    await page.locator('#ownerUsers tbody tr td').first().click();
    await expect(page.locator('#ownerGrantPseudonym')).toHaveValue(pseudonym);
    await page.locator('#ownerGrantCredits').fill('250');
    await page.locator('#ownerGrantBtn').click();
    await expect(page.locator('#ownerMsg')).toContainText(`+250 crediti a ${pseudonym}`, { timeout: 10_000 });
    // regalo rifiutato: tetto globale
    S.mode.grantReason = 'global_cap';
    await page.locator('#ownerGrantCredits').fill('999');
    await page.locator('#ownerGrantBtn').click();
    await expect(page.locator('#ownerMsg')).toContainText('tetto globale', { timeout: 10_000 });
    S.mode.grantReason = null;
    // pseudonimo inesistente
    await page.locator('#ownerGrantPseudonym').fill('nessuno');
    await page.locator('#ownerGrantCredits').fill('10');
    await page.locator('#ownerGrantBtn').click();
    await expect(page.locator('#ownerMsg')).toContainText('nessun utente', { timeout: 10_000 });
    // i codici dell'owner già generati: si rivedono dopo un ricaricamento?
    await page.reload(); await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#ownerSection')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    console.log('OWNER DOPO RELOAD: codici visibili =', await page.locator('#ownerCodes li').count(), '| totali =', await page.locator('#ownerTotals').textContent());
    await shot(page, 'crediti-owner');
    // nessun uid nella vista
    const html = await page.content();
    expect(html.includes('anon-1')).toBe(false);
    // il registro d'uso: una chiamata AI con la chiave personale mette in coda una riga? (non osservabile: si dichiara)
  } finally { await app.close().catch(() => {}); await S.close(); rmSync(userData, { recursive: true, force: true }); }
});
