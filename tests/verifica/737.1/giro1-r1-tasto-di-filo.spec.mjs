import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL(); } catch (_) { return t.url || ''; } });
});

test('la scorciatoia di Filo per una scheda nuova, premuta sulla pagina, non le regala la scheda che apre da sola', async ({ app, openTab, testServer }) => {
  const bersaglio = testServer.html('<title>DA SOLA</title>');
  const page = await openTab(testServer.html(`<title>Sito</title><p>articolo</p><script>setTimeout(function(){window.open(${JSON.stringify(bersaglio)})},2500)</script>`));
  await page.waitForTimeout(1200);
  await page.keyboard.press('Control+t');
  await page.waitForTimeout(3000);
  expect((await schede(app)).filter((u) => u === bersaglio).length).toBe(0);
});
