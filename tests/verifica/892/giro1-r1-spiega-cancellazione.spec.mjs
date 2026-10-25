// Verifica #892.1, giro 1, rilievo 1: la domanda per una cancellazione scritta a mano dice a parole che cancella.

import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState, clickConfirm } from '../../helpers/confirm.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

test('r1 la domanda prima di una cancellazione scritta a mano dice che cancella', async ({ app }) => {
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => w.url().startsWith('filo://newtab')) || null;
    return Boolean(page);
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect.poll(() => page.evaluate(() => window.SN_DASH_TERMINALE?.isEnabled?.() === true), { timeout: 8_000 }).toBe(true);

  const b = path.join(cartellaTemporanea('filo-v892-'), 'da-cancellare');
  mkdirSync(b);
  writeFileSync(path.join(b, 'dentro.txt'), 'x');
  const comando = process.platform === 'win32' ? `/Remove-Item -Recurse -Force "${b}"` : `/rm -rf "${b}"`;
  await page.locator('#input').fill(comando);
  await page.locator('#input').press('Enter');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  const st = await confirmState(page);
  await clickConfirm(page, 'cancel');
  expect(existsSync(b)).toBe(true);
  expect(st.fuori, 'fuori dal comando citato, la domanda dice a parole cosa rischia chi preme OK')
    .toMatch(/cancell|elimin/i);
});
