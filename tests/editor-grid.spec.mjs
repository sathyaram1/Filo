// Feedback Xiymp: il box dell'editor deve essere una griglia 7×10
// (7 colonne × 10 righe).

import { test, expect } from './fixtures/electron.mjs';

test('la griglia moduli ha 7 colonne e 10 righe', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid', { timeout: 8_000 });

  const dims = await page.evaluate(() => {
    const grid = document.querySelector('.ed-grid');
    const cs = getComputedStyle(grid);
    return {
      cols: cs.gridTemplateColumns.split(' ').filter(Boolean).length,
      rows: cs.gridTemplateRows.split(' ').filter(Boolean).length,
    };
  });

  expect(dims.cols).toBe(7);
  expect(dims.rows).toBe(10);
});

test('la griglia più grande ha più celle vuote disponibili dei moduli iniziali', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid', { timeout: 8_000 });
  // 70 celle totali, pochi moduli sulla pagina 0 → tante celle vuote.
  const empties = await page.locator('.ed-cell-empty').count();
  expect(empties).toBeGreaterThan(20);
});
