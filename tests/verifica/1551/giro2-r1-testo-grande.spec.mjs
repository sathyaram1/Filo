// #1551 giro 2, rilievo 1: col testo grande delle Preferenze il campo della home non deve ridursi a una fessura.
import { test, expect } from '../../fixtures/electron.mjs';

async function homeConScala(app, scala) {
  const trova = async () => {
    let page = null;
    await expect.poll(() => {
      page = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
      return !!page;
    }, { timeout: 10_000 }).toBe(true);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 8_000 });
    return page;
  };
  let page = await trova();
  // Quello che salva la pagina Preferenze scegliendo «Molto grande» o «Enorme».
  await page.evaluate(async (s) => {
    const r = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...((r && r.settings) || {}), textScale: s } });
  }, scala);
  await page.reload();
  page = await trova();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.zoom)).toBe(String(scala));
  return page;
}

for (const scala of [1.25, 1.5]) {
  test(`r1 testo ${scala * 100}% e finestra larga 1000, nessun avviso: nel campo della home si scrive su una riga vera`, async ({ app }, info) => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setContentSize(1000, 760));
    const page = await homeConScala(app, scala);
    await page.waitForTimeout(400);
    await page.screenshot({ path: info.outputPath(`home-testo-${scala}.png`) });
    // Su main, alla stessa misura, la casella era larga circa 130 punti e il segnaposto si leggeva.
    expect(await page.locator('#input').evaluate((t) => t.clientWidth)).toBeGreaterThanOrEqual(120);
    await expect(page.locator('#sendBtn')).toHaveCSS('width', `36px`);
  });
}
