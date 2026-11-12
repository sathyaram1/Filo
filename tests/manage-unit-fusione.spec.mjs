// UNA PRATICA CHE ASPETTA GLI UNIT SULLA FUSIONE (#1207).
//
// COSA DEVE ESSERE VERO
//   Col pass del controllo di sicurezza il server fa girare in GitHub gli unit sul ramo fuso con main e porta lui il
//   lavoro su main: la scheda lo dice al posto dell'iter delle routine, che lì non c'è. Un segno rimasto su una
//   pratica rimessa in lavorazione non si mostra.

import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

function fb(over = {}) {
  return Object.assign({
    _id: 'u-1', name: 'Il tasto salva ricorda la cartella', text: 'Quando salvo vorrei la stessa cartella di prima.',
    seq: 1300, subSeq: 0, status: 'revision_security', statusPublic: 'open', clientId: 'anon:prova',
    createdAt: '2026-10-18T07:00:00Z', images: [], branch: 'worker/u-1-20261018T090000Z',
  }, over);
}

test('#1207: la scheda dice che il server sta provando gli unit sulla fusione; rimessa in lavorazione no', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  const attesa = fb({ attesa: 'unit_fusione' });
  const rimessa = fb({ _id: 'u-2', seq: 1301, status: 'revision_capability', attesa: 'unit_fusione', branch: 'worker/u-2-20261018T090000Z' });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, [attesa, rimessa]);
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  const riga = page.locator('.mg-item[data-id="u-1"] .mg-attesa-server');
  await expect(riga).toHaveText('Unit sulla fusione');
  await expect(riga).toHaveAttribute('title', /unit test sul ramo fuso con main di adesso.*ogni cinque minuti/);
  await expect(page.locator('.mg-item[data-id="u-1"] .mg-step')).toHaveCount(0);
  await expect(page.locator('.mg-item[data-id="u-2"]')).toBeVisible();
  await expect(page.locator('.mg-item[data-id="u-2"] .mg-attesa-server')).toHaveCount(0);
  await page.locator('.mg-item[data-id="u-1"]').screenshot({ path: 'tests/.shots/1207-attesa-unit.png' });
});
