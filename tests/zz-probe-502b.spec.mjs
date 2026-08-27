// SONDA TEMPORANEA — non fa parte della suite, va rimossa.
// Domanda: dando il fuoco alla riga per scrivere, la selezione della pagina
// resta o si spegne?
import { test, expect } from './fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<style>body{margin:0;font:16px/1.6 system-ui,sans-serif} #b{position:fixed;left:40px;top:60vh;font-size:20px}</style>
<p id="b">supercalifragilistico</p>`;

test('sonda: selezione dopo l\'apertura del riquadro', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    globalThis.SN_PROVIDER_GEMINI = {
      ...globalThis.SN_PROVIDER_GEMINI,
      streamComplete: async ({ onDelta }) => { onDelta('risposta'); return { text: 'risposta', usage: {} }; },
    };
  });

  await page.locator('#b').dblclick();
  const prima = await page.evaluate(() => String(window.getSelection()));
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  await page.waitForSelector('.sn-popup', { timeout: 10_000 });
  await page.waitForTimeout(800);
  const dopo = await page.evaluate(() => ({
    sel: String(window.getSelection()),
    attivo: document.activeElement?.className || '',
  }));
  console.log('SONDA prima=', JSON.stringify(prima), 'dopo=', JSON.stringify(dopo));
  expect(prima).toContain('supercali');
});
