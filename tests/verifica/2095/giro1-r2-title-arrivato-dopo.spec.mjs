// #2095 giro 1, rilievo 2: un title che il codice mette su un tasto mentre il puntatore ci è già sopra (prima non ne
// aveva) esce nel rettangolo nativo al primo movimento, invece che nel fumetto di Filo.
import { test, expect } from '../../fixtures/electron.mjs';

test('r2 un title arrivato col puntatore già sopra esce nel fumetto di Filo', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForFunction(() => !!window.SN_SUGGERIMENTO);
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.id = 'pDopo';
    b.textContent = 'Tasto';
    b.style.cssText = 'position:fixed;left:200px;top:200px;z-index:2147480000;font-size:30px';
    document.body.appendChild(b);
  });
  const box = await page.locator('#pDopo').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 4, cy);
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('#pDopo').setAttribute('title', 'Arrivato dopo'));
  await page.mouse.move(cx + 1, cy);
  await expect(page.locator('[data-sn-fumetto] .tip')).toHaveText('Arrivato dopo', { timeout: 3000 });
  expect(await page.locator('#pDopo').evaluate((el) => el.hasAttribute('title')), 'il title nativo non deve restare sotto il puntatore').toBe(false);
});
