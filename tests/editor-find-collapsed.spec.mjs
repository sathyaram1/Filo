// Feedback #385: nell'editor una corrispondenza dentro una sezione CHIUSA
// (freccia accanto al titolo) veniva contata dal riquadro "Cerca" ma non si
// vedeva: il contatore diceva "1/1" e sul foglio non si illuminava nulla,
// Prec/Succ non portavano da nessuna parte e "Sostituisci tutto" cambiava la
// parola nascosta senza mostrarla.
//
// Comportamento atteso (asserito qui): la sezione si apre da sola e la vista
// arriva sulla corrispondenza; "Tutto" apre le sezioni che ha toccato.
//
// Senza il fix questi assert sono ROSSI: il paragrafo resta nascosto
// (`display:none`) e Playwright lo vede come non visibile.

import { test, expect } from './fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

// Due sezioni: la seconda contiene la parola cercata. Ritorna la pagina pronta
// con il riquadro Cerca/Sostituisci aperto e la seconda sezione CHIUSA.
async function setupCollapsedDoc(page) {
  await page.waitForSelector('#doc');
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<h2>Introduzione</h2><p id="intro">una riga qualsiasi</p>'
      + '<h2>Capitolo segreto</h2><p id="segreto">Qui dentro si parla di ornitorinco</p>';
    doc.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  // Chiudi "Capitolo segreto" con la sua freccia.
  await page.locator('#doc h2', { hasText: 'Capitolo segreto' }).locator('.ed-collapse-toggle').click();
  await expect(page.locator('#doc #segreto')).toBeHidden();
  // Pagina "Revisione" (seconda icona dello switch) → modulo cerca e sostituisci.
  await page.locator('.ed-switch-icon').nth(1).click();
  await page.waitForSelector('[data-sr="find"]');
}

test('Cerca: una corrispondenza in una sezione chiusa apre la sezione e si evidenzia (#385)', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await setupCollapsedDoc(page);

  await page.fill('[data-sr="find"]', 'ornitorinco');

  // Il contatore dice di averla trovata…
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/1');
  // …e ora è VERO: la sezione si è riaperta e la parola è evidenziata a schermo.
  await expect(page.locator('#doc #segreto')).toBeVisible();
  await expect(page.locator('#doc mark.ed-find-hit.current')).toBeVisible();
  await expect(page.locator('#doc mark.ed-find-hit.current')).toHaveText('ornitorinco');
  // La freccia del titolo torna coerente con la sezione aperta.
  await expect(page.locator('#doc h2', { hasText: 'Capitolo segreto' }).locator('.ed-collapse-toggle'))
    .not.toHaveClass(/is-collapsed/);

  await page.screenshot({ path: 'tests/.shots/editor-find-collapsed-reveal.png' });
});

test('Sostituisci tutto: la sezione chiusa toccata viene aperta, non cambiata di nascosto (#385)', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await setupCollapsedDoc(page);

  await page.fill('[data-sr="find"]', 'ornitorinco');
  await page.fill('[data-sr="repl"]', 'canguro');
  await page.click('[data-sr="all"]');

  // La sostituzione è avvenuta ED è visibile senza dover riaprire nulla a mano.
  const par = page.locator('#doc #segreto');
  await expect(par).toBeVisible();
  await expect(par).toHaveText('Qui dentro si parla di canguro');
  await expect(page.locator('[data-sr="count"]')).toHaveText('nessun risultato');

  await page.screenshot({ path: 'tests/.shots/editor-find-collapsed-replace-all.png' });
});

