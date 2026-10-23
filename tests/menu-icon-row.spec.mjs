// Il logo di Filo (newTab) fra le icone della barra laterale apre una scheda nuova. La griglia «Altro…» del tasto
// destro che questo file provava non c'è più (#1246): il suo cassetto nella barra è in barra-laterale-azioni-pagina.

import { test, expect } from './fixtures/electron.mjs';
import { premiNellaBarra } from './helpers/barra.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Filo test page</h1>
  <p>Una pagina qualunque.</p>
</body></html>`;

test('click sul logo Filo (newTab) nella barra laterale apre una nuova tab', async ({ openTab, testServer, app, shell }) => {
  await testServer.openReady(openTab, HTML);
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 8000 });
  await premiNellaBarra(app, 'newTab');
  await expect(shell.locator('.tab')).toHaveCount(3, { timeout: 5000 });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId).url;
  }), { message: 'la scheda davanti è la nuova scheda' }).toMatch(/^filo:\/\/newtab\//);
});
