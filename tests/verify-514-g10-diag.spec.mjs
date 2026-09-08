import { test, expect } from './fixtures/electron.mjs';

async function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { cf: !!t.contentFullscreen, pageFs: !!t.pageFullscreen, timer: !!t._escUscitaTimer };
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
  window.addEventListener('keydown', function (e) { window.__tasti.push(e.key + ':' + e.isTrusted); }, true);
  document.getElementById('fs').addEventListener('click', function () {
    try { document.documentElement.requestFullscreen(); } catch (_) {}
  });
</script></body></html>`;

test('diag', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, LETTORE);
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  const spia = await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    globalThis.__spia = [];
    const orig = t._inoltraEscAllaPagina.bind(t);
    t._inoltraEscAllaPagina = (id) => { const r = orig(id); globalThis.__spia.push(['inoltra', id, r]); return r; };
    return typeof t._inoltraEscAllaPagina === 'function';
  });
  console.log('SPIA-INSTALLATA', spia);
  console.log('FOCUSEDFRAME', await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    try { return { ff: !!wc.focusedFrame, mf: !!wc.mainFrame }; } catch (e) { return { err: String(e) }; }
  }));

  await page.locator('#fs').click();
  await expect.poll(async () => (await stato(app)).cf, { timeout: 8000 }).toBe(true);
  await page.locator('#t').click({ button: 'right' });
  await expect.poll(() => page.evaluate(() => !!document.querySelector('.sn-menu')), { timeout: 8000 }).toBe(true);
  await page.evaluate(() => { window.__tasti = []; });

  await esc(app);
  console.log('SPIA', JSON.stringify(await app.evaluate(() => globalThis.__spia)));
  console.log('DOPO', JSON.stringify({
    menu: await page.evaluate(() => !!document.querySelector('.sn-menu')),
    ...(await stato(app)),
    tasti: await page.evaluate(() => window.__tasti.slice()),
  }));
});