test('Prec/Succ su corrispondenze in sezioni diverse riaprono quella di destinazione (#385)', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('#doc');
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<h2>Prima</h2><p id="p1">parola visibile</p>'
      + '<h2>Seconda</h2><p id="p2">parola nascosta</p>';
    doc.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await page.locator('#doc h2', { hasText: 'Seconda' }).locator('.ed-collapse-toggle').click();
  await expect(page.locator('#doc #p2')).toBeHidden();
  await page.locator('.ed-switch-icon').nth(1).click();
  await page.waitForSelector('[data-sr="find"]');

  await page.fill('[data-sr="find"]', 'parola');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/2');
  // La prima corrispondenza è nella sezione aperta: la seconda sezione resta chiusa.
  await expect(page.locator('#doc #p2')).toBeHidden();

  // "Succ" porta sulla corrispondenza nascosta → la sezione si apre.
  await page.click('[data-sr="next"]');
  await expect(page.locator('[data-sr="count"]')).toHaveText('2/2');
  await expect(page.locator('#doc #p2')).toBeVisible();
  const secondIsCurrent = await page.evaluate(() => {
    const hits = [...document.querySelectorAll('#doc mark.ed-find-hit')];
    return hits.length === 2 && hits[1].classList.contains('current');
  });
  expect(secondIsCurrent).toBe(true);
});

// ── #385 bis: la ricerca non deve lasciare aperte le sezioni di passaggio ──
//
// Scrivendo "ornitorinco" lettera per lettera la ricerca ripartiva a ogni tasto
// e "andava" sulla prima corrispondenza del prefisso: con "o" apriva la sezione
// di "ottimo", con "or" quella di "orso"… e quelle sezioni restavano aperte per
// sempre. Alla fine tre sezioni aperte invece di una, da richiudere a mano.
//
// Comportamento atteso: si apre solo la sezione della corrispondenza su cui ci
// si ferma davvero; le sezioni aperte di passaggio si richiudono da sé, e
// quelle aperte a mano dall'utente non si toccano mai.

// Tre sezioni tutte CHIUSE, ognuna con una parola che comincia per "o".
async function setupThreeClosedSections(page) {
  await page.waitForSelector('#doc');
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<h2>Uno</h2><p id="s1">un ottimo risultato</p>'
      + '<h2>Due</h2><p id="s2">un orso bruno</p>'
      + '<h2>Tre</h2><p id="s3">qui vive un ornitorinco</p>';
    doc.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  for (const t of ['Uno', 'Due', 'Tre']) {
    await page.locator('#doc h2', { hasText: t }).locator('.ed-collapse-toggle').click();
  }
  await expect(page.locator('#doc #s1')).toBeHidden();
  await expect(page.locator('#doc #s2')).toBeHidden();
  await expect(page.locator('#doc #s3')).toBeHidden();
  await page.locator('.ed-switch-icon').nth(1).click();
  await page.waitForSelector('[data-sr="find"]');
}

test('Cercando lettera per lettera si apre SOLO la sezione della parola cercata (#385)', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await setupThreeClosedSections(page);

  // Digitazione vera, un carattere alla volta (è il gesto che rompeva tutto).
  await page.locator('[data-sr="find"]').pressSequentially('ornitorinco', { delay: 60 });
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/1');

  // La sezione della corrispondenza si apre (e la parola si vede evidenziata).
  await expect(page.locator('#doc #s3')).toBeVisible();
  await expect(page.locator('#doc mark.ed-find-hit.current')).toHaveText('ornitorinco');
  // …e le sezioni attraversate dai prefissi ("o" → ottimo, "or" → orso) NON
  // restano aperte: l'impaginazione dell'utente è intatta.
  await expect(page.locator('#doc #s1')).toBeHidden();
  await expect(page.locator('#doc #s2')).toBeHidden();

  await page.screenshot({ path: 'tests/.shots/editor-find-only-target-section.png' });
});

