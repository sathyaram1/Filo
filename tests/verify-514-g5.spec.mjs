// #514 (giro 5) — a schermo intero l'Esc chiude PRIMA il riquadro che sta sopra
// la pagina e solo dopo esce dalla modalità, e questo vale anche per i riquadri
// disegnati dalle PAGINE di Filo, che non passano dal marchio SN_FILO_UI e non
// dichiarano il tasto in nessun modo: il menu di ordinamento e la barra di
// ricerca della gestione, il menu del tasto destro sul titolo nell'editor, il
// menu del tasto destro nella cronologia.
//
// In coda, la parte avversariale: un sito non deve poter fingere di essere un
// riquadro di Filo per tenere l'utente dentro allo schermo intero.
//
// L'ordine dei passi conta. Si entra a schermo intero PRIMA di aprire il
// riquadro, come fa una persona: entrare ridimensiona la pagina, e un menu
// aperto prima si chiuderebbe da solo per il ridimensionamento, non per l'Esc.
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

// Il giro completo su un riquadro qualunque: fuori dallo schermo intero l'Esc lo
// chiude (controprova: il tasto è davvero suo), dentro lo chiude senza spegnere
// la modalità, e l'Esc dopo esce.
async function provaRiquadro({ app, apri, aperto, nome }) {
  await apri();
  await expect.poll(aperto, { timeout: 5000 }).toBe(true);
  await esc(app);
  expect(await aperto(), `fuori dallo schermo intero Esc deve chiudere ${nome}`).toBe(false);

  await entra(app);
  await apri();
  await expect.poll(aperto, { timeout: 5000 }).toBe(true);
  await esc(app);
  expect(await aperto(), `${nome}: doveva chiudersi col primo Esc`).toBe(false);
  expect(await schermoIntero(app), 'il primo Esc non doveva togliere lo schermo intero').toBe(true);

  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
}

async function apriGestione(openTab) {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  return page;
}

test('gestione: il menu di ordinamento si chiude col primo Esc, lo schermo intero resta', async ({ app, openTab }) => {
  const page = await apriGestione(openTab);
  await provaRiquadro({
    app,
    nome: 'il menu di ordinamento',
    apri: () => page.click('#mgSortBtn'),
    aperto: () => page.evaluate(() => !!document.querySelector('.mg-ctxmenu')),
  });
});

test('gestione: la barra di ricerca si chiude col primo Esc, lo schermo intero resta', async ({ app, openTab }) => {
  const page = await apriGestione(openTab);
  await provaRiquadro({
    app,
    nome: 'la barra di ricerca',
    // Il fuoco fuori dal campo è il caso di chi ha appena cliccato un risultato.
    apri: async () => {
      await page.click('#mgSearchToggle');
      await page.evaluate(() => { try { document.activeElement.blur(); } catch (_) {} });
    },
    aperto: () => page.evaluate(() => !document.getElementById('mgSearchBar').hidden),
  });
});

test('editor: il menu del tasto destro sul titolo si chiude col primo Esc, lo schermo intero resta', async ({ app, openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#docbar', { timeout: 15000 });
  await provaRiquadro({
    app,
    nome: 'il menu del titolo',
    apri: () => page.locator('#docbar').click({ button: 'right' }),
    aperto: () => page.evaluate(() => !!document.querySelector('.ed-title-ctxmenu')),
  });
});

test('cronologia: il menu del tasto destro si chiude col primo Esc, lo schermo intero resta', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await testServer.openReady(openTab, PAGE);
  const tabId = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate(async (id) => window.filoShell.tabs.close(id), tabId);

  const archive = await openTab('filo://archive/archive.html');
  const row = archive.locator('.arc-tab', { hasText: 'Sito Archiviato' });
  await expect(row).toBeVisible({ timeout: 10000 });
  await provaRiquadro({
    app,
    nome: 'il menu della scheda archiviata',
    apri: () => row.click({ button: 'right' }),
    aperto: () => archive.evaluate(() => !!document.querySelector('.arc-ctxmenu')),
  });
});

// ── Un sito non può fingersi un riquadro di Filo ──────────────────────────────
// Il marchio che dice «questo pezzo l'ha disegnato Filo» è un attributo del
// documento, e il documento è del sito: se a decidere fosse l'attributo, una
// pagina qualunque potrebbe mettersorlo addosso e toglierselo a ogni Esc,
// facendo credere che il tasto sia servito a chiudere un riquadro di Filo. Da lì
// lo schermo intero non si spegneva più.
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

test('controprova: un sito che si mangia l\'Esc, senza esca, esce al primo colpo', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await testServer.openReady(openTab, paginaOstile(false));
  await entra(app);
  await esc(app);
  expect(await schermoIntero(app), 'un sito che mangia il tasto non deve poter negare l\'uscita').toBe(false);
});

test('sito ostile: il travestimento da riquadro di Filo non tiene dentro allo schermo intero', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  await testServer.openReady(openTab, paginaOstile(true));
  await entra(app);
  const esiti = [];
  for (let i = 0; i < 4; i++) {
    esiti.push(await schermoIntero(app));
    if (!esiti[esiti.length - 1]) break;
    await esc(app);
  }
  expect(await schermoIntero(app), `Esc ripetuto e non si esce mai: ${JSON.stringify(esiti)}`).toBe(false);
});
