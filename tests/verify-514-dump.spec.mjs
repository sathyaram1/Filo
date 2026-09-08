import { test } from './fixtures/electron.mjs';

const HTML = '<html><body style="margin:0"><p id="t">ciao</p></body></html>';

test('dump menu', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    win._filoTabs.toggleContentFullscreen();
  });
  await page.waitForTimeout(800);
  await page.locator('#t').click({ button: 'right' });
  await page.waitForTimeout(1200);
  const html = await page.evaluate(() => {
    const m = document.querySelector('.sn-menu');
    return m ? m.outerHTML.slice(0, 6000) : 'NESSUN MENU';
  });
  console.log('=====MENU=====\n' + html);
});
