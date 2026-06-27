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
