// Sonda temporanea #586 — da cancellare.
import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><body><p id="p">x</p><script>
  window.__cam = null;
  window.__chiedi = () => { window.__cam = navigator.mediaDevices.getUserMedia({ video: true })
    .then(() => 'ok', (e) => (e && e.name) + ':' + (e && e.message)); };
  window.__dev = async () => (await navigator.mediaDevices.enumerateDevices()).map((d) => d.kind + '/' + d.label);
</script></body></html>`;

test('sonda', async ({ shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  console.log('DEVICES', JSON.stringify(await page.evaluate(() => window.__dev())));
  await page.evaluate(() => window.__chiedi());
  await page.waitForTimeout(3000);
  console.log('CHIP', await shell.locator('.perm-chip').count());
  console.log('CAM', await page.evaluate(() => window.__cam));
  expect(1).toBe(1);
});
