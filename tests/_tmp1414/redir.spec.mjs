import { test, expect } from '../fixtures/electron.mjs';
test('redirect', async ({ app, shell }) => {
  const aperta = await shell.evaluate((u) => window.filoShell.tabs.open(u), 'filo://credits/owner.html');
  await expect.poll(async () => app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL())), { timeout: 15000 })
    .toContainEqual('filo://manage/manage.html#utenti');
  console.log(JSON.stringify(aperta));
});
