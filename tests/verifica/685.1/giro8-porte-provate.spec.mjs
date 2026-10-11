// #685.1 giro 8 — porte provate e chiuse: campi in ombre chiuse di forme diverse (textarea, riquadro modificabile,
// ombra chiusa dentro un'ombra aperta, due ombre chiuse annidate). Mac simulato nel main.

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

const CAMPI = {
  'textarea in ombra chiusa': '<div id="h"></div><script>window.__r = h.attachShadow({mode:"closed"}); __r.innerHTML = "<textarea></textarea>"; window.__f = () => __r.querySelector("textarea");</script>',
  'riquadro modificabile in ombra chiusa': '<div id="h"></div><script>window.__r = h.attachShadow({mode:"closed"}); __r.innerHTML = "<div contenteditable style=\'min-height:40px\'>x</div>"; window.__f = () => __r.querySelector("div");</script>',
  'ombra chiusa dentro un\'ombra aperta': '<x-app id="h"></x-app><script>const o = h.attachShadow({mode:"open"}); o.innerHTML = "<p>t</p><div id=k></div>"; window.__r = o.getElementById("k").attachShadow({mode:"closed"}); __r.innerHTML = "<input>"; window.__f = () => __r.querySelector("input");</script>',
  'due ombre chiuse annidate': '<div id="h"></div><script>const o = h.attachShadow({mode:"closed"}); o.innerHTML = "<span></span><div></div>"; window.__r = o.querySelector("div").attachShadow({mode:"closed"}); __r.innerHTML = "<input>"; window.__f = () => __r.querySelector("input");</script>',
};
for (const [nome, corpo] of Object.entries(CAMPI)) {
  for (const [sis, tasto, mod, mac] of [['Mac Cmd+freccia', 'Left', ['meta'], true], ['Ctrl+Z', 'Z', ['control'], false]]) {
    test(`${nome}: ${sis} mentre si scrive resta`, async ({ app, openTab, testServer }) => {
      const { page, b } = await daAaB(app, openTab, testServer, '<!doctype html><title>B</title>' + corpo, mac);
      await page.evaluate(() => window.__f().focus());
      await page.keyboard.type('riga');
      await page.waitForTimeout(300);
      await premi(app, 'tab', tasto, mod);
      await restaSu(app, b);
    });
  }
}

