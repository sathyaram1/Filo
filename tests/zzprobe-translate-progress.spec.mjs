// PROBE (audit prober, temporaneo) — attesa senza segnale sulla traduzione
// di una pagina lunga.
//
// translatePage() spezza la pagina in chunk da ~3000 caratteri e li manda al
// modello UNO ALLA VOLTA (await in serie). L'unico segnale è un toast di 1.8s
// all'inizio. Su un articolo lungo l'utente resta N secondi davanti alla pagina
// invariata, senza rotella, barra né conteggio.
//
// Assert di SUCCESSO atteso: mentre la traduzione è in corso (dopo che il toast
// iniziale è scaduto) deve esserci QUALCHE indicatore visibile.

import { test, expect } from './fixtures/electron.mjs';

test.setTimeout(90_000);

const PARAS = Array.from({ length: 60 }, (_, i) =>
  `<p>Paragraph number ${i + 1}. ${'The quick brown fox jumps over the lazy dog and keeps running through the long green field. '.repeat(3)}</p>`,
).join('\n');

const LONG = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:30px">
<main>${PARAS}</main></body></html>`;

test('pagina lunga: durante la traduzione non c\'è nessun indicatore di avanzamento', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
  });
  // Ogni chunk impiega 1.2s (latenza realistica di un modello su 3000 caratteri).
  await app.evaluate(() => {
    globalThis.__chunks = 0;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ messages }) => {
      const content = messages[messages.length - 1].content;
      const idx = content.lastIndexOf('Testo:\n\n');
      if (idx < 0) return { text: '', provider: 'test', model: 'm', usage: {} };
      globalThis.__chunks++;
      const chunk = content.slice(idx + 8);
      await new Promise((r) => setTimeout(r, 1200));
      const out = chunk.split(/\n?@@@SN_SEP@@@\n?/)
        .map((s) => `TRADOTTO ${s}`).join('\n@@@SN_SEP@@@\n');
      return { text: out, provider: 'test', model: 'm', usage: {} };
    };
  });

  const page = await testServer.openReady(openTab, LONG);
  await page.locator('p').first().click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  await menu.locator('.sn-menu-row-btn[data-sn-icon-id="translate"]').click();

  // Campiona ogni 500ms: cosa è visibile sullo schermo mentre traduce?
  const samples = [];
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => ({
      t: Math.round(performance.now()),
      toast: Array.from(document.querySelectorAll('.sn-toast'))
        .filter((n) => n.classList.contains('sn-toast-visible'))
        .map((n) => n.textContent),
      translated: document.querySelectorAll('[data-sn-translated="1"]').length,
      total: document.querySelectorAll('p').length,
    }));
    samples.push(s);
    if (s.translated >= s.total) break;
  }
  const chunks = await app.evaluate(() => globalThis.__chunks);
  console.log('[probe progress] chunk totali:', chunks);
  console.log('[probe progress]', JSON.stringify(samples));

  // Campioni "a metà lavoro": traduzione partita ma non finita.
  const midway = samples.filter((s) => s.translated < s.total);
  const blind = midway.filter((s) => s.toast.length === 0);
  console.log('[probe progress] campioni a metà:', midway.length, 'di cui senza NESSUN segnale:', blind.length);

  expect(blind.length, 'secondi di attesa senza alcun segnale visibile').toBe(0);
});
