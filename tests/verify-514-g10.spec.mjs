// #514 (giro 10) — la porta rimasta: lo schermo pieno che si è preso il SITO.
//
// Nove giri hanno chiuso lo stesso danno — a schermo intero l'Esc porta via la
// modalità invece di chiudere prima il riquadro che sta sopra la pagina — da
// porte sempre nuove, ma sempre sulla modalità di FILO. Qui si prova l'altra
// metà, ed è quella che l'utente incontra più spesso: il pulsante «schermo
// intero» del lettore video di un sito. Sopra quella pagina Filo apre gli
// stessi riquadri (il menu del tasto destro, il QR, la risposta, il box di
// segnalazione), e lì l'Esc deve valere uguale.
//
// La causa è una sola e si vede da fuori: quando lo schermo pieno è del sito,
// l'Esc non arriva mai al documento (la traccia dei tasti della pagina resta
// vuota), quindi nessun riquadro di Filo può reagire. Chi ne aveva uno aperto
// perde la modalità e si ritrova il riquadro ancora lì.

import { test, expect } from './fixtures/electron.mjs';

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
async function esc(app, attesa = 1200) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, attesa));
}

// Un finto lettore video: il pulsante chiede lo schermo pieno, come fa quello
// di un sito qualunque. È il gesto vero (un clic), quindi il permesso c'è.
const LETTORE = `<!doctype html><html><body style="margin:0;height:1200px">
<h1 id="t">un sito con un video</h1>
<button id="fs" style="font-size:20px">schermo intero</button>
<script>
  window.__tasti = [];
  window.addEventListener('keydown', function (e) { window.__tasti.push(e.key); }, true);
  document.getElementById('fs').addEventListener('click', function () {
    try { document.documentElement.requestFullscreen(); } catch (_) {}
  });
</script>
</body></html>`;

const menuAperto = (page) => page.evaluate(() => !!document.querySelector('.sn-menu'));
const qrAperto = (page) => page.evaluate(() => !!document.querySelector('.sn-qr-overlay'));

async function pienoDelSito(app, page) {
  await page.locator('#fs').click();
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(true);
  expect((await stato(app)).pageFs, 'lo schermo pieno è della pagina').toBe(true);
}

async function apriMenu(page) {
  await page.locator('#t').click({ button: 'right' });
  await expect.poll(() => menuAperto(page), { timeout: 8000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 400));
}

async function voceSchermoIntero(page) {
  const voce = page.locator('[data-sn-icon-id="fullscreen"]');
  if (await voce.count() === 0) await page.locator('.sn-menu-row-overflow').first().click();
  await expect(voce.first()).toBeVisible({ timeout: 8000 });
  return voce.first();
}

// ── 1. Il menu del tasto destro sopra lo schermo pieno del sito ──────────────
test('sito a schermo pieno col suo pulsante: il primo Esc deve chiudere il menu, non la modalità', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, LETTORE);
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  // Controprova, fuori da qualunque schermo pieno: l'Esc chiude solo il menu.
  await apriMenu(page);
  await esc(app);
  expect(await menuAperto(page), 'fuori dallo schermo pieno l\'Esc chiude il menu').toBe(false);

  await pienoDelSito(app, page);
  await apriMenu(page);
  await page.evaluate(() => { window.__tasti = []; });

  await esc(app);
  expect(
    await page.evaluate(() => window.__tasti.slice()),
    'il tasto deve arrivare al documento: è lì che si decide di chi era',
  ).toEqual(['Escape']);
  expect(await menuAperto(page), 'il primo Esc doveva chiudere il menu').toBe(false);
  expect(
    await schermoIntero(app),
    'il primo Esc ha spento lo schermo pieno e ha lasciato il menu aperto sopra la pagina',
  ).toBe(true);

  // E il tasto dopo esce, che è la cosa che questa segnalazione chiedeva.
  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});

