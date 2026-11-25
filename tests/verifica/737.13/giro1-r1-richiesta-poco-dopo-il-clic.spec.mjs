// #737.13 giro 1, rilievo 1: la richiesta della pagina conta solo se arriva mentre il clic è ancora in corso.
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => {
    try { return { url: t.view.webContents.getURL(), titolo: t.view.webContents.getTitle(), attiva: t.id === tm.activeId }; } catch (_) { return { url: '', titolo: '', attiva: false }; }
  });
});
const davanti = (app, u) => app.evaluate(({ BrowserWindow }, url) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  tm.activate(tm.tabs.find((x) => x.view.webContents.getURL() === url).id);
}, u);
const attiva = async (app) => (await schede(app)).find((s) => s.attiva)?.titolo;

async function dueVolte(app, page, atteso) {
  await page.click('#a');
  await expect.poll(async () => (await schede(app)).find((s) => s.titolo === atteso)?.attiva, { timeout: 8000 }).toBe(true);
  await davanti(app, page.url());
  await page.waitForTimeout(400);
  await page.click('#a');
  await expect.poll(() => attiva(app), { timeout: 6000 }).toBe(atteso);
}

test('r1 l\'aiuto dello stesso sito, riportato davanti dalla pagina un attimo dopo il clic, torna davanti', async ({ app, openTab, testServer }) => {
  const dest = testServer.html('<title>AIUTO</title>');
  const page = await openTab(testServer.html(`<title>ELENCO</title><script>var w=null;function aiuto(){if(w&&!w.closed){setTimeout(function(){w.focus()},100);return;}
    w=window.open(${JSON.stringify(dest)},'aiuto');}</script>
    <button id="a" style="width:200px;height:60px" onclick="aiuto()">Aiuto</button>`));
  await dueVolte(app, page, 'AIUTO');
});

test('r1 il pagamento su un altro sito aperto un attimo dopo il clic: «paga» di nuovo lo riporta davanti', async ({ app, openTab, testServer }) => {
  const dest = testServer.html('<title>PAGAMENTO</title>', { pubblico: true });
  const page = await openTab(testServer.html(`<title>NEGOZIO</title><script>var w=null;function paga(){if(w&&!w.closed){w.focus();return;}
    setTimeout(function(){w=window.open(${JSON.stringify(dest)},'pagamento')},300);}</script>
    <button id="a" style="width:200px;height:60px" onclick="paga()">Paga</button>`));
  await dueVolte(app, page, 'PAGAMENTO');
});
