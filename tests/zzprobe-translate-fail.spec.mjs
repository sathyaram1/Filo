// PROBE (audit prober, temporaneo) — traduzione di pagina che fallisce a metà.
//
// I chunk vengono tradotti in serie; se uno fallisce si esce dal ciclo, ma
// `translatedAny` è già true → subito dopo l'errore viene mostrato anche il
// toast "Pagina tradotta". L'utente riceve due messaggi opposti e metà pagina
// resta in inglese; inoltre l'icona del menu passa a "Mostra originale",
// quindi non c'è più modo di far ritentare la parte mancante.

import { test, expect } from './fixtures/electron.mjs';

test.setTimeout(90_000);

const PARAS = Array.from({ length: 60 }, (_, i) =>
  `<p>Paragraph number ${i + 1}. ${'The quick brown fox jumps over the lazy dog and keeps running through the long green field. '.repeat(3)}</p>`,
).join('\n');
const LONG = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:30px">
<main>${PARAS}</main></body></html>`;

test('traduzione interrotta a metà: errore + "Pagina tradotta" insieme, e niente ritentativo', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
  });
  // I primi 2 chunk vanno a buon fine, dal terzo il provider cade (come una
  // rete che salta o una quota esaurita a metà lavoro).
  await app.evaluate(() => {
    globalThis.__chunks = 0;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ messages }) => {
      const content = messages[messages.length - 1].content;
      const idx = content.lastIndexOf('Testo:\n\n');
      if (idx < 0) return { text: '', provider: 'test', model: 'm', usage: {} };
      globalThis.__chunks++;
      if (globalThis.__chunks > 2) throw new TypeError('fetch failed');
      const chunk = content.slice(idx + 8);
      const out = chunk.split(/\n?@@@SN_SEP@@@\n?/)
        .map((s) => `[tradotto] ${s}`).join('\n@@@SN_SEP@@@\n');
      return { text: out, provider: 'test', model: 'm', usage: {} };
    };
  });

  const page = await testServer.openReady(openTab, LONG);
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList?.contains('sn-toast')) window.__toasts.push(n.textContent);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });

  await page.locator('p').first().click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  await menu.locator('.sn-menu-row-btn[data-sn-icon-id="translate"]').click();

  await expect.poll(async () => (await page.evaluate(() => window.__toasts)).length,
    { timeout: 20_000 }).toBeGreaterThan(1);
  await page.waitForTimeout(1500);

  const res = await page.evaluate(() => ({
    toasts: window.__toasts,
    translated: document.querySelectorAll('[data-sn-translated="1"]').length,
    total: document.querySelectorAll('p').length,
  }));
  console.log('[probe fail]', JSON.stringify(res));

  // Riapro il menu: che azione mi offre adesso?
  await page.locator('p').last().click({ button: 'right' });
  const label = await page.locator('.sn-menu .sn-menu-row-btn[data-sn-icon-id="translate"]')
    .first().getAttribute('title')
    .catch(() => null);
  const aria = await page.evaluate(() => {
    const b = document.querySelector('.sn-menu .sn-menu-row-btn[data-sn-icon-id="translate"]');
    return b ? (b.getAttribute('aria-label') || b.getAttribute('data-sn-tip') || b.textContent || b.outerHTML.slice(0, 200)) : null;
  });
  console.log('[probe fail] etichetta icona traduci dopo il fallimento:', JSON.stringify(label), JSON.stringify(aria));

  // Invariante attesa: se la traduzione si è interrotta, NON deve dire di aver finito.
  expect(res.toasts.includes('Pagina tradotta'),
    `toast contraddittori: ${JSON.stringify(res.toasts)} con ${res.translated}/${res.total} blocchi tradotti`).toBe(false);
});
