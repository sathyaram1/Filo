// PROBE (diagnostico): quanto è larga la fascia in cui la domanda successiva
// spinge la riga per scrivere fuori dal riquadro / fuori dallo schermo.
import { test, expect } from './fixtures/electron.mjs';

test('probe: sweep vh × posizione della parola, con una domanda successiva lunga', async ({ app, openTab }) => {
  test.setTimeout(600_000);
  const page = await openTab('filo://newtab/');
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const pezzi = Array.from({ length: 12 }, (_, i) => `Paragrafo ${i + 1}: spiegazione distesa. `);
    if (!globalThis.__o) globalThis.__o = globalThis.SN_PROVIDER_GEMINI;
    globalThis.SN_PROVIDER_GEMINI = {
      ...globalThis.__o,
      streamComplete: async ({ onDelta }) => {
        for (const p of pezzi) { onDelta(p); }
        return { text: pezzi.join(''), usage: {} };
      },
    };
  });

  const w = await page.evaluate(() => window.innerWidth);
  const righe = [];
  for (const vh of [420, 480, 540, 600, 660, 720, 800]) {
    await page.setViewportSize({ width: w, height: vh });
    await expect.poll(() => page.evaluate(() => window.innerHeight), { timeout: 5000 }).toBe(vh);
    for (const f of [0.35, 0.45, 0.5, 0.55, 0.6, 0.7, 0.8]) {
      await page.evaluate(() => { document.querySelectorAll('.sn-popup .sn-popup-close').forEach((b) => b.click()); });
      await page.evaluate((fr) => {
        window.SN_POPUP.openStreaming({
          action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
          payload: { selection: 'parola', sentence: 'frase con parola' },
          anchor: { x: 120, y: Math.round(window.innerHeight * fr) },
          title: 'Approfondisci',
        });
      }, f);
      await page.waitForSelector('.sn-popup', { timeout: 8000 });
      await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 15_000 });
      await page.waitForTimeout(150);
      const input = page.locator('.sn-popup .sn-popup-input');
      await input.fill('perché questa cosa funziona così e non in un altro modo? '.repeat(12));
      await page.waitForTimeout(250);
      const m = await page.evaluate(() => {
        const root = document.querySelector('.sn-popup');
        const inp = root.querySelector('.sn-popup-input');
        const snd = root.querySelector('.sn-popup-send');
        const r = root.getBoundingClientRect();
        const c = root.querySelector('.sn-popup-compose').getBoundingClientRect();
        const s = snd.getBoundingClientRect();
        const p = document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2);
        return {
          lato: root.style.top !== 'auto' && root.style.top ? 'sotto/dentro' : 'sopra',
          oltreRiquadro: Math.round(c.bottom - r.bottom),
          oltreSchermo: Math.round(c.bottom - window.innerHeight),
          invio: !!p && (snd.contains(p) || p === snd),
        };
      });
      righe.push(`vh=${vh} f=${f} lato=${m.lato} oltreRiquadro=${m.oltreRiquadro} oltreSchermo=${m.oltreSchermo} invioCliccabile=${m.invio}`);
    }
  }
  console.log('\n' + righe.join('\n'));
});
