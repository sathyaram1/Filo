// Verifica #1434 giro 3: esplorazione (si cancella prima del verdetto).
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import fs from 'node:fs';

const SHOTS = 'tests/.shots/1434-g3';
fs.mkdirSync(SHOTS, { recursive: true });

const SITO = `<!doctype html><html><head><title>Fila</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif">
  <div id="ricco" contenteditable="true" style="border:1px solid #999;padding:6px;width:400px">Una <b>parola</b> da formattare oggi.</div>
  <input id="pw" type="password" value="segretissima" style="display:block;margin-top:20px">
  <input id="txt" type="text" value="tagliami adesso" style="display:block;margin-top:20px">
  <input id="ro" type="text" readonly value="sola lettura" style="display:block;margin-top:20px">
  <p id="testo">Un paragrafo di prova da selezionare.</p>
  <iframe id="fr" style="width:400px;height:80px" srcdoc="<div id=ce contenteditable=true>Testo nel riquadro</div>"></iframe>
  </body></html>`;

const selezionaIn = (page, sel, parola) => page.evaluate(([s, p]) => {
  const el = document.querySelector(s);
  el.focus();
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let t;
  while ((t = w.nextNode())) {
    const i = t.nodeValue.indexOf(p);
    if (i < 0) continue;
    const r = document.createRange();
    r.setStart(t, i); r.setEnd(t, i + p.length);
    getSelection().removeAllRanges(); getSelection().addRange(r);
    const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
  return null;
}, [sel, parola]);

const ids = (menu) => menu.locator('.sn-menu-row [data-sn-icon-id]').evaluateAll((els) => els.map((e) => `${e.dataset.snIconId}|${e.getAttribute('aria-label')}|${e.getAttribute('title')}|${e.className}`));

test('esplora: tema chiaro e scuro, stato acceso', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  for (const tema of ['light', 'dark']) {
    await app.evaluate(({ nativeTheme }, t) => { nativeTheme.themeSource = t; }, tema);
    await page.waitForTimeout(400);
    const p = await selezionaIn(page, '#ricco', 'parola');
    await page.mouse.click(p.x, p.y, { button: 'right' });
    const menu = menuDi(page);
    await expect(menu.locator('.sn-menu-row')).toBeVisible();
    console.log(tema, JSON.stringify(await ids(menu)));
    await menu.superficie.screenshot({ path: `${SHOTS}/ricco-${tema}.png` });
    await page.keyboard.press('Escape');
  }
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'system'; });
});

test('esplora: password, taglia, sola lettura', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const menu = menuDi(page);
  await app.evaluate(({ clipboard }) => clipboard.writeText('VUOTO'));
  await page.locator('#pw').click();
  await page.locator('#pw').evaluate((e) => e.select());
  await page.locator('#pw').click({ button: 'right' });
  await expect(menu.principale).toBeVisible();
  console.log('pw fila', JSON.stringify(await ids(menu)));
  console.log('pw voci', JSON.stringify(await menu.voci.allTextContents()));
  const copia = menu.locator('.sn-menu-row [data-sn-icon-id="campo:copy"]');
  if (await copia.count()) {
    await copia.click();
    await page.waitForTimeout(500);
    console.log('pw appunti', await app.evaluate(({ clipboard }) => clipboard.readText()));
  } else await page.keyboard.press('Escape');

  await page.locator('#txt').click();
  await page.locator('#txt').evaluate((e) => e.setSelectionRange(0, 8));
  await page.locator('#txt').click({ button: 'right' });
  console.log('txt fila', JSON.stringify(await ids(menu)));
  await menu.locator('.sn-menu-row [data-sn-icon-id="campo:cut"]').click();
  await page.waitForTimeout(400);
  console.log('txt dopo taglia', await page.locator('#txt').inputValue(), '| appunti', await app.evaluate(({ clipboard }) => clipboard.readText()));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  console.log('txt dopo ctrl+z', await page.locator('#txt').inputValue());

  await page.locator('#ro').click();
  await page.locator('#ro').click({ button: 'right' });
  await expect(menu.principale).toBeVisible();
  console.log('ro fila', JSON.stringify(await ids(menu)));
  await menu.superficie.screenshot({ path: `${SHOTS}/sola-lettura.png` });
  await page.keyboard.press('Escape');
  await page.locator('#ro').evaluate((e) => e.setSelectionRange(0, 4));
  await page.locator('#ro').click({ button: 'right' });
  console.log('ro sel fila', JSON.stringify(await ids(menu)));
  await page.keyboard.press('Escape');
});

