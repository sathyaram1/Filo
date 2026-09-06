// Suite accorpata: griglia dell'editor (filo://editor) — dimensioni di base e
// personalizzazione/moduli.
//
// Unisce gli ex spec editor-grid (dimensioni base) ed editor-grid-customize
// (controllo dimensione griglia, modulo Font, anteprima drag) in UN solo avvio
// di Electron. Lo stato dell'editor vive in localStorage (chiave
// filo.editor.doc), per-origine e quindi CONDIVISO fra le tab editor: un
// beforeEach lo azzera prima di ogni test, così la dimensione griglia
// personalizzata da un test non trapela nel successivo (che assume il default
// 7×10), com'era con un'app appena lanciata per test.
//
// I body dei test sono identici agli originali (stessi assert): cambia solo da
// dove arriva `openTab` (helper locale sull'app condivisa).

import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from './fixtures/electron.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');
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

// Prima di ogni test: azzera il doc editor in localStorage (origine condivisa)
// e chiudi le tab residue, così ogni test riparte dal documento di default.
test.beforeEach(async () => {
  const page = await openTab(EDITOR);
  await page.evaluate(() => { try { localStorage.removeItem('filo.editor.doc'); localStorage.removeItem('filo.editor.collection'); } catch (_) {} });
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

// ───────────────────────────── editor-grid ─────────────────────────────────
test.describe('dimensioni di base 7×10', () => {
  test('la griglia moduli ha 7 colonne e 10 righe', async () => {
    const page = await openTab(EDITOR);
    await page.waitForSelector('.ed-grid', { timeout: 8_000 });

    const dims = await page.evaluate(() => {
      const grid = document.querySelector('.ed-grid');
      const cs = getComputedStyle(grid);
      return {
        cols: cs.gridTemplateColumns.split(' ').filter(Boolean).length,
        rows: cs.gridTemplateRows.split(' ').filter(Boolean).length,
      };
    });

    expect(dims.cols).toBe(7);
    expect(dims.rows).toBe(10);
  });

  test('la griglia più grande ha più celle vuote disponibili dei moduli iniziali', async () => {
    const page = await openTab(EDITOR);
    await page.waitForSelector('.ed-grid', { timeout: 8_000 });
    // 70 celle totali, pochi moduli sulla pagina 0 → tante celle vuote.
    const empties = await page.locator('.ed-cell-empty').count();
    expect(empties).toBeGreaterThan(20);
  });
});

// ──────────────────────── editor-grid-customize ────────────────────────────
test.describe('personalizzazione griglia + moduli', () => {
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

  test('il controllo "Dimensione griglia" è sopra l\'elenco dei moduli e cambia la griglia', async () => {
    const page = await openTab(EDITOR);
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

  test('la dimensione griglia personalizzata sopravvive al salvataggio/ricarica', async () => {
    const page = await openTab(EDITOR);
    await page.waitForSelector('.ed-grid');
    await openSettings(page);
    await page.locator('.ed-grid-size [data-gs="cols-"]').click(); // 7 → 6
    await page.keyboard.press('Control+s');

    const saved = await page.evaluate(() => {
      const __c = JSON.parse(localStorage.getItem('filo.editor.collection'));
      const raw = __c && __c.files ? (__c.files.find((f) => f.id === __c.activeId) || __c.files[0]) : null;
      return raw.meta && raw.meta.grid ? raw.meta.grid : null;
    });
    expect(saved).toMatchObject({ cols: 6, rows: 10 });
  });

  test('il modulo Font applica il carattere al testo selezionato e si salva', async () => {
    const page = await openTab(EDITOR);
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
      const __c = JSON.parse(localStorage.getItem('filo.editor.collection'));
      const raw = __c && __c.files ? (__c.files.find((f) => f.id === __c.activeId) || __c.files[0]) : null;
      return JSON.stringify(raw.content).includes('fontFamily');
    });
    expect(hasFontFamily).toBe(true);
  });

  test('durante il drag di un modulo compare l\'anteprima fantasma nella cella di destinazione', async () => {
    const page = await openTab(EDITOR);
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
});
