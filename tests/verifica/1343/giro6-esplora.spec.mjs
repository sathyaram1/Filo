// Esplorazione verifica #1343 giro 6: cosa sa il main di Filo dentro le pagine. Si cancella.
import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const naviga = (app, u) => app.evaluate(({ BrowserWindow }, url) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  w._filoTabs.navigate(w._filoTabs.activeId, url);
}, u);

test('esplora aiuto per pagina', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, '<!doctype html><title>Prima</title><h1>Prima</h1>');
  const pdf = testServer.asset(readFileSync('tests/fixtures/documenti/documento-con-testo.pdf'), 'application/pdf');
  for (const u of ['', 'filo://newtab/', 'filo://options/options.html', 'filo://history/history.html', 'filo://preferences/preferences.html', 'filo://editor/editor.html', pdf]) {
    if (u) await naviga(app, u);
    await pausa(2500);
    const r = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
      return { url: t.url, aiuto: t.aiuto, loading: t.loading };
    });
    console.log('ESPLORA', JSON.stringify(r));
  }
  expect(true).toBe(true);
});
