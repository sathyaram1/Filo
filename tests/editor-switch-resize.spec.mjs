import { test, expect } from './fixtures/electron.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shotsDir = path.join(__dirname, '.shots');

// Helper: drag the switch resize handle by `cols` grid columns (positive = grow,
// negative = shrink). Replicates a real mouse drag on .ed-mod-resize-h so the
// production resize/reconcile code path runs end-to-end.
async function dragSwitchResize(page, cols) {
  const handle = page.locator('.ed-module[data-type="switch"] .ed-mod-resize-h');
  const box = await handle.boundingBox();
  const grid = await page.locator('#grid').boundingBox();
  const colWidth = grid.width / 7;
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Move in a couple of steps so the live onMove handler updates targetLen.
  await page.mouse.move(startX + colWidth * cols * 0.5, startY, { steps: 3 });
  await page.mouse.move(startX + colWidth * cols, startY, { steps: 3 });
  await page.mouse.up();
}

function pageCount(page) {
  return page.locator('.ed-module[data-type="switch"] .ed-switch-icon').count();
}

test('growing the switch width adds a page and the switch spans the new width', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  const switchCell = page.locator('.ed-module[data-type="switch"]');
  await expect(switchCell).toBeVisible();

  // Stato iniziale: 2 pagine (blankDoc), larghezza 2 colonne.
  await expect(await pageCount(page)).toBe(2);

  // Trascina la maniglia destra dello switch per allargarlo di 1 colonna.
  await dragSwitchResize(page, 1);

  // Requisito: la larghezza dello switch == numero di pagine. Allargando di una
  // colonna deve comparire una terza pagina.
  await expect.poll(() => pageCount(page)).toBe(3);

  // La cella dello switch deve ora occupare 3 colonne (span 3).
  await expect(switchCell).toHaveCSS('grid-column-end', /span 3/);

  // Requisito: lo switch è presente (appuntato) in OGNI pagina. Cambiando pagina
  // attiva, lo switch resta visibile con le stesse 3 icone-pagina.
  const icons = page.locator('.ed-module[data-type="switch"] .ed-switch-icon');
  await icons.nth(2).click(); // attiva la terza (nuova) pagina
  await expect(icons.nth(2)).toHaveClass(/active/);
  await expect(switchCell).toBeVisible();
  await expect(await pageCount(page)).toBe(3);

  fs.mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: path.join(shotsDir, 'switch-grown-3pages.png') });
});

test('shrinking the switch opens a dialog to choose which page to delete', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await expect(await pageCount(page)).toBe(2);

  // Allarga a 3 così c'è qualcosa da rimpicciolire.
  await dragSwitchResize(page, 1);
  await expect.poll(() => pageCount(page)).toBe(3);

  // Rimpicciolisci: deve aprirsi il box che chiede QUALE pagina eliminare.
  await dragSwitchResize(page, -1);
  const overlay = page.locator('#overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText(/elimina una pagina/i);
  // Un pulsante "Elimina" per pagina (scelta esplicita di quale).
  const delButtons = overlay.locator('button[data-del-z]');
  await expect.poll(() => delButtons.count()).toBe(3);

  // Scegli di eliminare la prima pagina.
  await delButtons.first().click();
  await expect(overlay).toBeHidden();
  await expect.poll(() => pageCount(page)).toBe(2);
});

test('growing the switch with no room in ALL pages is refused and shows a failure toast', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await expect(await pageCount(page)).toBe(2);

  // Prepara uno stato dove la colonna immediatamente a destra dello switch è
  // occupata su una pagina diversa da quella attiva: lo switch è appuntato su
  // tutte le pagine, quindi non deve poter crescere. Lo facciamo via stato
  // interno (deterministico) e poi rerender.
  const blocked = await page.evaluate(() => {
    // Accede al modello tramite localStorage: scriviamo un doc con lo switch a
    // x=0 w=2 (2 pagine) e un modulo su pagina z=1 nella colonna x=2 (subito a
    // destra dello switch), poi ricarichiamo.
    const doc = {
      meta: { title: 't', created: new Date().toISOString(), modified: new Date().toISOString(), version: 1 },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
      comments: [],
      modules: [
        { id: 'sw', type: 'switch', cells: [{ x: 0, y: 6, z: 0 }, { x: 1, y: 6, z: 0 }], data: { activePage: 0, pages: [{ z: 0, name: 'P1', icon: '1' }, { z: 1, name: 'P2', icon: '2' }] } },
        // modulo su pagina 2 che occupa la colonna 2 (blocca l'allargamento a 3)
        { id: 'blk', type: 'word-count', cells: [{ x: 2, y: 6, z: 1 }], data: { count: 'words' } },
        { id: 'set', type: 'settings', cells: [{ x: 6, y: 9, z: 0 }], data: {} },
      ],
    };
    localStorage.setItem('filo.editor.doc', JSON.stringify(doc));
    return true;
  });
  expect(blocked).toBe(true);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(await pageCount(page)).toBe(2);

  // Prova ad allargare: deve essere RIFIUTATO (resta a 2 pagine) e comparire il
  // toast d'errore in basso a destra.
  await dragSwitchResize(page, 1);

  const toast = page.locator('#edToast.show');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText(/spazio insufficiente/i);
  // Nessuna pagina aggiunta: lo switch non si è ridimensionato.
  await expect(await pageCount(page)).toBe(2);

  fs.mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: path.join(shotsDir, 'switch-grow-refused-toast.png') });
});
