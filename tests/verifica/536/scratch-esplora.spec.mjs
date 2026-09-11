// Esplorazione temporanea (da cancellare): com'è fatta la chat dell'editor.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

test('esplora', async ({ openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();
  await page.locator('.ed-switch-icon[title="Revisione"]').click();
  await page.waitForTimeout(500);
  const mods = await page.locator('.ed-module').evaluateAll(
    (els) => els.map((e) => ({ type: e.dataset.type, cls: e.className })),
  );
  console.log('DOPO SWITCH', JSON.stringify(mods));
  const chat = page.locator('.ed-module[data-type="chat"]');
  console.log('chat count', await chat.count());
  if (await chat.count()) {
    console.log('CHAT HTML', await chat.evaluate((e) => e.outerHTML.slice(0, 600)));
    await chat.click();
    await page.waitForTimeout(400);
    console.log('pad', await page.locator('.ed-chat').count(),
      'input', await page.locator('[data-chat="input"]').count());
  }
});
