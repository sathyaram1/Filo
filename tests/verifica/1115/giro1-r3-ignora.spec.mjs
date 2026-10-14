// Verifica #1115 giro 1, rilievo 3: «Ignora» su una contraddizione tiene anche quando al controllo dopo il modello
// segna un pezzo un po' diverso della stessa frase, con la stessa citazione.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
<div role="log">
  <div>Anna: ciao! ci vediamo martedì?</div>
  <div>Anna: perfetto, porto io i biglietti</div>
</div>
<textarea id="ta" style="width:700px;height:100px;font:22px monospace"></textarea>
</body>`;

const risposta = (testo) => JSON.stringify({ issues: [{
  tipo: 'contraddizione', testo, citazione: 'ci vediamo martedì?', spiegazione: 'Prima si era detto martedì.', correzione: '',
}] });

test('r3 dopo «Ignora» la stessa contraddizione non torna se il modello la segna su qualche parola in più', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(async (_e, risposte) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash',
        [C.ACTIONS.SPELLCHECK_WORD]: 'deepseek-flash',
        [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
    });
    globalThis.__ocraN = 0;
    const finto = async ({ messages }) => {
      const t = JSON.stringify(messages);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (t.includes('Controlli la COERENZA')) return fine(risposte[Math.min(globalThis.__ocraN++, 1)]);
      if (t.includes('Analizza il testo qui sotto')) return fine('{"annotated":"","issues":[]}');
      return fine('{"misspelled":false,"correction":""}');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, [risposta('mercoledì'), risposta('vediamo mercoledì')]);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const ocra = page.locator('.sn-spell-overlay .sn-coerenza');
  await page.locator('#ta').click();
  await page.keyboard.type('sì ci vediamo mercoledì');
  await expect(ocra).toHaveText(['mercoledì'], { timeout: 12_000 });
  const b = await ocra.first().boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  await page.locator('.sn-menu .sn-menu-item', { hasText: 'Ignora' }).click();
  await expect(ocra).toHaveCount(0);
  await page.locator('#ta').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' alle 18');
  await expect.poll(() => app.evaluate(() => globalThis.__ocraN), { timeout: 12_000 }).toBe(2);
  await page.waitForTimeout(800);
  await expect(ocra).toHaveCount(0);
});
