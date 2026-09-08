// #514 — a tutto schermo l'Esc chiude prima il riquadro di Filo che è aperto,
// e solo l'Esc dopo esce dallo schermo intero.
//
// Il tasto si inietta con `wc.sendInputEvent`: è lo stesso cammino del tasto
// vero, che passa dal before-input-event del main. È lì che stava il difetto,
// perché il main si prendeva l'Esc prima che la pagina lo vedesse e chiudeva
// lo schermo intero lasciando il riquadro aperto.

import { test, expect } from './fixtures/electron.mjs';

const PAGINA = '<html><body style="margin:0;height:1200px"><p id="t">parola dentro una frase</p></body></html>';

async function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { cf: !!t.contentFullscreen };
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

async function preparaProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.SN_PROVIDER_OPENROUTER,
      streamComplete: async ({ onDelta }) => {
        onDelta('Una spiegazione breve.');
        return { text: 'Una spiegazione breve.', usage: {} };
      },
    };
  });
}

test('menu del tasto destro aperto: il primo Esc chiude il menu, il secondo esce', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await entra(app);

  await page.locator('#t').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 8000 });

  await esc(app);
  expect(await page.locator('.sn-menu').count(), 'il menu doveva chiudersi col primo Esc').toBe(0);
  expect((await stato(app)).cf, 'il primo Esc non doveva togliere lo schermo intero').toBe(true);

  await esc(app);
  await expect.poll(async () => (await stato(app)).cf, { timeout: 8000 }).toBe(false);
});

test('riquadro della risposta aperto: il primo Esc chiude il riquadro, il secondo esce', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  await preparaProvider(app);
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });
  await entra(app);
  await page.evaluate(() => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
      anchor: { x: 120, y: 300 },
      title: 'Approfondisci',
    });
  });
  await page.waitForSelector('.sn-popup', { timeout: 8000 });

  await esc(app);
  expect(await page.locator('.sn-popup').count(), 'la risposta doveva chiudersi col primo Esc').toBe(0);
  expect((await stato(app)).cf, 'il primo Esc non doveva togliere lo schermo intero').toBe(true);

  await esc(app);
  await expect.poll(async () => (await stato(app)).cf, { timeout: 8000 }).toBe(false);
});

test('immagine a tutta pagina nella gestione: il primo Esc la chiude, il secondo esce', async ({ app, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await entra(app);
  // Quello che fa il clic su un'immagine allegata a un feedback.
  await page.evaluate(() => window.__mgTest.openLightbox(
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  ));
  await expect(page.locator('#mgLightbox')).toBeVisible();
  await new Promise((r) => setTimeout(r, 400));

  await esc(app);
  await expect(page.locator('#mgLightbox')).toBeHidden({ timeout: 4000 });
  expect((await stato(app)).cf, 'il primo Esc non doveva togliere lo schermo intero').toBe(true);

  await esc(app);
  await expect.poll(async () => (await stato(app)).cf, { timeout: 8000 }).toBe(false);
});

test('nessun riquadro aperto: l\'Esc esce dallo schermo intero al primo colpo', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await entra(app);
  await esc(app);
  expect((await stato(app)).cf).toBe(false);
  void page;
});

test('il menu aperto mentre lo schermo intero si spegne da un\'altra strada cambia nome', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await entra(app);
  await page.locator('#t').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 8000 });
  const voce = page.locator('[data-sn-icon-id="fullscreen"]');
  if (await voce.count() === 0) {
    await page.locator('.sn-menu-row-overflow').first().click();
    await expect(voce.first()).toBeVisible({ timeout: 8000 });
  }
  await expect.poll(async () => voce.first().getAttribute('aria-label'), { timeout: 8000 })
    .toMatch(/esci da schermo intero/i);

  // Lo schermo intero si spegne senza toccare il menu (l'assistente, un gesto
  // di sistema, un'altra scheda): la voce non deve continuare a promettere
  // un'uscita che non esiste più.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(false);
  });
  await expect.poll(async () => voce.first().getAttribute('aria-label'), { timeout: 8000 })
    .toMatch(/^schermo intero$/i);
});
