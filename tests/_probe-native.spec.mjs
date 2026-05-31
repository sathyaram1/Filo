import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html><body style="margin:0">
  <div id="ce" contenteditable="true" spellcheck="true" lang="it"
       style="font:24px monospace;padding:10px;width:500px;height:120px"></div>
</body></html>`;

test('PROBE: real native spellchecker, typed italian misspelling', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ webContents }) => {
    globalThis.__ctx = [];
    webContents.getAllWebContents().forEach((wc) => {
      wc.on('context-menu', (_e, p) => globalThis.__ctx.push({ w: p.misspelledWord, s: p.dictionarySuggestions }));
    });
  });
  const url = testServer.html(PAGE);
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await app.evaluate(({ webContents }) => {
    webContents.getAllWebContents().forEach((wc) => {
      if (wc.__p) return; wc.__p = true;
      wc.on('context-menu', (_e, p) => globalThis.__ctx.push({ w: p.misspelledWord, s: p.dictionarySuggestions }));
    });
  });

  // TYPE the misspelled word so Chromium's spellchecker flags it.
  await page.locator('#ce').click();
  await page.keyboard.type('ciiao', { delay: 40 });
  await page.waitForTimeout(1200); // let the spellchecker mark it

  const box = await page.locator('#ce').boundingBox();
  await page.mouse.click(box.x + 30, box.y + 28, { button: 'right' });
  await page.waitForTimeout(1000);

  const ctx = await app.evaluate(() => globalThis.__ctx);
  console.log('CTX=' + JSON.stringify(ctx));
  const menu = await page.evaluate(() => {
    const m = document.querySelector('.sn-menu');
    if (!m) return 'NO_MENU';
    const corr = m.querySelector('.sn-menu-correction');
    return { hasCorr: !!corr && corr.offsetParent !== null, label: corr?.querySelector('.sn-menu-label')?.innerText };
  });
  console.log('MENU=' + JSON.stringify(menu));
});
