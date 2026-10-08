// Verifica #1071 giro 2, rilievo 2: un clic fabbricato dal sito sul riquadro della spiegazione non apre i
// collegamenti scritti dal modello; quello vero dell'utente sì.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi } from '../../helpers/riquadri.mjs';

const RISPOSTA = 'Vuol dire straordinario. Vedi [la voce](https://example.org/voce).';

test('r2 il clic finto del sito sul riquadro non apre il collegamento della risposta', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(async (_e, risposta) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash', [C.ACTIONS.FOLLOWUP || 'followup']: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = { ...orig,
      complete: async () => ({ text: 'x', usage: {} }),
      streamComplete: async ({ onDelta }) => { onDelta(risposta); return { text: risposta, usage: {} }; } };
  }, RISPOSTA);
  const page = await testServer.openReady(openTab, '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif"><p id="parola" style="font-size:20px">supercalifragilistico</p></body></html>');
  await page.locator('#parola').dblclick();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  await expect.poll(async () => (await statoDi(app, page, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('straordinario');
  await nelMondoDiFilo(app, page, () => {
    window.__aperti = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => {
      if (m && m.type === 'apri_collegamento_filo') { window.__aperti.push(m.url); return Promise.resolve({ ok: true }); }
      return orig(m, ...r);
    };
  });
  const pt = await nelMondoDiFilo(app, page, () => {
    const a = globalThis.SN_FILO_UI._test.trova('a.filo-md-link');
    const r = a.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.evaluate((p) => {
    const host = document.querySelector('[data-sn-riquadro]');
    host.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, clientX: p.x, clientY: p.y, detail: 1 }));
  }, pt);
  await page.waitForTimeout(500);
  expect(await nelMondoDiFilo(app, page, () => window.__aperti), 'lo script del sito non apre il collegamento').toEqual([]);
  await page.mouse.click(pt.x, pt.y);
  await expect.poll(() => nelMondoDiFilo(app, page, () => window.__aperti)).toEqual(['https://example.org/voce']);
});
