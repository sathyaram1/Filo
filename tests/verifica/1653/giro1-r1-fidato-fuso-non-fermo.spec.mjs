// Verifica #1653 giro 1: in Gestione un lavoro fidato fuso con i blocchi registrati non deve leggersi come fermo.
import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';

test('r1 un blocco registrato su un lavoro fidato e fuso non si legge come una fusione fermata', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderChannelLog);
  await apriScheda(page, 'log');

  // La riga come la scrive adesso il server per un lavoro fidato: si fonde e il blocco si registra soltanto.
  const rej = [{
    id: 'f1', at: '2026-10-25T06:27:00.000Z', slug: 'recupero dal server', role: 'server', reason: 'l5_blocked', action: 'merge',
    num: '#1040.1', detail: 'lavoro fidato, si fonde e si registra: guard_the_guards: firestore.rules',
  }];
  await page.evaluate((r) => window.__mgTest.renderChannelLog(r, []), rej);

  const row = page.locator('#mgChannelList .mg-log-row').first();
  await expect(row).toContainText('#1040.1');
  await expect(row).not.toContainText('fermata');
  await expect(row).not.toContainText('Respinto');
  await expect(row).toContainText(/fidato|fuso|fusa/);
});
