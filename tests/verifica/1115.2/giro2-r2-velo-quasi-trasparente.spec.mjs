// Verifica #1115.2 giro 2, rilievo 2: un velo decorativo fissato sopra la pagina che lascia passare il mouse ed è quasi
// trasparente (la grana, una vignettatura ai bordi) non nasconde la parola, e non deve nascondere i segni.
import { test, expect } from '../../fixtures/electron.mjs';

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
const riga = (page) => page.evaluate(() => {
  const r = document.getElementById('f').getBoundingClientRect();
  return { x: Math.round(r.left) + 5, y: Math.round(r.top) + 5, width: Math.round(r.width) - 10, height: 34 };
});

for (const [nome, velo] of [
  ['la grana', '<div style="position:fixed;inset:0;z-index:9999;pointer-events:none;opacity:0.05;background-image:linear-gradient(45deg,#000 25%,transparent 25%)"></div>'],
  ['una vignettatura ai bordi', '<div style="position:fixed;inset:0;z-index:9999;pointer-events:none;background:radial-gradient(ellipse at center,transparent 60%,rgba(0,0,0,.4))"></div>'],
]) {
  test(`r2 ${nome} fissata sopra la pagina: i segni sul campo si vedono`, async ({ app, openTab, testServer }) => {
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
    const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;font:16px sans-serif">${velo}<main style="padding:40px 20px">
    <textarea id="f" spellcheck="true" lang="it" style="display:block;width:700px;height:100px;font:22px sans-serif"></textarea></main></body>`;
    const page = await testServer.openReady(openTab, html, { pubblico: true });
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    await page.locator('#f').click();
    await page.keyboard.type('perchè martedì 9 ottobre 2024');
    await expect(page.locator('.sn-spell-overlay .sn-errore')).toHaveText(['perchè'], { timeout: 5000 });
    // Il velo si cerca nel tempo libero: si lascia il tempo di trovarlo, poi si scrive ancora.
    await page.waitForTimeout(2000);
    await page.keyboard.type(' ');
    await page.waitForTimeout(800);
    expect(await caldi(app, page, await riga(page)), 'i segni si vedono sul campo').toBeGreaterThan(20);
  });
}
