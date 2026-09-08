// Diagnostica giro 10 — che succede a un Esc premuto mentre è il SITO ad avere
// lo schermo pieno (il pulsante del lettore video) e sopra c'è un riquadro di
// Filo. Non asserisce: registra la traccia.

import { test, expect } from './fixtures/electron.mjs';

async function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { cf: !!t.contentFullscreen, pageFs: !!t.pageFullscreen };
  });
}

async function esc(app, attesa = 1200) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, attesa));
}

const LETTORE = `<!doctype html><html><body style="margin:0;height:1200px">
<h1 id="t">un sito con un video</h1>
<button id="fs" style="font-size:20px">schermo intero</button>
<script>
  window.__tasti = [];
  window.addEventListener('keydown', function (e) { window.__tasti.push(e.key); }, true);
  document.getElementById('fs').addEventListener('click', function () {
    try { document.documentElement.requestFullscreen(); } catch (_) {}
  });
</script>
</body></html>`;

const menuAperto = (page) => page.evaluate(() => !!document.querySelector('.sn-menu'));

test('diagnostica: schermo pieno del sito + menu di Filo + Esc', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, LETTORE);
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  await page.locator('#fs').click();
  await expect.poll(async () => (await stato(app)).cf, { timeout: 8000 }).toBe(true);
  const dopoFs = await stato(app);

  await page.locator('#t').click({ button: 'right' });
  await expect.poll(() => menuAperto(page), { timeout: 8000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => { window.__tasti = []; });

  const traccia = [];
  for (let i = 0; i < 3; i++) {
    await esc(app);
    traccia.push({
      esc: i + 1,
      menu: await menuAperto(page),
      ...(await stato(app)),
      fsElem: await page.evaluate(() => !!document.fullscreenElement),
      tasti: await page.evaluate(() => window.__tasti.slice()),
    });
  }
  console.log('DOPO-FS', JSON.stringify(dopoFs));
  console.log('TRACCIA', JSON.stringify(traccia, null, 1));
});
