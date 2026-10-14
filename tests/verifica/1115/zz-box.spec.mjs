import { test, expect } from '../../fixtures/electron.mjs';
const CAMPO = process.env.CAMPO;
test('box', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_WORD]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry, featureFlags: { spellcheck: true, spellcheckContext: true } });
    const finto = async ({ messages }) => { const t = JSON.stringify(messages);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (t.includes('Controlli la COERENZA')) return fine(JSON.stringify({ issues: [{ tipo: 'contraddizione', testo: 'mercoledì', citazione: 'ci vediamo martedì?', spiegazione: 'x', correzione: '' }] }));
      if (t.includes('Analizza il testo qui sotto')) return fine('{"annotated":"","issues":[]}');
      return fine('{"misspelled":false,"correction":""}'); };
    globalThis.SN_PROVIDERS.completeWithFallback = finto; globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
  const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:20px;font:16px sans-serif"><div role="log"><div>Anna: ciao! ci vediamo martedì?</div></div>${CAMPO}</body>`, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#f').click();
  await page.keyboard.type('allora va bene, ho sentito anche gli altri e sì ci vediamo mercoledì');
  await expect(page.locator('.sn-coerenza')).toHaveCount(1, { timeout: 12000 });
  await page.waitForTimeout(400);
  const info = await page.evaluate(() => {
    const f = document.getElementById('f'); const s = document.querySelector('.sn-coerenza').getBoundingClientRect();
    let b;
    if (f.tagName === 'TEXTAREA') b = null; else { const r = document.createRange(); const n = f.firstChild; const i = n.nodeValue.indexOf('mercoledì'); r.setStart(n, i); r.setEnd(n, i + 9); b = r.getBoundingClientRect(); }
    return { segno: [Math.round(s.x), Math.round(s.y)], parola: b && [Math.round(b.x), Math.round(b.y)] };
  });
  console.log('INFO', JSON.stringify(info));
  await page.screenshot({ path: 'tests/.shots/v1115-box.png' });
});
