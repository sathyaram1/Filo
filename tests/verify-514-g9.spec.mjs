// #514 (giro 9) — porte che i giri passati non avevano aperto.
//
// Otto giri hanno chiuso lo stesso danno da porte sempre nuove: a schermo
// intero l'Esc porta via la modalità invece di chiudere prima il riquadro che
// sta sopra la pagina. Qui si provano famiglie che nessuno aveva toccato:
//
//  · il menu del tasto destro aperto DENTRO un riquadro incorporato di un sito
//    (il tasto arriva al frame, non alla pagina che lo ospita);
//  · un sito che si prende l'Esc prima che ci arrivi il menu di Filo: il menu
//    non riesce a chiudersi e intanto lo schermo intero se ne va;
//  · una pagina occupata quando l'Esc viene premuto: la risposta della pagina
//    arriva tardi e la modalità è già uscita;
//  · la controprova sul verso opposto: un sito deve poter ancora andare a
//    schermo pieno con un tasto suo (il classico «f» dei lettori video).

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
async function tasto(app, keyCode, attesa = 900) {
  await app.evaluate(({ BrowserWindow }, code) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: code });
    wc.sendInputEvent({ type: 'char', keyCode: code });
    wc.sendInputEvent({ type: 'keyUp', keyCode: code });
  }, keyCode);
  await new Promise((r) => setTimeout(r, attesa));
}
const esc = (app, attesa) => tasto(app, 'Escape', attesa);

// ── 1. Il menu dentro un riquadro incorporato ────────────────────────────────
test('sito: il menu del tasto destro aperto DENTRO un riquadro incorporato si chiude col primo Esc', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const dentro = testServer.html('<!doctype html><body style="margin:0;height:900px">'
    + '<h1 id="t">dentro il riquadro</h1></body>');
  const page = await testServer.openReady(
    openTab,
    `<!doctype html><body style="margin:0"><h1 id="fuori">la pagina che ospita</h1>`
    + `<iframe id="f" src="${dentro}" style="width:700px;height:500px;border:0"></iframe></body>`,
  );
  const frame = page.frameLocator('#f');
  await frame.locator('#t').click(); // il fuoco va nel riquadro incorporato

  await entra(app);
  await frame.locator('#t').click({ button: 'right' });
  await expect(frame.locator('.sn-menu').first()).toBeVisible({ timeout: 10_000 });

  await esc(app);
  expect(
    await frame.locator('.sn-menu').count(),
    'il primo Esc doveva chiudere il menu del riquadro incorporato',
  ).toBe(0);
  expect(
    await schermoIntero(app),
    'il primo Esc ha chiuso il menu E ha portato via lo schermo intero',
  ).toBe(true);

  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});

// ── 2. Il sito si prende l'Esc prima del menu di Filo ─────────────────────────
// Molti siti tengono un gestore globale dell'Esc per chiudere le proprie
// finestre, e lo fermano lì. Il menu di Filo ascolta sul documento, quindi
// quel tasto non gli arriva più: il menu resta aperto e intanto lo schermo
// intero se ne va, che è il danno dei giri 3, 4, 5, 7 e 8.
const SITO_MANGIA = `<!doctype html><body style="margin:0;height:900px">
<h1 id="t">un sito che si tiene l'Esc</h1>
<script>
  window.__mangiati = 0;
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    window.__mangiati++;
    e.stopPropagation();
  }, true);
</script></body>`;

test('sito che si prende l\'Esc: il menu di Filo aperto sopra non deve costare lo schermo intero', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, SITO_MANGIA);
  await page.locator('#t').click();

  await entra(app);
  await page.locator('#t').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 10_000 });

  await esc(app);
  expect(await page.evaluate(() => window.__mangiati), 'il sito deve aver visto l\'Esc').toBeGreaterThan(0);
  expect(
    await schermoIntero(app),
    'col menu di Filo aperto il primo Esc ha portato via lo schermo intero',
  ).toBe(true);
  expect(
    await page.locator('.sn-menu').count(),
    'e il menu è rimasto aperto sopra la pagina',
  ).toBe(0);
});

// ── 3. La pagina è occupata quando l'Esc arriva ──────────────────────────────
// Il main aspetta la risposta della pagina per un tempo fisso. Una pagina
// impegnata (un sito pesante, uno script lungo) risponde dopo, e intanto la
// modalità è già uscita: il riquadro si chiude E lo schermo intero se ne va.
const SITO_LENTO = `<!doctype html><body style="margin:0;height:900px">
<h1 id="t">un sito impegnato</h1>
<script>
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const fine = Date.now() + 700;
    while (Date.now() < fine) { /* la pagina è occupata */ }
  }, true);
</script></body>`;

test('sito occupato quando si preme Esc: il menu si chiude e lo schermo intero deve restare', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, SITO_LENTO);
  await page.locator('#t').click();

  await entra(app);
  await page.locator('#t').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 10_000 });

  await esc(app, 2000);
  expect(await page.locator('.sn-menu').count(), 'il menu doveva chiudersi').toBe(0);
  expect(
    await schermoIntero(app),
    'la pagina era occupata: l\'Esc ha chiuso il menu E ha portato via lo schermo intero',
  ).toBe(true);
});

// ── 4. Controprova: col tasto suo un sito prende ancora lo schermo pieno ──────
// È il tasto «f» dei lettori video. Se andasse perso, il rimedio a #514
// avrebbe portato via una cosa che funzionava.
const SITO_TASTO_FS = `<!doctype html><body style="margin:0;height:900px">
<h1 id="t">lettore</h1>
<script>
  window.__esito = 'mai chiesto';
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'f') return;
    document.documentElement.requestFullscreen()
      .then(() => { window.__esito = 'ok'; })
      .catch((err) => { window.__esito = 'rifiutato: ' + err; });
  });
</script></body>`;

test('col suo tasto (la «f» dei lettori video) un sito prende ancora lo schermo pieno', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, SITO_TASTO_FS);
  await page.locator('#t').click();
  await tasto(app, 'f', 1500);

  expect(await page.evaluate(() => window.__esito), 'la richiesta di schermo pieno è stata rifiutata').toBe('ok');
  expect((await stato(app)).pageFs, 'il sito doveva essere a schermo pieno').toBe(true);
});
