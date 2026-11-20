import { test, expect } from '../../fixtures/electron.mjs';

const ARTICLE = `<!doctype html><html lang="en"><head><title>Football era</title></head><body style="font:16px sans-serif;padding:20px">
  <h1 id="title">The end of an era in European football</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up.</p>
</body></html>`;

test('debug', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, ARTICLE);
  await page.evaluate(() => {
    window.__t = [];
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) window.__t.push(n.textContent); })
      .observe(document.documentElement, { childList: true, subtree: true });
  });
  await page.locator('#p1').click();
  await page.keyboard.press('Alt+t');
  await page.waitForTimeout(2000);
  console.log('TOAST-TASTO', JSON.stringify(await page.evaluate(() => window.__t)), await page.locator('#title').innerText());
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const wc = w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['alt'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['alt'] });
  });
  await page.waitForTimeout(3000);
  console.log('TOAST-DISPATCH', JSON.stringify(await page.evaluate(() => window.__t)), await page.locator('#title').innerText());
});
