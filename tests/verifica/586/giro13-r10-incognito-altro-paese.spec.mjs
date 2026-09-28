// Verifica #586 giro 13, rilievo 10: in incognito una scheda aperta da un altro paese ricorda le risposte per sempre.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><head><title>Notifiche</title></head><body>
<script>window.chiedi = () => Notification.requestPermission();</script></body></html>`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('in incognito, un sì dato in una scheda da un altro paese non esce dalla finestra', async ({ app, shell, testServer }) => {
  test.setTimeout(90_000);
  // Un indirizzo spento basta: il proxy lascia passare da sé gli indirizzi locali, la pagina si carica lo stesso.
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: 'socks5://127.0.0.1:9' } });
  });
  const url = testServer.html(PAGINA);
  const host = new URL(url).host;
  await shell.evaluate(() => window.filoShell.openIncognito());
  let inc = null;
  await expect.poll(() => { inc = app.windows().find((w) => w.url().includes('incognito=1')); return !!inc; }).toBe(true);
  await inc.waitForLoadState('domcontentloaded');
  await inc.evaluate((u) => window.filoShell.tabs.open(u), url);
  await expect.poll(() => app.windows().some((w) => w.url() === url), { timeout: 10_000 }).toBe(true);
  const r = await app.evaluate(async ({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito && x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.url === u);
    return w._filoTabs.setTabProxy(t.id, 'US');
  }, url);
  expect(r && r.ok).toBe(true);
  await sleep(2500);
  const page = app.windows().filter((w) => !w.isClosed() && w.url() === url).pop();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => { window.__e = null; window.chiedi().then((x) => { window.__e = x; }); });
  await expect(inc.locator('#perm-bar .perm-row')).toHaveCount(1, { timeout: 10_000 });
  await expect(inc.locator('#perm-bar .perm-si')).toBeEnabled();
  await inc.locator('#perm-bar .perm-si').click();
  await expect.poll(() => page.evaluate(() => window.__e)).toBe('granted');

  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((x) => x._filoIncognito).close(); });
  await sleep(800);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await expect.poll(() => app.windows().some((w) => !w.isClosed() && w.url() === url), { timeout: 10_000 }).toBe(true);
  const normale = app.windows().filter((w) => !w.isClosed() && w.url() === url).pop();
  await normale.waitForLoadState('domcontentloaded');
  expect(await normale.evaluate(() => Notification.permission),
    `chiusa la finestra incognito, ${host} ha ancora le notifiche nella finestra normale`).not.toBe('granted');
});
