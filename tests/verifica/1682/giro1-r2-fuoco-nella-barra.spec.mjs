// Verifica #1682, giro 1: l'avviso sull'host escluso aspetta solo se la FINESTRA di Filo non ha il fuoco. Con Filo
// davanti e il fuoco sulla barra delle schede (chi è tornato su Filo cliccando lì) l'avviso deve comparire.

import { test, expect } from '../../fixtures/electron.mjs';

async function fintoServitoDa(app, host) {
  await app.evaluate(async (_e, h) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false, openWeightsOnly: false, apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry, 'mio-aperto': { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' } },
      models: { [C.ACTIONS.EXPLAIN]: 'mio-aperto' },
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async () => ({
      text: 'r', model: 'deepseek/deepseek-v4-flash', provider: 'openrouter', servedBy: h, usage: { promptTokens: 1, completionTokens: 1 },
    });
  }, host);
}

const spiega = (app, testo) => app.evaluate(async (_e, t) => {
  const C = globalThis.SN_CONST;
  const r = await globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.AI_REQUEST, action: C.ACTIONS.EXPLAIN, payload: { selection: t, sentence: `${t} in una frase` } }, {});
  return { ok: Boolean(r && !r.error) };
}, testo);

// Il contenitore non dà il fuoco vero a nessuna finestra, e Playwright lo finge in ogni pagina. Qui si rifà lo stato
// di chi ha cliccato la barra delle schede: la finestra di Filo davanti, la pagina senza fuoco (ce l'ha la shell).
const filoDavantiFuocoNellaBarra = (app, url) => app.evaluate(async ({ BrowserWindow, webContents }, u) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  win.isFocused = () => true;
  const wc = webContents.getAllWebContents().find((w) => w.getURL() === u);
  await wc.executeJavaScriptInIsolatedWorld(999, [{ code: 'Document.prototype.hasFocus = () => false; window.dispatchEvent(new Event(\'blur\')); 1' }]);
  return true;
}, url);

test('r2 Filo davanti col fuoco sulla barra delle schede: l’avviso sull’host escluso compare senza dover cliccare nella pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, '<!doctype html><html><body><p>Una pagina qualunque.</p></body></html>');
  await fintoServitoDa(app, 'Google Vertex');
  await filoDavantiFuocoNellaBarra(app, page.url());

  expect((await spiega(app, 'ghiaccio1682')).ok).toBe(true);
  await expect(page.locator('.sn-toast', { hasText: '«Google Vertex»' }), 'Filo è davanti: l’avviso si vede subito').toHaveCount(1, { timeout: 5_000 });
});
