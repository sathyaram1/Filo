// #514 (giro 11) — controprova: la risposta e il menu insieme, FUORI dallo
// schermo intero. Serve a capire se il fatto che un Esc solo li chiuda tutti e
// due sia roba di questo lavoro o comportamento di sempre.

import { test, expect } from './fixtures/electron.mjs';

const LETTORE = `<!doctype html><html><body style="margin:0;height:1200px">
<h1 id="t">un sito</h1>
<p id="p">una parola qualunque dentro una frase qualunque</p>
</body></html>`;

async function esc(app, attesa = 1200) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, attesa));
}

async function preparaProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.SN_PROVIDER_OPENROUTER,
      streamComplete: async ({ onDelta }) => {
        await new Promise((r) => setTimeout(r, 30_000));
        onDelta('.');
        return { text: '.', usage: {} };
      },
    };
  });
}

test('fuori dallo schermo intero: la risposta e il menu insieme, un Esc solo li chiude tutti e due?', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, LETTORE);
  await preparaProvider(app);

  await page.evaluate(() => {
    const p = document.querySelector('#p');
    const range = document.createRange();
    range.selectNodeContents(p);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  await page.waitForSelector('.sn-popup', { timeout: 15_000 });
  await new Promise((r) => setTimeout(r, 500));

  await page.locator('#t').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 8000 });
  await new Promise((r) => setTimeout(r, 400));

  await esc(app);
  expect(
    { menu: await page.locator('.sn-menu').count(), risposta: await page.locator('.sn-popup').count() },
    'fuori dallo schermo intero il primo Esc dovrebbe chiudere solo il menu',
  ).toEqual({ menu: 0, risposta: 1 });
});
