// Verifica #586 giro 14: foto della striscia in finestra stretta (esplorazione, si cancella).
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('striscia stretta, due domande e scelta dello schermo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  mkdirSync(SHOTS, { recursive: true });
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(520, 700); });
  const page = await testServer.openReady(openTab, `<!doctype html><title>Stretta</title><script>
    window.tutto = () => { navigator.mediaDevices.getUserMedia({ video: true, audio: true }).catch(() => {}); Notification.requestPermission(); navigator.geolocation.getCurrentPosition(() => {}, () => {}); };
    window.schermo = () => navigator.mediaDevices.getDisplayMedia({ video: true }).catch(() => {});
  </script>`);
  await page.evaluate(() => window.tutto());
  await sleep(2000);
  await shell.screenshot({ path: join(SHOTS, '586-giro14-stretta.png'), clip: { x: 0, y: 0, width: 520, height: 260 } });
  await shell.emulateMedia({ colorScheme: 'dark' });
  await shell.screenshot({ path: join(SHOTS, '586-giro14-stretta-scuro.png'), clip: { x: 0, y: 0, width: 520, height: 260 } });
  await shell.emulateMedia({ colorScheme: 'light' });
  for (let i = 0; i < 3; i++) { await shell.locator('#perm-bar .perm-chiudi').first().click().catch(() => {}); await sleep(200); }
  await page.evaluate(() => window.schermo());
  await expect(shell.locator('#perm-bar .perm-si')).toBeEnabled({ timeout: 10_000 });
  await shell.locator('#perm-bar .perm-si').click();
  await sleep(1500);
  await shell.screenshot({ path: join(SHOTS, '586-giro14-stretta-schermo.png'), clip: { x: 0, y: 0, width: 520, height: 320 } });
});
