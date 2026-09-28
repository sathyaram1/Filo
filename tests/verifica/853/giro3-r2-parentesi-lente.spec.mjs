// #853 giro 3, rilievo 2: un indirizzo seguito da una lunga fila di parentesi
// chiuse blocca la pagina per secondi a ogni disegno della risposta: il tempo
// cresce col quadrato della fila (su main era lineare).

import { test, expect } from '../../fixtures/electron.mjs';

const RISPOSTA = 'Vedi https://example.com/pagina' + ')'.repeat(40_000);

test('una risposta con un indirizzo seguito da molte parentesi compare subito nel menu', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await app.evaluate(async (_e, t) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__origP853g3r2 = globalThis.__origP853g3r2 || globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origP853g3r2,
      complete: async () => ({ text: t, toolCalls: [], reasoningDetails: [], usage: {} }),
    };
  }, RISPOSTA);

  const page = await openTab('filo://editor/editor.html');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1');
  const doc = page.locator('#doc');
  await doc.click();
  await page.keyboard.type('Una frase qualunque.');
  await page.evaluate(() => {
    const r = document.createRange(); r.selectNodeContents(document.querySelector('#doc'));
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    // Il tempo si misura nella pagina: se il disegno la blocca, anche il test resta fermo.
    window.__g3r2 = { t0: 0, t1: 0 };
    new MutationObserver(() => {
      const a = document.querySelector('.sn-menu .sn-menu-inline-explain .sn-menu-inline-body a.filo-md-link');
      if (a && !window.__g3r2.t1) window.__g3r2.t1 = performance.now();
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
  await page.evaluate(() => { window.__g3r2.t0 = performance.now(); });
  await doc.click({ button: 'right' });
  const corpo = page.locator('.sn-menu .sn-menu-inline-explain .sn-menu-inline-body');
  await expect(corpo.locator('a.filo-md-link')).toHaveAttribute('href', 'https://example.com/pagina', { timeout: 90_000 });
  const ms = await page.evaluate(() => window.__g3r2.t1 - window.__g3r2.t0);
  expect(ms, `la spiegazione è comparsa dopo ${Math.round(ms)} ms`).toBeLessThan(3000);
});
