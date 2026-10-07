// Riallineamento #737.1 su main (#664): la scheda nuova che l'utente apre porta il suo gesto ai rinvii della prima navigazione,
// verso l'invito o la posta, anche quando nasce dal menu di Filo.
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

let server;
const seen = { redeems: [] };

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
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
      if (url === '/posta') { res.writeHead(302, { Location: 'mailto:x@y.it' }); return res.end(); }
      if (url === '/redir') { res.writeHead(302, { Location: 'filo://invito/ABCD-EFGH' }); return res.end(); }
      if (url === '/walletState') return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
      if (url === '/walletPendingInvite') return json(res, 200, { result: { status: 'none' } });
      if (url === '/walletRedeem') {
        seen.redeems.push(String((body.data && body.data.code) || ''));
        return json(res, 200, { result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0, cutReason: null } });
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

test.afterAll(async () => {
  delete process.env.FILO_FUNCTIONS_BASE;
  delete process.env.FILO_IDENTITY_ENDPOINT;
  delete process.env.FILO_SECURE_TOKEN_ENDPOINT;
  await new Promise((r) => server.close(r));
});

test('r1 «Apri in nuova tab» del menu di Filo su un collegamento che rimbalza sull\'invito lo riscatta', async ({ openTab, testServer }) => {
  test.setTimeout(120000);
  const rimbalzo = `${process.env.FILO_FUNCTIONS_BASE}/redir`;
  const pagina = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="padding:40px">
    <p><a id="qui" href="${rimbalzo}">Apri in Filo</a></p></body>`);
  await new Promise((r) => setTimeout(r, 1500));
  await pagina.locator('#qui').click({ button: 'right' });
  const menu = pagina.locator('.sn-menu');
  await expect(menu).toBeVisible({ timeout: 20000 });
  await menu.locator('.sn-menu-item', { hasText: 'nuova tab' }).first().click({ noWaitAfter: true });
  await expect.poll(() => seen.redeems, { timeout: 15000, message: 'il codice arriva al server' }).toEqual(['ABCDEFGH']);
});

test('r1 un collegamento in scheda nuova che rimbalza sulla posta, cliccato, apre la posta', async ({ app, openTab, testServer }) => {
  test.setTimeout(90000);
  await app.evaluate(({ shell }) => { globalThis.__esterni = []; shell.openExternal = async (u) => { globalThis.__esterni.push(u); }; });
  const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="margin:0"><a id="m" href="${process.env.FILO_FUNCTIONS_BASE}/posta" target="_blank" style="position:fixed;left:0;top:0;width:200px;height:60px;display:block">scrivici</a></body>`);
  await page.waitForTimeout(1500);
  await page.mouse.click(50, 30);
  await expect.poll(() => app.evaluate(() => globalThis.__esterni), { timeout: 8000 }).toEqual(['mailto:x@y.it']);
});
