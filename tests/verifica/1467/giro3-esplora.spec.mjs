// Verifica #1467 giro 3, esplorazione: in incognito la home e la dettatura non si contano.
import { test, expect } from '../../fixtures/electron.mjs';

const misura = (app, m) => app.evaluate(async (_e, m) => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const out = {};
  for (const ora of Object.values(s.ore || {})) for (const [c, n] of Object.entries(ora[m] || {})) out[c] = (out[c] || 0) + n;
  return out;
}, m);

async function trovaPagina(app, prova, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina non trovata');
}

test('incognito: home e dettatura non contano', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, apiKeys: {}, dictation: { autoSend: false } });
  });
  await new Promise((r) => setTimeout(r, 1500));
  const prima = await misura(app, 'home');
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs)), { timeout: 15_000 }).toBe(true);
  const url = 'filo://newtab/?prova=incognito-home';
  await app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows().find((w) => w._filoIncognito)._filoTabs.openTab(u), url);
  const incog = await trovaPagina(app, (u) => u === url, 15_000);
  await incog.waitForLoadState('domcontentloaded');
  await new Promise((r) => setTimeout(r, 3000));
  expect(await misura(app, 'home')).toEqual(prima);
  // un clic su una pagina salvata o un suggerimento non c'è senza modello: basta la home.
  await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoIncognito)._filoTabs;
    tm.closeTab(tm.tabs.find((t) => t.url === u).id);
  }, url);
  await new Promise((r) => setTimeout(r, 1500));
  expect(await misura(app, 'home')).toEqual(prima);
  expect(await misura(app, 'dettatura')).toEqual({});
});
