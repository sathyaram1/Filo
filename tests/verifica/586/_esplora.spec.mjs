import { test, expect } from '../../fixtures/electron.mjs';
test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });
test('esc', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><title>x</title><script>window.unaVolta = () => navigator.mediaDevices.getUserMedia({ video: true }).catch(() => {});</script>');
  await app.evaluate(({ webContents }) => {
    globalThis.__inp = [];
    for (const wc of webContents.getAllWebContents()) wc.on('before-input-event', (e, i) => globalThis.__inp.push(wc.getURL().slice(0, 30) + ' ' + i.type + ' ' + i.key));
  });
  await page.evaluate(() => { window.unaVolta(); });
  await expect(shell.locator('#perm-bar .perm-row')).toHaveCount(1, { timeout: 10_000 });
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 500));
  console.log('inp', JSON.stringify(await app.evaluate(() => globalThis.__inp)));
  console.log('righe', await shell.locator('#perm-bar .perm-row').count());
  const att = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((wc) => [wc.getURL().slice(0, 40), globalThis.__filoPermessi.inAttesaPer(wc).length]));
  console.log('att', JSON.stringify(att));
});
