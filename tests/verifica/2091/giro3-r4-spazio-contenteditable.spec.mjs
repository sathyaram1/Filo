// Verifica #2091 giro 3, rilievo 4: lasciata su un campo modificabile (la casella di una mail, di una chat web) dopo una
// parola, la scheda non si incolla alla parola: ci va lo spazio, come in una textarea.

import { test, expect } from '../../fixtures/electron.mjs';

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);

async function lascia(app, shell, pagina, sel, id) {
  const r = await pagina.locator(sel).boundingBox();
  const b = await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    return tm.tabs.find((x) => x.id === tm.activeId).view.getBounds();
  });
  await shell.evaluate((d) => window.filoShell.schedaFuori(d), { fase: 'lascia', id, x: b.x + r.x + r.width - 10, y: b.y + r.y + r.height / 2 });
}

test('r4 su un campo modificabile dopo una parola la scheda arriva staccata da uno spazio, come nella textarea', async ({ app, shell, openTab, testServer }) => {
  const url = testServer.html('<title>Ricetta del pane</title><p>x');
  await openTab(url);
  const id = (await schede(shell)).find((t) => t.url === url).id;
  const pagina = await openTab(testServer.html('<title>Posta</title><textarea id="t" style="width:300px;height:60px">guarda</textarea><div id="c" contenteditable="true" style="width:300px;height:60px;border:1px solid">guarda</div>'));
  await lascia(app, shell, pagina, '#t', id);
  await expect.poll(() => pagina.locator('#t').inputValue(), { timeout: 5000 }).toContain('Ricetta del pane');
  expect(await pagina.locator('#t').inputValue()).toMatch(/^guarda\s+Ricetta del pane/);
  await lascia(app, shell, pagina, '#c', id);
  await expect.poll(() => pagina.locator('#c').innerText(), { timeout: 5000 }).toContain('Ricetta del pane');
  expect(await pagina.locator('#c').innerText()).toMatch(/^guarda\s+Ricetta del pane/);
});
