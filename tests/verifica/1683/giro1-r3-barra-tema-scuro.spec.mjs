// Verifica #1683 giro 1, rilievo 3: col tema scuro la barra davanti al comando si legge sul fondo chiaro della bolla.

import { test, expect } from '../../fixtures/electron.mjs';

test('r3 la barra del comando si legge col tema chiaro e con quello scuro', async ({ app }) => {
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => w.url().startsWith('filo://newtab')) || null;
    return Boolean(page);
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => page.evaluate(() => window.SN_DASH_TERMINALE?.isEnabled?.() === true), { timeout: 8_000 }).toBe(true);
  await page.locator('#input').fill('/echo barra-r3');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-term-out').last()).toContainText('barra-r3', { timeout: 12_000 });

  const contrasto = () => page.locator('.dash-term-cmd .dash-term-prompt').last().evaluate((el) => {
    const rgb = (s) => (String(s).match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => {
      const c = [r, g, b].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const [a, b] = [lum(rgb(getComputedStyle(el.parentElement).backgroundColor)), lum(rgb(getComputedStyle(el).color))].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });
  for (const t of ['light', 'dark']) {
    await app.evaluate(async (_e, v) => globalThis.__filoHandlers.handleMessage(
      { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: v } },
      { url: 'filo://preferences/preferences.html' },
    ), t);
    await expect(page.locator('html')).toHaveAttribute('data-sn-theme', t, { timeout: 5_000 });
    // Il cambio di tema ha una transizione: si misura a transizione finita.
    await expect.poll(() => page.locator('.dash-term-cmd').last().evaluate((el) => el.getAnimations({ subtree: true }).length),
      { timeout: 3_000 }).toBe(0);
    // Un segno solo, in grassetto: basta il minimo per i segni grafici, 3 a 1.
    expect(await contrasto(), `${t}: la barra si legge sul fondo della bolla`).toBeGreaterThan(3);
    await page.screenshot({ path: `tests/.shots/1683-r3-${t}.png` }).catch(() => {});
  }
});
