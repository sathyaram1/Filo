// Verifica #429, giro 3, rilievo 4: al buio la scheda Home in secondo piano è un rettangolo grigio chiaro
// in una finestra scura.

import { test, expect } from '../../fixtures/electron.mjs';

const lum = (rgb) => {
  const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map((n) => { const c = Number(n) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

test('r4 in tema scuro la Home in secondo piano resta una scheda scura', async ({ shell, openTab }) => {
  const g = await openTab('filo://manage/manage.html');
  await g.waitForLoadState('load');
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await shell.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => shell.evaluate(() => getComputedStyle(document.body).backgroundColor).then(lum), { timeout: 5_000 }).toBeLessThan(0.05);
  await shell.waitForTimeout(1000);
  const home = await shell.evaluate(() => getComputedStyle(document.querySelector('#tabs .tab:not(.active)')).backgroundColor);
  expect(lum(home), `Home in secondo piano: ${home}`).toBeLessThan(0.12);
});
