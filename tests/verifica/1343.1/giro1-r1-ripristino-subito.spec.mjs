// Verifica #1343.1 giro 1, rilievo 1: un colore scritto poco prima di «Ripristina tutto» non deve tornare dopo il ripristino.
import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';

const tokens = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).themeTokens || {});

test('r1 colore scritto e Ripristina tutto confermato subito: dopo il ripristino nessun colore resta', async ({ app, openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#tok-accent');
  await page.click('#tok-accent');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('#1a7d3a');
  await page.click('#resetAllSettings');
  await clickConfirm(page, 'ok');
  await expect.poll(() => tokens(app).then((t) => Object.keys(t).length), { timeout: 5000 }).toBe(0);
  await page.waitForTimeout(2000);
  expect(await tokens(app)).toEqual({});
});
