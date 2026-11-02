// Esplorazione del verificatore di #1434: non asserisce, raccoglie.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQImWP8z8DwnwEJMDKgAQYGAH8IBAFwbpVFAAAAAElFTkSuQmCC', 'base64');
const SITO = (img) => `<!doctype html><html><head><title>Esplora</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif;height:1400px">
  <p id="testo">Un paragrafo di prova da selezionare col mouse.</p>
  <img id="foto" src="${img}" width="160" height="120" alt="foto">
  <p><a id="vai" href="https://esempio.it/pagina">un collegamento</a></p>
  <div id="ricco" contenteditable="true" style="border:1px solid #999;padding:6px">Testo ricco del sito</div>
  <textarea id="area" style="width:300px">Testo semplice nel campo</textarea>
  <video id="vid" width="200" height="100" style="background:#000"></video>
  <div id="vuoto" style="height:200px"></div>
  </body></html>`;

const ids = (menu) => menu.locator('.sn-menu-row [data-sn-icon-id]').evaluateAll((els) => els.map((e) => e.dataset.snIconId + '|' + (e.getAttribute('title') || '') + '|' + (e.getAttribute('aria-label') || '')));
const log = (...a) => console.log('[ESPLORA]', ...a);

async function selezionaIn(page, sel, parola) {
  return page.evaluate(([s, p]) => {
    const root = document.querySelector(s);
    if (root.tagName === 'TEXTAREA') { root.focus(); root.setSelectionRange(0, 5); const r = root.getBoundingClientRect(); return { x: r.x + 20, y: r.y + 10 }; }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let t = w.nextNode();
    while (t && !t.nodeValue.includes(p)) t = w.nextNode();
    const i = t.nodeValue.indexOf(p);
    const r = document.createRange();
    r.setStart(t, i); r.setEnd(t, i + p.length);
    getSelection().removeAllRanges(); getSelection().addRange(r);
    const q = r.getBoundingClientRect();
    return { x: q.x + q.width / 2, y: q.y + q.height / 2 };
  }, [sel, parola]);
}

