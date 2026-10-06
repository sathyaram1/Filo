// Esplorazione del giro 17 (si cancella): elenco dei dispositivi e stati letti prima e dopo le risposte.
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const riga = (shell) => shell.locator('#perm-bar .perm-row');

const PAGINA = `<!doctype html><html><head><title>Disp</title></head><body><h1>Disp</h1>
<script>
  window.disp = () => navigator.mediaDevices.enumerateDevices().then((l) => l.map((d) => d.kind + ':' + (d.label ? 'L' : '-') + ':' + (d.deviceId ? 'I' : '-')).join(' '));
  window.av = () => navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((s) => { s.getTracks().forEach((t) => t.stop()); return 'ok'; }, (e) => 'err:' + e.name);
  window.stati = async () => { const o = {}; for (const n of ['camera', 'microphone', 'notifications', 'geolocation']) o[n] = (await navigator.permissions.query({ name: n })).state; return o; };
</script></body></html>`;

test('dispositivi e stati', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  console.log('prima', await page.evaluate(() => window.disp()), JSON.stringify(await page.evaluate(() => window.stati())));
  await page.evaluate(() => { window.__e = null; window.av().then((r) => { window.__e = r; }); });
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  await expect(shell.locator('#perm-bar .perm-si')).toBeEnabled({ timeout: 5000 });
  await shell.locator('#perm-bar .perm-si').click();
  await expect.poll(() => page.evaluate(() => window.__e)).toBe('ok');
  await sleep(300);
  console.log('dopo sì', await page.evaluate(() => window.disp()), JSON.stringify(await page.evaluate(() => window.stati())));
  await page.reload();
  await sleep(1000);
  console.log('dopo ricarica', await page.evaluate(() => window.disp()), JSON.stringify(await page.evaluate(() => window.stati())));
});
