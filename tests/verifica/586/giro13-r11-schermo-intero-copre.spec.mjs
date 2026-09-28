// Verifica #586 giro 13, rilievo 11: a schermo intero la pagina copre la domanda, e il sito aspetta una risposta che non si può dare.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><head><title>Video</title></head><body style="margin:0">
<div id="v" style="width:100%;height:100vh;background:#123"><button id="fs">schermo intero</button></div>
<script>
  document.getElementById('fs').onclick = () => document.getElementById('v').requestFullscreen();
  window.chiedi = () => Notification.requestPermission();
</script></body></html>`;

test('una domanda che arriva a schermo intero si vede', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.click('#fs');
  const stato = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return { fs: tm.contentFullscreen, y: t.view.getBounds().y };
  });
  await expect.poll(async () => (await stato()).fs).toBe(true);
  await page.evaluate(() => { window.__e = null; window.chiedi().then((r) => { window.__e = r; }); });
  await expect(shell.locator('#perm-bar .perm-row')).toHaveCount(1, { timeout: 10_000 });
  await new Promise((r) => setTimeout(r, 800));
  const bar = await shell.locator('#perm-bar').boundingBox();
  const s = await stato();
  expect(s.y >= bar.y + bar.height, `la pagina parte da ${s.y}px e copre la domanda (${bar.y}–${bar.y + bar.height}px)`).toBe(true);
});
