import { test, expect } from '../../fixtures/electron.mjs';

const raffica = (testServer, quando, n, titolo) => testServer.html(`<title>${titolo}</title><p>articolo</p><script>
  setTimeout(function(){for(var i=0;i<${n};i++)window.open('${testServer.html('<title>P</title>')}?ad='+i)}, Math.max(300, ${quando}-Date.now()));
</script>`);

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}`, async ({ app, shell, testServer, avvisi }) => {
    await shell.evaluate((t) => window.filoShell.message({ type: 'update_settings', settings: { theme: t, notifications: { durationSec: 0, soundEnabled: false, sound: 'default' } } }), tema);
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((w) => w._filoTabs).setContentSize(760, 520); });
    const quando = Date.now() + 6000;
    for (let i = 0; i < 8; i++) await shell.evaluate((u) => window.filoShell.tabs.open(u), raffica(testServer, quando, 6, `Sito ${i}`));
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif.show')).toHaveCount(5, { timeout: 15000 });
    await shell.waitForTimeout(800);
    await vista.screenshot({ path: `tests/.shots/480-${tema}.png` });
    const img = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
      return (await win.capturePage()).toPNG().toString('base64');
    });
    require('fs');
  });
}
