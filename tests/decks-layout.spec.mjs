// Builder del deck builder (task 3): tre colonne a larghezza fissa con
// divisori trascinabili A MANO e posizione persistita (§2), e switcher del
// mazzo nell'header (§8.2): cambia mazzo, nuovo, duplica, budget, elimina.

import { test, expect } from './fixtures/electron.mjs';
import { clickConfirm } from './helpers/confirm.mjs';

async function newDeck(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const hash = await page.evaluate(() => location.hash);
  return decodeURIComponent(hash.replace('#/deck/', ''));
}

function colWidth(page, sel) {
  return page.locator(sel).evaluate((el) => el.getBoundingClientRect().width);
}

test('i divisori si trascinano e la posizione sopravvive alla riapertura', async ({ openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);

  const before = await colWidth(page, '#colChat');

  // Trascina il divisore sinistro di +120px (drag deliberato, mouse reale).
  const div = page.locator('#dividerLeft');
  const box = await div.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + 200, { steps: 5 });
  await page.mouse.up();

  const after = await colWidth(page, '#colChat');
  expect(Math.round(after - before)).toBeGreaterThan(100);

  // Riapre la pagina: la larghezza scelta è persistita (non torna al default).
  await page.goto('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('[data-deck-id]');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const reopened = await colWidth(page, '#colChat');
  expect(Math.abs(reopened - after)).toBeLessThan(3);
});

test('il builder usa tutta la larghezza della finestra (non è incassato a 960px)', async ({ openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);

  const { builderW, viewportW } = await page.evaluate(() => ({
    builderW: document.getElementById('builderGrid').getBoundingClientRect().width,
    viewportW: window.innerWidth,
  }));
  // Prima del fix .sn-page era capped a 960px → builder ≤ ~912px. Ora esce dal
  // cage e riempie quasi tutta la finestra (larga 1280 nei test).
  expect(builderW).toBeGreaterThan(1000);
  // Riempie davvero: resta solo il padding laterale della pagina (24px * 2).
  expect(viewportW - builderW).toBeLessThan(80);
});

test('il ritorno ai Mazzi è un\'icona nella testata di colonna e riporta alla libreria', async ({ openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);

  // L'azione "torna ai mazzi" vive DENTRO la testata della colonna chat
  // (stesso livello del titolo), non più in una riga-bottone sopra il builder.
  const back = page.locator('.dk-col-head-chat #backToLibrary');
  await expect(back).toBeVisible();

  await back.click();
  await expect(page.locator('#screenLibrary')).toBeVisible();
  await expect(page.locator('#screenBuilder')).toBeHidden();
});

test('switcher: nuovo, cambia mazzo, duplica', async ({ openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const firstId = await newDeck(page);

  // "Nuovo mazzo" dallo switcher: crea e apre un mazzo DIVERSO.
  await page.click('#deckName');
  await page.locator('.dk-switcher .sn-select-option', { hasText: 'Nuovo mazzo' }).click();
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const secondId = decodeURIComponent((await page.evaluate(() => location.hash)).replace('#/deck/', ''));
  expect(secondId).not.toBe(firstId);

  // Lo switcher elenca l'ALTRO mazzo: cliccarlo cambia mazzo (torna al primo).
  await page.click('#deckName');
  const firstEntry = page.locator('.dk-switcher .sn-select-option').first();
  await firstEntry.click();
  await expect.poll(() => page.evaluate(() => location.hash)).toContain(firstId);

  // "Duplica questo mazzo" apre la copia.
  await page.click('#deckName');
  await page.locator('.dk-switcher .sn-select-option', { hasText: 'Duplica questo mazzo' }).click();
  await expect(page.locator('#deckNameText')).toHaveText(/\(copia\)/);
});

test('switcher: budget impostato e persistito; elimina torna alla libreria', async ({ openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeck(page);

  // Budget… → 40 → Invio: compare nell'header e finisce nel documento del mazzo.
  await page.click('#deckName');
  await page.locator('.dk-switcher .sn-select-option', { hasText: 'Budget' }).click();
  await page.fill('#deckBudgetEdit', '40');
  await page.press('#deckBudgetEdit', 'Enter');
  await expect(page.locator('#commanderLine')).toHaveText(/Budget: 40 €/);

  const saved = await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id });
    return r.deck && r.deck.budget;
  }, deckId);
  expect(saved).toBe(40);

  // Elimina… → conferma → si torna alla libreria, senza più il mazzo.
  await page.click('#deckName');
  await page.locator('.dk-switcher .sn-select-option', { hasText: 'Elimina' }).click();
  await clickConfirm(page, 'ok');
  await expect(page.locator('#screenLibrary')).toBeVisible();
  await expect(page.locator(`[data-deck-id="${deckId}"]`)).toHaveCount(0);
});
