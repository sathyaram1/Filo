// Verifica #1115.2 giro 1, rilievo 1: l'anno scritto nel titolo della nota (una casella o un campo modificabile sopra il
// corpo) vale come quello di un'intestazione: «mercoledì 9 ottobre» sotto «Diario 2024» è giusto e non si segna.
import { test, expect } from '../../fixtures/electron.mjs';

async function apri(app, openTab, testServer, html) {
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
  const page = await testServer.openReady(openTab, html, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

for (const [nome, titolo] of [
  ['casella del titolo', '<input id="t" value="Diario 2024" style="display:block;font:28px sans-serif;border:0">'],
  ['titolo modificabile', '<div id="t" contenteditable="true" style="font:28px sans-serif">Diario 2024</div>'],
]) {
  test(`r1 nota, ${nome} «Diario 2024»: una data giusta del 2024 nel corpo non si segna`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    const html = `<!doctype html><meta charset="utf-8"><title>Note</title><body style="margin:0;padding:20px;font:16px sans-serif">
    <div class="nota">${titolo}
    <textarea id="f" spellcheck="true" lang="it" style="display:block;width:700px;height:100px;font:20px sans-serif"></textarea></div></body>`;
    const page = await apri(app, openTab, testServer, html);
    await page.locator('#f').click();
    await page.keyboard.type('mercoledì 9 ottobre, pioveva perchè era autunno');
    // «perchè» segnato vuol dire che il controllo delle date è già passato sullo stesso testo.
    await expect(page.locator('.sn-spell-overlay .sn-errore')).toHaveText(['perchè'], { timeout: 5000 });
    await page.waitForTimeout(500);
    await expect(page.locator('.sn-spell-overlay .sn-suggerimento')).toHaveCount(0);
  });
}
