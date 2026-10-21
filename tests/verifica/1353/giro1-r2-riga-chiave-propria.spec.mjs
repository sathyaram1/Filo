// Verifica #1353, giro 1: con la chiave propria la riga sotto il conteggio non deve tornare quella di prima a ogni ridisegno.
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

let server;
let ritardoMs = 0;

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      const url = req.url.split('?')[0];
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'r', expiresIn: '3600', localId: 'anon-uid-r1' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'r', expires_in: '3600', user_id: 'anon-uid-r1' });
      if (url === '/walletState') {
        setTimeout(() => json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } }), ritardoMs);
        return;
      }
      if (url === '/api/v1/auth/key') return json(res, 200, { data: { label: 'la mia', limit: 10, usage: 1.5, limit_remaining: 8.5 } });
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
});

test.afterAll(async () => {
  delete process.env.FILO_FUNCTIONS_BASE;
  delete process.env.FILO_IDENTITY_ENDPOINT;
  delete process.env.FILO_SECURE_TOKEN_ENDPOINT;
  await new Promise((r) => server.close(r));
});

test('r2 chiave propria: una chiamata pagata con la chiave non fa sparire per un attimo la frase «le paga la tua chiave»', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'sk-or-v1-own-key-r1' } });
  });
  const page = await openTab('filo://credits/credits.html');
  const riga = page.locator('#refillHint');
  await expect(riga).toContainText('Le richieste le paga la tua chiave OpenRouter.', { timeout: 15_000 });
  await page.evaluate(() => {
    window.__righe = [];
    const el = document.getElementById('refillHint');
    new MutationObserver(() => window.__righe.push(el.hidden ? '(nascosta)' : el.textContent)).observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
  });
  // Il server dei crediti risponde in un secondo e mezzo; il main avvisa la pagina come dopo una chiamata con la chiave.
  ritardoMs = 1_500;
  await app.evaluate(() => globalThis.SN_BROADCAST_FILO({ type: globalThis.SN_MSG.MSG.CREDITS_CHANGED, ownKeyUsed: true }));
  await page.waitForTimeout(2_500);
  const righe = await page.evaluate(() => window.__righe);
  console.log('righe viste:', JSON.stringify(righe));
  expect(righe.length, 'la pagina si è ridisegnata').toBeGreaterThan(0);
  for (const t of righe) expect(t, 'la riga resta quella della chiave propria').toContain('le paga la tua chiave');
});
