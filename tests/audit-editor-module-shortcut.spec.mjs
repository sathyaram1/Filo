// Audit (prober) → fix: editor filo:// — scorciatoie personalizzate dei moduli.
//
// 1) Scorciatoia di un modulo SENZA modificatore. Il campo "Scorciatoia da
//    tastiera" accettava qualunque stringa: scrivendo una lettera nuda (es.
//    "b") il listener globale matchava OGNI pressione di quella lettera — anche
//    mentre si scriveva nel documento — faceva preventDefault e apriva il
//    modulo, rendendo la lettera impossibile da digitare.
//    FIX: (a) il salvataggio rifiuta una scorciatoia senza modificatore reale
//    (Ctrl/Alt) mostrando un avviso; (b) come difesa per le scorciatoie senza
//    modificatore GIÀ salvate, il listener globale le ignora quando il focus è
//    sul documento o su un campo di testo (la lettera si digita normalmente).
//
// 2) Il modulo switch (cambio pagina) si può ancora ELIMINARE dal pannello di
//    configurazione — BUG SEPARATO, non coperto da questo fix (resta test.fixme).
//
// Gli assert descrivono il comportamento ATTESO col fix applicato.

import { test, expect } from './fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

async function enterSettingsMode(page) {
  await page.locator('.ed-module[data-type="settings"]').click();
  await expect(page.locator('#settingsView')).toBeVisible();
}

async function exitSettingsMode(page) {
  await page.locator('.ed-module[data-type="settings"]').click();
  await expect(page.locator('#settingsView')).toBeHidden();
}

// Il salvataggio deve RIFIUTARE una scorciatoia senza modificatore reale (una
// lettera nuda) e avvisare: non viene applicata, quindi non ruba il tasto.
test('una scorciatoia modulo senza modificatore viene rifiutata al salvataggio', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();

  await enterSettingsMode(page);
  await page.locator('.ed-module[data-type="word-count"]').click();
  await expect(page.locator('#cfgShortcut')).toBeVisible();
  await page.fill('#cfgShortcut', 'b');
  await page.click('#cfgSave');

  // ATTESO: il pannello resta aperto con l'avviso e il campo marcato invalido.
  await expect(page.locator('#cfgShortcutHint')).toBeVisible();
  await expect(page.locator('#cfgShortcut')).toHaveClass(/ed-field-invalid/);

  // Chiudi senza salvare, esci dalla modalità modifica e scrivi.
  await page.click('#cfgCancel');
  await exitSettingsMode(page);
  await page.click('#doc');
  await page.keyboard.type('banana', { delay: 30 });

  await page.screenshot({ path: 'tests/.shots/audit-editor-shortcut-rejected.png' });

  // La lettera "b" non è stata rubata: la parola si scrive intera, niente overlay.
  await expect(page.locator('#overlay')).toBeHidden();
  expect(await page.locator('#doc').innerText()).toContain('banana');
});

// Difesa per i documenti salvati PRIMA del fix: se un modulo ha già una
// scorciatoia senza modificatore (es. "b"), il listener globale non deve
// rubarla mentre si scrive nel documento.
test('una scorciatoia senza modificatore GIÀ salvata non ruba la lettera mentre si scrive', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();

  // Simula un documento salvato da una versione precedente: un modulo conteggio
  // parole con scorciatoia nuda "b". Poi ricarica l'editor per rileggerlo.
  await page.evaluate(() => {
    const now = new Date().toISOString();
    const raw = {
      meta: { title: 'Legacy', created: now, modified: now, version: 1 },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
      comments: [],
      modules: [
        { id: 'legacy-wc', type: 'word-count', cells: [{ x: 0, y: 0 }], data: { count: 'words', shortcut: 'b' } },
        { id: 'legacy-set', type: 'settings', cells: [{ x: 11, y: 7 }], data: {} },
      ],
    };
    localStorage.setItem('filo.editor.doc', JSON.stringify(raw));
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();

  await page.click('#doc');
  await page.keyboard.type('banana', { delay: 30 });

  await page.screenshot({ path: 'tests/.shots/audit-editor-shortcut-legacy.png' });

  // ATTESO: la parola si scrive intera e nessun overlay statistiche si apre.
  await expect(page.locator('#overlay')).toBeHidden();
  expect(await page.locator('#doc').innerText()).toContain('banana');
});

// test.fixme: BUG SEPARATO, non coperto da questo fix. "Elimina" nella
// configurazione dello switch lo rimuove davvero; la griglia resta sulla
// pagina 0 e i moduli delle altre pagine diventano irraggiungibili senza avviso.
test.fixme('lo switch di pagina non deve essere eliminabile (le altre pagine diventano irraggiungibili)', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.ed-module[data-type="switch"]')).toBeVisible();

  // Baseline: dalla pagina "Revisione" (seconda icona dello switch) si
  // raggiungono cerca/sostituisci, commenti e chat.
  await page.locator('.ed-switch-icon').nth(1).click();
  await expect(page.locator('.ed-module[data-type="search-replace"]')).toBeVisible();
  await page.locator('.ed-switch-icon').nth(0).click();

  // Elimina lo switch dal suo pannello di configurazione.
  await enterSettingsMode(page);
  await page.locator('.ed-module[data-type="switch"]').click();
  await expect(page.locator('#cfgDelete')).toBeVisible();
  await page.click('#cfgDelete');
  await exitSettingsMode(page);

  await page.screenshot({ path: 'tests/.shots/audit-editor-switch-deleted.png' });

  // ATTESO: lo switch è ancora lì (modulo di sistema, come l'ingranaggio) e la
  // pagina Revisione resta raggiungibile.
  await expect(page.locator('.ed-module[data-type="switch"]')).toBeVisible();
  await page.locator('.ed-switch-icon').nth(1).click();
  await expect(page.locator('.ed-module[data-type="search-replace"]')).toBeVisible();
});
