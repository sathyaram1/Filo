// Esplorazione temporanea (da cancellare): com'è fatta la chat dell'editor.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

test('esplora', async ({ openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();
  const sw = page.locator('.ed-module[data-type="switch"]');
  console.log('SWITCH HTML', await sw.evaluate((e) => e.outerHTML));
  await sw.locator('button, .ed-sw-next, *').last().click({ force: true }).catch(() => {});
  await page.waitForTimeout(500);
  let mods = await page.locator('.ed-module').evaluateAll(
    (els) => els.map((e) => ({ type: e.dataset.type, cls: e.className })),
  );
  console.log('DOPO CLICK', JSON.stringify(mods));
  const chat = page.locator('.ed-module[data-type="chat"]');
  if (await chat.count()) {
    console.log('CHAT HTML', await chat.evaluate((e) => e.outerHTML.slice(0, 800)));
    await chat.click();
    await page.waitForTimeout(400);
    console.log('PAD', await page.locator('.ed-mod-pad').count(),
      await page.locator('.ed-chat').count());
  }
});
