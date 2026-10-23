// Le scorciatoie personalizzate degli strumenti dell'Editor (#545), che dal #1433 stanno nel pannello di destra e si
// regolano dall'ingranaggio o dal tasto destro sullo strumento. Una scorciatoia senza modificatore, presa da Filo o
// dall'Editor, o già di un altro strumento si rifiuta dicendo perché; una valida, premuta, fa quello che fa il clic.

import { test, expect } from './fixtures/electron.mjs';
import { EDITOR, apriImpostazioni, apriPannello, aspettaStrumenti, pannelloAperto, seminaStrumenti, strumentiSalvati, strumento } from './helpers/strumentiEditor.mjs';

// Un documento che dice «ciao mondo», con nel pannello gli strumenti scelti e le loro regolazioni.
async function apriDocConStrumenti(app, page, elementi, config = {}) {
  await seminaStrumenti(app, elementi, config);
  await page.evaluate(() => {
    const now = new Date().toISOString();
    const raw = {
      id: 'file-tasti', meta: { title: 'Tasti', created: now, modified: now, version: 1 },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ciao mondo' }] }] },
      comments: [],
    };
    localStorage.setItem('filo.editor.collection', JSON.stringify({ version: 2, activeId: raw.id, files: [raw] }));
  });
  await page.reload();
  await aspettaStrumenti(page);
  await expect(page.locator('#doc')).toBeVisible();
}

async function apriEditor(openTab) {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();
  return page;
}

const WC = 'word-count';
const scorciatoia = (sc) => ({ shortcut: sc });

// Il salvataggio deve RIFIUTARE una scorciatoia senza modificatore reale (una
// lettera nuda) e avvisare: non viene applicata, quindi non ruba il tasto.
test('una scorciatoia senza modificatore viene rifiutata al salvataggio', async ({ openTab }) => {
  const page = await apriEditor(openTab);

  // Dal tasto destro sullo strumento nel pannello, la sua voce «Impostazioni di…».
  await apriImpostazioni(page, WC, { via: 'menu' });
  await expect(page.locator('#overlay h3')).toHaveText('Conteggio');
  await page.fill('#cfgShortcut', 'b');
  await page.click('#cfgSave');

  // ATTESO: il riquadro resta aperto con l'avviso e il campo marcato invalido.
  await expect(page.locator('#cfgShortcutHint')).toBeVisible();
  await expect(page.locator('#cfgShortcut')).toHaveClass(/ed-field-invalid/);

  await page.click('#cfgCancel');
  await page.click('#doc');
  await page.keyboard.type('banana', { delay: 30 });

  await page.screenshot({ path: 'tests/.shots/audit-editor-shortcut-rejected.png' });

  // La lettera "b" non è stata rubata: la parola si scrive intera, niente overlay.
  await expect(page.locator('#overlay')).toBeHidden();
  expect(await page.locator('#doc').innerText()).toContain('banana');
});

// Difesa per i documenti salvati PRIMA del controllo: un vecchio modulo con una scorciatoia senza modificatore
// passa allo strumento del pannello (#1433), e il listener globale non deve rubarla mentre si scrive.
test('una scorciatoia senza modificatore GIÀ salvata non ruba la lettera mentre si scrive', async ({ openTab }) => {
  const page = await apriEditor(openTab);
  await page.evaluate(() => {
    const now = new Date().toISOString();
    const raw = {
      id: 'file-inj', meta: { title: 'Legacy', created: now, modified: now, version: 1 },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
      comments: [],
      modules: [{ id: 'legacy-wc', type: 'word-count', cells: [{ x: 0, y: 0 }], data: { count: 'chars', shortcut: 'b' } }],
    };
    localStorage.setItem('filo.editor.collection', JSON.stringify({ version: 2, activeId: raw.id, files: [raw] }));
  });
  await page.reload();
  // Il conteggio dei caratteri dice che le regolazioni del vecchio modulo sono arrivate allo strumento.
  await expect(strumento(page, WC).locator('.wc-cap')).toHaveText('caratteri');

  await page.click('#doc');
  await page.keyboard.type('banana', { delay: 30 });

  await page.screenshot({ path: 'tests/.shots/audit-editor-shortcut-legacy.png' });

  // ATTESO: la parola si scrive intera e nessun overlay statistiche si apre.
  await expect(page.locator('#overlay')).toBeHidden();
  expect(await page.locator('#doc').innerText()).toContain('banana');
});

