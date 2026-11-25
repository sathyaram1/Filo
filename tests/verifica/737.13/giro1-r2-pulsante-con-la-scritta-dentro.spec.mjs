// #737.13 giro 1, rilievo 2: «paga» premuto di nuovo vale solo se il clic cade sullo stesso pezzo del pulsante.
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => {
    try { return { url: t.view.webContents.getURL(), titolo: t.view.webContents.getTitle(), attiva: t.id === tm.activeId }; } catch (_) { return { url: '', titolo: '', attiva: false }; }
  });
});

test('r2 pulsante fatto di un riquadro con la scritta dentro: premuto prima sul bordo e poi sulla scritta riporta davanti il pagamento', async ({ app, openTab, testServer }) => {
  const dest = testServer.html('<title>PAGAMENTO</title>', { pubblico: true });
  const page = await openTab(testServer.html(`<title>NEGOZIO</title>
    <div id="a" class="btn" style="width:240px;height:60px;padding:20px;background:#c84"><span id="s">Paga ora</span></div>
    <script>var w=null;document.getElementById('a').addEventListener('click',function(){if(w&&!w.closed)w.focus();else w=window.open(${JSON.stringify(dest)},'pagamento');});</script>`));
  await page.click('#a', { position: { x: 5, y: 5 } });
  await expect.poll(async () => (await schede(app)).find((s) => s.titolo === 'PAGAMENTO')?.attiva, { timeout: 8000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }, url) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.activate(tm.tabs.find((x) => x.view.webContents.getURL() === url).id);
  }, page.url());
  await page.waitForTimeout(400);
  await page.click('#s');
  await expect.poll(async () => (await schede(app)).find((s) => s.attiva)?.titolo, { timeout: 6000 }).toBe('PAGAMENTO');
});
