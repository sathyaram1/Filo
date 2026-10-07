// Esplorazione del giro 3 (#589.11): casi normali che la guardia non deve rompere.
import { test, expect } from '../../fixtures/electron.mjs';

const SEGRETO = 'pw-Segreta-589-undici';

async function apri(openTab, testServer, html) {
  const page = await testServer.openReady(openTab, html);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
  return page;
}

test('E1 schermo intero dentro un contenitore semitrasparente: Incolla funziona', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await apri(openTab, testServer, `<!doctype html><html><body style="padding:20px">
    <div style="opacity:.97;transform:scale(1.02)"><div id="fs" style="background:#eee;padding:40px">
      <input id="campo" style="width:240px;font-size:16px"></div></div></body></html>`);
  await page.locator('#campo').click();
  await page.evaluate(() => document.getElementById('fs').requestFullscreen());
  await page.waitForTimeout(800);
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu-paste-main')).toBeVisible();
  await page.waitForTimeout(400);
  await page.locator('.sn-menu-paste-main').click();
  await page.waitForTimeout(500);
  const toast = await page.locator('.sn-toast').allTextContents();
  console.log('E1 valore', await page.locator('#campo').inputValue(), 'toast', toast);
  expect(await page.locator('#campo').inputValue()).toBe(SEGRETO);
});

test('E2 riquadro incorporato in una finestra modale centrata con translate e scale(1): Incolla funziona', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const riquadro = testServer.html(`<!doctype html><html><body style="margin:10px">
    <input id="campo" style="width:240px;font-size:16px"></body></html>`, { pubblico: true });
  const page = await apri(openTab, testServer, `<!doctype html><html><body>
    <div style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%) scale(1);opacity:.98;box-shadow:0 0 20px #0005">
    <iframe src="${riquadro}" style="width:600px;height:420px;border:0"></iframe></div>
  </body></html>`);
  const fr = () => page.frames().find((f) => f.url().includes('sito-pubblico.test'));
  await expect.poll(() => !!fr()).toBe(true);
  const frame = fr();
  await frame.waitForSelector('#campo');
  await frame.locator('#campo').click({ button: 'right' });
  await expect(frame.locator('.sn-menu-paste-main')).toBeVisible();
  await page.waitForTimeout(500);
  await frame.locator('.sn-menu-paste-main').click();
  await page.waitForTimeout(500);
  console.log('E2 valore', await frame.locator('#campo').inputValue(), 'toast', await frame.locator('.sn-toast').allTextContents());
  expect(await frame.locator('#campo').inputValue()).toBe(SEGRETO);
});

test('E3 clic subito dopo il tasto destro', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await apri(openTab, testServer, `<!doctype html><html><body style="padding:40px">
    <input id="campo" style="width:320px;font-size:16px"></body></html>`);
  const box = await page.locator('#campo').boundingBox();
  const risultati = [];
  for (const attesa of [0, 30, 80, 150, 250]) {
    await page.locator('#campo').fill('');
    await page.mouse.click(box.x + 20, box.y + 10, { button: 'right' });
    await page.locator('.sn-menu-paste-main').waitFor();
    const b = await page.locator('.sn-menu-paste-main').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    if (attesa) await page.waitForTimeout(attesa);
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(400);
    risultati.push([attesa, await page.locator('#campo').inputValue(), await page.locator('.sn-menu').count()]);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  console.log('E3', JSON.stringify(risultati));
});

test('E4 pagina con zoom CSS e will-change sulla radice: Incolla funziona', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await apri(openTab, testServer, `<!doctype html><html style="zoom:1.25;will-change:transform"><body style="padding:40px">
    <input id="campo" style="width:320px;font-size:16px"></body></html>`);
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu-paste-main')).toBeVisible();
  await page.waitForTimeout(300);
  await page.locator('.sn-menu-paste-main').click();
  await page.waitForTimeout(400);
  console.log('E4 valore', await page.locator('#campo').inputValue(), await page.locator('.sn-toast').allTextContents());
  expect(await page.locator('#campo').inputValue()).toBe(SEGRETO);
});

test('E5 pagina scura per inversione con immagini rimesse dritte: aspetto col menu aperto', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await apri(openTab, testServer, `<!doctype html><html><head><style>
    html { filter: invert(1) hue-rotate(180deg); }
    .foto { filter: invert(1) hue-rotate(180deg); }
    </style></head><body style="padding:40px;background:#fff;color:#000"><h1>Pagina scura</h1>
    <div class="foto" style="width:200px;height:120px;background:linear-gradient(90deg,#e33,#3a3,#33e)"></div>
    <div style="position:fixed;right:20px;bottom:20px;width:120px;height:60px;background:#fc0;z-index:2147483647">chat</div>
    <input id="campo" style="width:320px;font-size:16px"></body></html>`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/589-11-g3-inv-chiuso.png' });
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu-paste-main')).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/589-11-g3-inv-aperto.png' });
  await page.locator('.sn-menu-paste-main').click();
  await page.waitForTimeout(400);
  expect(await page.locator('#campo').inputValue()).toBe(SEGRETO);
});
