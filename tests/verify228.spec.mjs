// Verifica indipendente (verifier) del feedback #228: Cerca e sostituisci
// nell'editor deve trovare e sostituire le parole spezzate da formattazione
// inline (grassetto/corsivo/sottolineato), senza saltarne nessuna in silenzio
// e senza matchare a cavallo di due paragrafi.

import { test, expect } from './fixtures/electron.mjs';

async function openReview(openTab, html) {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate((h) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = h;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, html);
  await page.locator('.ed-switch-icon').nth(1).click();
  await page.waitForSelector('[data-sr="find"]');
  return page;
}

// 1) Riproduzione ESATTA del feedback: ultima "alfa" con "fa" in grassetto.
test('#228 repro esatto: 1/3 e sostituzione completa', async ({ openTab }) => {
  const page = await openReview(openTab, '<p>Nome: alfa, alfa e al<strong>fa</strong>.</p>');
  await page.fill('[data-sr="find"]', 'alfa');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/3');
  await page.fill('[data-sr="repl"]', 'OMEGA');
  await page.click('[data-sr="all"]');
  await expect(page.locator('#doc')).toHaveText('Nome: OMEGA, OMEGA e OMEGA.');
  await expect(page.locator('[data-sr="count"]')).toHaveText('nessun risultato');
});

// 2) Split nel MEZZO della parola (al<strong>f</strong>a) — caso peggiore, 3 nodi.
test('#228 split centrale: trovata e sostituita', async ({ openTab }) => {
  const page = await openReview(openTab, '<p>al<strong>f</strong>a e alfa qui</p>');
  await page.fill('[data-sr="find"]', 'alfa');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/2');
  await page.fill('[data-sr="repl"]', 'X');
  await page.click('[data-sr="all"]');
  await expect(page.locator('#doc')).toHaveText('X e X qui');
  // Nessun wrapper di formattazione vuoto lasciato in giro.
  const emptyTags = await page.evaluate(() => {
    return [...document.querySelectorAll('#doc strong, #doc em, #doc u, #doc s, #doc b, #doc i')]
      .filter((e) => !e.textContent).length;
  });
  expect(emptyTags).toBe(0);
});

// 3) Parola INTERA in grassetto: deve comunque essere trovata.
test('#228 parola intera formattata trovata', async ({ openTab }) => {
  const page = await openReview(openTab, '<p>uno <strong>alfa</strong> due alfa</p>');
  await page.fill('[data-sr="find"]', 'alfa');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/2');
});

// 4) SIMMETRIA / anti-regressione: NON deve matchare a cavallo di due paragrafi.
// "al" fine di un paragrafo + "fa" inizio del successivo NON è "alfa".
test('#228 nessun match tra due paragrafi separati', async ({ openTab }) => {
  const page = await openReview(openTab, '<p>testo al</p><p>fa resto</p>');
  await page.fill('[data-sr="find"]', 'alfa');
  await expect(page.locator('[data-sr="count"]')).toHaveText('nessun risultato');
});

// 5) "Sostituisci" (uno) su un'occorrenza a formattazione mista: la corrente
// viene sostituita per intero e la formattazione mista non lascia residui.
test('#228 sostituisci singolo su occorrenza formattata', async ({ openTab }) => {
  const page = await openReview(openTab, '<p>al<strong>fa</strong> poi alfa</p>');
  await page.fill('[data-sr="find"]', 'alfa');
  await page.fill('[data-sr="repl"]', 'ZZ');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/2');
  await page.click('[data-sr="one"]');
  await expect(page.locator('#doc')).toHaveText('ZZ poi alfa');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/1');
});

// 6) Navigazione Successivo/Precedente con un'occorrenza formattata in mezzo.
test('#228 next/prev attraversano l\'occorrenza formattata', async ({ openTab }) => {
  const page = await openReview(openTab, '<p>alfa uno al<strong>fa</strong> due alfa</p>');
  await page.fill('[data-sr="find"]', 'alfa');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/3');
  await page.click('[data-sr="next"]');
  await expect(page.locator('[data-sr="count"]')).toHaveText('2/3');
  await page.click('[data-sr="next"]');
  await expect(page.locator('[data-sr="count"]')).toHaveText('3/3');
  await page.click('[data-sr="prev"]');
  await expect(page.locator('[data-sr="count"]')).toHaveText('2/3');
});

// 7) Termine di ricerca vuoto: nessun crash, nessun risultato.
test('#228 termine vuoto non rompe nulla', async ({ openTab }) => {
  const page = await openReview(openTab, '<p>alfa alfa</p>');
  await page.fill('[data-sr="find"]', '');
  await expect(page.locator('[data-sr="count"]')).toHaveText('nessun risultato');
});

// 8) Match che tocca tre nodi con formattazione a cavallo dei confini interni.
test('#228 occorrenza su tre frammenti formattati', async ({ openTab }) => {
  const page = await openReview(openTab, '<p>x <em>al</em><strong>f</strong>a x</p>');
  await page.fill('[data-sr="find"]', 'alfa');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/1');
  await page.fill('[data-sr="repl"]', 'Q');
  await page.click('[data-sr="all"]');
  await expect(page.locator('#doc')).toHaveText('x Q x');
});
