// SONDA (temporanea, da cancellare): quanto della risposta si legge dentro un
// riquadro incorporato, al variare della sua altezza.
import { test, expect } from './fixtures/electron.mjs';

async function preparaProvider(app, attesa = 300) {
  await app.evaluate(async (_electron, ms) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const pezzi = Array.from({ length: 12 }, (_, i) =>
      `Paragrafo ${i + 1}: una spiegazione distesa della parola selezionata, con abbastanza testo da far crescere il riquadro fino al suo tetto di altezza. `);
    globalThis.__origGemPose = globalThis.SN_PROVIDER_GEMINI;
    globalThis.SN_PROVIDER_GEMINI = {
      ...globalThis.__origGemPose,
      streamComplete: async ({ onDelta }) => {
        await new Promise((r) => setTimeout(r, ms));
        for (const p of pezzi) { onDelta(p); await new Promise((r) => setTimeout(r, 10)); }
        return { text: pezzi.join(''), usage: {} };
      },
    };
  }, attesa);
}

const INTERNO = (offset) => `<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; }
  #bersaglio { position: absolute; left: 10px; top: ${offset}px; margin: 0; }
</style>
<p id="bersaglio">supercalifragilistico</p>`;

const ESTERNA = (src, h) => `<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; font: 16px/1.6 system-ui, sans-serif; }
  iframe { display: block; width: 560px; height: ${h}px; border: 0; margin: 0; }
</style>
<iframe id="riquadro" src="${src}"></iframe>`;

const misura = () => {
  const root = document.querySelector('.sn-popup');
  if (!root) return null;
  const r = root.getBoundingClientRect();
  const body = root.querySelector('.sn-popup-body');
  const b = body.getBoundingClientRect();
  const compose = root.querySelector('.sn-popup-compose');
  const c = compose.getBoundingClientRect();
  const testo = root.querySelector('.sn-msg-assistant .sn-msg-text');
  return {
    vh: window.innerHeight,
    top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height),
    bodyH: Math.round(b.height), bodyTop: Math.round(b.top),
    composeBottom: Math.round(c.bottom),
    classi: root.className,
    maxH: root.style.maxHeight,
    testoLen: testo ? testo.textContent.length : 0,
  };
};

for (const alto of [200, 220, 240, 260, 300, 340, 380, 420, 460, 520]) {
  test(`sonda riquadro ${alto}px`, async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    const off = Math.round(alto * 0.5);
    const src = testServer.html(INTERNO(off));
    const page = await testServer.openReady(openTab, ESTERNA(src, alto));
    await preparaProvider(app);
    let frame = null;
    await expect.poll(() => {
      frame = page.frames().find((f) => f.url() === src) || null;
      return !!frame;
    }, { timeout: 8000 }).toBe(true);
    await frame.locator('#bersaglio').dblclick();
    await expect.poll(() => frame.evaluate(() => String(window.getSelection())), { timeout: 5000 })
      .toContain('supercalifragilistico');
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
      globalThis.__filoShortcuts.dispatch('explain-selection', win);
    });
    await frame.waitForSelector('.sn-popup', { timeout: 10_000 });
    await expect.poll(() => frame.evaluate(() => document.querySelector('.sn-popup-meta')?.textContent || ''), { timeout: 20_000 })
      .toContain('€');
    const m = await frame.evaluate(misura);
    const ancora = await frame.evaluate(() => {
      const el = document.querySelector('#bersaglio');
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    });
    console.log(`SONDA ${alto}: ${JSON.stringify({ ...m, ancora })}`);
  });
}
