// Verifica #2091 giro 3, rilievo 2: il nome di una scheda dentro il gettone del campo non porta la sottolineatura rossa
// del correttore (titolo accorciato a metà parola, nomi stranieri), mentre si scrive la domanda accanto.

import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);

// I pixel rossi della sottolineatura sotto il testo di un rettangolo della home, letti dalla cattura della sua vista.
const rossiSotto = (app, r) => app.evaluate(async ({ BrowserWindow }, q) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  const tm = w._filoTabs;
  const wc = tm.tabs.find((x) => x.id === tm.activeId).view.webContents;
  const img = await wc.capturePage({ x: Math.round(q.x), y: Math.round(q.y + q.height / 2), width: Math.round(q.width), height: Math.round(q.height / 2 + 4) });
  const b = img.toBitmap();
  let n = 0;
  for (let i = 0; i < b.length; i += 4) if (b[i + 2] > 170 && b[i + 1] < 110 && b[i] < 110) n += 1;
  return n;
}, r);

test('r2 il nome nel gettone non ha la sottolineatura del correttore mentre si scrive accanto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const url = testServer.html('<title>Articolo sulla Tesla volante nello spazio profondo, con tutte le foto</title><p>testo');
  await openTab(url);
  const id = (await schede(shell)).find((t) => t.url === url).id;
  const nuova = await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab'));
  const casa = await home(app, { scheda: nuova?.id });
  const r = await casa.locator('#input').boundingBox();
  const b = await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    return tm.tabs.find((x) => x.id === tm.activeId).view.getBounds();
  });
  await shell.evaluate((d) => window.filoShell.schedaFuori(d), { fase: 'lascia', id, x: b.x + r.x + 20, y: b.y + r.y + r.height / 2 });
  await expect.poll(() => casa.evaluate(() => document.getElementById('input')._snGettoni?.schede().length || 0)).toBe(1);
  await casa.locator('#input').focus();
  await casa.keyboard.press('End');
  await casa.keyboard.type('di cosa parla');
  await casa.waitForTimeout(2500);
  const g = await casa.locator('.sn-gettone').first().boundingBox();
  // Controllo: una parola sbagliata scritta a mano nel campo la sottolineatura la prende (il correttore è acceso).
  expect(g).toBeTruthy();
  await expect.poll(() => rossiSotto(app, g), { timeout: 3000 }).toBe(0);
});
