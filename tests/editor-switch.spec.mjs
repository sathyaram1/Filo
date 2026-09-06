// Suite accorpata: switch multi-pagina dell'editor (filo://editor).
//
// Unisce gli ex spec editor-switch-pages / editor-switch-resize in UN solo
// avvio di Electron. I test condividono un'unica app lanciata in beforeAll;
// ognuno apre comunque la SUA tab editor fresca. Lo stato dell'editor vive in
// localStorage (chiave filo.editor.doc), che è per-origine e quindi CONDIVISO
// fra le tab editor della stessa sessione: un beforeEach lo azzera prima di
// ogni test, così un doc seminato da un test non trapela nel successivo
// (com'era con un'app appena lanciata per test).
//
// I body dei test sono identici agli originali (stessi assert): cambia solo da
// dove arriva `openTab` (helper locale sull'app condivisa).

import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from './fixtures/electron.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');
const shotsDir = join(__dirname, '.shots');
const EDITOR = 'filo://editor/editor.html';

let app = null;
let shell = null;
let userData = null;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'filo-test-'));
  app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  try { await app.close(); } catch (_) {}
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  app = null; shell = null; userData = null;
});

async function openTab(url) {
  const target = new URL(url).hostname;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const deadline = Date.now() + 10_000;
  let page = null;
  while (Date.now() < deadline) {
    page = app.windows().find((w) => {
      try { return new URL(w.url()).hostname === target; }
      catch (_) { return false; }
    });
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!page) throw new Error(`openTab: nessuna window per ${url}`);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  return page;
}

// Prima di ogni test: azzera il doc editor in localStorage (origine condivisa
// fra le tab editor) e chiudi le tab residue, così ogni test riparte dal
// documento di default (blankDoc), come con un'app appena lanciata.
test.beforeEach(async () => {
  const page = await openTab(EDITOR);
  await page.evaluate(() => { try { localStorage.removeItem('filo.editor.doc'); localStorage.removeItem('filo.editor.collection'); } catch (_) {} });
  // Chiudi tutte le tab editor/residue: il TabManager riapre una newtab fresca.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    if (!w || !w._filoTabs) return;
    for (const t of [...w._filoTabs.tabs]) {
      try { w._filoTabs.closeTab(t.id); } catch (_) {}
    }
  });
  await expect.poll(async () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w && w._filoTabs ? w._filoTabs.tabs.length : 0;
  }), { timeout: 8_000 }).toBe(1);
});

