// VERIFIER (feedback #214) — spec temporaneo del verificatore, NON versionare.
// Sintomo: parola molto lunga senza spazi nel dizionario personale del
// correttore → la riga sfora il bordo pagina, compare scroll orizzontale e il
// bottone "Rimuovi" finisce fuori schermo → la parola non si può più togliere.
//
// Verifica black-box del successo: dopo aver aggiunto una parola lunga,
// (1) la pagina NON ha scroll orizzontale, (2) "Rimuovi" sta dentro il
// viewport, (3) cliccandolo la parola viene DAVVERO rimossa dallo storage.
// Stress: 1000 caratteri, emoji, tentativo XSS, doppio click, autocorrect
// con trigger/correzione lunghissimi.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(__dirname, '.shots');
mkdirSync(SHOTS, { recursive: true });

const PAGE = 'filo://spellcheck/spellcheck.html';
const LONG_WORD = 'ViaDelCorsoNumero12InternoScala' + 'B'.repeat(20) + '-' +
  'a1b2c3d4e5f6a7b8c9d0'.repeat(8); // ~210 char, niente spazi

async function noHorizontalScroll(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    return {
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
    };
  });
}

async function assertFits(page, label) {
  const m = await noHorizontalScroll(page);
  expect(m.scrollWidth, `${label}: niente scroll orizzontale (doc)`).toBeLessThanOrEqual(m.clientWidth + 1);
  expect(m.bodyScrollWidth, `${label}: niente scroll orizzontale (body)`).toBeLessThanOrEqual(m.clientWidth + 1);
}

async function assertBtnInViewport(page, btn, label) {
  const box = await btn.boundingBox();
  const vw = await page.evaluate(() => document.documentElement.clientWidth);
  expect(box, `${label}: bounding box presente`).toBeTruthy();
  expect(box.x + box.width, `${label}: "Rimuovi" dentro il viewport (right=${box.x + box.width}, vw=${vw})`)
    .toBeLessThanOrEqual(vw + 1);
  expect(box.x, `${label}: "Rimuovi" non a sinistra del viewport`).toBeGreaterThanOrEqual(-1);
}

async function getDict(page) {
  return page.evaluate(async () => {
    const d = await chrome.storage.local.get('sn_personal_dict');
    return d.sn_personal_dict || [];
  });
}

test('dizionario: parola lunga senza spazi non sfora e Rimuovi resta cliccabile', async ({ app, openTab }) => {
  const page = await openTab(PAGE);
  await page.waitForSelector('#addDict');

  // Stato vuoto iniziale.
  await expect(page.locator('#dictEmpty')).toBeVisible();

  // Aggiungi la parola lunga come farebbe l'utente.
  await page.fill('#newDictWord', LONG_WORD);
  await page.click('#addDict');

  const row = page.locator('.sn-spell-row-dict');
  await expect(row).toHaveCount(1);
  // La parola è visibile per intero (textContent integro, nessun troncamento del dato).
  await expect(row.locator('.sn-spell-word')).toHaveText(LONG_WORD);

  await assertFits(page, 'parola lunga');
  const removeBtn = row.locator('button');
  await expect(removeBtn).toBeVisible();
  await assertBtnInViewport(page, removeBtn, 'parola lunga');

  await page.screenshot({ path: join(SHOTS, 'fb214-dict-long-word.png'), fullPage: true });

  // SUCCESSO: il click su Rimuovi toglie davvero la parola (UI + storage).
  await removeBtn.click();
  await expect(page.locator('.sn-spell-row-dict')).toHaveCount(0);
  await expect(page.locator('#dictEmpty')).toBeVisible();
  expect(await getDict(page)).toEqual([]);
});

test('dizionario: stress 1000 char, emoji, XSS — sempre rimovibili, mai overflow', async ({ app, openTab }) => {
  const page = await openTab(PAGE);
  await page.waitForSelector('#addDict');

  const words = [
    'W'.repeat(1000),                                   // estremo
    '🧪🚀'.repeat(60) + 'emoji-fine',                    // emoji lunghi
    '<img src=x onerror="window.__xss214=1">scriptone', // tentativo XSS
  ];
  for (const w of words) {
    await page.fill('#newDictWord', w);
    await page.click('#addDict');
  }
  await expect(page.locator('.sn-spell-row-dict')).toHaveCount(words.length);

  // XSS: il markup NON deve essere interpretato (niente <img> nella lista,
  // nessun handler eseguito) ma mostrato come testo.
  const xss = await page.evaluate(() => ({
    imgs: document.querySelectorAll('#dictList img').length,
    fired: window.__xss214 || 0,
  }));
  expect(xss.imgs, 'nessun elemento img iniettato').toBe(0);
  expect(xss.fired, 'onerror mai eseguito').toBe(0);

  await assertFits(page, 'stress');

  // Doppio click rapido su add con parola duplicata: niente doppioni.
  await page.fill('#newDictWord', 'duplicata');
  await page.click('#addDict');
  await page.fill('#newDictWord', 'duplicata');
  await page.click('#addDict');
  const dictAfterDup = await getDict(page);
  expect(dictAfterDup.filter((w) => w === 'duplicata').length).toBe(1);

  await page.screenshot({ path: join(SHOTS, 'fb214-dict-stress.png'), fullPage: true });

  // Ogni riga resta rimovibile: bottone nel viewport e rimozione effettiva.
  while (await page.locator('.sn-spell-row-dict').count() > 0) {
    const btn = page.locator('.sn-spell-row-dict').first().locator('button');
    await assertBtnInViewport(page, btn, 'stress-rimozione');
    await btn.click();
  }
  await expect(page.locator('#dictEmpty')).toBeVisible();
  expect(await getDict(page)).toEqual([]);
});

test('autocorrect: trigger e correzione lunghissimi non spingono Rimuovi fuori schermo', async ({ app, openTab }) => {
  const page = await openTab(PAGE);
  await page.waitForSelector('#addAutocorrect');

  const trigger = 'trigger' + 'x'.repeat(300);
  const correction = 'correzione' + 'y'.repeat(300);
  await page.fill('#newWord', trigger);
  await page.fill('#newCorrection', correction);
  await page.click('#addAutocorrect');

  const rows = page.locator('#autocorrectList .sn-spell-row:not(.sn-spell-row-head)');
  await expect(rows).toHaveCount(1);

  await assertFits(page, 'autocorrect lungo');
  const removeBtn = rows.first().locator('button');
  await expect(removeBtn).toBeVisible();
  await assertBtnInViewport(page, removeBtn, 'autocorrect lungo');

  await page.screenshot({ path: join(SHOTS, 'fb214-autocorrect-long.png'), fullPage: true });

  // Rimozione effettiva (UI + storage).
  await removeBtn.click();
  await expect(rows).toHaveCount(0);
  const map = await page.evaluate(async () => {
    const d = await chrome.storage.local.get('sn_autocorrect');
    return d.sn_autocorrect || {};
  });
  expect(Object.keys(map)).toEqual([]);
});
