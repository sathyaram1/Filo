// Sulle pagine web il menu del tasto destro risponde a un clic vero anche quando il sito disegna normalmente attorno a
// lui (#586): riquadri in scala, trasparenti o coperti dal sito ospite, zoom sul documento o cambiato a menu aperto,
// dialoghi modali. La difesa dai clic finti e dai menu coperti sta in permessi-siti-porte.spec.mjs.
import { test, expect } from './fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CAMPO = '<input id="c" style="margin:40px;width:300px;font:16px sans-serif">';

async function cliccaIncolla(page, dove) {
  const voce = dove.locator('.sn-menu .sn-menu-paste-main').first();
  await expect(voce).toBeVisible({ timeout: 5000 });
  await sleep(500);
  const bb = await voce.boundingBox();
  await page.mouse.move(bb.x + 10, bb.y + bb.height / 2, { steps: 3 });
  await sleep(150);
  await page.mouse.down(); await page.mouse.up();
}

async function incollaVero(app, page, dove, testo) {
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), testo);
  const box = await dove.locator('#c').boundingBox();
  await page.mouse.click(box.x + 30, box.y + 8, { button: 'right' });
  await cliccaIncolla(page, dove);
  await expect.poll(() => dove.locator('#c').inputValue(), { timeout: 3000 }).toBe(testo);
}

async function riquadro(openTab, testServer, contenitore, sopra = '') {
  const dentro = testServer.html(`<!doctype html><title>Dentro</title><body style="margin:0">${CAMPO}</body>`);
  const page = await testServer.openReady(openTab, `<!doctype html><title>Fuori</title><body style="margin:0">
    <div style="${contenitore};width:700px;height:520px"><iframe id="f" src="${dentro}" style="width:700px;height:520px;border:0"></iframe></div>${sopra}</body>`);
  await page.frameLocator('#f').locator('#c').waitFor({ state: 'visible', timeout: 8000 });
  await sleep(1500);
  return { page, fr: page.frame({ url: dentro }) };
}

for (const [cosa, contenitore, sopra] of [
  ['rimpicciolito', 'transform:scale(.9);transform-origin:0 0', ''],
  ['trasparente al 99%', 'opacity:.99', ''],
  ['con la bolla della chat sopra un angolo del menu', '', '<div style="position:fixed;left:200px;top:200px;width:60px;height:60px;border-radius:50%;background:#36c"></div>'],
]) {
  test(`in un riquadro incorporato ${cosa}, Incolla incolla`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    const { page, fr } = await riquadro(openTab, testServer, contenitore, sopra);
    await incollaVero(app, page, fr, `riquadro-${cosa}`);
  });
}

test('con lo zoom sul documento il menu nasce sotto il cursore, alla sua misura, e Incolla incolla', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html style="zoom:.8"><title>Zoom</title><body><input id="c" style="margin:200px;width:300px"></body></html>`);
  const box = await page.locator('#c').boundingBox();
  await page.mouse.click(box.x + 30, box.y + 8, { button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 5000 });
  const r = await page.evaluate(() => { const m = document.querySelector('.sn-menu').getBoundingClientRect(); return { left: m.left, top: m.top, w: m.width }; });
  expect(Math.abs(r.left - (box.x + 30))).toBeLessThan(4);
  expect(Math.abs(r.top - (box.y + 8))).toBeLessThan(4);
  expect(r.w).toBeGreaterThan(210);
  await page.keyboard.press('Escape');
  await incollaVero(app, page, page, 'zoom-documento');
});

test('cambiato lo zoom della pagina a menu aperto, Incolla incolla', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, `<!doctype html><title>ZoomAperto</title><body>${CAMPO}</body>`);
  const url = page.url();
  await app.evaluate(({ clipboard }) => clipboard.writeText('zoom-aperto'));
  await page.locator('#c').click({ button: 'right' });
  await expect(page.locator('.sn-menu .sn-menu-paste-main').first()).toBeVisible({ timeout: 5000 });
  await sleep(400);
  await app.evaluate(({ webContents }, u) => { webContents.getAllWebContents().find((w) => w.getURL() === u).setZoomFactor(1.25); }, url);
  await sleep(800);
  await cliccaIncolla(page, page);
  await expect.poll(() => page.locator('#c').inputValue(), { timeout: 3000 }).toBe('zoom-aperto');
});

test('dentro un dialogo modale del sito Incolla incolla, e il clic sul menu non chiude il dialogo', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  // Il dialogo si chiude con un clic fuori dal suo riquadro, come fanno molti siti; Incolla cade fuori.
  const page = await testServer.openReady(openTab, `<!doctype html><title>Dialogo</title><body>
    <dialog id="d" style="width:360px;height:60px;padding:0"><input id="c" style="margin:10px;width:300px"></dialog>
    <script>const d = document.getElementById('d'); d.showModal();
    d.addEventListener('click', (e) => { const r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close(); });</script></body>`);
  await app.evaluate(({ clipboard }) => clipboard.writeText('dialogo-586'));
  const box = await page.locator('#c').boundingBox();
  await page.mouse.click(box.x + 30, box.y + 8, { button: 'right' });
  const voce = await page.locator('.sn-menu .sn-menu-paste-main').first().boundingBox();
  const d = await page.locator('#d').boundingBox();
  expect(voce.y).toBeGreaterThan(d.y + d.height);
  await cliccaIncolla(page, page);
  await expect.poll(() => page.locator('#c').inputValue(), { timeout: 3000 }).toBe('dialogo-586');
  expect(await page.evaluate(() => document.getElementById('d').open)).toBe(true);
});
