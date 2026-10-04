// #870 giro 3, rilievo 4: «Nuovo mazzo» sulla carta dei Mazzi vuota porta a un mazzo nuovo, non alla libreria.
import { test, expect } from '../../fixtures/electron.mjs';

test('«Nuovo mazzo» apre il costruttore di un mazzo nuovo', async ({ app }) => {
  test.setTimeout(45_000);
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://newtab')); return !!page; }, { timeout: 15_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  const bott = page.locator('#tieni .dash-carta[data-tipo="mazzi"] .dash-carta-az.principale');
  await expect(bott).toHaveText('Nuovo mazzo', { timeout: 10_000 });
  await bott.click();
  let mazzi = null;
  await expect.poll(() => { mazzi = app.windows().find((w) => w.url().startsWith('filo://decks/')); return !!mazzi; }, { timeout: 10_000 }).toBe(true);
  await expect.poll(() => mazzi.url(), { timeout: 8_000 }).toContain('#/deck/');
});
