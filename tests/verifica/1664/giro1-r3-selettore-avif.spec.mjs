// Verifica #1664 giro 1, rilievo 3: un AVIF lasciato nel riquadro della segnalazione entra; «Allega» deve proporlo
// anche dal selettore dei file, che altrimenti lo nasconde.

import { test, expect } from '../../fixtures/electron.mjs';

test('r3 il selettore di «Allega» propone gli AVIF che il riquadro accetta', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  let win = null;
  await expect.poll(() => {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    return !!win;
  }, { timeout: 10_000 }).toBe(true);
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  await win.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(win.locator('.sn-fb-modal')).toBeVisible();
  await expect(win.locator('.sn-fb-file')).toHaveAttribute('accept', /\.avif|image\/avif/);
});
