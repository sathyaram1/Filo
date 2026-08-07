// Test per la pagina "Gestisci correttore" (filo://spellcheck/spellcheck.html):
//
// Feedback 38Tfo78fXtrWA0MUNro8 — dizionario personale preserva il casing originale
//   - Aggiungendo "iPhone" deve comparire in lista come "iPhone", non "iphone"
//   - Aggiungendo di nuovo "iphone" (casing diverso) non deve creare un duplicato
//
// Feedback 4GBMRPWXgBrsqI1xDJaG — rinominare trigger autocorrect su collisione avvisa
//   - Crea 'colore'→'colour' e 'sapore'→'savour'
//   - Rinomina il trigger della seconda in 'colore'
//   - La regola 'colore'→'colour' deve essere ancora presente (non sovrascritta)
//   - Deve comparire un avviso di conflitto

import { test, expect } from './fixtures/electron.mjs';

const URL_SPELLCHECK = 'filo://spellcheck/spellcheck.html';

async function openSpellcheckPage(openTab) {
  const page = await openTab(URL_SPELLCHECK);
  // Aspetta che la pagina sia carica (il DOMContentLoaded popola i campi).
  await page.waitForFunction(() => {
    const el = document.getElementById('addDict');
    return el && el.textContent.length > 0;
  }, null, { timeout: 8_000 });
  return page;
}

// ---------------------------------------------------------------------------
// Feedback 1: casing preservato nel dizionario personale
// ---------------------------------------------------------------------------
test('dizionario personale preserva il casing originale (iPhone resta iPhone, non iphone)', async ({ openTab }) => {
  const page = await openSpellcheckPage(openTab);

  // Aggiungi "iPhone" con casing misto
  await page.fill('#newDictWord', 'iPhone');
  await page.click('#addDict');

  // Aspetta che la lista venga aggiornata
  await page.waitForFunction(() => {
    const list = document.getElementById('dictList');
    return list && list.querySelectorAll('.sn-spell-word').length > 0;
  }, null, { timeout: 4_000 });

  // ASSERISCE IL SUCCESSO: la parola in lista deve essere "iPhone" (casing preservato)
  const wordSpans = page.locator('#dictList .sn-spell-word');
  await expect(wordSpans).toHaveCount(1);
  await expect(wordSpans.first()).toHaveText('iPhone');
});

test('dizionario personale dedup case-insensitive: aggiungere "iphone" dopo "iPhone" non crea duplicati', async ({ openTab }) => {
  const page = await openSpellcheckPage(openTab);

  // Aggiungi prima "iPhone"
  await page.fill('#newDictWord', 'iPhone');
  await page.click('#addDict');
  await page.waitForFunction(() => {
    return document.getElementById('dictList')?.querySelectorAll('.sn-spell-word').length > 0;
  }, null, { timeout: 4_000 });

  // Poi aggiungi "iphone" (casing diverso) — non deve creare duplicato
  await page.fill('#newDictWord', 'iphone');
  await page.click('#addDict');
  await page.waitForTimeout(300);

  // Deve esserci ancora una sola parola in lista
  const wordSpans = page.locator('#dictList .sn-spell-word');
  await expect(wordSpans).toHaveCount(1);
  // Il casing originale ("iPhone") deve essere preservato
  await expect(wordSpans.first()).toHaveText('iPhone');
});

