// Sonda: la richiesta di schermo pieno di una pagina passa dal gestore dei
// permessi della sessione? E in che ordine arrivano gli eventi?
import { test } from './fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><body style="margin:0;height:1200px">
<p id="t">clic qui</p>
<script>
  document.addEventListener('click', function () {
    try { document.documentElement.requestFullscreen(); } catch (_) {}
  });
</script>
</body></html>`;

test('sonda: gestore permessi e ordine eventi schermo pieno', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const t = win._filoTabs;
    globalThis.__ordine = [];
    globalThis.__permessi = [];
    win.on('enter-full-screen', () => globalThis.__ordine.push('win:enter'));
    const tab = t.tabs.find((x) => x.id === t.activeId);
    const wc = tab.view.webContents;
    wc.on('enter-html-full-screen', () => globalThis.__ordine.push('wc:enter'));
    wc.session.setPermissionRequestHandler((_wc, permission, callback) => {
      globalThis.__permessi.push(permission);
      globalThis.__ordine.push('permesso:' + permission);
      callback(permission !== 'fullscreen');
    });
  });
  await page.locator('#t').click();
  await new Promise((r) => setTimeout(r, 1500));
  const stato = await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { cf: !!t.contentFullscreen, ordine: globalThis.__ordine, permessi: globalThis.__permessi };
  });
  console.log('SONDA →', JSON.stringify(stato));
});
