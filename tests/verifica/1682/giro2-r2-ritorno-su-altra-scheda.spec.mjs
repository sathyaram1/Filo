// Verifica #1682, giro 2: si torna su Filo da un'altra applicazione cliccando un'ALTRA scheda nella barra. Il fuoco
// arriva alla pressione del tasto, il cambio di scheda al rilascio: l'avviso deve comparire nella scheda scelta.

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

const spiega = (app, t) => app.evaluate(async (_e, testo) => {
  const C = globalThis.SN_CONST;
  const r = await globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.AI_REQUEST, action: C.ACTIONS.EXPLAIN, payload: { selection: testo, sentence: `${testo} in una frase` } }, {});
  return Boolean(r && !r.error);
}, t);

const finestraDavanti = (app, si) => app.evaluate(({ BrowserWindow }, s) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  win.isFocused = () => s;
  if (s) win.emit('focus');
}, si);
const paginaSenzaFuoco = (app, url) => app.evaluate(async ({ webContents }, u) => {
  const wc = webContents.getAllWebContents().find((w) => w.getURL() === u);
  const code = 'Document.prototype.hasFocus = () => false; 1';
  await wc.executeJavaScript(code);
  await wc.executeJavaScriptInIsolatedWorld(999, [{ code }]);
}, url);

const toastDi = (page, host) => page.locator('.sn-toast', { hasText: `«${host}»` });

test('r2 tornati su Filo cliccando un’altra scheda della barra: l’avviso in coda compare nella scheda scelta', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeVisible({ timeout: 10_000 });
  const idHome = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  const page = await testServer.openReady(openTab, '<!doctype html><html><body><p>Una pagina qualunque.</p></body></html>');
  await fintoServitoDa(app, 'Google Vertex');
  await paginaSenzaFuoco(app, page.url());
  await paginaSenzaFuoco(app, home.url());

  await finestraDavanti(app, false);
  expect(await spiega(app, 'ritorno1682')).toBe(true);
  await page.waitForTimeout(1000);
  await expect(toastDi(page, 'Google Vertex'), 'Filo dietro: l’avviso aspetta').toHaveCount(0);

  // Pressione sulla scheda della home: la finestra prende il fuoco; al rilascio, un decimo di secondo dopo, si cambia scheda.
  await finestraDavanti(app, true);
  await page.waitForTimeout(120);
  await shell.evaluate((i) => window.filoShell.tabs.activate(i), idHome);
  await expect(toastDi(home, 'Google Vertex'), 'l’avviso compare nella scheda che si guarda').toHaveCount(1, { timeout: 5_000 });
});
