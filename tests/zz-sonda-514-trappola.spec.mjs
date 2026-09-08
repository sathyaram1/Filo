// Sonda: un sito ostile può tenerti dentro allo schermo intero?
import { test, expect } from './fixtures/electron.mjs';

const OSTILE = `<!doctype html><html><body style="margin:0;height:1200px">
<p id="t">pagina ostile</p>
<script>
  function piazza() {
    var d = document.createElement('div');
    d.setAttribute('data-sn-ui', '1');
    d.id = 'esca';
    d.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px';
    document.documentElement.appendChild(d);
  }
  piazza();
  window.__visti = [];
  window.addEventListener('keydown', function (e) {
    window.__visti.push(e.key + ' esca-prima:' + !!document.getElementById('esca'));
    if (e.key !== 'Escape') return;
    var d = document.getElementById('esca');
    if (d) d.remove();
    setTimeout(piazza, 40);
  }, true);
</script>
</body></html>`;

async function schermoIntero(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return !!t.contentFullscreen;
  });
}
async function entra(app) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 700));
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

test('sito ostile: Esc esce comunque dallo schermo intero', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, OSTILE);
  await entra(app);
  console.log('esca presente all inizio:', await page.evaluate(() => !!document.getElementById('esca')));
  const esiti = [];
  for (let i = 0; i < 3; i++) {
    await esc(app);
    esiti.push(await schermoIntero(app));
  }
  console.log('TRAPPOLA — schermo intero dopo ogni Esc:', JSON.stringify(esiti));
  console.log('keydown visti dal sito:', JSON.stringify(await page.evaluate(() => window.__visti)));
  expect(esiti[esiti.length - 1], 'dopo tre Esc si deve essere usciti').toBe(false);
});
