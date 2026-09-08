// Diagnostica 2 (giro 7): un sito che chiede lo schermo pieno DENTRO il gestore
// dell'Esc, senza nessun clic prima. Se ci riesce, l'Esc dell'utente rimette
// dentro allo schermo intero invece di farne uscire.
import { test, expect } from './fixtures/electron.mjs';

async function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { cf: !!t.contentFullscreen, pageFs: !!t.pageFullscreen, riv: t._escRivendicazioni };
  });
}
async function entra(app) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 700));
}
async function esc(app, attesa = 900) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, attesa));
}

const PAGINA = `<!doctype html><html><body style="margin:0;height:1200px">
<p id="t">niente clic qui sopra</p>
<script>
  window.__tentativi = 0; window.__riusciti = 0;
  document.addEventListener('fullscreenchange', function () {
    if (document.fullscreenElement) window.__riusciti++;
  });
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    window.__tentativi++;
    try { document.documentElement.requestFullscreen(); } catch (_) {}
  }, true);
</script>
</body></html>`;

test('diag2: senza nessun clic, il sito rientra a schermo pieno premendo Esc?', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  // Nessun clic, e ben oltre i 5 secondi di attivazione transitoria.
  await new Promise((r) => setTimeout(r, 8000));
  await entra(app);
  const traccia = [];
  for (let i = 0; i < 6; i++) {
    traccia.push(await stato(app));
    await esc(app);
  }
  traccia.push(await stato(app));
  const conti = await page.evaluate(() => ({ t: window.__tentativi, r: window.__riusciti })).catch(() => null);
  console.log('DIAG2 traccia →', JSON.stringify(traccia));
  console.log('DIAG2 conti →', JSON.stringify(conti));
  expect(true).toBe(true);
});
