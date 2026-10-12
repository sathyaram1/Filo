// #685.1 giro 6 — porte ri-provate e nuove porte provate, tutte chiuse: barra laterale, conferma scritta,
// riquadri d'altra origine, nessuna pagina precedente. Mac simulato nel main.

import { test, expect } from '../../fixtures/electron.mjs';
import { premi, barraPage, statoBarra } from '../../helpers/barra.mjs';

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

test('barra laterale da tastiera: Cmd+freccia sinistra indietro, poi Cmd+freccia destra avanti', async ({ app, openTab, testServer }) => {
  const { a, b } = await daAaB(app, openTab, testServer, '<!doctype html><title>B</title><h1 id="b">B</h1>');
  await premi(app, 'tab', 'B', ['meta', 'shift']);
  await barraPage(app);
  await expect.poll(async () => (await statoBarra(app)).motivo).toBe('tasto');
  await new Promise((r) => setTimeout(r, 500));
  await premi(app, 'barra', 'Left', ['meta']);
  await expect.poll(() => urlAttiva(app), { timeout: 8_000 }).toBe(a);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(false);
  await new Promise((r) => setTimeout(r, 800));
  await premi(app, 'tab', 'B', ['meta', 'shift']);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await new Promise((r) => setTimeout(r, 500));
  await premi(app, 'barra', 'Right', ['meta']);
  await expect.poll(() => urlAttiva(app), { timeout: 8_000 }).toBe(b);
});

for (const [nome, tasto, mod, mac] of [['Cmd+freccia sinistra su Mac', 'Left', ['meta'], true], ['Ctrl+Z', 'Z', ['control'], false]]) {
  test(`conferma scritta: ${nome} mentre si scrive la parola non porta via la pagina`, async ({ app, openTab, testServer }) => {
    const a = testServer.html('<!doctype html><title>A</title><h1>A</h1>');
    const p0 = await openTab(a);
    await p0.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
    await vai(app, 'filo://newtab/');
    await expect.poll(() => urlAttiva(app), { timeout: 10_000 }).toMatch(/^filo:\/\/newtab/);
    const home = await urlAttiva(app);
    const page = app.windows().find((w) => w.url() === home);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(800);
    if (mac) await diventaMac(app);
    await page.evaluate(() => { window.SN_CONFIRM_UI.confirmTyped({ title: 'Eliminazione', text: 'Eliminare tutto.' }); });
    await expect.poll(() => page.evaluate(() => !!window.SN_CONFIRM_UI._test.state())).toBe(true);
    await page.waitForTimeout(300);
    await page.keyboard.type('conf');
    await premi(app, 'tab', tasto, mod);
    await restaSu(app, home);
    expect(await page.evaluate(() => !!window.SN_CONFIRM_UI._test.state())).toBe(true);
  });
}

test('senza pagina precedente Cmd+freccia sinistra non fa niente, e la scheda resta viva', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<!doctype html><title>A</title><h1 id="a">A</h1>');
  const page = await openTab(a);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await diventaMac(app);
  await page.locator('#a').click();
  await premi(app, 'tab', 'Left', ['meta']);
  await premi(app, 'tab', 'Right', ['meta']);
  await restaSu(app, a);
  const b = testServer.html('<!doctype html><title>B</title><h1 id="b">B</h1>');
  await vai(app, b);
  await expect.poll(() => urlAttiva(app), { timeout: 10_000 }).toBe(b);
  await new Promise((r) => setTimeout(r, 800));
  await premi(app, 'tab', 'Left', ['meta']);
  await expect.poll(() => urlAttiva(app), { timeout: 8_000 }).toBe(a);
});

test('pagina intera in designMode: Cmd+freccia sinistra resta', async ({ app, openTab, testServer }) => {
  const { page, b } = await daAaB(app, openTab, testServer, '<!doctype html><body><p id="p">testo</p><script>document.designMode="on"</script></body>');
  await page.locator('#p').click();
  await page.keyboard.type('xx');
  await premi(app, 'tab', 'Left', ['meta']);
  await restaSu(app, b);
});

// sendInputEvent non arriva a un riquadro d'altra origine: il tasto lo porta Playwright, e il «visto passare» del main si segna a mano.
const tastoNelRiquadro = async (app, page) => {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents._filoCmdFreccia = { verso: 'indietro', t: Date.now() };
  });
  await page.keyboard.press('Meta+ArrowLeft');
};
for (const [nome, corpo, resta] of [
  ['pulsante', '<button id="k">gioca</button>', false],
  ['campo di testo', '<input id="k">', true],
  ['gioco che usa il tasto', '<button id="k">gioca</button><script>addEventListener("keydown", e => { if (e.metaKey && e.key === "ArrowLeft") e.preventDefault(); })</script>', true],
]) {
  test(`riquadro d'altra origine, tasto vero: ${nome}`, async ({ app, openTab, testServer }) => {
    const dentro = testServer.html('<!doctype html>' + corpo, { pubblico: true });
    const { page, a, b } = await daAaB(app, openTab, testServer, `<!doctype html><h1>B</h1><iframe id="fr" src="${dentro}"></iframe>`);
    await page.frameLocator('#fr').locator('#k').click();
    if (resta && nome.startsWith('campo')) await page.keyboard.type('riga');
    await page.waitForTimeout(500);
    await tastoNelRiquadro(app, page);
    if (resta) await restaSu(app, b);
    else await expect.poll(() => urlAttiva(app), { timeout: 8_000 }).toBe(a);
  });
}
