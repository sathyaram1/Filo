// Giro 18, rilievo 1: il menu del tasto destro compare intero e scoperto, ma nessuna voce risponde a un clic vero
// quando il sito (o chi lo ospita) disegna normalmente attorno a lui: riquadro in scala, trasparente, coperto in un angolo, zoom.
import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CAMPO = '<input id="c" style="margin:40px;width:300px;font:16px sans-serif">';

async function incollaVero(app, page, dove, testo) {
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), testo);
  const box = await dove.locator('#c').boundingBox();
  await page.mouse.click(box.x + 30, box.y + 8, { button: 'right' });
  const voce = dove.locator('.sn-menu .sn-menu-paste-main').first();
  await expect(voce).toBeVisible({ timeout: 5000 });
  await sleep(500);
  const bb = await voce.boundingBox();
  await page.mouse.move(bb.x + 10, bb.y + bb.height / 2, { steps: 3 });
  await sleep(150);
  await page.mouse.down(); await page.mouse.up();
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

for (const [cosa, contenitore] of [['rimpicciolito', 'transform:scale(.9);transform-origin:0 0'], ['trasparente al 99%', 'opacity:.99']]) {
  test(`r1 in un riquadro incorporato ${cosa} dal sito che lo ospita, Incolla incolla`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    const { page, fr } = await riquadro(openTab, testServer, contenitore);
    await incollaVero(app, page, fr, `riquadro-${cosa}`);
  });
}

test('r1 in un riquadro incorporato con la bolla della chat del sito sopra un angolo del menu, Incolla incolla', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const bolla = '<div style="position:fixed;left:200px;top:200px;width:60px;height:60px;border-radius:50%;background:#36c"></div>';
  const { page, fr } = await riquadro(openTab, testServer, '', bolla);
  await incollaVero(app, page, fr, 'riquadro-bolla');
});

test('r1 su una pagina con lo zoom sul documento, Incolla incolla', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html style="zoom:.8"><title>Zoom</title><body>${CAMPO}</body></html>`);
  await incollaVero(app, page, page, 'zoom-documento');
});

test('r1 cambiato lo zoom della pagina a menu aperto, Incolla incolla', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, `<!doctype html><title>ZoomAperto</title><body>${CAMPO}</body>`);
  const url = page.url();
  await app.evaluate(({ clipboard }) => clipboard.writeText('zoom-aperto'));
  await page.locator('#c').click({ button: 'right' });
  await expect(page.locator('.sn-menu .sn-menu-paste-main').first()).toBeVisible({ timeout: 5000 });
  await sleep(400);
  await app.evaluate(({ webContents }, u) => { webContents.getAllWebContents().find((w) => w.getURL() === u).setZoomFactor(1.25); }, url);
  await sleep(800);
  const bb = await page.locator('.sn-menu .sn-menu-paste-main').first().boundingBox();
  await page.mouse.move(bb.x + 10, bb.y + bb.height / 2, { steps: 3 });
  await sleep(200);
  await page.mouse.down(); await page.mouse.up();
  await expect.poll(() => page.locator('#c').inputValue(), { timeout: 3000 }).toBe('zoom-aperto');
});
