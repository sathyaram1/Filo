// PROBE (diagnostico): geometria esatta della segnalazione — finestra 800px,
// parola a tre quarti dell'altezza, poi una domanda successiva di due-tre righe.
import { test, expect } from './fixtures/electron.mjs';

async function preparaProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const pezzi = Array.from({ length: 12 }, (_, i) => `Paragrafo ${i + 1}: spiegazione distesa della parola selezionata. `);
    if (!globalThis.__o) globalThis.__o = globalThis.SN_PROVIDER_GEMINI;
    globalThis.SN_PROVIDER_GEMINI = {
      ...globalThis.__o,
      streamComplete: async ({ onDelta }) => {
        await new Promise((r) => setTimeout(r, 300));
        for (const p of pezzi) { onDelta(p); await new Promise((r) => setTimeout(r, 15)); }
        return { text: pezzi.join(''), usage: {} };
      },
    };
  });
}

const misura = () => {
  const root = document.querySelector('.sn-popup');
  if (!root) return null;
  const inp = root.querySelector('.sn-popup-input');
  const snd = root.querySelector('.sn-popup-send');
  const r = root.getBoundingClientRect();
  const c = root.querySelector('.sn-popup-compose').getBoundingClientRect();
  const i = inp.getBoundingClientRect();
  const s = snd.getBoundingClientRect();
  const b = root.querySelector('.sn-popup-body').getBoundingClientRect();
  const puntoCentro = document.elementFromPoint(i.left + i.width / 2, i.top + i.height / 2);
  const puntoBasso = document.elementFromPoint(i.left + i.width / 2, i.bottom - 4);
  const puntoInvio = document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2);
  return {
    vh: window.innerHeight,
    top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height),
    maxH: root.style.maxHeight, classi: root.className,
    bodyH: Math.round(b.height),
    composeBottom: Math.round(c.bottom),
    inputTop: Math.round(i.top), inputBottom: Math.round(i.bottom),
    sendTop: Math.round(s.top), sendBottom: Math.round(s.bottom),
    centroDentro: !!puntoCentro && inp.contains(puntoCentro) || puntoCentro === inp,
    bassoDentro: !!puntoBasso && (inp.contains(puntoBasso) || puntoBasso === inp),
    invioCliccabile: !!puntoInvio && (snd.contains(puntoInvio) || puntoInvio === snd),
    oltreIlRiquadro: Math.round(c.bottom - r.bottom),
    oltreLoSchermo: Math.round(c.bottom - window.innerHeight),
  };
};

for (const [vh, frazione, righe] of [[800, 0.75, 3], [800, 0.75, 12], [900, 0.75, 12], [1000, 0.8, 12]]) {
  test(`probe: vh=${vh} frazione=${frazione} domanda da ${righe} pezzi`, async ({ app, openTab }) => {
    test.setTimeout(90_000);
    const page = await openTab('filo://newtab/');
    await preparaProvider(app);
    const w = await page.evaluate(() => window.innerWidth);
    await page.setViewportSize({ width: w, height: vh });
    await expect.poll(() => page.evaluate(() => window.innerHeight), { timeout: 5000 }).toBe(vh);

    await page.evaluate((f) => {
      window.SN_POPUP.openStreaming({
        action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
        payload: { selection: 'parola', sentence: 'frase con parola' },
        anchor: { x: 120, y: Math.round(window.innerHeight * f) },
        title: 'Approfondisci',
      });
    }, frazione);
    await page.waitForSelector('.sn-popup', { timeout: 8000 });
    await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });
    await page.waitForTimeout(400);
    const prima = await page.evaluate(misura);

    const input = page.locator('.sn-popup .sn-popup-input');
    await input.click();
    await input.fill('perché questa cosa funziona così e non in un altro modo? '.repeat(righe));
    await page.waitForTimeout(600);
    const conDomanda = await page.evaluate(misura);
    try { await page.screenshot({ path: `tests/.shots/zz502-probe-${vh}-${righe}.png` }); } catch (_) {}

    console.log(`\n=== vh=${vh} f=${frazione} righe=${righe} ===`);
    console.log('PRIMA      ', JSON.stringify(prima));
    console.log('CON DOMANDA', JSON.stringify(conDomanda));
  });
}
