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
  await expect(page.locator('[data-pname]').first()).toBeVisible();
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

// #545.1: un tasto speciale scritto per nome (Space, Up, Esc) o «Control» come
// modificatore si salvavano e poi non scattavano mai, perché alla pressione il
// tasto arrivava con un altro nome. I passi sono quelli dell'utente.
const NOMI = [
  { scritto: 'Ctrl+Space', premi: 'Control+Space' },
  { scritto: 'Ctrl+Spazio', premi: 'Control+Space' },
  { scritto: 'Ctrl+Up', premi: 'Control+ArrowUp' },
  { scritto: 'Control+Shift+2', premi: 'Control+Shift+Digit2' },
  // Su Windows Ctrl+Esc apre Start: lì il campo la rifiuta (prova sotto).
  ...(process.platform === 'win32' ? [] : [{ scritto: 'Ctrl+Esc', premi: 'Control+Escape' }]),
];
for (const { scritto, premi } of NOMI) {
  test(`la scorciatoia «${scritto}» salvata dall'Editor apre il modulo`, async ({ openTab }) => {
    const page = await openTab(EDITOR);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#doc')).toBeVisible();

    await enterSettingsMode(page);
    await page.locator('.ed-module[data-type="word-count"]').click();
    await page.fill('#cfgShortcut', scritto);
    await page.click('#cfgSave');
    await expect(page.locator('#overlay')).toBeHidden();
    await exitSettingsMode(page);

    await page.click('#doc');
    await page.keyboard.press(premi);
    await expect(page.locator('#overlay')).toBeVisible();
    await expect(page.locator('#overlay')).toContainText(/parole/i);
  });
}

test('un nome di tasto che Filo non riconosce viene rifiutato al salvataggio', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();

  await enterSettingsMode(page);
  await page.locator('.ed-module[data-type="word-count"]').click();
  await page.fill('#cfgShortcut', 'Ctrl+Spazioo');
  await page.click('#cfgSave');

  await expect(page.locator('#cfgShortcutTaken')).toBeVisible();
  await expect(page.locator('#cfgShortcutTaken')).toContainText('Spazioo');
  await expect(page.locator('#cfgShortcut')).toHaveClass(/ed-field-invalid/);
  await page.screenshot({ path: 'tests/.shots/audit-editor-shortcut-nome-sconosciuto.png' });

  await page.fill('#cfgShortcut', 'Ctrl+Spazio');
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
});

// #545.1: un modificatore col nome italiano conta alla pressione; uno che Filo
// non sa premere si rifiuta invece di sparire e far scattare la combinazione sbagliata.
test('Ctrl+Maiusc+2 parte con Ctrl+Shift+2; un modificatore sconosciuto si rifiuta', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();

  await enterSettingsMode(page);
  await page.locator('.ed-module[data-type="word-count"]').click();
  await page.fill('#cfgShortcut', 'Ctrl+Win+2');
  await page.click('#cfgSave');
  await expect(page.locator('#cfgShortcut')).toHaveClass(/ed-field-invalid/);
  await expect(page.locator('#cfgShortcutTaken')).toContainText('Win');
  await page.screenshot({ path: 'tests/.shots/audit-editor-shortcut-modificatore-ignoto.png' });

  await page.fill('#cfgShortcut', 'Ctrl+Maiusc+2');
  await page.click('#cfgSave');
  await expect(page.locator('#cfgShortcut')).toBeHidden();
  await exitSettingsMode(page);
  await page.click('#doc');
  await page.keyboard.type('una prova', { delay: 10 });
  await page.keyboard.press('Control+Shift+Digit2');
  await expect(page.locator('#overlay')).toContainText('Statistiche documento');
});

// Un documento con i moduli scelti, tutti sulla prima pagina della griglia.
async function apriDocConModuli(page, modules) {
  await page.evaluate((mods) => {
    const now = new Date().toISOString();
    const raw = {
      id: 'file-tasti', meta: { title: 'Tasti', created: now, modified: now, version: 1 },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ciao mondo' }] }] },
      comments: [],
      modules: [...mods, { id: 'set-tasti', type: 'settings', cells: [{ x: 11, y: 7 }], data: {} }],
    };
    localStorage.setItem('filo.editor.collection', JSON.stringify({ version: 2, activeId: raw.id, files: [raw] }));
  }, modules);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();
}

