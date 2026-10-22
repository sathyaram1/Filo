// Verifica #1478 giro 1: una risposta servita da un host escluso si vede nella Cronologia e in un avviso.
import { test, expect } from '../../fixtures/electron.mjs';

const MODELLO = 'deepseek/deepseek-v4-flash';

// Il fornitore finto risponde come OpenRouter servito da `host`, sia in un colpo sia in diretta.
async function fintoServitoDa(app, host) {
  await app.evaluate(async (_e, { host: h, modello }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false, openWeightsOnly: false, apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry, 'mio-aperto': { provider: 'openrouter', model: modello } },
      models: { [C.ACTIONS.EXPLAIN]: 'mio-aperto', [C.ACTIONS.CHAT]: 'mio-aperto' },
    });
    try { await globalThis.SN_HISTORY.clear(); } catch (_) {}
    const P = globalThis.SN_PROVIDERS;
    const risposta = (text) => ({ text, model: modello, provider: 'openrouter', servedBy: h, usage: { promptTokens: 10, completionTokens: 5 } });
    P.completeWithFallback = async () => risposta('una risposta');
    P.streamCompleteWithFallback = async ({ onDelta }) => { try { onDelta && onDelta('una risposta'); } catch (_) {} return risposta('una risposta'); };
  }, { host, modello: MODELLO });
}

async function spiega(app, url, parola) {
  return app.evaluate(async ({ webContents }, { u, p }) => {
    const C = globalThis.SN_CONST;
    const M = globalThis.SN_MSG.MSG;
    const wc = webContents.getAllWebContents().find((w) => w.getURL() === u);
    const r = await globalThis.__filoHandlers.handleMessage(
      { type: M.AI_REQUEST, action: C.ACTIONS.EXPLAIN, payload: { selection: p, sentence: `una frase con ${p}` }, suRichiesta: true },
      { wc, url: u },
    );
    return { ok: !(r && r.error), error: r && r.error };
  }, { u: url, p: parola });
}

test('una spiegazione servita da un host escluso: avviso nella pagina e segno in Cronologia', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, '<!doctype html><html><body><p>Una pagina qualunque.</p></body></html>');
  await page.mouse.click(5, 5);
  await fintoServitoDa(app, 'Google Vertex');
  const r = await spiega(app, page.url(), 'mare');
  expect(r.ok, JSON.stringify(r)).toBe(true);

  const avviso = page.locator('.sn-toast');
  await expect(avviso).toHaveCount(1, { timeout: 5000 });
  await expect(avviso).toContainText('Google Vertex');
  await page.screenshot({ path: 'tests/.shots/1478-v-avviso-pagina.png' }).catch(() => {});

  const storia = await openTab('filo://history/history.html');
  const segno = storia.locator('.sn-history-policy-warn');
  await expect(segno).toHaveCount(1);
  await expect(storia.locator('.sn-history-meta').filter({ has: segno })).toContainText('Google Vertex');
  await storia.screenshot({ path: 'tests/.shots/1478-v-cronologia.png' }).catch(() => {});
});

test('una risposta servita da un host escluso mentre si è nella home: l’avviso compare lì', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  const home = await openTab('filo://newtab/');
  await home.mouse.click(5, 5);
  await fintoServitoDa(app, 'Google AI Studio');
  const r = await spiega(app, home.url(), 'neve');
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const avviso = home.locator('.sn-toast');
  await expect(avviso).toHaveCount(1, { timeout: 5000 });
  await expect(avviso).toContainText('Google AI Studio');
  await home.screenshot({ path: 'tests/.shots/1478-v-avviso-home.png' }).catch(() => {});
});
