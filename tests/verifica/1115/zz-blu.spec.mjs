import { test, expect } from '../../fixtures/electron.mjs';
test('blu', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_WORD]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry, featureFlags: { spellcheck: true, spellcheckContext: true } });
    const finto = async ({ messages }) => { const t = JSON.stringify(messages);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (t.includes('Controlli la COERENZA')) return fine(process.env.OC ? JSON.stringify({ issues: [{ tipo: 'contraddizione', testo: 'mercoledì', citazione: 'ci vediamo martedì?', spiegazione: 'x', correzione: '' }] }) : '{"issues":[]}');
      if (t.includes('Analizza il testo qui sotto')) return fine(JSON.stringify({ annotated: 'uno\ndue\ntre\nquattro\ncinque\nsì ci vediamo **mercoledì**', issues: [{ type: 'grammar', explanation: 'x', correction: 'martedì' }] }));
      return fine('{"misspelled":false,"correction":""}'); };
    globalThis.SN_PROVIDERS.completeWithFallback = finto; globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
  const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:20px;font:16px sans-serif"><div role="log"><div>Anna: ciao! ci vediamo martedì?</div></div><textarea id="f" style="width:420px;height:80px;font:22px sans-serif"></textarea></body>`, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#f').click();
  for (const r of ['uno', 'due', 'tre', 'quattro', 'cinque']) { await page.keyboard.type(r); await page.keyboard.press('Enter'); }
  await page.keyboard.type('sì ci vediamo mercoledì');
  await expect(page.locator('.sn-semantic-error')).toHaveCount(1, { timeout: 12000 });
  await page.waitForTimeout(500);
  console.log('INFO', JSON.stringify(await page.evaluate(() => {
    const f = document.getElementById('f'); const o = document.querySelector('.sn-spell-overlay'); const s = document.querySelector('.sn-semantic-error').getBoundingClientRect();
    const fr = f.getBoundingClientRect(); const or = o.getBoundingClientRect(); const cs = getComputedStyle(f), os = getComputedStyle(o);
    return { s: [s.top, s.bottom], f: [fr.top, fr.bottom], o: [or.top, or.bottom], fScroll: [f.scrollTop, f.scrollHeight, f.clientHeight], oScroll: [o.scrollTop, o.scrollHeight, o.clientHeight], pad: [cs.paddingBottom, os.paddingBottom, cs.lineHeight, os.lineHeight] };
  })));
  await page.screenshot({ path: 'tests/.shots/v1115-blu.png' });
});
