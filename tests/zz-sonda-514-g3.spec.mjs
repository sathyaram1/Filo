// Sonda avversariale #514 (giro 2) — usa e getta.
import { test, expect } from './fixtures/electron.mjs';

const PAGINA = '<html><body style="margin:0"><p id="t">ciao</p></body></html>';
const CON_IFRAME = '<html><body style="margin:0"><p id="t">fuori</p>'
  + '<iframe id="f" srcdoc="<body style=margin:0><p id=i>dentro</p></body>" style="width:400px;height:200px"></iframe></body></html>';

async function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { cf: !!t.contentFullscreen };
  });
}
async function setFs(app, on) {
  await app.evaluate(({ BrowserWindow }, v) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(v);
  }, on);
  await new Promise((r) => setTimeout(r, 600));
}
async function escReale(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, 600));
}

// Etichetta della voce "schermo intero" nel menu del tasto destro, aperto su
// `scope` (una Page o un FrameLocator) cliccando su `sel`.
async function etichetta(scope, sel) {
  await scope.locator(sel).click({ button: 'right' });
  await expect(scope.locator('.sn-menu')).toBeVisible({ timeout: 8000 });
  const voce = scope.locator('[data-sn-icon-id="fullscreen"]');
  if (await voce.count() === 0) {
    await scope.locator('.sn-menu-row-overflow').first().click();
    await expect(voce.first()).toBeVisible({ timeout: 8000 });
  }
  return voce.first().getAttribute('aria-label');
}

test('scheda in secondo piano quando si accende: il menu dice la verità', async ({ app, openTab, testServer, shell }) => {
  const a = await testServer.openReady(openTab, PAGINA);
  const b = await testServer.openReady(openTab, PAGINA);
  // torna sulla prima: la seconda resta in secondo piano
  await shell.evaluate(() => window.filoShell.tabs.list?.());
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    t.activate(t.tabs[t.tabs.length - 2].id);
  });
  await setFs(app, true);
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    t.activate(t.tabs[t.tabs.length - 1].id);
  });
  await new Promise((r) => setTimeout(r, 400));
  expect(await etichetta(b, '#t')).toMatch(/esci da schermo intero/i);
  await setFs(app, false);
  void a;
});

test('IFRAME montato PRIMA che si accenda: il menu dentro il riquadro', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, CON_IFRAME);
  await new Promise((r) => setTimeout(r, 800));
  await setFs(app, true);
  const dentro = page.frameLocator('#f');
  const lab = await etichetta(dentro, '#i');
  console.log('IFRAME montato prima, fullscreen ON → etichetta:', lab);
  await setFs(app, false);
  expect(lab).toMatch(/esci da schermo intero/i);
});

test('IFRAME montato MENTRE è acceso, poi si spegne: il menu dentro il riquadro', async ({ app, openTab, testServer }) => {
  await setFs(app, true);
  const page = await testServer.openReady(openTab, CON_IFRAME);
  await new Promise((r) => setTimeout(r, 800));
  const dentro = page.frameLocator('#f');
  const dentroAcceso = await etichetta(dentro, '#i');
  console.log('IFRAME nato a schermo intero → etichetta:', dentroAcceso);
  await page.keyboard.press('Escape').catch(() => {});
  await setFs(app, false);
  await new Promise((r) => setTimeout(r, 600));
  const dentroSpento = await etichetta(dentro, '#i');
  console.log('IFRAME dopo lo spegnimento → etichetta:', dentroSpento);
  expect(dentroSpento).toMatch(/^schermo intero$/i);
});

test('ricarica mentre è acceso: il menu dice la verità', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await setFs(app, true);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 500));
  const lab = await etichetta(page, '#t');
  await setFs(app, false);
  expect(lab).toMatch(/esci da schermo intero/i);
});

test('acceso e subito spento mentre la scheda nasce: nessuna risposta stantia', async ({ app, openTab, testServer }) => {
  await setFs(app, true);
  const page = await testServer.openReady(openTab, PAGINA);
  await setFs(app, false);
  await new Promise((r) => setTimeout(r, 800));
  const lab = await etichetta(page, '#t');
  expect(lab).toMatch(/^schermo intero$/i);
});

test('gestione: Esc chiude l\'immagine e lascia in piedi la ricerca', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  // apre la ricerca (la stessa scorciatoia dell'utente)
  await page.keyboard.press('Control+f').catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  const ricercaPrima = await page.evaluate(() => !!document.querySelector('#mgSearchInput'));
  await page.evaluate(() => {
    document.getElementById('mgLightboxImg').src =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    document.getElementById('mgLightbox').classList.add('open');
  });
  await page.keyboard.press('Escape');
  await expect(page.locator('#mgLightbox')).toBeHidden({ timeout: 4000 });
  console.log('ricerca presente prima:', ricercaPrima);
});

test('gestione: immagine aperta MENTRE si è a schermo intero, Esc vero', async ({ app, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await setFs(app, true);
  await page.evaluate(() => {
    document.getElementById('mgLightboxImg').src =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    document.getElementById('mgLightbox').classList.add('open');
  });
  await expect(page.locator('#mgLightbox')).toBeVisible();
  await escReale(app);
  const dopo1 = {
    lightbox: await page.locator('#mgLightbox').isVisible(),
    fs: (await stato(app)).cf,
  };
  await escReale(app);
  const dopo2 = {
    lightbox: await page.locator('#mgLightbox').isVisible(),
    fs: (await stato(app)).cf,
  };
  console.log('dopo primo Esc:', JSON.stringify(dopo1), 'dopo secondo:', JSON.stringify(dopo2));
  await setFs(app, false);
  // si deve poter uscire da entrambi
  expect(dopo2.lightbox).toBe(false);
  expect(dopo2.fs).toBe(false);
});
