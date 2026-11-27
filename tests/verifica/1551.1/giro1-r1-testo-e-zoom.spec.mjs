// Verifica #1551.1 giro 1, rilievo 1: testo «Enorme» più lo zoom della pagina nella finestra più stretta: il campo
// della home deve restare largo abbastanza da scriverci, come col solo testo grande.
import { test, expect } from '../../fixtures/electron.mjs';

async function home(app) {
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 8_000 });
  return page;
}

test('r1 testo 150% e zoom 150% in una finestra di 720: il campo della home resta largo', async ({ app }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setContentSize(720, 760));
  let page = await home(app);
  await page.evaluate(async () => {
    const r = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...((r && r.settings) || {}), textScale: 1.5 } });
  });
  await page.reload();
  page = await home(app);
  await expect.poll(() => page.evaluate(() => document.documentElement.style.zoom)).toBe('1.5');
  await app.evaluate(({ webContents }) => {
    webContents.getAllWebContents().find((w) => { try { return w.getURL().startsWith('filo://newtab'); } catch (_) { return false; } }).setZoomFactor(1.5);
  });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(500);
  await page.locator('#input').fill('ciao Filo, che tempo fa domani?');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/v1551-r1-testo-e-zoom.png' });
  // Su questo ramo la casella è larga 36 punti e la frase va a capo a ogni parola.
  expect(await page.locator('#input').evaluate((t) => t.clientWidth)).toBeGreaterThanOrEqual(110);
  expect(await page.locator('#input').evaluate((t) => {
    const s = getComputedStyle(t);
    return Math.round((t.scrollHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom)) / parseFloat(s.lineHeight));
  })).toBeLessThanOrEqual(3);
});
