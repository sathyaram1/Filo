// #2095 giro 2, rilievo 2: su un tasto vicino al bordo destro di una pagina che scorre, un fumetto lungo finisce sotto
// la barra di scorrimento: il suo lato destro non si vede.
import { test, expect } from '../../fixtures/electron.mjs';

const fumetto = (page) => page.locator('[data-sn-fumetto] .tip');

test('r2 il fumetto lungo di un tasto sul bordo destro resta tutto nella parte visibile della pagina', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForFunction(() => !!window.SN_SUGGERIMENTO);
  const larghezze = await page.evaluate(() => [innerWidth, document.documentElement.clientWidth]);
  expect(larghezze[1], 'la pagina deve avere la sua barra di scorrimento').toBeLessThan(larghezze[0]);
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.id = 'pDestro';
    b.textContent = 'Tasto';
    b.title = 'Un suggerimento abbastanza lungo da prendere tutta la larghezza del fumetto, e andare a capo';
    b.style.cssText = `position:fixed;left:${document.documentElement.clientWidth - 60}px;top:200px;z-index:2147480000`;
    document.body.appendChild(b);
  });
  await page.locator('#pDestro').hover();
  await expect(fumetto(page)).toBeVisible();
  const f = await fumetto(page).boundingBox();
  expect(f.x + f.width, 'il bordo destro del fumetto sta prima della barra di scorrimento').toBeLessThanOrEqual(larghezze[1]);
});
