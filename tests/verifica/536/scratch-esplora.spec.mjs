// Esplorazione temporanea (da cancellare): com'è fatta la chat dell'editor.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

test('esplora', async ({ openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();
  const mods = await page.locator('.ed-module').evaluateAll(
    (els) => els.map((e) => ({ type: e.dataset.type, z: e.dataset.z, cls: e.className, txt: e.textContent.slice(0, 30) })),
  );
  console.log('MODULI', JSON.stringify(mods, null, 1));
  const html = await page.locator('#grid, .ed-grid, body').first().evaluate((e) => e.outerHTML.slice(0, 3000));
  console.log('HTML', html);
});
