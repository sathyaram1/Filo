// PROBE temporanea — misura, non asserisce. Da cancellare.
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
    const pezzi = Array.from({ length: 12 }, (_, i) => `Paragrafo ${i + 1}: testo lungo. `);
    globalThis.SN_PROVIDER_GEMINI = {
      ...globalThis.SN_PROVIDER_GEMINI,
      streamComplete: async ({ onDelta }) => {
        await new Promise((r) => setTimeout(r, attesa));
        for (const p of pezzi) { onDelta(p); await new Promise((r) => setTimeout(r, 10)); }
        return { text: pezzi.join(''), usage: {} };
      },
    };
  }, attesaMs);
}

const dettaglio = () => {
  const root = document.querySelector('.sn-popup');
  if (!root) return null;
  const q = (s) => root.querySelector(s);
  const rc = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height }; };
  const cs = (el) => { const c = getComputedStyle(el); return { box: c.boxSizing, pt: c.paddingTop, pb: c.paddingBottom, minH: c.minHeight, maxH: c.maxHeight, bt: c.borderTopWidth, bb: c.borderBottomWidth }; };
  return {
    vh: window.innerHeight, vw: window.innerWidth,
    classi: root.className,
    inlineMaxH: root.style.maxHeight,
    root: rc(root), rootCs: cs(root),
    header: rc(q('.sn-popup-header')),
    body: rc(q('.sn-popup-body')), bodyCs: cs(q('.sn-popup-body')),
    footer: rc(q('.sn-popup-footer')),
    compose: rc(q('.sn-popup-compose')), composeCs: cs(q('.sn-popup-compose')),
    input: rc(q('.sn-popup-input')),
    send: rc(q('.sn-popup-send')),
    transform: getComputedStyle(root).transform,
  };
};

const RIQUADRO_INTERNO = `<!doctype html><meta charset="utf-8">
<style>body { margin: 0; padding: 6px; font: 14px/1.4 system-ui, sans-serif; }</style>
<p id="bersaglio" style="margin:2px">supercalifragilistico</p>`;

const PAGINA_CON_RIQUADRO = (src, h, w = 560) => `<!doctype html><meta charset="utf-8">
<style>body { margin: 0; } iframe { display: block; width: ${w}px; height: ${h}px; border: 0; }</style>
<iframe id="riquadro" src="${src}"></iframe>`;

async function frameDelRiquadro(page, src) {
  let f = null;
  await expect.poll(() => { f = page.frames().find((fr) => fr.url() === src) || null; return !!f; }, { timeout: 8000 }).toBe(true);
  return f;
}

for (const alto of [130, 160, 200]) {
  test(`PROBE iframe ${alto}px`, async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    const src = testServer.html(RIQUADRO_INTERNO);
    const page = await testServer.openReady(openTab, PAGINA_CON_RIQUADRO(src, alto));
    await preparaProvider(app);
    const frame = await frameDelRiquadro(page, src);
    await frame.locator('#bersaglio').dblclick();
    await expect.poll(() => frame.evaluate(() => String(window.getSelection())), { timeout: 5000 }).toContain('super');
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
      globalThis.__filoShortcuts.dispatch('explain-selection', win);
    });
    await frame.waitForSelector('.sn-popup', { timeout: 10_000 });
    await expect.poll(() => frame.evaluate(() => document.querySelector('.sn-popup-meta')?.textContent || ''), { timeout: 20_000 }).toContain('€');
    const d = await frame.evaluate(dettaglio);
    console.log(`\n=== IFRAME ${alto} ===\n` + JSON.stringify(d, null, 1));
    // dove sta la selezione
    const selr = await frame.evaluate(() => {
      const s = window.getSelection();
      if (!s || !s.rangeCount) return null;
      const r = s.getRangeAt(0).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, h: r.height };
    });
    console.log('selezione:', JSON.stringify(selr));
  });
}

const PAGINA = `<!doctype html><meta charset="utf-8">
<style>body { margin: 0; font: 16px/1.6 system-ui, sans-serif; } #b { position: fixed; left: 40px; top: 70vh; font-size: 20px; }</style>
<p id="b">supercalifragilistico</p>`;

test('PROBE copertura parola', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await preparaProvider(app);
  await page.locator('#b').dblclick();
  await expect.poll(() => page.evaluate(() => String(window.getSelection())), { timeout: 5000 }).toContain('super');
  const selr = await page.evaluate(() => {
    const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, h: r.height };
  });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  await page.waitForSelector('.sn-popup', { timeout: 10_000 });
  await expect.poll(() => page.evaluate(() => document.querySelector('.sn-popup-meta')?.textContent || ''), { timeout: 20_000 }).toContain('€');
  const d = await page.evaluate(dettaglio);
  console.log('selezione:', JSON.stringify(selr));
  console.log('popup:', JSON.stringify(d.root), 'vh', d.vh);
  console.log('copertura:', d.root.bottom > selr.top && d.root.top < selr.bottom
    ? `COPRE ${Math.min(d.root.bottom, selr.bottom) - Math.max(d.root.top, selr.top)}px su ${selr.h}`
    : 'non copre');
});

for (const zoom of [0, 4.7] ) {
  test(`PROBE zoom ${zoom}`, async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    const page = await testServer.openReady(openTab, PAGINA);
    await preparaProvider(app);
    if (zoom) {
      await app.evaluate(({ BrowserWindow }, z) => {
        const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
        const views = win.contentView.children.filter((v) => v.webContents && v.webContents.getURL().startsWith('http'));
        views.forEach((v) => v.webContents.setZoomLevel(z));
      }, zoom);
      await page.waitForTimeout(500);
    }
    await page.locator('#b').dblclick();
    await expect.poll(() => page.evaluate(() => String(window.getSelection())), { timeout: 5000 }).toContain('super');
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
      globalThis.__filoShortcuts.dispatch('explain-selection', win);
    });
    await page.waitForSelector('.sn-popup', { timeout: 10_000 });
    await expect.poll(() => page.evaluate(() => document.querySelector('.sn-popup-meta')?.textContent || ''), { timeout: 20_000 }).toContain('€');
    const d = await page.evaluate(dettaglio);
    console.log(`\n=== ZOOM ${zoom} ===\n` + JSON.stringify(d, null, 1));
    const selr = await page.evaluate(() => {
      const s = window.getSelection();
      if (!s || !s.rangeCount) return null;
      const r = s.getRangeAt(0).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, h: r.height };
    });
    console.log('selezione:', JSON.stringify(selr));
  });
}
