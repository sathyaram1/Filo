import { test, expect } from './fixtures/electron.mjs';
import fs from 'node:fs';

test('377: molte tab strette, una suona -> un solo indicatore, nessun overlay/duplicato', async ({ app, shell, openTab, testServer }) => {
  // Apri molte tab per rendere ogni tab strettissima (scenario dell'utente).
  const url = testServer.html('<title>SITE_WITH_A_VERY_LONG_TITLE_YOUTUBE</title><h1 id="ok">p</h1>');
  let page;
  for (let i = 0; i < 12; i++) {
    page = await openTab(url);
  }
  await page.waitForSelector('#ok');

  // Forza audible + favicon sulla prima tab web (simula YouTube che suona).
  const favData = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  await app.evaluate(({ BrowserWindow }, fav) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tabs = w._filoTabs;
    const t = tabs.tabs.find((x) => /^https?:/.test(x.url || ''));
    t.audible = true; t.favicon = fav;
    tabs._broadcast();
  }, favData);

  await expect(shell.locator('.tab.audible')).toHaveCount(1, { timeout: 10_000 });
  // Esattamente UN indicatore audio in tutta la barra, zero duplicati a fine riga.
  await expect(shell.locator('.tab .favicon-audible')).toHaveCount(1);
  await expect(shell.locator('.tab .audio-ind')).toHaveCount(0);
  const svgCount = await shell.locator('.tab .favicon-audible svg').count();
  expect(svgCount).toBe(1);
  // Nessuna favicon di sfondo dietro l'icona (niente sovrapposizione).
  const bg = await shell.locator('.tab .favicon-audible').evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(bg).toBe('none');
  // L'icona resta visibile pur con tab strette.
  const box = await shell.locator('.tab .favicon-audible').boundingBox();
  expect(box.width).toBeGreaterThan(8);
  expect(box.height).toBeGreaterThan(8);

  fs.mkdirSync('tests/.shots', { recursive: true });
  await shell.screenshot({ path: 'tests/.shots/verify377-narrow-tabs.png' });
});
