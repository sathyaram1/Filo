// #892.1 giro 6 r2 — una riga incollata, cancellata e riportata con Annulla (Ctrl+Z) è sempre incollata: la sua
// cancellazione vuole la parola «conferma».

import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState, clickConfirm } from '../../helpers/confirm.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

async function newtabPage(app) {
  let win = null;
  await expect.poll(() => {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab')) || null;
    return Boolean(win);
  }, { timeout: 10_000 }).toBe(true);
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('#input')).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => win.evaluate(() => window.SN_DASH_TERMINALE?.isEnabled?.() === true), { timeout: 8_000 }).toBe(true);
  return win;
}

const rmDi = (c) => (process.platform === 'win32' ? `Remove-Item -Recurse -Force "${c}"` : `rm -rf "${c}"`);
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

test('r2 incollata, svuotata e riportata con Annulla: la cancellazione vuole «conferma»', async ({ app }) => {
  const b = path.join(cartellaTemporanea('filo-892-1-g6-'), 'da-cancellare');
  mkdirSync(b);
  writeFileSync(path.join(b, 'dentro.txt'), 'x');
  const page = await newtabPage(app);
  const input = page.locator('#input');
  const comando = `/${rmDi(b)}`;
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), comando);
  await input.focus();
  await page.keyboard.press(`${mod}+V`);
  await expect(input).toHaveValue(comando);
  await page.keyboard.press(`${mod}+A`);
  await page.keyboard.press('Delete');
  await expect(input).toHaveValue('');
  await page.keyboard.press(`${mod}+Z`);
  await expect(input).toHaveValue(comando);
  await input.press('Enter');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  const vuoleLaParola = (await confirmState(page)).hasInput;
  await clickConfirm(page, 'cancel');
  expect(existsSync(b)).toBe(true);
  expect(vuoleLaParola, 'la riga riportata con Annulla resta incollata').toBe(true);
});
