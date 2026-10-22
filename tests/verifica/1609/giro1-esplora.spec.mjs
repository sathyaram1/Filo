// Esplorazione #1609: nella raffica di dieci schede, il «+N» mostra tutti gli avvisi e «Chiudi tutti» li porta via.
import { test, expect } from '../../fixtures/electron.mjs';

const raffica = (testServer, quando, n, titolo) => testServer.html(`<title>${titolo}</title><p>articolo</p><script>
  setTimeout(function(){for(var i=0;i<${n};i++)window.open('${testServer.html('<title>PUBBLICITA</title>')}?ad='+i)}, Math.max(300, ${quando}-Date.now()));
</script>`);

test('raffica: +N apre la pila intera, Chiudi tutti la svuota', async ({ app, shell, testServer, avvisi }) => {
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings',
    settings: { notifications: { durationSec: 0, soundEnabled: false, sound: 'default' } },
  }));
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs).setContentSize(760, 520);
  });
  const quando = Date.now() + 7000;
  for (let i = 0; i < 10; i++) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), raffica(testServer, quando, 12, `Sito ${i}`));
  }
  const vista = await avvisi();
  const altre = vista.locator('.avvisi-testa [data-pila="apri"]');
  await expect(altre).toHaveText('+5 avvisi', { timeout: 20000 });
  await shell.waitForTimeout(1500);
  await altre.scrollIntoViewIfNeeded();
  await altre.click();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(10, { timeout: 4000 });
  const tutte = vista.locator('.avvisi-testa [data-pila="chiudi-tutti"]');
  await expect(tutte).toBeVisible();
  await shell.waitForTimeout(1300);
  await tutte.scrollIntoViewIfNeeded();
  await tutte.click();
  await expect(shell.locator('.shell-notif:not([data-closing="1"])')).toHaveCount(0, { timeout: 4000 });
  await expect(vista.locator('.shell-notif.show')).toHaveCount(0, { timeout: 4000 });
  await vista.locator('body').screenshot({ path: 'tests/.shots/1609-dopo.png' }).catch(() => {});
});
