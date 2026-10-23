// #1246 — a schermo intero le schede compaiono col puntatore fermo sul bordo alto e spariscono portandolo sulla
// pagina, con le attese della barra laterale; non per uno sfioramento, non nello schermo pieno di un video, e si spengono.

import { test, expect } from './fixtures/electron.mjs';
import { barraPage, menuAperto, statoBarra } from './helpers/barra.mjs';

const PAGINA = `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif;height:1400px">
  <h1>Schermo intero</h1><p id="p">Pagina di prova.</p></body></html>`;
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

const stato = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const tm = w._filoTabs;
  const t = tm.tabs.find((x) => x.id === tm.activeId);
  return {
    schermoIntero: !!tm.contentFullscreen,
    visibili: tm.schedeInAlto.visibili,
    alto: t.view.getBounds().y,
    fila: tm.chromeCompact ? tm.tabRowHeight : tm.shellHeight,
    barraY: tm.barra.vista ? tm.barra.vista.getBounds().y : null,
  };
});
// Il mouse di Playwright arriva alla scheda come quello vero, senza tasti premuti (sendInputEvent li dà per premuti).
const muovi = (page, x, y) => page.mouse.move(x, y);
const schermoIntero = (app, on) => app.evaluate(({ BrowserWindow }, v) => {
  BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.setContentFullscreen(v);
}, on);

test('a schermo intero, col puntatore fermo in alto le schede compaiono; portandolo sulla pagina spariscono', async ({ app, openTab, testServer, shell }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await schermoIntero(app, true);
  await expect.poll(async () => (await stato(app)).alto).toBe(0);

  await muovi(page, 400, 300);
  await muovi(page, 400, 0);
  await expect.poll(async () => (await stato(app)).visibili, { timeout: 4000 }).toBe(true);
  const s = await stato(app);
  expect(s.alto, 'la pagina scende sotto la fila delle schede').toBe(s.fila);
  expect(s.barraY, 'la barra laterale comincia sotto le schede').toBe(s.fila);
  await expect(shell.locator('.tab').first()).toBeVisible();
  // Sulla fila il puntatore la tiene giù.
  await shell.mouse.move(200, 10);
  await pausa(700);
  expect((await stato(app)).visibili).toBe(true);

  await muovi(page, 400, 300);
  await expect.poll(async () => (await stato(app)).alto, { timeout: 4000 }).toBe(0);
  expect((await stato(app)).visibili).toBe(false);
  expect((await stato(app)).schermoIntero, 'resta a schermo intero').toBe(true);
});

test('uno sfioramento del bordo o un trascinamento non le fanno scendere, e fuori dallo schermo intero non c\'entrano', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await schermoIntero(app, true);
  await expect.poll(async () => (await stato(app)).alto).toBe(0);
  await muovi(page, 400, 0);
  await muovi(page, 400, 120);
  await pausa(700);
  expect((await stato(app)).visibili, 'passato di corsa').toBe(false);
  await page.mouse.down();
  await muovi(page, 400, 0);
  await pausa(700);
  expect((await stato(app)).visibili, 'col tasto premuto si seleziona, non si chiedono le schede').toBe(false);
  await page.mouse.up();
  await muovi(page, 400, 200);

  // Scese e poi Esc: fuori dallo schermo intero la cornice torna quella di sempre, senza schede «scese» rimaste.
  await muovi(page, 400, 0);
  await expect.poll(async () => (await stato(app)).visibili, { timeout: 4000 }).toBe(true);
  await schermoIntero(app, false);
  await expect.poll(async () => (await stato(app)).schermoIntero).toBe(false);
  expect((await stato(app)).visibili).toBe(false);
  await muovi(page, 400, 0);
  await pausa(700);
  expect((await stato(app)).visibili).toBe(false);
});

test('nello schermo pieno di un video le schede non scendono, e da Preferenze si spengono', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await schermoIntero(app, true);
  await expect.poll(async () => (await stato(app)).alto).toBe(0);
  // Lo schermo pieno lo «chiede la pagina»: lì in alto c'è solo l'avviso col nome del sito.
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    tm.pageFullscreen = true;
    tm.pageFullscreenTabId = tm.activeId;
  });
  await muovi(page, 400, 0);
  await pausa(700);
  expect((await stato(app)).visibili).toBe(false);
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    tm.pageFullscreen = false;
    tm.pageFullscreenTabId = null;
  });

  await schermoIntero(app, false);

  const sito = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.activeId);
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#barraSchede')).toBeChecked();
  await pref.locator('#barraSchede').uncheck();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).barraLaterale.schede)).toBe(false);
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.activate(id), sito);
  await schermoIntero(app, true);
  await expect.poll(async () => (await stato(app)).alto).toBe(0);
  await muovi(page, 400, 120);
  await muovi(page, 400, 0);
  await pausa(700);
  expect((await stato(app)).visibili, 'spente in Preferenze').toBe(false);
});

