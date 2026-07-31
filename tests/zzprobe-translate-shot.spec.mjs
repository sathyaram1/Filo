// PROBE (audit prober, temporaneo) — prova visiva della traduzione parziale.
//
// Pagina "articolo" realistica: titolo nell'<header>, sommario in <div>,
// corpo in <p>, didascalia in <div>, box laterale in <aside>.
// Dopo "Traduci la pagina" solo i <p> cambiano lingua: il resto resta in
// inglese, ma il toast dichiara "Pagina tradotta".

import { test, expect } from './fixtures/electron.mjs';

test.setTimeout(60_000);

const IT = {
  'Climate report: the oceans are warming faster than expected':
    'Rapporto sul clima: gli oceani si scaldano più in fretta del previsto',
  'A new study rewrites what we knew about heat absorption in deep water.':
    'Un nuovo studio riscrive quello che sapevamo sull\'assorbimento di calore in acque profonde.',
  'Researchers measured the temperature of the deep ocean for twelve consecutive years and found a rise that no existing model had predicted.':
    'I ricercatori hanno misurato la temperatura dell\'oceano profondo per dodici anni consecutivi e hanno trovato un aumento che nessun modello esistente aveva previsto.',
  'The consequences reach far beyond the coastline, and they arrive sooner than the last generation of forecasts suggested.':
    'Le conseguenze vanno ben oltre la linea di costa, e arrivano prima di quanto suggerissero le previsioni della scorsa generazione.',
  'Photo: a research vessel in the northern Atlantic, early morning.':
    'Foto: una nave da ricerca nell\'Atlantico del nord, di primo mattino.',
  'Read also: how the currents are changing shape':
    'Leggi anche: come stanno cambiando forma le correnti',
};

const ARTICLE = `<!doctype html><html lang="en"><body style="margin:0;font:16px/1.55 Georgia,serif;background:#fff;color:#222">
<header style="padding:28px 40px 8px">
  <h1 style="font-size:30px;margin:0 0 6px">Climate report: the oceans are warming faster than expected</h1>
</header>
<main style="padding:0 40px 40px;max-width:760px">
  <div class="standfirst" style="font-size:19px;color:#555;margin:0 0 22px">A new study rewrites what we knew about heat absorption in deep water.</div>
  <p>Researchers measured the temperature of the deep ocean for twelve consecutive years and found a rise that no existing model had predicted.</p>
  <p>The consequences reach far beyond the coastline, and they arrive sooner than the last generation of forecasts suggested.</p>
  <div class="caption" style="font-size:14px;color:#777;border-left:3px solid #ddd;padding-left:10px;margin:18px 0">Photo: a research vessel in the northern Atlantic, early morning.</div>
  <aside style="margin-top:24px;background:#f4f1ec;padding:14px 16px;font-size:15px">Read also: how the currents are changing shape</aside>
</main>
</body></html>`;

test('articolo misto: solo i paragrafi <p> vengono tradotti, il resto resta in inglese', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
  });
  await app.evaluate((dict) => {
    const P = globalThis.SN_PROVIDERS;
    P.completeWithFallback = async ({ messages }) => {
      const content = messages[messages.length - 1].content;
      const idx = content.lastIndexOf('Testo:\n\n');
      const chunk = idx >= 0 ? content.slice(idx + 8) : content;
      const parts = chunk.split(/\n?@@@SN_SEP@@@\n?/);
      const out = parts
        .map((s) => dict[s.trim()] || s)
        .join('\n@@@SN_SEP@@@\n');
      globalThis.__parts = (globalThis.__parts || []).concat([{ in: parts, out, dictKeys: Object.keys(dict).length }]);
      return { text: out, provider: 'test', model: 'test-model', usage: {} };
    };
  }, IT);

  const page = await testServer.openReady(openTab, ARTICLE);
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList?.contains('sn-toast')) window.__toasts.push(n.textContent);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });

  await page.locator('main').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  await menu.locator('.sn-menu-row-btn[data-sn-icon-id="translate"]').click();

  await page.waitForTimeout(6000);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'tests/.shots/probe-translate-partial.png' });

  const state = await page.evaluate(() => ({
    h1: document.querySelector('h1').textContent.trim(),
    standfirst: document.querySelector('.standfirst').textContent.trim(),
    caption: document.querySelector('.caption').textContent.trim(),
    aside: document.querySelector('aside').textContent.trim(),
    p1: document.querySelectorAll('p')[0].textContent.trim(),
    toasts: window.__toasts,
  }));
  console.log('[probe partial]', JSON.stringify(state, null, 2));
  console.log('[probe parts]', JSON.stringify(await app.evaluate(() => globalThis.__parts || [])));

  // Invariante attesa: "Traduci la pagina" traduce la pagina.
  expect(state.h1, 'titolo tradotto').not.toContain('oceans are warming');
  expect(state.standfirst, 'sommario tradotto').not.toContain('rewrites what we knew');
  expect(state.caption, 'didascalia tradotta').not.toContain('research vessel');
});
