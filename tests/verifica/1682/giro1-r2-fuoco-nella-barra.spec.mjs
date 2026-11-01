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

// Playwright finge il fuoco in ogni pagina: quello vero, col fuoco nella barra delle schede, la pagina non ce l'ha.
const paginaSenzaFuoco = (app, url) => app.evaluate(async ({ webContents }, u) => {
  const wc = webContents.getAllWebContents().find((w) => w.getURL() === u);
  return wc.executeJavaScriptInIsolatedWorld(999, [{ code: 'Document.prototype.hasFocus = () => false; 1' }]);
}, url);

test('r2 Filo davanti col fuoco sulla barra delle schede: l’avviso sull’host escluso compare senza dover cliccare nella pagina', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, '<!doctype html><html><body><p>Una pagina qualunque.</p></body></html>');
  await fintoServitoDa(app, 'Google Vertex');
  // L'utente clicca la scheda nella barra: la tastiera va alla shell, la finestra di Filo resta davanti.
  await shell.locator('.tab').first().click();
  await paginaSenzaFuoco(app, page.url());
  const stato = await app.evaluate(({ BrowserWindow, webContents }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const col = webContents.getFocusedWebContents();
    return { finestra: Boolean(win && win.isFocused()), shell: Boolean(col && win && col === win.webContents) };
  });
  console.log('STATO r2:', JSON.stringify(stato));
  expect(stato.shell, 'la tastiera è nella barra delle schede').toBe(true);

  expect((await spiega(app, 'ghiaccio1682')).ok).toBe(true);
  await expect(page.locator('.sn-toast', { hasText: '«Google Vertex»' }), 'Filo è davanti: l’avviso si vede subito').toHaveCount(1, { timeout: 5_000 });
});
