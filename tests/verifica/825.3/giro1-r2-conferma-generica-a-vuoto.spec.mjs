// Verifica #825.3, giro 1, rilievo 2: il riordino ora risponde «chiede conferma»
// a ogni chiamante, ma la conferma della strada generica (assistente sulla
// pagina: popup di Filo, poi conferma) non lo esegue.

import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('riordino chiesto dall\'assistente: dopo il sì del popup le schede vengono riordinate', async ({ app, shell }) => {
  test.setTimeout(30_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__triage = 0;
    for (const w of BrowserWindow.getAllWindows()) {
      if (w._filoTabs) w._filoTabs.runAutoTriage = async () => { globalThis.__triage += 1; return { archived: 1 }; };
    }
  });
  const action = { type: 'PULISCI_TAB' };
  const prima = await page.evaluate((a) => chrome.runtime.sendMessage({ type: 'filo_run_action', action: a }), action);
  // Il main chiede conferma: è quello che fa aprire il popup all'assistente.
  expect(prima.needsConfirm).toBeTruthy();
  const dopo = await page.evaluate((a) => chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: a, assistente: true }), action);
  // Confermato, o il riordino parte, o il popup non andava mostrato.
  expect(dopo.executed).toBe(true);
  expect(await app.evaluate(() => globalThis.__triage)).toBe(1);
});
