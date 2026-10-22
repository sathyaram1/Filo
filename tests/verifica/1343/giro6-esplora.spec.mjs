// Esplorazione verifica #1343 giro 6: Condividi della barra sulle pagine interne di Filo. Si cancella.
import { test, expect } from '../../fixtures/electron.mjs';
import { iconaDellaBarra } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const naviga = (app, u) => app.evaluate(({ BrowserWindow }, url) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  w._filoTabs.navigate(w._filoTabs.activeId, url);
}, u);

for (const u of ['controllo', 'filo://newtab/', 'filo://options/options.html', 'filo://history/history.html']) {
  test(`esplora condividi su ${u}`, async ({ app, openTab, testServer }) => {
    const p = await testServer.openReady(openTab, '<!doctype html><title>Prima</title><h1>Prima</h1>');
    if (u !== 'controllo') { await naviga(app, u); await pausa(3000); }
    await app.evaluate(({ clipboard }) => clipboard.writeText('niente'));
    const share = await iconaDellaBarra(app, 'share');
    const dis = await share.getAttribute('aria-disabled');
    await share.click();
    await pausa(2500);
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
    const url = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      return w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents.getURL();
    });
    console.log(`ESPLORA ${u}: disabled=${dis} clip=${clip} url=${url}`);
    expect(true).toBe(true);
  });
}