// #1343 — un riquadro di un altro sito in cima alla pagina non nasconde il bordo; quello a metà pagina non lo imita.
test('sopra un riquadro di un altro sito in cima le schede compaiono; sul bordo alto di uno a metà pagina no', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html('<!doctype html><html><body style="margin:0;background:#cde;height:100vh">Riquadro</body></html>', { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
    <iframe id="cima" src="${dentro}" style="display:block;width:100%;height:250px;border:0"></iframe>
    <div style="height:250px">Articolo</div>
    <iframe id="meta" src="${dentro}" style="display:block;width:600px;height:250px;border:0;margin-left:100px"></iframe>
    <div style="height:900px"></div></body></html>`);
  await expect.poll(() => page.frames().length).toBeGreaterThan(2);
  await schermoIntero(app, true);
  await expect.poll(async () => (await stato(app)).alto).toBe(0);

  const meta = await page.locator('#meta').boundingBox();
  await muovi(page, 400, meta.y + 100);
  await page.mouse.move(400, meta.y + 1, { steps: 4 });
  await pausa(1200);
  expect((await stato(app)).visibili, 'a metà pagina il bordo di un riquadro non è il bordo dello schermo').toBe(false);

  await muovi(page, 400, 150);
  await page.mouse.move(400, 0, { steps: 4 });
  await expect.poll(async () => (await stato(app)).visibili, { timeout: 4000 }).toBe(true);
});

// Le schede scoperte: due schede, così la fila ha una scheda su cui aprire il menu.
async function scopri(app, openTab, testServer) {
  await testServer.openReady(openTab, '<!doctype html><html><head><title>Prima</title></head><body><h1>Prima</h1></body></html>');
  const page = await testServer.openReady(openTab, PAGINA);
  await schermoIntero(app, true);
  await expect.poll(async () => (await stato(app)).alto).toBe(0);
  await muovi(page, 400, 200);
  await page.mouse.move(400, 0, { steps: 4 });
  await expect.poll(async () => (await stato(app)).visibili, { timeout: 4000 }).toBe(true);
  return page;
}
const allaShell = (app, ev) => app.evaluate(({ BrowserWindow }, e) => {
  BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).webContents.sendInputEvent(e);
}, ev);
const allaPagina = (app, ev) => app.evaluate(({ BrowserWindow }, e) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
  tm.tabs.find((x) => x.id === tm.activeId).view.webContents.sendInputEvent(e);
}, ev);

test('a tasto giù sulla pagina le schede restano: un clic dato subito su un collegamento in cima lo segue (#1343)', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:16px sans-serif;height:1400px">
    <div style="height:100px"></div><a id="link" href="#arrivato" style="display:inline-block;height:20px;margin-left:200px">vai</a>
    <div style="height:400px"></div><h2 id="arrivato">Capitolo</h2></body></html>`);
  await schermoIntero(app, true);
  await expect.poll(async () => (await stato(app)).alto).toBe(0);
  await muovi(page, 400, 200);
  await page.mouse.move(400, 0, { steps: 4 });
  await expect.poll(async () => (await stato(app)).visibili, { timeout: 4000 }).toBe(true);
  await pausa(300);
  const box = await page.locator('#link').boundingBox();
  const x = Math.round(box.x + 20);
  const y = Math.round(box.y + 10);
  // Arrivo sul collegamento e pressione con i tempi di una mano: l'uscita delle schede scade a tasto giù.
  await allaPagina(app, { type: 'mouseMove', x, y });
  await pausa(300);
  await allaPagina(app, { type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await pausa(700);
  expect((await stato(app)).visibili, 'a tasto giù la pagina non si sposta sotto il puntatore').toBe(true);
  await allaPagina(app, { type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  await expect.poll(() => page.evaluate(() => location.hash), { timeout: 3000 }).toBe('#arrivato');
  // Dopo il rilascio se ne vanno con l'attesa di sempre.
  await expect.poll(async () => (await stato(app)).visibili, { timeout: 4000 }).toBe(false);
});

test('un collegamento trascinato contro il bordo alto fa arrivare le schede; una selezione di testo no (#1343)', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:20px sans-serif;height:1400px">
    <p id="testo" style="margin:200px 0 0 300px">Un paragrafo da selezionare col mouse.</p>
    <a id="link" href="https://example.org/" style="display:inline-block;margin:100px 0 0 300px">collegamento da portare</a></body></html>`);
  await page.evaluate(() => document.addEventListener('dragstart', () => { window.__trascina = true; }));
  await schermoIntero(app, true);
  await expect.poll(async () => (await stato(app)).alto).toBe(0);
  await pausa(400);

  const t = await page.locator('#testo').boundingBox();
  await page.mouse.move(t.x + 5, t.y + 10);
  await page.mouse.down();
  await page.mouse.move(t.x + 5, 0, { steps: 8 });
  await pausa(1000);
  expect((await stato(app)).visibili, 'chi seleziona arrivando in alto non chiede le schede').toBe(false);
  await page.mouse.up();
  await pausa(300);

  const l = await page.locator('#link').boundingBox();
  await page.mouse.move(l.x + 20, l.y + 8);
  await page.mouse.down();
  await page.mouse.move(l.x + 30, l.y + 4, { steps: 3 });
  await page.mouse.move(l.x + 30, 0, { steps: 8 });
  // Fermo contro il bordo: Chromium ripete il passaggio sopra la pagina finché il tasto resta giù.
  await expect.poll(async () => { await page.mouse.move(l.x + 30, 0); return (await stato(app)).visibili; }, { timeout: 4000 }).toBe(true);
  expect(await page.evaluate(() => !!window.__trascina), 'era un trascinamento').toBe(true);
  await page.mouse.up();
});

test('il quadrato fra le schede scoperte dice «Esci da schermo intero» e ne esce; fuori torna «Massimizza» (#1343)', async ({ app, shell, openTab, testServer }) => {
  await scopri(app, openTab, testServer);
  const max = shell.locator('#win-max');
  await expect(max).toHaveAttribute('aria-label', 'Esci da schermo intero');
  const box = await max.boundingBox();
  await shell.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await max.click();
  await expect.poll(async () => (await stato(app)).schermoIntero, { timeout: 3000 }).toBe(false);
  await expect(max).toHaveAttribute('aria-label', 'Massimizza');
  await expect(max).toHaveAttribute('data-tip', 'Massimizza');
});

for (const [nome, dove] of [['di una scheda', '.tab:has-text("Prima")'], ['della linguetta della barra', '#barra-maniglia']]) {
  test(`col menu ${nome} aperto dalla fila le schede restano finché il menu è aperto (#1343)`, async ({ app, shell, openTab, testServer }) => {
    await scopri(app, openTab, testServer);
    const bersaglio = shell.locator(dove).first();
    const box = await bersaglio.boundingBox();
    await shell.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await bersaglio.click({ button: 'right' });
    const menu = await menuAperto(app);
    expect(menu, 'il menu si apre').not.toBeNull();
    // Il puntatore scende nel menu: la shell sotto lo sente uscire.
    await allaShell(app, { type: 'mouseLeave', x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height + 20) });
    await menu.mouse.move(20, 20);
    await menu.mouse.move(30, 40, { steps: 3 });
    await pausa(1200);
    expect((await stato(app)).visibili).toBe(true);
  });
}

test('la barra laterale aperta dalla linguetta nella fila resta ferma sotto il puntatore (#1343)', async ({ app, shell, openTab, testServer }) => {
  await scopri(app, openTab, testServer);
  const maniglia = shell.locator('#barra-maniglia');
  const box = await maniglia.boundingBox();
  await shell.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await maniglia.click();
  const barra = await barraPage(app);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await pausa(400);
  const prima = await statoBarra(app);
  await allaShell(app, { type: 'mouseLeave', x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height + 4) });
  const home = await barra.locator('#nav .ico[data-id="home"]').boundingBox();
  const x = home.x + home.width / 2;
  const y = home.y + home.height / 2;
  await barra.mouse.move(x, y, { steps: 3 });
  await pausa(1500);
  const dopo = await statoBarra(app);
  const sotto = await barra.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('.ico')?.dataset.id || null,
    [x, y + (prima.bounds.y - dopo.bounds.y)]);
  expect(dopo.aperta).toBe(true);
  expect(sotto, 'sotto il puntatore fermo c\'è ancora Home').toBe('home');
});
