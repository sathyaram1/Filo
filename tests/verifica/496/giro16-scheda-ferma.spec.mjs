// VERIFICA #496 — giro 16. La scheda lasciata aperta.
//
// La pagina di gestione si rimette in pari da sola: ogni tot secondi rilegge
// e ridisegna la lista. La scheda delle statistiche si legge invece una volta
// sola, nel momento in cui la apri. Chi guarda i numeri mentre le routine
// lavorano — che è quando li si guarda — li vede fermi a quando ha cambiato
// scheda, senza che niente lo dica.

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
    _updateTime: 't1',
  }, over);
}

test('#496 giro16 — la scheda aperta segue quello che arriva, come il resto della pagina', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));

  const A = fb({ _id: 'fs-a', seq: 1 });
  const B = fb({ _id: 'fs-b', seq: 2 });
  await page.evaluate((a) => window.__mgTest.setData([a]), A);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate((a) => window.__mgTest.setFsData({ feedbacks: [a], workerLog: [] }), A);
  await expect(page.locator('#mgFsBody')).toBeVisible();
  await page.locator('[data-fs-range="30g"]').click();
  await expect(page.locator('[data-fs-id="ricevuti"] .mg-tile-n')).toHaveText('1');

  // Arriva una segnalazione nuova mentre la scheda è aperta: la pagina la
  // legge da sola col suo giro di aggiornamento.
  await page.evaluate(({ A, B }) => {
    window.__liveState = {
      versions: [{ _id: 'fs-a', _updateTime: 't1' }, { _id: 'fs-b', _updateTime: 't1' }],
      docs: { 'fs-a': A, 'fs-b': B },
    };
    window.__mgTest.setLiveSources({
      listVersions: async () => window.__liveState.versions,
      getMany: async (ids) => ids.map((id) => window.__liveState.docs[id]).filter(Boolean),
    });
  }, { A, B });
  const r = await page.evaluate(() => window.__mgTest.pollNow());
  expect(r.changed).toBe(1);

  // La scheda davanti agli occhi deve dire due, non uno.
  await expect(page.locator('[data-fs-id="ricevuti"] .mg-tile-n')).toHaveText('2', { timeout: 15000 });
});
