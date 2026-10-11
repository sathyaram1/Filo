// #685.1 giro 8, rilievo 1 — dentro un'ombra chiusa il componente sposta il fuoco dal campo al suo contenitore:
// lì non si scrive più, ma Filo lo crede ancora. Mac simulato nel main.

import { test, expect } from '../../fixtures/electron.mjs';
import { premi } from '../../helpers/barra.mjs';

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

async function daAaB(app, openTab, testServer, htmlB, mac) {
  const a = testServer.html('<!doctype html><title>A</title><h1 id="a">A</h1>');
  const b = testServer.html(htmlB);
  const page = await openTab(a);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await vai(app, b);
  await expect.poll(() => urlAttiva(app), { timeout: 10_000 }).toBe(b);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  if (mac) await diventaMac(app);
  return { page, a, b };
}
async function restaSu(app, url) {
  await new Promise((r) => setTimeout(r, 1200));
  expect(await urlAttiva(app)).toBe(url);
}

// Dentro l'ombra chiusa, all'Invio il componente dà il fuoco al suo contenitore dei risultati: lì non si scrive più.
const FUOCO_DENTRO = '<!doctype html><title>B</title><div id="h"></div><script>window.__r = h.attachShadow({mode:"closed"});'
  + '__r.innerHTML = "<section tabindex=-1><input></section>"; const i = __r.querySelector("input");'
  + 'i.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); __r.querySelector("section").focus(); } });'
  + 'window.__f = () => i; window.__dove = () => __r.activeElement && __r.activeElement.tagName;</script>';
for (const [sis, tasto, mod, mac] of [['Mac Cmd+freccia', 'Left', ['meta'], true], ['Ctrl+Z', 'Z', ['control'], false]]) {
  test(`r1 ombra chiusa, fuoco passato al contenitore dopo l'Invio: ${sis} torna indietro`, async ({ app, openTab, testServer }) => {
    const { page, a } = await daAaB(app, openTab, testServer, FUOCO_DENTRO, mac);
    await page.evaluate(() => window.__f().focus());
    await page.keyboard.type('gatti');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window.__dove())).toBe('SECTION');
    await premi(app, 'tab', tasto, mod);
    await expect.poll(() => urlAttiva(app), { timeout: 8_000 }).toBe(a);
  });
}
