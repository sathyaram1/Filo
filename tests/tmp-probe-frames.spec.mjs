import { test, expect } from './fixtures/electron.mjs';

test('sonda frames', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="padding:20px">
    <p id="p1">First paragraph of the body text, long enough to be picked up by the translation.</p>
    <iframe id="blank" style="width:520px;height:220px"></iframe>
    <iframe id="real" src="${testServer.html('<!doctype html><html><body><p id=fbody>A comment left by a reader.</p></body></html>')}" style="width:520px;height:220px"></iframe>
    <script>
      const d = document.getElementById('blank').contentDocument;
      d.body.innerHTML = '<p id="fbody">A comment left by a reader of this article, in english.</p>';
    </script>
  </body></html>`);
  await page.waitForTimeout(2000);
  const info = await app.evaluate(async ({ BrowserWindow }) => {
    const out = [];
    for (const w of BrowserWindow.getAllWindows()) {
      for (const t of (w._filoTabs?.tabs || [])) {
        const wc = t.view.webContents;
        const frames = wc.mainFrame?.framesInSubtree || [];
        out.push({ url: wc.getURL(), frames: frames.map((f) => ({ url: f.url, detached: f.detached })) });
      }
    }
    return out;
  });
  console.log('FRAMES:', JSON.stringify(info, null, 1));
  console.log('BLANK marker:', await page.evaluate(() => {
    const d = document.getElementById('blank').contentDocument;
    return JSON.stringify({ ready: d.documentElement.dataset.filoReady, mods: d.documentElement.dataset.filoModules });
  }));
});
