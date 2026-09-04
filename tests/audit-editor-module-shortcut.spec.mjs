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
    if (!raw.id) raw.id = 'file-inj';
    if (!raw.meta) raw.meta = {};
    if (!raw.meta.title) raw.meta.title = 'Documento senza titolo';
    localStorage.setItem('filo.editor.collection', JSON.stringify({ version: 2, activeId: raw.id, files: [raw] }));
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

// La scorciatoia consigliata come esempio ("Ctrl+Shift+1") DEVE attivare il
// modulo. Prima del fix il match confrontava solo il carattere PRODOTTO da
// `e.key`: premendo Shift+1 la tastiera genera "!" (non "1"), quindi la
// combinazione non corrispondeva mai. Ora il match usa anche il tasto FISICO
// (Digit1), così Shift non spezza più la scorciatoia.
test('la scorciatoia Ctrl+Shift+1 di un modulo si attiva davvero', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();

  // Un modulo conteggio parole con la scorciatoia d'esempio "Ctrl+Shift+1".
  // Attivarla deve aprire l'overlay delle statistiche.
  await page.evaluate(() => {
    const now = new Date().toISOString();
    const raw = {
      meta: { title: 'Scut', created: now, modified: now, version: 1 },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ciao mondo' }] }] },
      comments: [],
      modules: [
        { id: 'wc-scut', type: 'word-count', cells: [{ x: 0, y: 0 }], data: { count: 'words', shortcut: 'Ctrl+Shift+1' } },
        { id: 'set-scut', type: 'settings', cells: [{ x: 11, y: 7 }], data: {} },
      ],
    };
    if (!raw.id) raw.id = 'file-inj';
    if (!raw.meta) raw.meta = {};
    if (!raw.meta.title) raw.meta.title = 'Documento senza titolo';
    localStorage.setItem('filo.editor.collection', JSON.stringify({ version: 2, activeId: raw.id, files: [raw] }));
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();
  await expect(page.locator('#overlay')).toBeHidden();

  // Premi la scorciatoia d'esempio: Ctrl+Shift+1 (il tasto fisico "1").
  await page.keyboard.press('Control+Shift+Digit1');

  await page.screenshot({ path: 'tests/.shots/audit-editor-shortcut-ctrl-shift-1.png' });

  // ATTESO: l'overlay statistiche del conteggio parole si apre → la scorciatoia
  // ha attivato il modulo. Senza il fix resterebbe nascosto.
  await expect(page.locator('#overlay')).toBeVisible();
});

// Lo switch è l'UNICO modo per navigare fra le pagine della griglia: eliminarlo
// bloccherebbe l'utente sulla prima pagina rendendo irraggiungibili i moduli
// delle altre. Come l'ingranaggio impostazioni, dev'essere protetto — il suo
// pannello di configurazione (rinomina pagine/icone) NON offre "Elimina".
test('lo switch di pagina non è eliminabile e le altre pagine restano raggiungibili', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.ed-module[data-type="switch"]')).toBeVisible();

  // Baseline: dalla pagina "Revisione" (seconda icona dello switch) si
  // raggiungono cerca/sostituisci, commenti e chat.
  await page.locator('.ed-switch-icon').nth(1).click();
  await expect(page.locator('.ed-module[data-type="search-replace"]')).toBeVisible();
  await page.locator('.ed-switch-icon').nth(0).click();

  await enterSettingsMode(page);

  // Un modulo NORMALE (conteggio parole) offre "Elimina": prova che il pannello
  // di configurazione è aperto e che il bottone esiste per i moduli eliminabili.
  await page.locator('.ed-module[data-type="word-count"]').click();
  await expect(page.locator('#cfgShortcut')).toBeVisible();
  await expect(page.locator('#cfgDelete')).toBeVisible();
  await page.click('#cfgCancel');

  // Lo switch apre la SUA configurazione (rinomina pagine) ma NON offre "Elimina".
  await page.locator('.ed-module[data-type="switch"]').click();
  await expect(page.locator('#cfgShortcut')).toBeVisible();
  await expect(page.locator('#cfgDelete')).toHaveCount(0);
  await page.click('#cfgCancel');

  await exitSettingsMode(page);
  await page.screenshot({ path: 'tests/.shots/audit-editor-switch-protected.png' });

  // Lo switch è ancora lì e la pagina Revisione resta raggiungibile.
  await expect(page.locator('.ed-module[data-type="switch"]')).toBeVisible();
  await page.locator('.ed-switch-icon').nth(1).click();
  await expect(page.locator('.ed-module[data-type="search-replace"]')).toBeVisible();
});

