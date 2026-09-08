// #514 (giro 7) — porte che i giri passati non avevano aperto.
//
// I giri 3, 4 e 5 hanno trovato lo stesso danno (l'Esc spegne lo schermo intero
// invece di chiudere prima il riquadro che sta sopra la pagina) da porte sempre
// nuove. Qui si provano le porte rimaste: due riquadri aperti INSIEME su una
// pagina di Filo, il menu a tendina delle Preferenze, il menu del tasto destro
// dell'elenco scaricamenti (che il giro 5 non aveva potuto provare), e la
// faccia avversariale — un sito che prova ad azzerare il tetto delle
// rivendicazioni chiedendo lui lo schermo pieno, e una raffica di Esc premuti
// in fretta come li preme chi non sta uscendo.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';

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

// Il tasto vero: passa dal before-input-event del main.
async function esc(app, attesa = 900) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, attesa));
}

async function apriGestione(openTab) {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  return page;
}

const IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// ── Due riquadri aperti insieme su una pagina di Filo ────────────────────────
// Chi cerca in Gestione lascia la barra di ricerca aperta, poi apre un feedback
// e clicca l'immagine allegata. Adesso sopra la pagina ci sono DUE cose, e ne
// serve un Esc per ciascuna: il primo chiude l'immagine, il secondo la ricerca.
// Nessuno dei due deve spegnere lo schermo intero, che l'utente non ha chiesto
// di lasciare.
test('gestione: immagine sopra la ricerca — nessuno dei due Esc butta fuori dallo schermo intero', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await apriGestione(openTab);

  // Controprova, fuori dallo schermo intero: due Esc chiudono i due riquadri.
  await page.click('#mgSearchToggle');
  await page.evaluate(() => { try { document.activeElement.blur(); } catch (_) {} });
  await expect.poll(() => page.evaluate(() => !document.getElementById('mgSearchBar').hidden)).toBe(true);
  await page.evaluate((src) => window.__mgTest.openLightbox(src), IMG);
  await expect(page.locator('#mgLightbox')).toBeVisible();
  await esc(app);
  expect(await page.locator('#mgLightbox').isVisible(), 'fuori dallo schermo intero il primo Esc chiude l\'immagine').toBe(false);
  await esc(app);
  expect(
    await page.evaluate(() => !document.getElementById('mgSearchBar').hidden),
    'fuori dallo schermo intero il secondo Esc chiude la ricerca',
  ).toBe(false);

  // Ora davvero: a schermo intero, gli stessi due riquadri.
  await entra(app);
  await page.click('#mgSearchToggle');
  await page.evaluate(() => { try { document.activeElement.blur(); } catch (_) {} });
  await expect.poll(() => page.evaluate(() => !document.getElementById('mgSearchBar').hidden)).toBe(true);
  await page.evaluate((src) => window.__mgTest.openLightbox(src), IMG);
  await expect(page.locator('#mgLightbox')).toBeVisible();
  await new Promise((r) => setTimeout(r, 400));

  await esc(app);
  expect(await page.locator('#mgLightbox').isVisible(), 'il primo Esc doveva chiudere l\'immagine').toBe(false);
  expect(await schermoIntero(app), 'il primo Esc non doveva togliere lo schermo intero').toBe(true);

  await esc(app);
  expect(
    await page.evaluate(() => !document.getElementById('mgSearchBar').hidden),
    'il secondo Esc doveva chiudere la ricerca',
  ).toBe(false);
  expect(
    await schermoIntero(app),
    'il secondo Esc ha chiuso la ricerca E ha spento lo schermo intero: il riquadro sotto vale quanto quello sopra',
  ).toBe(true);

  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});

// ── Il menu a tendina delle Preferenze ───────────────────────────────────────
test('preferenze: il menu a tendina si chiude col primo Esc, lo schermo intero resta', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#theme', { timeout: 15000 });
  const bottone = page.locator('.sn-select-wrap:has(#theme) .sn-select-button');
  await expect(bottone).toBeVisible({ timeout: 10000 });
  const aperto = () => page.evaluate(() => {
    const w = document.querySelector('.sn-select-wrap:has(#theme)');
    return !!w && !w.querySelector('.sn-select-pop').hidden;
  });

  // Controprova fuori dallo schermo intero.
  await bottone.click();
  await expect.poll(aperto, { timeout: 5000 }).toBe(true);
  await esc(app);
  expect(await aperto(), 'fuori dallo schermo intero Esc chiude il menu a tendina').toBe(false);

  await entra(app);
  await bottone.click();
  await expect.poll(aperto, { timeout: 5000 }).toBe(true);
  await esc(app);
  expect(await aperto(), 'il menu a tendina doveva chiudersi col primo Esc').toBe(false);
  expect(await schermoIntero(app), 'il primo Esc non doveva togliere lo schermo intero').toBe(true);
  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});

