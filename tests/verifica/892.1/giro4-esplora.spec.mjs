// #892.1 giro 4 — esplorazione: Invio premuto due volte su una riga appena incollata, e l'aspetto della domanda.

import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState, clickConfirm } from '../../helpers/confirm.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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

test('incollata e Invio premuto due volte di fila: il comando parte una volta sola', async ({ app }) => {
  const dir = cartellaTemporanea('filo-892-1-g4-');
  const f = path.join(dir, 'conta.txt');
  writeFileSync(f, '');
  const page = await newtabPage(app);
  const riga = `/printf x >> "${f}"`;
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), riga);
  await page.locator('#input').focus();
  await page.keyboard.press('Control+V');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const n = await page.evaluate(() => document.querySelectorAll(window.SN_CONFIRM_UI ? '.sn-confirm-host' : 'x').length);
  console.log('dialoghi aperti', n, await confirmState(page));
  await page.screenshot({ path: 'tests/.shots/892-1-g4-doppio.png' }).catch(() => {});
});

test('la domanda prima di una cancellazione scritta a mano, in tema scuro', async ({ app }) => {
  const b = path.join(cartellaTemporanea('filo-892-1-g4-'), 'da-cancellare');
  mkdirSync(b);
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  const page = await newtabPage(app);
  await page.locator('#input').fill(`/rm -rf "${b}"`);
  await page.locator('#input').press('Enter');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  console.log(JSON.stringify(await confirmState(page)));
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'tests/.shots/892-1-g4-scuro.png' });
  await clickConfirm(page, 'cancel');
  expect(existsSync(b)).toBe(true);
});
