// PROBE: altezza massima realmente raggiungibile vs tetto usato per scegliere il lato.
import { test, expect } from './fixtures/electron.mjs';

test('probe: tetto reale e scelta del lato', async ({ app, openTab }) => {
  test.setTimeout(300_000);
  const page = await openTab('filo://newtab/');
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const pezzi = Array.from({ length: 40 }, (_, i) => `Paragrafo ${i + 1}: spiegazione molto distesa della parola selezionata con parecchio testo. `);
    if (!globalThis.__o) globalThis.__o = globalThis.SN_PROVIDER_GEMINI;
    globalThis.SN_PROVIDER_GEMINI = {
      ...globalThis.__o,
      streamComplete: async ({ onDelta }) => { for (const p of pezzi) onDelta(p); return { text: pezzi.join(''), usage: {} }; },
    };
  });

  const w = await page.evaluate(() => window.innerWidth);
  const out = [];
  // Finestra altissima: quanto diventa alto il riquadro senza nessun vincolo?
  await page.setViewportSize({ width: w, height: 1400 });
  await expect.poll(() => page.evaluate(() => window.innerHeight), { timeout: 5000 }).toBe(1400);
  for (const y of [100, 460, 480, 500, 520, 560, 900]) {
    await page.evaluate(() => { document.querySelectorAll('.sn-popup .sn-popup-close').forEach((b) => b.click()); });
    await page.evaluate((yy) => {
      window.SN_POPUP.openStreaming({
        action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
        payload: { selection: 'parola', sentence: 'frase con parola' },
        anchor: { x: 120, y: yy }, title: 'Approfondisci',
      });
    }, y);
    await page.waitForSelector('.sn-popup', { timeout: 8000 });
    await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 15_000 });
    await page.waitForTimeout(200);
    const m = await page.evaluate(() => {
      const root = document.querySelector('.sn-popup');
      const r = root.getBoundingClientRect();
      return {
        h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom),
        lato: (root.style.bottom && root.style.bottom !== 'auto') ? 'SOPRA' : 'sotto/dentro',
        maxH: root.style.maxHeight,
      };
    });
    out.push(`ancora y=${y} vh=1400 → lato=${m.lato} h=${m.h} top=${m.top} bottom=${m.bottom} maxH=${m.maxH} (spazioSotto=${1400 - y - 16})`);
  }
  console.log('\n' + out.join('\n'));
});
