// Verifica #1478 giro 2: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';

const MODELLO = 'deepseek/deepseek-v4-flash';

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

test('A focus altrove quando arriva la risposta', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, '<!doctype html><html><body><p>Una pagina qualunque.</p></body></html>');
  await page.mouse.click(5, 5);
  await fintoServitoDa(app, 'Google Vertex');
  await shell.evaluate(() => { const i = document.querySelector('input'); if (i) i.focus(); });
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.focus(); });
  console.log('hasFocus pagina', await page.evaluate(() => document.hasFocus()));
  const r = await spiega(app, page.url(), 'mare');
  expect(r.ok).toBe(true);
  await page.waitForTimeout(1500);
  console.log('toast mentre fuori fuoco', await page.locator('.sn-toast').count(), await shell.locator('text=Google Vertex').count());
  await page.mouse.click(5, 5);
  const r2 = await spiega(app, page.url(), 'monte');
  expect(r2.ok).toBe(true);
  await page.waitForTimeout(1500);
  console.log('toast dopo, col fuoco', await page.locator('.sn-toast').count());
});

test('C Segnala da una pagina web', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, '<!doctype html><html><body><p>Una pagina qualunque.</p></body></html>');
  await page.mouse.click(5, 5);
  await fintoServitoDa(app, 'Google <b>Vertex</b>');
  expect((await spiega(app, page.url(), 'sole')).ok).toBe(true);
  const avviso = page.locator('.sn-toast');
  await expect(avviso).toHaveCount(1, { timeout: 5000 });
  console.log('testo avviso', await avviso.textContent(), await avviso.locator('b').count());
  await page.screenshot({ path: 'tests/.shots/1478-g2-web-avviso.png' }).catch(() => {});
  await avviso.locator('.sn-msg-rimedio').click();
  const testo = page.locator('.sn-fb-overlay .sn-fb-text');
  await expect(testo).toBeVisible({ timeout: 5000 });
  console.log('testo feedback', await testo.inputValue());
  await page.screenshot({ path: 'tests/.shots/1478-g2-web-feedback.png' }).catch(() => {});
});

test('D tema scuro avviso', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const home = await openTab('filo://newtab/');
  await home.mouse.click(5, 5);
  await fintoServitoDa(app, 'Google AI Studio');
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  await home.waitForTimeout(800);
  expect((await spiega(app, home.url(), 'neve')).ok).toBe(true);
  await expect(home.locator('.sn-toast')).toHaveCount(1, { timeout: 5000 });
  await home.waitForTimeout(500);
  await home.screenshot({ path: 'tests/.shots/1478-g2-scuro.png' }).catch(() => {});
});