test('esplora i contesti del sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const img = testServer.asset(PNG, 'image/png');
  const page = await testServer.openReady(openTab, SITO(img));
  const menu = menuDi(page);
  const prova = async (nome, apri) => {
    await apri();
    await page.waitForTimeout(500);
    const c = await menu.pannelli.count();
    const fila = c ? await ids(menu) : [];
    const voci = c ? await menu.voci.allInnerTexts() : [];
    const piu = c ? await menu.locator('.sn-menu-row-overflow').count() : 0;
    log(nome, JSON.stringify({ fila, piu, voci: voci.map((v) => v.replace(/\s+/g, ' ').slice(0, 40)) }));
    await page.screenshot({ path: `tests/.shots/1434-${nome}.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  };
  await prova('immagine', () => page.locator('#foto').click({ button: 'right' }));
  await prova('link', () => page.locator('#vai').click({ button: 'right' }));
  await prova('vuoto', () => page.locator('#vuoto').click({ button: 'right' }));
  await prova('video', () => page.locator('#vid').click({ button: 'right' }));
  await prova('testo', async () => { const p = await selezionaIn(page, '#testo', 'paragrafo'); await page.mouse.click(p.x, p.y, { button: 'right' }); });
  await prova('ricco', async () => { await page.locator('#ricco').click(); const p = await selezionaIn(page, '#ricco', 'ricco'); await page.mouse.click(p.x, p.y, { button: 'right' }); });
  await prova('area', async () => { const p = await selezionaIn(page, '#area', ''); await page.mouse.click(p.x, p.y, { button: 'right' }); });
  await prova('ricco-senza-sel', async () => { await page.locator('#ricco').click(); await page.evaluate(() => getSelection().collapseToEnd()); await page.locator('#ricco').click({ button: 'right' }); });

  // grassetto sul campo ricco del sito
  await page.locator('#ricco').click();
  let p = await selezionaIn(page, '#ricco', 'ricco');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.waitForTimeout(400);
  if (await menu.locator('[data-sn-icon-id="scrivibile:bold"]').count()) {
    await menu.locator('[data-sn-icon-id="scrivibile:bold"]').click();
    await page.waitForTimeout(300);
    log('ricco dopo bold', await page.locator('#ricco').innerHTML());
  }
  // hover sull'icona
  p = await selezionaIn(page, '#testo', 'paragrafo');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.waitForTimeout(400);
  const btn = menu.locator('.sn-menu-row [data-sn-icon-id]').first();
  await btn.hover();
  await page.waitForTimeout(1200);
  log('tooltip', JSON.stringify(await menu.valuta(() => [...document.querySelectorAll('[class*=tooltip], [class*=hover], [role=tooltip]')].filter((e) => e.offsetParent).map((e) => e.className + ':' + e.textContent.slice(0, 40)))));
  await page.screenshot({ path: 'tests/.shots/1434-hover.png' });
  // tastiera: freccia giù dal menu aperto
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  log('focus dopo frecce', await menu.valuta(() => { const a = document.activeElement; return a ? (a.className + '|' + (a.dataset?.snIconId || '') + '|' + a.textContent.slice(0, 30)) : ''; }));
  await page.keyboard.press('Escape');

  // link: apri in nuova scheda dalla fila
  await page.locator('#vai').click({ button: 'right' });
  await page.waitForTimeout(400);
  const prima = app.windows().length;
  if (await menu.locator('[data-sn-icon-id="link:openTab"]').count()) {
    await menu.locator('[data-sn-icon-id="link:openTab"]').click();
    await page.waitForTimeout(1500);
    const schede = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().flatMap((w) => (w._filoTabs?.tabs || []).map((t) => { try { return t.view.webContents.getURL(); } catch (_) { return '?'; } })));
    log('schede dopo openTab', prima, JSON.stringify(schede));
  }
});

test('esplora editor: sottolineato, barrato, annulla, tema scuro', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.locator('#doc').click();
  await editor.keyboard.type('Alfa beta gamma delta');
  const menu = menuDi(editor);
  let p = await selezionaIn(editor, '#doc', 'beta');
  await editor.mouse.click(p.x, p.y, { button: 'right' });
  await editor.waitForTimeout(500);
  log('editor fila', JSON.stringify(await ids(menu)));
  log('editor voci', JSON.stringify((await menu.voci.allInnerTexts()).map((v) => v.replace(/\s+/g, ' ').slice(0, 30))));
  await editor.screenshot({ path: 'tests/.shots/1434-editor.png' });
  await menu.locator('[data-sn-icon-id="scrivibile:underline"]').click();
  await editor.waitForTimeout(300);
  log('dopo underline', await editor.locator('#doc').innerHTML());
  // annulla con Ctrl+Z
  await editor.keyboard.press('Control+z');
  await editor.waitForTimeout(400);
  log('dopo ctrl+z', await editor.locator('#doc').innerHTML());
  await editor.keyboard.press('Control+y');
  await editor.waitForTimeout(400);
  log('dopo ctrl+y', await editor.locator('#doc').innerHTML());
  // barrato dal +
  p = await selezionaIn(editor, '#doc', 'gamma');
  await editor.mouse.click(p.x, p.y, { button: 'right' });
  await editor.waitForTimeout(400);
  await menu.locator('.sn-menu-row-overflow').click();
  await editor.waitForTimeout(400);
  log('editor +', JSON.stringify(await menu.locator('.sn-menu-icon-grid [data-sn-icon-id]').evaluateAll((els) => els.map((e) => e.dataset.snIconId))));
  await editor.screenshot({ path: 'tests/.shots/1434-editor-piu.png' });
  if (await menu.locator('.sn-menu-icon-grid [data-sn-icon-id="scrivibile:strike"]').count()) {
    await menu.locator('.sn-menu-icon-grid [data-sn-icon-id="scrivibile:strike"]').click();
    await editor.waitForTimeout(300);
  }
  log('dopo strike', await editor.locator('#doc').innerHTML());
  // grassetto due volte = toglie
  p = await selezionaIn(editor, '#doc', 'delta');
  await editor.mouse.click(p.x, p.y, { button: 'right' });
  await menu.locator('[data-sn-icon-id="scrivibile:bold"]').click();
  p = await selezionaIn(editor, '#doc', 'delta');
  await editor.mouse.click(p.x, p.y, { button: 'right' });
  await editor.waitForTimeout(300);
  log('stato bold attivo?', JSON.stringify(await menu.locator('[data-sn-icon-id="scrivibile:bold"]').evaluate((e) => ({ cls: e.className, pressed: e.getAttribute('aria-pressed') }))));
  await editor.keyboard.press('Escape');
  await editor.waitForTimeout(1500);
  await editor.reload();
  await editor.waitForSelector('#doc');
  await editor.waitForTimeout(800);
  log('dopo reload', await editor.locator('#doc').innerHTML());

  // tema scuro
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  await editor.waitForTimeout(800);
  p = await selezionaIn(editor, '#doc', 'Alfa');
  await editor.mouse.click(p.x, p.y, { button: 'right' });
  await editor.waitForTimeout(600);
  await editor.screenshot({ path: 'tests/.shots/1434-editor-scuro.png' });
});
