// Sonda: in che ordine arrivano enter-html-full-screen (webContents) e
// enter-full-screen (finestra) quando è la pagina a chiedere lo schermo pieno?
import { test } from './fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><body style="margin:0;height:1200px">
<p id="t">clic qui</p>
<script>
  document.addEventListener('click', function () {
    try { document.documentElement.requestFullscreen(); } catch (_) {}
  });
</script>
</body></html>`;

test('sonda ordine eventi schermo pieno', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const t = win._filoTabs;
    globalThis.__ordine = [];
    win.on('enter-full-screen', () => globalThis.__ordine.push('win:enter'));
    win.on('leave-full-screen', () => globalThis.__ordine.push('win:leave'));
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.on('enter-html-full-screen', () => globalThis.__ordine.push('wc:enter'));
    wc.on('leave-html-full-screen', () => globalThis.__ordine.push('wc:leave'));
  });
  await page.locator('#t').click();
  await new Promise((r) => setTimeout(r, 1500));
  console.log('ORDINE →', JSON.stringify(await app.evaluate(() => globalThis.__ordine)));
});
