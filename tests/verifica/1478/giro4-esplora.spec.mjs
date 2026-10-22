// Verifica #1478 giro 4: esplorazione (Segnala dall'avviso, host strano, ricerca, tema scuro).
import { test, expect } from '../../fixtures/electron.mjs';

const MODELLO = 'deepseek/deepseek-v4-flash';

async function fintoServitoDa(app, host, extra = {}) {
  await app.evaluate(async (_e, { host: h, modello, extra: x }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false, openWeightsOnly: false, apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry, 'mio-aperto': { provider: 'openrouter', model: modello } },
      models: { [C.ACTIONS.EXPLAIN]: 'mio-aperto', [C.ACTIONS.CHAT]: 'mio-aperto' },
      ...x,
    });
    try { await globalThis.SN_HISTORY.clear(); } catch (_) {}
    const P = globalThis.SN_PROVIDERS;
    const risposta = (text) => ({ text, model: modello, provider: 'openrouter', servedBy: h, usage: { promptTokens: 10, completionTokens: 5 } });
    P.completeWithFallback = async () => risposta('una risposta');
    P.streamCompleteWithFallback = async ({ onDelta }) => { try { onDelta && onDelta('una risposta'); } catch (_) {} return risposta('una risposta'); };
  }, { host, modello: MODELLO, extra });
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

test('pagina web: Segnala apre il feedback già scritto', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, '<!doctype html><html><body><p>Una pagina qualunque.</p></body></html>');
  await page.mouse.click(5, 5);
  await fintoServitoDa(app, 'Google Vertex');
  expect((await spiega(app, page.url(), 'mare')).ok).toBe(true);
  const avviso = page.locator('.sn-toast');
  await expect(avviso).toHaveCount(1, { timeout: 5000 });
  const btn = avviso.locator('button', { hasText: 'Segnala' });
  await expect(btn).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/1478-g4-avviso-pagina.png' }).catch(() => {});
  await btn.click();
  const testo = page.locator('.sn-fb-text');
  await expect(testo).toBeVisible({ timeout: 5000 });
  const v = await testo.inputValue();
  console.log('PREFILL pagina:', v);
  expect(v).toContain('Google Vertex');
  expect(v).toContain(MODELLO);
  await page.screenshot({ path: 'tests/.shots/1478-g4-feedback-pagina.png' }).catch(() => {});
});

test('home: Segnala apre il feedback già scritto', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const home = await openTab('filo://newtab/');
  await home.mouse.click(5, 5);
  await fintoServitoDa(app, 'Google AI Studio');
  expect((await spiega(app, home.url(), 'neve')).ok).toBe(true);
  const avviso = home.locator('.sn-toast');
  await expect(avviso).toHaveCount(1, { timeout: 5000 });
  const btn = avviso.locator('button', { hasText: 'Segnala' });
  await expect(btn).toBeVisible();
  await btn.click();
  const testo = home.locator('.sn-fb-text');
  await expect(testo).toBeVisible({ timeout: 5000 });
  expect(await testo.inputValue()).toContain('Google AI Studio');
});

test('host con markup, ricerca e tema scuro', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, '<!doctype html><html><body><p>Una pagina qualunque.</p></body></html>');
  await page.mouse.click(5, 5);
  const strano = 'Google <img src=x onerror="window.__xss1478=1">Cattivo';
  await fintoServitoDa(app, strano, { theme: 'dark' });
  expect((await spiega(app, page.url(), 'vento')).ok).toBe(true);
  const avviso = page.locator('.sn-toast');
  await expect(avviso).toHaveCount(1, { timeout: 5000 });
  await expect(avviso).toContainText('<img');
  expect(await avviso.locator('img').count()).toBe(0);
  await page.screenshot({ path: 'tests/.shots/1478-g4-avviso-scuro.png' }).catch(() => {});

  const storia = await openTab('filo://history/history.html');
  await expect(storia.locator('.sn-history-policy-warn')).toHaveCount(1, { timeout: 10_000 });
  expect(await storia.locator('.sn-history-meta img').count()).toBe(0);
  await storia.screenshot({ path: 'tests/.shots/1478-g4-cronologia-scuro.png' }).catch(() => {});
  await storia.locator('#search').fill('cattivo');
  await expect(storia.locator('.sn-history-item')).toHaveCount(1);
  await storia.locator('#search').fill('non ammesso');
  await expect(storia.locator('.sn-history-item')).toHaveCount(1);
});
