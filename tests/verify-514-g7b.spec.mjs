// #514 (giro 7) — l'altra faccia dello stesso difetto: fuori dallo schermo
// intero, l'Esc dell'utente basta al sito per prendersi tutto lo schermo. Non
// serve nessun clic: il tasto stesso vale come gesto, e Filo passa in schermo
// intero senza che nessuno l'abbia chiesto.
import { test, expect } from './fixtures/electron.mjs';

async function schermoIntero(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return !!t.contentFullscreen;
  });
}
async function esc(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, 900));
}

const PAGINA = `<!doctype html><html><body style="margin:0;height:1200px">
<p id="t">niente clic qui sopra</p>
<script>
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    try { document.documentElement.requestFullscreen(); } catch (_) {}
  }, true);
</script>
</body></html>`;

test('fuori dallo schermo intero, un Esc non deve regalare lo schermo al sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  // Nessun clic sulla pagina, e ben oltre i cinque secondi dell'attivazione
  // transitoria: l'unico gesto che riceve è l'Esc.
  await new Promise((r) => setTimeout(r, 6000));
  expect(await schermoIntero(app)).toBe(false);
  await esc(app);
  expect(
    await schermoIntero(app),
    'un solo Esc e il sito si è preso tutto lo schermo, barra di Filo compresa',
  ).toBe(false);
});
