// #514 (giro 8) — porte rimaste dopo sette giri.
//
// I giri 3, 4, 5 e 7 hanno trovato lo stesso danno da porte sempre nuove: a
// schermo intero l'Esc chiude il riquadro aperto sopra la pagina E porta via
// anche la modalità, che nessuno aveva chiesto di lasciare. Qui si provano
// due famiglie che nessun giro aveva toccato:
//
//  · un riquadro che Filo apre DENTRO un altro suo riquadro, su un SITO:
//    l'immagine ingrandita dello screenshot allegato al box di segnalazione.
//    A chiudersi è un pezzo interno, mentre la radice del box resta dov'era;
//  · un Esc che una pagina di Filo si prende senza chiudere niente (il campo
//    «trova nel documento» dell'editor, già vuoto): lì il tasto sparisce e
//    l'utente non vede succedere niente.

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
async function esc(app, attesa = 900) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, attesa));
}

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const PAGINA = `<!doctype html><html><body style="margin:0;height:1400px">
<h1 id="t">un sito qualunque</h1>
</body></html>`;

// Sui siti il box si apre come lo apre l'utente: tasto destro sulla pagina,
// voce «Invia feedback». (Il modulo vive nel mondo isolato del content script,
// quindi da fuori non lo si chiama a mano.)
async function apriBoxDalMenu(page) {
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1',
    null,
    { timeout: 15_000 },
  );
  await page.locator('#t').click({ button: 'right' });
  const voce = page.locator('.sn-menu-item, .sn-menu [role="menuitem"], .sn-menu li')
    .filter({ hasText: 'Invia feedback' }).first();
  await expect(voce).toBeVisible({ timeout: 8000 });
  await voce.click();
}

async function allegaImmagine(page) {
  await expect(page.locator('.sn-fb-modal')).toBeVisible({ timeout: 8000 });
  await page.locator('.sn-fb-file').setInputFiles([
    { name: 'schermata.png', mimeType: 'image/png', buffer: PNG_1x1 },
  ]);
  await expect(page.locator('.sn-fb-thumb img')).toHaveCount(1, { timeout: 8000 });
}

const lightboxAperta = (page) => page.locator('.sn-fb-lightbox').count().then((n) => n > 0);

// ── L'immagine ingrandita dentro il box di segnalazione, su un SITO ──────────
test('sito: l\'immagine ingrandita del box di segnalazione — il primo Esc la chiude e lo schermo intero resta', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await apriBoxDalMenu(page);
  await allegaImmagine(page);

  // Controprova, fuori dallo schermo intero: l'Esc chiude solo l'immagine, il
  // box di segnalazione resta aperto.
  await page.locator('.sn-fb-thumb img').first().click();
  await expect.poll(() => lightboxAperta(page), { timeout: 5000 }).toBe(true);
  await esc(app);
  expect(await lightboxAperta(page), 'fuori dallo schermo intero il primo Esc chiude l\'immagine').toBe(false);
  expect(await page.locator('.sn-fb-modal').count(), 'e lascia aperto il box di segnalazione').toBe(1);

  // Ora a schermo intero: stessa immagine, stesso tasto.
  await entra(app);
  await page.locator('.sn-fb-thumb img').first().click();
  await expect.poll(() => lightboxAperta(page), { timeout: 5000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 400));

  await esc(app);
  expect(await lightboxAperta(page), 'il primo Esc doveva chiudere l\'immagine').toBe(false);
  expect(
    await schermoIntero(app),
    'il primo Esc ha chiuso l\'immagine E ha spento lo schermo intero',
  ).toBe(true);

  // E il box sotto resta: il secondo Esc è suo, non della modalità.
  expect(await page.locator('.sn-fb-modal').count(), 'il box di segnalazione doveva restare aperto').toBe(1);
  await esc(app);
  expect(await page.locator('.sn-fb-modal').count(), 'il secondo Esc doveva chiudere il box').toBe(0);
  expect(await schermoIntero(app), 'e nemmeno il secondo Esc doveva spegnere lo schermo intero').toBe(true);

  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});

// Lo stesso box, sulla home di Filo: lì funziona. È la controprova che a
// cambiare le cose è la pagina sotto, non il riquadro.
test('home: lo stesso box di segnalazione — l\'immagine ingrandita si chiude e lo schermo intero resta', async ({ app }) => {
  test.setTimeout(180_000);
  const scadenza = Date.now() + 15_000;
  let page = null;
  while (Date.now() < scadenza) {
    page = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(page, 'nuova scheda non trovata').toBeTruthy();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForFunction(() => !!window.SN_FEEDBACK_UI, null, { timeout: 15_000 });
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await allegaImmagine(page);

  await entra(app);
  await page.locator('.sn-fb-thumb img').first().click();
  await expect.poll(() => lightboxAperta(page), { timeout: 5000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 400));

  await esc(app);
  expect(await lightboxAperta(page), 'il primo Esc doveva chiudere l\'immagine').toBe(false);
  expect(await schermoIntero(app), 'il primo Esc non doveva togliere lo schermo intero').toBe(true);
});