// La scorciatoia consigliata come esempio ("Ctrl+Shift+1") DEVE attivare lo
// strumento: premendo Shift+1 la tastiera genera "!" (non "1"), quindi il match usa
// anche il tasto FISICO (Digit1), così Shift non spezza la scorciatoia.
test('la scorciatoia Ctrl+Shift+1 di uno strumento si attiva davvero', async ({ app, openTab }) => {
  const page = await apriEditor(openTab);
  await apriDocConStrumenti(app, page, [WC], { [WC]: scorciatoia('Ctrl+Shift+1') });
  await expect(page.locator('#overlay')).toBeHidden();

  await page.keyboard.press('Control+Shift+Digit1');

  await page.screenshot({ path: 'tests/.shots/audit-editor-shortcut-ctrl-shift-1.png' });

  // ATTESO: l'overlay statistiche del conteggio si apre → la scorciatoia ha attivato lo strumento.
  await expect(page.locator('#overlay')).toBeVisible();
});

// Uno strumento sta nel pannello una volta sola: il «+» offre solo quelli che mancano, e chiederlo di nuovo a Filo non
// lo raddoppia.
test('uno strumento già nel pannello non si aggiunge una seconda volta', async ({ app, openTab }) => {
  const page = await apriEditor(openTab);
  await page.waitForSelector('.pd-elemento[data-elemento="word-count"]', { state: 'attached' });
  await apriPannello(page);
  await page.click('.pd-piu');
  await expect(page.locator('.pd-catalogo .pd-voce[data-elemento="bold"]')).toBeVisible();
  for (const id of [WC, 'search-replace', 'comment']) {
    await expect(page.locator(`.pd-catalogo .pd-voce[data-elemento="${id}"]`), id).toHaveCount(0);
  }
  await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: 'conteggio' }));
  await page.waitForTimeout(300);
  await expect(page.locator('.pd-elementi > .pd-elemento[data-elemento="word-count"]')).toHaveCount(1);
  expect((await strumentiSalvati(app) || { elementi: [WC] }).elementi.filter((id) => id === WC)).toHaveLength(1);
  await page.screenshot({ path: 'tests/.shots/audit-editor-strumento-unico.png' });
});

