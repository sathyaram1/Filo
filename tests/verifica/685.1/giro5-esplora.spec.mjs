// #685.1 giro 5 — su Mac Cmd+← e Cmd+→ vanno indietro e avanti solo quando non si scrive.
// Le porte dei giri passati, ri-provate da capo: tasti veri (before-input-event), Mac simulato nel main.

import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, statoBarra, premi } from '../../helpers/barra.mjs';

const diventaMac = (app) => app.evaluate(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
});
const urlAttiva = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return t.view.webContents.getURL();
});
const vai = (app, u) => app.evaluate(({ BrowserWindow }, u) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  w._filoTabs.navigate(w._filoTabs.activeId, u);
}, u);

async function daAaB(app, openTab, testServer, htmlB) {
  const a = testServer.html('<!doctype html><title>A</title><h1 id="a">A</h1>');
  const b = testServer.html(htmlB);
  const page = await openTab(a);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await vai(app, b);
  await expect.poll(() => urlAttiva(app), { timeout: 10_000 }).toBe(b);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await diventaMac(app);
  return { page, a, b };
}

async function restaSu(app, url) {
  await new Promise((r) => setTimeout(r, 1200));
  expect(await urlAttiva(app)).toBe(url);
}

test('barra laterale aperta da tastiera: Cmd+freccia sinistra torna indietro come Cmd+[', async ({ app, openTab, testServer }) => {
  const { a } = await daAaB(app, openTab, testServer, '<!doctype html><title>B</title><h1>B</h1>');
  await premi(app, 'tab', 'B', ['meta', 'shift']);
  await barraPage(app);
  await expect.poll(async () => (await statoBarra(app)).motivo).toBe('tasto');
  await premi(app, 'barra', 'Left', ['meta']);
  await expect.poll(() => urlAttiva(app), { timeout: 5_000 }).toBe(a);
});

test('pagina d\'errore: Cmd+freccia sinistra torna al sito di prima', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<!doctype html><title>A</title><h1>A</h1>');
  const page = await openTab(a);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await vai(app, 'http://192.168.1.1/x');
  await expect.poll(() => urlAttiva(app), { timeout: 10_000 }).toMatch(/^filo:\/\/error\//);
  await diventaMac(app);
  await new Promise((r) => setTimeout(r, 800));
  await premi(app, 'tab', 'Left', ['meta']);
  await expect.poll(() => urlAttiva(app), { timeout: 8_000 }).toBe(a);
});

test('fuori da un campo: Cmd+freccia sinistra indietro, Cmd+freccia destra avanti', async ({ app, openTab, testServer }) => {
  const { page, a, b } = await daAaB(app, openTab, testServer, '<!doctype html><title>B</title><h1 id="b">B</h1>');
  await page.locator('#b').click();
  await premi(app, 'tab', 'Left', ['meta']);
  await expect.poll(() => urlAttiva(app), { timeout: 8_000 }).toBe(a);
  await new Promise((r) => setTimeout(r, 800));
  await premi(app, 'tab', 'Right', ['meta']);
  await expect.poll(() => urlAttiva(app), { timeout: 8_000 }).toBe(b);
});

test('editor in un riquadro della stessa origine, dopo un clic sul foglio: resta', async ({ app, openTab, testServer }) => {
  const { page, b } = await daAaB(app, openTab, testServer, '<!doctype html><div id="foglio" style="height:200px">foglio</div>'
    + '<iframe id="fr" srcdoc="<div id=ed contenteditable=true style=min-height:40px></div>"></iframe>'
    + '<script>document.getElementById("foglio").addEventListener("mousedown", e => e.preventDefault());</script>');
  await page.frameLocator('#fr').locator('#ed').click();
  await page.keyboard.type('una riga');
  await page.click('#foglio');
  await premi(app, 'tab', 'Left', ['meta']);
  await restaSu(app, b);
});

