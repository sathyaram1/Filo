// #514 giro 4 — diagnostica sul riquadro della risposta.
import { test, expect } from './fixtures/electron.mjs';

async function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { cf: !!t.contentFullscreen, conRiquadro: [...t.tabsWithFiloBox], attiva: t.activeId };
  });
}

async function entra(app) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 700));
}

async function esc(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, 900));
}

async function preparaProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.SN_PROVIDER_OPENROUTER,
      streamComplete: async ({ onDelta }) => {
        onDelta('Una spiegazione breve.');
        return { text: 'Una spiegazione breve.', usage: {} };
      },
    };
  });
}

async function apriRisposta(page) {
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });
  await page.evaluate(() => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
      anchor: { x: 120, y: 300 },
      title: 'Approfondisci',
    });
  });
  await page.waitForSelector('.sn-popup', { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 600));
}

test('A — fuori dallo schermo intero, Esc chiude la risposta', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await preparaProvider(app);
  await apriRisposta(page);
  await esc(app);
  const aperti = await page.locator('.sn-popup').count();
  console.log('[A] riquadri aperti dopo Esc (senza schermo intero):', aperti);
  expect(aperti).toBe(0);
});

test('B — a schermo intero, il primo Esc deve chiudere la risposta', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await preparaProvider(app);
  await entra(app);
  await apriRisposta(page);
  const prima = await stato(app);
  console.log('[B] il main sa del riquadro?', JSON.stringify(prima));
  await esc(app);
  const dopo = await stato(app);
  const aperti = await page.locator('.sn-popup').count();
  console.log('[B] riquadri aperti dopo il primo Esc:', aperti, '| schermo intero:', dopo.cf);
  expect({ riquadroAperto: aperti > 0, schermoIntero: dopo.cf })
    .toEqual({ riquadroAperto: false, schermoIntero: true });
});
