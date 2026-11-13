// Esplorazione del giro 5 di #1115.2: intestazioni appiccicate e traslucide, campo sotto la barra.
import { test, expect } from '../../fixtures/electron.mjs';
import { segniDi } from '../../helpers/segniDelCorrettore.mjs';
import { batti } from '../../helpers/tastiera.mjs';

const TA = '<textarea id="f" spellcheck="true" lang="it" style="display:block;width:700px;height:60px;font:22px sans-serif"></textarea>';
const SFONDO = '#3c3c3c';

async function apri(app, openTab, testServer, html) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
      correttore: { automatica: false },
    });
    const finto = async () => ({ text: '[][][][nessuno]', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
  const page = await testServer.openReady(openTab, html, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#f').click();
  await batti(page, 'perchè martedì 9 ottobre 2024');
  await expect(segniDi(page, '.sn-spell-overlay .sn-errore')).toHaveText(['perchè'], { timeout: 5000 });
  await expect(segniDi(page, '.sn-spell-overlay .sn-suggerimento')).toHaveText(['martedì 9 ottobre 2024'], { timeout: 5000 });
  return page;
}

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
const BARRA = { x: 0, y: 0, width: 800, height: 90 };

for (const [nome, html] of [
  ['intestazione appiccicata', `<!doctype html><meta charset="utf-8"><body style="margin:0;font:16px sans-serif;background:#fff">
<header style="position:sticky;top:0;height:90px;background:${SFONDO};z-index:5"></header>
<main style="padding:30px 20px 2000px">${TA}</main></body>`],
  ['intestazione fissa con la sfocatura', `<!doctype html><meta charset="utf-8"><body style="margin:0;font:16px sans-serif;background:#fff">
<header style="position:fixed;top:0;left:0;right:0;height:90px;background:rgba(60,60,60,.85);backdrop-filter:blur(8px);z-index:5"></header>
<main style="padding:120px 20px 2000px">${TA}</main></body>`],
  ['barra appiccicata dentro la colonna che scorre', `<!doctype html><meta charset="utf-8">
<body style="margin:0;font:16px sans-serif;background:#fff;height:100vh;display:flex;flex-direction:column">
<div id="colonna" style="flex:1;overflow:auto"><div style="position:sticky;top:0;height:90px;background:${SFONDO};z-index:2"></div>
<div style="padding:30px 20px 2000px">${TA}</div></div></body>`],
]) {
  test(`${nome}: i segni non restano sopra la barra`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await apri(app, openTab, testServer, html);
    await page.evaluate(() => {
      const f = document.getElementById('f');
      const c = document.getElementById('colonna');
      const d = f.getBoundingClientRect().top - 30;
      if (c) c.scrollTop += d; else window.scrollBy(0, d);
    });
    await expect.poll(() => page.evaluate(() => Math.round(document.getElementById('f').getBoundingClientRect().top))).toBe(30);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `tests/.shots/1115-2-g5-${nome.replace(/\W+/g, '-')}.png` }).catch(() => {});
    expect(await caldi(app, page, BARRA), 'nessun segno sopra la barra').toBe(0);
  });
}
