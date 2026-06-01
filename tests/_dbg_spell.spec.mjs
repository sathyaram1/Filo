import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html><body style="margin:0">
  <textarea id="ta" lang="it" spellcheck="true"
    style="font:24px monospace;padding:10px;width:520px;height:140px"></textarea>
</body></html>`;

test('dbg: cosa riporta context-menu nativo', async ({ app, openTab, testServer }) => {
  const url = testServer.html(PAGE);
  const host = new URL(url).host;
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

  const langs = await app.evaluate(({ session }) => {
    const ses = session.defaultSession;
    return { available: ses.availableSpellCheckerLanguages, configured: ses.getSpellCheckerLanguages?.() };
  });
  console.log('LANGS', JSON.stringify(langs));

  await app.evaluate(({ webContents }, host) => {
    globalThis.__params = [];
    const wc = webContents.getAllWebContents().find((w) => { try { return new URL(w.getURL()).host === host; } catch { return false; } });
    if (wc) wc.on('context-menu', (_e, p) => { globalThis.__params.push({ misspelledWord: p.misspelledWord, suggestions: p.dictionarySuggestions, isEditable: p.isEditable }); });
  }, host);

  await page.evaluate(() => {
    const ta = document.getElementById('ta');
    ta.value = 'questa parolla';
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  });
  await page.waitForTimeout(1200);
  const box = await page.locator('#ta').boundingBox();
  await page.mouse.click(box.x + 230, box.y + 26, { button: 'right' });
  await page.waitForTimeout(800);
  const params = await app.evaluate(() => globalThis.__params);
  console.log('CTXPARAMS', JSON.stringify(params));
});
