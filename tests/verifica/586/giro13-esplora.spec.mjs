// Verifica #586 giro 13: esplorazione (incognito con scheda da un altro paese, Bluetooth). Da cancellare.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><head><title>Notifiche</title></head><body>
<script>window.chiedi = () => Notification.requestPermission();</script></body></html>`;

test('incognito, scheda da un altro paese: la scelta resta nella finestra', async ({ app, shell, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: 'socks5://127.0.0.1:9' } });
  });
  const url = testServer.html(PAGINA.replace('<body>', '<body>'));
  const host = new URL(url).host;
  await shell.evaluate(() => window.filoShell.openIncognito());
  let inc = null;
  await expect.poll(() => { inc = app.windows().find((w) => w.url().includes('incognito=1')); return !!inc; }).toBe(true);
  await inc.waitForLoadState('domcontentloaded');
  await inc.evaluate((u) => window.filoShell.tabs.open(u), url);
  await expect.poll(() => app.windows().some((w) => w.url() === url), { timeout: 10_000 }).toBe(true);
  const info = await app.evaluate(async ({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito && x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.url === u);
    const r = await w._filoTabs.setTabProxy(t.id, 'US');
    return { r, id: t.id };
  }, url);
  console.log('proxy', JSON.stringify(info));
  await new Promise((r) => setTimeout(r, 2500));
  const pages = app.windows().filter((w) => w.url() === url);
  const page = pages[pages.length - 1];
  await page.waitForLoadState('domcontentloaded');
  const part = await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito && x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.url === u);
    return t && t.partition;
  }, url);
  console.log('partition', part);
  await page.evaluate(() => { window.__e = null; window.chiedi().then((r) => { window.__e = r; }); });
  const riga = inc.locator('#perm-bar .perm-row');
  await expect(riga).toHaveCount(1, { timeout: 10_000 });
  await expect(inc.locator('#perm-bar .perm-si')).toBeEnabled();
  await inc.locator('#perm-bar .perm-si').click();
  await expect.poll(() => page.evaluate(() => window.__e)).toBe('granted');
  await new Promise((r) => setTimeout(r, 800));
  const esito = await app.evaluate(async ({ session }) => {
    const P = globalThis.__filoPermessi;
    const disco = await globalThis.SN_STORAGE.get ? null : null;
    return { normale: P.elenco(session.defaultSession).map((s) => s.host + ':' + JSON.stringify(s.scelte)) };
  });
  console.log('elenco normale', JSON.stringify(esito));
  // Chiudo la finestra incognito e riapro una normale sullo stesso sito: il sito sa già «granted»?
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((x) => x._filoIncognito).close(); });
  await new Promise((r) => setTimeout(r, 800));
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await expect.poll(() => app.windows().some((w) => !w.isClosed() && w.url() === url), { timeout: 10_000 }).toBe(true);
  const p2 = app.windows().filter((w) => !w.isClosed() && w.url() === url).pop();
  await p2.waitForLoadState('domcontentloaded');
  const dopo = await p2.evaluate(() => Notification.permission);
  console.log('finestra normale dopo incognito:', dopo, host);
  expect(esito.normale.join(' '), 'la scelta data in incognito è finita fra quelle di sempre').not.toContain(host);
  expect(dopo).not.toBe('granted');
});

test('Bluetooth: cosa vede un sito', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><title>BT</title><button id="b">x</button>');
  const r = await page.evaluate(async () => {
    const out = { ha: !!navigator.bluetooth, hid: !!navigator.hid, serial: !!navigator.serial, usb: !!navigator.usb };
    try { out.disp = navigator.bluetooth ? await navigator.bluetooth.getAvailability() : null; } catch (e) { out.disp = 'err:' + e.name; }
    return out;
  });
  console.log('bt', JSON.stringify(r));
  await page.click('#b');
  const q = await page.evaluate(async () => {
    try { const d = await navigator.bluetooth.requestDevice({ acceptAllDevices: true }); return 'ok:' + d.name; } catch (e) { return 'err:' + e.name + ':' + e.message; }
  }).catch((e) => 'eval:' + e.message);
  console.log('requestDevice', q);
});