const WC = { id: 'wc-t', type: 'word-count', cells: [{ x: 0, y: 0 }], data: { count: 'words' } };
const SR = { id: 'sr-t', type: 'search-replace', cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }], data: {} };
const BOLD = { id: 'b-t', type: 'bold', cells: [{ x: 3, y: 0 }], data: {} };
const COMMENT = { id: 'c-t', type: 'comment', cells: [{ x: 4, y: 0 }], data: {} };

// I tasti che l'Editor serve da sé (salva, barra laterale, ricerca, zoom del
// foglio, grassetto, copia/incolla…) passano PRIMA dei moduli: un modulo che
// se ne prendeva uno si salvava in silenzio e non partiva mai, mentre il tasto
// faceva l'altra cosa (#545).
test('una scorciatoia modulo che l\'Editor usa già viene rifiutata, dicendo cosa fa quel tasto', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [WC, SR]);

  await enterSettingsMode(page);
  await page.locator('.ed-module[data-type="word-count"]').click();
  await expect(page.locator('#cfgShortcut')).toBeVisible();

  for (const [sc, dice] of [
    ['Ctrl+S', 'salva il documento'],
    ['Ctrl+\\', 'barra laterale'],
    ['Ctrl+F', 'ricerca'],
    ['Ctrl+0', 'zooma'],
    ['Ctrl+=', 'zooma'],
    ['Ctrl+-', 'zooma'],
    // Lo stesso tasto scritto per nome: il nome si legge come la pressione.
    ['Ctrl+Minus', 'zooma'],
    // Con Shift il meno diventa un altro simbolo: il nome scritto non è il tasto vero.
    ['Ctrl+Shift+Minus', 'Con Shift'],
    ['Ctrl+_', 'zooma'],
    ['Ctrl+Plus', 'zooma'],
    ['Ctrl++', 'zooma'],
    ['Ctrl+B', 'grassetto'],
    ['Ctrl+C', 'copia'],
  ]) {
    await page.fill('#cfgShortcut', sc);
    await page.click('#cfgSave');
    await expect(page.locator('#cfgShortcutHint'), sc).toBeHidden();
    await expect(page.locator('#cfgShortcutTaken'), sc).toBeVisible();
    await expect(page.locator('#cfgShortcutTaken'), sc).toContainText(dice);
    await expect(page.locator('#cfgShortcut')).toHaveClass(/ed-field-invalid/);
  }
  await page.screenshot({ path: 'tests/.shots/editor-scorciatoia-dell-editor.png' });

  // Una libera passa, e premuta apre davvero il modulo.
  await page.fill('#cfgShortcut', 'Ctrl+Shift+S');
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
  await exitSettingsMode(page);
  await page.click('#doc');
  await page.keyboard.press('Control+Shift+KeyS');
  await expect(page.locator('#overlay')).toBeVisible();
});

// Il tasto che fa già la cosa del modulo resta suo: Ctrl+F sul Cerca e
// sostituisci porta alla ricerca in entrambi i casi.
test('il modulo a cui il tasto dell\'Editor appartiene può averlo', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [WC, SR, BOLD]);

  await enterSettingsMode(page);
  await page.locator('.ed-module[data-type="search-replace"]').click();
  await page.fill('#cfgShortcut', 'Ctrl+F');
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
  await page.locator('.ed-module[data-type="bold"]').click();
  await page.fill('#cfgShortcut', 'Ctrl+B');
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
});

// Due moduli con la stessa scorciatoia: partiva solo il primo, l'altro mai.
test('una scorciatoia già di un altro modulo viene rifiutata col nome di quel modulo', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [{ ...WC, data: { count: 'words', shortcut: 'Ctrl+Shift+1' } }, COMMENT]);

  await enterSettingsMode(page);
  await page.locator('.ed-module[data-type="comment"]').click();
  // L'esempio proposto è libero davvero: non ripropone quella già presa.
  await expect(page.locator('#cfgShortcut')).toHaveAttribute('placeholder', /Shift\+2/);
  await page.fill('#cfgShortcut', 'ctrl+shift+1');
  await page.click('#cfgSave');
  await expect(page.locator('#cfgShortcutTaken')).toBeVisible();
  await expect(page.locator('#cfgShortcutTaken')).toContainText('Conteggio parole');
  await expect(page.locator('#cfgShortcutTaken')).toContainText('Shift+2');
});

