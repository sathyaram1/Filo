// SPEC TEMPORANEA della verifica #598 (giro 4): si cancella prima di registrare.
import { test, expect, _electron as electron } from '@playwright/test';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { argomentiScala } from './helpers/scala.mjs';
import { makeFake } from 'file:///C:/Users/agenti%20AI/AppData/Local/Temp/claude/C--Users-agenti-AI-Desktop-Filo-Filo/8c9145e1-79ed-474e-8c98-245fbdac334b/scratchpad/fake598.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');
const SHOTS = 'C:/Users/AGENTI~1/AppData/Local/Temp/claude/C--Users-agenti-AI-Desktop-Filo-Filo/8c9145e1-79ed-474e-8c98-245fbdac334b/scratchpad/shots';
mkdirSync(SHOTS, { recursive: true });
const OWNER_EMAIL = 'sathyarampontillo@gmail.com';

async function launch(userData, extraEnv) {
  const env = { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test', FILO_HIDE_WINDOW: '1', ...extraEnv };
  delete env.FILO_DEFAULT_OPENROUTER_KEY;
  const app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env });
  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  const openTab = async (url) => {
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
  };
  return { app, shell, openTab };
}

// Patch di fetch nel processo main: rinnovo Google → server finto; OpenRouter → 402 a comando.
async function patchMain(app, base) {
  return app.evaluate(async ({ safeStorage, app: eapp }, { base }) => {
    const r = process.mainModule ? process.mainModule.require : require;
    if (globalThis.__fake) return 'già';
    const orig = globalThis.fetch;
    globalThis.__fake = { base, or402: false, orCalls: 0, orUrls: [] };
    globalThis.fetch = async (url, init) => {
      const u = String((url && url.url) || url);
      if (u.startsWith('https://securetoken.googleapis.com/v1/token')) return orig(u.replace('https://securetoken.googleapis.com/v1/token', globalThis.__fake.base + '/token'), init);
      if (u.startsWith('https://openrouter.ai/api/v1/chat/completions')) {
        globalThis.__fake.orCalls++;
        globalThis.__fake.orUrls.push(u);
        if (globalThis.__fake.or402) return new Response(JSON.stringify({ error: { message: 'Insufficient credits', code: 402 } }), { status: 402, headers: { 'content-type': 'application/json' } });
      }
      return orig(url, init);
    };
    return typeof r;
  }, { base });
}

async function loginAsOwner(app) {
  return app.evaluate(async ({ safeStorage, app: eapp }, { email, appRoot }) => {
    const r = process.mainModule ? process.mainModule.require : require;
    const fs = r('fs'); const path = r('path');
    fs.writeFileSync(path.join(eapp.getPath('userData'), 'auth.bin'), safeStorage.encryptString(JSON.stringify({ refreshToken: 'owner-rt', email, name: 'Owner', picture: '' })));
    const ga = r(path.join(appRoot, 'src', 'main', 'auth', 'google-auth.js'));
    ga.restore();
    return { signed: ga.isSignedIn(), admin: ga.isAdmin() };
  }, { email: OWNER_EMAIL, appRoot: APP_ROOT });
}

const walletState = (page) => page.evaluate(() => chrome.runtime.sendMessage({ type: 'wallet_state' }));

async function redeem(page, code) {
  await page.fill('#inviteCode', code);
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).not.toHaveText(/Un attimo/, { timeout: 15_000 });
  return page.locator('#redeemMsg').textContent();
}

test.setTimeout(240_000);

