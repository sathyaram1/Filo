// #853 giro 4, rilievo 2: una risposta con una lunga fila di parentesi quadre
// aperte blocca la pagina: il tempo del disegno cresce col quadrato della fila
// (c'era già su main, nello stesso formattatore che il ramo modifica).

import { test, expect } from '../../fixtures/electron.mjs';

const RISPOSTA = 'Vedi ' + '['.repeat(80_000) + ' fine della spiegazione';

test('una risposta con molte parentesi quadre aperte compare subito nel menu', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await app.evaluate(async (_e, t) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__origP853g4r2 = globalThis.__origP853g4r2 || globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origP853g4r2,
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
    window.__g4r2 = { t0: 0, t1: 0 };
    new MutationObserver(() => {
      const b = document.querySelector('.sn-menu .sn-menu-inline-explain .sn-menu-inline-body');
      if (b && b.textContent.includes('fine della spiegazione') && !window.__g4r2.t1) window.__g4r2.t1 = performance.now();
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  });
  await page.evaluate(() => { window.__g4r2.t0 = performance.now(); });
  await doc.click({ button: 'right' });
  const corpo = page.locator('.sn-menu .sn-menu-inline-explain .sn-menu-inline-body');
  await expect(corpo).toContainText('fine della spiegazione', { timeout: 90_000 });
  const ms = await page.evaluate(() => window.__g4r2.t1 - window.__g4r2.t0);
  expect(ms, `la spiegazione è comparsa dopo ${Math.round(ms)} ms`).toBeLessThan(2000);
});