// Chi l'aveva già salvata prima di questi controlli se lo sente dire appena
// apre il modulo, non solo se la riscrive.
test('una scorciatoia morta già salvata è segnalata all\'apertura del modulo', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [{ ...WC, data: { count: 'words', shortcut: 'Ctrl+S' } }]);

  await enterSettingsMode(page);
  await page.locator('.ed-module[data-type="word-count"]').click();
  await expect(page.locator('#cfgShortcutTaken')).toBeVisible();
  await expect(page.locator('#cfgShortcutTaken')).toContainText('salva il documento');
});

// I tasti dell'Editor, passati per la stessa tabella, fanno ancora la loro cosa.
test('grassetto, barra laterale e zoom da tastiera funzionano ancora', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [WC]);

  await page.click('#doc');
  await page.keyboard.press('Control+KeyA');
  await page.keyboard.press('Control+KeyB');
  await expect(page.locator('#doc b, #doc strong').first()).toContainText('ciao');

  const nascosta = () => page.evaluate(() => document.getElementById('root').classList.contains('sidebar-hidden'));
  const prima = await nascosta();
  await page.keyboard.press('Control+Backslash');
  expect(await nascosta()).toBe(!prima);

  await page.keyboard.press('Control+Equal');
  expect(await page.evaluate(() => document.getElementById('doc').style.zoom)).not.toBe('');
  await page.keyboard.press('Control+Digit0');
  expect(await page.evaluate(() => document.getElementById('doc').style.zoom)).toBe('');
});

// #545: la scorciatoia di un modulo fa quello che fa il suo clic, non solo
// portarlo in vista (Grassetto, Indietro e Chat la salvavano e poi non facevano niente).
test('la scorciatoia di Grassetto, Indietro e Chat fa la cosa del modulo', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  const CHAT = { id: 'ch-t', type: 'chat', cells: [5, 6, 7].flatMap((x) => [0, 1, 2].map((y) => ({ x, y }))), data: {} };
  await apriDocConModuli(page, [WC, BOLD, { id: 'u-t', type: 'undo', cells: [{ x: 4, y: 0 }], data: {} }, CHAT]);

  await enterSettingsMode(page);
  for (const [tipo, sc] of [['bold', 'Ctrl+G'], ['undo', 'Ctrl+Shift+2'], ['chat', 'Ctrl+Shift+4']]) {
    await page.locator(`.ed-module[data-type="${tipo}"]`).click();
    await page.fill('#cfgShortcut', sc);
    await page.click('#cfgSave');
    await expect(page.locator('#overlay'), sc).toBeHidden();
  }
  await exitSettingsMode(page);

  await page.click('#doc');
  await page.keyboard.press('Control+KeyA');
  await page.keyboard.press('Control+KeyG');
  await expect(page.locator('#doc b, #doc strong').first()).toContainText('ciao');

  await page.keyboard.press('End');
  await page.keyboard.type(' xyz', { delay: 20 });
  await expect(page.locator('#doc')).toContainText('xyz');
  await page.keyboard.press('Control+Shift+Digit2');
  await expect(page.locator('#doc')).not.toContainText('xyz');

  await page.keyboard.press('Control+Shift+Digit4');
  await expect(page.locator('[data-chat="input"]')).toBeFocused();
});

// Allineamento ha più azioni: niente scorciatoia da offrire. Una salvata prima
// si vede con l'avviso e si può togliere.
test('un modulo senza un\'azione unica non offre la scorciatoia, e una vecchia si toglie', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [
    { id: 'al-t', type: 'align', cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }], data: {} },
    { id: 'fo-t', type: 'font', cells: [{ x: 2, y: 0 }, { x: 3, y: 0 }], data: { shortcut: 'Ctrl+Shift+5' } },
  ]);

  await enterSettingsMode(page);
  await page.locator('.ed-module[data-type="align"]').click();
  await expect(page.locator('#cfgShortcut')).toBeHidden();
  await page.click('#cfgCancel');

  await page.locator('.ed-module[data-type="font"]').click();
  await expect(page.locator('#cfgShortcut')).toBeVisible();
  await expect(page.locator('#cfgShortcutTaken')).toContainText('non ha un\'azione unica');
  await page.click('#cfgSave');
  await expect(page.locator('#cfgShortcutTaken')).toBeVisible();
  await page.fill('#cfgShortcut', '');
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
});

