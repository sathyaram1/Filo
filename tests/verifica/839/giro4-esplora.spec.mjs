// esplorazione: il menu delle pagine di Filo offre «Salva per dopo»?
import { test, expect } from '../../fixtures/electron.mjs';

test('menu su filo://editor', async ({ app, openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  await page.mouse.click(600, 400, { button: 'right' });
  await page.waitForTimeout(800);
  const n = await page.locator('.sn-menu [data-sn-icon-id="saveForLater"]').count();
  const vis = n ? await page.locator('.sn-menu [data-sn-icon-id="saveForLater"]').first().isVisible() : false;
  console.log('SAVEFORLATER', n, vis);
  try { await page.screenshot({ path: 'tests/.shots/839-g4-editor-menu.png' }); } catch (_) {}
  if (vis) {
    await page.locator('.sn-menu [data-sn-icon-id="saveForLater"]').first().click();
    await page.waitForTimeout(5500);
    const salvate = await app.evaluate(async () => (await globalThis.SN_SAVED_PAGES.list()).map((p) => p.url));
    const aperte = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.map((t) => t.url));
    console.log('SALVATE', JSON.stringify(salvate), 'APERTE', JSON.stringify(aperte));
  }
});
