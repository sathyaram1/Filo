// Verifica #664, giro 2: esplorazione delle porte dell'invito dentro Filo e degli avvisi una volta sola.
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { confirmText } from '../../helpers/confirm.mjs';

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

function pagineSu(app, host) {
  return app.windows().filter((w) => { try { return new URL(w.url()).hostname === host; } catch (_) { return false; } });
}

test('collegamento che rimbalza sull’invito, cliccato davvero', async ({ app, openTab, testServer }) => {
  test.setTimeout(90000);
  const pagina = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="padding:40px">
    <a id="r" href="${base}/redir" style="display:inline-block;padding:20px;background:#c66">Apri in Filo</a></body>`);
  await pagina.locator('#r').click();
  await expect.poll(() => seen.redeems, { timeout: 15000, message: 'il codice arriva al server' }).toEqual(['ABCDEFGH']);
});

test('collegamento d’invito dentro un riquadro, cliccato davvero', async ({ app, openTab, testServer }) => {
  test.setTimeout(90000);
  const dentro = testServer.html(`<!doctype html><meta charset="utf-8"><body><a id="i" href="filo://invito/ABCD-EFGH" style="display:inline-block;padding:20px;background:#c66">Apri in Filo</a></body>`, { pubblico: true });
  const pagina = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="padding:20px"><iframe id="f" src="${dentro}" style="width:400px;height:200px"></iframe></body>`);
  const f = pagina.frameLocator('#f');
  await expect(f.locator('#i')).toBeVisible({ timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1500));
  await f.locator('#i').click();
  await expect.poll(() => seen.redeems, { timeout: 15000, message: 'il codice arriva al server' }).toEqual(['ABCDEFGH']);
  expect(pagineSu(app, 'credits').length).toBe(1);
});

test('tre clic distanziati sul pulsante: una sola pagina Crediti', async ({ app, openTab, testServer }) => {
  test.setTimeout(90000);
  const pagina = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="padding:40px">
    <a id="apri" href="filo://invito/ABCD-EFGH" style="display:inline-block;padding:20px;background:#c66">Apri in Filo</a></body>`);
  for (let i = 0; i < 3; i++) {
    await pagina.bringToFront().catch(() => {});
    await pagina.locator('#apri').click({ button: 'middle' });
    await new Promise((r) => setTimeout(r, 2500));
  }
  await expect.poll(() => seen.redeems, { timeout: 15000 }).toEqual(['ABCDEFGH']);
  expect(pagineSu(app, 'credits').length, 'pagine Crediti aperte').toBe(1);
});

test('regalo dell’owner con tre schede nuove: un riquadro solo', async ({ app, shell }) => {
  test.setTimeout(120000);
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  await expect.poll(() => pagineSu(app, 'newtab').length, { timeout: 20000 }).toBe(3);
  for (const h of pagineSu(app, 'newtab')) await h.waitForFunction(() => !!window.SN_CONFIRM_UI, null, { timeout: 20000 });
  await app.evaluate(() => globalThis.SN_CREDITS_MAIN.annunciaRegalo(250));
  const ids = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs
    .filter((t) => String(t.url || '').startsWith('filo://newtab')).map((t) => t.id));
  const visti = [];
  for (const id of ids) {
    await shell.evaluate((x) => window.filoShell.tabs.activate(x), id);
    await new Promise((r) => setTimeout(r, 2500));
    const testi = await Promise.all(pagineSu(app, 'newtab').map((h) => confirmText(h).catch(() => '')));
    visti.push(testi.filter((t) => t.includes('regalati 250')).length);
  }
  expect(visti).toEqual([1, 1, 1]);
});

test('incollaggio enorme nel campo: le altre schede rispondono', async ({ app, openTab }) => {
  test.setTimeout(120000);
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  const testo = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(4000);
  await page.evaluate((t) => { document.getElementById('inviteCode').value = t; }, testo);
  const t0 = Date.now();
  await page.click('#redeemBtn');
  await expect(page.locator('#walletNote')).not.toHaveText('', { timeout: 30000 });
  const dt = Date.now() - t0;
  console.log('NOTE', dt, await page.locator('#walletNote').textContent());
  expect(dt).toBeLessThan(10000);
});
