// Verifica #664, giro 2, rilievo 1: un collegamento cliccato davvero che rimbalza su filo://invito (un 302 del sito)
// deve portare l'invito dentro Filo: il gesto è dell'utente, la pagina non spinge niente da sola.
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

let server; let base;
const seen = { redeems: [] };
let redeemed = false;
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      if (url === '/redir') { res.writeHead(302, { Location: 'filo://invito/ABCD-EFGH' }); return res.end(); }
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
      if (url === '/walletState') {
        if (!redeemed) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, { result: { hasWallet: true, pseudonym: 'abcdef0123456789', balance: { credits: 4990, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0.0084, remainingUsd: 4.1916, eurUsd: 1.2, eurPerCredit: 0.0007 }, stale: false, dailyCredits: 100, invites: [] } });
      }
      if (url === '/walletPendingInvite') return json(res, 200, { result: { status: 'none' } });
      if (url === '/walletRedeem') {
        const code = String((body.data && body.data.code) || '');
        seen.redeems.push(code);
        if (code !== 'ABCDEFGH') return json(res, 200, { result: { status: 'invalid_code' } });
        redeemed = true;
        return json(res, 200, { result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0, cutReason: null } });
      }
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
});
test.afterAll(async () => {
  delete process.env.FILO_FUNCTIONS_BASE; delete process.env.FILO_IDENTITY_ENDPOINT; delete process.env.FILO_SECURE_TOKEN_ENDPOINT;
  await new Promise((r) => server.close(r));
});
test.beforeEach(() => { seen.redeems.length = 0; redeemed = false; });

test('collegamento che rimbalza sull’invito, cliccato davvero', async ({ app, openTab, testServer }) => {
  test.setTimeout(90000);
  const pagina = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="padding:40px">
    <a id="r" href="${base}/redir" style="display:inline-block;padding:20px;background:#c66">Apri in Filo</a></body>`);
  await pagina.locator('#r').click();
  await expect.poll(() => seen.redeems, { timeout: 15000, message: 'il codice arriva al server' }).toEqual(['ABCDEFGH']);
});
