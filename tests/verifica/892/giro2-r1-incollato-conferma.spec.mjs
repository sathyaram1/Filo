// #892.1 giro 2, rilievo 1: una cancellazione incollata nella home dopo la barra chiede la parola «conferma»,
// come dice la scelta dell'owner, e come Filo fa per le sue azioni nate da un testo incollato.
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

test('r1 profilo nuovo: una cancellazione incollata dopo la barra chiede di scrivere «conferma»', async ({ app }) => {
  const dir = cartellaTemporanea('filo-892-g2-');
  const bersaglio = path.join(dir, 'da-cancellare');
  mkdirSync(bersaglio);
  writeFileSync(path.join(bersaglio, 'dentro.txt'), 'x');
  const riga = process.platform === 'win32'
    ? `/Remove-Item -Recurse -Force "${bersaglio}"`
    : `/rm -rf "${bersaglio}"`;
  const page = await newtabPage(app);
  const input = page.locator('#input');

  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), riga);
  await input.focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
  await expect(input).toHaveValue(riga);
  await input.press('Enter');

  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  const st = await confirmState(page);
  expect(st.hasInput, 'una riga incollata che cancella vuole la parola «conferma», non basta un OK').toBe(true);
  expect(existsSync(bersaglio)).toBe(true);
  await clickConfirm(page, 'cancel');
});
