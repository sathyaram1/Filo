// #514 (giro 7) — porte che i giri passati non avevano aperto.
//
// I giri 3, 4 e 5 hanno trovato lo stesso danno (l'Esc spegne lo schermo intero
// invece di chiudere prima il riquadro aperto sopra la pagina) da porte sempre
// nuove, una per giro. Qui si provano quelle rimaste:
//
//  · DUE riquadri aperti insieme su una pagina di Filo: il secondo Esc chiude
//    il riquadro di sotto e insieme spegne lo schermo intero;
//  · il menu a tendina delle Preferenze e il menu del tasto destro dell'elenco
//    scaricamenti (quest'ultimo il giro 5 non l'aveva potuto provare);
//  · un sito che, dentro il proprio gestore dell'Esc e senza nessun clic
//    prima, chiede lui lo schermo pieno: da lì l'Esc dell'utente rimette
//    DENTRO allo schermo intero invece di farne uscire.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';

async function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { cf: !!t.contentFullscreen, pageFs: !!t.pageFullscreen };
  });
}
const schermoIntero = async (app) => (await stato(app)).cf;

async function entra(app) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 700));
}

// Il tasto vero: passa dal before-input-event del main, com'è quando lo preme
// una persona.
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

async function nuovaSchedaInPrimoPiano(app) {
  const scadenza = Date.now() + 10_000;
  while (Date.now() < scadenza) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded').catch(() => {}); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('nuova scheda non trovata');
}

const IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// ── Due riquadri aperti insieme su una pagina di Filo ────────────────────────
// Chi cerca in Gestione lascia la barra di ricerca aperta, poi apre un feedback
// e clicca l'immagine allegata: sopra la pagina ci sono DUE cose, e ne serve un
// Esc per ciascuna. Nessuno dei due deve spegnere lo schermo intero, che
// l'utente non ha chiesto di lasciare.
test('gestione: immagine sopra la ricerca — il secondo Esc non deve buttare fuori dallo schermo intero', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await apriGestione(openTab);
  const ricercaAperta = () => page.evaluate(() => !document.getElementById('mgSearchBar').hidden);

  // Controprova, fuori dallo schermo intero: due Esc chiudono i due riquadri.
  await page.click('#mgSearchToggle');
  await page.evaluate(() => { try { document.activeElement.blur(); } catch (_) {} });
  await expect.poll(ricercaAperta).toBe(true);
  await page.evaluate((src) => window.__mgTest.openLightbox(src), IMG);
  await expect(page.locator('#mgLightbox')).toBeVisible();
  await esc(app);
  expect(await page.locator('#mgLightbox').isVisible(), 'fuori dallo schermo intero il primo Esc chiude l\'immagine').toBe(false);
  await esc(app);
  expect(await ricercaAperta(), 'fuori dallo schermo intero il secondo Esc chiude la ricerca').toBe(false);

  // Ora davvero: a schermo intero, gli stessi due riquadri.
  await entra(app);
  await page.click('#mgSearchToggle');
  await page.evaluate(() => { try { document.activeElement.blur(); } catch (_) {} });
  await expect.poll(ricercaAperta).toBe(true);
  await page.evaluate((src) => window.__mgTest.openLightbox(src), IMG);
  await expect(page.locator('#mgLightbox')).toBeVisible();
  await new Promise((r) => setTimeout(r, 400));

  await esc(app);
  expect(await page.locator('#mgLightbox').isVisible(), 'il primo Esc doveva chiudere l\'immagine').toBe(false);
  expect(await schermoIntero(app), 'il primo Esc non doveva togliere lo schermo intero').toBe(true);

  await esc(app);
  expect(await ricercaAperta(), 'il secondo Esc doveva chiudere la ricerca').toBe(false);
  expect(
    await schermoIntero(app),
    'il secondo Esc ha chiuso la ricerca E ha spento lo schermo intero: il riquadro di sotto vale quanto quello sopra',
  ).toBe(true);

  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});

