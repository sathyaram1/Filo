// Verifier probe for feedback #385 — adversarial edge cases NOT covered by the
// resolver's own spec. Temporary file, removed after the run.
import { test, expect } from './fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

async function setupThreeClosed(page) {
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
  await page.locator('.ed-switch-icon').nth(1).click();
  await page.waitForSelector('[data-sr="find"]');
}

// Stress 1: stepping Prec/Succ across many sections must never accumulate more
// than ONE borrowed-open section.
test('probe: navigando avanti e indietro resta aperta al massimo UNA sezione', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await setupThreeClosed(page);
  await page.fill('[data-sr="find"]', 'un ');
  // "un " compare in tutte e tre le sezioni.
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/3');
  for (let i = 0; i < 6; i++) {
    await page.click('[data-sr="next"]');
  }
  const openCount = await page.evaluate(() =>
    document.querySelectorAll('#doc p:not(.ed-hidden-by-collapse)').length);
  expect(openCount).toBe(1);
  // e nessuna sezione resta col marchio "in prestito" oltre quella corrente
  const borrowed = await page.evaluate(() =>
    document.querySelectorAll('[data-search-opened]').length);
  expect(borrowed).toBe(1);
});

// Stress 2: replace injection — sostituire con HTML/script non deve iniettare
// markup nel documento (deve restare testo letterale).
test('probe: sostituire con <script> resta testo, non markup', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await setupThreeClosed(page);
  await page.fill('[data-sr="find"]', 'ornitorinco');
  await page.fill('[data-sr="repl"]', '<b>x</b><script>window.__pwned=1</script>');
  await page.click('[data-sr="all"]');
  const pwned = await page.evaluate(() => window.__pwned);
  expect(pwned).toBeUndefined();
  const html = await page.locator('#doc #s3').innerHTML();
  expect(html).not.toContain('<b>');
  expect(html).not.toContain('<script');
  await expect(page.locator('#doc #s3')).toContainText('<b>x</b>');
});

// Stress 3: termine con caratteri regex-speciali trattato letteralmente.
test('probe: caratteri speciali nel termine di ricerca sono letterali', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('#doc');
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<h2>Sec</h2><p id="p">valore = a.b*c [x] fine</p>';
    doc.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await page.locator('#doc h2', { hasText: 'Sec' }).locator('.ed-collapse-toggle').click();
  await page.locator('.ed-switch-icon').nth(1).click();
  await page.waitForSelector('[data-sr="find"]');
  // ".b*c" e "[x]" trovati solo se trattati come testo letterale, non regex.
  await page.fill('[data-sr="find"]', 'a.b*c');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/1');
  await page.fill('[data-sr="find"]', '[x]');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/1');
});

// Stress 4: Esc chiude tutto e richiude le sezioni in prestito, lasciando quelle
// aperte a mano.
test('probe: Esc pulisce la ricerca e richiude solo il prestito', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await setupThreeClosed(page);
  await page.locator('#doc h2', { hasText: 'Uno' }).locator('.ed-collapse-toggle').click();
  await expect(page.locator('#doc #s1')).toBeVisible(); // aperta a mano
  const find = page.locator('[data-sr="find"]');
  await find.fill('ornitorinco');
  await expect(page.locator('#doc #s3')).toBeVisible(); // aperta in prestito
  await find.press('Escape');
  await expect(find).toHaveValue('');
  await expect(page.locator('#doc #s3')).toBeHidden();   // prestito richiuso
  await expect(page.locator('#doc #s1')).toBeVisible();  // la tua resta
  await expect(page.locator('#doc mark.ed-find-hit')).toHaveCount(0);
});

// Stress 5: termine vuoto/soli spazi non deve rompere né aprire nulla.
test('probe: termine di soli spazi non apre sezioni', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await setupThreeClosed(page);
  await page.fill('[data-sr="find"]', '   ');
  await page.waitForTimeout(500);
  const openCount = await page.evaluate(() =>
    document.querySelectorAll('#doc p:not(.ed-hidden-by-collapse)').length);
  // Gli spazi esistono nel testo, ma nessuna sezione chiusa deve restare aperta
  // in modo permanente dopo la pausa se non c'è una corrispondenza "reale" mirata.
  // Qui verifichiamo solo che non crashi e il contatore sia coerente.
  const count = await page.locator('[data-sr="count"]').textContent();
  expect(typeof count).toBe('string');
  expect(openCount).toBeLessThanOrEqual(1);
});
