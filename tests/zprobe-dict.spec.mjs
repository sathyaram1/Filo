import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html><body style="margin:0">
  <textarea id="t" spellcheck="true"
       style="font:16px monospace;padding:8px;width:400px;height:120px">qwertzxcvb ciao</textarea>
</body></html>`;

test('il correttore nativo vede il dizionario personale?', async ({ app, openTab, testServer }) => {
  const url = testServer.html(PAGE);
  const page = await openTab(url);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentReady === '1',
    null, { timeout: 8000 },
  );

  // Spia gli eventi context-menu del main: cattura params.misspelledWord.
  await app.evaluate(({ webContents }) => {
    globalThis.__probeMiss = [];
    for (const wc of webContents.getAllWebContents()) {
      wc.on('context-menu', (_e, params) => {
        globalThis.__probeMiss.push({ word: params.misspelledWord, sugg: params.dictionarySuggestions });
      });
    }
  });

  const box = await page.locator('#t').boundingBox();
  await page.mouse.click(box.x + 30, box.y + 16, { button: 'right' });
  await page.waitForTimeout(1200);
  const before = await app.evaluate(() => globalThis.__probeMiss);
  console.log('MISS PRIMA', JSON.stringify(before));
  await page.keyboard.press('Escape');

  // Voci del menu contestuale di Filo su quella parola
  const items = await page.evaluate(() => Array.from(document.querySelectorAll('.sn-menu .sn-menu-item, .sn-menu > *')).map((e) => e.textContent.trim()).filter(Boolean).slice(0, 30));
  console.log('MENU', JSON.stringify(items));
});
