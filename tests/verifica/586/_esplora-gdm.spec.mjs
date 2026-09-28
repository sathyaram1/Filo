// Esplorazione (si cancella): getDisplayMedia con la domanda nel gestore dello schermo.
import { test, expect } from '../../fixtures/electron.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('gdm', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, `<!doctype html><title>G</title><button id="b">b</button><script>
    window.r = null;
    document.getElementById('b').onclick = () => navigator.mediaDevices.getDisplayMedia({ video: true })
      .then((s) => { window.r = 'ok:' + s.getTracks().map((t) => t.label); }, (e) => { window.r = 'err:' + e.name + ':' + e.message; });
  </script>`);
  await app.evaluate(({ desktopCapturer }) => {
    globalThis.__log = [];
    const orig = desktopCapturer.getSources.bind(desktopCapturer);
    desktopCapturer.getSources = async (o) => { const r = await orig(o); globalThis.__log.push(r.map((f) => f.id)); return r; };
  });
  await page.click('#b');
  const si = shell.locator('#perm-bar .perm-si');
  await expect(si).toBeEnabled({ timeout: 10_000 });
  await si.click();
  const schermo = shell.locator('#perm-bar .perm-fonte[data-tipo="schermo"]').first();
  await expect(schermo).toBeVisible({ timeout: 10_000 });
  console.log('R prima', await page.evaluate(() => window.r));
  await schermo.click();
  await sleep(3000);
  console.log('R', await page.evaluate(() => window.r));
  console.log('LOG', JSON.stringify(await app.evaluate(() => globalThis.__log)));
});
