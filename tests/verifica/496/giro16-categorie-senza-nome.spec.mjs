// VERIFICA #496 — giro 16. La divisione per categoria.
//
// Il feedback chiedeva i «feedback ricevuti (espandibile vedendo il dato
// diviso per categoria)». Qui si guarda cosa c'è scritto nelle righe che si
// aprono: devono dire in che categoria stanno le segnalazioni contate, non
// ripetere la stessa parola su tutte.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const GIORNO = 24 * 60 * 60 * 1000;
const g = (n) => new Date(Date.now() - n * GIORNO).toISOString();

function fb(over = {}) {
  return Object.assign({
    _id: 'v496-' + Math.random().toString(36).slice(2),
    seq: 1, subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: g(1),
    status: 'todo',
    text: 'testo', name: 'titolo', images: [],
  }, over);
}

async function apri(page, dati) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate((d) => window.__mgTest.setFsData(d), dati);
  await expect(page.locator('#mgFsBody')).toBeVisible();
}

test('#496 giro16 — le righe della divisione per categoria dicono la categoria', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [
      fb({ seq: 1, status: 'todo' }),
      fb({ seq: 2, status: 'done' }),
      fb({ seq: 3, status: 'spam' }),
      fb({ seq: 4, status: 'working' }),
      fb({ seq: 5, status: 'archived' }),
    ],
    workerLog: [],
  });
  await page.locator('[data-fs-range="30g"]').click();
  await page.locator('[data-fs-tile="ricevuti"]').click();

  const righe = page.locator('.mg-fs-detail .mg-bar-row');
  await expect(righe.first()).toBeVisible();
  // Traccia del giro: com'è fatto l'elenco che si apre.
  await page.locator('.mg-fs-detail').screenshot({ path: 'tests/.shots/496-giro16-categorie.png' });
  const etichette = await page.locator('.mg-fs-detail .mg-bar-row[data-fs-bar="todo"] .mg-bar-label, '
    + '.mg-fs-detail .mg-bar-row[data-fs-bar="done"] .mg-bar-label, '
    + '.mg-fs-detail .mg-bar-row[data-fs-bar="spam"] .mg-bar-label, '
    + '.mg-fs-detail .mg-bar-row[data-fs-bar="working"] .mg-bar-label, '
    + '.mg-fs-detail .mg-bar-row[data-fs-bar="archived"] .mg-bar-label')
    .evaluateAll((els) => els.map((e) => e.textContent.trim()));

  expect(etichette.length, 'le cinque categorie devono comparire').toBe(5);
  // Cinque categorie diverse, cinque nomi diversi: se sono tutti uguali
  // l'elenco non dice più niente.
  expect(new Set(etichette).size, `le righe si chiamano tutte uguali: ${JSON.stringify(etichette)}`).toBe(5);
  for (const e of etichette) {
    expect(e, 'una categoria che esiste non si chiama «Stato ignoto»').not.toMatch(/ignoto/i);
  }
});

test('#496 giro16 — anche «Feedback lavorati» dice dove sono arrivati, per nome', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [
      fb({ seq: 30, status: 'done', createdAt: g(40) }),
      fb({ seq: 31, status: 'working', createdAt: g(40) }),
    ],
    workerLog: [
      { role: 'new-work', startedAt: g(1), num: '30' },
      { role: 'new-work', startedAt: g(1), num: '31' },
    ],
  });
  await page.locator('[data-fs-range="7g"]').click();
  await page.locator('[data-fs-tile="lavorati"]').click();

  const etichette = await page.locator('.mg-fs-detail .mg-bar-label')
    .evaluateAll((els) => els.map((e) => e.textContent.trim()));
  expect(etichette.length).toBeGreaterThan(1);
  expect(new Set(etichette).size, `le righe si chiamano tutte uguali: ${JSON.stringify(etichette)}`)
    .toBe(etichette.length);
});
