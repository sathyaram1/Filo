// #514 (giro 11) — le porte rimaste dopo dieci giri.
//
// Dieci giri hanno chiuso lo stesso danno — a schermo intero l'Esc porta via la
// modalità invece di chiudere prima il riquadro che sta sopra la pagina — da
// porte sempre nuove. Il giro 10 ha chiuso la famiglia dello schermo pieno che
// si prende il SITO, ma ha guidato solo due riquadri (il menu del tasto destro
// e il QR) dichiarando che gli altri «si comportano per forza uguale». Qui si
// guidano gli altri, e si provano tre cose che nessuno aveva ancora toccato:
//
//  · sopra lo schermo pieno del SITO: la risposta di Filo e il velo della
//    selezione di una parte dello schermo;
//  · più riquadri impilati: due su un sito, tre su una pagina di Filo, e
//    quattro — il tetto delle rivendicazioni;
//  · la tendina di sistema di un SITO (un <select>), che sulle pagine di Filo
//    il giro 10 aveva trovato a posto.

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

const LETTORE = `<!doctype html><html><body style="margin:0;height:1200px">
<h1 id="t">un sito con un video</h1>
<button id="fs" style="font-size:20px">schermo intero</button>
</body></html>`;

const CON_TENDINA = `<!doctype html><html><body style="margin:0;height:1200px">
<h1 id="t">un sito con una tendina</h1>
<select id="s" style="font-size:20px"><option>uno</option><option>due</option></select>
</body></html>`;

async function pienoDelSito(app, page) {
  await page.locator('#fs').click();
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(true);
  expect((await stato(app)).pageFs, 'lo schermo pieno è della pagina').toBe(true);
}

async function apriMenu(page) {
  await page.locator('#t').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 8000 });
  await new Promise((r) => setTimeout(r, 400));
}

async function voceDelMenu(page, iconId) {
  const voce = page.locator(`[data-sn-icon-id="${iconId}"]`);
  if (await voce.count() === 0) await page.locator('.sn-menu-row-overflow').first().click();
  await expect(voce.first()).toBeVisible({ timeout: 8000 });
  return voce.first();
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

// Un provider finto: la risposta di Filo deve potersi aprire senza rete.
async function preparaProvider(app) {
  await app.evaluate(async ({ BrowserWindow }) => {
    try {
      const st = require('./services/storage');
      await st.set({ snProviders: [{ id: 'p', name: 'p', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'k', models: ['m'] }] });
    } catch (_) {}
  }).catch(() => {});
}

// ── 1. Sopra lo schermo pieno del SITO: la risposta di Filo ──────────────────
test('sito a schermo pieno col suo pulsante: il primo Esc deve chiudere la risposta, non la modalità', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, LETTORE);
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 15_000 });
  await preparaProvider(app);
  await pienoDelSito(app, page);

  await page.evaluate(() => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
      anchor: { x: 120, y: 300 },
      title: 'Approfondisci',
    });
  });
  await page.waitForSelector('.sn-popup', { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 400));

  await esc(app);
  expect(await page.locator('.sn-popup').count(), 'la risposta doveva chiudersi col primo Esc').toBe(0);
  expect(await schermoIntero(app), 'il primo Esc non doveva togliere lo schermo pieno').toBe(true);

  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});

// ── 2. Sopra lo schermo pieno del SITO: il velo della selezione ──────────────
test('sito a schermo pieno col suo pulsante: il primo Esc deve annullare la selezione, non la modalità', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, LETTORE);
  await pienoDelSito(app, page);

  await apriMenu(page);
  await (await voceDelMenu(page, 'screenshotCrop')).click();
  await expect(page.locator('.sn-region-overlay')).toBeVisible({ timeout: 8000 });
  await new Promise((r) => setTimeout(r, 400));

  await esc(app);
  await expect(page.locator('.sn-region-overlay')).toHaveCount(0);
  expect(await schermoIntero(app), 'il primo Esc non doveva togliere lo schermo pieno').toBe(true);

  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});

// ── 3. Due riquadri impilati su un SITO, a schermo intero di Filo ────────────
test('sito: due riquadri impilati — un Esc per ciascuno, e la modalità resta', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, LETTORE);
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 15_000 });
  await preparaProvider(app);
  await entra(app);

  await page.evaluate(() => {
    for (const t of ['primo', 'secondo']) {
      window.SN_POPUP.openStreaming({
        action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
        payload: { selection: t, sentence: 'una frase con ' + t + ' dentro' },
        anchor: { x: 120, y: 300 },
        title: t,
      });
    }
  });
  await expect.poll(() => page.locator('.sn-popup').count(), { timeout: 8000 }).toBe(2);
  await new Promise((r) => setTimeout(r, 400));

  await esc(app);
  expect(await page.locator('.sn-popup').count(), 'il primo Esc chiude quello sopra').toBe(1);
  expect(await schermoIntero(app), 'il primo Esc non doveva togliere la modalità').toBe(true);

  await esc(app);
  expect(await page.locator('.sn-popup').count(), 'il secondo Esc chiude quello sotto').toBe(0);
  expect(await schermoIntero(app), 'il secondo Esc non doveva togliere la modalità').toBe(true);

  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});

// ── 4. Quattro riquadri impilati su una pagina di Filo ───────────────────────
// Una risposta ne apre un'altra (un approfondimento dentro l'approfondimento):
// impilarne quattro è raro ma non impossibile. Ognuno deve costare il suo Esc,
// e nessuno la modalità.
test('home: quattro riquadri impilati — nessuno dei quattro Esc porta via la modalità', async ({ app }) => {
  test.setTimeout(180_000);
  const page = await nuovaSchedaInPrimoPiano(app);
  await preparaProvider(app);
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 15_000 });
  await entra(app);

  await page.evaluate(() => {
    for (const t of ['uno', 'due', 'tre', 'quattro']) {
      window.SN_POPUP.openStreaming({
        action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
        payload: { selection: t, sentence: 'una frase con ' + t + ' dentro' },
        anchor: { x: 120, y: 300 },
        title: t,
      });
    }
  });
  await expect.poll(() => page.locator('.sn-popup').count(), { timeout: 8000 }).toBe(4);
  await new Promise((r) => setTimeout(r, 400));

  for (let i = 1; i <= 4; i += 1) {
    await esc(app);
    expect(
      { rimasti: await page.locator('.sn-popup').count(), modalita: await schermoIntero(app) },
      `Esc numero ${i}: doveva chiudere solo il riquadro in cima`,
    ).toEqual({ rimasti: 4 - i, modalita: true });
  }

  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});

// ── 5. La tendina di sistema di un SITO ──────────────────────────────────────
// Sulle pagine di Filo il giro 10 l'aveva trovata a posto: il primo Esc chiude
// la tendina e la modalità resta. Su un sito è la stessa cosa per l'utente.
test('sito: la tendina di sistema — il primo Esc la chiude e la modalità resta', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, CON_TENDINA);
  await entra(app);
  await page.locator('#s').click();
  await new Promise((r) => setTimeout(r, 600));

  await esc(app);
  expect(await schermoIntero(app), 'il primo Esc era della tendina, non della modalità').toBe(true);

  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});

// ── 6. Controprova: niente aperto, un Esc solo, e in fretta ──────────────────
test('controprova: su un sito senza niente aperto un Esc esce, e non ci mette secondi', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, LETTORE);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await entra(app);

  const t0 = Date.now();
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
  const ms = Date.now() - t0;
  expect(ms, `l'uscita ha impiegato ${ms}ms: l'attesa lunga è la rete di sicurezza, non il caso normale`).toBeLessThan(1500);
});
