// Esplorazione 3 del giro 3: rilasci ripetuti nella home e in una textarea, con gesti veri. Si cancella.

import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { disponibili, finestraASchermo, sulloSchermo, trascina } from '../../helpers/gestiVeri.mjs';

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);
const idPerUrl = async (shell, url) => (await schede(shell)).find((t) => t.url === url)?.id;
const n = (casa) => casa.evaluate(() => document.getElementById('input')._snGettoni?.schede().length || 0);

async function linguetta(app, shell, id) {
  const r = await shell.locator(`.tab[data-id="${id}"]`).boundingBox();
  const o = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const cb = w.getContentBounds();
    return { x: cb.x, y: cb.y, z: w.webContents.getZoomFactor() || 1 };
  });
  return { x: Math.round(o.x + (r.x + r.width / 2) * o.z), y: Math.round(o.y + (r.y + r.height / 2) * o.z) };
}

test.describe.configure({ retries: 0 });
test.beforeEach(() => { test.skip(!disponibili(), 'niente XTest'); });

test('J cinque rilasci nella home, campo svuotato fra uno e l\'altro', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const u1 = testServer.html('<title>Primo articolo</title><p>uno');
  await openTab(u1);
  const i1 = await idPerUrl(shell, u1);
  const nuova = await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab'));
  const casa = await home(app, { scheda: nuova?.id });
  await finestraASchermo(app);
  await casa.waitForTimeout(1500);
  const log = [];
  for (let k = 0; k < 5; k++) {
    const a = await sulloSchermo(app, casa, casa, '#input');
    const quale = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      return w._filoTabs.tabs.filter((x) => x.view.webContents.getURL().startsWith('filo://newtab')).map((x) => JSON.stringify(x.view.getBounds()));
    });
    trascina(await linguetta(app, shell, i1), a);
    await casa.waitForTimeout(1000);
    const nn = await n(casa);
    log.push({ k, nn, a, quale, att: await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId) === nuova.id });
    await casa.evaluate(() => { const t = document.getElementById('input'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); });
    await casa.waitForTimeout(500);
  }
  console.log('J', JSON.stringify(log, null, 1));
});

test('K cinque rilasci in una textarea', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const u1 = testServer.html('<title>Primo articolo</title><p>uno');
  await openTab(u1);
  const i1 = await idPerUrl(shell, u1);
  const pagina = await openTab(testServer.html('<title>Moduli</title><textarea id="t" style="margin-top:500px;width:400px;height:60px"></textarea>'));
  await finestraASchermo(app);
  await pagina.waitForTimeout(1500);
  const log = [];
  for (let k = 0; k < 5; k++) {
    trascina(await linguetta(app, shell, i1), await sulloSchermo(app, pagina, pagina, '#t'));
    await pagina.waitForTimeout(1000);
    log.push((await pagina.locator('#t').inputValue()).length > 0);
    await pagina.evaluate(() => { document.getElementById('t').value = ''; });
  }
  console.log('K', JSON.stringify(log));
});
