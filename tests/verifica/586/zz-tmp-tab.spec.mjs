import { test } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px"><p id="p">pagina</p>
<script>
  const tracce = (s) => s.getTracks().map((t) => t.kind + ' | ' + t.label + ' | ' + JSON.stringify(t.getSettings()));
  window.__tab = () => navigator.mediaDevices.getUserMedia({
    video: { mandatory: { chromeMediaSource: 'tab' } } }).then(tracce, (e) => 'no:' + e.name + ' ' + e.message);
  window.__desktopId = () => navigator.mediaDevices.getUserMedia({
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: 'screen:0:0' } } })
    .then(tracce, (e) => 'no:' + e.name + ' ' + e.message);
  window.__gdmDiNuovo = () => navigator.mediaDevices.getDisplayMedia({ video: true })
    .then(tracce, (e) => 'no:' + e.name);
</script></body></html>`;

test('tab capture e id esplicito, con il Consenti', async ({ shell, openTab, testServer }) => {
  test.setTimeout(300_000);
  const page = await testServer.openReady(openTab, HTML);
  for (const quale of ['__tab', '__desktopId', '__gdmDiNuovo', '__gdmDiNuovo']) {
    const p = page.evaluate((q) => window[q](), quale);
    await shell.waitForTimeout(1500);
    console.log(`[g4] ${quale} → domanda: ${JSON.stringify(await shell.locator('.perm-chip').allTextContents())}`);
    const ok = shell.locator('.perm-chip .perm-chip-allow');
    if (await ok.count()) await ok.first().click();
    await shell.waitForTimeout(1200);
    const fonti = await shell.locator('.perm-source-item').allTextContents();
    console.log(`[g4] ${quale} → scelta fonte: ${JSON.stringify(fonti)}`);
    if (fonti.length) await shell.locator('.perm-source-item').first().click();
    const r = await Promise.race([p, new Promise((r2) => setTimeout(() => r2('(in attesa)'), 6000))]);
    console.log(`[g4] ${quale} → ARRIVA: ${JSON.stringify(r)}`);
    console.log(`[g4] ${quale} → segno: ${JSON.stringify(await shell.locator('.perm-live').allTextContents())}`);
    await shell.waitForTimeout(500);
  }
});