test('Svuotare il campo Cerca richiude le sezioni aperte dalla ricerca, non le tue (#385)', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await setupThreeClosedSections(page);

  // L'utente riapre a mano la prima sezione: è una sua scelta, va rispettata.
  await page.locator('#doc h2', { hasText: 'Uno' }).locator('.ed-collapse-toggle').click();
  await expect(page.locator('#doc #s1')).toBeVisible();

  await page.fill('[data-sr="find"]', 'ornitorinco');
  await expect(page.locator('#doc #s3')).toBeVisible(); // aperta dalla ricerca

  // Campo svuotato = ricerca finita: torna com'era prima di cercare.
  await page.fill('[data-sr="find"]', '');
  await expect(page.locator('#doc #s3')).toBeHidden();
  await expect(page.locator('#doc h2', { hasText: 'Tre' }).locator('.ed-collapse-toggle'))
    .toHaveClass(/is-collapsed/);
  // La sezione aperta a mano resta aperta.
  await expect(page.locator('#doc #s1')).toBeVisible();
});

test('Una sostituzione lascia aperta la sezione toccata anche a ricerca finita (#385)', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await setupThreeClosedSections(page);

  await page.fill('[data-sr="find"]', 'ornitorinco');
  await page.fill('[data-sr="repl"]', 'canguro');
  await page.click('[data-sr="one"]');
  await expect(page.locator('#doc #s3')).toHaveText('qui vive un canguro');

  // Svuotare la ricerca NON deve nascondere una modifica appena fatta: quella
  // sezione è stata aperta per mostrare un cambiamento, non di passaggio.
  await page.fill('[data-sr="find"]', '');
  await expect(page.locator('#doc #s3')).toBeVisible();
  await expect(page.locator('#doc #s3')).toHaveText('qui vive un canguro');
});

test('Invio nel campo Cerca porta sulla corrispondenza e poi alla successiva (#385)', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await setupThreeClosedSections(page);

  const find = page.locator('[data-sr="find"]');
  // "or" sta in "orso" (sezione Due) e due volte in "ornitorinco" (sezione Tre).
  await find.fill('or');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/3');
  await expect(page.locator('#doc #s2')).toBeVisible(); // ci si ferma su "orso"

  // Invio = vai alla corrispondenza successiva: si apre la sezione di
  // destinazione e si richiude quella che la ricerca aveva aperto prima.
  await find.press('Enter');
  await expect(page.locator('[data-sr="count"]')).toHaveText('2/3');
  await expect(page.locator('#doc #s3')).toBeVisible(); // "ornitorinco"
  await expect(page.locator('#doc #s2')).toBeHidden();

  // Shift+Invio torna indietro.
  await find.press('Shift+Enter');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/3');
  await expect(page.locator('#doc #s2')).toBeVisible();
  await expect(page.locator('#doc #s3')).toBeHidden();
});

// Invariante di contorno sul collasso annidato (stessa causa: lo stato di
// collasso va RICALCOLATO dai titoli, non togglato in loco). Riaprendo una
// sezione grande, una sotto-sezione ancora chiusa deve restare chiusa.
test('Riaprire una sezione non fa sbucare le sotto-sezioni ancora chiuse', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('#doc');
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<h1>Capitolo</h1><p id="a">testo del capitolo</p>'
      + '<h2>Paragrafo</h2><p id="b">testo del paragrafo</p>';
    doc.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  const h1Toggle = page.locator('#doc h1').locator('.ed-collapse-toggle');
  const h2Toggle = page.locator('#doc h2').locator('.ed-collapse-toggle');

  // Chiudi la sotto-sezione, poi il capitolo intero.
  await h2Toggle.click();
  await expect(page.locator('#doc #b')).toBeHidden();
  await h1Toggle.click();
  await expect(page.locator('#doc #a')).toBeHidden();
  await expect(page.locator('#doc h2')).toBeHidden();

  // Riapri il capitolo: torna visibile il suo testo e il titolo della
  // sotto-sezione, ma il contenuto della sotto-sezione resta chiuso.
  await h1Toggle.click();
  await expect(page.locator('#doc #a')).toBeVisible();
  await expect(page.locator('#doc h2')).toBeVisible();
  await expect(page.locator('#doc #b')).toBeHidden();
  await expect(page.locator('#doc h2').locator('.ed-collapse-toggle')).toHaveClass(/is-collapsed/);
});
