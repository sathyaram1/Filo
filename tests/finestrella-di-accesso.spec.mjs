// #1066 — La finestrella di accesso non ha la barra dell'indirizzo: la apre solo il clic dell'utente, anche col blocco
// dei popup spento, e il suo titolo è il sito che la riempie, scritto da Filo e non dalla pagina.
// Regole: setWindowOpenHandler e _hardenAuthPopup in src/main/tabs.js.

import { test, expect } from './fixtures/electron.mjs';

// Le pagine https dei test le serve Filo stesso: niente rete, e i verdetti sui siti restano fuori.
async function servi(app, pagine) {
  await app.evaluate(({ session, net }, pg) => {
    const risposta = (req) => {
      const u = new URL(req.url);
      const html = pg[u.hostname + u.pathname];
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    };
    try { session.defaultSession.protocol.unhandle('https'); } catch (_) {}
    session.defaultSession.protocol.handle('https', risposta);
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: null, rdap: null, ct: null, sandbox: null, llm: null });
  }, pagine);
}

const bloccoPopup = (app, acceso) => app.evaluate(({ BrowserWindow }, a) => {
  BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.security.blockPopups = a;
}, acceso);

// Le finestre che una pagina può far nascere: quelle di Filo no, e il menu a comparsa nasce da solo dopo l'avvio (#1090).
// Appena nata una finestra non ha ancora l'indirizzo: si aspetta che lo abbia, poi si guarda di chi è.
const quante = (app) => app.evaluate(async ({ BrowserWindow }) => {
  const vive = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && !w._filoTabs);
  for (let i = 0; i < 60 && vive().some((w) => !w.webContents.getURL()); i++) await new Promise((r) => setTimeout(r, 50));
  return vive().filter((w) => !/^(filo|data):/.test(w.webContents.getURL())).length;
});

const finestrelle = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .filter((w) => !w._filoTabs && !w.isDestroyed() && /^(https?|about):/.test(w.webContents.getURL()))
  .map((w) => ({ url: w.webContents.getURL(), titolo: w.getTitle(), pagina: w.webContents.getTitle() })));

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL(); } catch (_) { return t.url || ''; } });
});

const FINTA = 'https://login.sito-finto.it/login';
const FINTA_HTML = '<title>Accedi - Google</title><h1>Accedi</h1><input type="password">';
const GOOGLE = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=1&redirect_uri=x';
const GOOGLE_HTML = '<title>Accedi - Account Google</title><h1>Accesso</h1>';

const apriDaSola = (u) => `<title>Articolo</title><p>testo</p><script>addEventListener('load',function(){setTimeout(function(){
  window.open(${JSON.stringify(u)},'x','width=420,height=520')},300)})</script>`;
const bottone = (u) => `<title>Negozio</title><button id="b" style="width:220px;height:60px"
  onclick="window.open(${JSON.stringify(u).replace(/"/g, '&quot;')},'login','width=420,height=520')">Accedi con…</button>`;

test('col blocco dei popup acceso una pagina non apre da sola una finta finestra di accesso', async ({ app, openTab, testServer, avvisi }) => {
  await servi(app, { 'login.sito-finto.it/login': FINTA_HTML });
  const prima = await quante(app);
  await openTab(testServer.html(apriDaSola(FINTA)));
  await expect((await avvisi()).locator('.shell-notif.show', { hasText: 'Bloccato popup' })).toBeVisible({ timeout: 8000 });
  expect(await quante(app)).toBe(prima);
  expect(await finestrelle(app)).toEqual([]);
  expect((await schede(app)).filter((u) => u === FINTA)).toEqual([]);
});

test('col blocco dei popup spento la finestra di accesso chiesta da sola diventa una scheda, con l\'indirizzo in vista', async ({ app, openTab, testServer }) => {
  await servi(app, { 'login.sito-finto.it/login': FINTA_HTML });
  await bloccoPopup(app, false);
  const prima = await quante(app);
  await openTab(testServer.html(apriDaSola(FINTA)));
  await expect.poll(async () => (await schede(app)).filter((u) => u === FINTA).length, { timeout: 8000 }).toBe(1);
  expect(await quante(app)).toBe(prima);
  expect(await finestrelle(app)).toEqual([]);
});

