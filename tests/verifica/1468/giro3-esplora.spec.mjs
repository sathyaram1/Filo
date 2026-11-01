// Esplorazione del giro 3 di #1468: incognito, tasti, attese, tempo in vista.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strade = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const out = {};
  for (const ora of Object.values(s.ore || {})) {
    if (!ora.strade) continue;
    for (const [m, conti] of Object.entries(ora.strade)) {
      for (const [k, n] of Object.entries(conti || {})) (out[m] = out[m] || {})[k] = ((out[m] || {})[k] || 0) + n;
    }
  }
  return out;
});
const voce = async (app, m, k) => ((await strade(app))[m] || {})[k] || 0;
const premiSu = (app, inc, keyCode, modifiers = []) => app.evaluate(({ BrowserWindow }, [i, kc, mod]) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !!x._filoIncognito === i);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: kc, modifiers: mod });
  t.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: kc, modifiers: mod });
}, [inc, keyCode, modifiers]);
const attiva = (app) => app.evaluate(({ BrowserWindow }) => {
  const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
  const a = t.tabs.find((x) => x.id === t.activeId);
  return { id: t.activeId, url: a ? a.url : '', n: t.tabs.length };
});

test('incognito: tasti e tasto destro non contano', async ({ app, openTab, testServer }) => {
  const url = testServer.html('<title>INC</title><p id="p" style="padding:40px">testo da cliccare</p>');
  const home = await openTab('filo://history/history.html');
  await home.evaluate(() => chrome.runtime.sendMessage({ type: 'open_incognito' }));
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoIncognito && w._filoTabs))).toBe(true);
  await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs)._filoTabs;
    tm.openTab(u);
  }, url);
  let pag = null;
  await expect.poll(() => { pag = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } }); return !!pag; }).toBe(true);
  await pag.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 10000 });
  const prima = await strade(app);
  await premiSu(app, true, 'J', ['control']);
  await premiSu(app, true, 'F5');
  await pag.locator('#p').click({ button: 'right' });
  await expect(menuDi(pag).locator('.sn-menu').first()).toBeVisible();
  await pag.keyboard.press('Escape');
  await pag.keyboard.down('Shift');
  await pag.locator('#p').click({ button: 'right' });
  await pag.keyboard.up('Shift');
  await sleep(1500);
  expect(await strade(app)).toEqual(prima);
});

test('Alt+Freccia sinistra in una pagina conta una volta', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<title>A</title><h1>a</h1>');
  const b = testServer.html('<title>B</title><h1>b</h1>');
  const page = await openTab(a);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await page.evaluate((u) => { location.href = u; }, b);
  await page.waitForURL(b);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await premiSu(app, false, 'Left', ['alt']);
  await expect.poll(() => attiva(app).then((x) => x.url)).toBe(a);
  await sleep(800);
  const s = await strade(app);
  console.log(JSON.stringify(s));
  expect(s.tasto_da_browser?.alt_freccia).toBe(1);
  expect(s.navigazione_cronologia?.['indietro:alt_freccia']).toBe(1);
  expect(s.via_azione?.['back:scorciatoia']).toBe(1);
});

test('Ctrl+L poi scrivere nella home: niente aspettativa mancata', async ({ app, openTab, testServer }) => {
  const sito = await openTab(testServer.html('<title>DUE</title><h1 id="ok">2</h1>'));
  await sito.waitForSelector('#ok');
  await premiSu(app, false, 'L', ['control']);
  await expect.poll(() => attiva(app).then((a) => a.url)).toMatch(/^filo:\/\/newtab\//);
  await sleep(800);
  for (const c of ['C', 'I', 'A']) await premiSu(app, false, c);
  await sleep(300);
  await premiSu(app, false, 'Tab', ['control']);
  await sleep(1200);
  const s = await strade(app);
  console.log(JSON.stringify(s));
  expect(s.tasto_da_browser?.['aspettativa_mancata:ctrl_l'] || 0).toBe(0);
});

test('Ctrl+Shift+T e poi un collegamento nella riaperta: chiusa subito non è mancata', async ({ app, openTab, testServer }) => {
  const dopo = testServer.html('<title>DOPO</title><h1 id="d">d</h1>');
  const url = testServer.html(`<title>UNO</title><a id="l" href="${dopo}">vai</a>`);
  await openTab(testServer.html('<title>RESTA</title><h1>r</h1>'));
  const page = await openTab(url);
  await page.waitForSelector('#l');
  await premiSu(app, false, 'W', ['control']);
  await sleep(500);
  await premiSu(app, false, 'T', ['control', 'shift']);
  await expect.poll(() => attiva(app).then((a) => a.url)).toBe(url);
  let riap = null;
  await expect.poll(() => { riap = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } }); return !!riap; }).toBe(true);
  await riap.waitForSelector('#l');
  await riap.locator('#l').click();
  await expect.poll(() => attiva(app).then((a) => a.url)).toBe(dopo);
  await premiSu(app, false, 'W', ['control']);
  await sleep(1200);
  const s = await strade(app);
  console.log(JSON.stringify(s));
  expect(s.tasto_da_browser?.['aspettativa_mancata:ctrl_shift_t'] || 0).toBe(0);
});

test('zoom con la scorciatoia e con il menu della barra', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html('<title>Z</title><h1 id="z">z</h1>'));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await premiSu(app, false, 'Plus', ['control']);
  await premiSu(app, false, '0', ['control']);
  await sleep(1000);
  const s = await strade(app);
  console.log(JSON.stringify(s));
  expect(s.via_azione?.['zoom_piu:scorciatoia']).toBe(1);
  expect(s.via_azione?.['zoom_reset:scorciatoia']).toBe(1);
});
