import { test, expect } from './fixtures/electron.mjs';

const COMPONENTS = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <div id="root">
    <div class="card">
      <div id="dtitle">Breaking news headline</div>
      <div id="dbody">Some body text living inside a generic block, the way component based sites are built.</div>
      <span id="dspan">A trailing note</span>
    </div>
  </div>
</body></html>`;

test('dbg', async ({ app, openTab, testServer }) => {
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__filoTranslateCalls = 0;
    globalThis.__filoPrompts = [];
    if (!P) { globalThis.__noProviders = true; return; }
    P.completeWithFallback = async ({ messages }) => {
      globalThis.__filoTranslateCalls++;
      const last = [...messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      globalThis.__filoPrompts.push(prompt.slice(-400));
      const i = prompt.indexOf('Testo:\n\n');
      const chunk = i >= 0 ? prompt.slice(i + 'Testo:\n\n'.length) : '';
      const SEP = '\n@@@SN_SEP@@@\n';
      const out = chunk.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`).join(SEP);
      return { text: out, provider: 'test', model: 'test-translate', usage: {} };
    };
  });
  const page = await testServer.openReady(openTab, COMPONENTS);
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) window.__toasts.push(n.textContent || '');
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
  await page.locator('#dbody').click({ button: 'right', position: { x: 5, y: 5 } });
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  await btn.click();
  await page.waitForTimeout(6000);
  console.log('TOASTS', JSON.stringify(await page.evaluate(() => window.__toasts)));
  console.log('CALLS', await app.evaluate(() => globalThis.__filoTranslateCalls));
  console.log('NOPROV', await app.evaluate(() => globalThis.__noProviders || false));
  console.log('PROMPTS', JSON.stringify(await app.evaluate(() => globalThis.__filoPrompts)));
  console.log('BODY', await page.locator('#root').textContent());
});
