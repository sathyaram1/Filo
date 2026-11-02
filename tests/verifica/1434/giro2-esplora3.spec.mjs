// Esplorazione giro 2 di #1434: si cancella prima del verdetto.
import { test } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const SITO = `<!doctype html><html><head><title>Fila</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif">
  <div id="ricco" contenteditable="true" style="border:1px solid #999;padding:6px;width:400px">Una parola da formattare.</div>
  </body></html>`;

test('highlight toggle and rapid reopen', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const sel = () => page.evaluate(() => {
    const el = document.getElementById('ricco'); el.focus();
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let t;
    while ((t = w.nextNode())) { const i = t.nodeValue.indexOf('parola'); if (i >= 0) {
      const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 6);
      getSelection().removeAllRanges(); getSelection().addRange(r);
      const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; } }
  });
  let p = await sel();
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await menuDi(page).locator('[data-sn-icon-id="scrivibile:highlight"]').click();
  console.log('hl1', await page.locator('#ricco').innerHTML());
  p = await sel();
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await menuDi(page).locator('[data-sn-icon-id="scrivibile:highlight"]').click();
  console.log('hl2', await page.locator('#ricco').innerHTML());
  for (let i = 0; i < 6; i++) { await page.mouse.click(p.x, p.y, { button: 'right' }); await page.keyboard.press('Escape'); }
  p = await sel();
  await page.mouse.click(p.x, p.y, { button: 'right' });
  console.log('rows after rapid', await menuDi(page).locator('.sn-menu-row').count(), await menuDi(page).pannelli.count());
});
