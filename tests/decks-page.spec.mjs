// App Mazzi (deck builder Commander, task 1): routing a tre schermate +
// libreria. Asserisce il SUCCESSO del flusso utente: creo un mazzo → atterro
// nel Builder col nome giusto → torno alla libreria e la card c'è → rinomino
// dal Builder e la libreria riflette il nome → duplico ed elimino dal menu
// contestuale. Senza l'app, il test fallisce già all'apertura di filo://decks.

import { test, expect } from './fixtures/electron.mjs';

test('creare, rinominare, duplicare ed eliminare un mazzo dalla libreria', async ({ openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');

  // Libreria vuota all'inizio.
  await expect(page.locator('#deckEmpty')).toBeVisible();

  // "+ Nuovo mazzo" crea e naviga al Builder (routing #/deck/<id>).
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  await expect(page.locator('#deckName')).toHaveValue('Nuovo mazzo');
  await expect(page.locator('#deckCount')).toHaveText('0/100 carte');

  // Rinomina dall'header del Builder (identità del documento, §8.2).
  await page.fill('#deckName', 'Izzet Spellslinger');
  await page.press('#deckName', 'Enter');

  // Torna alla libreria: la card esiste col nome nuovo.
  await page.click('#backToLibrary');
  await expect(page.locator('#screenLibrary')).toBeVisible();
  const card = page.locator('[data-deck-id]', { hasText: 'Izzet Spellslinger' });
  await expect(card).toHaveCount(1);
  await expect(page.locator('#deckEmpty')).toBeHidden();

  // Duplica dal menu contestuale (tasto destro sulla card).
  await card.click({ button: 'right' });
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Duplica' }).click();
  await expect(page.locator('[data-deck-id]')).toHaveCount(2);
  await expect(page.locator('[data-deck-id]', { hasText: 'Izzet Spellslinger (copia)' })).toHaveCount(1);

  // Elimina la copia (conferma nel popup di Filo, mai window.confirm nativo).
  await page.locator('[data-deck-id]', { hasText: '(copia)' }).click({ button: 'right' });
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Elimina' }).click();
  await page.locator('.sn-confirm-btn-ok').click();
  await expect(page.locator('[data-deck-id]')).toHaveCount(1);
});

test('routing: il click su una card apre il suo mazzo; Partita è uno stub raggiungibile', async ({ openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');

  // Crea un mazzo e torna alla libreria.
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  await page.click('#backToLibrary');

  // Il click sulla card riapre il Builder di QUEL mazzo (persistito: il nome
  // viene riletto dallo storage, non dalla memoria della pagina).
  await page.click('[data-deck-id]');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  await expect(page.locator('#deckName')).toHaveValue('Nuovo mazzo');

  // Schermata Partita: stub con ritorno alla libreria.
  await page.click('#backToLibrary');
  await page.click('#openGame');
  await expect(page.locator('#screenGame')).toBeVisible();
  await page.click('#gameBack');
  await expect(page.locator('#screenLibrary')).toBeVisible();
});

test('i mazzi sopravvivono alla riapertura della pagina (storage locale)', async ({ openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('#newDeck');
  await page.fill('#deckName', 'Persistente');
  await page.press('#deckName', 'Enter');

  // Ricarica la pagina da zero: la libreria rilegge dallo storage del main.
  await page.goto('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('[data-deck-id]', { hasText: 'Persistente' })).toHaveCount(1);
});