test('A. installazione nuova: niente chiave, home e chat chiedono l\'invito, riscatto e stress', async () => {
  const fake = makeFake();
  const base = await fake.listen();
  const userData = cartellaTemporanea('filo-v598-');
  const { app, shell, openTab } = await launch(userData, fake.env(base));
  try {
    const kind = await patchMain(app, base);
    console.log('require nel main:', kind);
    // Home
    const home = await openTab('filo://newtab/');
    await expect(home.locator('#homeMessage')).toContainText(/codice d.invito/, { timeout: 20_000 });
    const sugg = home.locator('.dash-suggestion', { hasText: /Crediti/ });
    await expect(sugg.first()).toBeVisible();
    // Chat senza chiave
    await home.locator('#input').fill('ciao, che ore sono?');
    await home.evaluate(() => document.getElementById('inputForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })));
    await expect(home.locator('.dash-bubble').last()).toContainText(/codice d.invito/, { timeout: 20_000 });
    const apri = home.locator('button', { hasText: 'Apri Crediti' });
    await expect(apri).toBeVisible();
    await apri.click();
    const deadline = Date.now() + 10000; let credPage = null;
    while (Date.now() < deadline && !credPage) { credPage = app.windows().find((w) => /^filo:\/\/credits/.test(w.url())); if (!credPage) await new Promise((r) => setTimeout(r, 100)); }
    expect(credPage, 'Apri Crediti apre la pagina Crediti').toBeTruthy();
    const page = credPage;
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#hero')).toBeHidden();
    await expect(page.locator('#refillHint')).toBeHidden();
    await expect(page.locator('#offlineHint')).toBeHidden();
    await expect(page.locator('#ownerSection')).toBeHidden();
    const st0 = await walletState(page);
    console.log('stato iniziale', JSON.stringify(st0));
    expect(st0.keySource).toBe('none');
    // La pagina intera: cosa vede l'utente nuovo
    console.log('TESTO PAGINA NUOVA:\n' + (await page.locator('main').innerText()));
    await page.screenshot({ path: join(SHOTS, 'A-nuova.png'), fullPage: true });

    // Stress prima del riscatto
    const before = fake.requests.filter((r) => r.path === '/walletRedeem').length;
    await page.fill('#inviteCode', '   ');
    await page.click('#redeemBtn');
    await page.waitForTimeout(500);
    expect(fake.requests.filter((r) => r.path === '/walletRedeem').length).toBe(before);
    // 10.000 caratteri (maxlength 16 lo taglia: si prova via evaluate)
    await page.evaluate(() => { document.getElementById('inviteCode').value = 'A'.repeat(10000); });
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemMsg')).not.toHaveText(/Un attimo/, { timeout: 15_000 });
    console.log('10k:', await page.locator('#redeemMsg').textContent());
    await page.evaluate(() => { document.getElementById('inviteCode').value = '<script>alert(1)</script>🎁'; });
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemMsg')).not.toHaveText(/Un attimo/, { timeout: 15_000 });
    console.log('html/emoji:', await page.locator('#redeemMsg').textContent());
    expect(await page.locator('#redeemMsg').innerHTML()).not.toContain('<script');
    console.log('inesistente:', await redeem(page, 'ZZZZ-ZZZZ'));
    await expect(page.locator('#inviteCode')).toBeEnabled();

    // Server giù (connessione chiusa), 500, poi ok
    const [c1, c2, c3] = await fake.ownerInvites(3);
    fake.flags.serverDown = true;
    console.log('server giù:', await redeem(page, c1));
    fake.flags.serverDown = false;
    fake.flags.server500 = true;
    console.log('500:', await redeem(page, c1));
    fake.flags.server500 = false;
    // OpenRouter giù al riscatto: niente chiave creata
    fake.flags.openrouterDown = true;
    console.log('openrouter giù:', await redeem(page, c1));
    expect(fake.orKeys.size).toBe(0);
    fake.flags.openrouterDown = false;
    // Posti finiti
    fake.docs.config.invitesRemaining = 0;
    await page.reload(); await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#walletNote')).toContainText(/posti sono finiti/, { timeout: 15_000 });
    console.log('posti finiti:', await redeem(page, c1));
    fake.docs.config.invitesRemaining = 10;

    // Doppio clic: una sola richiesta
    const n0 = fake.requests.filter((r) => r.path === '/walletRedeem').length;
    await page.fill('#inviteCode', c1.toLowerCase().slice(0, 4) + ' - ' + c1.toLowerCase().slice(4));
    await page.locator('#redeemBtn').dblclick();
    await page.keyboard.press('Enter');
    await expect(page.locator('#redeemMsg')).toContainText(/riscattato/i, { timeout: 15_000 });
    await page.waitForTimeout(800);
    expect(fake.requests.filter((r) => r.path === '/walletRedeem').length - n0).toBe(1);

    // Dopo il riscatto
    await expect(page.locator('#redeemForm')).toBeHidden();
    await expect(page.locator('#hero')).toBeVisible();
    const bal = await page.locator('#balance').textContent();
    console.log('saldo:', bal, '| hint:', await page.locator('#refillHint').textContent());
    expect(bal.replace(/\D/g, '')).toBe('5000');
    const invites = page.locator('#invites .sn-wallet-invite');
    await expect(invites).toHaveCount(3);
    const uid = 'u1';
    console.log('TESTO PAGINA DOPO RISCATTO:\n' + (await page.locator('main').innerText()));
    await page.screenshot({ path: join(SHOTS, 'A-dopo.png'), fullPage: true });
    const st1 = await walletState(page);
    expect(st1.keySource).toBe('personal');
    expect(st1.hasPersonalKey).toBe(true);
    // Il codice si copia al clic
    await invites.first().locator('button').click();
    await expect(invites.first().locator('button')).toHaveText('Copiato');
    // Chiave cifrata su disco, non in chiaro; non nelle opzioni
    const bin = readFileSync(join(userData, 'wallet.bin'));
    expect(bin.toString('latin1')).not.toContain('sk-or-v1-fake');
    const storage = existsSync(join(userData, 'storage.json')) ? readFileSync(join(userData, 'storage.json'), 'utf8') : '';
    expect(storage).not.toContain('sk-or-v1-fake');
    const opt = await openTab('filo://options/options.html');
    await expect(opt.locator('#apiKey')).toHaveValue('', { timeout: 10_000 });
    // Un secondo riscatto (altro codice) da chi ha già il portafoglio
    const rr = await page.evaluate((c) => chrome.runtime.sendMessage({ type: 'wallet_redeem', code: c }), c2);
    console.log('secondo riscatto:', JSON.stringify(rr));
    expect(rr.status).toBe('already_in');
    // Codice proprio
    const own = st1.server.invites[0].code;
    const ro = await page.evaluate((c) => chrome.runtime.sendMessage({ type: 'wallet_redeem', code: c }), own);
    console.log('codice proprio:', JSON.stringify(ro));
    // Home ora non chiede più l'invito
    await home.reload(); await home.waitForLoadState('domcontentloaded');
    await home.waitForTimeout(3000);
    const homeTxt = await home.locator('#homeMessage').textContent();
    console.log('home dopo:', homeTxt);
    expect(homeTxt).not.toMatch(/codice d.invito/);

    // Crediti finiti: 402 → una chiamata sola, avviso
    await app.evaluate(() => { globalThis.__fake.or402 = true; globalThis.__fake.orCalls = 0; });
    await home.locator('#input').fill('dimmi una cosa');
    await home.evaluate(() => document.getElementById('inputForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })));
    await expect(home.locator('.dash-bubble').last()).toContainText(/crediti/i, { timeout: 30_000 });
    await home.waitForTimeout(2500);
    const calls = await app.evaluate(() => globalThis.__fake.orCalls);
    console.log('chiamate OpenRouter con 402:', calls, '| bolla:', await home.locator('.dash-bubble').last().textContent());
    expect(calls).toBe(1);
    await app.evaluate(() => { globalThis.__fake.or402 = false; });

    // Chiave propria: precedenza e nota
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'wallet_state' }));
    await opt.fill('#apiKey', 'sk-or-v1-mia-chiave');
    await opt.waitForTimeout(2500);
    const stOwn = await walletState(page);
    console.log('con chiave propria keySource:', stOwn.keySource, stOwn.usingOwnKey);
    await page.reload(); await page.waitForLoadState('domcontentloaded');
    if (stOwn.keySource === 'own') await expect(page.locator('#walletNote')).toContainText(/tua chiave/, { timeout: 15_000 });

    // Il riavvio: stessa identità (nessun nuovo signUp)
    fake.docs.usage.push({ pseudonym: fake.walletOf(uid).pseudonym, at: new Date().toISOString(), action: 'chat', costUsd: 0.01, credits: 13 });
    await app.close();
    const signups = fake.requests.filter((r) => r.path === '/identity').length;
    const again = await launch(userData, fake.env(base));
    const p2 = await again.openTab('filo://credits/credits.html');
    await expect(p2.locator('#hero')).toBeVisible({ timeout: 15_000 });
    await expect(p2.locator('#redeemForm')).toBeHidden();
    expect(fake.requests.filter((r) => r.path === '/identity').length).toBe(signups);
    const st2 = await walletState(p2);
    console.log('dopo riavvio:', st2.keySource, st2.server && st2.server.balance && st2.server.balance.credits);
    await again.app.close();

    // Riavvio OFFLINE: identità e server irraggiungibili (porta chiusa)
    const off = await launch(userData, { FILO_FUNCTIONS_BASE: 'http://127.0.0.1:9', FILO_IDENTITY_ENDPOINT: 'http://127.0.0.1:9/identity', FILO_SECURE_TOKEN_ENDPOINT: 'http://127.0.0.1:9/token' });
    const p3 = await off.openTab('filo://credits/credits.html');
    await p3.waitForTimeout(3000);
    console.log('TESTO PAGINA OFFLINE:\n' + (await p3.locator('main').innerText()));
    await p3.screenshot({ path: join(SHOTS, 'A-offline.png'), fullPage: true });
    const st3 = await walletState(p3);
    console.log('stato offline:', JSON.stringify(st3).slice(0, 600));
    await expect(p3.locator('#redeemForm')).toBeHidden();
    await expect(p3.locator('#hero')).toBeVisible();
    await expect(p3.locator('#offlineHint')).toBeHidden();
    const h3 = await off.openTab('filo://newtab/');
    await h3.waitForTimeout(3000);
    console.log('home offline:', await h3.locator('#homeMessage').textContent());
    await off.app.close();

    // Server dei crediti giù ma identità ok
    fake.flags.serverDown = true;
    const sd = await launch(userData, fake.env(base));
    const p4 = await sd.openTab('filo://credits/credits.html');
    await p4.waitForTimeout(3000);
    console.log('TESTO server giù:\n' + (await p4.locator('main').innerText()));
    await expect(p4.locator('#redeemForm')).toBeHidden();
    fake.flags.serverDown = false;
    await sd.app.close();

    // Identità annullata sul server
    fake.revoked.add(uid);
    const lost = await launch(userData, fake.env(base));
    const p5 = await lost.openTab('filo://credits/credits.html');
    await expect(p5.locator('#resetIdentityBtn')).toBeVisible({ timeout: 15_000 });
    console.log('TESTO identità persa:\n' + (await p5.locator('main').innerText()));
    await p5.click('#resetIdentityBtn');
    await expect(p5.locator('#redeemForm')).toBeVisible({ timeout: 15_000 });
    console.log('dopo reset:', await redeem(p5, c3));
    await expect(p5.locator('#hero')).toBeVisible();
    await lost.app.close();

    // Chiave assente su questo computer (portafoglio sul server)
    rmSync(join(userData, 'wallet.bin'), { force: true });
    const nk = await launch(userData, fake.env(base));
    const p6 = await nk.openTab('filo://credits/credits.html');
    await expect(p6.locator('#reissueBtn')).toBeVisible({ timeout: 15_000 });
    console.log('TESTO chiave assente:\n' + (await p6.locator('main').innerText()));
    const oldHash = fake.walletOf('u2').keyHash;
    await p6.click('#reissueBtn');
    await expect(p6.locator('#reissueBtn')).toBeHidden({ timeout: 15_000 });
    console.log('dopo nuova chiave:', await p6.locator('#walletNote').textContent(), '| vecchia spenta:', fake.orKeys.get(oldHash).disabled, '| saldo:', await p6.locator('#balance').textContent());
    expect(fake.orKeys.get(oldHash).disabled).toBe(true);
    const st6 = await walletState(p6);
    expect(st6.keySource).toBe('personal');
    await nk.app.close();
  } finally {
    try { await app.close(); } catch (_) {}
    fake.close();
    console.log('LOG server:', JSON.stringify(fake.logs.filter((l) => l[0] !== 'info')).slice(0, 2000));
  }
});

test('B. owner: sezione, codici che restano, regalo, dettaglio, niente uid', async () => {
  const fake = makeFake();
  const base = await fake.listen();
  const userData = cartellaTemporanea('filo-v598o-');
  const { app, openTab } = await launch(userData, fake.env(base));
  try {
    await patchMain(app, base);
    console.log('login owner:', JSON.stringify(await loginAsOwner(app)));
    const page = await openTab('filo://credits/credits.html');
    await expect(page.locator('#ownerSection')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#ownerTotals')).toContainText(/utenti/, { timeout: 15_000 });
    console.log('totali:', await page.locator('#ownerTotals').textContent());
    // Genera 3 codici
    await page.fill('#ownerInviteCount', '3');
    await page.click('#ownerInvitesBtn');
    await expect(page.locator('#ownerMsg')).toContainText(/3 codici/, { timeout: 15_000 });
    await expect(page.locator('#ownerCodes .sn-wallet-invite')).toHaveCount(3);
    // Ricarica: i codici restano
    await page.reload(); await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#ownerCodes .sn-wallet-invite')).toHaveCount(3, { timeout: 15_000 });
    const codes = await page.locator('#ownerCodes .sn-wallet-code').allTextContents();
    console.log('codici owner:', codes);
    // Un utente (l'identità anonima di questa installazione) riscatta il primo
    await expect(page.locator('#redeemForm')).toBeVisible();
    console.log('riscatto owner-installazione:', await redeem(page, codes[0]));
    await page.reload(); await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#ownerUsers')).toBeVisible({ timeout: 15_000 });
    const used = page.locator('#ownerCodes .sn-wallet-invite.is-used');
    await expect(used).toHaveCount(1);
    console.log('codice usato:', await used.innerText());
    const uid = [...fake.docs.wallets.keys()][0];
    const pseud = fake.walletOf(uid).pseudonym;
    // Righe del registro per il dettaglio
    fake.docs.usage.push({ pseudonym: pseud, at: '2026-09-08T10:00:00.000Z', action: 'chat', costUsd: 0.02 }, { pseudonym: pseud, at: '2026-09-09T10:00:00.000Z', action: 'traduci', costUsd: 0.05 });
    fake.keyOfUid(uid).usageUsd = 0.07;
    await page.reload(); await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#ownerUsers tbody tr.sn-wallet-user')).toHaveCount(1, { timeout: 15_000 });
    const row = page.locator('#ownerUsers tbody tr.sn-wallet-user').first();
    console.log('riga utente:', await row.innerText());
    await row.click();
    await expect(page.locator('.sn-wallet-user-detail').first()).toBeVisible();
    console.log('dettaglio:', await page.locator('.sn-wallet-user-detail').first().innerText());
    // Regalo: clic sullo pseudonimo riempie il campo
    await row.locator('td').first().click();
    await expect(page.locator('#ownerGrantPseudonym')).toHaveValue(pseud);
    await page.fill('#ownerGrantCredits', '1000');
    await page.click('#ownerGrantBtn');
    await expect(page.locator('#ownerMsg')).toContainText(/\+1\.000 crediti/, { timeout: 15_000 });
    await page.waitForTimeout(1500);
    console.log('saldo dopo regalo:', await page.locator('#balance').textContent(), '| riga:', await page.locator('#ownerUsers tbody tr.sn-wallet-user').first().innerText());
    // Regalo a pseudonimo inesistente e oltre il tetto
    await page.fill('#ownerGrantPseudonym', 'nessuno');
    await page.fill('#ownerGrantCredits', '10');
    await page.click('#ownerGrantBtn');
    await expect(page.locator('#ownerMsg')).toContainText(/nessun utente/, { timeout: 15_000 });
    await page.fill('#ownerGrantPseudonym', pseud);
    await page.fill('#ownerGrantCredits', '99999999');
    await page.click('#ownerGrantBtn');
    await expect(page.locator('#ownerMsg')).toContainText(/tetto globale/, { timeout: 15_000 });
    console.log('tetto:', await page.locator('#ownerMsg').textContent());
    // Giornaliera e riconciliazione: esiti
    fake.setNow(Date.now() + 86_400_000);
    console.log('daily:', JSON.stringify(await fake.service.daily(Date.now() + 86_400_000, fake.deps)));
    console.log('reconcile:', JSON.stringify(await fake.service.reconcileAll(Date.now() + 86_400_000, fake.deps)));
    await page.reload(); await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#ownerRuns')).toContainText(/giornaliera/, { timeout: 15_000 });
    console.log('runs:', await page.locator('#ownerRuns').textContent());
    const txt = await page.locator('main').innerText();
    console.log('TESTO OWNER:\n' + txt);
    expect(txt).not.toContain(uid);
    expect(txt).not.toContain('owner-uid');
    await page.screenshot({ path: join(SHOTS, 'B-owner.png'), fullPage: true });
    // Tema scuro
    await page.evaluate(async () => { const s = await chrome.storage.local.get('settings'); const st = s.settings || {}; st.theme = 'dark'; await chrome.storage.local.set({ settings: st }); });
    await page.reload(); await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#ownerUsers')).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: join(SHOTS, 'B-owner-dark.png'), fullPage: true });
  } finally {
    try { await app.close(); } catch (_) {}
    fake.close();
    console.log('LOG server:', JSON.stringify(fake.logs.filter((l) => l[0] !== 'info')).slice(0, 2000));
  }
});