test('editor in un riquadro d\'altra origine: resta', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html('<!doctype html><textarea id="t"></textarea>', { pubblico: true });
  const { page, b } = await daAaB(app, openTab, testServer, `<!doctype html><h1>B</h1><iframe id="fr" src="${dentro}"></iframe>`);
  await page.frameLocator('#fr').locator('#t').click();
  await page.keyboard.type('una riga');
  await premi(app, 'tab', 'Left', ['meta']);
  await restaSu(app, b);
});

test('riquadro in designMode (editor classici): resta', async ({ app, openTab, testServer }) => {
  const { page, b } = await daAaB(app, openTab, testServer, '<!doctype html><h1>B</h1><iframe id="fr" srcdoc="<body>testo</body>"></iframe>'
    + '<script>const f=document.getElementById("fr");f.addEventListener("load",()=>{f.contentDocument.designMode="on";});</script>');
  await page.waitForTimeout(500);
  await page.frameLocator('#fr').locator('body').click();
  await page.keyboard.type('una riga');
  expect(await page.frameLocator('#fr').locator('body').textContent()).toContain('una riga');
  await premi(app, 'tab', 'Left', ['meta']);
  await restaSu(app, b);
});

test('riquadro modificabile «solo testo»: resta', async ({ app, openTab, testServer }) => {
  const { page, b } = await daAaB(app, openTab, testServer, '<!doctype html><div id="ed" contenteditable="plaintext-only" style="min-height:40px"></div>');
  await page.locator('#ed').click();
  await page.keyboard.type('una riga');
  await premi(app, 'tab', 'Left', ['meta']);
  await restaSu(app, b);
});

test('campo in un componente chiuso: resta', async ({ app, openTab, testServer }) => {
  const { page, b } = await daAaB(app, openTab, testServer, '<!doctype html><x-campo id="c"></x-campo><script>'
    + 'customElements.define("x-campo", class extends HTMLElement { constructor() { super();'
    + ' this.attachShadow({ mode: "closed" }).innerHTML = "<input style=width:300px>"; } });</script>');
  await page.locator('#c').click();
  await page.keyboard.type('scrivo');
  await premi(app, 'tab', 'Left', ['meta']);
  await restaSu(app, b);
});

test('la pagina usa Cmd+freccia per sé: vince la pagina', async ({ app, openTab, testServer }) => {
  const { page, b } = await daAaB(app, openTab, testServer, '<!doctype html><h1 id="b">B</h1><script>window.__n=0;'
    + 'addEventListener("keydown", e => { if (e.metaKey && e.key === "ArrowLeft") { e.preventDefault(); window.__n++; } });</script>');
  await page.locator('#b').click();
  await premi(app, 'tab', 'Left', ['meta']);
  await restaSu(app, b);
  expect(await page.evaluate(() => window.__n)).toBe(1);
});

test('pagine di Filo: Cmd+freccia sinistra torna indietro, e non dentro il campo della home', async ({ app, openTab }) => {
  const page = await openTab('filo://history/');
  await vai(app, 'filo://downloads/');
  await expect.poll(() => urlAttiva(app), { timeout: 10_000 }).toMatch(/^filo:\/\/downloads/);
  await diventaMac(app);
  await new Promise((r) => setTimeout(r, 1500));
  await premi(app, 'tab', 'Left', ['meta']);
  await expect.poll(() => urlAttiva(app), { timeout: 8_000 }).toMatch(/^filo:\/\/history/);
});

test('barra degli indirizzi a fuoco: Cmd+freccia sinistra non porta via la pagina', async ({ app, shell, openTab, testServer }) => {
  const { b } = await daAaB(app, openTab, testServer, '<!doctype html><title>B</title><h1>B</h1>');
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); w.webContents.focus(); });
  const campo = await shell.evaluateHandle(() => {
    const el = document.querySelector('input#url, input[type="text"], input:not([type])');
    el.focus();
    return el;
  });
  expect(await campo.evaluate((el) => document.activeElement === el)).toBe(true);
  await premi(app, 'shell', 'Left', ['meta']);
  await restaSu(app, b);
});
