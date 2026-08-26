// TEMPORANEO — sonda 2: un riquadro dentro una sezione NASCOSTA viene tradotto
// lo stesso (e quindi pagato), mentre il testo nascosto accanto a lui no?
import { test, expect } from './fixtures/electron.mjs';

test('riquadro dentro una sezione nascosta', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { gemini: 'k' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const P = globalThis.SN_PROVIDERS;
    const orig = P.completeWithFallback;
    globalThis.__sent = [];
    P.completeWithFallback = async (args) => {
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return orig(args);
      const i = prompt.indexOf('Testo:\n\n');
      const chunk = i >= 0 ? prompt.slice(i + 'Testo:\n\n'.length) : '';
      globalThis.__sent.push(chunk);
      const parts = chunk.split(/\n?@@@SN_SEP@@@\n?/);
      return { text: parts.map((p) => `IT ${p}`).join('\n@@@SN_SEP@@@\n'), provider: 't', model: 't', usage: {} };
    };
  });

  const inner = testServer.html('<!doctype html><html lang="en"><body><p id="ip">Text living inside the embedded frame, hidden from view.</p></body></html>');
  const html = `<!doctype html><html lang="en"><head><title>Tab</title></head><body style="font:16px sans-serif">
    <div id="a">A first block of English prose on the hosting page.</div>
    <div id="folded" style="visibility:hidden">
      <div id="hiddenText">This paragraph is inside the folded section and must NOT be paid for.</div>
      <iframe id="f" style="width:300px;height:200px" src="${inner}"></iframe>
    </div>
  </body></html>`;
  const page = await testServer.openReady(openTab, html);
  await page.locator('#a').first().click({ button: 'right', position: { x: 3, y: 3 } });
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.locator('#a')).toHaveText(/^IT /);
  await page.waitForTimeout(3500);

  const sent = await app.evaluate(() => globalThis.__sent || []);
  console.log('SENT:', JSON.stringify(sent));
  console.log('hiddenText paid?', sent.some((s) => s.includes('folded section')));
  console.log('frame text paid?', sent.some((s) => s.includes('embedded frame')));
});
