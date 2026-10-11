// Esplorazione del giro 3 di #1071: le voci del tasto destro dentro i riquadri chiusi su un sito.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, scrivi } from '../../helpers/riquadri.mjs';

const pagina = (corpo) => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">${corpo}</body></html>`;

test('taglia dal tasto destro nella casella del feedback su un sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina('<p>Sito</p>'));
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await scrivi(app, page, '.sn-fb-text', 'uno due');
  await page.keyboard.press('Control+A');
  await app.evaluate(({ clipboard }) => clipboard.writeText('vuoto'));
  const campo = await statoDi(app, page, '.sn-fb-text');
  await page.mouse.click(campo.x + 20, campo.y + 12, { button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 8000 });
  const voci = await page.locator('.sn-menu .sn-menu-item').allTextContents();
  console.log('VOCI', JSON.stringify(voci));
  await page.locator('.sn-menu .sn-menu-item', { hasText: 'Taglia' }).first().click();
  await page.waitForTimeout(800);
  const dopo = await statoDi(app, page, '.sn-fb-text');
  const appunti = await app.evaluate(({ clipboard }) => clipboard.readText());
  console.log('TAGLIA', JSON.stringify({ valore: dopo.valore, appunti }));
  expect(appunti).toBe('uno due');
  expect(dopo.valore).toBe('');
});

test('copia dal tasto destro di una parola selezionata nella spiegazione su un sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash', [C.ACTIONS.FOLLOWUP || 'followup']: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...orig,
      complete: async () => ({ text: 'Supercalifragilistico', usage: {} }),
      streamComplete: async ({ onDelta }) => { onDelta('Parolona lunghissima qui.'); return { text: 'Parolona lunghissima qui.', usage: {} }; },
    };
  });
  const page = await testServer.openReady(openTab, pagina('<p id="parola" style="font-size:20px">supercalifragilistico</p>'));
  await page.locator('#parola').dblclick();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  await expect.poll(async () => (await statoDi(app, page, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('Parolona');
  const corpo = await statoDi(app, page, '.sn-popup-body p, .sn-popup-body');
  const x = corpo.x + 30;
  const y = corpo.y + 12;
  await page.mouse.dblclick(x, y);
  await page.waitForTimeout(300);
  await app.evaluate(({ clipboard }) => clipboard.writeText('vuoto'));
  await page.mouse.click(x, y, { button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 8000 });
  const voci = await page.locator('.sn-menu .sn-menu-item').allTextContents();
  console.log('VOCI-SPIEGAZIONE', JSON.stringify(voci));
  await page.screenshot({ path: 'tests/.shots/1071-g3-menu-spiegazione.png' });
  await page.locator('.sn-menu .sn-menu-item', { hasText: 'Copia' }).first().click();
  await page.waitForTimeout(600);
  const appunti = await app.evaluate(({ clipboard }) => clipboard.readText());
  console.log('COPIA', JSON.stringify(appunti));
  expect(appunti).toBe('Parolona');
});
