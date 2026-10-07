// #685.1 giro 3 — esplorazione: Cmd+freccia su Mac in riquadri d'altra origine, pagina d'errore, PDF, pressioni rapide.
import { readFileSync } from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';

function premi(app, keyCode, modifiers) {
  return app.evaluate(({ BrowserWindow }, arg) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: arg.keyCode, modifiers: arg.modifiers });
    t.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: arg.keyCode, modifiers: arg.modifiers });
  }, { keyCode, modifiers });
}
const urlAttiva = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return t.view.webContents.getURL();
});
const diventaMac = (app) => app.evaluate(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
});
async function vai(page, url) {
  await page.evaluate((u) => { window.location.href = u; }, url);
  await page.waitForURL(url, { timeout: 10_000 });
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
}
const A = '<!doctype html><title>A</title><h1 id="a">pagina A</h1>';

async function prepara({ app, openTab, testServer }, htmlB) {
  const urlA = testServer.html(A);
  const urlB = testServer.html(htmlB);
  const page = await testServer.openReady(openTab, A);
  await vai(page, urlA);
  await vai(page, urlB);
  await diventaMac(app);
  return { page, urlA, urlB };
}

test('riquadro d\'altra origine, fuoco su un pulsante: Cmd+← torna indietro', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html('<!doctype html><button id=b>play</button>', { pubblico: true });
  const { page, urlA } = await prepara({ app, openTab, testServer }, `<!doctype html><h1>B</h1><iframe id=fr src="${dentro}"></iframe>`);
  await page.frameLocator('#fr').locator('#b').click();
  await page.waitForTimeout(500);
  await premi(app, 'Left', ['meta']);
  await expect.poll(() => urlAttiva(app), { timeout: 5_000 }).toBe(urlA);
});

test('riquadro d\'altra origine, si scrive: Cmd+← resta', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html('<!doctype html><input id=i>', { pubblico: true });
  const { page, urlB } = await prepara({ app, openTab, testServer }, `<!doctype html><h1>B</h1><iframe id=fr src="${dentro}"></iframe>`);
  await page.frameLocator('#fr').locator('#i').click();
  await page.keyboard.type('ciao');
  await premi(app, 'Left', ['meta']);
  await page.waitForTimeout(1_200);
  expect(await urlAttiva(app)).toBe(urlB);
});

test('pagina d\'errore: Cmd+← torna alla pagina di prima', async ({ app, openTab, testServer }) => {
  const { page, urlB } = await prepara({ app, openTab, testServer }, '<!doctype html><h1>B</h1>');
  await page.evaluate(() => { window.location.href = 'http://127.0.0.1:9/'; });
  await expect.poll(() => urlAttiva(app), { timeout: 10_000 }).toMatch(/^filo:/);
  await page.waitForTimeout(1_500);
  await premi(app, 'Left', ['meta']);
  await expect.poll(() => urlAttiva(app), { timeout: 6_000 }).toBe(urlB);
});

test('PDF: Cmd+← torna alla pagina di prima', async ({ app, openTab, testServer }) => {
  const pdf = testServer.asset(readFileSync(new URL('../../fixtures/documenti/documento-con-testo.pdf', import.meta.url)), 'application/pdf');
  const { page, urlB } = await prepara({ app, openTab, testServer }, '<!doctype html><h1>B</h1>');
  await page.evaluate((u) => { window.location.href = u; }, pdf);
  await expect.poll(() => urlAttiva(app), { timeout: 10_000 }).toBe(pdf);
  await page.waitForTimeout(2_500);
  await premi(app, 'Left', ['meta']);
  await expect.poll(() => urlAttiva(app), { timeout: 6_000 }).toBe(urlB);
});

test('due Cmd+← di fila tornano indietro di due pagine, come Cmd+[', async ({ app, openTab, testServer }) => {
  const { page, urlA, urlB } = await prepara({ app, openTab, testServer }, '<!doctype html><h1>B</h1>');
  const urlC = testServer.html('<!doctype html><h1 id=c>C</h1>');
  await vai(page, urlC);
  await page.locator('#c').click();
  await premi(app, 'Left', ['meta']);
  await premi(app, 'Left', ['meta']);
  await page.waitForTimeout(2_500);
  const conFreccia = await urlAttiva(app);
  await vai(page, urlB); await vai(page, urlC);
  await page.locator('#c').click();
  await premi(app, 'BracketLeft', ['meta']);
  await premi(app, 'BracketLeft', ['meta']);
  await page.waitForTimeout(2_500);
  const conQuadra = await urlAttiva(app);
  console.log('freccia', conFreccia, 'quadra', conQuadra, 'A', urlA, 'B', urlB);
  expect(conFreccia).toBe(conQuadra);
});
