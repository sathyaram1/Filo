// Zoom della pagina con Ctrl/Cmd sulle pagine web (#feedback zoom trackpad/Ctrl+).
//
// FEEDBACK (alpha): "rendi possibile zoommare anche pizzicando il trackpad e
// con cntr +". Prima esisteva solo la modalità zoom col click centrale; non
// si poteva zoomare tenendo Ctrl e usando rotella/pinch né con Ctrl + / -.
//
// Cosa asserisce (successo della feature, non assenza di errore):
//   - Ctrl+rotella su una pagina web cambia lo zoom della pagina (e NON scrolla);
//     il pinch del trackpad arriva come lo stesso evento (wheel con ctrlKey).
//   - Ctrl + ingrandisce, Ctrl - rimpicciolisce, Ctrl 0 torna al 100%.
//
// Pre-condizione che senza il fix fallirebbe: senza i nuovi handler, Ctrl+rotella
// scrolla (o non zooma) e Ctrl +/- non fa nulla → getZoomFactor resta ~1.

import { test, expect } from './fixtures/electron.mjs';

const TALL_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>tall</title>
<style>html,body{margin:0} #spacer{height:5000px;background:linear-gradient(#fff,#eee)}</style>
</head><body><div id="spacer">contenuto alto</div></body></html>`;

async function zoomFactorOf(app, hostNeedle) {
  return app.evaluate(({ webContents }, needle) => {
    for (const wc of webContents.getAllWebContents()) {
      let url = '';
      try { url = wc.getURL(); } catch (_) {}
      if (url.includes(needle)) return wc.getZoomFactor();
    }
    return null;
  }, hostNeedle);
}

test('Ctrl+rotella zooma la pagina e non scrolla', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, TALL_PAGE);
  const z0 = await zoomFactorOf(app, '127.0.0.1');
  expect(z0).toBeCloseTo(1, 1);

  const scrollBefore = await page.evaluate(() => window.scrollY);

  // Tenendo Ctrl, la rotella zooma (pinch del trackpad → stesso wheel+ctrlKey).
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300); // su = zoom in
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');

  await expect.poll(async () => zoomFactorOf(app, '127.0.0.1')).toBeGreaterThan(z0 + 0.01);
  // Non ha scrollato la pagina.
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

  // Ctrl+rotella giù rimpicciolisce.
  const zUp = await zoomFactorOf(app, '127.0.0.1');
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 300);
  await page.mouse.wheel(0, 300);
  await page.keyboard.up('Control');
  await expect.poll(async () => zoomFactorOf(app, '127.0.0.1')).toBeLessThan(zUp - 0.01);
});

test('Ctrl + / Ctrl - / Ctrl 0 zoomano e ripristinano la pagina', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, TALL_PAGE);
  await page.bringToFront();
  await page.locator('body').click(); // focus sulla pagina
  const z0 = await zoomFactorOf(app, '127.0.0.1');
  expect(z0).toBeCloseTo(1, 1);

  // Ctrl + ingrandisce.
  await page.keyboard.press('Control+=');
  await expect.poll(async () => zoomFactorOf(app, '127.0.0.1')).toBeGreaterThan(z0 + 0.01);

  // Ctrl 0 torna al 100%.
  await page.keyboard.press('Control+0');
  await expect.poll(async () => zoomFactorOf(app, '127.0.0.1')).toBeCloseTo(1, 1);

  // Ctrl - rimpicciolisce sotto il 100%.
  await page.keyboard.press('Control+-');
  await expect.poll(async () => zoomFactorOf(app, '127.0.0.1')).toBeLessThan(z0 - 0.01);
});

// ── Pagine interne filo:// (feedback #427) ────────────────────────────────
// FEEDBACK: "in questa pagina [filo://manage] ho provato a fare ctrl + per
// ingrandire ma non ha funzionato. l'unico modo attuale per zoomare è con la
// rotella [modalità click centrale]. rendi possibile zoomare ovunque con
// rotella, trackpad e ctrl".
//
// Pre-condizione che senza il fix fallirebbe: il preload interno montava
// wheel-zoom SENZA `pageZoom`, quindi su filo:// né Ctrl+rotella né Ctrl +/-/0
// toccavano lo zoom → getZoomFactor resta 1.

test('filo://: Ctrl + / Ctrl - / Ctrl 0 zoomano la pagina interna', async ({ app, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('domcontentloaded');
  await page.bringToFront();

  const z0 = await zoomFactorOf(app, 'manage');
  expect(z0).toBeCloseTo(1, 1);

  await page.keyboard.press('Control+=');
  await expect.poll(async () => zoomFactorOf(app, 'manage')).toBeGreaterThan(z0 + 0.01);

  await page.keyboard.press('Control+0');
  await expect.poll(async () => zoomFactorOf(app, 'manage')).toBeCloseTo(1, 1);

  await page.keyboard.press('Control+-');
  await expect.poll(async () => zoomFactorOf(app, 'manage')).toBeLessThan(z0 - 0.01);

  await page.keyboard.press('Control+0');
});

test('filo://: Ctrl+rotella (e pinch del trackpad) zooma la pagina interna', async ({ app, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('domcontentloaded');
  await page.bringToFront();

  const z0 = await zoomFactorOf(app, 'manage');
  expect(z0).toBeCloseTo(1, 1);

  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');

  await expect.poll(async () => zoomFactorOf(app, 'manage')).toBeGreaterThan(z0 + 0.01);
  await page.screenshot({ path: 'tests/.shots/manage-ctrl-zoom.png' });

  await page.keyboard.press('Control+0');
});

// ── Focus sulla barra di Filo (fila delle schede) ─────────────────────────
// Dopo un clic su una scheda il focus è sulla barra, non sulla pagina: i tasti
// non arrivano al preload della pagina. Senza l'inoltro dal main, Ctrl + qui
// non fa nulla → il fattore di zoom della scheda resta 1.

// Come in tab-browser-shortcuts.spec.mjs (#404), la combinazione si inietta
// sulla webContents della SHELL: è lo stesso cammino del tasto reale quando il
// focus è sulla barra, ed è deterministico in headless.
function pressCtrlOnShell(app, keyCode) {
  return app.evaluate(({ BrowserWindow }, kc) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: kc, modifiers: ['control'] });
  }, keyCode);
}

test('Ctrl + / Ctrl 0 zoomano la scheda anche col focus sulla barra di Filo', async ({ app, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('domcontentloaded');

  const z0 = await zoomFactorOf(app, 'manage');
  expect(z0).toBeCloseTo(1, 1);

  // Focus sulla barra (come dopo aver cliccato una scheda), non sulla pagina.
  await pressCtrlOnShell(app, '=');
  await expect.poll(async () => zoomFactorOf(app, 'manage')).toBeGreaterThan(z0 + 0.01);

  await pressCtrlOnShell(app, '0');
  await expect.poll(async () => zoomFactorOf(app, 'manage')).toBeCloseTo(1, 1);
});

// ── L'editor resta l'eccezione: scala il foglio, non la finestra ──────────
// Accendere pageZoom su TUTTE le pagine filo:// farebbe zoomare due volte
// nell'editor (il preload scala la finestra E l'editor scala il foglio), così
// al primo Ctrl + il documento diventerebbe enorme. L'editor si tira fuori con
// `dataset.filoOwnZoom`. Senza quell'opt-out questo test diventa rosso: il
// fattore di zoom della finestra salirebbe sopra 1.
test('filo://editor: Ctrl + scala il foglio e NON la finestra', async ({ app, openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.bringToFront();
  await page.click('#doc');

  const sheetZoom = () => page.evaluate(() => document.getElementById('doc').style.zoom || '');
  expect(await sheetZoom()).toBe('');
  expect(await zoomFactorOf(app, 'editor')).toBeCloseTo(1, 1);

  await page.keyboard.press('Control+=');

  // Il foglio è cresciuto…
  await expect.poll(async () => parseFloat(await sheetZoom()) || 1).toBeGreaterThan(1);
  // …e la finestra è rimasta al 100% (niente doppio zoom).
  expect(await zoomFactorOf(app, 'editor')).toBeCloseTo(1, 1);

  // Ctrl 0 riporta il foglio alla dimensione originale.
  await page.keyboard.press('Control+0');
  await expect.poll(async () => parseFloat(await sheetZoom()) || 1).toBeCloseTo(1, 2);

  // Anche Ctrl+rotella agisce sul foglio, non sulla finestra.
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await expect.poll(async () => parseFloat(await sheetZoom()) || 1).toBeGreaterThan(1);
  expect(await zoomFactorOf(app, 'editor')).toBeCloseTo(1, 1);
});

// ── L'indicatore della percentuale anche zoomando con Ctrl (#427.1) ───────
// FEEDBACK: "Quando si ingrandisce con Ctrl +, Ctrl - o Ctrl con la rotella non
// compare da nessuna parte a che percentuale si è arrivati. Entrando invece in
// modalità zoom col clic sulla rotella, il badge con la percentuale c'è ed è
// anche modificabile a mano." Filo non ha barra degli indirizzi: senza badge
// non esiste NESSUN posto dove leggere lo zoom né un appiglio per tornare
// indietro.
//
// Pre-condizione che senza il fix fallirebbe: zoomando con Ctrl il badge
// #__filo-zoom-badge non veniva mai attaccato al documento → i locator qui
// sotto restano a zero elementi.

// Fotografa badge + percentuale in un colpo solo: il badge di passaggio dura
// un paio di secondi, leggerli con due chiamate separate sarebbe una corsa.
async function badgeSnapshot(page) {
  return page.evaluate(() => {
    const b = document.getElementById('__filo-zoom-badge');
    if (!b) return null;
    const i = document.getElementById('__filo-zoom-percent');
    return { text: b.innerText, value: i ? i.value : null };
  });
}

async function waitBadgeSnapshot(page) {
  for (let i = 0; i < 60; i++) {
    const snap = await badgeSnapshot(page);
    if (snap) return snap;
    await page.waitForTimeout(50);
  }
  return null;
}

test('Ctrl +: compare il badge con la percentuale, e sparisce da solo', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, TALL_PAGE);
  await page.bringToFront();
  await page.locator('body').click(); // focus sulla pagina, puntatore lontano dal badge

  const badge = page.locator('#__filo-zoom-badge');
  await expect(badge).toHaveCount(0); // finché non si zooma, niente badge

  await page.keyboard.press('Control+=');
  const snap = await waitBadgeSnapshot(page);
  expect(snap, 'nessun badge dopo Ctrl +').not.toBeNull();
  expect(snap.text).toMatch(/zoom/i);
  expect(Number(snap.value)).toBeGreaterThan(100); // la percentuale è quella vera
  // Fuori dalla modalità rotella "rotella per zoomare" sarebbe un'istruzione falsa.
  expect(snap.text).not.toMatch(/rotella per zoomare/i);

  // Se ne va da solo: è un riscontro di passaggio, non un pezzo di interfaccia.
  await expect(badge).toHaveCount(0, { timeout: 8000 });

  await page.keyboard.press('Control+0');
});

test('Ctrl+rotella (e pinch del trackpad): compare la percentuale', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, TALL_PAGE);
  await page.bringToFront();
  await page.locator('body').click();

  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');

  const snap = await waitBadgeSnapshot(page);
  expect(snap, 'nessun badge dopo Ctrl+rotella').not.toBeNull();
  expect(Number(snap.value)).toBeGreaterThan(100);

  await page.keyboard.press('Control+0');
});

// L'appiglio per tornare indietro: la percentuale del badge di passaggio si
// scrive a mano come quella della modalità rotella (stesso badge, stesse cose).
test('Ctrl +: la percentuale del badge si può scrivere a mano', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, TALL_PAGE);
  await page.bringToFront();
  await page.locator('body').click();

  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+=');
  await expect.poll(async () => zoomFactorOf(app, '127.0.0.1')).toBeGreaterThan(1.1);

  const percent = page.locator('#__filo-zoom-percent');
  await percent.click();
  await percent.fill('100');
  await percent.press('Enter');

  await expect.poll(async () => zoomFactorOf(app, '127.0.0.1')).toBeCloseTo(1, 1);
});

// Col puntatore sopra il badge il conto alla rovescia si ferma: un campo che
// svanisce mentre lo stai usando non è un campo.
test('Ctrl +: il badge resta finché il puntatore ci sta sopra', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, TALL_PAGE);
  await page.bringToFront();
  await page.locator('body').click();

  await page.keyboard.press('Control+=');
  const badge = page.locator('#__filo-zoom-badge');
  await expect(badge).toBeVisible();
  await badge.hover();

  await page.waitForTimeout(3500); // oltre il doppio dell'attesa di sparizione
  await expect(badge).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/ctrl-zoom-badge.png' });

  // Spostato il puntatore, riparte e sparisce.
  await page.mouse.move(400, 400);
  await expect(badge).toHaveCount(0, { timeout: 8000 });

  await page.keyboard.press('Control+0');
});

test('filo://: anche sulle pagine interne Ctrl + mostra la percentuale', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('domcontentloaded');
  await page.bringToFront();
  await page.locator('body').click({ position: { x: 5, y: 5 } });

  await page.keyboard.press('Control+=');
  const snap = await waitBadgeSnapshot(page);
  expect(snap, 'nessun badge dopo Ctrl + su filo://manage').not.toBeNull();
  expect(Number(snap.value)).toBeGreaterThan(100);

  await page.keyboard.press('Control+0');
});

// Terza strada per lo stesso zoom: i tasti premuti col focus sulla barra di
// Filo, inoltrati dal main. Anche lì l'utente deve vedere la percentuale.
test('Col focus sulla barra di Filo, Ctrl + mostra comunque la percentuale', async ({ app, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('domcontentloaded');

  await pressCtrlOnShell(app, '=');
  const snap = await waitBadgeSnapshot(page);
  expect(snap, 'nessun badge dopo Ctrl + dalla barra').not.toBeNull();
  expect(Number(snap.value)).toBeGreaterThan(100);

  await pressCtrlOnShell(app, '0');
});

// L'editor zooma il foglio da sé (il preload sta fuori): la percentuale la
// mostra lui, altrimenti resterebbe l'unica strada di zoom senza riscontro.
test('filo://editor: Ctrl + mostra la percentuale del foglio', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.bringToFront();
  await page.click('#doc');

  const pill = page.locator('.ed-zoom-pill');
  await expect(pill).toHaveCount(0);

  await page.keyboard.press('Control+=');
  await expect(pill).toBeVisible();
  await expect(pill).toHaveText(/zoom\s*110\s*%/);
  await expect(pill).toHaveClass(/show/);

  // Sparisce da sola.
  await expect(pill).not.toHaveClass(/show/, { timeout: 8000 });

  await page.keyboard.press('Control+0');
});