// La stessa cosa sulla home, con due riquadri di famiglie diverse: l'immagine
// ingrandita e la domanda di conferma.
test('home: conferma sopra l\'immagine ingrandita — il secondo Esc non deve buttare fuori', async ({ app }) => {
  test.setTimeout(120_000);
  const page = await nuovaSchedaInPrimoPiano(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8000 });
  await page.evaluate(() => {
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([arr], 'img.png', { type: 'image/png' }));
    document.getElementById('inputForm')
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1, { timeout: 4000 });

  await entra(app);
  await page.locator('#imgPreviews .dash-img-preview img').first().click();
  await expect(page.locator('.dash-lightbox.open')).toBeVisible({ timeout: 4000 });
  await page.evaluate(() => {
    window.__esitoConferma = 'in corso';
    window.SN_CONFIRM_UI.confirm({ title: 'Sicuro?', text: 'Azione delicata' })
      .then((v) => { window.__esitoConferma = v; });
  });
  await new Promise((r) => setTimeout(r, 500));

  await esc(app);
  expect(await page.evaluate(() => window.__esitoConferma), 'il primo Esc doveva annullare la conferma').toBe(false);
  expect(await schermoIntero(app), 'il primo Esc non doveva togliere lo schermo intero').toBe(true);

  await esc(app);
  await expect(page.locator('.dash-lightbox.open')).toHaveCount(0);
  expect(
    await schermoIntero(app),
    'il secondo Esc ha chiuso l\'immagine E ha spento lo schermo intero',
  ).toBe(true);
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

// ── Il sito che si riprende lo schermo intero col tasto dell'utente ──────────
// Il gestore dell'Esc della pagina chiede lui lo schermo pieno. Non serve
// nessun clic prima: l'Esc stesso basta a farglielo ottenere. Da quel momento
// la modalità è "della pagina", Filo le lascia il tasto, e l'Esc dell'utente
// alterna — uno esce, il successivo rientra.
const paginaCheSiRiprende = `<!doctype html><html><body style="margin:0;height:1200px">
<p id="t">niente clic qui sopra</p>
<script>
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    try { document.documentElement.requestFullscreen(); } catch (_) {}
  }, true);
</script>
</body></html>`;

test('sito che chiede lui lo schermo pieno dentro l\'Esc: il tasto non deve mai far RIENTRARE', async ({ app, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, paginaCheSiRiprende);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  // Nessun clic, e ben oltre i cinque secondi dell'attivazione transitoria:
  // l'unico gesto che la pagina riceve è l'Esc dell'utente.
  await new Promise((r) => setTimeout(r, 6000));
  await entra(app);

  const traccia = [await schermoIntero(app)];
  for (let i = 0; i < 6; i++) {
    await esc(app);
    traccia.push(await schermoIntero(app));
  }
  const rientri = traccia.filter((v, i) => i > 0 && v && !traccia[i - 1]).length;
  expect(rientri, `l'Esc ha rimesso dentro allo schermo intero ${rientri} volte: ${JSON.stringify(traccia)}`).toBe(0);
  expect(await schermoIntero(app), `dopo sei Esc si è ancora a schermo intero: ${JSON.stringify(traccia)}`).toBe(false);
});

// Controprova dell'altro verso: con un CLIC — il gesto vero — lo schermo pieno
// il sito lo ottiene ancora, com'è giusto. A essere rifiutato è solo l'Esc.
test('controprova: col clic il sito prende ancora lo schermo pieno', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;height:1200px">
<p id="t">clic qui</p>
<script>
  document.addEventListener('click', function () {
    try { document.documentElement.requestFullscreen(); } catch (_) {}
  });
</script>
</body></html>`);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  expect(await schermoIntero(app)).toBe(false);
  await page.locator('#t').click();
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(true);
  expect((await stato(app)).pageFs, 'lo schermo pieno è della pagina').toBe(true);
});

// Controprova: la stessa pagina senza quella riga esce al primo Esc e resta
// fuori. È la riga, non il tasto mangiato, a fare la differenza.
test('controprova: la stessa pagina senza quella riga esce al primo Esc e resta fuori', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(
    openTab,
    paginaCheSiRiprende.replace('try { document.documentElement.requestFullscreen(); } catch (_) {}', ''),
  );
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await new Promise((r) => setTimeout(r, 1000));
  await entra(app);
  await esc(app);
  expect(await schermoIntero(app)).toBe(false);
  await esc(app);
  expect(await schermoIntero(app)).toBe(false);
});
