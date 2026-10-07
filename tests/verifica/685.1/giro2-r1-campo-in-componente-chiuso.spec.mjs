// #685.1 giro 2 — un campo dentro un componente a shadow DOM chiuso: si scrive, ma Filo non lo vede.
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
const CHIUSO = '<!doctype html><title>C</title><x-campo id="c"></x-campo><script>'
  + 'customElements.define("x-campo", class extends HTMLElement { constructor() { super();'
  + ' const r = this.attachShadow({ mode: "closed" }); r.innerHTML = "<input id=i style=width:300px>"; } });</script>';

async function prepara({ openTab, testServer }) {
  const urlA = testServer.html(A);
  const urlB = testServer.html(CHIUSO);
  const page = await testServer.openReady(openTab, A);
  await vai(page, urlA);
  await vai(page, urlB);
  await page.locator('#c').click();
  await page.keyboard.type('scrivo qui');
  return { page, urlB };
}

test('r1 su Mac Cmd+← mentre si scrive in un componente chiuso non porta via la pagina', async ({ app, openTab, testServer }) => {
  const { page, urlB } = await prepara({ openTab, testServer });
  await diventaMac(app);
  await premi(app, 'Left', ['meta']);
  await page.waitForTimeout(1_200);
  expect(page.url()).toBe(urlB);
});

test('r1 Ctrl+Z mentre si scrive in un componente chiuso annulla e non porta via la pagina', async ({ openTab, testServer }) => {
  const { page, urlB } = await prepara({ openTab, testServer });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1_200);
  expect(page.url()).toBe(urlB);
});
