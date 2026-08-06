// TEMP verifier stress test for #408 — total failure + rapid reclick.
import { test, expect } from './fixtures/electron.mjs';

const LONG = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">A very long English article about nothing in particular</h1>
  ${Array.from({ length: 40 }, (_, i) => `<p id="p${i}">Paragraph number ${i} of the body text, deliberately long enough to take a meaningful share of the request budget so that the article needs several separate requests to be translated in full.</p>`).join('\n  ')}
</body></html>`;

async function stubFail(app, failAfter, errMsg) {
  await app.evaluate(async (_e, args) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__filoTranslateCalls = 0;
    globalThis.__filoFailAfter = args.failAfter;
    globalThis.__errMsg = args.errMsg;
    const orig = P.completeWithFallback;
    P.completeWithFallback = async (a) => {
      const last = [...a.messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return orig(a);
      globalThis.__filoTranslateCalls++;
      const cap = globalThis.__filoFailAfter;
      if (cap >= 0 && globalThis.__filoTranslateCalls > cap) throw new Error(globalThis.__errMsg);
      const i = prompt.indexOf('Testo:\n\n');
      const chunk = i >= 0 ? prompt.slice(i + 'Testo:\n\n'.length) : '';
      const SEP = '\n@@@SN_SEP@@@\n';
      return { text: chunk.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`).join(SEP), provider: 'test', model: 't', usage: {} };
    };
  }, { failAfter, errMsg });
}

async function watchToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes)
        if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) window.__toasts.push(n.textContent || '');
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
}
const toasts = (page) => page.evaluate(() => window.__toasts || []);
const tcount = (page) => page.evaluate(() => document.querySelectorAll('[data-sn-translated="1"]').length);

async function clickTranslate(page, anchor) {
  await page.locator(anchor).first().click({ button: 'right', position: { x: 5, y: 5 } });
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  await btn.click();
}

test('totale fallimento (credito finito, primo chunk): niente falsa ripresa, icona resta Traduci', async ({ app, openTab, testServer }) => {
  await stubFail(app, 0, 'You have exhausted your credits'); // fallisce TUTTO
  const page = await testServer.openReady(openTab, LONG);
  await watchToasts(page);
  await clickTranslate(page, '#p0');

  await expect.poll(async () => (await toasts(page)).some((t) => t.startsWith('Non sono riuscito a tradurre la pagina')), { timeout: 30000 }).toBe(true);
  // Niente blocchi tradotti.
  expect(await tcount(page)).toBe(0);
  const all = await toasts(page);
  expect(all).not.toContain('Pagina tradotta');
  expect(all.join(' | ')).not.toContain('exhausted');
  // L'icona NON deve proporre ripresa: non c'è nulla da riprendere.
  await page.locator('#p0').click({ button: 'right', position: { x: 5, y: 5 } });
  const icon = page.locator('[data-sn-icon-id="translate"]');
  await expect(icon).toBeVisible();
  await expect(icon).toHaveAttribute('aria-label', 'Traduci');
});

test('reclick rapido durante la traduzione: nessun doppio avvio', async ({ app, openTab, testServer }) => {
  await stubFail(app, 1, 'fetch failed');
  const page = await testServer.openReady(openTab, LONG);
  await watchToasts(page);
  // due click ravvicinati sull'icona
  await page.locator('#p0').first().click({ button: 'right', position: { x: 5, y: 5 } });
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  await btn.click();
  // riclicca subito (menu potrebbe chiudersi: riapri e clicca)
  await page.locator('#p0').first().click({ button: 'right', position: { x: 5, y: 5 } });
  const btn2 = page.locator('[data-sn-icon-id="translate"]');
  if (await btn2.isVisible().catch(() => false)) await btn2.click().catch(() => {});

  await expect.poll(async () => (await toasts(page)).some((t) => t.startsWith('Traduzione interrotta')), { timeout: 30000 }).toBe(true);
  const stopped = (await toasts(page)).filter((t) => t.startsWith('Traduzione interrotta'));
  // Un solo esito di interruzione, non due sovrapposti.
  expect(stopped.length).toBeLessThanOrEqual(1);
});
