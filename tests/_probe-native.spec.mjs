import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html><body style="margin:0">
  <div id="ce" contenteditable="true" spellcheck="true" lang="it"
       style="font:20px monospace;padding:8px;width:400px;height:120px">ciiao come stai</div>
</body></html>`;

test('PROBE: real native spellchecker suggestions for italian misspelling', async ({ app, openTab, testServer }) => {
  const url = testServer.html(PAGE);
  const page = await openTab(url);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoReady === '1',
    null, { timeout: 8000 },
  );

  // Record every _spell:native broadcast that arrives.
  await page.evaluate(() => {
    globalThis.__natives = [];
    globalThis.chrome.runtime.onMessage.addListener((m) => {
      if (m?.type === '_spell:native') globalThis.__natives.push(m);
    });
  });

  // Focus + place caret in the word so Electron knows what's under cursor.
  const box = await page.locator('#ce').boundingBox();
  await page.mouse.click(box.x + 18, box.y + 16); // left click first to focus
  await page.waitForTimeout(300);
  // Real right-click on "ciiao".
  await page.mouse.click(box.x + 18, box.y + 16, { button: 'right' });
  await page.waitForTimeout(800);

  const natives = await page.evaluate(() => globalThis.__natives);
  console.log('NATIVE_BROADCASTS=' + JSON.stringify(natives));

  // Also ask the main process directly what languages are active.
  const langs = await app.evaluate(({ session }) => ({
    available: session.defaultSession.availableSpellCheckerLanguages || [],
    configured: session.defaultSession.getSpellCheckerLanguages?.() || [],
  }));
  console.log('LANGS=' + JSON.stringify(langs));

  const menuHtml = await page.evaluate(() => {
    const m = document.querySelector('.sn-menu');
    return m ? m.innerText.slice(0, 300) : 'NO_MENU';
  });
  console.log('MENU=' + JSON.stringify(menuHtml));
});
