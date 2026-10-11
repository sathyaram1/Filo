// #685.1 giro 7 — la pagina sposta il fuoco su un contenitore che racchiude il campo: lì non si scrive più,
// e Cmd+freccia (Mac) e Ctrl+Z devono tornare indietro. Mac simulato nel main.

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

const CASI = {
  'ricerca, Invio, la pagina dà il fuoco al contenitore principale': ['<!doctype html><title>B</title><main id="m" tabindex="-1"><h1>B</h1><form><input id="c"></form><div id="res"></div></main>'
    + '<script>c.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); res.textContent = "risultati"; m.focus(); } });</script>', async (page) => {
    await page.locator('#c').click(); await page.keyboard.type('gatti'); await page.keyboard.press('Enter');
  }],
  'commento, Invio, la pagina dà il fuoco alla scheda del commento': ['<!doctype html><title>B</title><section id="w" tabindex="-1"><h1>B</h1><div id="ed" contenteditable>x</div></section>'
    + '<script>ed.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); w.focus(); } });</script>', async (page) => {
    await page.locator('#ed').click(); await page.keyboard.type('ciao'); await page.keyboard.press('Enter');
  }],
};

for (const [nome, [html, passi]] of Object.entries(CASI)) {
  for (const [tasto, mod, mac] of [['Left', ['meta'], true], ['Z', ['control'], false]]) {
    test(`r1 ${nome}: ${mac ? 'Cmd+freccia sinistra' : 'Ctrl+Z'} torna indietro`, async ({ app, openTab, testServer }) => {
      const { page, a } = await daAaB(app, openTab, testServer, html, mac);
      await passi(page);
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => /^(MAIN|SECTION)$/.test(document.activeElement.tagName))).toBe(true);
      await premi(app, 'tab', tasto, mod);
      await expect.poll(() => urlAttiva(app), { timeout: 6_000 }).toBe(a);
    });
  }
}