// Con Shift un simbolo diventa un altro (la barra rovesciata diventa la barra
// verticale): scritto con Shift non partirebbe mai; scritto col simbolo che esce sì.
test('un simbolo con Shift si rifiuta, il simbolo che esce parte', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [WC]);

  await enterSettingsMode(page);
  await page.locator('.ed-module[data-type="word-count"]').click();
  for (const sc of ['Ctrl+Shift+\\', 'Ctrl+Shift+/', 'Ctrl+Maiusc+,', 'Ctrl+Shift+|']) {
    await page.fill('#cfgShortcut', sc);
    await page.click('#cfgSave');
    await expect(page.locator('#cfgShortcutTaken'), sc).toContainText('Con Shift');
  }
  await page.fill('#cfgShortcut', 'Ctrl+|');
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
  await exitSettingsMode(page);
  await page.click('#doc');
  await page.keyboard.press('Control+Shift+Backslash');
  await expect(page.locator('#overlay')).toContainText('Statistiche documento');
});

// L'esempio di un avviso si sceglie con la stessa regola che rifiuta: chi lo
// segue non se lo vede rifiutare, anche con Ctrl+Shift+1 già su un altro modulo.
test('l\'esempio proposto da ogni avviso si salva davvero', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [{ ...WC, data: { count: 'words', shortcut: 'Ctrl+Shift+1' } }, COMMENT]);

  await enterSettingsMode(page);
  for (const sc of ['Alt+F4', 'Ctrl+Pippo+2', 'Ctrl+Spazioo', 'Ctrl+S', 'ctrl+shift+1']) {
    await page.locator('.ed-module[data-type="comment"]').click();
    await page.fill('#cfgShortcut', sc);
    await page.click('#cfgSave');
    const avviso = await page.locator('#cfgShortcutTaken').innerText();
    const esempio = (/(?:per esempio|es\.)\s+([^\s)]+?)\)?\.?$/m.exec(avviso) || [])[1];
    expect(esempio, avviso).toBeTruthy();
    expect(esempio, avviso).not.toMatch(/Shift\+1$/);
    await page.fill('#cfgShortcut', esempio);
    await page.click('#cfgSave');
    await expect(page.locator('#overlay'), `${sc}: ${esempio} proposto e poi rifiutato`).toBeHidden();
  }
});

// Ctrl+Z sul modulo Indietro si accetta perché il tasto fa già la sua cosa: deve
// farla anche col cursore fuori dal testo, dove il browser non annulla (#545).
test('Ctrl+Z annulla anche dopo un clic su un modulo, come il clic su Indietro', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [WC, { id: 'u-t', type: 'undo', cells: [{ x: 5, y: 0 }], data: {} }]);

  await enterSettingsMode(page);
  await page.locator('.ed-module[data-type="undo"]').click();
  await page.fill('#cfgShortcut', 'Ctrl+Z');
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
  await exitSettingsMode(page);

  await page.click('#doc');
  await page.keyboard.press('End');
  await page.keyboard.type(' ABC');
  await page.waitForTimeout(300);
  const scritto = await page.locator('#doc').innerText();
  await page.locator('.ed-module[data-type="word-count"]').click();
  await expect(page.locator('#overlay')).toBeVisible();
  await page.locator('#overlay').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#overlay')).toBeHidden();
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).not.toBe('doc');

  await page.keyboard.press('Control+KeyZ');
  await expect.poll(() => page.locator('#doc').innerText(), { timeout: 2000 }).not.toBe(scritto);
  // Dentro un campo di testo Ctrl+Z resta di quel campo.
  await page.locator('.ed-module[data-type="word-count"]').click();
  await page.locator('#overlay').click({ position: { x: 5, y: 5 } });
  await enterSettingsMode(page);
  await page.locator('.ed-module[data-type="word-count"]').click();
  await page.fill('#cfgShortcut', 'Ctrl+Shift+7');
  const doc = await page.locator('#doc').innerText();
  await page.keyboard.press('Control+KeyZ');
  await page.waitForTimeout(200);
  expect(await page.locator('#doc').innerText()).toBe(doc);
  // Tolta la scorciatoia, Ctrl+Z fuori dal testo torna alla regola di Filo.
  await page.click('#cfgCancel');
  await page.locator('.ed-module[data-type="undo"]').click();
  await page.fill('#cfgShortcut', '');
  await page.click('#cfgSave');
  expect(await page.evaluate(() => document.documentElement.dataset.filoCtrlZ)).toBeUndefined();
});

