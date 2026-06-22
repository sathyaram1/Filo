import { test, expect } from './fixtures/electron.mjs';

// AUDIT: la barra degli indirizzi (tabs:navigate -> navigate() -> loadURL)
// dovrebbe rifiutare gli schemi non-web (file:, data:, javascript:) come fa
// il guard isWebUnsafeNav su will-navigate. Questo test verifica che digitare
// un file:// nella barra NON carichi davvero quello schema.
test('address bar non naviga verso file://', async ({ shell, app }) => {
  // prende lo snapshot tab per l'id della scheda attiva
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const tabId = snap.activeId ?? snap.tabs?.[0]?.id;
  expect(tabId, 'tab id trovato').toBeTruthy();

  const target = 'file:///etc/passwd';
  await shell.evaluate(([tid, u]) => window.filoShell.tabs.navigate(tid, u), [tabId, target]);

  // dà tempo all'eventuale load
  await new Promise((r) => setTimeout(r, 1800));

  const urls = app.windows().map((w) => { try { return w.url(); } catch { return ''; } });
  const loadedFile = urls.find((u) => u.startsWith('file://'));
  console.log('WINDOW URLS:', JSON.stringify(urls));
  expect(loadedFile, `nessuna view ha caricato file:// (urls=${JSON.stringify(urls)})`).toBeFalsy();
});
