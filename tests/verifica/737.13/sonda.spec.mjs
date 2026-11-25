// Sonde del giro 1 di #737.13: il «riportala davanti» chiesto dalla pagina che tiene la finestra.
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => {
    try { return { id: t.id, url: t.view.webContents.getURL(), titolo: t.view.webContents.getTitle(), attiva: t.id === tm.activeId }; } catch (_) { return { id: t.id, url: '', titolo: '', attiva: false }; }
  });
});
const davanti = (app, u) => app.evaluate(({ BrowserWindow }, url) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  tm.activate(tm.tabs.find((x) => x.view.webContents.getURL() === url).id);
}, u);
const attiva = async (app) => (await schede(app)).find((s) => s.attiva)?.titolo;

async function giro(app, page, primo, secondo, atteso) {
  await primo();
  await expect.poll(async () => (await schede(app)).find((s) => s.titolo === atteso)?.attiva, { timeout: 8000 }).toBe(true);
  await davanti(app, page.url());
  await page.waitForTimeout(400);
  await secondo();
  await expect.poll(() => attiva(app), { timeout: 6000 }).toBe(atteso);
}

test('A pagamento su un altro sito aperto poco dopo il clic (dopo una risposta del negozio): «paga» di nuovo lo riporta davanti', async ({ app, openTab, testServer }) => {
  const dest = testServer.html('<title>PAGAMENTO</title>', { pubblico: true });
  const page = await openTab(testServer.html(`<title>NEGOZIO</title><script>var w=null;function paga(){if(w&&!w.closed){w.focus();return;}
    setTimeout(function(){w=window.open(${JSON.stringify(dest)},'pagamento')},300);}</script>
    <button id="a" style="width:200px;height:60px" onclick="paga()">Paga</button>`));
  await giro(app, page, () => page.click('#a'), () => page.click('#a'), 'PAGAMENTO');
});

test('B aiuto dello stesso sito riportato davanti poco dopo il clic', async ({ app, openTab, testServer }) => {
  const dest = testServer.html('<title>AIUTO</title>');
  const page = await openTab(testServer.html(`<title>ELENCO</title><script>var w=null;function aiuto(){if(w&&!w.closed){setTimeout(function(){w.focus()},100);return;}
    w=window.open(${JSON.stringify(dest)},'aiuto');}</script>
    <button id="a" style="width:200px;height:60px" onclick="aiuto()">Aiuto</button>`));
  await giro(app, page, () => page.click('#a'), () => page.click('#a'), 'AIUTO');
});

test('C pulsante fatto di un riquadro con la scritta dentro: «paga» di nuovo, cliccato sulla scritta, riporta davanti il pagamento', async ({ app, openTab, testServer }) => {
  const dest = testServer.html('<title>PAGAMENTO</title>', { pubblico: true });
  const page = await openTab(testServer.html(`<title>NEGOZIO</title>
    <div id="a" class="btn" style="width:240px;height:60px;padding:20px;background:#c84"><span id="s">Paga ora</span></div>
    <script>var w=null;document.getElementById('a').addEventListener('click',function(){if(w&&!w.closed)w.focus();else w=window.open(${JSON.stringify(dest)},'pagamento');});</script>`));
  await giro(app, page, () => page.click('#a', { position: { x: 5, y: 5 } }), () => page.click('#s'), 'PAGAMENTO');
});
