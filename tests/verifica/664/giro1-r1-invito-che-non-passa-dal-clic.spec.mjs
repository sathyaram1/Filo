// Verifica #664, giro 1, rilievo 1: un collegamento filo://invito che non arriva da un clic sinistro su un
// link (la voce «Apri in nuova tab» del tasto destro, un pulsante che naviga da script al clic vero,
// la barra degli indirizzi) deve avere una risposta: si riscatta e si apre la pagina Crediti.
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

let server;
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
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
});
test.afterAll(async () => {
  delete process.env.FILO_FUNCTIONS_BASE; delete process.env.FILO_IDENTITY_ENDPOINT; delete process.env.FILO_SECURE_TOKEN_ENDPOINT;
  await new Promise((r) => server.close(r));
});
test.beforeEach(() => { seen.redeems.length = 0; redeemed = false; });

async function attendiPagina(app, host, tetto = 15000) {
  const scadenza = Date.now() + tetto;
  for (;;) {
    const p = app.windows().find((w) => { try { return new URL(w.url()).hostname === host; } catch (_) { return false; } });
    if (p) return p;
    if (Date.now() > scadenza) return null;
    await new Promise((r) => setTimeout(r, 200));
  }
}

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>Il tuo invito</title></head>
<body style="font-family:sans-serif;padding:40px"><h1>Hai un invito</h1><p>Codice: ABCD-EFGH</p>
<p><a id="apri" href="filo://invito/ABCD-EFGH">Apri in Filo</a></p>

<p><button id="js" onclick="location.href='filo://invito/ABCD-EFGH'">Apri in Filo (js)</button></p>
</body></html>`;


async function rispondeInvito(app) {
  await expect.poll(() => seen.redeems, { timeout: 15000, message: 'il codice arriva al server' }).toEqual(['ABCDEFGH']);
  expect(await attendiPagina(app, 'credits', 10000), 'si apre la pagina Crediti').toBeTruthy();
}

test('tasto destro sul pulsante dell’invito, «Apri in nuova tab»', async ({ app, openTab, testServer }) => {
  test.setTimeout(90000);
  const pagina = await testServer.openReady(openTab, PAGINA);
  await pagina.locator('#apri').click({ button: 'right' });
  const menu = pagina.locator('.sn-menu');
  await expect(menu).toBeVisible({ timeout: 20000 });
  await menu.locator('.sn-menu-item', { hasText: 'nuova tab' }).first().click({ noWaitAfter: true });
  await rispondeInvito(app);
});

test('pulsante che porta l’invito da script, premuto davvero', async ({ app, openTab, testServer }) => {
  test.setTimeout(90000);
  const pagina = await testServer.openReady(openTab, PAGINA);
  // Un clic vero passa dal renderer della scheda come quello di una persona: il main lo conta come gesto.
  const r = await pagina.evaluate(() => { const b = document.querySelector('#js').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; });
  await app.evaluate(({ BrowserWindow }, p) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
    wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  }, r);
  await new Promise((q) => setTimeout(q, 500));
  console.log('DBG', r, await app.evaluate(({ BrowserWindow }) => { const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs; const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents; return [wc._filoGestoAlle, Date.now(), wc.getURL()]; }));
  await rispondeInvito(app);
});

test('barra degli indirizzi: filo://invito scritto a mano', async ({ app, shell }) => {
  test.setTimeout(90000);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.open('filo://newtab/')).id);
  await new Promise((r) => setTimeout(r, 1000));
  await shell.evaluate(async ({ id }) => { await window.filoShell.tabs.navigate(id, 'filo://invito/ABCD-EFGH'); }, { id });
  await rispondeInvito(app);
});
