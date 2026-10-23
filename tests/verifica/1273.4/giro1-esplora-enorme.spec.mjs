// Esplorazione: una scheda con mezzo milione di elementi, la domanda su ciò che sta in fondo.
import { test, expect } from '../../fixtures/electron.mjs';

test('una scheda da mezzo milione di elementi: la risposta arriva e dice che è letta in parte', async ({ app, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await openTab('filo://newtab/');
  const righe = '<tr><td>a</td><td>b</td><td>c</td><td>d</td></tr>'.repeat(100000);
  const url = testServer.html(`<!doctype html><html><head><title>Registro</title></head><body><main><table>${righe}</table>
<p>ULTIMA_RIGA consegnata il 27 settembre</p></main></body></html>`);
  await app.evaluate((_e, url) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url, background: true }), url);
  await expect.poll(() => app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows()
    .some((w) => w._filoTabs && w._filoTabs.tabs.some((t) => t.view.webContents.getURL() === u && !t.view.webContents.isLoading())), url),
  { timeout: 150_000 }).toBe(true);
  await app.evaluate(async () => {
    globalThis.SN_LETTURA_PAGINE._cache.clear();
    globalThis.SN_LETTURA_PAGINE._dip.scarica = async () => { throw new Error('la rete non doveva servire'); };
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__n = 0;
    globalThis.__esiti = '';
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({ text: '{"text":"","actions":[]}', model: attempts[0].model, provider: attempts[0].provider, usage: {} });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const n = globalThis.__n++;
      if (n === 0) {
        const u = /http:\/\/127\.0\.0\.1:\d+\/[^\s"'\]]+/.exec(messages.map((m) => String(m.content || '')).join('\n'));
        return { ...base, text: '', toolCalls: [{ id: 'c0', name: 'LEGGI_PAGINA', arguments: JSON.stringify({ url: u ? u[0] : '' }) }], finishReason: 'tool_calls' };
      }
      const esiti = messages.filter((m) => m.role === 'tool').map((m) => String(m.content || '')).join('\n');
      globalThis.__esiti = esiti;
      const text = /prima parte/.test(esiti) ? 'RISPOSTA: letta in parte.' : 'RISPOSTA: altro.';
      try { onDelta && onDelta(text); } catch (_) {}
      return { ...base, text, toolCalls: [], finishReason: 'stop' };
    };
  });
  const t0 = Date.now();
  await page.locator('#input').fill(`quando è stata consegnata l'ultima riga di ${url}?`);
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA:' })).toBeVisible({ timeout: 90_000 });
  console.log('secondi alla risposta', (Date.now() - t0) / 1000);
  console.log('esiti', (await app.evaluate(() => globalThis.__esiti)).slice(-400));
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA: letta in parte.' })).toBeVisible();
});
