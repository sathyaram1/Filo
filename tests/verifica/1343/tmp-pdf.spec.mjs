import { test } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
test('pdf', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, '<!doctype html><title>x</title><h1>x</h1>');
  const url = testServer.asset(readFileSync('tests/fixtures/documenti/documento-con-testo.pdf'), 'application/pdf');
  await app.evaluate(({ BrowserWindow }, u) => { const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs; tm.navigate(tm.activeId, u); }, url);
  for (let i = 0; i < 4; i++) {
    await pausa(1000);
    console.log(JSON.stringify(await app.evaluate(({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
      const t = tm.tabs.find((x) => x.id === tm.activeId);
      return { url: t.url, loading: t.loading, aiuto: t.aiuto, nav: tm.barra._nav(), share: tm.barra._icone().find((x) => x.id === 'share') };
    })));
  }
});
