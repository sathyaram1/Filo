// Feedback jZeth (editor): ridimensionare lo switch deve creare/eliminare
// pagine; lo switch deve essere presente su TUTTE le pagine; se non c'è spazio
// in tutte le pagine non si allarga e compare un toast discreto in basso a
// destra; rimpicciolendo si apre un box per scegliere quale pagina eliminare.
//
// Ogni test asserisce il SUCCESSO della feature e fallirebbe senza il fix:
//  - prima del fix lo switch (z=0) spariva passando a un'altra pagina;
//  - il ridimensionamento cambiava solo la larghezza, senza creare pagine.

import { test, expect } from './fixtures/electron.mjs';

// Inietta un documento editor controllato in localStorage e ricarica, così i
// test partono da una disposizione nota.
async function loadDoc(page, modules) {
  await page.evaluate((mods) => {
    const now = new Date().toISOString();
    const doc = {
      meta: { title: 't', created: now, modified: now, version: 1 },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
      comments: [],
      modules: mods,
    };
    localStorage.setItem('filo.editor.doc', JSON.stringify(doc));
  }, modules);
  await page.reload();
  await page.waitForSelector('.ed-grid');
  await page.waitForSelector('.ed-switch');
}

function switchDoc(pageCount, extra = []) {
  const pages = [];
  const cells = [];
  for (let i = 0; i < pageCount; i++) {
    pages.push({ z: i, name: `Pagina ${i + 1}`, icon: String(i + 1) });
    cells.push({ x: i, y: 0, z: 0 });
  }
  return [
    { id: 'sw', type: 'switch', cells, data: { activePage: 0, pages } },
    { id: 'set', type: 'settings', cells: [{ x: 6, y: 9, z: 0 }], data: {} },
    ...extra,
  ];
}

// Trascina l'handle di resize dello switch di `cols` colonne (positivo = più
// largo, negativo = più stretto).
async function dragSwitchResize(page, cols) {
  const gridBox = await page.locator('.ed-grid').boundingBox();
  const colW = gridBox.width / 7;
  const handle = page.locator('.ed-switch .ed-mod-resize-h');
  const hbox = await handle.boundingBox();
  expect(hbox, 'handle di resize dello switch').toBeTruthy();
  const startX = hbox.x + hbox.width / 2;
  const startY = hbox.y + hbox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + cols * colW, startY, { steps: 8 });
  await page.mouse.up();
}

test('lo switch resta visibile passando a un\'altra pagina', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');
  await page.waitForSelector('.ed-switch');

  // Il documento di default ha 2 pagine.
  await expect(page.locator('.ed-switch-icon')).toHaveCount(2);

  // Passa alla seconda pagina cliccando la sua icona nello switch.
  await page.locator('.ed-switch-icon').nth(1).click();

  // Lo switch deve essere ancora presente (prima del fix spariva, rendendo
  // impossibile tornare indietro).
  await expect(page.locator('.ed-switch')).toHaveCount(1);
  await expect(page.locator('.ed-switch-icon').nth(1)).toHaveClass(/active/);
});

test('allargare lo switch crea una nuova pagina', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');
  await loadDoc(page, switchDoc(2));

  await expect(page.locator('.ed-switch-icon')).toHaveCount(2);
  await dragSwitchResize(page, +1);
  // Una pagina in più.
  await expect(page.locator('.ed-switch-icon')).toHaveCount(3);

  // La nuova pagina è navigabile e lo switch è presente anche lì.
  await page.locator('.ed-switch-icon').nth(2).click();
  await expect(page.locator('.ed-switch')).toHaveCount(1);
});

test('se manca spazio in una pagina lo switch non si allarga e compare un toast', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');
  // Switch 2 colonne + un modulo che occupa la colonna 2 sulla pagina 0:
  // allargare a 3 colonne richiederebbe quella cella libera su TUTTE le pagine.
  await loadDoc(page, switchDoc(2, [
    { id: 'wc', type: 'word-count', cells: [{ x: 2, y: 0, z: 0 }], data: { count: 'words' } },
  ]));

  await expect(page.locator('.ed-switch-icon')).toHaveCount(2);
  await dragSwitchResize(page, +1);

  // Niente nuova pagina + toast d'errore in basso a destra.
  await expect(page.locator('.ed-switch-icon')).toHaveCount(2);
  await expect(page.locator('.ed-toast.show')).toBeVisible();
});

test('rimpicciolire lo switch apre il box per scegliere quale pagina eliminare', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');
  await loadDoc(page, switchDoc(3));

  await expect(page.locator('.ed-switch-icon')).toHaveCount(3);
  await dragSwitchResize(page, -1);

  // Il box di conferma con la scelta della pagina è visibile.
  const overlay = page.locator('#overlay');
  await expect(overlay).toBeVisible();
  await expect(page.locator('#overlay button[data-del-z]')).toHaveCount(3);

  // Scegliendo una pagina vuota viene eliminata: una pagina in meno.
  await page.locator('#overlay button[data-del-z]:not([disabled])').last().click();
  await expect(page.locator('#overlay')).toBeHidden();
  await expect(page.locator('.ed-switch-icon')).toHaveCount(2);
});
