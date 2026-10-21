import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:60px 20px 20px;font:16px sans-serif;height:3000px">
<textarea id="ta" lang="it" style="display:block;width:760px;height:140px;font:22px sans-serif;padding:8px"></textarea>
<div id="ce" contenteditable="true" lang="it" style="width:760px;min-height:90px;font:16px sans-serif;border:1px solid #999;margin-top:40px;padding:4px"></div>
</body>`;

const COLOMBO = '[nel 14xx][nel 1492][Cristoforo Colombo sbarcò in America il 12 ottobre 1492][segnaposto]';

async function apri(app, openTab, testServer, theme) {
  await app.evaluate(async (_e, { COLOMBO, theme }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      theme,
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
      correttore: { modelloErrori: true, ripetizioni: true, pausaRagionatoMs: 1000, segnaposti: true, segnapostiWeb: true },
    });
    globalThis.__ragionate = 0;
    const finto = async ({ messages }) => {
      const t = String(messages[messages.length - 1].content);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (t.includes('proponi SUGGERIMENTI')) { globalThis.__ragionate++; return fine(t.includes('14xx') ? COLOMBO : '[][][][nessuno]'); }
      return fine('[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, { COLOMBO, theme });
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

const valore = (page) => page.locator('.sn-spell-valori .sn-spell-valore', { hasText: '1492' });

test('esplora annulla e scorri', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, 'light');
  await page.locator('#ta').click();
  await page.keyboard.type("l'America l'hanno scoperta nel 14xx. ");
  await expect(valore(page)).toBeVisible({ timeout: 8000 });
  await page.screenshot({ path: 'tests/.shots/1448-chiaro.png', clip: { x: 0, y: 0, width: 820, height: 260 } });
  await page.mouse.wheel(0, 40);
  await page.waitForTimeout(400);
  const segno = await page.locator('.sn-spell-overlay .sn-suggerimento', { hasText: '14xx' }).boundingBox();
  const v = await valore(page).boundingBox();
  console.log('DOPO SCROLL segno', JSON.stringify(segno), 'valore', JSON.stringify(v));
  await page.mouse.wheel(0, -40);
  await page.waitForTimeout(300);
  await valore(page).click();
  await expect(page.locator('#ta')).toHaveValue("l'America l'hanno scoperta nel 1492. ");
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(2500);
  console.log('DOPO ANNULLA testo', await page.locator('#ta').inputValue(), 'valori', await page.locator('.sn-spell-valori .sn-spell-valore').count(), 'ragionate', await app.evaluate(() => globalThis.__ragionate));
  // Il contenteditable con poco padding sopra.
  await page.locator('#ce').click();
  await page.keyboard.type("Colombo arrivò nel 14xx. ");
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'tests/.shots/1448-ce.png', clip: { x: 0, y: 150, width: 820, height: 200 } });
});

test('esplora scuro', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, 'dark');
  await page.locator('#ta').click();
  await page.keyboard.type("l'America l'hanno scoperta nel 14xx. ");
  await expect(valore(page)).toBeVisible({ timeout: 8000 });
  await valore(page).hover();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/1448-scuro.png', clip: { x: 0, y: 0, width: 820, height: 260 } });
});
