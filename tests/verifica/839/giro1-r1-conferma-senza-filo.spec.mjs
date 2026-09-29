// Verifica #839, giro 1, rilievo 1 — Alt+S su una pagina dove Filo non è dentro (sito escluso): la conferma cliccabile deve comparire lo stesso.
// Rosso finché la scheda si chiude senza che l'utente veda «Apri la lista» in nessuna finestra.

import { test, expect } from '../../fixtures/electron.mjs';

async function confermaVisibile(app) {
  for (const w of app.windows()) {
    try {
      if (await w.evaluate(() => (document.documentElement?.innerText || '').includes('Apri la lista'))) return true;
    } catch (_) { /* finestra chiusa nel frattempo */ }
  }
  return false;
}

test('Alt+S su un sito dove Filo è spento mostra la conferma cliccabile prima di chiudere la scheda', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { blocklist: ['127.0.0.1'] } }));
  const url = testServer.html('<!doctype html><html><head><title>Sito escluso</title></head><body><h1>Articolo</h1></body></html>');
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await page.waitForTimeout(500);

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('save-for-later', win);
  });

  let vista = false;
  const fine = Date.now() + 5000;
  while (!vista && Date.now() < fine) {
    vista = await confermaVisibile(app);
    if (!vista) await new Promise((r) => setTimeout(r, 100));
  }
  const salvata = await app.evaluate(async (_e, u) => ((await globalThis.chrome.storage.local.get('savedPages')).savedPages || []).some((p) => p.url === u), url);
  expect(salvata, 'la pagina non è stata salvata').toBe(true);
  expect(vista, 'Alt+S ha salvato e chiuso la scheda senza la conferma «Salvata in: … · Apri la lista»').toBe(true);
});
