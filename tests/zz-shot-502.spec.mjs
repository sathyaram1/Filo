// SPEC TEMPORANEO DI CONTROLLO VISIVO — da cancellare dopo aver guardato i PNG.
import { test } from './fixtures/electron.mjs';

const OUT = '/tmp/claude-0/-home-user-Filo/030749b0-1208-5efc-b83f-e49c85ff903e/scratchpad';

async function preparaProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const pezzi = Array.from({ length: 12 }, (_, i) =>
      `Paragrafo ${i + 1}: una spiegazione distesa della parola selezionata, con abbastanza testo da riempire il riquadro. `);
    globalThis.SN_PROVIDER_GEMINI = {
      ...globalThis.SN_PROVIDER_GEMINI,
      streamComplete: async ({ onDelta }) => {
        await new Promise((r) => setTimeout(r, 200));
        for (const p of pezzi) { onDelta(p); await new Promise((r) => setTimeout(r, 15)); }
        return { text: pezzi.join(''), usage: {} };
      },
    };
  });
}

const INTERNO = `<!doctype html><meta charset="utf-8">
<style>body{margin:0;padding:10px;font:16px/1.5 system-ui,sans-serif;background:#fafafa}</style>
<p id="bersaglio">supercalifragilistico</p>`;

const PAGINA = (src, w, h) => `<!doctype html><meta charset="utf-8">
<style>body{margin:0;font:16px/1.6 system-ui,sans-serif;background:#e8e8e8}
h1{margin:16px 24px;font-size:18px}
iframe{display:block;width:${w}px;height:${h}px;border:2px solid #888;margin:0 24px;background:#fff}</style>
<h1>riquadro incorporato ${w}x${h}</h1><iframe id="riquadro" src="${src}"></iframe>`;

for (const [w, h, nome] of [[320, 400, 'stretto'], [560, 180, 'basso'], [300, 200, 'stretto-e-basso']]) {
  test(`SHOT ${nome}`, async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    const src = testServer.html(INTERNO);
    const page = await testServer.openReady(openTab, PAGINA(src, w, h));
    await preparaProvider(app);

    let frame = null;
    for (let i = 0; i < 80 && !frame; i++) {
      frame = page.frames().find((fr) => fr.url() === src) || null;
      if (!frame) await new Promise((r) => setTimeout(r, 100));
    }
    await frame.locator('#bersaglio').dblclick();
    await new Promise((r) => setTimeout(r, 400));
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      globalThis.__filoShortcuts.dispatch('explain-selection', win);
    });
    await frame.waitForSelector('.sn-popup', { timeout: 10_000 });
    for (let i = 0; i < 100; i++) {
      const t = await frame.evaluate(() => document.querySelector('.sn-popup-meta')?.textContent || '');
      if (t.includes('€')) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: `${OUT}/shot-502-${nome}.png` });
  });
}
