import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

const PERSONAL_KEY = 'sk-or-v1-test-personal';
const CHIUSO = 'openai/gpt-5';
let server; let base = ''; let redeemed = false;
const seen = [];
const json = (res, s, b) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch (_) {}
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'a', refreshToken: 'r', expiresIn: '3600', localId: 'u1' });
      if (url === '/token') return json(res, 200, { id_token: 'a', refresh_token: 'r', expires_in: '3600', user_id: 'u1' });
      if (url === '/walletState') {
        if (!redeemed) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, { result: { hasWallet: true, pseudonym: 'abcdef0123456789', balance: { credits: 4990, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0.01, remainingUsd: 4.19, eurUsd: 1.2, eurPerCredit: 0.0007 }, stale: false, dailyCredits: 100, invites: [] } });
      }
      if (url === '/walletRedeem') { redeemed = true; return json(res, 200, { result: { status: 'ok', key: PERSONAL_KEY, pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0, inviteCodes: [] } }); }
      if (url === '/api/v1/chat/completions') {
        seen.push(body.model);
        return json(res, 200, { id: 'g', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } });
      }
      return json(res, 404, { error: { message: 'nf' } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
});
test.afterAll(async () => { await new Promise((r) => server.close(r)); });

test('chat della home, modello chiuso coi crediti: frase dei crediti, «Apri Crediti» in evidenza, router muto', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const cr = await openTab('filo://credits/credits.html');
  await expect(cr.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  await cr.fill('#inviteCode', 'abcd-efgh');
  await cr.click('#redeemBtn');
  await expect(cr.locator('#redeemMsg')).toContainText('riscattato', { timeout: 10000 });
  await app.evaluate(async (_, { b, chiuso }) => {
    const vero = globalThis.fetch;
    globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/openrouter\.ai/, b).replace(/^https:\/\/firestore\.googleapis\.com/, b), init);
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: '' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry, gpt: { provider: 'openrouter', model: chiuso } },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'gpt' },
    });
  }, { b: base, chiuso: CHIUSO });
  const page = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  await page.bringToFront();
  await page.locator('#input').fill('ciao, cosa sai fare?');
  await page.locator('#sendBtn').click();
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'coi crediti di Filo questo modello non si usa' });
  await expect(bolla).toBeVisible({ timeout: 20_000 });
  console.log('BOLLA:', await bolla.innerText());
  const principale = bolla.locator('.dash-bubble-actions .dash-action-btn-primary');
  await expect(principale).toHaveText('Apri Crediti');
  await expect(bolla.locator('.dash-bubble-actions .dash-action-btn', { hasText: 'Riprova' })).not.toHaveClass(/dash-action-btn-primary/);
  expect(seen.filter((m) => m === CHIUSO)).toEqual([]);
  await principale.click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .flatMap((w) => (w._filoTabs ? w._filoTabs.tabs : [])).some((t) => t.view.webContents.getURL().startsWith('filo://credits'))), { timeout: 15000 }).toBe(true);
});