// A pannello aperto la tastiera è del pannello: Esc lo chiude, e una combinazione
// premuta nel campo della scorciatoia non agisce sul foglio o sui moduli dietro (#545).
test('a pannello aperto Esc chiude e i tasti non agiscono dietro', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [{ ...WC, data: { count: 'words', shortcut: 'Ctrl+Shift+1' } }, COMMENT]);

  await page.locator('.ed-module[data-type="word-count"]').click();
  await expect(page.locator('#overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#overlay')).toBeHidden();

  await enterSettingsMode(page);
  await page.locator('.ed-module[data-type="comment"]').click();
  await page.click('#cfgShortcut');
  const barra = await page.locator('#root').getAttribute('class');
  await page.keyboard.press('Control+Backslash');
  await page.keyboard.press('Control+Shift+Digit1');
  await page.waitForTimeout(250);
  await expect(page.locator('#cfgShortcut')).toHaveCount(1);
  await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toHaveCount(0);
  expect(await page.locator('#root').getAttribute('class')).toBe(barra);
  await page.keyboard.press('Escape');
  await expect(page.locator('#overlay')).toBeHidden();

  // Chiuso il pannello, i tasti tornano al foglio e ai moduli.
  await exitSettingsMode(page);
  await page.click('#doc');
  await page.keyboard.press('Control+Shift+Digit1');
  await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible();
});

// Fuori dal testo Ctrl+Z torna alla pagina precedente (#267): se Indietro l'ha
// salvato, nell'Editor vince il modulo; tolto, la regola di Filo torna (#545).
test('con cronologia dietro, Ctrl+Z salvato su Indietro annulla e non porta via dall\'Editor', async ({ openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await page.evaluate((u) => { window.location.href = u; }, EDITOR);
  await page.waitForURL((u) => u.href.startsWith(EDITOR), { timeout: 10_000 });
  await apriDocConModuli(page, [WC, { id: 'u-t', type: 'undo', cells: [{ x: 5, y: 0 }], data: { shortcut: 'Ctrl+Z' } }]);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

  await page.click('#doc');
  await page.keyboard.press('End');
  await page.keyboard.type(' ABC');
  await page.waitForTimeout(300);
  const scritto = await page.locator('#doc').innerText();
  await page.locator('.ed-module[data-type="word-count"]').click();
  await page.locator('#overlay').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#overlay')).toBeHidden();
  await page.keyboard.press('Control+KeyZ');
  await expect.poll(() => page.locator('#doc').innerText(), { timeout: 2000 }).not.toBe(scritto);
  await page.waitForTimeout(500);
  expect(page.url()).toContain('editor');

  await enterSettingsMode(page);
  await page.locator('.ed-module[data-type="undo"]').click();
  await page.fill('#cfgShortcut', '');
  await page.click('#cfgSave');
  await exitSettingsMode(page);
  await page.keyboard.press('Control+KeyZ');
  await page.waitForURL((u) => u.href.startsWith('filo://newtab'), { timeout: 8_000 });
});

// Su Mac il browser non ripete con Cmd+Y (lì i tasti di modifica passano dalla barra dei menu):
// l'Editor non deve contarlo fra i suoi, o Avanti con Cmd+Y tace mentre si scrive (#545).
// Qui il Mac si simula: l'Editor chiede il sistema a SN_TASTI, che si tiene da quando si carica.
test('su Mac Cmd+Y dato ad Avanti ripete anche mentre si scrive, e non si rifiuta altrove', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await page.addInitScript(() => {
    let tasti;
    Object.defineProperty(window, 'SN_TASTI', {
      configurable: true,
      get: () => tasti,
      set: (v) => { tasti = v; if (v) v.suMac = () => true; },
    });
  });
  await apriDocConModuli(page, [WC, { id: 'r-t', type: 'redo', cells: [{ x: 5, y: 0 }], data: {} }]);
  expect(await page.evaluate(() => window.SN_TASTI.suMac())).toBe(true);

  await enterSettingsMode(page);
  await page.locator('.ed-module[data-type="word-count"]').click();
  await page.fill('#cfgShortcut', 'Cmd+Y');
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
  await page.locator('.ed-module[data-type="word-count"]').click();
  await page.fill('#cfgShortcut', '');
  await page.click('#cfgSave');
  await page.locator('.ed-module[data-type="redo"]').click();
  await page.fill('#cfgShortcut', 'Cmd+Y');
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
  await exitSettingsMode(page);

  await page.click('#doc');
  await page.keyboard.press('End');
  await page.keyboard.type(' ABC');
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+KeyZ');
  await expect.poll(() => page.locator('#doc').innerText(), { timeout: 2000 }).not.toContain('ABC');
  await page.keyboard.press('Meta+KeyY');
  await expect.poll(() => page.locator('#doc').innerText(), { timeout: 2000 }).toContain('ABC');
});

