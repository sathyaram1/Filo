import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html><body style="margin:0">
  <textarea id="ta" lang="it" spellcheck="true"
    style="font:24px monospace;padding:10px;width:520px;height:140px"></textarea>
</body></html>`;

test('dbg2: download dizionario + retry', async ({ app, openTab, testServer }) => {
  test.setTimeout(60000);
  const url = testServer.html(PAGE);
  const host = new URL(url).host;
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

  // Ascolta eventi di download dizionario.
  const dlEvents = await app.evaluate(({ session }) => {
    return new Promise((resolve) => {
      const ses = session.defaultSession;
      const events = [];
      ses.on('spellcheck-dictionary-download-begin', (e, lang) => events.push(['begin', lang]));
      ses.on('spellcheck-dictionary-download-success', (e, lang) => events.push(['success', lang]));
      ses.on('spellcheck-dictionary-download-failure', (e, lang) => events.push(['failure', lang]));
      globalThis.__dl = events;
      resolve('listening');
    });
  });
  console.log('DL', dlEvents);

  await app.evaluate(({ webContents }, host) => {
    globalThis.__params = [];
    const wc = webContents.getAllWebContents().find((w) => { try { return new URL(w.getURL()).host === host; } catch { return false; } });
    if (wc) wc.on('context-menu', (_e, p) => { globalThis.__params.push({ m: p.misspelledWord }); });
  }, host);

  await page.evaluate(() => {
    const ta = document.getElementById('ta');
    ta.value = 'questa parolla sbagliataa';
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  });

  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(3000);
    const box = await page.locator('#ta').boundingBox();
    await page.mouse.click(box.x + 230, box.y + 26, { button: 'right' });
    await page.waitForTimeout(300);
    const params = await app.evaluate(() => globalThis.__params);
    const dl = await app.evaluate(() => globalThis.__dl);
    console.log(`ITER${i} CTX`, JSON.stringify(params), 'DLEV', JSON.stringify(dl));
    await page.keyboard.press('Escape');
  }
});