test('esplora: annulla dopo grassetto, riquadro, tastiera', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const menu = menuDi(page);
  let p = await selezionaIn(page, '#ricco', 'formattare');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await menu.locator('.sn-menu-row [data-sn-icon-id="scrivibile:bold"]').click();
  await page.waitForTimeout(300);
  console.log('dopo grassetto', await page.locator('#ricco').innerHTML());
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  console.log('dopo ctrl+z', await page.locator('#ricco').innerHTML());

  const fr = page.frameLocator('#fr');
  const box = await page.locator('#fr').boundingBox();
  const f = page.frames().find((x) => x !== page.mainFrame());
  const q = await f.evaluate(() => {
    const el = document.getElementById('ce'); el.focus();
    const t = el.firstChild; const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 5);
    getSelection().removeAllRanges(); getSelection().addRange(r);
    const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.click(box.x + q.x, box.y + q.y, { button: 'right' });
  await expect(menu.principale).toBeVisible();
  console.log('iframe fila', JSON.stringify(await ids(menu)));
  const b = menu.locator('.sn-menu-row [data-sn-icon-id="scrivibile:bold"]');
  if (await b.count()) { await b.click(); await page.waitForTimeout(300); console.log('iframe dopo', await f.evaluate(() => document.getElementById('ce').innerHTML)); }
  else await page.keyboard.press('Escape');
  void fr;

  p = await selezionaIn(page, '#testo', 'paragrafo');
  await page.mouse.move(p.x, p.y);
  await page.keyboard.press('Shift+F10');
  await page.waitForTimeout(500);
  console.log('tastiera aperto', await menu.principale.count());
  if (await menu.principale.count()) {
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press(i < 2 ? 'ArrowDown' : 'ArrowUp');
      console.log('fuoco', await menu.valuta(() => { const a = document.activeElement; return `${a?.className}|${a?.dataset?.snIconId || a?.textContent?.slice(0, 30)}`; }));
    }
    await menu.superficie.screenshot({ path: `${SHOTS}/tastiera.png` });
  }
});

test('esplora: editor', async ({ openTab }) => {
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.locator('#doc').click();
  await editor.keyboard.type('Parola importante qui');
  await editor.screenshot({ path: `${SHOTS}/editor.png` });
  const box = await editor.evaluate(() => {
    const t = document.querySelector('#doc').firstChild;
    let n = t; while (n && n.nodeType !== 3) n = n.firstChild;
    const r = document.createRange(); const i = n.nodeValue.indexOf('importante'); r.setStart(n, i); r.setEnd(n, i + 10);
    getSelection().removeAllRanges(); getSelection().addRange(r);
    const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await editor.mouse.click(box.x, box.y, { button: 'right' });
  const menu = menuDi(editor);
  await expect(menu.locator('.sn-menu-row')).toBeVisible();
  console.log('editor fila', JSON.stringify(await ids(menu)));
  await editor.screenshot({ path: `${SHOTS}/editor-menu.png` });
  await menu.locator('.sn-menu-row .sn-menu-row-overflow').click();
  await editor.waitForTimeout(300);
  await editor.screenshot({ path: `${SHOTS}/editor-altro.png` });
  console.log('editor altro', JSON.stringify(await menu.locator('.sn-menu-icon-grid [data-sn-icon-id]').evaluateAll((els) => els.map((e) => e.dataset.snIconId))));
});
