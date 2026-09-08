// #514 (giro 9) — porte che i giri passati non avevano aperto.
//
// Otto giri hanno chiuso lo stesso danno da porte sempre nuove: a schermo
// intero l'Esc porta via la modalità invece di chiudere prima il riquadro che
// sta sopra la pagina. Qui si provano famiglie che nessuno aveva toccato:
//
//  · i RIQUADRI INCORPORATI di un sito (il video, la mappa, il blocco commenti
//    dentro una pagina). Lì Filo disegna il suo menu del tasto destro, ma
//    l'annuncio dello schermo intero non ci arriva: il riquadro non sa in che
//    modalità si trova, la voce del menu sbaglia nome e l'Esc costa la
//    modalità;
//  · un sito che si prende l'Esc prima che ci arrivi il menu di Filo;
//  · una pagina occupata quando l'Esc viene premuto: la sua risposta arriva
//    tardi e la modalità è già uscita;
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
async function esci(app) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(false);
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

const DENTRO = '<!doctype html><body style="margin:0;height:900px">'
  + '<h1 id="t">dentro il riquadro incorporato</h1></body>';

function conRiquadro(url) {
  return `<!doctype html><body style="margin:0"><h1 id="fuori">la pagina che ospita</h1>`
    + `<iframe id="f" src="${url}" style="width:700px;height:500px;border:0"></iframe></body>`;
}

// La voce «Schermo intero» del menu del tasto destro, dovunque sia il menu.
async function etichettaFullscreen(scope) {
  const diretto = scope.locator('[data-sn-icon-id="fullscreen"]');
  if (await diretto.count() === 0) {
    await scope.locator('.sn-menu-row-overflow').first().click();
    await expect(diretto.first()).toBeVisible({ timeout: 8000 });
  }
  return diretto.first();
}

// ── 1. Il menu del tasto destro dentro un riquadro incorporato ───────────────
test('sito: il menu del tasto destro aperto DENTRO un riquadro incorporato non deve costare lo schermo intero', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, conRiquadro(testServer.html(DENTRO)));
  const frame = page.frameLocator('#f');
  await frame.locator('#t').click(); // il fuoco va nel riquadro incorporato

  await entra(app);
  await frame.locator('#t').click({ button: 'right' });
  await expect(frame.locator('.sn-menu').first()).toBeVisible({ timeout: 10_000 });

  await esc(app);
  const menuAperto = await frame.locator('.sn-menu').count() > 0;
  const ancoraDentro = await schermoIntero(app);
  expect(
    { menuAperto, schermoIntero: ancoraDentro },
    'il primo Esc doveva chiudere il menu e lasciare acceso lo schermo intero',
  ).toEqual({ menuAperto: false, schermoIntero: true });
});

// ── 2. Il menu del riquadro incorporato dice il nome giusto? ─────────────────
// Il riquadro c'era già quando lo schermo intero si è acceso: nessuno gliel'ha
// detto, e la sua voce promette di ENTRARE dove si è già.
test('sito: nel riquadro incorporato la voce del menu deve dire «Esci da schermo intero»', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, conRiquadro(testServer.html(DENTRO)));
  const frame = page.frameLocator('#f');
  await frame.locator('#t').click();

  await entra(app);
  await frame.locator('#t').click({ button: 'right' });
  await expect(frame.locator('.sn-menu').first()).toBeVisible({ timeout: 10_000 });
  const voce = await etichettaFullscreen(frame);
  expect(await voce.getAttribute('aria-label')).toMatch(/esci da schermo intero/i);
});

// ── 3. …e al contrario, quando lo schermo intero si spegne da un'altra strada ─
// Il riquadro è nato mentre la modalità era accesa (lì lo stato lo CHIEDE, e
// lo sa). Poi la modalità si spegne da fuori: al riquadro non arriva niente e
// la sua voce continua a promettere un'uscita che non c'è più — chi la clicca
// ci RIENTRA.
test('sito: spento lo schermo intero da un\'altra strada, il riquadro incorporato non deve offrire l\'uscita', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  await entra(app);
  const page = await testServer.openReady(openTab, conRiquadro(testServer.html(DENTRO)));
  const frame = page.frameLocator('#f');
  await frame.locator('#t').click();
  await esci(app);

  await frame.locator('#t').click({ button: 'right' });
  await expect(frame.locator('.sn-menu').first()).toBeVisible({ timeout: 10_000 });
  const voce = await etichettaFullscreen(frame);
  expect(await voce.getAttribute('aria-label')).toMatch(/^schermo intero/i);
});

// ── 4. Il sito si prende l'Esc prima del menu di Filo ─────────────────────────
// Molti siti tengono un gestore globale dell'Esc per chiudere le proprie
// finestre, e lo fermano lì. Il menu di Filo ascolta più in basso, quindi quel
// tasto non gli arriva: il menu resta aperto e intanto lo schermo intero se ne
// va, che è il danno dei giri 3, 4, 5, 7 e 8.
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
  const menuAperto = await page.locator('.sn-menu').count() > 0;
  const ancoraDentro = await schermoIntero(app);
  expect(
    { menuAperto, schermoIntero: ancoraDentro },
    'col menu di Filo aperto il primo Esc non doveva portare via lo schermo intero',
  ).toEqual({ menuAperto: true, schermoIntero: true });
});

// ── 5. La pagina è occupata quando l'Esc arriva ──────────────────────────────
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
  const menuAperto = await page.locator('.sn-menu').count() > 0;
  const ancoraDentro = await schermoIntero(app);
  expect(
    { menuAperto, schermoIntero: ancoraDentro },
    'la pagina era occupata: l\'Esc ha chiuso il menu E ha portato via lo schermo intero',
  ).toEqual({ menuAperto: false, schermoIntero: true });
});

// ── 6. Controprova: col tasto suo un sito prende ancora lo schermo pieno ──────
// È il tasto «f» dei lettori video. Se andasse perso, il rimedio a #514 avrebbe
// portato via una cosa che funzionava.
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
