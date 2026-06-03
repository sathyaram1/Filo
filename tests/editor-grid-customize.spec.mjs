// Feedback alpha (editor): drag con anteprima, "+" appena visibili, dimensione
// griglia impostabile, e nuovo modulo Font. I test asseriscono il SUCCESSO:
// la griglia cambia davvero dimensione e persiste, il font viene applicato e
// sopravvive al salvataggio, e durante il drag compare l'anteprima fantasma.

import { test, expect } from './fixtures/electron.mjs';

async function addModule(page, type) {
  await page.locator('.ed-cell-empty').first().click();
  await page.locator(`.ed-overlay [data-add="${type}"]`).click();
  await page.waitForSelector(`.ed-module[data-type="${type}"]`);
}

async function openSettings(page) {
  // L'ingranaggio (modulo fisso) apre la modalità modifica moduli.
  await page.locator('.ed-module[data-type="settings"]').click();
  await page.waitForSelector('.ed-grid-size');
}

function gridDims(page) {
  return page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.ed-grid'));
    return {
      cols: cs.gridTemplateColumns.split(' ').filter(Boolean).length,
      rows: cs.gridTemplateRows.split(' ').filter(Boolean).length,
    };
  });
}

test('il controllo "Dimensione griglia" è sopra l\'elenco dei moduli e cambia la griglia', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');
  // default 7×10
  expect(await gridDims(page)).toEqual({ cols: 7, rows: 10 });

  await openSettings(page);
  // il controllo precede la palette nel DOM
  const order = await page.evaluate(() => {
    const view = document.getElementById('settingsView');
    const gs = view.querySelector('.ed-grid-size');
    const pal = view.querySelector('.ed-palette');
    return gs && pal ? (gs.compareDocumentPosition(pal) & Node.DOCUMENT_POSITION_FOLLOWING) ? 'before' : 'after' : 'missing';
  });
  expect(order).toBe('before');

  // +1 colonna, +1 riga
  await page.locator('.ed-grid-size [data-gs="cols+"]').click();
  await page.locator('.ed-grid-size [data-gs="rows+"]').click();
  expect(await gridDims(page)).toEqual({ cols: 8, rows: 11 });
  await expect(page.locator('#gsCols')).toHaveText('8');
  await expect(page.locator('#gsRows')).toHaveText('11');
});

test('la dimensione griglia personalizzata sopravvive al salvataggio/ricarica', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');
  await openSettings(page);
  await page.locator('.ed-grid-size [data-gs="cols-"]').click(); // 7 → 6
  await page.keyboard.press('Control+s');

  const saved = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('filo.editor.doc'));
    return raw.meta && raw.meta.grid ? raw.meta.grid : null;
  });
  expect(saved).toMatchObject({ cols: 6, rows: 10 });
});

test('il modulo Font applica il carattere al testo selezionato e si salva', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');

  // il modulo Font è offerto nel menu "Aggiungi modulo"
  await page.locator('.ed-cell-empty').first().click();
  await expect(page.locator('.ed-overlay [data-add="font"]')).toHaveCount(1);
  await page.locator('.ed-overlay [data-add="font"]').click();
  await page.waitForSelector('.ed-module[data-type="font"]');

  // scrivi e seleziona tutto il paragrafo
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>cambia font</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
    const block = doc.querySelector('p');
    const range = document.createRange();
    range.selectNodeContents(block);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });

  // simula la scelta nel <select> (salva selezione su mousedown, applica su change)
  await page.locator('.ed-module[data-type="font"] .ed-font-select').dispatchEvent('mousedown');
  await page.selectOption('.ed-module[data-type="font"] .ed-font-select', 'Georgia, serif');

  const html = await page.locator('#doc').innerHTML();
  expect(html).toMatch(/font-family\s*:\s*[^;"']*Georgia/i);

  // persistenza: la marca fontFamily deve sopravvivere al salvataggio
  await page.keyboard.press('Control+s');
  const hasFontFamily = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('filo.editor.doc'));
    return JSON.stringify(raw.content).includes('fontFamily');
  });
  expect(hasFontFamily).toBe(true);
});

test('durante il drag di un modulo compare l\'anteprima fantasma nella cella di destinazione', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');

  const mod = page.locator('.ed-module[data-type="word-count"]');
  await mod.hover();
  const handle = mod.locator('.ed-mod-drag');
  const hbox = await handle.boundingBox();
  const empties = page.locator('.ed-cell-empty');
  const n = await empties.count();
  const ebox = await empties.nth(n - 1).boundingBox();

  await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2);
  await page.mouse.down();
  await page.mouse.move(ebox.x + ebox.width / 2, ebox.y + ebox.height / 2, { steps: 12 });

  // L'anteprima fantasma esiste ed è posizionata (a opacità ridotta).
  const ghost = await page.evaluate(() => {
    const g = document.querySelector('.ed-drag-ghost');
    if (!g) return null;
    return { vis: getComputedStyle(g).display !== 'none', op: parseFloat(getComputedStyle(g).opacity) };
  });
  expect(ghost).not.toBeNull();
  expect(ghost.vis).toBe(true);
  expect(ghost.op).toBeLessThan(1);

  await page.mouse.up();
  // a drag finito l'anteprima è rimossa
  await expect(page.locator('.ed-drag-ghost')).toHaveCount(0);
});
