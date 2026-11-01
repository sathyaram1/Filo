// Verifica #1683 giro 1, rilievo 2: con Bash (scelta nelle Preferenze; su Mac è anche la shell di sistema) un comando
// che aspetta una risposta, qui la domanda di `cp -i`, la riceve dalla casella sotto l'uscita, finisce, e il comando
// dopo parte. Ora si prende le righe di fine al posto della risposta e il terminale resta in corso.

import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, clickConfirm } from '../../helpers/confirm.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

test.skip(process.platform === 'win32', '`cp -i` e `read` sono della shell POSIX');

test('r2 la risposta scritta sotto il comando arriva a lui, e il terminale non resta in corso', async ({ app }) => {
  const dir = cartellaTemporanea('filo-1683-r2-');
  writeFileSync(path.join(dir, 'bozza.txt'), 'nuovo');
  writeFileSync(path.join(dir, 'lettera.txt'), 'vecchio');

  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => w.url().startsWith('filo://newtab')) || null;
    return Boolean(page);
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => page.evaluate(() => window.SN_DASH_TERMINALE?.isEnabled?.() === true), { timeout: 8_000 }).toBe(true);
  await app.evaluate(async () => globalThis.__filoHandlers.handleMessage(
    { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { terminal: { enabled: true, shell: 'bash' } } },
    { url: 'filo://preferences/preferences.html' },
  ));
  await expect.poll(() => page.evaluate(() => window.SN_DASH_TERMINALE.getShell()), { timeout: 5_000 }).toBe('bash');
  const input = page.locator('#input');
  await input.fill(`/cd "${dir}"`);
  await input.press('Enter');
  await expect(page.locator('.dash-term-controls')).toHaveCount(0, { timeout: 12_000 });

  await input.fill('/cp -i bozza.txt lettera.txt');
  await input.press('Enter');
  // Sovrascrive un file che c'è: Filo chiede prima, e qui si dice sì.
  await clickConfirm(page, 'ok', { timeout: 10_000 });
  await expect(page.locator('.dash-term-out').last()).toContainText('lettera.txt', { timeout: 12_000 });
  const stdin = page.locator('.dash-term-stdin').last();
  await expect(stdin, 'il comando aspetta la risposta').toBeVisible();
  await stdin.fill('y');
  await stdin.press('Enter');
  await expect.poll(() => readFileSync(path.join(dir, 'lettera.txt'), 'utf8'), { timeout: 8_000 }).toBe('nuovo');
  await expect(page.locator('.dash-term-controls'), 'il comando è finito').toHaveCount(0, { timeout: 8_000 });

  await input.fill('/echo dopo-r2');
  await input.press('Enter');
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  await expect(page.locator('.dash-term-out').last()).toContainText('dopo-r2', { timeout: 12_000 });
});
