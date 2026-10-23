// Esplorazione: la strada di ogni utente (home di riserva, Ctrl+T) con la configurazione di rete che nomina un fornitore ritirato.
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ accoglienzaFatta: false, riservaNuovaScheda: true });

function vistaDavanti(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    return tm.tabs.find((t) => t.id === tm.activeId).view.webContents.id;
  });
}

async function paginaDellaVista(app, wcId) {
  let trovata = null;
  await expect.poll(async () => {
    await app.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript(`window.__filoVista = ${id}; true`), wcId);
    for (const w of app.windows()) {
      try { if (await w.evaluate(() => window.__filoVista || 0) === wcId) { trovata = w; return true; } } catch (_) {}
    }
    return false;
  }, { timeout: 15_000 }).toBe(true);
  return trovata;
}

for (const via of ['ctrl+t', 'piu']) {
  test(`configurazione di rete col fornitore ritirato, poi scheda nuova (${via})`, async ({ app, shell }) => {
    test.setTimeout(90_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    await app.evaluate(async () => {
      const Defaults = globalThis.__filoDefaults;
      const origGet = globalThis.__filoDefaultsGet || Defaults.get;
      globalThis.__filoDefaultsGet = origGet;
      globalThis.__filoConfigArrivata = false;
      Defaults.get = () => (globalThis.__filoConfigArrivata
        ? { ...origGet(), provider: 'gemini' }
        : { ...origGet(), models: {}, modelRegistry: {} });
      await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'k-test' } });
    });
    await app.evaluate(() => {
      const P = globalThis.SN_PROVIDERS;
      const risposta = (attempts) => ({ text: JSON.stringify({ message: 'Buongiorno.', suggestions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {} });
      P.streamCompleteWithFallback = async ({ attempts, onDelta }) => { const r = risposta(attempts); try { onDelta && onDelta(r.text); } catch (_) {} return r; };
      P.completeWithFallback = async ({ attempts }) => risposta(attempts);
    });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
      const wc = tm.riserva && tm.riserva.webContents();
      return !!(wc && wc.getURL() === 'filo://newtab/' && !wc.isLoading());
    }), { timeout: 20_000 }).toBe(true);

    await app.evaluate(async () => {
      globalThis.__filoConfigArrivata = true;
      const vera = globalThis.fetch;
      const doc = { fields: { provider: { stringValue: 'gemini' }, modelRegistry: { mapValue: { fields: { 'arrivo-rete': { mapValue: { fields: {
        provider: { stringValue: 'openrouter' }, model: { stringValue: 'deepseek/deepseek-v4-flash-0731' },
      } } } } } } } };
      globalThis.fetch = (u, o) => (String(u).includes('/documents/config/models')
        ? Promise.resolve(new Response(JSON.stringify(doc), { status: 200, headers: { 'content-type': 'application/json' } }))
        : vera(u, o));
      try { await globalThis.__filoDefaults.refresh(); } finally { globalThis.fetch = vera; }
    });

    const vecchia = await vistaDavanti(app);
    if (via === 'ctrl+t') await shell.keyboard.press('Control+t');
    else await shell.locator('#tab-new').click();
    await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 10_000 });
    let nuova = vecchia;
    await expect.poll(async () => (nuova = await vistaDavanti(app)), { timeout: 10_000 }).not.toBe(vecchia);
    const page = await paginaDellaVista(app, nuova);
    await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
    await expect(page.locator('.dash-bubble-filo').first()).toContainText('Ciao, sono Filo', { timeout: 10_000 });
    await page.screenshot({ path: 'tests/.shots/718-4-' + via + '.png' });
  });
}
