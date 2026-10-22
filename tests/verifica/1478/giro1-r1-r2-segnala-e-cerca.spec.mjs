// Verifica #1478 giro 1: l'avviso chiede di segnalare senza dare la strada (r1); in Cronologia l'host non si cerca (r2).
import { test, expect } from '../../fixtures/electron.mjs';

const MODELLO = 'deepseek/deepseek-v4-flash';

async function servitaDa(app, url, host, parola) {
  return app.evaluate(async ({ webContents }, { u, h, modello, p }) => {
    const C = globalThis.SN_CONST;
    const M = globalThis.SN_MSG.MSG;
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false, openWeightsOnly: false, apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry, 'mio-aperto': { provider: 'openrouter', model: modello } },
      models: { [C.ACTIONS.EXPLAIN]: 'mio-aperto' },
    });
    try { await globalThis.SN_HISTORY.clear(); } catch (_) {}
    globalThis.SN_PROVIDERS.completeWithFallback = async () => ({
      text: 'una risposta', model: modello, provider: 'openrouter', servedBy: h, usage: { promptTokens: 10, completionTokens: 5 },
    });
    const wc = webContents.getAllWebContents().find((w) => w.getURL() === u);
    const r = await globalThis.__filoHandlers.handleMessage(
      { type: M.AI_REQUEST, action: C.ACTIONS.EXPLAIN, payload: { selection: p, sentence: `una frase con ${p}` }, suRichiesta: true },
      { wc, url: u },
    );
    return { ok: !(r && r.error), error: r && r.error };
  }, { u: url, h: host, modello: MODELLO, p: parola });
}

test('r1 l’avviso che chiede di segnalare ha il tasto per farlo', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, '<!doctype html><html><body><p>Una pagina.</p></body></html>');
  await page.mouse.click(5, 5);
  const r = await servitaDa(app, page.url(), 'Google Cloud', 'sole');
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const avviso = page.locator('.sn-toast');
  await expect(avviso).toHaveCount(1, { timeout: 5000 });
  await expect(avviso).toContainText('Segnalalo');
  await expect(avviso.locator('button, a, [role="button"]')).toHaveCount(1);
});

test('r2 in Cronologia la voce marcata si trova cercando l’host che la mostra', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, '<!doctype html><html><body><p>Una pagina.</p></body></html>');
  const r = await servitaDa(app, page.url(), 'Google Vertex', 'mare');
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const storia = await openTab('filo://history/history.html');
  await expect(storia.locator('.sn-history-policy-warn')).toHaveCount(1);
  await storia.locator('#search').fill('Vertex');
  await expect(storia.locator('.sn-history-item')).toHaveCount(1, { timeout: 3000 });
});
