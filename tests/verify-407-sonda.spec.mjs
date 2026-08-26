// Sonda del verificatore #407 — falso allarme "tradotta solo in parte".
import { test, expect } from './fixtures/electron.mjs';

async function stubProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const P = globalThis.SN_PROVIDERS;
    const orig = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return orig(args);
      const i = prompt.indexOf('Testo:\n\n');
      const chunk = i >= 0 ? prompt.slice(i + 'Testo:\n\n'.length) : '';
      const parts = chunk.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`);
      return { text: parts.join('\n@@@SN_SEP@@@\n'), provider: 'test', model: 't', usage: {} };
    };
  });
}
async function watchToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) window.__toasts.push(n.textContent || '');
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
}
const toasts = (page) => page.evaluate(() => window.__toasts || []);
async function clickTranslate(page, anchor) {
  await page.locator(anchor).first().click({ button: 'right', position: { x: 5, y: 5 } });
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  await btn.click();
}

// Un'icona disegnata dal sito come componente registrato e vuoto, MOLTO PIÙ IN
// BASSO del bordo dello schermo. Sullo schermo non c'è niente di non tradotto.
const FUORI_SCHERMO = `<!doctype html><html lang="en"><head><style>x-icon{display:block;width:120px;height:40px;background:#ccc}</style></head>
<body style="font:16px sans-serif">
  <p id="p1">A first English paragraph at the top of the page, plainly visible.</p>
  <div style="height:4000px"></div>
  <x-icon></x-icon>
  <p id="p2">A second English paragraph at the very bottom of the page.</p>
  <script>customElements.define('x-icon', class extends HTMLElement {});<\/script>
</body></html>`;

test('componente vuoto FUORI SCHERMO: non deve far dire "tradotta solo in parte"', async ({ app, openTab, testServer }) => {
  await stubProvider(app);
  const page = await testServer.openReady(openTab, FUORI_SCHERMO);
  await watchToasts(page);
  await clickTranslate(page, '#p1');
  await expect(page.locator('#p1')).toHaveText(/^IT /);
  await expect.poll(async () => (await toasts(page)).length > 0, { timeout: 20000 }).toBe(true);
  const t = (await toasts(page)).join(' | ');
  expect(t, `avvisi: ${t}`).toContain('Pagina tradotta');
  expect(t).not.toContain('solo in parte');
});

// Stessa icona, ma DENTRO lo schermo e trasparente ai clic (pointer-events:none
// è come i siti disegnano quasi tutte le icone decorative).
const NON_CLICCABILE = `<!doctype html><html lang="en"><head><style>x-icon2{display:block;width:120px;height:40px;background:#ccc;pointer-events:none}</style></head>
<body style="font:16px sans-serif">
  <p id="p1">A first English paragraph at the top of the page, plainly visible.</p>
  <x-icon2></x-icon2>
  <p id="p2">A second English paragraph right after the decorative icon.</p>
  <script>customElements.define('x-icon2', class extends HTMLElement {});<\/script>
</body></html>`;

test('componente vuoto trasparente ai clic: non deve far dire "tradotta solo in parte"', async ({ app, openTab, testServer }) => {
  await stubProvider(app);
  const page = await testServer.openReady(openTab, NON_CLICCABILE);
  await watchToasts(page);
  await clickTranslate(page, '#p1');
  await expect(page.locator('#p1')).toHaveText(/^IT /);
  await expect.poll(async () => (await toasts(page)).length > 0, { timeout: 20000 }).toBe(true);
  const t = (await toasts(page)).join(' | ');
  expect(t, `avvisi: ${t}`).toContain('Pagina tradotta');
  expect(t).not.toContain('solo in parte');
});
