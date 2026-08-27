// PROBE (diagnostico, non consegnabile): la domanda lunga in una finestra bassa.
import { test, expect } from './fixtures/electron.mjs';

async function preparaProvider(app, attesaMs = 300) {
  await app.evaluate(async (_electron, attesa) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const pezzi = Array.from({ length: 12 }, (_, i) => `Paragrafo ${i + 1}: spiegazione distesa della parola. `);
    if (!globalThis.__o) globalThis.__o = globalThis.SN_PROVIDER_GEMINI;
    globalThis.SN_PROVIDER_GEMINI = {
      ...globalThis.__o,
      streamComplete: async ({ onDelta }) => {
        await new Promise((r) => setTimeout(r, attesa));
        for (const p of pezzi) { onDelta(p); await new Promise((r) => setTimeout(r, 15)); }
        return { text: pezzi.join(''), usage: {} };
      },
    };
  }, attesaMs);
}

const misura = () => {
  const root = document.querySelector('.sn-popup');
  if (!root) return null;
  const r = root.getBoundingClientRect();
  const c = root.querySelector('.sn-popup-compose').getBoundingClientRect();
  const i = root.querySelector('.sn-popup-input').getBoundingClientRect();
  const b = root.querySelector('.sn-popup-body').getBoundingClientRect();
  const el = document.elementFromPoint(i.left + i.width / 2, i.top + i.height / 2);
  return {
    vh: window.innerHeight,
    top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height),
    composeBottom: Math.round(c.bottom), inputBottom: Math.round(i.bottom),
    bodyH: Math.round(b.height),
    maxH: root.style.maxHeight,
    classi: root.className,
    cliccabile: !!el && (el === root.querySelector('.sn-popup-input') || root.querySelector('.sn-popup-input').contains(el)),
  };
};

for (const vh of [300, 380, 480, 620]) {
  test(`probe: finestra ${vh}px + domanda lunga`, async ({ app, openTab }) => {
    test.setTimeout(90_000);
    const page = await openTab('filo://newtab/');
    await preparaProvider(app);
    const w = await page.evaluate(() => window.innerWidth);
    await page.setViewportSize({ width: w, height: vh });
    await expect.poll(() => page.evaluate(() => window.innerHeight), { timeout: 5000 }).toBeLessThanOrEqual(vh);

    await page.evaluate(() => {
      window.SN_POPUP.openStreaming({
        action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
        payload: { selection: 'parola', sentence: 'frase con parola' },
        anchor: { x: 120, y: Math.round(window.innerHeight * 0.5) },
        title: 'Approfondisci',
      });
    });
    await page.waitForSelector('.sn-popup', { timeout: 8000 });
    await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });
    await page.waitForTimeout(400);
    const prima = await page.evaluate(misura);

    const input = page.locator('.sn-popup .sn-popup-input');
    await input.click();
    await input.fill('perché questa cosa funziona così e non in un altro modo? '.repeat(12));
    await page.waitForTimeout(500);
    const conDomanda = await page.evaluate(misura);

    await input.fill('');
    await page.waitForTimeout(500);
    const dopo = await page.evaluate(misura);

    console.log(`\n=== vh=${vh} ===`);
    console.log('PRIMA     ', JSON.stringify(prima));
    console.log('CON DOMANDA', JSON.stringify(conDomanda));
    console.log('DOPO      ', JSON.stringify(dopo));
  });
}
