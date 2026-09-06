// Diagnostica temporanea: dove finisce il popup del font rispetto a #doc.
import { test, expect } from './fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

test('rettangoli popup font vs #doc', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('.ed-grid');
  await page.locator('.ed-cell-empty').first().click();
  await page.locator('.ed-overlay [data-add="font"]').click();
  await page.waitForSelector('.ed-module[data-type="font"]');
  await page.locator('.ed-module[data-type="font"] .ed-font-button').click();
  await page.waitForTimeout(200);
  const info = await page.evaluate(() => {
    const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) }; };
    const doc = document.getElementById('doc');
    const d = doc.getBoundingClientRect();
    const px = d.left + 5, py = d.top + 5;
    return {
      vw: window.innerWidth, vh: window.innerHeight,
      doc: box(doc), pop: box(document.querySelector('.ed-font-pop')),
      puntoClick: { x: Math.round(px), y: Math.round(py) },
      sottoIlPunto: (document.elementFromPoint(px, py) || {}).className || null,
    };
  });
  console.log('DIAG ' + JSON.stringify(info));
  expect(1).toBe(1);
});