// ---------------------------------------------------------------------------
// Feedback 2: collisione trigger autocorrect mostra avviso e non sovrascrive
// ---------------------------------------------------------------------------
test('rinominare trigger autocorrect su una chiave già esistente mostra avviso e NON perde la regola originale', async ({ openTab }) => {
  const page = await openSpellcheckPage(openTab);

  // Aggiungi 'colore' → 'colour'
  await page.fill('#newWord', 'colore');
  await page.fill('#newCorrection', 'colour');
  await page.click('#addAutocorrect');
  await page.waitForFunction(() => {
    return document.getElementById('autocorrectList')?.querySelectorAll('.sn-spell-row:not(.sn-spell-row-head)').length >= 1;
  }, null, { timeout: 4_000 });

  // Aggiungi 'sapore' → 'savour'
  await page.fill('#newWord', 'sapore');
  await page.fill('#newCorrection', 'savour');
  await page.click('#addAutocorrect');
  await page.waitForFunction(() => {
    return document.getElementById('autocorrectList')?.querySelectorAll('.sn-spell-row:not(.sn-spell-row-head)').length >= 2;
  }, null, { timeout: 4_000 });

  // Trova la riga 'sapore' e modifica il trigger in 'colore' (collisione)
  // Le righe sono ordinate alfabeticamente: 'colore' viene prima di 'sapore'
  // Troviamo il campo input della riga 'sapore'
  const rows = page.locator('#autocorrectList .sn-spell-row:not(.sn-spell-row-head)');
  await expect(rows).toHaveCount(2);

  // La seconda riga (indice 1) dovrebbe essere 'sapore' (ordine alfabetico: colore < sapore)
  const saporeInput = rows.nth(1).locator('input').first();
  await expect(saporeInput).toHaveValue('sapore');

  // Modifica il trigger della riga 'sapore' in 'colore' (collisione)
  await saporeInput.fill('colore');
  await saporeInput.press('Tab'); // triggera il 'change' event

  // Aspetta un momento per la reazione
  await page.waitForTimeout(500);

  // ASSERISCE IL SUCCESSO 1: deve comparire un avviso di conflitto
  const conflictMsg = page.locator('#autocorrectConflict');
  await expect(conflictMsg).toBeVisible({ timeout: 3_000 });
  await expect(conflictMsg).toContainText('colore');

  // ASSERISCE IL SUCCESSO 2: la regola 'colore'→'colour' deve essere ancora presente
  // (non sovrascritta silenziosamente)
  const rowsAfter = page.locator('#autocorrectList .sn-spell-row:not(.sn-spell-row-head)');
  await expect(rowsAfter).toHaveCount(2); // entrambe le righe devono essere presenti

  // Verifica che la riga 'colore' abbia ancora correzione 'colour' (non 'savour')
  const coloreRow = rowsAfter.nth(0); // 'colore' è ancora prima alfabeticamente
  await expect(coloreRow.locator('input').first()).toHaveValue('colore');
  await expect(coloreRow.locator('input').nth(1)).toHaveValue('colour');

  // Verifica che il trigger della riga 'sapore' sia stato ripristinato a 'sapore'
  const saporeRowAfter = rowsAfter.nth(1);
  await expect(saporeRowAfter.locator('input').first()).toHaveValue('sapore');
});

// ---------------------------------------------------------------------------
// Feedback #227: aggiungere una parola già nel dizionario (anche con casing
// diverso) mostrava di svuotare il campo in silenzio, senza alcun avviso.
// Deve invece comparire un messaggio "già nel dizionario", in simmetria con
// la sezione "Correzioni automatiche".
// ---------------------------------------------------------------------------
test('dizionario personale: aggiungere una parola già presente (casing diverso) mostra un avviso, non ingoia l\'input', async ({ openTab }) => {
  const page = await openSpellcheckPage(openTab);

  // Aggiungi "casa"
  await page.fill('#newDictWord', 'casa');
  await page.click('#addDict');
  await page.waitForFunction(() => {
    return document.getElementById('dictList')?.querySelectorAll('.sn-spell-word').length > 0;
  }, null, { timeout: 4_000 });

  // Riprova con "Casa" (stesso significato, casing diverso)
  await page.fill('#newDictWord', 'Casa');
  await page.click('#addDict');

  // ASSERISCE IL SUCCESSO 1: compare un avviso inline di duplicato che nomina la parola
  const conflictMsg = page.locator('#dictConflict');
  await expect(conflictMsg).toBeVisible({ timeout: 3_000 });
  await expect(conflictMsg).toContainText('Casa');

  // ASSERISCE IL SUCCESSO 2: nessun duplicato aggiunto (resta una sola parola)
  const wordSpans = page.locator('#dictList .sn-spell-word');
  await expect(wordSpans).toHaveCount(1);
  await expect(wordSpans.first()).toHaveText('casa');

  // ASSERISCE IL SUCCESSO 3: l'input NON viene ingoiato in silenzio — il testo
  // digitato resta visibile così l'utente capisce cosa è successo.
  await expect(page.locator('#newDictWord')).toHaveValue('Casa');
});

