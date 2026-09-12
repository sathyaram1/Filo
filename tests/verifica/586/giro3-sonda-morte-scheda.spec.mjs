// Verifica #586, giro 3 — SONDA (non è una guardia): cosa succede alla scheda
// quando una pagina chiede l'audio del computer alla vecchia maniera.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0"><p id="p">viva</p>
<script>
  window.__audioDesktop = () => navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'desktop' } },
  }).then(
    (s) => s.getTracks().map((t) => ({ kind: t.kind, label: t.label })),
    (e) => 'rifiutato:' + ((e && e.name) || 'errore'),
  );
</script></body></html>`;

test('sonda: la scheda dopo la richiesta di audio del computer', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);

  const prima = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const tm = w._filoTabs;
    return (tm.tabs || []).map((t) => ({
      id: t.id,
      url: t.view && t.view.webContents && !t.view.webContents.isDestroyed() ? t.view.webContents.getURL() : '(distrutta)',
      crashed: t.view && t.view.webContents && !t.view.webContents.isDestroyed() ? t.view.webContents.isCrashed() : null,
      titolo: t.title,
    }));
  });
  console.log('[586 g3] schede PRIMA:', JSON.stringify(prima));

  page.evaluate(() => window.__audioDesktop()).catch(() => {});
  await shell.waitForTimeout(4000);

  const dopo = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const tm = w._filoTabs;
    return (tm.tabs || []).map((t) => ({
      id: t.id,
      url: t.view && t.view.webContents && !t.view.webContents.isDestroyed() ? t.view.webContents.getURL() : '(distrutta)',
      crashed: t.view && t.view.webContents && !t.view.webContents.isDestroyed() ? t.view.webContents.isCrashed() : null,
      titolo: t.title,
    }));
  });
  console.log('[586 g3] schede DOPO:', JSON.stringify(dopo));
  console.log('[586 g3] pastiglie:', await shell.locator('.perm-chip').count());
  await shell.screenshot({ path: 'tests/.shots/586-giro3-dopo-audio-desktop.png' });
  expect(true).toBe(true);
});