test('il clic su «Accedi con Google» apre la finestrella, e il titolo dice google.com qualunque cosa scriva la pagina', async ({ app, openTab, testServer }) => {
  await servi(app, { 'accounts.google.com/o/oauth2/v2/auth': `${GOOGLE_HTML}<script>setTimeout(function(){document.title='accounts.google.com.sicuro'},400)</script>` });
  const page = await testServer.openReady(openTab, bottone(GOOGLE));
  const prima = await quante(app);
  await page.click('#b');
  await expect.poll(() => finestrelle(app), { timeout: 8000 })
    .toEqual([{ url: GOOGLE, titolo: 'google.com', pagina: 'accounts.google.com.sicuro' }]);
  expect(await quante(app)).toBe(prima + 1);
});

test('la finta pagina di accesso aperta col clic porta nel titolo il suo sito, e il titolo segue il sito quando cambia', async ({ app, openTab, testServer }) => {
  await servi(app, {
    'login.sito-finto.it/login': `${FINTA_HTML}<script>setTimeout(function(){location.href=${JSON.stringify(GOOGLE)}},1500)</script>`,
    'accounts.google.com/o/oauth2/v2/auth': GOOGLE_HTML,
  });
  const page = await testServer.openReady(openTab, bottone(FINTA));
  await page.click('#b');
  await expect.poll(() => finestrelle(app), { timeout: 8000 })
    .toEqual([{ url: FINTA, titolo: 'sito-finto.it', pagina: 'Accedi - Google' }]);
  await expect.poll(() => finestrelle(app), { timeout: 8000 })
    .toEqual([{ url: GOOGLE, titolo: 'google.com', pagina: 'Accedi - Account Google' }]);
});

test('la pagina non toglie alla finestrella la cornice col titolo, né la mette a schermo intero o sopra le altre', async ({ app, openTab, testServer }) => {
  await servi(app, { 'login.sito-finto.it/login': FINTA_HTML });
  const misure = 'width=420,height=520,frame=no,titleBarStyle=hidden,title=Accedi - Google,fullscreen=yes,kiosk=yes,alwaysOnTop=yes,skipTaskbar=yes,transparent=yes,type=splash';
  const page = await testServer.openReady(openTab, `<button id="b" style="width:220px;height:60px"
    onclick="window.open('${FINTA}','login','${misure}')">Accedi</button>`);
  await app.evaluate(({ webContents }, u) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL() === u);
    wc.once('did-create-window', (_w, d) => { globalThis.__opzioniFinestrella = d.options; });
  }, page.url());
  await page.click('#b');
  await expect.poll(() => finestrelle(app), { timeout: 8000 }).toEqual([{ url: FINTA, titolo: 'sito-finto.it', pagina: 'Accedi - Google' }]);
  const o = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && x.webContents.getURL().includes('sito-finto'));
    const d = globalThis.__opzioniFinestrella || {};
    return { frame: d.frame, titleBarStyle: d.titleBarStyle, fullscreen: d.fullscreen, kiosk: d.kiosk, transparent: d.transparent,
      type: d.type, skipTaskbar: d.skipTaskbar, width: d.width, schermoIntero: w.isFullScreen(), chiosco: w.isKiosk(), sopra: w.isAlwaysOnTop() };
  });
  expect(o).toEqual({ frame: true, titleBarStyle: 'default', width: 420, schermoIntero: false, chiosco: false, sopra: false });
});