// ---------------------------------------------------------------------------
// Feedback #214: parola lunghissima senza spazi nel dizionario personale
// sforava la riga e spingeva il bottone "Rimuovi" fuori dal viewport
// (scroll orizzontale). La parola deve andare a capo dentro la cella e
// "Rimuovi" deve restare cliccabile.
// ---------------------------------------------------------------------------
test('parola lunga senza spazi nel dizionario: niente scroll orizzontale, "Rimuovi" resta visibile e funziona', async ({ openTab }) => {
  const page = await openSpellcheckPage(openTab);

  // Token lungo senza spazi (tipo indirizzo/codice incollato dall'utente)
  const longWord = 'https-esempio-molto-lungo-' + 'abcdefghij0123456789'.repeat(8);
  await page.fill('#newDictWord', longWord);
  await page.click('#addDict');

  await page.waitForFunction(() => {
    return document.getElementById('dictList')?.querySelectorAll('.sn-spell-word').length > 0;
  }, null, { timeout: 4_000 });

  // ASSERISCE IL SUCCESSO 1: la pagina NON deve avere scroll orizzontale
  // (senza fix: la parola sfora la griglia → scrollWidth > clientWidth).
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  // ASSERISCE IL SUCCESSO 2: il bottone "Rimuovi" della riga sta DENTRO il
  // viewport orizzontale (senza fix veniva spinto oltre il bordo destro).
  const row = page.locator('#dictList .sn-spell-row-dict').first();
  const btnInViewport = await row.locator('button').evaluate((btn) => {
    const r = btn.getBoundingClientRect();
    return r.right <= window.innerWidth && r.left >= 0 && r.width > 0;
  });
  expect(btnInViewport).toBe(true);

  // ASSERISCE IL SUCCESSO 3: cliccare "Rimuovi" toglie davvero la parola.
  await row.locator('button').click();
  await page.waitForFunction(() => {
    return document.getElementById('dictList')?.querySelectorAll('.sn-spell-word').length === 0;
  }, null, { timeout: 4_000 });
  const emptyVisible = await page.evaluate(() => !document.getElementById('dictEmpty').hidden);
  expect(emptyVisible).toBe(true);
});

// ---------------------------------------------------------------------------
// Feedback #389: svuotare il campo di una correzione automatica salvata la
// faceva SEMBRARE cancellata (riga con casella vuota) ma la regola restava
// intatta in storage e continuava a correggere. Il salvataggio falliva in
// silenzio, senza avviso, e la UI mostrava uno stato falso.
// Fix: in simmetria col ramo conflitto, ripristina il valore reale nel campo
// e mostra un avviso che indirizza al bottone «Rimuovi».
// ---------------------------------------------------------------------------
test('correttore: svuotare la correzione ripristina il valore reale e avvisa (regola intatta, niente stato falso)', async ({ openTab }) => {
  const page = await openSpellcheckPage(openTab);

  // Crea la correzione 'ke' → 'che'
  await page.fill('#newWord', 'ke');
  await page.fill('#newCorrection', 'che');
  await page.click('#addAutocorrect');
  await page.waitForFunction(() => {
    return document.getElementById('autocorrectList')?.querySelectorAll('.sn-spell-row:not(.sn-spell-row-head)').length >= 1;
  }, null, { timeout: 4_000 });

  const row = page.locator('#autocorrectList .sn-spell-row:not(.sn-spell-row-head)').first();
  const correctionInput = row.locator('input').nth(1);
  await expect(correctionInput).toHaveValue('che');

  // Svuota il campo correzione e sposta il focus (triggera 'change')
  await correctionInput.fill('');
  await correctionInput.press('Tab');
  await page.waitForTimeout(400);

  // ASSERISCE IL SUCCESSO 1: compare l'avviso (senza fix: nessun avviso)
  await expect(page.locator('#autocorrectConflict')).toBeVisible({ timeout: 3_000 });

  // ASSERISCE IL SUCCESSO 2: il campo torna a mostrare il valore reale 'che'
  // (senza fix: il campo restava vuoto, stato falso)
  await expect(correctionInput).toHaveValue('che');

  // ASSERISCE IL SUCCESSO 3: la regola è ancora salvata in storage come {ke:'che'}
  const stored = await page.evaluate(async () => {
    const d = await chrome.storage.local.get('sn_autocorrect');
    return d.sn_autocorrect || null;
  });
  expect(stored).toEqual({ ke: 'che' });
});

test('correttore: svuotare la parola-trigger ripristina il valore reale e avvisa', async ({ openTab }) => {
  const page = await openSpellcheckPage(openTab);

  await page.fill('#newWord', 'ke');
  await page.fill('#newCorrection', 'che');
  await page.click('#addAutocorrect');
  await page.waitForFunction(() => {
    return document.getElementById('autocorrectList')?.querySelectorAll('.sn-spell-row:not(.sn-spell-row-head)').length >= 1;
  }, null, { timeout: 4_000 });

  const row = page.locator('#autocorrectList .sn-spell-row:not(.sn-spell-row-head)').first();
  const wordInput = row.locator('input').first();
  await expect(wordInput).toHaveValue('ke');

  // Svuota il campo parola e sposta il focus
  await wordInput.fill('');
  await wordInput.press('Tab');
  await page.waitForTimeout(400);

  // Avviso + campo ripristinato + regola intatta
  await expect(page.locator('#autocorrectConflict')).toBeVisible({ timeout: 3_000 });
  await expect(wordInput).toHaveValue('ke');
  const stored = await page.evaluate(async () => {
    const d = await chrome.storage.local.get('sn_autocorrect');
    return d.sn_autocorrect || null;
  });
  expect(stored).toEqual({ ke: 'che' });
});
