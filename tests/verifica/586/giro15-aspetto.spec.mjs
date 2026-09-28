// Verifica #586 giro 15: foto della striscia, del segno sulla scheda e di Sicurezza nei due temi (esplorazione, si cancella).
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('striscia, segno sulla scheda, Sicurezza', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  mkdirSync(SHOTS, { recursive: true });
  const page = await testServer.openReady(openTab, `<!doctype html><title>Chiamata</title><script>
    window.mic = () => navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => { window.__s = s; return 'ok'; }, (e) => 'err:' + e.name);
    window.notif = () => Notification.requestPermission();
  </script><h1>Chiamata</h1>`);
  await page.evaluate(() => { window.mic(); window.notif(); });
  await sleep(2000);
  const W = await shell.evaluate(() => window.innerWidth);
  await shell.screenshot({ path: join(SHOTS, '586-giro15-striscia.png'), clip: { x: 0, y: 0, width: W, height: 200 } });
  await shell.emulateMedia({ colorScheme: 'dark' });
  await sleep(300);
  await shell.screenshot({ path: join(SHOTS, '586-giro15-striscia-scuro.png'), clip: { x: 0, y: 0, width: W, height: 200 } });
  await shell.emulateMedia({ colorScheme: 'light' });
  await expect(shell.locator('#perm-bar .perm-si').first()).toBeEnabled({ timeout: 10_000 });
  await shell.locator('#perm-bar .perm-si').first().click();
  await sleep(500);
  await shell.locator('#perm-bar .perm-no').first().click().catch(() => {});
  await sleep(1000);
  await openTab(testServer.html('<!doctype html><title>Altra</title><p>altra</p>'));
  await sleep(1000);
  await shell.screenshot({ path: join(SHOTS, '586-giro15-segno.png'), clip: { x: 0, y: 0, width: W, height: 120 } });
  await shell.emulateMedia({ colorScheme: 'dark' });
  await sleep(300);
  await shell.screenshot({ path: join(SHOTS, '586-giro15-segno-scuro.png'), clip: { x: 0, y: 0, width: W, height: 120 } });
  await shell.emulateMedia({ colorScheme: 'light' });
  const sic = await openTab('filo://security');
  await sleep(2000);
  const box = await sic.evaluate(() => { const el = document.querySelector('[data-section="permessi"], #permessi, .permessi-siti, #site-permissions'); if (el) el.scrollIntoView(); return !!el; });
  console.log('SEZIONE', box);
  await sleep(500);
  await sic.screenshot({ path: join(SHOTS, '586-giro15-sicurezza.png') });
  await sic.emulateMedia({ colorScheme: 'dark' });
  await sleep(300);
  await sic.screenshot({ path: join(SHOTS, '586-giro15-sicurezza-scuro.png') });
});