test('la finestrella svuotata e riscritta dalla pagina che l\'ha aperta porta nel titolo il sito di quella pagina', async ({ app, openTab, testServer }) => {
  const accesso = `${testServer.html('<title>ACCESSO</title>')}?client_id=a&response_type=code`;
  const page = await testServer.openReady(openTab, `<button id="b" style="width:220px;height:60px" onclick="var p=window.open(
    ${JSON.stringify(accesso).replace(/"/g, '&quot;')},'login','width=420,height=520');setTimeout(function(){p.location='about:blank';
    setTimeout(function(){p.document.open();p.document.write('<title>Accedi - Google</title>');p.document.close()},700)},1500)">Accedi</button>`);
  const sito = new URL(testServer.origin).host;
  await page.click('#b');
  await expect.poll(() => finestrelle(app), { timeout: 8000 }).toEqual([expect.objectContaining({ titolo: sito, pagina: 'ACCESSO' })]);
  await expect.poll(() => finestrelle(app), { timeout: 8000 }).toEqual([expect.objectContaining({ titolo: sito, pagina: 'Accedi - Google' })]);
});

test('dalla finestrella, col blocco spento, una seconda finestra di accesso chiesta senza clic diventa una scheda', async ({ app, openTab, testServer }) => {
  await servi(app, {
    'accounts.google.com/o/oauth2/v2/auth': `${GOOGLE_HTML}<script>setTimeout(function(){window.open(${JSON.stringify(FINTA)},'y','width=400,height=500')},800)</script>`,
    'login.sito-finto.it/login': FINTA_HTML,
  });
  await bloccoPopup(app, false);
  const page = await testServer.openReady(openTab, bottone(GOOGLE));
  await page.click('#b');
  await expect.poll(async () => (await schede(app)).filter((u) => u === FINTA).length, { timeout: 8000 }).toBe(1);
  expect((await finestrelle(app)).map((f) => f.url)).toEqual([GOOGLE]);
});

const dentroLoSchermo = (app) => app.evaluate(({ BrowserWindow, screen }) => {
  const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && !x.isDestroyed() && x.webContents.getURL().includes('sito-finto'));
  if (!w) return null;
  const b = w.getBounds();
  const a = screen.getDisplayMatching(b).workArea;
  return { dentro: b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height, schermoIntero: w.isFullScreen() };
});

for (const [dove, misure] of [
  ['sopra il bordo alto', 'width=420,height=520,left=100,top=-400'],
  ['in alto a sinistra fuori dallo schermo', 'width=420,height=520,left=-2000,top=-2000'],
  ['più grande dello schermo', 'width=9000,height=9000,left=0,top=-60'],
]) {
  test(`la finestrella che la pagina chiede ${dove} nasce dentro lo schermo, con la barra del titolo in vista`, async ({ app, openTab, testServer }) => {
    await servi(app, { 'login.sito-finto.it/login': FINTA_HTML });
    const page = await testServer.openReady(openTab, `<button id="b" style="width:220px;height:60px"
      onclick="window.open('${FINTA}','login','${misure}')">Accedi</button>`);
    await page.click('#b');
    await expect.poll(() => dentroLoSchermo(app), { timeout: 8000 }).toEqual({ dentro: true, schermoIntero: false });
  });
}

test('la pagina dentro la finestrella non la sposta fuori dallo schermo né la mette a schermo intero', async ({ app, openTab, testServer }) => {
  await servi(app, { 'login.sito-finto.it/login': `${FINTA_HTML}<button id="avanti" style="position:fixed;left:0;top:0;width:200px;height:80px"
    onclick="document.documentElement.requestFullscreen().catch(function(){})">Avanti</button>
    <script>setTimeout(function(){window.moveTo(-2000,-2000);window.resizeTo(9000,9000)},600)</script>` });
  const page = await testServer.openReady(openTab, bottone(FINTA));
  await page.click('#b');
  await expect.poll(() => dentroLoSchermo(app), { timeout: 8000 }).not.toBeNull();
  await page.waitForTimeout(1500);
  expect(await dentroLoSchermo(app)).toEqual({ dentro: true, schermoIntero: false });
  await app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && x.webContents.getURL().includes('sito-finto')).webContents;
    wc.sendInputEvent({ type: 'mouseDown', x: 40, y: 30, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: 40, y: 30, button: 'left', clickCount: 1 });
  });
  await page.waitForTimeout(1500);
  expect(await dentroLoSchermo(app)).toEqual({ dentro: true, schermoIntero: false });
});
