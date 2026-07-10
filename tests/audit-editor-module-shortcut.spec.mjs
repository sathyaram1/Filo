// Audit (prober): editor filo:// — due sospetti sulla griglia moduli.
//
// 1) Scorciatoia personalizzata di un modulo SENZA modificatore: il campo
//    "Scorciatoia da tastiera" nella configurazione del modulo accetta
//    qualunque stringa (placeholder "es. Ctrl+Shift+1", nessuna validazione).
//    Se l'utente scrive una lettera nuda (es. "b"), il listener globale della
//    pagina matcha OGNI pressione di quella lettera — anche mentre si scrive
//    nel documento — fa preventDefault e apre il modulo: la lettera diventa
//    impossibile da digitare nell'editor.
//
// 2) Il modulo switch (cambio pagina della griglia) si può ELIMINARE dal
//    pannello di configurazione (bottone "Elimina", nessuna guardia isPinned):
//    senza switch le pagine diverse dalla 0 diventano irraggiungibili e i
//    moduli che ci stanno sopra spariscono dalla vista senza alcun avviso.
//
// Gli assert descrivono il comportamento ATTESO (la lettera si scrive, lo
// switch non si elimina): se il bug c'è sono rossi.

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

// test.fixme: repro del bug (verificato ROSSO senza fixme: con scorciatoia "b"
// sul modulo conteggio parole, digitando "banana" nel documento compare
// l'overlay "Statistiche documento" e nel testo restano solo "anana..." — le
// "b" vengono inghiottite). Chi lavora il fix toglie `.fixme`.
test.fixme('una scorciatoia modulo senza modificatore non deve rubare la lettera mentre si scrive', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();

  // Configura la scorciatoia "b" (lettera nuda) sul modulo conteggio parole.
  await enterSettingsMode(page);
  await page.locator('.ed-module[data-type="word-count"]').click();
  await expect(page.locator('#cfgShortcut')).toBeVisible();
  await page.fill('#cfgShortcut', 'b');
  await page.click('#cfgSave');
  await exitSettingsMode(page);

  // Scrivi nel documento una parola che contiene la lettera della scorciatoia.
  await page.click('#doc');
  await page.keyboard.type('banana', { delay: 30 });

  await page.screenshot({ path: 'tests/.shots/audit-editor-shortcut-hijack.png' });

  // ATTESO: la parola si scrive intera e nessun overlay si apre da solo.
  await expect(page.locator('#overlay')).toBeHidden();
  const text = await page.locator('#doc').innerText();
  expect(text).toContain('banana');
});

// test.fixme: repro del bug (verificato ROSSO senza fixme: "Elimina" nella
// configurazione dello switch lo rimuove davvero; la griglia resta sulla
// pagina 0 e i moduli delle altre pagine — cerca/sostituisci, commenti, chat
// del documento di default — diventano irraggiungibili senza avviso).
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
