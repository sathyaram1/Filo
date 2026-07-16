// Budget del mazzo scritto con la virgola decimale italiana (#315).
// Prima del fix il campo "Budget…" dello switcher era un input type=number:
// Chromium scartava la virgola alla digitazione, «40,50» arrivava al
// salvataggio come «4050» e il tetto precedente veniva sovrascritto in
// silenzio (gonfiato x100), senza nessun avviso.
//
// Col fix il campo è testuale (inputmode numerico), la virgola è un separatore
// decimale valido e l'input NON numerico viene rifiutato con un toast senza
// toccare il tetto. Lo spec riproduce il flusso da utente e ASSERISCE il
// comportamento giusto: senza fix l'assert su «40,50 €» è rosso.

import { test, expect } from './fixtures/electron.mjs';

async function setBudgetViaSwitcher(page, text) {
  await page.click('#deckName');
  await page.locator('.dk-switcher .sn-select-option', { hasText: 'Budget' }).click();
  const input = page.locator('#deckBudgetEdit');
  await expect(input).toBeVisible();
  // pressSequentially (non fill): riproduce la DIGITAZIONE dell'utente,
  // carattere per carattere, virgola compresa.
  await input.pressSequentially(text);
  await input.press('Enter');
}

test('budget scritto con la virgola italiana (40,50) non viene perso né gonfiato', async ({ openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');

  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();

  // Primo giro: tetto intero, funziona (baseline del flusso).
  await setBudgetViaSwitcher(page, '100');
  await expect(page.locator('#commanderLine')).toContainText('Budget: 100 €');

  // Secondo giro: tetto con la virgola decimale italiana.
  await setBudgetViaSwitcher(page, '40,50');
  await page.screenshot({ path: 'tests/.shots/audit-decks-budget-comma.png' });

  // ASSERZIONE CHIAVE: il tetto deve valere 40,50 € — non sparire (riga
  // Budget assente) né diventare 4050 €. L'intestazione lo mostra in formato
  // italiano, come tutti gli altri prezzi dell'app.
  // (Il pannello statistiche compare solo con carte nel mazzo e usa già il
  // formato italiano per tutti gli importi: qui basta l'intestazione.)
  const line = page.locator('#commanderLine');
  await expect(line).toContainText('Budget: 40,50 €');
});

test('input budget non numerico → avviso e tetto invariato (niente sovrascrittura silenziosa)', async ({ openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');

  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();

  await setBudgetViaSwitcher(page, '100');
  await expect(page.locator('#commanderLine')).toContainText('Budget: 100 €');

  // Testo che non è un numero: col vecchio input numerico sarebbe stato
  // filtrato/stravolto; ora deve produrre un avviso e NON toccare il tetto.
  await setBudgetViaSwitcher(page, 'abc');
  await expect(page.locator('.dk-toast')).toContainText('Budget non valido');
  await expect(page.locator('#commanderLine')).toContainText('Budget: 100 €');
});
