// #737.1 giro 12: la finestra che la pagina tiene ha un nome; un secondo clic che la chiede per nome la riempie dietro
// la scheda che si sta leggendo, e all'utente non succede niente. In un browser la finestra chiesta torna davanti.
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { let ti = ''; try { ti = t.view.webContents.getTitle(); } catch (_) {} return { ti, attiva: t.id === tm.activeId }; });
});
const torna = (app, u) => app.evaluate(({ BrowserWindow }, url) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  tm.activate(tm.tabs.find((t) => t.view.webContents.getURL() === url).id);
}, u);

const FORME = {
  'due collegamenti con target="_new"': (uno, due) => `<a id="a" href="${uno}" target="_new" style="font-size:40px">uno</a><br><a id="b" href="${due}" target="_new" style="font-size:40px">due</a>`,
  'due pulsanti con window.open e lo stesso nome': (uno, due) => `<button id="a" style="width:200px;height:60px" onclick="window.open('${uno}','aiuto','width=500,height=400')">uno</button><button id="b" style="width:200px;height:60px" onclick="window.open('${due}','aiuto','width=500,height=400')">due</button>`,
};

for (const [forma, html] of Object.entries(FORME)) {
  test(`r1 ${forma}: il secondo clic porta davanti la pagina chiesta`, async ({ app, openTab, testServer }) => {
    const uno = testServer.html('<title>PRIMO</title>');
    const due = testServer.html('<title>SECONDO</title>');
    const url = testServer.html(`<title>Elenco</title>${html(uno, due)}`);
    const page = await openTab(url);
    await page.click('#a');
    await expect.poll(async () => (await schede(app)).some((s) => s.ti === 'PRIMO' && s.attiva), { timeout: 8000 }).toBe(true);
    await torna(app, url);
    await page.waitForTimeout(800);
    await page.click('#b');
    await expect.poll(async () => (await schede(app)).find((s) => s.attiva)?.ti, { timeout: 8000 }).toBe('SECONDO');
  });
}
