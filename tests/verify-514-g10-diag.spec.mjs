import { test, expect } from './fixtures/electron.mjs';

async function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { cf: !!t.contentFullscreen, pageFs: !!t.pageFullscreen };
  });
}
async function esc(app, attesa = 1500) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, attesa));
}
const LETTORE = `<!doctype html><html><body style="margin:0;height:1200px">
<h1 id="t">un sito con un video</h1><button id="fs">schermo intero</button>
<script>
  window.__tasti = [];
  window.__lock = 'non provato';
  window.addEventListener('keydown', function (e) { window.__tasti.push(e.key + ':' + e.isTrusted); }, true);
  document.getElementById('fs').addEventListener('click', function () {
    try { document.documentElement.requestFullscreen(); } catch (_) {}
  });
</script></body></html>`;

test('keyboard lock', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, LETTORE);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  console.log('SECURE', await page.evaluate(() => ({
    secure: window.isSecureContext, api: !!(navigator.keyboard && navigator.keyboard.lock),
  })));

  await page.locator('#fs').click();
  await expect.poll(async () => (await stato(app)).cf, { timeout: 8000 }).toBe(true);

  const lock = await page.evaluate(async () => {
    try { await navigator.keyboard.lock(['Escape']); return 'ok'; } catch (e) { return 'errore: ' + e; }
  });
  console.log('LOCK', lock);
  await page.evaluate(() => { window.__tasti = []; });
  await esc(app);
  console.log('DOPO-ESC', JSON.stringify({
    ...(await stato(app)),
    tasti: await page.evaluate(() => window.__tasti.slice()),
  }));
});
