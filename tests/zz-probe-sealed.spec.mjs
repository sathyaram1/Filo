import { test, expect } from './fixtures/electron.mjs';

async function sendNative(app, host, word, suggestions) {
  return app.evaluate(({ webContents }, { host, word, suggestions }) => {
    const targets = webContents.getAllWebContents().filter((w) => {
      try { return new URL(w.getURL()).host === host; } catch { return false; }
    });
    for (const wc of targets) wc.send('filo:broadcast', { type: '_spell:native', word, suggestions });
    return targets.length;
  }, { host, word, suggestions });
}

const CE = '<div id="ce" contenteditable="true" spellcheck="true" '
  + 'style="font:16px monospace;padding:8px;width:400px;height:120px">wrlod ciao</div>';

test('probe sealed', async ({ app, openTab, testServer }) => {
  const url = testServer.html(`<!doctype html><html><body style="margin:0;padding:0">
    <div id="host"></div>
    <script>
      const r = document.querySelector('#host').attachShadow({ mode: 'closed' });
      r.innerHTML = ${JSON.stringify(CE)};
      const el = r.querySelector('#ce');
      window.__peek = () => el.textContent;
      window.__selWord = () => {
        el.focus();
        const t = el.firstChild;
        const sel = r.getSelection ? r.getSelection() : window.getSelection();
        const range = document.createRange();
        range.setStart(t, 0); range.setEnd(t, 5);
        const s = window.getSelection();
        s.removeAllRanges(); s.addRange(range);
        return { active: document.activeElement && document.activeElement.id, txt: String(s) };
      };
      window.__state = () => ({
        active: document.activeElement && (document.activeElement.id || document.activeElement.tagName),
        sel: String(window.getSelection()),
        rc: window.getSelection().rangeCount,
      });
      window.__exec = (txt) => document.execCommand('insertText', false, txt);
    </script>
  </body></html>`);
  const page = await openTab(url);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });

  await page.mouse.click(24, 24, { button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();

  console.log('after rightclick state:', JSON.stringify(await page.evaluate(() => window.__state())));
  console.log('selWord:', JSON.stringify(await page.evaluate(() => window.__selWord())));
  console.log('after sel state:', JSON.stringify(await page.evaluate(() => window.__state())));

  await sendNative(app, new URL(url).host, 'wrlod', ['world', 'word']);
  const corr = page.locator('.sn-menu-correction:visible').first();
  await expect(corr).toBeVisible({ timeout: 4000 });

  // Probe: what happens to focus/selection on mousedown over the menu item?
  await page.mouse.move(0, 0);
  const box = await corr.boundingBox();
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  console.log('after mousedown state:', JSON.stringify(await page.evaluate(() => window.__state())));
  await page.mouse.up();
  await page.waitForTimeout(500);
  console.log('after click state:', JSON.stringify(await page.evaluate(() => window.__state())));
  console.log('TEXT NOW:', await page.evaluate(() => window.__peek()));
});

test('probe execCommand works in sealed shadow', async ({ app, openTab, testServer }) => {
  const url = testServer.html(`<!doctype html><html><body style="margin:0;padding:0">
    <div id="host"></div>
    <script>
      const r = document.querySelector('#host').attachShadow({ mode: 'closed' });
      r.innerHTML = ${JSON.stringify(CE)};
      const el = r.querySelector('#ce');
      window.__peek = () => el.textContent;
      window.__selWord = () => {
        el.focus();
        const t = el.firstChild;
        const range = document.createRange();
        range.setStart(t, 0); range.setEnd(t, 5);
        const s = window.getSelection();
        s.removeAllRanges(); s.addRange(range);
      };
      window.__exec = (txt) => document.execCommand('insertText', false, txt);
    </script>
  </body></html>`);
  const page = await openTab(url);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.evaluate(() => window.__selWord());
  const ok = await page.evaluate(() => window.__exec('world'));
  console.log('execCommand returned', ok, 'text now:', await page.evaluate(() => window.__peek()));
  console.log('TEXT:', await page.evaluate(() => window.__peek()));
});