// Una scorciatoia che Filo si prende PRIMA della pagina (chiudi scheda,
// ricarica, salto di scheda… e su Mac tutta la barra dei menu in cima allo
// schermo) non arriverebbe mai allo strumento: il salvataggio la rifiuta dicendo chi si prende quel tasto.
test('una scorciatoia che Filo si prende prima viene rifiutata', async ({ openTab }) => {
  const page = await apriEditor(openTab);
  await apriImpostazioni(page, WC);

  // Ctrl+W chiude la scheda: il main la intercetta prima di qualunque pagina,
  // su ogni sistema. (Su Mac la lista è più lunga: vedi tests/unit/macSupport.test.mjs.)
  await page.fill('#cfgShortcut', 'Ctrl+W');
  await page.click('#cfgSave');

  // Il riquadro resta aperto, il campo è marcato e l'avviso dice perché.
  await expect(page.locator('#cfgShortcutTaken')).toBeVisible();
  await expect(page.locator('#cfgShortcutTaken')).toContainText('già di Filo');
  await expect(page.locator('#cfgShortcut')).toHaveClass(/ed-field-invalid/);

  // Correggendola con una combinazione libera il salvataggio passa: il riquadro
  // si chiude. (Senza questo pezzo il test passerebbe anche se il campo rifiutasse TUTTO.)
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
  // Ctrl+Su no: nel foglio sale di un paragrafo, e uno strumento non la prende.
  { scritto: 'Alt+Up', premi: 'Alt+ArrowUp' },
  { scritto: 'Control+Shift+2', premi: 'Control+Shift+Digit2' },
  // Su Windows Ctrl+Esc apre Start: lì il campo la rifiuta (prova sotto).
  ...(process.platform === 'win32' ? [] : [{ scritto: 'Ctrl+Esc', premi: 'Control+Escape' }]),
];
for (const { scritto, premi } of NOMI) {
  test(`la scorciatoia «${scritto}» salvata dall'Editor apre lo strumento`, async ({ openTab }) => {
    const page = await apriEditor(openTab);
    await apriImpostazioni(page, WC);
    await page.fill('#cfgShortcut', scritto);
    await page.click('#cfgSave');
    await expect(page.locator('#overlay')).toBeHidden();

    await page.click('#doc');
    await page.keyboard.press(premi);
    await expect(page.locator('#overlay')).toBeVisible();
    await expect(page.locator('#overlay')).toContainText(/parole/i);
  });
}

test('un nome di tasto che Filo non riconosce viene rifiutato al salvataggio', async ({ openTab }) => {
  const page = await apriEditor(openTab);
  await apriImpostazioni(page, WC);
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
  const page = await apriEditor(openTab);
  await apriImpostazioni(page, WC);
  await page.fill('#cfgShortcut', 'Ctrl+Win+2');
  await page.click('#cfgSave');
  await expect(page.locator('#cfgShortcut')).toHaveClass(/ed-field-invalid/);
  await expect(page.locator('#cfgShortcutTaken')).toContainText('Win');
  await page.screenshot({ path: 'tests/.shots/audit-editor-shortcut-modificatore-ignoto.png' });

  await page.fill('#cfgShortcut', 'Ctrl+Maiusc+2');
  await page.click('#cfgSave');
  await expect(page.locator('#cfgShortcut')).toBeHidden();
  await page.click('#doc');
  await page.keyboard.type('una prova', { delay: 10 });
  await page.keyboard.press('Control+Shift+Digit2');
  await expect(page.locator('#overlay')).toContainText('Statistiche documento');
});

// I tasti che l'Editor serve da sé (salva, pannello, ricerca, zoom del
// foglio, grassetto, copia/incolla…) passano PRIMA degli strumenti: uno strumento che
// se ne prendeva uno si salvava in silenzio e non partiva mai, mentre il tasto
// faceva l'altra cosa (#545).
test('una scorciatoia che l\'Editor usa già viene rifiutata, dicendo cosa fa quel tasto', async ({ app, openTab }) => {
  const page = await apriEditor(openTab);
  await apriDocConStrumenti(app, page, [WC, 'search-replace']);
  await apriImpostazioni(page, WC);

  for (const [sc, dice] of [
    ['Ctrl+S', 'salva il documento'],
    ['Ctrl+\\', 'pannello degli strumenti'],
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

  // Una libera passa, e premuta apre davvero lo strumento.
  await page.fill('#cfgShortcut', 'Ctrl+Shift+S');
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
  await page.click('#doc');
  await page.keyboard.press('Control+Shift+KeyS');
  await expect(page.locator('#overlay')).toBeVisible();
});

// Il tasto che fa già la cosa dello strumento resta suo: Ctrl+F sul Cerca e
// sostituisci porta alla ricerca in entrambi i casi.
test('lo strumento a cui il tasto dell\'Editor appartiene può averlo', async ({ app, openTab }) => {
  const page = await apriEditor(openTab);
  await apriDocConStrumenti(app, page, [WC, 'search-replace', 'bold']);

  await apriImpostazioni(page, 'search-replace');
  await page.fill('#cfgShortcut', 'Ctrl+F');
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
  await apriImpostazioni(page, 'bold');
  await page.fill('#cfgShortcut', 'Ctrl+B');
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
  await expect.poll(async () => ((await strumentiSalvati(app)).config.bold || {}).shortcut).toBe('Ctrl+B');
});

// Due strumenti con la stessa scorciatoia: partiva solo il primo, l'altro mai. Si controlla anche contro quelli
// fuori dal pannello, che si possono rimettere: rubargliela vorrebbe dire scoprirlo solo dopo.
test('una scorciatoia già di un altro strumento viene rifiutata col nome di quello strumento, anche se è fuori dal pannello', async ({ app, openTab }) => {
  const page = await apriEditor(openTab);
  await apriDocConStrumenti(app, page, [WC, 'comment'], { [WC]: scorciatoia('Ctrl+Shift+1'), bold: scorciatoia('Ctrl+Shift+3') });

  // L'ingranaggio elenca tutti gli strumenti, e di quello fuori dal pannello dice la scorciatoia e dove sta.
  await apriPannello(page);
  await strumento(page, 'settings').locator('.ed-strumenti-btn').click();
  const grassetto = page.locator('#overlay [data-strumento="bold"] .ed-strumento-nota');
  await expect(grassetto).toContainText('Ctrl+Shift+3');
  await expect(grassetto).toContainText('non nel pannello');
  await page.locator('#overlay [data-strumento="comment"]').click();

  // L'esempio proposto è libero davvero: non ripropone quella già presa.
  await expect(page.locator('#cfgShortcut')).toHaveAttribute('placeholder', /Shift\+2/);
  await page.fill('#cfgShortcut', 'ctrl+shift+1');
  await page.click('#cfgSave');
  await expect(page.locator('#cfgShortcutTaken')).toBeVisible();
  await expect(page.locator('#cfgShortcutTaken')).toContainText('«Conteggio»');
  await expect(page.locator('#cfgShortcutTaken')).toContainText('Shift+2');

  await page.fill('#cfgShortcut', 'Ctrl+Shift+3');
  await page.click('#cfgSave');
  await expect(page.locator('#cfgShortcutTaken')).toContainText('«Grassetto»');
  await expect(page.locator('#overlay')).toBeVisible();
});

// Chi l'aveva già salvata prima di questi controlli se lo sente dire appena
// apre lo strumento, non solo se la riscrive.
test('una scorciatoia morta già salvata è segnalata all\'apertura dello strumento', async ({ app, openTab }) => {
  const page = await apriEditor(openTab);
  await apriDocConStrumenti(app, page, [WC], { [WC]: scorciatoia('Ctrl+S') });

  await apriImpostazioni(page, WC);
  await expect(page.locator('#cfgShortcutTaken')).toBeVisible();
  await expect(page.locator('#cfgShortcutTaken')).toContainText('salva il documento');
});

// I tasti dell'Editor, passati per la stessa tabella, fanno ancora la loro cosa.
test('grassetto, pannello degli strumenti e zoom da tastiera funzionano ancora', async ({ app, openTab }) => {
  const page = await apriEditor(openTab);
  await apriDocConStrumenti(app, page, [WC]);

  await page.click('#doc');
  await page.keyboard.press('Control+KeyA');
  await page.keyboard.press('Control+KeyB');
  await expect(page.locator('#doc b, #doc strong').first()).toContainText('ciao');

  const prima = await pannelloAperto(page);
  await page.keyboard.press('Control+Backslash');
  await expect.poll(() => pannelloAperto(page)).toBe(!prima);

  await page.keyboard.press('Control+Equal');
  expect(await page.evaluate(() => document.getElementById('doc').style.zoom)).not.toBe('');
  await page.keyboard.press('Control+Digit0');
  expect(await page.evaluate(() => document.getElementById('doc').style.zoom)).toBe('');
});

// #545: la scorciatoia di uno strumento fa quello che fa il suo clic, non solo
// portarlo in vista (Grassetto e Indietro la salvavano e poi non facevano niente).
test('la scorciatoia di Grassetto, Indietro e Cerca e sostituisci fa la cosa dello strumento', async ({ app, openTab }) => {
  const page = await apriEditor(openTab);
  await apriDocConStrumenti(app, page, [WC, 'bold', 'undo', 'search-replace']);

  for (const [id, sc] of [['bold', 'Ctrl+G'], ['undo', 'Ctrl+Shift+2'], ['search-replace', 'Ctrl+Shift+4']]) {
    await apriImpostazioni(page, id);
    await page.fill('#cfgShortcut', sc);
    await page.click('#cfgSave');
    await expect(page.locator('#overlay'), sc).toBeHidden();
  }

  await page.click('#doc');
  await page.keyboard.press('Control+KeyA');
  await page.keyboard.press('Control+KeyG');
  await expect(page.locator('#doc b, #doc strong').first()).toContainText('ciao');

  await page.keyboard.press('End');
  await page.keyboard.type(' xyz', { delay: 20 });
  await expect(page.locator('#doc')).toContainText('xyz');
  await page.keyboard.press('Control+Shift+Digit2');
  await expect(page.locator('#doc')).not.toContainText('xyz');

  // Cerca e sostituisci vuole il suo campo: il tasto apre il pannello e ci porta.
  expect(await pannelloAperto(page)).toBe(false);
  await page.keyboard.press('Control+Shift+Digit4');
  await expect(strumento(page, 'search-replace').locator('[data-sr="find"]')).toBeFocused();
  expect(await pannelloAperto(page)).toBe(true);
});

// Allineamento e Font hanno più azioni: niente scorciatoia da offrire.
test('uno strumento senza un\'azione unica non offre la scorciatoia', async ({ app, openTab }) => {
  const page = await apriEditor(openTab);
  await apriDocConStrumenti(app, page, ['align', 'font']);

  for (const id of ['align', 'font']) {
    await apriImpostazioni(page, id);
    await expect(page.locator('#cfgShortcut'), id).toBeHidden();
    await page.click('#cfgCancel');
  }
});

// Con Shift un simbolo diventa un altro, diverso per ogni tastiera (la barra rovesciata diventa la barra
// verticale): scritto così non si sa quale tasto sia, premuto sì (#893). Si simula la tastiera americana.
test('un simbolo con Shift, o senza un tasto suo, si preme invece di scriverlo, e premuto parte', async ({ app, openTab }) => {
  const page = await apriEditor(openTab);
  await page.addInitScript(() => {
    const voci = [['Backslash', '\\'], ['Slash', '/'], ['Comma', ','], ['Minus', '-'], ['Equal', '='], ['Digit1', '1']];
    Object.defineProperty(navigator.keyboard, 'getLayoutMap', { configurable: true, value: async () => new Map(voci) });
  });
  await apriDocConStrumenti(app, page, [WC]);

  await apriImpostazioni(page, WC);
  for (const [sc, dice] of [['Ctrl+Shift+\\', 'Con Shift'], ['Ctrl+Shift+/', 'Con Shift'], ['Ctrl+Maiusc+,', 'Con Shift'],
    ['Ctrl+Shift+|', 'non ha un tasto suo'], ['Ctrl+|', 'non ha un tasto suo']]) {
    await page.fill('#cfgShortcut', sc);
    await page.click('#cfgSave');
    await expect(page.locator('#cfgShortcutTaken'), sc).toContainText(dice);
    await expect(page.locator('#cfgShortcutTaken'), sc).toContainText('premi la combinazione');
  }
  await page.locator('#cfgShortcut').click();
  await page.keyboard.press('Control+Shift+Backslash');
  await expect(page.locator('#cfgShortcut')).toHaveValue('Ctrl+Shift+\\');
  await expect(page.locator('#cfgShortcutTaken')).toBeHidden();
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
  await page.click('#doc');
  await page.keyboard.press('Control+Shift+Backslash');
  await expect(page.locator('#overlay')).toContainText('Statistiche documento');
});

// L'esempio di un avviso si sceglie con la stessa regola che rifiuta: chi lo
// segue non se lo vede rifiutare, anche con Ctrl+Shift+1 già su un altro strumento.
test('l\'esempio proposto da ogni avviso si salva davvero', async ({ app, openTab }) => {
  const page = await apriEditor(openTab);
  await apriDocConStrumenti(app, page, [WC, 'comment'], { [WC]: scorciatoia('Ctrl+Shift+1') });

  for (const sc of ['Alt+F4', 'Ctrl+Pippo+2', 'Ctrl+Spazioo', 'Ctrl+S', 'ctrl+shift+1']) {
    await apriImpostazioni(page, 'comment');
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

// Ctrl+Z su Indietro si accetta perché il tasto fa già la sua cosa: deve
// farla anche col cursore fuori dal testo, dove il browser non annulla (#545).
test('Ctrl+Z annulla anche dopo un clic su uno strumento, come il clic su Indietro', async ({ app, openTab }) => {
  const page = await apriEditor(openTab);
  await apriDocConStrumenti(app, page, [WC, 'undo']);

  await apriImpostazioni(page, 'undo');
  await page.fill('#cfgShortcut', 'Ctrl+Z');
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();

  await page.click('#doc');
  await page.keyboard.press('End');
  await page.keyboard.type(' ABC');
  await page.waitForTimeout(300);
  const scritto = await page.locator('#doc').innerText();
  await apriPannello(page);
  await strumento(page, WC).locator('.ed-wc').click();
  await expect(page.locator('#overlay')).toBeVisible();
  await page.locator('#overlay').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#overlay')).toBeHidden();
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).not.toBe('doc');

  await page.keyboard.press('Control+KeyZ');
  await expect.poll(() => page.locator('#doc').innerText(), { timeout: 2000 }).not.toBe(scritto);
  // Dentro un campo di testo Ctrl+Z resta di quel campo.
  await apriImpostazioni(page, WC);
  await page.fill('#cfgShortcut', 'Ctrl+Shift+7');
  const doc = await page.locator('#doc').innerText();
  await page.keyboard.press('Control+KeyZ');
  await page.waitForTimeout(200);
  expect(await page.locator('#doc').innerText()).toBe(doc);
  // Tolta la scorciatoia, Ctrl+Z fuori dal testo torna alla regola di Filo.
  await page.click('#cfgCancel');
  await apriImpostazioni(page, 'undo');
  await page.fill('#cfgShortcut', '');
  await page.click('#cfgSave');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.filoCtrlZ)).toBeUndefined();
});

// A riquadro aperto la tastiera è del riquadro: Esc lo chiude, e una combinazione
// premuta nel campo della scorciatoia non agisce sul foglio, sul pannello o sugli strumenti dietro (#545).
test('a riquadro aperto Esc chiude e i tasti non agiscono dietro', async ({ app, openTab }) => {
  const page = await apriEditor(openTab);
  await apriDocConStrumenti(app, page, [WC, 'comment'], { [WC]: scorciatoia('Ctrl+Shift+1') });

  await apriPannello(page);
  await strumento(page, WC).locator('.ed-wc').click();
  await expect(page.locator('#overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#overlay')).toBeHidden();
  // Esc ha chiuso il riquadro, non il pannello da cui era partito.
  expect(await pannelloAperto(page)).toBe(true);

  await apriImpostazioni(page, 'comment');
  await page.click('#cfgShortcut');
  await page.keyboard.press('Control+Backslash');
  await page.keyboard.press('Control+Shift+Digit1');
  await page.waitForTimeout(250);
  await expect(page.locator('#cfgShortcut')).toHaveCount(1);
  await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toHaveCount(0);
  expect(await pannelloAperto(page), 'Ctrl+\\ premuto nel campo si registra, non chiude il pannello').toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#overlay')).toBeHidden();

  // Chiuso il riquadro, i tasti tornano al foglio e agli strumenti.
  await page.click('#doc');
  await page.keyboard.press('Control+Shift+Digit1');
  await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible();
});

// Fuori dal testo Ctrl+Z torna alla pagina precedente (#267): se Indietro l'ha
// salvato, nell'Editor vince lo strumento; tolto, la regola di Filo torna (#545).
test('con cronologia dietro, Ctrl+Z salvato su Indietro annulla e non porta via dall\'Editor', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await page.evaluate((u) => { window.location.href = u; }, EDITOR);
  await page.waitForURL((u) => u.href.startsWith(EDITOR), { timeout: 10_000 });
  await apriDocConStrumenti(app, page, [WC, 'undo'], { undo: scorciatoia('Ctrl+Z') });
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

  await page.click('#doc');
  await page.keyboard.press('End');
  await page.keyboard.type(' ABC');
  await page.waitForTimeout(300);
  const scritto = await page.locator('#doc').innerText();
  await apriPannello(page);
  await strumento(page, WC).locator('.ed-wc').click();
  await page.locator('#overlay').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#overlay')).toBeHidden();
  await page.keyboard.press('Control+KeyZ');
  await expect.poll(() => page.locator('#doc').innerText(), { timeout: 2000 }).not.toBe(scritto);
  await page.waitForTimeout(500);
  expect(page.url()).toContain('editor');

  await apriImpostazioni(page, 'undo');
  await page.fill('#cfgShortcut', '');
  await page.click('#cfgSave');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.filoCtrlZ)).toBeUndefined();
  await page.keyboard.press('Control+KeyZ');
  await page.waitForURL((u) => u.href.startsWith('filo://newtab'), { timeout: 8_000 });
});

