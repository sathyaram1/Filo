// #545 giro 6, rilievo 2: nell'Editor aperto in una scheda nuova, Ctrl+Z dopo un clic su un modulo non annulla niente.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

test('Ctrl+Z dopo aver chiuso le statistiche annulla quello che si è appena scritto', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();
  await page.click('#doc');
  await page.keyboard.type('prima parola', { delay: 20 });
  await page.waitForTimeout(400);
  const scritto = await page.locator('#doc').innerText();
  expect(scritto).toContain('prima parola');

  await page.locator('.ed-module[data-type="word-count"]').click();
  await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#overlay')).toBeHidden();

  await page.keyboard.press('Control+KeyZ');
  await expect.poll(() => page.locator('#doc').innerText(), { timeout: 2000 }).not.toBe(scritto);
  expect(page.url()).toContain('editor');
});
