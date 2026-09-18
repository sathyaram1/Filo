// TEMPORANEO — diagnostica, si cancella prima della critica.
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

let server;
const visto = { pending: 0, redeems: [] };
let riscattato = false;

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
      const auth = req.headers.authorization || '';
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
      if (auth !== 'Bearer anon-id-token') return json(res, 401, { error: { message: 'no auth' } });
      if (url === '/walletState') {
        if (!riscattato) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, { result: { hasWallet: true, pseudonym: 'abcdef0123456789', balance: { credits: 5000, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 }, stale: false, dailyCredits: 100, invites: [{ code: 'AAAA2222', max: 3, used: 0, uses: [] }] } });
      }
      if (url === '/walletPendingInvite') { visto.pending += 1; return json(res, 200, { result: { status: 'ok', code: 'ABCDEFGH' } }); }
      if (url === '/walletRedeem') {
        visto.redeems.push(String((body.data && body.data.code) || ''));
        riscattato = true;
        return json(res, 200, { result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0 } });
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
  for (const k of ['FILO_FUNCTIONS_BASE', 'FILO_IDENTITY_ENDPOINT', 'FILO_SECURE_TOKEN_ENDPOINT']) delete process.env[k];
  await new Promise((r) => server.close(r));
});

test('diagnostica home', async ({ app }) => {
  let home = null;
  const scadenza = Date.now() + 25000;
  while (Date.now() < scadenza && !home) {
    home = app.windows().find((w) => { try { return new URL(w.url()).hostname === 'newtab'; } catch (_) { return false; } }) || null;
    if (!home) await new Promise((r) => setTimeout(r, 200));
  }
  console.log('HOME URL:', home && home.url());
  const log = [];
  home.on('console', (m) => log.push(`[${m.type()}] ${m.text()}`));
  await home.evaluate(() => {
    window.__msgs = [];
    chrome.runtime.onMessage.addListener((m) => { try { window.__msgs.push(JSON.stringify(m).slice(0, 200)); } catch (_) { window.__msgs.push('?'); } });
  });
  await expect.poll(() => visto.redeems.length, { timeout: 40000, intervals: [500] }).toBeGreaterThan(0);
  console.log('REDEEMS:', JSON.stringify(visto.redeems), 'PENDING:', visto.pending);
  await new Promise((r) => setTimeout(r, 8000));
  const dlg = await home.evaluate(() => (window.SN_CONFIRM_UI && window.SN_CONFIRM_UI._test.state()) || null);
  console.log('DIALOGO:', JSON.stringify(dlg));
  const hostVisibile = await home.locator('.sn-confirm-host').count();
  console.log('HOST:', hostVisibile);
  const info = await home.evaluate(() => ({
    overlays: document.querySelectorAll('.sn-confirm-overlay').length,
    titles: [...document.querySelectorAll('.sn-confirm-title')].map((e) => e.textContent),
    hasConfirmUi: !!window.SN_CONFIRM_UI,
    onb: !!document.querySelector('.dash-onb'),
    bodyStart: document.body.innerText.slice(0, 300),
    msgs: window.__msgs || [],
  }));
  console.log('INFO:', JSON.stringify(info, null, 2));
  console.log('CONSOLE:', log.slice(-40).join('\n'));
});
