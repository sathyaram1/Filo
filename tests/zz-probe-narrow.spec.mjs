// SONDA TEMPORANEA — da cancellare. Verifica se in un riquadro incorporato
// STRETTO il popup (largo 380px fissi) esce dal bordo destro.
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
    const pezzi = Array.from({ length: 12 }, (_, i) => `Paragrafo ${i + 1}: spiegazione distesa. `);
    globalThis.SN_PROVIDER_GEMINI = {
      ...globalThis.SN_PROVIDER_GEMINI,
      streamComplete: async ({ onDelta }) => {
        await new Promise((r) => setTimeout(r, attesa));
        for (const p of pezzi) { onDelta(p); await new Promise((r) => setTimeout(r, 20)); }
        return { text: pezzi.join(''), usage: {} };
      },
    };
  }, attesaMs);
}

const INTERNO = `<!doctype html><meta charset="utf-8">
<style>body { margin: 0; padding: 10px; font: 16px/1.5 system-ui, sans-serif; }</style>
<p id="bersaglio">supercalifragilistico</p>`;

const PAGINA = (src, w, h) => `<!doctype html><meta charset="utf-8">
<style>body{margin:0;font:16px/1.6 system-ui,sans-serif}
iframe{display:block;width:${w}px;height:${h}px;border:1px solid #ccc;margin:24px}</style>
<h1>sonda</h1><iframe id="riquadro" src="${src}"></iframe>`;

for (const [w, h] of [[320, 400], [280, 200]]) {
  test(`SONDA riquadro ${w}x${h}`, async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    const src = testServer.html(INTERNO);
    const page = await testServer.openReady(openTab, PAGINA(src, w, h));
    await preparaProvider(app);

    let frame = null;
    await expect.poll(() => {
      frame = page.frames().find((fr) => fr.url() === src) || null;
      return !!frame;
    }, { timeout: 8000 }).toBe(true);

    await frame.locator('#bersaglio').dblclick();
    await expect.poll(() => frame.evaluate(() => String(window.getSelection())), { timeout: 5000 })
      .toContain('supercalifragilistico');

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      globalThis.__filoShortcuts.dispatch('explain-selection', win);
    });
    await frame.waitForSelector('.sn-popup', { timeout: 10_000 });
    await expect.poll(() => frame.evaluate(() => document.querySelector('.sn-popup-meta')?.textContent || ''), { timeout: 20_000 }).toContain('€');

    const m = await frame.evaluate(() => {
      const root = document.querySelector('.sn-popup');
      const send = root.querySelector('.sn-popup-send');
      const input = root.querySelector('.sn-popup-input');
      const r = root.getBoundingClientRect();
      const s = send.getBoundingClientRect();
      const i = input.getBoundingClientRect();
      const el = document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2);
      return {
        vw: window.innerWidth, vh: window.innerHeight,
        popup: [r.left, r.top, r.right, r.bottom].map(Math.round),
        send: [s.left, s.top, s.right, s.bottom].map(Math.round),
        input: [i.left, i.top, i.right, i.bottom].map(Math.round),
        sendCliccabile: !!el && (el === send || send.contains(el)),
      };
    });
    console.log(`SONDA ${w}x${h}:`, JSON.stringify(m));
  });
}
