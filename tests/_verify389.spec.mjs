import { test, expect } from './fixtures/electron.mjs';
import fs from 'node:fs';

const URL_SPELLCHECK = 'filo://spellcheck/spellcheck.html';

async function openPage(openTab) {
  const page = await openTab(URL_SPELLCHECK);
  await page.waitForFunction(() => {
    const el = document.getElementById('addDict');
    return el && el.textContent.length > 0;
  }, null, { timeout: 8000 });
  return page;
}

async function addRule(page, w, c) {
  await page.fill('#newWord', w);
  await page.fill('#newCorrection', c);
  await page.click('#addAutocorrect');
  await page.waitForFunction((n) => {
    return document.getElementById('autocorrectList')?.querySelectorAll('.sn-spell-row:not(.sn-spell-row-head)').length >= n;
  }, 1, { timeout: 4000 });
}

// STRESS 1: campo di soli spazi deve comportarsi come vuoto (trim) → avviso + ripristino
test('stress: correzione di soli spazi -> avviso e ripristino, regola intatta', async ({ openTab }) => {
  const page = await openPage(openTab);
  await addRule(page, 'ke', 'che');
  const row = page.locator('#autocorrectList .sn-spell-row:not(.sn-spell-row-head)').first();
  const cIn = row.locator('input').nth(1);
  await cIn.fill('     ');
  await cIn.press('Tab');
  await page.waitForTimeout(300);
  await expect(page.locator('#autocorrectConflict')).toBeVisible();
  await expect(cIn).toHaveValue('che');
  const stored = await page.evaluate(async () => (await chrome.storage.local.get('sn_autocorrect')).sn_autocorrect);
  expect(stored).toEqual({ ke: 'che' });
});

// STRESS 2: un'EDIT LEGITTIMA deve ancora salvare (nessuna regressione)
test('stress: modifica valida della correzione salva ancora', async ({ openTab }) => {
  const page = await openPage(openTab);
  await addRule(page, 'ke', 'che');
  const row = page.locator('#autocorrectList .sn-spell-row:not(.sn-spell-row-head)').first();
  const cIn = row.locator('input').nth(1);
  await cIn.fill('CHE!');
  await cIn.press('Tab');
  await page.waitForTimeout(300);
  const stored = await page.evaluate(async () => (await chrome.storage.local.get('sn_autocorrect')).sn_autocorrect);
  expect(stored).toEqual({ ke: 'CHE!' });
});

// STRESS 3: svuoto, esce l'avviso; poi ricarico la pagina -> il valore reale c'e' (coerenza persistente)
test('stress: dopo svuotamento e reload il valore reale persiste', async ({ openTab }) => {
  const page = await openPage(openTab);
  await addRule(page, 'ke', 'che');
  let row = page.locator('#autocorrectList .sn-spell-row:not(.sn-spell-row-head)').first();
  let cIn = row.locator('input').nth(1);
  await cIn.fill('');
  await cIn.press('Tab');
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('addDict')?.textContent.length > 0, null, { timeout: 8000 });
  row = page.locator('#autocorrectList .sn-spell-row:not(.sn-spell-row-head)').first();
  cIn = row.locator('input').nth(1);
  await expect(cIn).toHaveValue('che');
  // screenshot di traccia (stato dopo svuotamento, prima del reload avremmo l'avviso)
});

// STRESS 4: doppio svuotamento rapido di entrambi i campi
test('stress: svuotare parola e correzione in sequenza non perde la regola + screenshot avviso', async ({ openTab }) => {
  const page = await openPage(openTab);
  await addRule(page, 'ke', 'che');
  const row = page.locator('#autocorrectList .sn-spell-row:not(.sn-spell-row-head)').first();
  const wIn = row.locator('input').first();
  const cIn = row.locator('input').nth(1);
  await wIn.fill('');
  await wIn.press('Tab');
  await cIn.fill('');
  await cIn.press('Tab');
  await page.waitForTimeout(300);
  await expect(page.locator('#autocorrectConflict')).toBeVisible();
  await expect(wIn).toHaveValue('ke');
  await expect(cIn).toHaveValue('che');
  const stored = await page.evaluate(async () => (await chrome.storage.local.get('sn_autocorrect')).sn_autocorrect);
  expect(stored).toEqual({ ke: 'che' });
  fs.mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/verify389-warning.png', fullPage: true });
});