// ── Il menu del tasto destro dell'elenco scaricamenti ────────────────────────
const FILE = Buffer.from('%PDF-1.4\n% finto pdf di prova\n' + 'x'.repeat(4096));

test('scaricamenti: il menu del tasto destro si chiude col primo Esc, lo schermo intero resta', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const fileServer = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': FILE.length,
      'Content-Disposition': 'attachment; filename="report.pdf"',
    });
    res.end(FILE);
  });
  await new Promise((r) => fileServer.listen(0, '127.0.0.1', r));
  const fileUrl = `http://127.0.0.1:${fileServer.address().port}/report.pdf`;
  const sito = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
    <a id="dl" href="${fileUrl}">Scarica il report</a></body></html>`);
  await sito.locator('#dl').click();
  const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
  await expect.poll(() => (existsSync(dir) ? readdirSync(dir) : []), { timeout: 20000 }).toContain('report.pdf');

  const page = await openTab('filo://downloads/downloads.html');
  const riga = page.locator('.dl-row, .dl-item, li, tr').filter({ hasText: 'report.pdf' }).first();
  await expect(riga).toBeVisible({ timeout: 15000 });
  const aperto = () => page.evaluate(() => !!document.querySelector('.sn-select-pop, .dl-ctxmenu'));

  await riga.click({ button: 'right' });
  await expect.poll(aperto, { timeout: 5000 }).toBe(true);
  await esc(app);
  expect(await aperto(), 'fuori dallo schermo intero Esc chiude il menu').toBe(false);

  await entra(app);
  await riga.click({ button: 'right' });
  await expect.poll(aperto, { timeout: 5000 }).toBe(true);
  await esc(app);
  expect(await aperto(), 'il menu doveva chiudersi col primo Esc').toBe(false);
  expect(await schermoIntero(app), 'il primo Esc non doveva togliere lo schermo intero').toBe(true);
  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
  fileServer.close();
});

// ── Sito che prova ad azzerare il tetto chiedendo lui lo schermo pieno ───────
// Il tetto delle rivendicazioni sta nel main e riparte da zero quando la
// modalità cambia. Una pagina che riesce a far ripassare Filo da lì a ogni Esc
// riporterebbe il conto a zero per sempre.
const paginaCheChiedeSchermoPieno = `<!doctype html><html><body style="margin:0;height:1200px">
<p id="t">parola dentro una frase</p>
<script>
  var rubato = null;
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var rm = muts[i].removedNodes;
      for (var j = 0; j < rm.length; j++) {
        var n = rm[j];
        if (n.nodeType === 1 && n.getAttribute && n.getAttribute('data-sn-ui') !== null) {
          rubato = n; window.__rubato = true;
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  function riattacca() {
    if (!rubato || rubato.isConnected) return;
    try {
      rubato.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px';
      document.documentElement.appendChild(rubato);
    } catch (_) {}
  }
  window.__riattacca = riattacca;
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    // Prova a far cambiare modalità a Filo: se il permesso arriva, il conto
    // delle rivendicazioni riparte da zero e l'uscita non arriva mai.
    try { document.documentElement.requestFullscreen(); } catch (_) {}
    try { document.body.requestFullscreen(); } catch (_) {}
    setTimeout(function () {
      if (rubato && rubato.isConnected) { try { rubato.remove(); } catch (_) {} }
      setTimeout(riattacca, 60);
    }, 0);
  }, true);
</script>
</body></html>`;

async function preparaLadra(page) {
  await page.locator('#t').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 8000 });
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => !!window.__rubato), { timeout: 8000 }).toBe(true);
  await page.evaluate(() => window.__riattacca());
  await new Promise((r) => setTimeout(r, 300));
}

test('sito che chiede lui lo schermo pieno a ogni Esc: il tetto regge e si esce', async ({ app, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, paginaCheChiedeSchermoPieno);
  await preparaLadra(page);
  await entra(app);
  const esiti = [];
  for (let i = 0; i < 8; i++) {
    esiti.push(await schermoIntero(app));
    if (!esiti[esiti.length - 1]) break;
    await esc(app);
  }
  expect(await schermoIntero(app), `Esc ripetuto e non si esce mai: ${JSON.stringify(esiti)}`).toBe(false);
});

// ── Raffica di Esc, come li preme chi vuole uscire e non ci riesce ───────────
test('sito ladro: una raffica di Esc in fretta esce lo stesso', async ({ app, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, paginaCheChiedeSchermoPieno);
  await preparaLadra(page);
  await entra(app);
  for (let i = 0; i < 8; i++) await esc(app, 80);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});
