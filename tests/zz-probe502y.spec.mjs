// PROBE (diagnostico): cattura visiva del caso + riquadro incorporato.
import { test, expect } from './fixtures/electron.mjs';

async function provider(app) {
  await app.evaluate(async () => {
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
        await new Promise((r) => setTimeout(r, 200));
        for (const p of pezzi) { onDelta(p); await new Promise((r) => setTimeout(r, 10)); }
        return { text: pezzi.join(''), usage: {} };
      },
    };
  });
}

test('probe visivo: finestra 480px, parola a metà, domanda successiva lunga', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await openTab('filo://newtab/');
  await provider(app);
  const w = await page.evaluate(() => window.innerWidth);
  await page.setViewportSize({ width: w, height: 480 });
  await expect.poll(() => page.evaluate(() => window.innerHeight), { timeout: 5000 }).toBe(480);
  await page.evaluate(() => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'parola', sentence: 'frase con parola' },
      anchor: { x: 120, y: 240 }, title: 'Approfondisci',
    });
  });
  await page.waitForSelector('.sn-popup', { timeout: 8000 });
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/zz502-A-prima.png' });
  const input = page.locator('.sn-popup .sn-popup-input');
  await input.click();
  await input.type('perché questa cosa funziona così e non in un altro modo, e cosa cambierebbe se invece fosse fatta nell\'altro modo? mi serve capire bene il motivo', { delay: 0 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/.shots/zz502-A-dopo.png' });
  const m = await page.evaluate(() => {
    const root = document.querySelector('.sn-popup');
    const c = root.querySelector('.sn-popup-compose').getBoundingClientRect();
    const r = root.getBoundingClientRect();
    const s = root.querySelector('.sn-popup-send').getBoundingClientRect();
    const p = document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2);
    return {
      vh: window.innerHeight, bottomRiquadro: Math.round(r.bottom),
      composeBottom: Math.round(c.bottom),
      oltreSchermo: Math.round(c.bottom - window.innerHeight),
      invio: !!p && (root.querySelector('.sn-popup-send').contains(p) || p === root.querySelector('.sn-popup-send')),
    };
  });
  console.log('\nVISIVO 480:', JSON.stringify(m));
});

const INTERNO = `<!doctype html><meta charset="utf-8">
<style>body{margin:0;padding:10px;font:16px/1.5 system-ui,sans-serif}</style>
<p id="bersaglio">supercalifragilistico</p>`;
const CONTENITORE = (src, h) => `<!doctype html><meta charset="utf-8">
<style>body{margin:0;font:16px/1.6 system-ui,sans-serif}h1{margin:24px;font-size:20px}
iframe{display:block;width:560px;height:${h}px;border:1px solid #ccc;margin:0 24px}</style>
<h1>Pagina con un riquadro incorporato</h1><iframe id="riquadro" src="${src}"></iframe>`;

test('probe: riquadro incorporato 420px + domanda successiva lunga', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const src = testServer.html(INTERNO);
  const page = await testServer.openReady(openTab, CONTENITORE(src, 420));
  await provider(app);
  let frame = null;
  await expect.poll(() => { frame = page.frames().find((f) => f.url() === src) || null; return !!frame; }, { timeout: 8000 }).toBe(true);
  await frame.evaluate(() => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'supercalifragilistico', sentence: 'frase' },
      anchor: { x: 40, y: Math.round(window.innerHeight * 0.5) }, title: 'Approfondisci',
    });
  });
  await frame.waitForSelector('.sn-popup', { timeout: 8000 });
  await expect.poll(() => frame.evaluate(() => document.querySelector('.sn-popup .sn-popup-meta')?.textContent || ''), { timeout: 20_000 }).toContain('€');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/zz502-B-prima.png' });
  await frame.evaluate(() => {
    const i = document.querySelector('.sn-popup .sn-popup-input');
    i.focus();
    i.value = 'perché questa cosa funziona così e non in un altro modo, e cosa cambierebbe se invece fosse fatta nell\'altro modo? mi serve capire bene il motivo';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/.shots/zz502-B-dopo.png' });
  const m = await frame.evaluate(() => {
    const root = document.querySelector('.sn-popup');
    const c = root.querySelector('.sn-popup-compose').getBoundingClientRect();
    const r = root.getBoundingClientRect();
    const s = root.querySelector('.sn-popup-send').getBoundingClientRect();
    const p = document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2);
    return {
      vh: window.innerHeight, bottomRiquadro: Math.round(r.bottom),
      composeBottom: Math.round(c.bottom),
      oltreSchermo: Math.round(c.bottom - window.innerHeight),
      oltreRiquadro: Math.round(c.bottom - r.bottom),
      invio: !!p && (root.querySelector('.sn-popup-send').contains(p) || p === root.querySelector('.sn-popup-send')),
    };
  });
  console.log('\nIFRAME 420:', JSON.stringify(m));
});
