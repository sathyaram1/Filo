// Verifica #839 giro 3, rilievo 3 — Alt+S su una pagina che non si carica salva l'indirizzo del sito, non quello della pagina d'errore di Filo.
// Rossa senza la cura: la voce salvata punta alla pagina d'errore interna e nella lista il sito si chiama «error».
import { test, expect } from '../../fixtures/electron.mjs';


test('Alt+S su una pagina d\'errore salva l\'indirizzo vero', async ({ app, shell }) => {
  test.setTimeout(60000);
  const url = 'http://127.0.0.1:9/sito-giu';
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.some((t) => t.url.includes('127.0.0.1:9'))), { timeout: 8000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 2500));
  await app.evaluate(({ BrowserWindow }) => { globalThis.__filoShortcuts.dispatch('save-for-later', BrowserWindow.getAllWindows().find((w) => w._filoTabs)); });
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_SAVED_PAGES.list()).length), { timeout: 10000 }).toBeGreaterThan(0);
  const salvate = await app.evaluate(async () => (await globalThis.SN_SAVED_PAGES.list()).map((p) => p.url));
  expect(salvate).toEqual([url]);
});
