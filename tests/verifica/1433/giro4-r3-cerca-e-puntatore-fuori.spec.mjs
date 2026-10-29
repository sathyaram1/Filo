// Verifica #1433, giro 4, rilievo 3: chi sta scrivendo in Cerca e sposta il mouse sul foglio non perde il pannello
// né quello che scrive.

import { test, expect } from '../../fixtures/electron.mjs';

test('r3 aperto dalla striscia, si scrive in Cerca e il mouse va sul foglio: il pannello resta e le lettere finiscono nel campo', async ({ openTab }) => {
  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForFunction(() => document.querySelector('.pd-pannello') && document.querySelector('.pd-elemento[data-elemento="search-replace"]'));
  await ed.click('#doc');
  await ed.keyboard.type('il gatto e il cane e il topo');
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => ed.evaluate(() => document.documentElement.classList.contains('pd-aperto'))).toBe(true);
  await ed.waitForTimeout(300);
  await ed.click('.pd-elemento[data-elemento="search-replace"] [data-sr="find"]');
  await ed.keyboard.type('il');
  await ed.mouse.move(400, 300, { steps: 5 });
  await ed.waitForTimeout(900);
  await ed.keyboard.type(' gatto');
  expect(await ed.evaluate(() => document.documentElement.classList.contains('pd-aperto')), 'il pannello è ancora aperto').toBe(true);
  await expect(ed.locator('.pd-elemento[data-elemento="search-replace"] [data-sr="find"]')).toHaveValue('il gatto');
  await expect(ed.locator('#doc')).toHaveText('il gatto e il cane e il topo');
});
