// Sonda visiva temporanea #586 — da cancellare.
import { test } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const HTML = `<!doctype html><html><body style="margin:0"><p>x</p><script>
  window.__cam = () => { window.__p = navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then(() => 'ok', (e) => e.name); };
</script></body></html>`;

test('scatto pastiglia', async ({ app, shell, openTab, testServer }) => {
  mkdirSync('tests/agent/.out', { recursive: true });
  const page = await testServer.openReady(openTab, HTML);
  await page.evaluate(() => window.__cam());
  await shell.locator('.perm-chip').waitFor({ timeout: 10_000 });
  await shell.screenshot({ path: 'tests/agent/.out/586-chiaro.png', clip: { x: 0, y: 0, width: 1180, height: 100 } });

  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await shell.waitForTimeout(500);
  await shell.screenshot({ path: 'tests/agent/.out/586-scuro.png', clip: { x: 0, y: 0, width: 1180, height: 100 } });
});
