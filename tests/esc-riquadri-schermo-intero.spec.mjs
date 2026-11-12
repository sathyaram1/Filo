// #514 — a tutto schermo l'Esc chiude prima il riquadro di Filo aperto, e solo il secondo esce dallo schermo intero. Il
// tasto passa da `wc.sendInputEvent`, il cammino del tasto vero dal before-input-event del main, dove stava il difetto. I
// riquadri sono di famiglie diverse (content script, pagine di Filo, icone della barra) e nessuno si iscrive a niente.

import { test, expect } from './fixtures/electron.mjs';
import { barraPage, comandaBarra, pannelloFermo, premiNellaBarra } from './helpers/barra.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

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

// La nuova scheda del boot, che è anche quella DAVANTI: qui conta, perché a
// tutto schermo l'Esc va alla scheda in primo piano e la regola guarda i
// riquadri di quella. `openTab('filo://newtab/')` non va bene: apre una seconda
// nuova scheda, che passa davanti, ma restituisce la prima — che resta dietro.
async function nuovaSchedaInPrimoPiano(app) {
  const scadenza = Date.now() + 10_000;
  while (Date.now() < scadenza) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded').catch(() => {}); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('nuova scheda non trovata');
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
  await expect(menuDi(page).locator('.sn-menu').first()).toBeVisible({ timeout: 8000 });

  await esc(app);
  expect(await menuDi(page).locator('.sn-menu').count(), 'il menu doveva chiudersi col primo Esc').toBe(0);
  expect((await stato(app)).cf, 'il primo Esc non doveva togliere lo schermo intero').toBe(true);

  await esc(app);
  await expect.poll(async () => (await stato(app)).cf, { timeout: 8000 }).toBe(false);
});

test('riquadro della risposta aperto: il primo Esc chiude il riquadro, il secondo esce', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await nuovaSchedaInPrimoPiano(app);
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

test('la barra aperta mentre lo schermo intero si spegne da un\'altra strada: l\'icona cambia nome', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  await entra(app);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const icona = barra.locator('#nav .ico[data-id="fullscreen"]');
  await expect(icona).toHaveAttribute('aria-label', /esci da schermo intero/i, { timeout: 8000 });

  // Lo schermo intero si spegne senza toccare la barra (l'assistente, un gesto di sistema, un'altra scheda): l'icona
  // non deve continuare a promettere un'uscita che non esiste più.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(false);
  });
  await expect(icona).toHaveAttribute('aria-label', /^schermo intero$/i, { timeout: 8000 });
});

test('home: l\'immagine ingrandita si chiude col primo Esc, lo schermo intero resta', async ({ app }) => {
  const page = await nuovaSchedaInPrimoPiano(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8000 });
  // Quello che fa incollare uno screenshot nella chat della nuova scheda.
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
  await new Promise((r) => setTimeout(r, 400));

  await esc(app);
  await expect(page.locator('.dash-lightbox.open')).toHaveCount(0);
  expect((await stato(app)).cf, 'il primo Esc non doveva togliere lo schermo intero').toBe(true);

  await esc(app);
  await expect.poll(async () => (await stato(app)).cf, { timeout: 8000 }).toBe(false);
});

test('home: la domanda di conferma si annulla col primo Esc, lo schermo intero resta', async ({ app }) => {
  const page = await nuovaSchedaInPrimoPiano(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8000 });
  await entra(app);
  // Quello che fa Filo prima di un'azione delicata.
  await page.evaluate(() => {
    window.__esitoConferma = 'in corso';
    window.SN_CONFIRM_UI.confirm({ title: 'Sicuro?', text: 'Azione delicata' })
      .then((v) => { window.__esitoConferma = v; });
  });
  await new Promise((r) => setTimeout(r, 500));

  await esc(app);
  expect(await page.evaluate(() => window.__esitoConferma), 'il primo Esc doveva annullare la conferma').toBe(false);
  expect((await stato(app)).cf, 'il primo Esc non doveva togliere lo schermo intero').toBe(true);

  await esc(app);
  await expect.poll(async () => (await stato(app)).cf, { timeout: 8000 }).toBe(false);
});

test('pagina dei feedback: l\'immagine ingrandita si chiude col primo Esc', async ({ app, openTab }) => {
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForSelector('#lightbox', { state: 'attached', timeout: 8000 });
  await entra(app);
  // Lo stato in cui mette la pagina il clic su un'immagine allegata.
  await page.evaluate(() => {
    document.getElementById('lightboxImg').src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    document.getElementById('lightbox').classList.add('open');
  });
  await expect(page.locator('#lightbox.open')).toBeVisible({ timeout: 4000 });
  await new Promise((r) => setTimeout(r, 400));

  await esc(app);
  await expect(page.locator('#lightbox.open')).toHaveCount(0);
  expect((await stato(app)).cf, 'il primo Esc non doveva togliere lo schermo intero').toBe(true);

  await esc(app);
  await expect.poll(async () => (await stato(app)).cf, { timeout: 8000 }).toBe(false);
});

