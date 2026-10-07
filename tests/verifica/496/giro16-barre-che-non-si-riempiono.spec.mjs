// VERIFICA #496 — giro 16. Le barrette degli elenchi che si aprono.
//
// Ogni riga della divisione (per categoria, per mittente, per mestiere) è
// fatta di tre pezzi: il nome, una barra proporzionale e il numero. La barra
// serve a far vedere a colpo d'occhio chi pesa di più. Qui si prova che la
// barra si riempie davvero, e che una riga da 3 si distingue da una da 1
// anche senza leggere le cifre.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const g = (n) => new Date(Date.now() - n * 86400000).toISOString();
const fb = (o) => Object.assign({
  _id: 'v496-' + Math.random().toString(36).slice(2),
  seq: 1, subSeq: 0, clientId: 'tester@example.com',
  createdAt: g(1), status: 'todo', text: 'testo', name: 'titolo', images: [],
}, o);

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

test('#496 giro16 — la barra di una riga si riempie, e più grande è il numero più è lunga', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [
      fb({ seq: 1, status: 'todo' }), fb({ seq: 2, status: 'todo' }), fb({ seq: 3, status: 'todo' }),
      fb({ seq: 4, status: 'done' }),
    ],
    workerLog: [],
  });
  await page.locator('[data-fs-range="30g"]').click();
  await page.locator('[data-fs-tile="ricevuti"]').click();
  await expect(page.locator('.mg-fs-detail')).toBeVisible();

  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.waitForTimeout(120);
    const misure = await page.locator('.mg-fs-detail .mg-bar-row .mg-bar-fill')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
    expect(misure.length, `tema ${tema}`).toBeGreaterThan(1);
    for (const w of misure) {
      expect(w, `tema ${tema}: una barra larga zero non fa vedere niente`).toBeGreaterThan(0);
    }
    // La riga da 3 deve avere una barra più lunga della riga da 1.
    expect(misure[0], `tema ${tema}: tutte le barre lunghe uguali`).toBeGreaterThan(misure[1]);
    await page.locator('.mg-fs-detail').screenshot({ path: `tests/.shots/496-giro16-barre-${tema}.png` });
  }
});
