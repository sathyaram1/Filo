import { test, expect } from './fixtures/electron.mjs';

// Spellcheck: il menu del tasto destro su una parola errata deve mostrare la
// correzione come PRIMA voce. Qui usiamo il path LLM (stub deterministico sotto
// FILO_TEST: "ciiao" -> "ciao") cliccando esattamente sopra la parola.

async function rightClickWordStart(page, selector) {
  const box = await page.locator(selector).boundingBox();
  // La parola "ciiao" è all'inizio della prima riga: clic vicino al bordo
  // sinistro/alto del campo per cadere sopra di essa.
  await page.mouse.click(box.x + 12, box.y + 12, { button: 'right' });
}

test('right-click su parola errata in textarea mostra correzione in cima', async ({ openTab, testServer }) => {
  const page = await openTab(testServer.url('/spell.html'));
  await page.waitForTimeout(500);
  await rightClickWordStart(page, '#ta');
  await expect(page.locator('.sn-menu')).toBeVisible();
  // La correzione "ciao" deve rivelarsi come prima voce visibile.
  const corr = page.locator('.sn-menu-correction:visible');
  await expect(corr.first()).toBeVisible({ timeout: 4000 });
  await expect(corr.first()).toContainText('ciao');
});

test('right-click su parola errata in contenteditable mostra correzione in cima', async ({ openTab, testServer }) => {
  const page = await openTab(testServer.url('/spell.html'));
  await page.waitForTimeout(500);
  await rightClickWordStart(page, '#ce');
  await expect(page.locator('.sn-menu')).toBeVisible();
  const corr = page.locator('.sn-menu-correction:visible');
  await expect(corr.first()).toBeVisible({ timeout: 4000 });
  await expect(corr.first()).toContainText('ciao');
});
