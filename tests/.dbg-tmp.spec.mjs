import { test, expect } from '/home/user/Filo/tests/fixtures/electron.mjs';

async function preparaProvider(app, attesaMs = 300) {
  await app.evaluate(async (_electron, attesa) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const pezzi = Array.from({ length: 12 }, (_, i) => `Paragrafo ${i + 1}: una spiegazione distesa della parola selezionata, con abbastanza testo da far crescere il riquadro fino al suo tetto di altezza. `);
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

const dump = () => {
  const root = document.querySelector('.sn-popup');
  if (!root) return null;
  const r = root.getBoundingClientRect();
  const cs = getComputedStyle(root);
  return {
    vh: window.innerHeight, dpr: window.devicePixelRatio,
    top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height),
    styleTop: root.style.top, styleBottom: root.style.bottom, styleMaxH: root.style.maxHeight,
    transform: cs.transform, origin: cs.transformOrigin,
    events: window.__ev || [],
  };
};

test('dbg', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });
  await preparaProvider(app);
  await page.evaluate(() => {
    window.__ev = [];
    window.addEventListener('resize', () => window.__ev.push('win-resize:' + window.innerHeight));
    window.visualViewport?.addEventListener('resize', () => window.__ev.push('vv-resize'));
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'parola', sentence: 'una frase' },
      anchor: { x: 120, y: Math.round(window.innerHeight * 0.75) },
      title: 'Approfondisci',
    });
  });
  await page.waitForSelector('.sn-popup', { timeout: 8000 });
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });
  console.log('PRIMA', JSON.stringify(await page.evaluate(dump)));

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    for (const t of (win?._filoTabs?.tabs || [])) { try { t.view.webContents.setZoomFactor(1.5); } catch (_) {} }
  });
  await page.waitForTimeout(1500);
  console.log('DOPO ZOOM', JSON.stringify(await page.evaluate(dump)));

  await page.waitForTimeout(500);
  console.log('DOPO ZOOM 2', JSON.stringify(await page.evaluate(dump)));
});