// Le due icone della barra che aprono un riquadro loro sulla pagina: nessuna delle due sa niente dello schermo intero.
test('QR code della pagina: il primo Esc chiude il QR, il secondo esce', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await entra(app);
  await premiNellaBarra(app, 'qrCode');
  await expect(page.locator('.sn-qr-overlay')).toBeVisible({ timeout: 8000 });
  await new Promise((r) => setTimeout(r, 400));

  await esc(app);
  await expect(page.locator('.sn-qr-overlay')).toHaveCount(0);
  expect((await stato(app)).cf, 'il primo Esc non doveva togliere lo schermo intero').toBe(true);

  await esc(app);
  await expect.poll(async () => (await stato(app)).cf, { timeout: 8000 }).toBe(false);
});

test('cattura di una parte: il primo Esc annulla la selezione, il secondo esce', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await entra(app);
  await premiNellaBarra(app, 'screenshotCrop');
  await expect(page.locator('.sn-region-overlay')).toBeVisible({ timeout: 8000 });
  await new Promise((r) => setTimeout(r, 400));

  await esc(app);
  await expect(page.locator('.sn-region-overlay')).toHaveCount(0);
  expect((await stato(app)).cf, 'il primo Esc non doveva togliere lo schermo intero').toBe(true);

  await esc(app);
  await expect.poll(async () => (await stato(app)).cf, { timeout: 8000 }).toBe(false);
});

test('una pagina di Filo che si prende OGNI Esc non chiude dentro: il secondo esce', async ({ app }) => {
  // Il caso brutto della regola "su una pagina di Filo il tasto consumato è di
  // chi l'ha consumato": se qualcuno se lo prendesse sempre, senza chiudere
  // niente, l'unica via d'uscita sparirebbe. Il secondo Esc esce comunque.
  const page = await nuovaSchedaInPrimoPiano(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8000 });
  await entra(app);
  await page.evaluate(() => {
    window.__mangiaEsc = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); } };
    document.addEventListener('keydown', window.__mangiaEsc, true);
  });

  await esc(app);
  expect((await stato(app)).cf, 'il primo Esc è di chi se l\'è preso').toBe(true);
  await esc(app);
  await expect.poll(async () => (await stato(app)).cf, { timeout: 8000 }).toBe(false);
  await page.evaluate(() => document.removeEventListener('keydown', window.__mangiaEsc, true));
});

// Arrivato al tetto delle rivendicazioni Filo smette di credere alla pagina ed
// esce. Smettere di crederle però non è autorizzazione a scavalcarla: se si
// riprendesse l'Esc, il riquadro in cima resterebbe aperto sopra una pagina che
// nessuno aveva chiesto di lasciare, cioè il danno di #514 rifatto da noi nel
// punto in cui ci difendiamo (#648). Una pila più alta del tetto è l'unico modo
// di arrivarci senza una pagina ostile.
test('al tetto Filo esce ma non si prende l\'Esc: non resta nessun riquadro aperto', async ({ app }) => {
  test.setTimeout(180_000);
  const ALTA = 12;
  const page = await nuovaSchedaInPrimoPiano(app);
  await preparaProvider(app);
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 15_000 });
  await entra(app);
  await page.evaluate((n) => {
    for (let i = 1; i <= n; i += 1) {
      window.SN_POPUP.openStreaming({
        action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
        payload: { selection: 'r' + i, sentence: 'una frase con r' + i + ' dentro' },
        anchor: { x: 120, y: 300 },
        title: 'r' + i,
      });
    }
  }, ALTA);
  await expect.poll(() => page.locator('.sn-popup').count(), { timeout: 10_000 }).toBe(ALTA);
  await new Promise((r) => setTimeout(r, 400));

  let uscita = 0;
  for (let i = 1; i <= ALTA && !uscita; i += 1) {
    await esc(app);
    if (!(await stato(app)).cf) uscita = i;
  }
  expect(uscita, `dopo ${ALTA} Esc la modalità non si è mai spenta`).toBeGreaterThan(0);
  expect(
    await page.locator('.sn-popup').count(),
    `all'Esc numero ${uscita} la modalità se n'è andata scavalcando i riquadri ancora aperti`,
  ).toBeLessThanOrEqual(ALTA - uscita);
});
