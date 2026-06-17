import { test, expect } from './fixtures/electron.mjs';

async function sendNative(app, host, word, suggestions) {
  return app.evaluate(async ({ webContents }, { host, word, suggestions }) => {
    const wc = webContents.getAllWebContents().find((w) => {
      try { return new URL(w.getURL()).host === host; } catch { return false; }
    });
    if (!wc) return false;
    wc.send('filo:broadcast', { type: '_spell:native', word, suggestions });
    return true;
  }, { host, word, suggestions });
}

const TA_PAGE = `<!doctype html><html><body style="margin:0">
  <textarea id="ta" spellcheck="true"
    style="font:16px monospace;padding:8px;width:400px;height:120px">ciiao come stai</textarea>
</body></html>`;

for (let i = 0; i < 8; i++) {
  test(`diag ${i}`, async ({ app, openTab, testServer }) => {
    const url = testServer.html(TA_PAGE);
    const page = await openTab(url);
    const logs = [];
    page.on('console', (m) => logs.push(m.text()));
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    const sent = await sendNative(app, new URL(url).host, 'ciiao', ['ciao', 'chiao']);
    await page.waitForTimeout(150);
    const box = await page.locator('#ta').boundingBox();
    await page.mouse.click(box.x + 16, box.y + 16, { button: 'right' });
    await expect(page.locator('.sn-menu')).toBeVisible();
    await page.waitForTimeout(800);
    const dump = await page.evaluate(() => {
      const menu = document.querySelector('.sn-menu');
      const corr = document.querySelector('.sn-menu-correction');
      const cs = corr ? getComputedStyle(corr) : null;
      return {
        hasMenu: !!menu,
        hasCorrection: !!corr,
        corrDisplay: cs ? cs.display : null,
        corrText: corr ? corr.textContent : null,
        corrHidden: corr ? corr.hasAttribute('hidden') || cs.display === 'none' : null,
        menuHTML: menu ? menu.innerHTML.slice(0, 400) : null,
      };
    });
    console.log(`DIAG${i}: sent=${sent} ${JSON.stringify(dump)}`);
  });
}
