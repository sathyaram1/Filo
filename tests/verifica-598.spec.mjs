// Verifica indipendente del #598 (spec temporaneo, si toglie prima della critica).
import { test, expect } from './fixtures/electron.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeServer } from './verifica-598-server.mjs';

let srv;
test.beforeAll(async () => {
  srv = await startFakeServer();
  Object.assign(process.env, srv.env);
  delete process.env.FILO_DEFAULT_OPENROUTER_KEY;
});
test.afterAll(async () => { await srv.close(); });
test.beforeEach(() => {
  srv.state.wallet = null; srv.state.redeemMode = 'ok'; srv.state.invitesOpen = true;
  srv.state.refreshFails = false; srv.state.walletStateHttp = null; srv.state.redeemDelayMs = 0;
  srv.log.length = 0;
});

const keySource = (app) => app.evaluate(() => globalThis.SN_WALLET_MAIN.keySource());
const userData = (app) => app.evaluate(({ app }) => app.getPath('userData'));

test('installazione nuova: nessuna chiave, campo invito visibile, saldo locale', async ({ app, openTab }) => {
  expect(await keySource(app)).toBe('none');
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible();
  await expect(page.locator('#invitesSection')).toBeHidden();
  const balance = await page.locator('#balance').textContent();
  const hint = await page.locator('#refillHint').textContent();
  const note = await page.locator('#walletNote').evaluate((e) => ({ hidden: e.hidden, text: e.textContent }));
  console.log('NUOVA INSTALLAZIONE → saldo:', balance, '| hint:', hint, '| nota:', JSON.stringify(note));
  await page.screenshot({ path: 'tests/.shots/verifica598-nuova-light.png' });
  // Il messaggio che il chat dà senza chiave (ciò che vede l'utente nuovo):
  const msg = await app.evaluate(() => globalThis.SN_I18N ? globalThis.SN_I18N.t('err_no_api_key') : null);
  console.log('MESSAGGIO SENZA CHIAVE:', msg);
});

test('riscatto: codice minuscolo con spazi, saldo e inviti dal server, chiave personale in uso', async ({ app, openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible();
  await page.fill('#inviteCode', '  abcd-efgh ');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toHaveClass(/is-ok/, { timeout: 10_000 });
  const redeems = srv.log.filter((l) => l.path === '/walletRedeem');
  expect(redeems.length).toBe(1);
  console.log('CODICE ARRIVATO AL SERVER:', JSON.stringify(redeems[0].code), 'auth:', redeems[0].auth.slice(0, 20));
  await expect(page.locator('#balance')).toHaveText(/5[.,]?000/);
  await expect(page.locator('#redeemForm')).toBeHidden();
  await expect(page.locator('#invitesSection')).toBeVisible();
  await expect(page.locator('#invites li')).toHaveCount(3);
  console.log('HINT DOPO:', await page.locator('#refillHint').textContent());
  console.log('INVITI:', await page.locator('#invites').innerText());
  expect(await keySource(app)).toBe('personal');
  expect(existsSync(join(await userData(app), 'wallet.bin'))).toBe(true);
  // copia del codice
  await page.locator('#invites li button').first().click();
  await expect(page.locator('#invites li button').first()).toHaveText('Copiato');
  await page.screenshot({ path: 'tests/.shots/verifica598-wallet-light.png' });
  // tema scuro
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#invitesSection')).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/verifica598-wallet-dark.png' });

  // chiave propria → precedenza
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'sk-or-v1-mia' } }));
  expect(await keySource(app)).toBe('own');
  await page.reload();
  await expect(page.locator('#walletNote')).toBeVisible();
  console.log('NOTA CON CHIAVE PROPRIA:', await page.locator('#walletNote').textContent());
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: '' } }));
  expect(await keySource(app)).toBe('personal');
});

