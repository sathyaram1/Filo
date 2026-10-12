// Rilievo 1 del giro 1 di #1193: prima della lettura le tendine non devono dire «definizione dell'agente».
import { test, expect } from '../../fixtures/electron.mjs';
import { PAGINA, server, tendina } from './aiuti.mjs';

test('r1 lettura lenta: prima della risposta nessuna tendina finge «definizione dell\'agente»', async ({ app, openTab }) => {
  await server(app, { routines: { roleModels: { secaudit: { model: 'sonnet' } } }, getRitardo: 4000 });
  const page = await openTab(PAGINA);
  await page.waitForFunction(() => window.__mgTest && window.SN_ROUTINE_MODELLI);
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await page.waitForTimeout(800);
  const prima = await tendina(page, 'secaudit', 'model').locator('.sn-select-value').textContent();
  await page.locator('#mgRoleModelsBlock').screenshot({ path: 'tests/.shots/1193-v-lettura-lenta.png' });
  await expect(tendina(page, 'secaudit', 'model').locator('.sn-select-value')).toHaveText('Sonnet', { timeout: 10000 });
  expect(prima).not.toBe('Definizione dell\'agente');
});
