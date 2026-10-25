// Esplorazione del giro 4 (#1469): «Riprova» fermato (stop) e poi Indietro, o poi la pagina offline che riprova da sola.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const oggi = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = globalThis.SN_CONTATORI.giornoDi(Date.now());
  const out = {};
  for (const [k, ora] of Object.entries(s.ore || {})) {
    if (!k.startsWith(`${g}T`)) continue;
    for (const [chiave, conti] of Object.entries(ora.navRiprove || {})) {
      const a = (out[chiave] = out[chiave] || conti.map(() => 0));
      conti.forEach((n, i) => { a[i] += n; });
    }
  }
  return out;
});
const tm = (app, fn, arg) => app.evaluate(({ BrowserWindow }, [src, a]) => {
  const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
  // eslint-disable-next-line no-new-func
  return new Function('tm', 'a', src)(t, a);
}, [fn, arg]);

async function server(gestisci, porta = 0) {
  const s = createServer(gestisci);
  await new Promise((r, no) => { s.once('error', no); s.listen(porta, '127.0.0.1', r); });
  return { porta: s.address().port, async chiudi() { try { s.closeAllConnections?.(); } catch (_) {} await new Promise((r) => s.close(r)); } };
}

test('riprova fermato e poi Indietro non è riuscito', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await openTab(testServer.html('<!doctype html><title>partenza</title><p id="partenza">partenza</p>'));
  const id = await tm(app, 'return tm.activeId');
  const spento = await server(() => {});
  const porta = spento.porta;
  await spento.chiudi();
  await tm(app, 'tm.navigate(a[0], a[1])', [id, `http://127.0.0.1:${porta}/p`]);
  await expect(page.locator('#err-retry')).toBeVisible({ timeout: 15_000 });
  const s = await server(() => {}, porta);
  try {
    await page.locator('#err-retry').click({ noWaitAfter: true });
    await page.waitForTimeout(1500);
    await tm(app, 'tm.tabs.find((t) => t.id === a).view.webContents.stop()', id);
    await page.waitForTimeout(800);
    await tm(app, 'tm.goBack(a)', id);
    await expect(page.locator('#partenza')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    expect(((await oggi(app))['-102'] || [0, 0])[0]).toBe(0);
  } finally { await s.chiudi(); }
});

test('riprova fermato su «Sei offline», poi la rete torna e la pagina riprova da sola: non è un riprova riuscito', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await openTab(testServer.html('<!doctype html><title>partenza</title><p>partenza</p>'));
  const id = await tm(app, 'return tm.activeId');
  let appeso = true;
  const s = await server((req, res) => {
    if (appeso) return;
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<p id="ok">tornato</p>');
  });
  const bersaglio = `http://127.0.0.1:${s.porta}/q`;
  try {
    await tm(app, 'tm.tabs.find((t) => t.id === a[0]).view.webContents.loadURL(globalThis.SN_NET_ERROR.buildUrl(a[1], -106, "ERR_INTERNET_DISCONNECTED"))', [id, bersaglio]);
    await expect(page.locator('#err-retry')).toBeVisible({ timeout: 15_000 });
    await page.locator('#err-retry').click({ noWaitAfter: true });
    await page.waitForTimeout(1500);
    await tm(app, 'tm.tabs.find((t) => t.id === a).view.webContents.stop()', id);
    await page.waitForTimeout(6000);
    appeso = false;
    await expect(page.locator('#err-retry')).toBeVisible({ timeout: 5_000 });
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.locator('#ok')).toHaveText('tornato', { timeout: 15_000 });
    await page.waitForTimeout(1000);
    expect(((await oggi(app))['-106'] || [0, 0])[0]).toBe(0);
  } finally { await s.chiudi(); }
});
