// Verifica #2091 giro 3, rilievo 2: il nome di una scheda dentro il gettone del campo non porta la sottolineatura rossa
// del correttore (titolo accorciato a metà parola, nomi stranieri), mentre si scrive la domanda accanto.

import { writeFileSync } from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);

// I pixel rossi (la sottolineatura del correttore) fra le x di un gettone, nella cattura del campo della home.
const rossiSotto = (app, campo, g) => app.evaluate(async ({ BrowserWindow }, { c, q }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  const tm = w._filoTabs;
  const wc = tm.tabs.find((x) => x.id === tm.activeId).view.webContents;
  const rect = { x: Math.round(c.x), y: Math.round(c.y), width: Math.round(c.width), height: Math.round(c.height) };
  const img = await wc.capturePage(rect);
  const { width, height } = img.getSize();
  const k = width / rect.width;
  const b = img.toBitmap();
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = Math.floor((q.x - c.x) * k); x < Math.ceil((q.x - c.x + q.width) * k) && x < width; x++) {
      const i = (y * width + x) * 4;
      if (b[i + 2] > 170 && b[i + 1] < 110 && b[i] < 110) n += 1;
    }
  }
  return { n, png: img.toPNG().toString('base64') };
}, { c: campo, q: g });

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
  await casa.keyboard.type('di cosa parla, sbaglaito');
  await casa.waitForTimeout(2500);
  const campo = await casa.locator('#input').boundingBox();
  const g = await casa.locator('.sn-gettone').first().boundingBox();
  const fine = { x: campo.x + campo.width - 260, y: campo.y, width: 250, height: campo.height };
  // Controllo: la parola sbagliata scritta a mano la sottolineatura la prende (il correttore è acceso e si vede).
  const ctl = await rossiSotto(app, campo, fine);
  writeFileSync('tests/.shots/2091-g3/r2-campo.png', Buffer.from(ctl.png, 'base64'));
  console.log('CONTROLLO', ctl.n, 'GETTONE', (await rossiSotto(app, campo, g)).n, JSON.stringify(g), JSON.stringify(campo));
  expect((await rossiSotto(app, campo, g)).n).toBe(0);
});
