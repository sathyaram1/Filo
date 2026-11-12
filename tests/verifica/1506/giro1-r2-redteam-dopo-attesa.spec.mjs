// Verifica #1506 giro 1, rilievo 2: «Invia attacco» del Red-team su una pagina web apre la pagina del tentativo
// dopo la risposta del server; se questa arriva oltre la finestra del gesto, la pagina di Filo non si apre più.
import { test, expect } from '../../fixtures/electron.mjs';

test('r2 la pagina del tentativo si apre anche se il server risponde dopo qualche secondo', async ({ app, openTab, testServer }) => {
  const sito = testServer.html('<title>Pagina</title><button id="b" style="width:200px;height:60px">Invia</button>', { pubblico: true });
  const page = await openTab(sito);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  const MSG = await app.evaluate(() => globalThis.SN_MSG.MSG);
  // Il clic su «Invia» del pannello, poi l'attesa del server (callable redteamSubmit), poi l'apertura come in redteamAttack.js.
  await page.click('#b');
  await new Promise((r) => setTimeout(r, 6000));
  const url = 'filo://redteam/redteam.html?attempt=prova';
  const r = await app.evaluate(async ({ BrowserWindow }, [u, m]) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const t = tm.tabs.find((x) => x.view.webContents.getURL() === u);
    return t.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `chrome.runtime.sendMessage(${JSON.stringify(m)})` }]);
  }, [sito, { type: MSG.OPEN_URL, url }]);
  expect(r && r.ok, JSON.stringify(r)).toBe(true);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs
    .some((t) => t.view.webContents.getURL().startsWith('filo://redteam/'))), { timeout: 8000 }).toBe(true);
});