test('riscatto: esiti di errore, doppio clic, input estremi', async ({ app, openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible();

  // vuoto / spazi
  await page.fill('#inviteCode', '   ');
  await page.click('#redeemBtn');
  await page.waitForTimeout(500);
  expect(srv.log.filter((l) => l.path === '/walletRedeem').length).toBe(0);

  // 10.000 caratteri + html + emoji: la pagina non si rompe, il server dice invalid
  const lungo = '<script>alert(1)</script>😀'.repeat(400);
  await page.fill('#inviteCode', lungo);
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toHaveClass(/is-error/, { timeout: 10_000 });
  console.log('MSG INPUT ESTREMO:', await page.locator('#redeemMsg').textContent(), '| lunghezza inviata:', srv.log.filter((l) => l.path === '/walletRedeem').at(-1).body.length);
  expect(await page.locator('#redeemMsg').textContent()).not.toContain('<script>');

  for (const st of ['code_used', 'own_code', 'invites_exhausted', 'global_cap', 'missing_exchange_rate', 'not_configured', 'provider_error', 'http500']) {
    srv.state.redeemMode = st;
    await page.fill('#inviteCode', 'ABCD-EFGH');
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemMsg')).toHaveClass(/is-error/, { timeout: 10_000 });
    console.log(`ESITO ${st}:`, await page.locator('#redeemMsg').textContent());
    await expect(page.locator('#inviteCode')).toBeEnabled();
  }
  expect(await keySource(app)).toBe('none');

  // doppio clic: una sola richiesta
  srv.state.redeemMode = 'ok';
  srv.state.redeemDelayMs = 800;
  srv.log.length = 0;
  await page.fill('#inviteCode', 'ABCD-EFGH');
  await page.click('#redeemBtn');
  await page.click('#redeemBtn', { force: true }).catch(() => {});
  await page.keyboard.press('Enter');
  await expect(page.locator('#redeemMsg')).toHaveClass(/is-ok/, { timeout: 10_000 });
  await page.waitForTimeout(1200);
  expect(srv.log.filter((l) => l.path === '/walletRedeem').length).toBe(1);
});

test('server irraggiungibile e portafoglio senza chiave locale', async ({ app, openTab }) => {
  srv.state.walletStateHttp = 503;
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible();
  await expect(page.locator('#walletNote')).toBeVisible();
  console.log('NOTA SERVER GIÙ:', await page.locator('#walletNote').textContent());

  // Il server conosce il portafoglio ma questa copia non ha la chiave (reinstallazione)
  srv.state.walletStateHttp = null;
  srv.state.wallet = {
    hasWallet: true, pseudonym: 'abcdef0123456789',
    balance: { credits: 4200, eurUsd: 1.17, eurPerCredit: 0.0007 }, stale: false, dailyCredits: 100,
    invites: [{ code: 'QQQQ-2222', used: true, usedAt: '2026-09-01T10:00:00.000Z' }, { code: 'RRRR-3333', used: false, usedAt: null }],
  };
  await page.reload();
  await expect(page.locator('#walletNote')).toBeVisible();
  console.log('NOTA CHIAVE ASSENTE:', await page.locator('#walletNote').textContent());
  console.log('INVITI (uno usato):', await page.locator('#invites').innerText());
  await expect(page.locator('#redeemForm')).toBeHidden();
  expect(await keySource(app)).toBe('none');

  // posti finiti
  srv.state.wallet = null; srv.state.invitesOpen = false;
  await page.reload();
  await expect(page.locator('#walletNote')).toBeVisible();
  console.log('NOTA POSTI FINITI:', await page.locator('#walletNote').textContent());
  await expect(page.locator('#redeemForm')).toBeVisible();
});

test('crediti finiti (402): una sola chiamata, nessun ripiego, avviso nella shell', async ({ app, shell, openTab }) => {
  // portafoglio attivo
  const page = await openTab('filo://credits/credits.html');
  await page.fill('#inviteCode', 'ABCD-EFGH');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toHaveClass(/is-ok/, { timeout: 10_000 });

  const r = await app.evaluate(async () => {
    const calls = [];
    const orig = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (String(url).includes('openrouter.ai')) {
        calls.push(String(url));
        return new Response(JSON.stringify({ error: { message: 'Insufficient credits', code: 402 } }), { status: 402, headers: { 'Content-Type': 'application/json' } });
      }
      return orig(url, opts);
    };
    const attempts = [
      { provider: 'openrouter', apiKey: 'sk-or-v1-verifica-personale', model: 'a/uno' },
      { provider: 'openrouter', apiKey: 'sk-or-v1-verifica-personale', model: 'b/due' },
    ];
    const t0 = Date.now();
    let err = null;
    try {
      await globalThis.SN_PROVIDERS.completeWithFallback({ attempts, messages: [{ role: 'user', content: 'ciao' }] });
    } catch (e) { err = { message: String(e.message), status: e.status }; }
    let errStream = null; let calls2 = 0;
    const before = calls.length;
    try {
      await globalThis.SN_PROVIDERS.streamCompleteWithFallback({ attempts, messages: [{ role: 'user', content: 'ciao' }], onDelta: () => {} });
    } catch (e) { errStream = { message: String(e.message), status: e.status }; }
    calls2 = calls.length - before;
    globalThis.fetch = orig;
    const CE = globalThis.SN_CHAT_ERRORS;
    const userText = CE && CE.messageFor ? CE.messageFor(Object.assign(new Error(err.message), { status: err.status })) : null;
    return { calls: calls.length - calls2, calls2, err, errStream, ms: Date.now() - t0, userText };
  });
  console.log('402 →', JSON.stringify(r));
  expect(r.calls).toBe(1);
  expect(r.calls2).toBe(1);
  expect(r.err).toBeTruthy();
  await expect(shell.locator('#shell-notifs')).toContainText(/crediti/i, { timeout: 5000 });
  console.log('TOAST:', await shell.locator('#shell-notifs').innerText());
  await page.screenshot({ path: 'tests/.shots/verifica598-402-credits.png' });
  await shell.screenshot({ path: 'tests/.shots/verifica598-402-shell.png' });
});

test('identità persa (rinnovo 400): si ricrea e il riscatto funziona', async ({ app, openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible();
  const signUps0 = srv.state.signUps;
  await app.evaluate(() => require(require('path').join(process.cwd(), 'src/main/auth/anon-auth.js'))._reset());
  await page.reload();
  await expect(page.locator('#redeemForm')).toBeVisible();
  console.log('SIGNUPS prima/dopo reset:', signUps0, srv.state.signUps, 'refreshes:', srv.state.refreshes);
});