// ── 2. Il QR code sopra lo schermo pieno del sito ────────────────────────────
test('sito a schermo pieno col suo pulsante: il primo Esc deve chiudere il QR, non la modalità', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, LETTORE);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await pienoDelSito(app, page);

  await apriMenu(page);
  const qr = page.locator('[data-sn-icon-id="qrCode"]');
  if (await qr.count() === 0) await page.locator('.sn-menu-row-overflow').first().click();
  await qr.first().click();
  await expect.poll(() => qrAperto(page), { timeout: 8000 }).toBe(true);

  await esc(app);
  expect(await qrAperto(page), 'il primo Esc doveva chiudere il QR').toBe(false);
  expect(
    await schermoIntero(app),
    'il primo Esc ha spento lo schermo pieno e ha lasciato il QR sullo schermo',
  ).toBe(true);
});

// ── 3. La voce del menu non deve promettere il contrario di quello che fa ────
// Lo schermo pieno del sito finisce per una strada che non è l'Esc (il pulsante
// del lettore, un comando della pagina) mentre il menu è sotto gli occhi: la
// voce va ridisegnata sul posto, o «Esci da schermo intero» su uno schermo che
// intero non è più ci rimette dentro con un clic.
test('sito a schermo pieno col suo pulsante: la voce del menu non deve mentire quando la modalità finisce da un\'altra strada', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, LETTORE);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await pienoDelSito(app, page);
  await apriMenu(page);
  const voce = await voceSchermoIntero(page);
  expect(await voce.getAttribute('aria-label')).toBe('Esci da schermo intero');

  await page.evaluate(() => { try { document.exitFullscreen(); } catch (_) {} });
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
  expect(await menuAperto(page), 'il menu è ancora aperto').toBe(true);
  await expect
    .poll(() => voce.getAttribute('aria-label'), { timeout: 5000 })
    .toBe('Schermo intero');
});

// ── 3bis. Il riquadro dentro un altro riquadro, sopra lo schermo pieno ───────
// La famiglia del giro 8, ma sulla modalità del sito: a chiudersi è un pezzo
// disegnato DENTRO un riquadro che resta dov'è.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test('sito a schermo pieno col suo pulsante: l\'immagine ingrandita del box di segnalazione', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, LETTORE);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await pienoDelSito(app, page);

  await apriMenu(page);
  const voce = page.locator('.sn-menu .sn-menu-item').filter({ hasText: 'Invia feedback' }).first();
  await expect(voce).toBeVisible({ timeout: 8000 });
  await voce.click();
  await expect(page.locator('.sn-fb-modal')).toBeVisible({ timeout: 8000 });
  await page.locator('.sn-fb-file').setInputFiles([
    { name: 'schermata.png', mimeType: 'image/png', buffer: PNG_1x1 },
  ]);
  await expect(page.locator('.sn-fb-thumb img')).toHaveCount(1, { timeout: 8000 });
  await page.locator('.sn-fb-thumb img').first().click();
  await expect(page.locator('.sn-fb-lightbox')).toHaveCount(1, { timeout: 8000 });

  await esc(app);
  expect(await page.locator('.sn-fb-lightbox').count(), 'il primo Esc doveva chiudere l\'immagine').toBe(0);
  expect(await page.locator('.sn-fb-modal').count(), 'il box di segnalazione resta aperto').toBe(1);
  expect(
    await schermoIntero(app),
    'il primo Esc ha chiuso l\'immagine e si è portato via lo schermo pieno',
  ).toBe(true);
});

// ── 4. Controprova: senza niente aperto sopra, un Esc basta e avanza ─────────
test('controprova: schermo pieno del sito senza riquadri aperti — un Esc esce', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, LETTORE);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await pienoDelSito(app, page);
  await esc(app);
  expect(await schermoIntero(app)).toBe(false);
});

// ── 5. Controprova: sulla modalità di FILO lo stesso menu si comporta bene ───
test('controprova: sulla modalità di Filo lo stesso menu si chiude e la modalità resta', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, LETTORE);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await entra(app);
  await apriMenu(page);
  await esc(app);
  expect(await menuAperto(page), 'il primo Esc doveva chiudere il menu').toBe(false);
  expect(await schermoIntero(app), 'il primo Esc non doveva togliere la modalità').toBe(true);
});
