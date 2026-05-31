import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html><body style="margin:0">
  <div id="ce" contenteditable="true" spellcheck="true" lang="it"
       style="font:20px monospace;padding:8px;width:400px;height:120px">ciiao come stai</div>
</body></html>`;

test('PROBE: real native spellchecker end-to-end italian', async ({ app, openTab, testServer }) => {
  // Capture context-menu params seen by the main process for ANY webContents.
  await app.evaluate(({ webContents }) => {
    globalThis.__ctxParams = [];
    webContents.getAllWebContents().forEach((wc) => {
      wc.on('context-menu', (_e, p) => {
        globalThis.__ctxParams.push({
          misspelledWord: p.misspelledWord,
          dictionarySuggestions: p.dictionarySuggestions,
          selectionText: p.selectionText,
        });
      });
    });
  });

  const url = testServer.html(PAGE);
  const page = await openTab(url);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoReady === '1',
    null, { timeout: 8000 },
  );
  // Re-attach listener to the NEW webContents (the tab) too.
  await app.evaluate(({ webContents }) => {
    webContents.getAllWebContents().forEach((wc) => {
      if (wc.__probed) return;
      wc.__probed = true;
      wc.on('context-menu', (_e, p) => {
        globalThis.__ctxParams.push({
          misspelledWord: p.misspelledWord,
          dictionarySuggestions: p.dictionarySuggestions,
        });
      });
    });
  });

  const box = await page.locator('#ce').boundingBox();
  await page.mouse.click(box.x + 18, box.y + 16);
  await page.waitForTimeout(300);
  await page.mouse.click(box.x + 18, box.y + 16, { button: 'right' });
  await page.waitForTimeout(900);

  const params = await app.evaluate(() => globalThis.__ctxParams || []);
  console.log('CTX_PARAMS=' + JSON.stringify(params));

  const langs = await app.evaluate(({ session }) => ({
    available: session.defaultSession.availableSpellCheckerLanguages || [],
    configured: session.defaultSession.getSpellCheckerLanguages?.() || [],
  }));
  console.log('LANGS=' + JSON.stringify(langs));

  const menu = await page.evaluate(() => {
    const m = document.querySelector('.sn-menu');
    if (!m) return 'NO_MENU';
    const corr = m.querySelector('.sn-menu-correction:not([style*="display: none"])');
    return { text: m.innerText.slice(0, 200), hasVisibleCorrection: !!corr };
  });
  console.log('MENU=' + JSON.stringify(menu));
});