// ───────────────────────── editor-switch-pages ─────────────────────────────
test.describe('switch pagine (resize via handle)', () => {
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
      if (!doc.id) doc.id = 'file-inj';
      if (!doc.meta) doc.meta = {};
      if (!doc.meta.title) doc.meta.title = 'Documento senza titolo';
      localStorage.setItem('filo.editor.collection', JSON.stringify({ version: 2, activeId: doc.id, files: [doc] }));
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

  test('lo switch resta visibile passando a un\'altra pagina', async () => {
    const page = await openTab(EDITOR);
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

  test('allargare lo switch crea una nuova pagina', async () => {
    const page = await openTab(EDITOR);
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

  test('se manca spazio in una pagina lo switch non si allarga e compare un toast', async () => {
    const page = await openTab(EDITOR);
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

  test('rimpicciolire lo switch apre il box per scegliere quale pagina eliminare', async () => {
    const page = await openTab(EDITOR);
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
});

// ──────────────────────── editor-switch-resize ─────────────────────────────
test.describe('switch resize (drag end-to-end + arrow)', () => {
  // Helper: drag the switch resize handle by `cols` grid columns (positive = grow,
  // negative = shrink). Replicates a real mouse drag on .ed-mod-resize-h so the
  // production resize/reconcile code path runs end-to-end.
  async function dragSwitchResize(page, cols) {
    const switchCell = page.locator('.ed-module[data-type="switch"]');
    await switchCell.hover(); // rende visibile/affidabile la maniglia di resize
    const handle = page.locator('.ed-module[data-type="switch"] .ed-mod-resize-h');
    const box = await handle.boundingBox();
    // Usa la STESSA larghezza-colonna dell'app (gridEl.clientWidth / 7): così il
    // Math.round((ev.clientX - startX) / colWidth) lato app produce esattamente
    // `cols`. Stimarla dal bounding box (che include gap/padding) sballa il round.
    const colWidth = await page.evaluate(() => document.getElementById('grid').clientWidth / 7);
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    const targetX = startX + colWidth * cols;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Move in a couple of steps so the live onMove handler updates targetLen.
    await page.mouse.move(startX + (targetX - startX) * 0.5, startY, { steps: 4 });
    await page.mouse.move(targetX, startY, { steps: 4 });
    await page.mouse.up();
  }

  function pageCount(page) {
    return page.locator('.ed-module[data-type="switch"] .ed-switch-icon').count();
  }

  test('growing the switch width adds a page and the switch spans the new width', async () => {
    const page = await openTab(EDITOR);
    const switchCell = page.locator('.ed-module[data-type="switch"]');
    await expect(switchCell).toBeVisible();

    // Stato iniziale: 2 pagine (blankDoc), larghezza 2 colonne.
    await expect.poll(() => pageCount(page)).toBe(2);

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
    await expect.poll(() => pageCount(page)).toBe(3);

    mkdirSync(shotsDir, { recursive: true });
    await page.screenshot({ path: join(shotsDir, 'switch-grown-3pages.png') });
  });

  test('shrinking the switch opens a dialog to choose which page to delete', async () => {
    const page = await openTab(EDITOR);
    await expect.poll(() => pageCount(page)).toBe(2);

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

    // Scegli di eliminare una pagina eliminabile (la pagina 0 contiene il
    // contenuto di default ed è disabilitata: "Svuota la pagina prima"). Le
    // pagine appena create sono vuote → cliccabili.
    const deletable = overlay.locator('button[data-del-z]:not([disabled])');
    await expect.poll(() => deletable.count()).toBeGreaterThan(0);
    await deletable.last().click();
    await expect(overlay).toBeHidden();
    await expect.poll(() => pageCount(page)).toBe(2);
  });

  test('growing the switch with no room in ALL pages is refused and shows a failure toast', async () => {
    const page = await openTab(EDITOR);
    await expect.poll(() => pageCount(page)).toBe(2);

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
      if (!doc.id) doc.id = 'file-inj';
      if (!doc.meta) doc.meta = {};
      if (!doc.meta.title) doc.meta.title = 'Documento senza titolo';
      localStorage.setItem('filo.editor.collection', JSON.stringify({ version: 2, activeId: doc.id, files: [doc] }));
      return true;
    });
    expect(blocked).toBe(true);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    // Attendi che la griglia si sia ri-renderizzata col doc seminato.
    await page.locator('.ed-module[data-type="switch"] .ed-switch-icon').first().waitFor();
    await expect.poll(() => pageCount(page)).toBe(2);

    // Prova ad allargare (freccia ›, stesso percorso di crescita del resize): deve
    // essere RIFIUTATO (resta a 2 pagine) e comparire il toast d'errore in basso a
    // destra. Usiamo la freccia perché è un click deterministico; il percorso di
    // crescita via trascinamento è già coperto dal primo test.
    const growArrow = page.locator('.ed-module[data-type="switch"] .ed-switch-arrow').nth(1);
    await growArrow.click();

    const toast = page.locator('.ed-toast.show').last();
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(/spazio insufficiente/i);
    // Nessuna pagina aggiunta: lo switch non si è ridimensionato.
    await expect.poll(() => pageCount(page)).toBe(2);

    mkdirSync(shotsDir, { recursive: true });
    await page.screenshot({ path: join(shotsDir, 'switch-grow-refused-toast.png') });
  });
});
