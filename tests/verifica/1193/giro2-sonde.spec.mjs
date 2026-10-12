// Sonde del verificatore #1193, giro 2: lettura lenta o fallita, scelta durante la lettura.
import { test, expect } from '../../fixtures/electron.mjs';
import { server, tendina, PAGINA } from './aiuti.mjs';

const valore = (page, r, c) => tendina(page, r, c).locator('.sn-select-value');

test('lettura lenta: nessuna tendina né interruttore mostra un valore prima della risposta', async ({ app, openTab }) => {
  await server(app, { routines: { roleModels: { secaudit: { model: 'sonnet' } }, accountBOff: true }, getRitardo: 4000 });
  const page = await openTab(PAGINA);
  await page.waitForFunction(() => window.__mgTest && window.SN_ROUTINE_MODELLI);
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await expect(page.locator('#panel-automation')).toHaveClass(/mg-in-lettura/);
  for (const r of ['new-work', 'verifier', 'fixer', 'secaudit', 'prober']) {
    for (const c of ['model', 'effort']) {
      const v = valore(page, r, c);
      const vis = await v.evaluate((el) => getComputedStyle(el).visibility);
      const testo = await v.textContent();
      expect(vis === 'hidden' || testo === '', `${r}.${c} mostra «${testo}» durante la lettura`).toBe(true);
    }
  }
  await page.evaluate(() => window.__mgTest.whenReady());
  await expect(page.locator('#panel-automation')).not.toHaveClass(/mg-in-lettura/);
  await expect(valore(page, 'secaudit', 'model')).toHaveText('Sonnet');
  await expect(valore(page, 'secaudit', 'model')).toBeVisible();
  await expect(valore(page, 'verifier', 'model')).toHaveText('Definizione dell\'agente');
});

test('scelta fatta mentre la lettura è per strada: resta quella, la lettura vecchia non la riscrive', async ({ app, openTab }) => {
  await server(app, { routines: { roleModels: { fixer: { model: 'opus' } } }, getRitardo: 2500 });
  const page = await openTab(PAGINA);
  await page.waitForFunction(() => window.__mgTest && window.SN_ROUTINE_MODELLI);
  await page.locator('.mg-tab[data-tab="automation"]').click();
  const t = tendina(page, 'fixer', 'model');
  await t.locator('.sn-select-button').click();
  await expect(t.locator('.sn-select-pop')).toBeVisible();
  await t.locator('.sn-select-option', { hasText: 'Haiku' }).click();
  await page.evaluate(() => window.__mgTest.whenReady());
  await expect(page.locator('#mgRoleModelsMsg')).toHaveText('Correzione: salvato.');
  await expect(valore(page, 'fixer', 'model')).toHaveText('Haiku');
  expect((await app.evaluate(() => globalThis.__v1193.doc.fields.roleModels.mapValue.fields.fixer.mapValue.fields.model.stringValue))).toBe('haiku');
});

test('lettura fallita: le tendine restano senza valore e la pagina dice che non le ha lette', async ({ app, openTab }) => {
  await server(app, { routines: { roleModels: { fixer: { model: 'opus' } } } });
  await app.evaluate(() => { const f = globalThis.fetch; globalThis.fetch = async (u, i = {}) => ((i.method || 'GET') === 'PATCH' ? f(u, i) : { ok: false, status: 503, headers: new Map(), async json() { return {}; }, async text() { return '{}'; } }); });
  const page = await openTab(PAGINA);
  await page.waitForFunction(() => window.__mgTest && window.SN_ROUTINE_MODELLI);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await expect(valore(page, 'fixer', 'model')).toHaveText('');
  await expect(page.locator('#mgRoleModelsMsg')).not.toHaveText('');
});
