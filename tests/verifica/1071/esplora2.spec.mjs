// Esplorazione giro 4: selezione di una parola nella risposta della spiegazione su un sito, poi tasto destro.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi } from '../../helpers/riquadri.mjs';

test('tasto destro su una parola selezionata nella spiegazione su un sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash', [C.ACTIONS.FOLLOWUP || 'followup']: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = { ...orig,
      complete: async () => ({ text: 'x', usage: {} }),
      streamComplete: async ({ onDelta }) => { onDelta('Vuol dire straordinario meraviglioso.'); return { text: 'Vuol dire straordinario meraviglioso.', usage: {} }; } };
  });
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif"><p id="parola" style="font-size:20px">supercalifragilistico</p></body></html>`);
  await page.locator('#parola').dblclick();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  await expect.poll(async () => (await statoDi(app, page, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('straordinario');
  const body = await statoDi(app, page, '.sn-popup-body');
  // Doppio clic vero sulla prima parola della risposta.
  const x = body.x + 30; const y = body.y + 12;
  await page.mouse.dblclick(x, y);
  const sel = await nelMondoDiFilo(app, page, () => String(window.getSelection()));
  console.log('SELEZIONE', JSON.stringify(sel));
  await page.mouse.click(x, y, { button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(800);
  const voci = await page.locator('.sn-menu .sn-menu-item').allTextContents();
  console.log('VOCI', JSON.stringify(voci));
  await page.screenshot({ path: 'tests/.shots/1071-g4-menu-spiegazione.png' });
});
