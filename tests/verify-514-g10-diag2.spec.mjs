// Diagnostica giro 10 (seconda parte) — la voce rimasta col nome vecchio.

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
async function setFs(app, on) {
  await app.evaluate(({ BrowserWindow }, v) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(v);
  }, on);
  await new Promise((r) => setTimeout(r, 900));
}

const LETTORE = `<!doctype html><html><body style="margin:0;height:1200px">
<h1 id="t">un sito con un video</h1>
<button id="fs" style="font-size:20px">schermo intero</button>
<script>
  document.getElementById('fs').addEventListener('click', function () {
    try { document.documentElement.requestFullscreen(); } catch (_) {}
  });
</script>
</body></html>`;

const menuAperto = (page) => page.evaluate(() => !!document.querySelector('.sn-menu'));
async function apriMenuEVoce(page) {
  await page.locator('#t').click({ button: 'right' });
  await expect.poll(() => menuAperto(page), { timeout: 8000 }).toBe(true);
  const voce = page.locator('[data-sn-icon-id="fullscreen"]');
  if (await voce.count() === 0) await page.locator('.sn-menu-row-overflow').first().click();
  await expect(voce.first()).toBeVisible({ timeout: 8000 });
  return voce.first();
}

// A) schermo pieno del SITO, l'Esc lo spegne: la voce rimasta che nome porta,
//    e cliccarla cosa fa?
test('A: dopo l\'Esc che spegne lo schermo pieno del sito, la voce rimasta', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, LETTORE);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.locator('#fs').click();
  await expect.poll(async () => (await stato(app)).cf, { timeout: 8000 }).toBe(true);
  const voce = await apriMenuEVoce(page);
  await esc(app);
  console.log('A-DOPO-ESC', JSON.stringify({ menu: await menuAperto(page), ...(await stato(app)) }));
  console.log('A-ETICHETTA', await voce.getAttribute('aria-label'));
  await voce.click();
  await new Promise((r) => setTimeout(r, 1200));
  console.log('A-DOPO-CLIC', JSON.stringify(await stato(app)));
});

// B) schermo intero di FILO su un sito, spento da un'altra strada mentre il
//    menu è aperto: la voce si aggiorna?
test('B: schermo intero di Filo spento da un\'altra strada col menu aperto', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, LETTORE);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await setFs(app, true);
  const voce = await apriMenuEVoce(page);
  console.log('B-ETICHETTA-PRIMA', await voce.getAttribute('aria-label'));
  await setFs(app, false);
  console.log('B-DOPO', JSON.stringify({ menu: await menuAperto(page), ...(await stato(app)) }));
  console.log('B-ETICHETTA-DOPO', await voce.getAttribute('aria-label'));
});
