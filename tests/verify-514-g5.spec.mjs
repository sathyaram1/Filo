// #514 (giro 5) — a schermo intero l'Esc deve chiudere PRIMA il riquadro che sta
// sopra la pagina e solo dopo uscire dalla modalità. La regola vale per i
// riquadri disegnati dai content script; i riquadri disegnati dalle PAGINE DI
// FILO (menu di ordinamento e barra di ricerca della gestione, menu del tasto
// destro sul titolo nell'editor, menu del tasto destro nella cronologia) vengono
// ancora scavalcati: il primo Esc li chiude E spegne lo schermo intero.
//
// Ogni prova ha la sua controprova fuori dallo schermo intero: lì lo stesso Esc
// chiude il riquadro, quindi il tasto è davvero suo.
import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html><head><title>Sito Archiviato</title></head>
<body style="margin:0"><div style="height:600px">contenuto</div></body></html>`;

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
// Il tasto vero: passa dal before-input-event del main, com'è quando lo preme
// una persona.
async function esc(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, 900));
}

async function apriGestione(openTab) {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  return page;
}

test('gestione: il menu di ordinamento si chiude col primo Esc, lo schermo intero resta', async ({ app, openTab }) => {
  const page = await apriGestione(openTab);
  const menuAperto = () => page.evaluate(() => !!document.querySelector('.mg-ctxmenu'));

  // Controprova: fuori dallo schermo intero quell'Esc chiude il menu.
  await page.click('#mgSortBtn');
  await expect.poll(menuAperto, { timeout: 5000 }).toBe(true);
  await esc(app);
  expect(await menuAperto(), 'fuori dallo schermo intero Esc deve chiudere il menu').toBe(false);

  await page.click('#mgSortBtn');
  await expect.poll(menuAperto, { timeout: 5000 }).toBe(true);
  await entra(app);
  await esc(app);
  expect(await menuAperto(), 'il menu doveva chiudersi col primo Esc').toBe(false);
  expect(await schermoIntero(app), 'il primo Esc non doveva togliere lo schermo intero').toBe(true);

  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});

test('gestione: la barra di ricerca si chiude col primo Esc, lo schermo intero resta', async ({ app, openTab }) => {
  const page = await apriGestione(openTab);
  const ricercaAperta = () => page.evaluate(() => !document.getElementById('mgSearchBar').hidden);
  // Il fuoco fuori dal campo è il caso di chi ha appena cliccato un risultato.
  const sfuoca = () => page.evaluate(() => { try { document.activeElement.blur(); } catch (_) {} });

  await page.click('#mgSearchToggle');
  await expect.poll(ricercaAperta, { timeout: 5000 }).toBe(true);
  await sfuoca();
  await esc(app);
  expect(await ricercaAperta(), 'fuori dallo schermo intero Esc deve chiudere la ricerca').toBe(false);

  await page.click('#mgSearchToggle');
  await expect.poll(ricercaAperta, { timeout: 5000 }).toBe(true);
  await sfuoca();
  await entra(app);
  await esc(app);
  expect(await ricercaAperta(), 'la ricerca doveva chiudersi col primo Esc').toBe(false);
  expect(await schermoIntero(app), 'il primo Esc non doveva togliere lo schermo intero').toBe(true);

  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});

test('editor: il menu del tasto destro sul titolo si chiude col primo Esc, lo schermo intero resta', async ({ app, openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#docbar', { timeout: 15000 });
  const menuAperto = () => page.evaluate(() => !!document.querySelector('.ed-title-ctxmenu'));

  await page.locator('#docbar').click({ button: 'right' });
  await expect.poll(menuAperto, { timeout: 5000 }).toBe(true);
  await esc(app);
  expect(await menuAperto(), 'fuori dallo schermo intero Esc deve chiudere il menu').toBe(false);

  await page.locator('#docbar').click({ button: 'right' });
  await expect.poll(menuAperto, { timeout: 5000 }).toBe(true);
  await entra(app);
  await esc(app);
  expect(await menuAperto(), 'il menu doveva chiudersi col primo Esc').toBe(false);
  expect(await schermoIntero(app), 'il primo Esc non doveva togliere lo schermo intero').toBe(true);

  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});

test('cronologia: il menu del tasto destro si chiude col primo Esc, lo schermo intero resta', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await testServer.openReady(openTab, PAGE);
  const tabId = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate(async (id) => window.filoShell.tabs.close(id), tabId);

  const archive = await openTab('filo://archive/archive.html');
  const row = archive.locator('.arc-tab', { hasText: 'Sito Archiviato' });
  await expect(row).toBeVisible({ timeout: 10000 });
  const menuAperto = () => archive.evaluate(() => !!document.querySelector('.arc-ctxmenu'));

  await row.click({ button: 'right' });
  await expect.poll(menuAperto, { timeout: 5000 }).toBe(true);
  await esc(app);
  expect(await menuAperto(), 'fuori dallo schermo intero Esc deve chiudere il menu').toBe(false);

  await row.click({ button: 'right' });
  await expect.poll(menuAperto, { timeout: 5000 }).toBe(true);
  await entra(app);
  await esc(app);
  expect(await menuAperto(), 'il menu doveva chiudersi col primo Esc').toBe(false);
  expect(await schermoIntero(app), 'il primo Esc non doveva togliere lo schermo intero').toBe(true);

  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});

// ── Un sito ostile può negare l'uscita ────────────────────────────────────────
// Il marchio che dice «questo pezzo l'ha disegnato Filo» è un attributo del
// documento, e il documento è del sito: una pagina qualunque può metterselo
// addosso e toglierselo a ogni Esc, facendo credere che il tasto sia servito a
// chiudere un riquadro di Filo. Da lì lo schermo intero non si spegne più.
function paginaOstile(conEsca) {
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

test('controprova: un sito che si mangia l\'Esc, ma senza esca, esce al primo colpo', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await testServer.openReady(openTab, paginaOstile(false));
  await entra(app);
  await esc(app);
  expect(await schermoIntero(app), 'un sito che mangia il tasto non deve poter negare l\'uscita').toBe(false);
});

test('sito ostile: dieci Esc e si è ancora dentro allo schermo intero', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, paginaOstile(true));
  await entra(app);
  const esiti = [];
  for (let i = 0; i < 10; i++) {
    await esc(app);
    esiti.push(await schermoIntero(app));
  }
  // La via d'uscita che resta all'utente: la voce del menu del tasto destro.
  await page.locator('#t').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 8000 });
  let voce = page.locator('[data-sn-icon-id="fullscreen"]');
  if (await voce.count() === 0) {
    await page.locator('.sn-menu-row-overflow').first().click();
    await expect(voce.first()).toBeVisible({ timeout: 8000 });
  }
  console.log('via d\'uscita nel menu:', await voce.first().getAttribute('aria-label'));

  expect(esiti.some((v) => v === false), `dieci Esc e non si esce mai: ${JSON.stringify(esiti)}`).toBe(true);
});