// Scritta col trattino o con gli spazi una scorciatoia si legge come col più; senza il tasto
// finale l'avviso dice che manca il tasto, non il modificatore che c'è (#545).
test('«Ctrl Shift 2» parte come Ctrl+Shift+2, e «Ctrl+» dice che manca il tasto', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [WC]);
  await enterSettingsMode(page);

  for (const [scritto, atteso] of [['Ctrl+', /Manca il tasto/], ['Ctrl-Shift', /Manca il tasto/], ['Ctrl-S', /salva il documento/]]) {
    await page.locator('.ed-module[data-type="word-count"]').click();
    await page.fill('#cfgShortcut', scritto);
    await page.click('#cfgSave');
    await expect(page.locator('#cfgShortcutTaken'), scritto).toHaveText(atteso);
    await expect(page.locator('#cfgShortcutHint'), scritto).toBeHidden();
    await page.click('#cfgCancel');
  }
  await page.locator('.ed-module[data-type="word-count"]').click();
  await page.fill('#cfgShortcut', 'Ctrl+');
  await page.click('#cfgSave');
  await page.screenshot({ path: 'tests/.shots/audit-editor-manca-il-tasto.png' });
  await page.click('#cfgCancel');

  await page.locator('.ed-module[data-type="word-count"]').click();
  await page.fill('#cfgShortcut', 'Ctrl Shift 2');
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
  await exitSettingsMode(page);
  await page.click('#doc');
  await page.keyboard.press('Control+Shift+Digit2');
  await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible();
});

// Invio in un campo del pannello conferma come «Salva», come Esc annulla (#545).
test('Invio nel campo della scorciatoia salva, e la scorciatoia parte', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [WC]);
  await enterSettingsMode(page);
  await page.locator('.ed-module[data-type="word-count"]').click();
  await page.fill('#cfgShortcut', 'Ctrl+S');
  await page.locator('#cfgShortcut').press('Enter');
  await expect(page.locator('#cfgShortcutTaken')).toContainText('salva il documento');
  await page.fill('#cfgShortcut', 'Ctrl+Shift+1');
  await page.locator('#cfgShortcut').press('Enter');
  await expect(page.locator('#overlay')).toBeHidden();
  await exitSettingsMode(page);
  await page.click('#doc');
  await page.keyboard.press('Control+Shift+Digit1');
  await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible();
});

// Su Mac l'avviso ripete la combinazione scritta (Ctrl si legge Cmd): le riscritture di Alt
// valgono per i tasti di Filo, e «Alt+1» diventava «Cmd+1», che lì è il salto di scheda (#545).
test('su Mac l\'avviso nomina la combinazione che hai scritto', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await page.addInitScript(() => {
    let tasti;
    Object.defineProperty(window, 'SN_TASTI', {
      configurable: true,
      get: () => tasti,
      set: (v) => {
        tasti = v;
        if (!v) return;
        const o = { ...v };
        v.suMac = () => true;
        v.piattaforma = () => 'darwin';
        for (const f of ['etichetta', 'etichettaScritta', 'riservato', 'delSistema', 'modificatoreCheCambiaSimbolo']) v[f] = (a) => o[f](a, 'darwin');
        v.tastiRiservati = () => o.tastiRiservati('darwin');
      },
    });
  });
  await apriDocConModuli(page, [{ ...WC, data: { count: 'words', shortcut: 'Alt+1' } }, COMMENT]);
  expect(await page.evaluate(() => window.SN_TASTI.suMac())).toBe(true);
  await enterSettingsMode(page);
  await page.locator('.ed-module[data-type="comment"]').click();
  for (const [scritto, atteso] of [
    ['Alt+1', /^Alt\+1 è già la scorciatoia di «Conteggio parole»/],
    ['Alt+-', /quindi Alt\+- non partirebbe mai/],
    ['Ctrl+S', /^Cmd\+S nell'Editor salva il documento/],
  ]) {
    await page.fill('#cfgShortcut', scritto);
    await page.click('#cfgSave');
    await expect(page.locator('#cfgShortcutTaken'), scritto).toHaveText(atteso);
  }
});
