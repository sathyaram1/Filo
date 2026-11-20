// r3: ingrandita una foto del carosello, la freccia a destra della tastiera porta alla foto dopo.
import { test, expect } from '../../fixtures/electron.mjs';
import { NEWTAB, preparaImmagini, stubModello, chiedi } from './aiuti.mjs';

test('r3 dalla foto ingrandita si passa alla prossima del carosello', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await preparaImmagini(app, 3);
  await stubModello(app, [{ strumento: { azione: 'immagini', query: 'antilope' } }, { testo: 'Ecco.\n\n[[immagini: $ID0, $ID1, $ID2]]' }]);
  const page = await openTab(NEWTAB);
  await chiedi(page, 'antilope immagine');
  const imgs = page.locator('.dash-bubble-filo .filo-galleria-img');
  await expect(imgs).toHaveCount(3, { timeout: 30_000 });
  await expect.poll(() => imgs.evaluateAll((els) => els.filter((e) => e.complete && e.naturalWidth > 0).length), { timeout: 15_000 }).toBe(3);
  const seconda = await imgs.nth(1).getAttribute('src');
  await imgs.first().click();
  const grande = page.locator('#lightbox.open img');
  await expect(grande).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(grande).toHaveAttribute('src', seconda, { timeout: 3000 });
});