// Lo switch è un modulo UNICO: dato che è protetto dalla cancellazione, poterne
// aggiungere un secondo lascerebbe l'utente con un doppione ingombrante e non
// eliminabile — lo stesso stato bloccato, raggiunto al contrario. Quindi lo
// switch NON deve comparire tra i moduli aggiungibili quando ne esiste già uno
// (né nel box "Aggiungi modulo" da cella vuota, né nella palette laterale),
// esattamente come già avviene per l'ingranaggio impostazioni.
test('lo switch non è aggiungibile una seconda volta (resta unico)', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.ed-module[data-type="switch"]')).toBeVisible();

  // Precondizione: esiste già esattamente uno switch nel layout di partenza.
  await expect(page.locator('.ed-module[data-type="switch"]')).toHaveCount(1);

  await enterSettingsMode(page);

  // 1) Box "Aggiungi modulo" da una cella vuota: NIENTE opzione Switch, ma i
  //    moduli normali (es. conteggio parole) restano aggiungibili.
  await page.locator('.ed-cell-empty').first().click();
  await expect(page.locator('#overlay')).toBeVisible();
  await expect(page.locator('[data-add="switch"]')).toHaveCount(0);
  await expect(page.locator('[data-add="word-count"]')).toHaveCount(1);
  // Il box "Aggiungi modulo" si chiude cliccando sullo sfondo (backdrop).
  await page.locator('#overlay').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#overlay')).toBeHidden();

  // 2) Palette laterale della vista modifica: nessun elemento trascinabile Switch.
  const paletteLabels = await page.locator('#palette .pi-title').allInnerTexts();
  expect(paletteLabels.some((t) => /switch/i.test(t))).toBe(false);

  await exitSettingsMode(page);
  await page.screenshot({ path: 'tests/.shots/audit-editor-switch-unique.png' });

  // Resta un solo switch: nessun doppione è stato creato.
  await expect(page.locator('.ed-module[data-type="switch"]')).toHaveCount(1);
});

// Una scorciatoia che Filo si prende PRIMA della pagina (chiudi scheda,
// ricarica, salto di scheda… e su Mac tutta la barra dei menu in cima allo
// schermo) non arriverebbe mai al modulo: si salvava, sembrava valida e non
// partiva mai. Ora il salvataggio la rifiuta dicendo chi si prende quel tasto.
test('una scorciatoia modulo che Filo si prende prima viene rifiutata', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();

  await enterSettingsMode(page);
  await page.locator('.ed-module[data-type="word-count"]').click();
  await expect(page.locator('#cfgShortcut')).toBeVisible();

  // Ctrl+W chiude la scheda: il main la intercetta prima di qualunque pagina,
  // su ogni sistema. (Su Mac la lista è più lunga: ci sono anche i tasti della
  // barra dei menu — vedi tests/unit/macSupport.test.mjs.)
  await page.fill('#cfgShortcut', 'Ctrl+W');
  await page.click('#cfgSave');

  // Il pannello resta aperto, il campo è marcato e l'avviso dice perché.
  await expect(page.locator('#cfgShortcutTaken')).toBeVisible();
  await expect(page.locator('#cfgShortcutTaken')).toContainText('già di Filo');
  await expect(page.locator('#cfgShortcut')).toHaveClass(/ed-field-invalid/);

  // Correggendola con una combinazione libera il salvataggio passa: il pannello
  // si chiude. (Senza questo pezzo il test passerebbe anche se il campo
  // rifiutasse TUTTO.)
  await page.fill('#cfgShortcut', 'Ctrl+Shift+7');
  await expect(page.locator('#cfgShortcutTaken')).toBeHidden();
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
});
