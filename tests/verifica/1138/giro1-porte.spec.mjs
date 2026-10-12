// #1138, giro 1: le altre porte del riscatto (chat /invito, collegamento filo://invito) e chi ha
// già una chiave propria col conteggio locale a schermo: nessuna dichiara crediti locali, la frase
// dice i soli crediti d'ingresso, e dopo il riscatto la pagina Crediti non mostra più il vecchio numero.
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

let server;
const seen = { localCredits: [] };
let redeemed = false;

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
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'r', expiresIn: '3600', localId: 'anon-uid-1' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'r', expires_in: '3600', user_id: 'anon-uid-1' });
      if (url === '/walletPendingInvite') return json(res, 200, { result: { status: 'none' } });
      if (url === '/walletState') {
        if (!redeemed) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, { result: {
          hasWallet: true, pseudonym: 'abcdef0123456789', stale: false, dailyCredits: 100,
          balance: { credits: 5000, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 },
          grants: [{ at: '2026-10-12T10:00:00.000Z', credits: 5000, why: 'entry' }], invites: [],
        } });
      }
      if (url === '/walletRedeem') {
        const dichiarati = Math.max(0, Math.floor(Number(body.data && body.data.localCredits) || 0));
        seen.localCredits.push(Number(body.data && body.data.localCredits));
        redeemed = true;
        return json(res, 200, { result: {
          status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000,
          entryCredits: 5000, migrated: 0, localRequested: dichiarati, cutReason: dichiarati > 0 ? 'migrate_cap' : null, inviteCodes: [],
        } });
      }
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
});

test.beforeEach(() => { redeemed = false; seen.localCredits.length = 0; });

test.afterAll(async () => {
  delete process.env.FILO_FUNCTIONS_BASE;
  delete process.env.FILO_IDENTITY_ENDPOINT;
  delete process.env.FILO_SECURE_TOKEN_ENDPOINT;
  await new Promise((r) => server.close(r));
});

test('chiave propria e conteggio locale a schermo: /invito in chat non dichiara niente, e i Crediti mostrano solo l’ingresso', async ({ app, openTab }) => {
  test.setTimeout(120000);
  await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE(
    { type: 'update_settings', settings: { apiKeys: { openrouter: 'sk-or-v1-propria-dell-utente' } } },
    { tab: { id: 3, url: 'filo://options/options.html' }, url: 'filo://options/options.html' },
  ));
  const crediti = await openTab('filo://credits/credits.html');
  await expect(crediti.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  await expect(crediti.locator('#hero')).toBeVisible();
  await expect(crediti.locator('#balance')).toHaveText(/^1\.\d{3}$/);
  const locale = (await crediti.locator('#balance').innerText()).trim();

  const home = await openTab('filo://newtab/');
  await home.waitForSelector('#input');
  await home.fill('#input', '/invito ABCD-EFGH');
  await home.press('#input', 'Enter');
  await expect(home.locator('#bubbles .dash-bubble-filo').last()).toHaveText('Invito riscattato: hai 5.000 crediti d’ingresso.', { timeout: 15000 });
  expect(seen.localCredits).toEqual([0]);

  await crediti.reload();
  await expect(crediti.locator('#balance')).toHaveText('5.000', { timeout: 15000 });
  await expect(crediti.locator('#redeemForm')).toBeHidden();
  await expect(crediti.locator('body')).not.toContainText(locale, { useInnerText: true });
  await crediti.screenshot({ path: 'tests/.shots/1138-giro1-chiave-propria-dopo.png' });
});

test('il collegamento filo://invito non dichiara niente, e il benvenuto dice i crediti d’ingresso', async ({ app, openTab }) => {
  test.setTimeout(120000);
  await app.evaluate(({ app: a }) => { a.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD-EFGH'], process.cwd()); });
  await expect.poll(() => seen.localCredits.length, { timeout: 15000 }).toBe(1);
  expect(seen.localCredits).toEqual([0]);
  const avviso = await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE(
    { type: 'wallet_notice_pending', where: 'credits' },
    { tab: { id: 4, url: 'filo://credits/credits.html' }, url: 'filo://credits/credits.html' },
  ));
  expect(avviso.notice && avviso.notice.text).toBe('Sei entrato con un invito: hai 5.000 crediti.');
  const crediti = await openTab('filo://credits/credits.html');
  await expect(crediti.locator('#balance')).toHaveText('5.000', { timeout: 15000 });
  await expect(crediti.locator('body')).not.toContainText('1.000', { useInnerText: true });
});
