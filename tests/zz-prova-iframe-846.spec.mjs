import { test, expect } from './fixtures/electron.mjs';
import { statoDi, conta, clicca } from './helpers/riquadri.mjs';
const INNER = `<!doctype html><html><body style="margin:0;padding:16px;font:16px sans-serif"><p>Il <span id="w">gatto</span> dorme.</p></body></html>`;
test('prova iframe', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models: { [C.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = { ...orig, streamComplete: async ({ onDelta }) => { onDelta('The **cat**.'); return { text: 'The **cat**.', usage: {} }; } };
  });
  await app.evaluate(({ clipboard }) => clipboard.writeText('vecchio'));
  const innerUrl = testServer.html(INNER).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:12px"><iframe id="embed" src="${innerUrl}" width="600" height="420"></iframe></body></html>`);
  await page.frameLocator('#embed').locator('#w').dblclick();
  const frame = page.frames().find((f) => f !== page.mainFrame());
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs); globalThis.__filoShortcuts.dispatch('translate-selection', win); });
  await expect.poll(() => conta(app, page, '.sn-msg-copia', frame), { timeout: 15000 }).toBe(1);
  await clicca(app, page, '.sn-msg-copia', { frame });
  await page.waitForTimeout(800);
  console.log('RISULTATO', JSON.stringify(await app.evaluate(({ clipboard }) => clipboard.readText())), (await statoDi(app, page, '.sn-msg-copia', frame)).classi);
  await page.screenshot({ path: 'tests/.shots/zz-iframe.png' });
});
