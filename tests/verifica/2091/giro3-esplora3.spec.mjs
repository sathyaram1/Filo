// Esplorazione 3 del giro 3: la chat di un mazzo e il documento dell'Editor come destinazioni. Si cancella.

import { test, expect } from '../../fixtures/electron.mjs';
import { disponibili, finestraASchermo, trascina } from '../../helpers/gestiVeri.mjs';

const OUT = 'tests/.shots/2091-g3';
const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);
const idPerUrl = async (shell, url) => (await schede(shell)).find((t) => t.url === url)?.id;

async function linguetta(app, shell, id) {
  const r = await shell.locator(`.tab[data-id="${id}"]`).boundingBox();
  const o = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const cb = w.getContentBounds();
    return { x: cb.x, y: cb.y, z: w.webContents.getZoomFactor() || 1 };
  });
  return { x: Math.round(o.x + (r.x + r.width / 2) * o.z), y: Math.round(o.y + (r.y + r.height / 2) * o.z) };
}
async function sulloSchermo(app, doc, sel) {
  const r = await doc.locator(sel).first().boundingBox();
  const o = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const cb = w.getContentBounds();
    const tm = w._filoTabs;
    const vb = tm.tabs.find((x) => x.id === tm.activeId).view.getBounds();
    return { x: cb.x + vb.x, y: cb.y + vb.y };
  });
  return { x: Math.round(o.x + r.x + Math.min(30, r.width / 2)), y: Math.round(o.y + r.y + r.height / 2) };
}

test.describe.configure({ retries: 0 });
test.beforeEach(() => { test.skip(!disponibili(), 'niente XTest'); });

test('M la chat di un mazzo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const url = testServer.html('<title>Guida al commander Niv-Mizzet</title><p>Carte consigliate: Ophidian Eye.');
  await openTab(url);
  const id = await idPerUrl(shell, url);
  const mazzi = await openTab('filo://decks/decks.html');
  await mazzi.waitForLoadState('domcontentloaded');
  await mazzi.click('#newDeck');
  await expect(mazzi.locator('#screenBuilder')).toBeVisible();
  await finestraASchermo(app);
  await mazzi.waitForTimeout(800);
  await mazzi.fill('#chatInput', 'che ne pensi di ');
  trascina(await linguetta(app, shell, id), await sulloSchermo(app, mazzi, '#chatInput'));
  await mazzi.waitForTimeout(1200);
  console.log('M-VALORE', JSON.stringify(await mazzi.locator('#chatInput').inputValue()), 'gettoni', await mazzi.locator('.sn-gettone').count());
  await mazzi.screenshot({ path: `${OUT}/M-mazzo.png` });
});

test('N il documento dell\'Editor', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const url = testServer.html('<title>Fonte per la tesi</title><p>x');
  await openTab(url);
  const id = await idPerUrl(shell, url);
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.click('#doc');
  await editor.keyboard.type('Fonte: ');
  await finestraASchermo(app);
  await editor.waitForTimeout(800);
  trascina(await linguetta(app, shell, id), await sulloSchermo(app, editor, '#doc'));
  await editor.waitForTimeout(1200);
  console.log('N-DOC', JSON.stringify(await editor.locator('#doc').innerText()));
});
