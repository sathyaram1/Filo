import { test, expect } from '../../fixtures/electron.mjs';

const fumetto = (page) => page.locator('[data-sn-fumetto] .tip');

test('bordi della vista e testo lungo', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForFunction(() => !!window.SN_SUGGERIMENTO);
  const lungo = Array.from({ length: 6 }, (_, i) => `Riga ${i + 1} di un suggerimento lungo che va a capo da solo perché supera la larghezza`).join('\n');
  await page.evaluate((t) => {
    const mk = (id, css) => { const b = document.createElement('button'); b.id = id; b.textContent = id; b.title = t; b.style.cssText = `position:fixed;z-index:2147480000;${css}`; document.body.appendChild(b); };
    mk('bd', 'right:0;bottom:0'); mk('as', 'left:0;top:0'); mk('ad', 'right:0;top:0');
  }, lungo);
  const vw = await page.evaluate(() => [innerWidth, innerHeight]);
  for (const id of ['bd', 'as', 'ad']) {
    await page.locator('#' + id).hover();
    await expect(fumetto(page)).toBeVisible();
    const f = await fumetto(page).boundingBox();
    const b = await page.locator('#' + id).boundingBox();
    const sovrappone = !(f.y + f.height <= b.y || f.y >= b.y + b.height || f.x + f.width <= b.x || f.x >= b.x + b.width);
    console.log(id, JSON.stringify(f), 'vista', vw, 'copre il tasto', sovrappone);
    await page.screenshot({ path: `tests/.shots/2095-v2-bordo-${id}.png` });
    await page.mouse.move(400, 400);
    await expect(fumetto(page)).toBeHidden();
  }
});
