// #685.1 giro 1 — su Mac Cmd+freccia: casi in cui si scrive ma il tasto naviga lo stesso.
import { test, expect } from '../../fixtures/electron.mjs';

function premi(app, keyCode, modifiers) {
  return app.evaluate(({ BrowserWindow }, arg) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: arg.keyCode, modifiers: arg.modifiers });
  }, { keyCode, modifiers });
}
const diventaMac = (app) => app.evaluate(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
});

async function vai(page, url) {
  await page.evaluate((u) => { window.location.href = u; }, url);
  await page.waitForURL(url, { timeout: 10_000 });
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
}

const A = '<!doctype html><title>A</title><h1 id="a">pagina A</h1>';

async function prepara({ app, openTab, testServer }, html) {
  const urlA = testServer.html(A);
  const urlB = testServer.html(html);
  const page = await testServer.openReady(openTab, A);
  await vai(page, urlA);
  await vai(page, urlB);
  await diventaMac(app);
  return { page, urlB };
}

// Come un editor di documenti online: il testo si disegna nella pagina, i tasti
// li riceve un campo dentro un riquadro; un clic sul foglio non toglie il fuoco al campo.
const DOC = '<!doctype html><title>Doc</title>'
  + '<div id="foglio" style="height:200px;background:#eee">foglio</div>'
  + '<iframe id="fr" srcdoc="<div id=ed contenteditable=true style=min-height:40px></div>"></iframe>'
  + '<script>document.getElementById("foglio").addEventListener("mousedown", e => e.preventDefault());</script>';

test('editor in un riquadro: clic sul foglio e Cmd+← non porta via la pagina', async ({ app, openTab, testServer }) => {
  const { page, urlB } = await prepara({ app, openTab, testServer }, DOC);
  const ed = page.frameLocator('#fr').locator('#ed');
  await ed.click();
  await page.keyboard.type('una riga scritta');
  await page.waitForTimeout(700);
  await page.locator('#foglio').click();
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('fr');
  await premi(app, 'Left', ['meta']);
  await page.waitForTimeout(1_200);
  expect(page.url()).toBe(urlB);
});

const PROPRIO = '<!doctype html><title>P</title><h1 id="p">griglia</h1><div id="n">0</div>'
  + '<script>addEventListener("keydown", e => { if (e.metaKey && e.key === "ArrowLeft") { e.preventDefault(); n.textContent = +n.textContent + 1; } });</script>';

test('una pagina che usa Cmd+← per sé non viene portata via', async ({ app, openTab, testServer }) => {
  const { page, urlB } = await prepara({ app, openTab, testServer }, PROPRIO);
  await page.locator('#p').click();
  await premi(app, 'Left', ['meta']);
  await page.waitForTimeout(1_200);
  expect(page.url()).toBe(urlB);
});

const PLAIN = '<!doctype html><title>T</title><div id="ed" contenteditable="plaintext-only" style="min-height:40px"></div>';

test('campo plaintext-only: Cmd+← non porta via la pagina', async ({ app, openTab, testServer }) => {
  const { page, urlB } = await prepara({ app, openTab, testServer }, PLAIN);
  await page.locator('#ed').click();
  await page.keyboard.type('testo');
  await premi(app, 'Left', ['meta']);
  await page.waitForTimeout(1_200);
  expect(page.url()).toBe(urlB);
});
