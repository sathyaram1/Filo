// Sonde del verificatore #1193 passate: tastiera, salvataggio rifiutato, scelte di fila su tendine diverse.
import { test, expect } from '../../fixtures/electron.mjs';
import { server, tendina, apri } from './aiuti.mjs';

test('tastiera: una scelta fatta coi tasti si salva come col mouse', async ({ app, openTab }) => {
  await server(app);
  const page = await apri(openTab);
  const t = tendina(page, 'verifier', 'effort');
  await t.locator('.sn-select-button').focus();
  await page.keyboard.press('Enter');
  await expect(t.locator('.sn-select-pop')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('#mgRoleModelsMsg')).toHaveText('Verifica: salvato.');
  const p = await app.evaluate(() => globalThis.__v1193.patch);
  expect(p.length).toBe(1);
  expect(p[0].mask).toEqual(['roleModels.verifier.effort']);
});

test('salvataggio rifiutato: la tendina torna al valore di prima e la pagina lo dice', async ({ app, openTab }) => {
  await server(app, { routines: { roleModels: { fixer: { model: 'opus' } } }, patchStatus: 403 });
  const page = await apri(openTab);
  const t = tendina(page, 'fixer', 'model');
  await expect(t.locator('.sn-select-value')).toHaveText('Opus');
  await t.locator('.sn-select-button').click();
  await t.locator('.sn-select-option', { hasText: 'Haiku' }).click();
  await expect(page.locator('#mgRoleModelsMsg')).toContainText('salvataggio fallito');
  await expect(t.locator('.sn-select-value')).toHaveText('Opus');
  await expect(page.locator('select[data-ruolo="fixer"][data-campo="model"]')).toHaveValue('opus');
});

test('due tendine diverse in fretta: tutte e due sul server e sullo schermo', async ({ app, openTab }) => {
  await server(app);
  const page = await apri(openTab);
  await app.evaluate(() => { globalThis.__v1193.patchRitardi = [800, 0, 0]; });
  for (const [r, c, v] of [['new-work', 'model', 'Haiku'], ['prober', 'effort', 'low'], ['new-work', 'effort', 'xhigh']]) {
    const t = tendina(page, r, c);
    await t.locator('.sn-select-button').click();
    await t.locator('.sn-select-option', { hasText: v }).click();
  }
  await expect(page.locator('#mgRoleModelsMsg')).toHaveText('Primo lavoro: salvato.');
  await expect(tendina(page, 'new-work', 'model').locator('.sn-select-value')).toHaveText('Haiku');
  await expect(tendina(page, 'prober', 'effort').locator('.sn-select-value')).toHaveText('low');
  await expect(tendina(page, 'new-work', 'effort').locator('.sn-select-value')).toHaveText('xhigh');
  const masks = (await app.evaluate(() => globalThis.__v1193.patch)).map((p) => p.mask[0]);
  expect(masks).toEqual(['roleModels.`new-work`.model', 'roleModels.prober.effort', 'roleModels.`new-work`.effort']);
});
