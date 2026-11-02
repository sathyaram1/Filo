// Esplorazione giro 2 di #1434: si cancella prima del verdetto.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQImWP8z8DwnwEJMDKgAQYGAH8IBAFwbpVFAAAAAElFTkSuQmCC', 'base64');
const SITO = (img) => `<!doctype html><html><head><title>Fila</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif">
  <div id="ricco" contenteditable="true" style="border:1px solid #999;padding:6px;width:400px">Una parola da formattare qui.</div>
  <p id="testo">Un paragrafo di prova da selezionare col mouse.</p>
  <a id="cop" href="https://esempio.it/scheda"><img id="foto" src="${img}" width="160" height="120" alt="foto"></a>
  <iframe id="fr" srcdoc="&lt;img id=&quot;f2&quot; src=&quot;${img}&quot; width=120 height=80&gt;" width="200" height="120"></iframe>
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

test('linked image', async ({ openTab, testServer }) => {
  const img = testServer.asset(PNG, 'image/png');
  const page = await testServer.openReady(openTab, SITO(img));
  await page.locator('#foto').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.locator('.sn-menu-row')).toBeVisible();
  console.log('LINKED IMG fila', await ids(menu));
  console.log('LINKED IMG voci', await menu.voci.allInnerTexts());
});

test('web contenteditable bold, undo, link, highlight, strike via +', async ({ openTab, testServer }) => {
  const img = testServer.asset(PNG, 'image/png');
  const page = await testServer.openReady(openTab, SITO(img));
  let p = await selParola(page, '#ricco', 'parola');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  let menu = menuDi(page);
  console.log('RICCO fila', await ids(menu));
  await menu.locator('[data-sn-icon-id="scrivibile:bold"]').click();
  console.log('after bold', await page.locator('#ricco').innerHTML());
  // second bold toggles?
  p = await selParola(page, '#ricco', 'parola');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.screenshot({ path: 'tests/.shots/1434-g2-ricco-bold-gia.png' });
  await menuDi(page).locator('[data-sn-icon-id="scrivibile:bold"]').click();
  console.log('after bold 2', await page.locator('#ricco').innerHTML());
  await page.keyboard.press('Control+z');
  console.log('after undo', await page.locator('#ricco').innerHTML());
  // highlight
  p = await selParola(page, '#ricco', 'formattare');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await menuDi(page).locator('[data-sn-icon-id="scrivibile:highlight"]').click();
  console.log('after highlight', await page.locator('#ricco').innerHTML());
  // link
  p = await selParola(page, '#ricco', 'qui');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await menuDi(page).locator('[data-sn-icon-id="scrivibile:link"]').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/1434-g2-ricco-link.png' });
  const inp = menuDi(page).locator('.sn-menu-sub input');
  console.log('link input count', await inp.count());
  if (await inp.count()) { await inp.fill('esempio.it/x'); await inp.press('Enter'); }
  await page.waitForTimeout(300);
  console.log('after link', await page.locator('#ricco').innerHTML());
  // strike via +
  p = await selParola(page, '#ricco', 'Una');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await menuDi(page).locator('.sn-menu-row .sn-menu-row-overflow').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/1434-g2-ricco-piu.png' });
  const strike = menuDi(page).locator('[data-sn-icon-id="scrivibile:strike"]');
  console.log('strike count', await strike.count());
  if (await strike.count()) await strike.first().click();
  console.log('after strike', await page.locator('#ricco').innerHTML());
});

test('keyboard context menu with selection', async ({ openTab, testServer }) => {
  const img = testServer.asset(PNG, 'image/png');
  const page = await testServer.openReady(openTab, SITO(img));
  await selParola(page, '#testo', 'paragrafo');
  await page.keyboard.press('Shift+F10');
  await page.waitForTimeout(600);
  const menu = menuDi(page);
  console.log('SHIFTF10 pannelli', await menu.pannelli.count(), 'fila', await ids(menu));
  await page.keyboard.press('Escape');
  await page.keyboard.press('ContextMenu');
  await page.waitForTimeout(600);
  console.log('CTXKEY pannelli', await menuDi(page).pannelli.count(), 'fila', await ids(menuDi(page)));
});

test('iframe image', async ({ openTab, testServer }) => {
  const img = testServer.asset(PNG, 'image/png');
  const page = await testServer.openReady(openTab, SITO(img));
  const fr = page.frameLocator('#fr');
  await fr.locator('#f2').waitFor();
  const box = await page.locator('#fr').boundingBox();
  await page.mouse.click(box.x + 40, box.y + 30, { button: 'right' });
  await page.waitForTimeout(800);
  for (const f of page.frames()) {
    const m = menuDi(f);
    const n = await m.pannelli.count().catch(() => 0);
    if (n) console.log('IFRAME frame', f.url().slice(0, 40), 'fila', await ids(m));
  }
});

test('dark theme screenshots', async ({ openTab, testServer }) => {
  const img = testServer.asset(PNG, 'image/png');
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.evaluate(() => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }));
  const page = await testServer.openReady(openTab, SITO(img));
  await page.waitForTimeout(800);
  const p = await selParola(page, '#ricco', 'parola');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/1434-g2-scuro-ricco.png' });
  await page.keyboard.press('Escape');
  await page.locator('#foto').click({ button: 'right' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/1434-g2-scuro-foto.png' });
});
