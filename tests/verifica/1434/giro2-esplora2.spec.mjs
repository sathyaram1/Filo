// Esplorazione giro 2 di #1434: si cancella prima del verdetto.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQImWP8z8DwnwEJMDKgAQYGAH8IBAFwbpVFAAAAAElFTkSuQmCC', 'base64');
const SITO = (img) => `<!doctype html><html><head><title>Fila</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif">
  <div id="ricco" contenteditable="true" style="border:1px solid #999;padding:6px;width:400px">Una parola da formattare qui.</div>
  <textarea id="area" style="display:block;width:300px">testo nella casella</textarea>
  <img id="foto" src="${img}" width="160" height="120" alt="foto">
  </body></html>`;
const ids = (menu) => menu.locator('.sn-menu-row .sn-menu-row-btn[data-sn-icon-id]').evaluateAll((e) => e.map((x) => x.dataset.snIconId));

async function selParola(page, sel, parola) {
  return page.evaluate(([s, p]) => {
    const el = document.querySelector(s);
    if (el.isContentEditable) el.focus();
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let t; while ((t = w.nextNode())) { const i = t.nodeValue.indexOf(p); if (i >= 0) {
      const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + p.length);
      getSelection().removeAllRanges(); getSelection().addRange(r);
      const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    } }
    return null;
  }, [sel, parola]);
}

test('textarea selection then right-click on image', async ({ openTab, testServer }) => {
  const img = testServer.asset(PNG, 'image/png');
  const page = await testServer.openReady(openTab, SITO(img));
  await page.locator('#area').click();
  await page.evaluate(() => { const a = document.getElementById('area'); a.focus(); a.setSelectionRange(0, 5); });
  await page.locator('#foto').click({ button: 'right' });
  console.log('AREA->IMG fila', await ids(menuDi(page)));
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const a = document.getElementById('area'); a.focus(); a.setSelectionRange(0, 5); });
  await page.locator('#area').click({ button: 'right', position: { x: 15, y: 8 } });
  console.log('AREA fila', await ids(menuDi(page)));
});

test('editor undo after fila bold', async ({ openTab }) => {
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.locator('#doc').click();
  await editor.keyboard.type('Parola importante qui');
  const p = await selParola(editor, '#doc', 'importante');
  await editor.mouse.click(p.x, p.y, { button: 'right' });
  await editor.waitForTimeout(400);
  await editor.screenshot({ path: 'tests/.shots/1434-g2-editor.png' });
  await menuDi(editor).locator('.sn-menu-row [data-sn-icon-id="scrivibile:bold"]').click();
  await editor.waitForTimeout(300);
  console.log('ED after bold', await editor.locator('#doc').innerHTML());
  await editor.keyboard.press('Control+z');
  await editor.waitForTimeout(300);
  console.log('ED after undo', await editor.locator('#doc').innerHTML());
  // highlight then undo
  const q = await selParola(editor, '#doc', 'Parola');
  await editor.mouse.click(q.x, q.y, { button: 'right' });
  await menuDi(editor).locator('.sn-menu-row [data-sn-icon-id="scrivibile:highlight"]').click();
  await editor.waitForTimeout(300);
  console.log('ED after hl', await editor.locator('#doc').innerHTML());
  await editor.keyboard.press('Control+z');
  await editor.waitForTimeout(300);
  console.log('ED after hl undo', await editor.locator('#doc').innerHTML());
});

test.describe('strato', () => {
  test.use({ stratoDelMenu: true });
  test('strato bold and link', async ({ openTab, testServer }) => {
    const img = testServer.asset(PNG, 'image/png');
    const page = await testServer.openReady(openTab, SITO(img));
    let p = await selParola(page, '#ricco', 'parola');
    await page.mouse.click(p.x, p.y, { button: 'right' });
    let menu = menuDi(page);
    await expect(menu.locator('.sn-menu-row')).toBeVisible();
    console.log('STRATO fila', await ids(menu));
    await menu.locator('[data-sn-icon-id="scrivibile:bold"]').click();
    await page.waitForTimeout(400);
    console.log('STRATO after bold', await page.locator('#ricco').innerHTML());
    p = await selParola(page, '#ricco', 'qui');
    await page.mouse.click(p.x, p.y, { button: 'right' });
    menu = menuDi(page);
    await menu.locator('[data-sn-icon-id="scrivibile:link"]').click();
    await page.waitForTimeout(500);
    const inp = menu.locator('.sn-menu-sub input');
    console.log('STRATO link input', await inp.count());
    if (await inp.count()) {
      await inp.click();
      await menu.superficie.keyboard.type('esempio.it/y');
      await menu.superficie.keyboard.press('Enter');
    }
    await page.waitForTimeout(500);
    console.log('STRATO after link', await page.locator('#ricco').innerHTML());
    // overflow + in strato
    p = await selParola(page, '#ricco', 'Una');
    await page.mouse.click(p.x, p.y, { button: 'right' });
    menu = menuDi(page);
    await menu.locator('.sn-menu-row .sn-menu-row-overflow').click();
    await page.waitForTimeout(400);
    const s = menu.locator('[data-sn-icon-id="scrivibile:strike"]');
    console.log('STRATO strike', await s.count());
    if (await s.count()) await s.first().click();
    await page.waitForTimeout(400);
    console.log('STRATO after strike', await page.locator('#ricco').innerHTML());
  });
});
