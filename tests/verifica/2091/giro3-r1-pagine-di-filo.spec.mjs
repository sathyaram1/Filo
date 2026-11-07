// Verifica #2091 giro 3, rilievo 1: una scheda lasciata su una pagina di Filo che non è la home arriva: nella chat di
// un mazzo come gettone, nel documento dell'Editor come titolo e indirizzo (come in un campo di un sito).

import { test, expect } from '../../fixtures/electron.mjs';

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);

// Il rilascio dalla stessa strada della fila delle schede: la shell dice al main dove ha lasciato la scheda.
async function lascia(app, shell, pagina, sel, id) {
  const r = await pagina.locator(sel).boundingBox();
  const b = await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    return tm.tabs.find((x) => x.id === tm.activeId).view.getBounds();
  });
  await shell.evaluate((d) => window.filoShell.schedaFuori(d), { fase: 'lascia', id, x: b.x + r.x + Math.min(30, r.width / 2), y: b.y + r.y + r.height / 2 });
}

test('r1 una scheda lasciata nella chat di un mazzo ci entra come gettone', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const url = testServer.html('<title>Guida al commander Niv-Mizzet</title><p>Carte consigliate: Ophidian Eye.');
  await openTab(url);
  const id = (await schede(shell)).find((t) => t.url === url).id;
  const mazzi = await openTab('filo://decks/decks.html');
  await mazzi.waitForLoadState('domcontentloaded');
  await mazzi.click('#newDeck');
  await expect(mazzi.locator('#screenBuilder')).toBeVisible();
  await mazzi.fill('#chatInput', 'che ne pensi di ');
  await lascia(app, shell, mazzi, '#chatInput', id);
  await expect(mazzi.locator('.sn-gettone').filter({ hasText: 'Guida al commander' })).toHaveCount(1, { timeout: 5000 });
});

test('r1 una scheda lasciata nel documento dell\'Editor ci scrive titolo e indirizzo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const url = testServer.html('<title>Fonte per la tesi</title><p>x');
  await openTab(url);
  const id = (await schede(shell)).find((t) => t.url === url).id;
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.click('#doc');
  await editor.keyboard.type('Fonte: ');
  await lascia(app, shell, editor, '#doc', id);
  await expect.poll(() => editor.locator('#doc').innerText(), { timeout: 5000 }).toContain(url);
  expect(await editor.locator('#doc').innerText()).toContain('Fonte per la tesi');
});
