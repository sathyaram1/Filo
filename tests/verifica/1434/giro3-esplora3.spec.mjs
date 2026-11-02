// Verifica #1434 giro 3: esplorazione (si cancella prima del verdetto).
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const SITO = (sub) => `<!doctype html><html><head><title>Fila</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif">
  <input id="txt" type="text" value="tagliami adesso" style="display:block;width:300px">
  <p id="testo">Un paragrafo di prova da selezionare.</p>
  <iframe id="fs" src="${sub}" style="width:400px;height:60px"></iframe>
  <iframe id="fb" style="width:400px;height:60px"></iframe>
  </body></html>`;

const ids = (menu) => menu.locator('.sn-menu-row [data-sn-icon-id]').evaluateAll((els) => els.map((e) => e.dataset.snIconId));

test('esplora: taglia dalla voce, poi annulla', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO('about:blank'));
  const menu = menuDi(page);
  await page.locator('#txt').click();
  await page.locator('#txt').evaluate((e) => e.setSelectionRange(0, 8));
  const b = await page.locator('#txt').boundingBox();
  await page.mouse.click(b.x + 20, b.y + b.height / 2, { button: 'right' });
  await menu.voce('Taglia').first().click();
  await page.waitForTimeout(400);
  console.log('voce taglia', await page.locator('#txt').inputValue());
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  console.log('voce taglia ctrl+z', await page.locator('#txt').inputValue());
});

test('esplora: tastiera nella fila', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO('about:blank'));
  const menu = menuDi(page);
  await page.evaluate(() => {
    const r = document.createRange(); r.selectNodeContents(document.getElementById('testo').firstChild);
    getSelection().removeAllRanges(); getSelection().addRange(r);
  });
  const b = await page.locator('#testo').boundingBox();
  await page.mouse.click(b.x + 30, b.y + b.height / 2, { button: 'right' });
  await expect(menu.principale).toBeVisible();
  const fuoco = () => menu.valuta(() => { const a = document.activeElement; return `${a?.className}|${a?.dataset?.snIconId || (a?.textContent || '').slice(0, 20)}`; });
  for (const k of ['ArrowDown', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Enter']) {
    await menu.superficie.keyboard.press(k);
    console.log('dopo', k, await fuoco(), '| aperto', await menu.principale.count(), '| sotto', await menu.locator('.sn-menu-icon-grid').count());
  }
});

test('esplora: riquadri', async ({ openTab, testServer }) => {
  const sub = testServer.html('<!doctype html><html><body><div id=ce contenteditable=true style="font:16px sans-serif">Testo nel riquadro</div></body></html>');
  const page = await testServer.openReady(openTab, SITO(sub));
  await page.evaluate(() => {
    const d = document.getElementById('fb').contentDocument;
    d.open(); d.write('<html><body contenteditable="true" style="font:16px sans-serif">Corpo scritto a mano</body></html>'); d.close();
  });
  await page.waitForTimeout(1500);
  const menu = menuDi(page);
  for (const [id, parola] of [['#fs', 'Testo'], ['#fb', 'Corpo']]) {
    const box = await page.locator(id).boundingBox();
    const f = await (await page.locator(id).elementHandle()).contentFrame();
    const q = await f.evaluate((p) => {
      const el = document.getElementById('ce') || document.body; el.focus();
      const t = el.firstChild; const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, p.length);
      getSelection().removeAllRanges(); getSelection().addRange(r);
      const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, parola);
    await page.mouse.click(box.x + q.x, box.y + q.y, { button: 'right' });
    await page.waitForTimeout(1200);
    console.log(id, 'menu', await menu.principale.count(), (await menu.principale.count()) ? JSON.stringify(await ids(menu)) : '', page.context().pages().filter((x) => x.url().startsWith('data:')).length);
    const bold = menu.locator('.sn-menu-row [data-sn-icon-id="scrivibile:bold"]');
    if (await bold.count()) { await bold.click(); await page.waitForTimeout(300); console.log(id, 'dopo', await f.evaluate(() => (document.getElementById('ce') || document.body).innerHTML)); }
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    await page.waitForTimeout(500);
  }
});