// Su Mac il browser non ripete con Cmd+Y (lì i tasti di modifica passano dalla barra dei menu):
// l'Editor non deve contarlo fra i suoi, o Avanti con Cmd+Y tace mentre si scrive (#545).
// Qui il Mac si simula: l'Editor chiede il sistema a SN_TASTI, che si tiene da quando si carica.
test('su Mac Cmd+Y dato ad Avanti ripete anche mentre si scrive, e non si rifiuta altrove', async ({ app, openTab }) => {
  const page = await apriEditor(openTab);
  await page.addInitScript(() => {
    let tasti;
    Object.defineProperty(window, 'SN_TASTI', {
      configurable: true,
      get: () => tasti,
      set: (v) => { tasti = v; if (v) v.suMac = () => true; },
    });
  });
  await apriDocConStrumenti(app, page, [WC, 'redo']);
  expect(await page.evaluate(() => window.SN_TASTI.suMac())).toBe(true);

  await apriImpostazioni(page, WC);
  await page.fill('#cfgShortcut', 'Cmd+Y');
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
  await apriImpostazioni(page, WC);
  await page.fill('#cfgShortcut', '');
  await page.click('#cfgSave');
  await expect.poll(async () => ((await strumentiSalvati(app)).config[WC] || {}).shortcut || '').toBe('');
  await apriImpostazioni(page, 'redo');
  await page.fill('#cfgShortcut', 'Cmd+Y');
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();

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
test('«Ctrl Shift 2» parte come Ctrl+Shift+2, e «Ctrl+» dice che manca il tasto', async ({ app, openTab }) => {
  const page = await apriEditor(openTab);
  await apriDocConStrumenti(app, page, [WC]);

  for (const [scritto, atteso] of [['Ctrl+', /Manca il tasto/], ['Ctrl-Shift', /Manca il tasto/], ['Ctrl-S', /salva il documento/]]) {
    await apriImpostazioni(page, WC);
    await page.fill('#cfgShortcut', scritto);
    await page.click('#cfgSave');
    await expect(page.locator('#cfgShortcutTaken'), scritto).toHaveText(atteso);
    await expect(page.locator('#cfgShortcutHint'), scritto).toBeHidden();
    await page.click('#cfgCancel');
  }
  await apriImpostazioni(page, WC);
  await page.fill('#cfgShortcut', 'Ctrl+');
  await page.click('#cfgSave');
  await page.screenshot({ path: 'tests/.shots/audit-editor-manca-il-tasto.png' });
  await page.click('#cfgCancel');

  await apriImpostazioni(page, WC);
  await page.fill('#cfgShortcut', 'Ctrl Shift 2');
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
  await page.click('#doc');
  await page.keyboard.press('Control+Shift+Digit2');
  await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible();
});

// Invio in un campo del riquadro conferma come «Salva», come Esc annulla (#545).
test('Invio nel campo della scorciatoia salva, e la scorciatoia parte', async ({ app, openTab }) => {
  const page = await apriEditor(openTab);
  await apriDocConStrumenti(app, page, [WC]);
  await apriImpostazioni(page, WC);
  await page.fill('#cfgShortcut', 'Ctrl+S');
  await page.locator('#cfgShortcut').press('Enter');
  await expect(page.locator('#cfgShortcutTaken')).toContainText('salva il documento');
  await page.fill('#cfgShortcut', 'Ctrl+Shift+1');
  await page.locator('#cfgShortcut').press('Enter');
  await expect(page.locator('#overlay')).toBeHidden();
  await page.click('#doc');
  await page.keyboard.press('Control+Shift+Digit1');
  await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible();
});

// Su Mac l'avviso ripete la combinazione scritta (Ctrl si legge Cmd): le riscritture di Alt
// valgono per i tasti di Filo, e «Alt+1» diventava «Cmd+1», che lì è il salto di scheda (#545).
test('su Mac l\'avviso nomina la combinazione che hai scritto', async ({ app, openTab }) => {
  const page = await apriEditor(openTab);
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
  await apriDocConStrumenti(app, page, [WC, 'comment'], { [WC]: scorciatoia('Alt+1') });
  expect(await page.evaluate(() => window.SN_TASTI.suMac())).toBe(true);
  await apriImpostazioni(page, 'comment');
  for (const [scritto, atteso] of [
    ['Alt+1', /^Alt\+1 è già la scorciatoia di «Conteggio»/],
    ['Alt+Shift+-', /quindi Alt\+Shift\+- scritta così non partirebbe mai/],
    ['Ctrl+S', /^Cmd\+S nell'Editor salva il documento/],
  ]) {
    await page.fill('#cfgShortcut', scritto);
    await page.click('#cfgSave');
    await expect(page.locator('#cfgShortcutTaken'), scritto).toHaveText(atteso);
  }
});

// #842: i tasti di Spiega, Traduci, Salva e Aiuto li sceglie l'utente. Cambiata Traduci, la combinazione vecchia
// torna libera per uno strumento e la nuova è presa; #545.5: Ctrl+Shift+T è della shell (#1476: riapre la scheda chiusa).
test('una scorciatoia di strumento segue i tasti scelti per le azioni di Filo', async ({ app, openTab }) => {
  const page = await apriEditor(openTab);
  const r = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION(
    { type: 'IMPOSTA_PREFERENZA', chiave: 'scorciatoia', valore: 'Traduci: Ctrl+Shift+Y' }, { sender: null }));
  expect(r.executed).toBe(true);
  await expect.poll(() => page.evaluate(() => window.SN_TASTI.scorciatoiaFilo('translate-selection'))).toBe('Ctrl+Shift+Y');

  await apriImpostazioni(page, WC);
  for (const [scritto, atteso] of [
    ['Ctrl+Shift+Y', /«Traduci»/],
    ['Ctrl+Shift+T', /già di Filo \(riapre l'ultima scheda chiusa\)/],
    ['Ctrl+Shift+R', /ricarica la pagina/],
  ]) {
    await page.fill('#cfgShortcut', scritto);
    await page.click('#cfgSave');
    await expect(page.locator('#cfgShortcutTaken'), scritto).toBeVisible();
    await expect(page.locator('#cfgShortcutTaken'), scritto).toHaveText(atteso);
  }
  await page.fill('#cfgShortcut', 'Alt+T');
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
});
