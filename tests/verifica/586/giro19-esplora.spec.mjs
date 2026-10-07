// Esplorazione giro 19 (#586): il menu sul web risponde nel documento principale con disegni normali del sito.
import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CAMPO = '<input id="c" style="margin:40px;width:300px;font:16px sans-serif">';

async function incolla(app, page, testo, { x, y } = {}) {
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), testo);
  const box = await page.locator('#c').boundingBox();
  await page.mouse.click(x ?? box.x + 30, y ?? box.y + 8, { button: 'right' });
  const voce = page.locator('.sn-menu .sn-menu-paste-main').first();
  await expect(voce).toBeVisible({ timeout: 5000 });
  await sleep(600);
  const bb = await voce.boundingBox();
  await page.mouse.move(bb.x + 10, bb.y + bb.height / 2, { steps: 3 });
  await sleep(150);
  await page.mouse.down(); await page.mouse.up();
  await expect.poll(() => page.locator('#c').inputValue(), { timeout: 3000 }).toBe(testo);
}

test('bolla fissa del sito sopra un angolo del menu, documento principale', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><title>B</title><body>${CAMPO}
    <div style="position:fixed;left:150px;top:80px;width:80px;height:80px;border-radius:50%;background:#36c;z-index:2147483647"></div></body>`);
  await incolla(app, page, 'bolla');
});

test('pagina in bianco e nero (filtro sul documento)', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html style="filter:grayscale(1)"><title>G</title><body>${CAMPO}</body></html>`);
  await incolla(app, page, 'grigio');
});

test('dialogo modale che entra in dissolvenza e scala', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><title>D</title><style>
    dialog{opacity:.97;transform:scale(.98);padding:0;width:360px}</style><body>
    <dialog id="d"><input id="c" style="margin:10px;width:300px"></dialog><script>d.showModal()</script></body>`);
  await incolla(app, page, 'dialogo-scala');
});

test('finestra bassa: il menu non entra tutto', async ({ app, openTab, testServer, shell }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><title>Bassa</title><body>${CAMPO}</body>`);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(900, 330); });
  await sleep(1200);
  await incolla(app, page, 'bassa');
});

test('un avviso del sito nello strato alto compare dopo il menu', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><title>T</title><body>${CAMPO}
    <div id="t" popover="manual" style="inset:auto;right:10px;bottom:10px;margin:0">Salvato</div>
    <script>document.addEventListener('contextmenu', () => setTimeout(() => t.showPopover(), 200));</script></body>`);
  await incolla(app, page, 'avviso');
});

test('elemento a schermo intero (lettore)', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><title>F</title><body>
    <div id="p" style="background:#222">${CAMPO}</div></body>`);
  const url = page.url();
  await app.evaluate(async ({ webContents }, u) => {
    const w = webContents.getAllWebContents().find((x) => x.getURL() === u);
    await w.executeJavaScript('document.getElementById("p").requestFullscreen()', true);
  }, url);
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement), { timeout: 5000 }).toBe(true);
  await sleep(1000);
  await incolla(app, page, 'schermo-intero');
});
