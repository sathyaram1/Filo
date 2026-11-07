// #859 — un sito che ferma l'Esc dal suo ascolto in cattura sulla finestra arriva prima di ogni riquadro di Filo:
// il menu restava aperto e a schermo intero la modalità se ne andava. Regola: patterns/esc-chiude-prima-il-riquadro-aperto-poi-la-modalita.md.

import { test, expect } from './fixtures/electron.mjs';
import { menuAperto } from './helpers/menuContestuale.mjs';
import { premiNellaBarra } from './helpers/barra.mjs';

// Il gestore sta nella testa del documento, il primo script della pagina: prima di così un sito non può arrivare.
const sito = (ferma, extra = '') => `<!doctype html><html><head><script>
  window.__escDelSito = 0;
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    window.__escDelSito += 1;
    ${ferma === 'tutto' ? 'e.preventDefault(); e.stopImmediatePropagation();' : ''}
    ${ferma === 'propagazione' ? 'e.stopPropagation();' : ''}
  }, true);
</script></head><body style="margin:0;height:1200px">
<p id="t">parola dentro una frase</p>${extra}
</body></html>`;

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
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 500));
}

// Il tasto vero, dal before-input-event del main come quando lo preme una persona.
async function esc(app, attesa = 900) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, attesa));
}

async function apriMenu(page) {
  await page.locator('#t').click({ button: 'right' });
  await expect.poll(() => menuAperto(page), { timeout: 8000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 300));
}

for (const ferma of ['propagazione', 'tutto']) {
  test(`sito che ferma l'Esc sulla finestra (${ferma}): il primo Esc chiude il menu, il secondo esce`, async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, sito(ferma));
    await entra(app);
    await apriMenu(page);

    await esc(app);
    expect(await menuAperto(page), 'il primo Esc doveva chiudere il menu di Filo').toBe(false);
    expect(await schermoIntero(app), 'il primo Esc ha portato via lo schermo intero').toBe(true);

    await esc(app);
    expect(await schermoIntero(app), 'il secondo Esc doveva uscire').toBe(false);
  });

  test(`sito che ferma l'Esc sulla finestra (${ferma}), niente di Filo aperto: il primo Esc esce subito e il sito lo riceve`, async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, sito(ferma));
    await entra(app);
    await esc(app);
    expect(await schermoIntero(app), 'il primo Esc doveva uscire, e senza aspettare').toBe(false);
    expect(await page.evaluate(() => window.__escDelSito), 'l\'Esc senza riquadri di Filo è del sito').toBe(1);
  });
}

test('fuori dallo schermo intero, sul sito che ferma l\'Esc, il menu si chiude lo stesso', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, sito('tutto'));
  await apriMenu(page);
  await esc(app, 600);
  expect(await menuAperto(page), 'l\'Esc doveva chiudere il menu di Filo').toBe(false);
  // Chiuso il menu, l'Esc dopo torna del sito.
  const prima = await page.evaluate(() => window.__escDelSito);
  await esc(app, 400);
  expect(await page.evaluate(() => window.__escDelSito)).toBe(prima + 1);
});

// Un'altra famiglia di riquadri, aperta da un'icona della barra laterale: la regola non conosce il riquadro.
test('sito che ferma l\'Esc: il QR della pagina si chiude col primo Esc, lo schermo intero resta', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, sito('tutto'));
  await entra(app);
  await premiNellaBarra(app, 'qrCode');
  await expect(page.locator('.sn-qr-overlay')).toBeVisible({ timeout: 8000 });
  await new Promise((r) => setTimeout(r, 300));

  await esc(app);
  await expect(page.locator('.sn-qr-overlay')).toHaveCount(0);
  expect(await schermoIntero(app), 'il primo Esc ha portato via lo schermo intero').toBe(true);
  await esc(app);
  expect(await schermoIntero(app)).toBe(false);
});

test('pagina senza gestore dell\'Esc: il menu si chiude col primo, la modalità esce col secondo', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<html><body style="margin:0;height:1200px"><p id="t">parola dentro una frase</p></body></html>');
  await entra(app);
  await apriMenu(page);
  await esc(app);
  expect(await menuAperto(page)).toBe(false);
  expect(await schermoIntero(app)).toBe(true);
  await esc(app);
  expect(await schermoIntero(app)).toBe(false);
});

// La modalità presa dal SITO col suo pulsante: lì l'Esc lo consegna il main alla pagina, e il sito che lo ferma
// sulla finestra arrivava prima del menu anche così.
test('schermo pieno del sito col suo pulsante, sito che ferma l\'Esc: il primo Esc chiude il menu, non la modalità', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const pulsante = `<button id="fs" style="font-size:20px">schermo intero</button>
<script>document.getElementById('fs').addEventListener('click', function () { try { document.documentElement.requestFullscreen(); } catch (_) {} });</script>`;
  const page = await testServer.openReady(openTab, sito('tutto', pulsante));
  await page.locator('#fs').click();
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(true);
  expect((await stato(app)).pageFs, 'lo schermo pieno è della pagina').toBe(true);
  await apriMenu(page);

  await esc(app, 1200);
  expect(await menuAperto(page), 'il primo Esc doveva chiudere il menu').toBe(false);
  expect(await schermoIntero(app), 'il primo Esc ha portato via lo schermo pieno lasciando il menu').toBe(true);

  await esc(app, 1200);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});

// Criterio 4: su una pagina di Filo i riquadri impilati si chiudono uno per Esc, poi si esce.
test('pagina di Filo con tre riquadri impilati: un Esc per riquadro, poi l\'uscita', async ({ app }) => {
  test.setTimeout(90_000);
  const scadenza = Date.now() + 10_000;
  let page = null;
  while (!page && Date.now() < scadenza) {
    page = app.windows().find((w) => w.url().startsWith('filo://newtab')) || null;
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  expect(page, 'nuova scheda del boot').toBeTruthy();
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
      streamComplete: async ({ onDelta }) => { onDelta('Breve.'); return { text: 'Breve.', usage: {} }; },
    };
  });
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 15_000 });
  await entra(app);
  await page.evaluate(() => {
    for (let i = 1; i <= 3; i += 1) {
      window.SN_POPUP.openStreaming({
        action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
        payload: { selection: 'r' + i, sentence: 'una frase con r' + i + ' dentro' },
        anchor: { x: 120 + i * 20, y: 300 },
        title: 'r' + i,
      });
    }
  });
  await expect.poll(() => page.locator('.sn-popup').count(), { timeout: 10_000 }).toBe(3);
  await new Promise((r) => setTimeout(r, 400));

  for (let resta = 2; resta >= 0; resta -= 1) {
    await esc(app);
    expect(await page.locator('.sn-popup').count(), 'un Esc chiude un riquadro').toBe(resta);
    expect(await schermoIntero(app), `con ${resta} riquadri ancora aperti la modalità doveva restare`).toBe(true);
  }
  await esc(app);
  expect(await schermoIntero(app), 'chiusi i riquadri, l\'Esc esce').toBe(false);
});
