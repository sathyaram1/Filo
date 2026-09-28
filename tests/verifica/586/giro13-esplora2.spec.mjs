// Verifica #586 giro 13: esplorazione (schermo intero, finestra stretta). Da cancellare.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots');

const PAGINA = `<!doctype html><html><head><title>Video</title></head><body style="margin:0">
<div id="v" style="width:100%;height:100vh;background:#123"><button id="fs">schermo intero</button></div>
<script>
  document.getElementById('fs').onclick = () => document.getElementById('v').requestFullscreen();
  window.chiedi = () => Notification.requestPermission();
  window.tutto = () => {
    navigator.mediaDevices.getUserMedia({ video: true }).catch(() => {});
    navigator.requestMIDIAccess({ sysex: true }).catch(() => {});
    navigator.geolocation.getCurrentPosition(() => {}, () => {});
  };
</script></body></html>`;

test('a schermo intero la domanda si vede', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.click('#fs');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w._filoTabs.contentFullscreen;
  })).toBe(true);
  await page.evaluate(() => { window.__e = null; window.chiedi().then((r) => { window.__e = r; }); });
  await expect(shell.locator('#perm-bar .perm-row')).toHaveCount(1, { timeout: 10_000 });
  await new Promise((r) => setTimeout(r, 800));
  const geo = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return { fs: tm.contentFullscreen, bounds: t.view.getBounds() };
  });
  const bar = await shell.locator('#perm-bar').boundingBox();
  console.log('geo', JSON.stringify(geo), 'bar', JSON.stringify(bar));
  expect(geo.fs && geo.bounds.y < bar.y + bar.height, 'la pagina a schermo intero copre la domanda').toBe(false);
});

test('finestra stretta, nome lungo, tre domande: aspetto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const url = testServer.html(PAGINA).replace('127.0.0.1', 'un-sito-dal-nome-davvero-lunghissimo-per-provare-la-striscia.localhost');
  const page = await openTab(url);
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.setSize(720, 600);
  });
  await page.evaluate(() => window.tutto());
  await expect(shell.locator('#perm-bar .perm-row')).toHaveCount(3, { timeout: 10_000 });
  await new Promise((r) => setTimeout(r, 1200));
  mkdirSync(SHOTS, { recursive: true });
  await shell.screenshot({ path: join(SHOTS, '586-giro13-stretta.png') });
  await shell.emulateMedia({ colorScheme: 'dark' });
  await shell.screenshot({ path: join(SHOTS, '586-giro13-stretta-scuro.png') });
  const t = await shell.locator('#perm-bar').innerText();
  console.log('testo', t);
});
