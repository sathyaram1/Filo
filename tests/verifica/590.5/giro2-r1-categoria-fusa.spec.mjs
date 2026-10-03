// Verifica #590.5 giro 2, rilievo 1: rinominando una categoria il nome a metà parte da solo, e se a metà coincide
// col nome di un'altra categoria le due si fondono (irreversibile) prima che l'utente abbia finito di scrivere.
import { test, expect } from '../../fixtures/electron.mjs';

const premi = (app, tasti) => app.evaluate(({ BrowserWindow }, t) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  const tab = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  for (const e of t) tab.view.webContents.sendInputEvent(e);
}, tasti);

async function ctrlW(app) {
  await premi(app, [{ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] }]);
  await new Promise((r) => setTimeout(r, 60));
  await premi(app, [{ type: 'keyDown', keyCode: 'W', modifiers: ['control'] }]);
}

const nomi = (page) => page.evaluate(async () => ((await chrome.storage.local.get('categories')).categories || []).map((c) => c.name).sort());

async function preparaAltro(openTab) {
  const altro = await openTab('filo://options/altro.html');
  await altro.waitForLoadState('domcontentloaded');
  await altro.evaluate(async () => {
    await chrome.storage.local.set({ categories: [{ id: 'cat-a', name: 'Lavoro' }, { id: 'cat-b', name: 'Lavoro vecchio' }] });
  });
  await altro.reload();
  await expect(altro.locator('.sn-cat-row input')).toHaveCount(2, { timeout: 8000 });
  return altro;
}

const casellaDi = (altro, valore) => altro.locator('.sn-cat-row input').filter({ has: altro.locator(':scope') }).and(altro.locator(`[value="${valore}"]`));

test('«Lavoro vecchio» → «Lavoro archiviato» togliendo la parola con Ctrl+Backspace: restano due categorie', async ({ app, openTab }) => {
  const altro = await preparaAltro(openTab);
  const idx = await altro.evaluate(() => [...document.querySelectorAll('.sn-cat-row input')].findIndex((i) => i.value === 'Lavoro vecchio'));
  const casella = altro.locator('.sn-cat-row input').nth(idx);
  await casella.click();
  await altro.keyboard.press('End');
  await altro.keyboard.press('Control+Backspace');
  await altro.keyboard.type('archiviato');
  await ctrlW(app);
  const riaperta = await openTab('filo://options/altro.html');
  await expect.poll(() => nomi(riaperta), { timeout: 5000 }).toEqual(['Lavoro', 'Lavoro archiviato']);
});

test('stessa rinomina a mano, con una pausa a metà sulla parola tolta: restano due categorie', async ({ app, openTab }) => {
  const altro = await preparaAltro(openTab);
  const idx = await altro.evaluate(() => [...document.querySelectorAll('.sn-cat-row input')].findIndex((i) => i.value === 'Lavoro vecchio'));
  const casella = altro.locator('.sn-cat-row input').nth(idx);
  await casella.click();
  await altro.keyboard.press('End');
  for (let i = 0; i < 'vecchio'.length; i++) await altro.keyboard.press('Backspace');
  await new Promise((r) => setTimeout(r, 3600));
  await altro.keyboard.type('archiviato');
  await ctrlW(app);
  const riaperta = await openTab('filo://options/altro.html');
  await expect.poll(() => nomi(riaperta), { timeout: 5000 }).toEqual(['Lavoro', 'Lavoro archiviato']);
});
