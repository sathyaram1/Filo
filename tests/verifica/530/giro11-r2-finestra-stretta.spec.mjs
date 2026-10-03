// Verifica #530 giro 11: con la finestra stretta (metà di uno schermo da portatile) il livello di autonomia
// nella casella della home si prende metà dello spazio per scrivere, e le parole vanno a capo a metà.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

test('finestra stretta: il livello nella home non toglie metà della casella dove si scrive', async ({ app }) => {
  const page = await home(app);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setMinimumSize(300, 300); w.setSize(700, 700); });
  await expect(page.locator('#dashAutonomia')).toBeVisible();
  await page.locator('#input').fill('una domanda lunga '.repeat(6));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(720);
  const m = await page.evaluate(() => ({
    form: document.querySelector('#inputForm').getBoundingClientRect().width,
    testo: document.querySelector('#input').getBoundingClientRect().width,
  }));
  expect(m.testo / m.form, `casella ${Math.round(m.form)} px, spazio per il testo ${Math.round(m.testo)} px`).toBeGreaterThan(0.5);
});
