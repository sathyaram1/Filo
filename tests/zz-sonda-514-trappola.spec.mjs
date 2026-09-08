// Sonda: un sito ostile può tenerti dentro allo schermo intero?
import { test, expect } from './fixtures/electron.mjs';

function pagina(conEsca) {
  return `<!doctype html><html><body style="margin:0;height:1200px">
<p id="t">pagina</p>
<script>
  var CON_ESCA = ${conEsca ? 'true' : 'false'};
  function piazza() {
    if (!CON_ESCA) return;
    var d = document.createElement('div');
    d.setAttribute('data-sn-ui', '1');
    d.id = 'esca';
    d.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px';
    document.documentElement.appendChild(d);
  }
  piazza();
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    setTimeout(function () {
      var d = document.getElementById('esca');
      if (d) d.remove();
      setTimeout(piazza, 40);
    }, 0);
  }, true);
</script>
</body></html>`;
}

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

test('controprova: un sito che si mangia l Esc, senza esca, esce al primo colpo', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await testServer.openReady(openTab, pagina(false));
  await entra(app);
  await esc(app);
  console.log('SENZA ESCA — schermo intero dopo 1 Esc:', await schermoIntero(app));
  expect(await schermoIntero(app)).toBe(false);
});

test('sito ostile: dieci Esc e resti dentro', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, pagina(true));
  await entra(app);
  const esiti = [];
  for (let i = 0; i < 10; i++) {
    await esc(app);
    esiti.push(await schermoIntero(app));
  }
  console.log('CON ESCA — schermo intero dopo ogni Esc:', JSON.stringify(esiti));
  // La via d'uscita che resta: il menu del tasto destro.
  await page.locator('#t').click({ button: 'right' }).catch((e) => console.log('tasto destro:', e.message));
  await page.waitForTimeout(600);
  const voce = await page.evaluate(() => Array.from(document.querySelectorAll('.sn-menu-item, .sn-menu *')).map((n) => (n.textContent || '').trim()).filter((t) => /schermo intero/i.test(t))[0] || null);
  console.log('voce del menu disponibile:', JSON.stringify(voce));
  expect(esiti[esiti.length - 1], 'dopo dieci Esc si deve essere usciti').toBe(false);
});
