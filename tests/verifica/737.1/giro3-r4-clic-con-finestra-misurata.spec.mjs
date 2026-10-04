// Verifica #737.1 giro 3, rilievo 4: col blocco acceso il clic dell'utente apre anche la finestra con le misure e il Maiuscolo+clic.
import { test, expect } from '../../fixtures/electron.mjs';

const aperteSu = (app, u) => app.evaluate(({ BrowserWindow }, x) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.filter((t) => { try { return t.view.webContents.getURL().replace(/\?$/, '') === x; } catch (_) { return false; } }).length;
}, u);

test('il clic su «Condividi» che chiede una finestra con le misure la apre', async ({ app, openTab, testServer }) => {
  const bersaglio = testServer.html('<title>CONDIVIDI</title>');
  const page = await openTab(testServer.html(`<button id="b" style="width:200px;height:60px"
    onclick="window.open(${JSON.stringify(bersaglio).replace(/"/g, '&quot;')}, 'share', 'width=600,height=400')">Condividi</button>`));
  await page.click('#b');
  await expect.poll(() => aperteSu(app, bersaglio), { timeout: 8000 }).toBe(1);
});

test('Maiuscolo+clic su un link lo apre', async ({ app, openTab, testServer }) => {
  const bersaglio = testServer.html('<title>LINK</title>');
  const page = await openTab(testServer.html(`<a id="l" href="${bersaglio}" style="font-size:40px">link</a>`));
  await page.click('#l', { modifiers: ['Shift'] });
  await expect.poll(() => aperteSu(app, bersaglio), { timeout: 8000 }).toBe(1);
});
