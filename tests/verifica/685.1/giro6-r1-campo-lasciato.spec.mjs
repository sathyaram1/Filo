// #685.1 giro 6, rilievo 1 — un campo che la pagina lascia da sé (invio di una ricerca) non è più «si sta scrivendo»:
// Cmd+freccia su Mac e Ctrl+Z tornano indietro. Mac simulato nel main.

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

for (const [nome, tasto, mod, mac] of [['Cmd+freccia sinistra su Mac', 'Left', ['meta'], true], ['Ctrl+Z', 'Z', ['control'], false]]) {
  test(`r1 campo lasciato dalla pagina dopo la ricerca: ${nome} torna indietro`, async ({ app, openTab, testServer }) => {
    const { page, a } = await daAaB(app, openTab, testServer, '<!doctype html><title>B</title><h1 id="b">B</h1><input id="cerca">'
      + '<script>document.getElementById("cerca").addEventListener("keydown", e => { if (e.key === "Enter") e.target.blur(); });</script>');
    if (!mac) await app.evaluate(() => { Object.defineProperty(process, 'platform', { value: 'linux', configurable: true }); });
    await page.locator('#cerca').click();
    await page.keyboard.type('gatti');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    await page.waitForTimeout(300);
    await premi(app, 'tab', tasto, mod);
    await expect.poll(() => urlAttiva(app), { timeout: 8_000 }).toBe(a);
  });
}
