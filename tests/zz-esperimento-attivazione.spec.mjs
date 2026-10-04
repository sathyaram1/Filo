import { test, expect } from './fixtures/electron.mjs';

const attiva = (app) => app.evaluate(async ({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
  const fr = wc.mainFrame.framesInSubtree;
  const out = [];
  for (const f of fr) { try { out.push(f.origin + '=' + await f.executeJavaScript('navigator.userActivation.isActive', false)); } catch (e) { out.push('err ' + e.message); } }
  return out.join(' | ');
});

test('esperimento', async ({ app, openTab, testServer }) => {
  const bersaglio = testServer.html('<title>B</title>');
  const ad = testServer.html(`<p>ad</p><script>window.addEventListener('message',function(){window.open(${JSON.stringify(bersaglio)})})</script>`, { pubblico: true });
  const page = await openTab(testServer.html(`<title>A</title><p style="height:200px">testo</p><iframe src="${ad}" width="300" height="100"></iframe><script>window.apri=function(){window.open(${JSON.stringify(bersaglio)}+'?m')}</script>`));
  await expect.poll(() => page.frames().some((f) => f.url() === ad), { timeout: 8000 }).toBe(true);
  await page.waitForTimeout(6000);
  console.log('prima', await attiva(app));
  await page.mouse.click(50, 50);
  await page.waitForTimeout(200);
  console.log('dopo clic', await attiva(app));
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
    const f = wc.mainFrame.frames[0];
    return f.executeJavaScript('window.dispatchEvent(new MessageEvent("message"))', false);
  });
  await page.waitForTimeout(300);
  console.log('dopo open dal riquadro', await attiva(app));
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
    return wc.mainFrame.executeJavaScript('window.apri()', false);
  });
  await page.waitForTimeout(300);
  console.log('dopo open dalla pagina', await attiva(app));
});
