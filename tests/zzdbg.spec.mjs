import { test, expect } from '/home/user/Filo/.claude/worktrees/worker-7ad54dae/tests/fixtures/electron.mjs';

const LONG = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">A very long English article about nothing in particular</h1>
  ${Array.from({ length: 40 }, (_, i) => `<p id="p${i}">Paragraph number ${i} of the body text, deliberately long enough to take a meaningful share of the request budget so that the article needs several separate requests to be translated in full.</p>`).join('\n  ')}
</body></html>`;

test('debug', async ({ app, openTab, testServer }) => {
  await app.evaluate(async (failAfter) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__filoTranslateCalls = 0;
    globalThis.__filoFailAfter = failAfter;
    const orig = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return orig(args);
      globalThis.__filoTranslateCalls++;
      const cap = globalThis.__filoFailAfter;
      if (cap >= 0 && globalThis.__filoTranslateCalls > cap) throw new Error('fetch failed');
      const i = prompt.indexOf('Testo:\n\n');
      const chunk = i >= 0 ? prompt.slice(i + 'Testo:\n\n'.length) : '';
      const SEP = '\n@@@SN_SEP@@@\n';
      return { text: chunk.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`).join(SEP), provider: 'test', model: 't', usage: {} };
    };
  }, 1);
  const page = await testServer.openReady(openTab, LONG);
  page.on('console', (m) => console.log('[PAGE]', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('[PAGEERROR]', e.message, e.stack));
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType===1 && n.classList && n.classList.contains('sn-toast')) window.__toasts.push(n.textContent||''); })
      .observe(document.documentElement, { childList: true, subtree: true });
  });
  await page.locator('#p0').click({ button: 'right', position: { x: 5, y: 5 } });
  await page.locator('[data-sn-icon-id="translate"]').click();
  await page.waitForTimeout(40000);
  console.log('CALLS', await app.evaluate(() => globalThis.__filoTranslateCalls));
  console.log('TRANSLATED', await page.evaluate(() => document.querySelectorAll('[data-sn-translated="1"]').length));
  console.log('TOASTS', JSON.stringify(await page.evaluate(() => window.__toasts)));
  console.log('LIVE', await page.evaluate(() => Array.from(document.querySelectorAll('.sn-toast')).map(n=>n.textContent)));
});
