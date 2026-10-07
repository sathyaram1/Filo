// #685.1 giro 2 — esplorazione: Cmd+freccia su Mac in campi e riquadri insoliti.
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
  return { page, urlA, urlB };
}

const CHIUSO = '<!doctype html><title>C</title><x-campo id="c"></x-campo><script>'
  + 'customElements.define("x-campo", class extends HTMLElement { constructor() { super();'
  + ' const r = this.attachShadow({ mode: "closed" }); r.innerHTML = "<input id=i style=width:300px>"; } });</script>';

test('shadow chiuso: Cmd+← mentre si scrive non porta via la pagina', async ({ app, openTab, testServer }) => {
  const { page, urlB } = await prepara({ app, openTab, testServer }, CHIUSO);
  await page.locator('#c').click();
  await page.keyboard.type('scrivo qui');
  await premi(app, 'Left', ['meta']);
  await page.waitForTimeout(1_200);
  expect(page.url()).toBe(urlB);
});

const DESIGN = '<!doctype html><title>D</title><iframe id="fr" srcdoc="<body>x</body>"></iframe>'
  + '<script>fr.addEventListener("load", () => { fr.contentDocument.designMode = "on"; });</script>';

test('riquadro in designMode: Cmd+← mentre si scrive non porta via la pagina', async ({ app, openTab, testServer }) => {
  const { page, urlB } = await prepara({ app, openTab, testServer }, DESIGN);
  await page.waitForTimeout(500);
  await page.frameLocator('#fr').locator('body').click();
  await page.keyboard.type('scrivo');
  await premi(app, 'Left', ['meta']);
  await page.waitForTimeout(1_200);
  expect(page.url()).toBe(urlB);
});

test('riquadro di altra origine con un campo: Cmd+← non porta via la pagina', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html('<!doctype html><input id="i">', { pubblico: true });
  const { page, urlB } = await prepara({ app, openTab, testServer }, `<!doctype html><title>X</title><iframe id="fr" src="${dentro}"></iframe>`);
  await page.frameLocator('#fr').locator('#i').click();
  await page.keyboard.type('scrivo');
  await premi(app, 'Left', ['meta']);
  await page.waitForTimeout(1_200);
  expect(page.url()).toBe(urlB);
});

test('riquadro di altra origine senza campo: Cmd+← torna indietro', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html('<!doctype html><p id="p" style="height:100px">video</p>', { pubblico: true });
  const { page, urlA } = await prepara({ app, openTab, testServer }, `<!doctype html><title>X</title><iframe id="fr" src="${dentro}"></iframe>`);
  await page.frameLocator('#fr').locator('#p').click();
  await premi(app, 'Left', ['meta']);
  await page.waitForURL(urlA, { timeout: 8_000 });
});

test('Cmd+→ dopo essere tornati, poi Cmd+← due volte di fila', async ({ app, openTab, testServer }) => {
  const { page, urlA, urlB } = await prepara({ app, openTab, testServer }, '<!doctype html><title>B</title><h1 id="b">B</h1>');
  await page.locator('#b').click();
  await premi(app, 'Left', ['meta']);
  await page.waitForURL(urlA, { timeout: 8_000 });
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
  await premi(app, 'Right', ['meta']);
  await page.waitForURL(urlB, { timeout: 8_000 });
});
