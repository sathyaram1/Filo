// Sonda avversariale #514 (giro 2, parte e) — usa e getta.
// A schermo intero, Esc chiude i riquadri di Filo o esce dallo schermo intero?
import { test, expect } from './fixtures/electron.mjs';

const PAGINA = '<html><body style="margin:0;height:1200px"><p id="t">parola dentro una frase</p></body></html>';

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
async function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { cf: !!t.contentFullscreen };
  });
}
async function setFs(app, on) {
  await app.evaluate(({ BrowserWindow }, v) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(v);
  }, on);
  await new Promise((r) => setTimeout(r, 700));
}
async function apriRiquadro(page) {
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
}

test('riquadro della spiegazione + Esc: fuori e dentro lo schermo intero', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await preparaProvider(app);

  // baseline: fuori dallo schermo intero Esc chiude il riquadro
  await apriRiquadro(page);
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 600));
  const fuori = await page.locator('.sn-popup').count();
  console.log('SONDA E — riquadri dopo Esc, schermo intero SPENTO:', fuori);

  // ora dentro
  await setFs(app, true);
  await apriRiquadro(page);
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 900));
  const dentro = await page.locator('.sn-popup').count();
  const fs = (await stato(app)).cf;
  console.log('SONDA E — riquadri dopo Esc, schermo intero ACCESO:', dentro, ' fullscreen ancora:', fs);

  // secondo Esc: adesso chiude il riquadro?
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 600));
  console.log('SONDA E — riquadri dopo il SECONDO Esc:', await page.locator('.sn-popup').count());
  await setFs(app, false);
  expect(fuori).toBe(0);
});
