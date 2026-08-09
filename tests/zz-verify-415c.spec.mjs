// VERIFICA #415 batch 3 (temporaneo, verifier) — falsi positivi della guardia:
// comandi che si RIPETONO di proposito (+ / −) e che dopo ogni clic si
// ridisegnano restando nello stesso posto.
import { test, expect } from './fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

async function openSettings(page) {
  await page.locator('.ed-module[data-type="settings"]').click();
  await page.waitForSelector('.ed-grid-size');
}

test('H) «Dimensione griglia»: due clic rapidi su + devono aggiungere DUE colonne', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('.ed-grid');
  await openSettings(page);
  await expect(page.locator('#gsCols')).toHaveText('7');
  await page.locator('.ed-grid-size [data-gs="cols+"]').dblclick();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/v415c-H-gridsize.png' });
  const cols = await page.locator('#gsCols').textContent();
  console.log('colonne dopo doppio clic su +:', cols);
  expect(cols).toBe('9');
});

test('I) «Dimensione griglia»: clic rapidi ripetuti su − ', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('.ed-grid');
  await openSettings(page);
  const btn = page.locator('.ed-grid-size [data-gs="rows-"]');
  for (let i = 0; i < 4; i += 1) { await btn.click({ delay: 10 }); await page.waitForTimeout(60); }
  const rows = await page.locator('#gsRows').textContent();
  console.log('righe dopo 4 clic rapidi su −:', rows, '(atteso 6)');
  expect(rows).toBe('6');
});
