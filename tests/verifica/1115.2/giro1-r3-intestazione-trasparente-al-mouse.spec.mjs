// Verifica #1115.2 giro 1, rilievo 3: un'intestazione fissa che lascia passare il mouse copre il campo come le altre;
// i segni passano sotto con la parola.
import { test, expect } from '../../fixtures/electron.mjs';

const SFONDO = '#3c3c3c';
const BARRA = { x: 0, y: 0, width: 800, height: 90 };

function caldi(app, page, rect) {
  return app.evaluate(async ({ BrowserWindow }, { u, rect }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      const tab = (win._filoTabs?.tabs || []).find((t) => { try { return t.view?.webContents?.getURL() === u; } catch (_) { return false; } });
      if (!tab) continue;
      const b = (await tab.view.webContents.capturePage(rect)).toBitmap();
      let n = 0;
      for (let i = 0; i + 2 < b.length; i += 4) if (b[i + 2] - b[i] > 50) n++;
      return n;
    }
    return null;
  }, { u: page.url(), rect });
}

test('r3 intestazione fissa con pointer-events:none: nessun segno sopra quando il campo ci passa sotto', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
    });
    const finto = async () => ({ text: '[][][][nessuno]', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;font:16px sans-serif;background:#fff">
  <header style="position:fixed;top:0;left:0;right:0;height:90px;background:${SFONDO};z-index:5;pointer-events:none"></header>
  <main style="padding:120px 20px 2000px"><textarea id="f" spellcheck="true" lang="it" style="display:block;width:700px;height:60px;font:22px sans-serif"></textarea></main></body>`;
  const page = await testServer.openReady(openTab, html, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#f').click();
  await page.keyboard.type('perchè martedì 9 ottobre 2024');
  await expect(page.locator('.sn-spell-overlay .sn-errore')).toHaveText(['perchè'], { timeout: 5000 });
  const top = () => page.evaluate(() => Math.round(document.getElementById('f').getBoundingClientRect().top));
  await page.evaluate((d) => window.scrollBy(0, d), (await top()) - 30);
  await expect.poll(top).toBe(30);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/v1115-2-r3.png' }).catch(() => {});
  expect(await caldi(app, page, BARRA), 'nessun segno sopra l\'intestazione').toBe(0);
});
