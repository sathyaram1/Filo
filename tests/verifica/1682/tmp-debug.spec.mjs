import { test, expect } from '../../fixtures/electron.mjs';

test('debug visibilita', async ({ app, shell, openTab, testServer }) => {
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeVisible({ timeout: 10_000 });
  const idHome = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  const code = `window.__ev = []; document.addEventListener('visibilitychange', () => window.__ev.push('vis:' + document.visibilityState)); window.addEventListener('focus', () => window.__ev.push('focus')); 1`;
  await app.evaluate(async ({ webContents }, { u, code }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL() === u);
    await wc.executeJavaScript(code);
    await wc.executeJavaScriptInIsolatedWorld(999, [{ code }]);
  }, { u: home.url(), code });
  const sito = await testServer.openReady(openTab, '<p>x</p>');
  await sito.waitForTimeout(500);
  const leggi = () => app.evaluate(async ({ webContents }, u) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL() === u);
    return { main: await wc.executeJavaScript('JSON.stringify([document.visibilityState, window.__ev])'), iso: await wc.executeJavaScriptInIsolatedWorld(999, [{ code: 'JSON.stringify([document.visibilityState, window.__ev, typeof chrome])' }]) };
  }, home.url());
  console.log('DIETRO', JSON.stringify(await leggi()));
  await shell.evaluate((i) => window.filoShell.tabs.activate(i), idHome);
  await home.waitForTimeout(800);
  console.log('DAVANTI', JSON.stringify(await leggi()));
});
