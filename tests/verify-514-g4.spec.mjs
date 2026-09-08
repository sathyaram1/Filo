// #514 giro 4 — verifica avversariale.
// La lamentela: Esc deve far uscire dallo schermo intero.
// Il giro scorso: a schermo intero l'Esc scavalcava i riquadri di Filo. Tre
// riquadri sono stati insegnati al main; qui provo le ALTRE porte che portano
// allo stesso stato (l'immagine a tutta pagina della home, quella della pagina
// dei feedback, il riquadro di conferma) e ricontrollo la lamentela originale.

import { test, expect } from './fixtures/electron.mjs';

const PAGINA = '<html><body style="margin:0;height:1200px"><p id="t">parola dentro una frase</p></body></html>';

const PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

async function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { cf: !!t.contentFullscreen, conRiquadro: [...t.tabsWithFiloBox], attiva: t.activeId };
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

// ── 1. La lamentela originale, ricontrollata ─────────────────────────────────

test('sito: Esc esce dallo schermo intero', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await entra(app);
  expect((await stato(app)).cf).toBe(true);
  await esc(app);
  expect((await stato(app)).cf, 'Esc doveva far uscire dallo schermo intero').toBe(false);
  void page;
});

test('home di Filo: Esc esce dallo schermo intero', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await expect(page.locator('#input')).toBeVisible({ timeout: 8000 });
  await entra(app);
  await esc(app);
  expect((await stato(app)).cf, 'Esc doveva far uscire anche da una pagina interna').toBe(false);
});

// ── 2. Le altre porte dello stesso difetto del giro scorso ───────────────────
// (le porte sulla home stanno in verify-514-g4b: lì la pagina pilotata è la
// scheda ATTIVA, che è quello che conta per la regola del main.)

test('pagina dei feedback: immagine ingrandita — il primo Esc deve chiudere lei', async ({ app, openTab }) => {
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForSelector('#lightbox', { state: 'attached', timeout: 8000 });
  await entra(app);
  // Lo stato in cui mette la pagina il clic su un'immagine allegata.
  await page.evaluate((src) => {
    document.getElementById('lightboxImg').src = src;
    document.getElementById('lightbox').classList.add('open');
  }, PX);
  await expect(page.locator('#lightbox.open')).toBeVisible({ timeout: 4000 });
  await new Promise((r) => setTimeout(r, 400));

  await esc(app);
  const dopo = await stato(app);
  const ancora = await page.locator('#lightbox.open').count();
  console.log('[g4 feedback] immagine ancora aperta:', ancora, '| schermo intero:', dopo.cf);
  expect({ immagineAperta: ancora > 0, schermoIntero: dopo.cf })
    .toEqual({ immagineAperta: false, schermoIntero: true });
});

// ── 3. Lo stato che resta appiccicato ────────────────────────────────────────

test('riquadro aperto e poi la pagina naviga: l\'Esc dopo esce lo stesso', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await entra(app);
  await page.locator('#t').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 8000 });
  // La pagina naviga col menu ancora aperto (un link, un redirect, un ricarica).
  await page.evaluate(() => { location.reload(); });
  await page.waitForLoadState('domcontentloaded');
  await new Promise((r) => setTimeout(r, 800));
  await esc(app);
  expect((await stato(app)).cf, 'dopo la navigazione l\'Esc doveva uscire al primo colpo').toBe(false);
});

test('riquadro aperto in una scheda, Esc da un\'altra scheda: esce', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await entra(app);
  await page.locator('#t').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 8000 });
  const page2 = await testServer.openReady(openTab, PAGINA);
  await new Promise((r) => setTimeout(r, 500));
  await esc(app);
  expect((await stato(app)).cf, 'da un\'altra scheda l\'Esc doveva uscire subito').toBe(false);
  void page2;
});
