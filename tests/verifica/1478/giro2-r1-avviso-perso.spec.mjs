// Verifica #1478 giro 2, rilievo 1: un avviso fuori politica che nessuno ha potuto vedere non deve zittire i successivi.
import { test, expect } from '../../fixtures/electron.mjs';

const MODELLO = 'deepseek/deepseek-v4-flash';

async function fintoServitoDa(app, host) {
  await app.evaluate(async (_e, { host: h, modello }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false, openWeightsOnly: false, apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry, 'mio-aperto': { provider: 'openrouter', model: modello } },
      models: { [C.ACTIONS.EXPLAIN]: 'mio-aperto' },
    });
    const P = globalThis.SN_PROVIDERS;
    P.completeWithFallback = async () => ({ text: 'r', model: modello, provider: 'openrouter', servedBy: h, usage: { promptTokens: 1, completionTokens: 1 } });
  }, { host, modello: MODELLO });
}

const spiega = (app, url, parola) => app.evaluate(async ({ webContents }, { u, p }) => {
  const C = globalThis.SN_CONST;
  const M = globalThis.SN_MSG.MSG;
  const wc = webContents.getAllWebContents().find((w) => w.getURL() === u);
  const r = await globalThis.__filoHandlers.handleMessage(
    { type: M.AI_REQUEST, action: C.ACTIONS.EXPLAIN, payload: { selection: p, sentence: `una frase con ${p}` }, suRichiesta: true },
    { wc, url: u },
  );
  return { ok: !(r && r.error), error: r && r.error };
}, { u: url, p: parola });

// Playwright finge sempre il fuoco: lo si toglie nel mondo dei content script (999), come quando si passa a un'altra app.
const fuoco = (app, url, si) => app.evaluate(async ({ webContents }, { u, s }) => {
  const wc = webContents.getAllWebContents().find((w) => w.getURL() === u);
  return wc.executeJavaScriptInIsolatedWorld(999, [{ code: `Document.prototype.hasFocus = () => ${s}; 1` }]);
}, { u: url, s: si });

test('r1 la risposta arriva mentre si è in un’altra applicazione: tornati, l’avviso su quell’host arriva comunque', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, '<!doctype html><html><body><p>Una pagina qualunque.</p></body></html>');
  await page.mouse.click(5, 5);
  await fintoServitoDa(app, 'Google Vertex');
  await fuoco(app, page.url(), false);
  expect((await spiega(app, page.url(), 'mare')).ok).toBe(true);
  await page.waitForTimeout(1000);
  expect(await page.locator('.sn-toast').count(), 'senza fuoco l’avviso non si mostra').toBe(0);
  await fuoco(app, page.url(), true);
  await page.mouse.click(5, 5);
  expect((await spiega(app, page.url(), 'monte')).ok).toBe(true);
  await expect(page.locator('.sn-toast', { hasText: 'Google Vertex' }).first()).toBeVisible({ timeout: 5000 });
});

