// Audit (prober): budget del mazzo scritto con la virgola decimale italiana.
// Sospetto dalla lettura del codice: il campo "Budget…" dello switcher è un
// input type=number e il salvataggio fa Number(valore)||0 senza gestire la
// virgola. L'app mostra TUTTI i prezzi col formato italiano ("12,50 €"), ma
// se l'utente scrive il tetto allo stesso modo ("40,50") il valore non è
// parseabile: a seconda del filtro dei caratteri dell'input numerico finisce
// in stringa vuota (→ tetto CANCELLATO in silenzio) o in "4050" (→ tetto
// gonfiato x100). In entrambi i casi, nessun avviso.
//
// Lo spec riproduce il flusso da utente e ASSERISCE che un tetto scritto con
// la virgola diventi 40,50 € (o al minimo resti quello precedente): se il bug
// c'è, l'assert è rosso.

import { test, expect } from './fixtures/electron.mjs';

async function setBudgetViaSwitcher(page, text) {
  await page.click('#deckName');
  await page.locator('.dk-switcher .sn-select-option', { hasText: 'Budget' }).click();
  const input = page.locator('#deckBudgetEdit');
  await expect(input).toBeVisible();
  // pressSequentially (non fill): un input type=number rifiuta fill() con
  // testo non numerico — l'utente però la virgola la DIGITA.
  await input.pressSequentially(text);
  await input.press('Enter');
}

// test.fixme: repro del bug (verificato ROSSO senza fixme: digitando «40,50»
// l'input numerico scarta la virgola e il tetto — che prima valeva 100 € —
// diventa 4050 €, senza nessun avviso). Chi lavorerà il feedback toglie
// `.fixme` per farne un assert vivo (deve passare col fix).
test.fixme('budget scritto con la virgola italiana (40,50) non viene perso né gonfiato', async ({ openTab }) => {
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
  // Budget assente) né diventare 4050 €.
  const line = page.locator('#commanderLine');
  await expect(line).toContainText('Budget: 40.5 €');
});
