// #589.5 — la foto della pagina (e della barra) la chiede un sito dal mondo del preload (isolamento dei contesti rotto):
// la ottiene solo la pagina in vista, e inquadra sé stessa; una scheda di sfondo o un popup di accesso non ricevono
// l'immagine del sito che l'utente sta guardando. Regola: src/main/services/fotoDellaPagina.js.

import { test, expect } from './fixtures/electron.mjs';

const MONDO_CONTENT_SCRIPT = 999;
const pagina = (colore, testo) => `<style>html,body{background:${colore};height:100%;margin:0}</style><h1>${testo}</h1>`;
const chiedi = (type) => `chrome.runtime.sendMessage(${JSON.stringify({ type })})`;

// Il codice gira nel preload della pagina (scheda o popup) il cui indirizzo contiene `pezzo`.
function dalPreload(app, pezzo) {
  return (type) => app.evaluate(async ({ BrowserWindow }, { p, code, mondo }) => {
    const wcs = BrowserWindow.getAllWindows().flatMap((w) => (w._filoTabs
      ? w._filoTabs.tabs.map((t) => t.view.webContents)
      : [w.webContents]));
    const wc = wcs.find((x) => !x.isDestroyed() && String(x.getURL()).includes(p));
    if (!wc) return { nonTrovata: true };
    return wc.executeJavaScriptInIsolatedWorld(mondo, [{ code }]);
  }, { p: pezzo, code: chiedi(type), mondo: MONDO_CONTENT_SCRIPT });
}

// Il colore al centro della foto: dice di quale pagina è.
async function coloreDi(app, dataUrl) {
  const c = await app.evaluate(({ nativeImage }, u) => {
    const img = nativeImage.createFromDataURL(u);
    const { width, height } = img.getSize();
    if (!width || !height) return null;
    const bmp = img.toBitmap();
    const i = ((Math.floor(height / 2) * width) + Math.floor(width / 2)) * 4;
    return { r: bmp[i + 2], g: bmp[i + 1], b: bmp[i] };
  }, dataUrl);
  if (!c) return 'vuota';
  if (c.r > 200 && c.g < 80 && c.b < 80) return 'rossa';
  if (c.b > 200 && c.r < 80 && c.g < 80) return 'blu';
  if (c.g > 150 && c.r < 80 && c.b < 80) return 'verde';
  if (c.r > 200 && c.b > 200 && c.g < 80) return 'magenta';
  return JSON.stringify(c);
}

async function fotoDi(app, chi) {
  let r = null;
  await expect.poll(async () => {
    r = await chi('capture_visible_tab');
    return (r?.dataUrl || '').length;
  }, { timeout: 15000 }).toBeGreaterThan(1000);
  return coloreDi(app, r.dataUrl);
}

async function rifiutate(chi, dove) {
  for (const type of ['capture_visible_tab', 'capture_feedback_topbar']) {
    const r = await chi(type);
    expect(r?.nonTrovata, `${dove}: pagina non trovata`).toBeFalsy();
    expect(r?.dataUrl, `${type}: ${dove} ha avuto una foto`).toBeFalsy();
    expect(r).toMatchObject({ ok: false, code: 'fuori_vista' });
  }
}

const attiva = (app, pezzo) => app.evaluate(({ BrowserWindow }, p) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  tm.activate(tm.tabs.find((t) => String(t.url || '').includes(p)).id);
}, pezzo);

test('la foto la ha solo la scheda in vista, ed è la sua: una scheda di sfondo non vede il sito aperto davanti', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, pagina('#ff0000', 'sito A'));
  await testServer.openReady(openTab, pagina('#0000ff', 'sito B, la banca'), { pubblico: true });
  const a = dalPreload(app, '127.0.0.1');
  const b = dalPreload(app, 'sito-pubblico.test');

  await rifiutate(a, 'la scheda di sfondo');
  expect(await fotoDi(app, b)).toBe('blu');
  const barra = await b('capture_feedback_topbar');
  expect(barra?.ok, JSON.stringify(barra)).toBe(true);

  // L'utente torna su A: adesso la foto è di A, e B resta fuori.
  await attiva(app, '127.0.0.1');
  expect(await fotoDi(app, a)).toBe('rossa');
  await rifiutate(b, 'la scheda lasciata');
});

async function apriPopupDiAccesso(app, openTab, testServer) {
  const sito = await testServer.openReady(openTab, pagina('#ff0000', 'sito con «Accedi con…»'));
  const login = `${testServer.html(pagina('#00ff00', 'accedi'))}?client_id=filo5895&redirect_uri=http%3A%2F%2Fsito.example%2Fcb`;
  await sito.evaluate((u) => { window.open(u, '_blank', 'width=480,height=600'); }, login);
  await expect.poll(() => app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes('client_id=filo5895'));
    if (!w) return 'nessun popup';
    try { return await w.webContents.executeJavaScript('document.documentElement.dataset.filoContentReady || "non pronto"'); } catch (_) { return 'non pronto'; }
  }), { timeout: 10000 }).toBe('1');
  // L'utente passa a un'altra scheda, quella della banca: il popup resta aperto.
  await testServer.openReady(openTab, pagina('#0000ff', 'sito B, la banca'), { pubblico: true });
}

async function immagineNegliAppunti(shell) {
  let immagine = '';
  await expect.poll(async () => {
    const r = await shell.evaluate(() => window.filoShell.message({ type: 'get_clipboard_history' }));
    immagine = ((r && r.items) || []).find((v) => v && v.type === 'image')?.dataUrl || '';
    return immagine.length;
  }, { timeout: 20000 }).toBeGreaterThan(1000);
  return immagine;
}

async function screenshotDalMenu(dove) {
  await dove.locator('h1').click({ button: 'right' });
  await expect(dove.locator('.sn-menu')).toBeVisible();
  await dove.locator('.sn-menu [data-sn-icon-id="screenshot"]').click();
}

test('un popup di accesso fotografa sé stesso, anche dopo che l\'utente è passato a un\'altra scheda', async ({ app, openTab, testServer }) => {
  await apriPopupDiAccesso(app, openTab, testServer);
  const popup = dalPreload(app, 'client_id=filo5895');

  expect(await fotoDi(app, popup)).toBe('verde');
  // Il popup non ha una barra sua: quella della finestra principale porta il sito in vista.
  const barra = await popup('capture_feedback_topbar');
  expect(barra?.dataUrl, 'il popup ha avuto la barra della finestra principale').toBeFalsy();
  expect(barra).toMatchObject({ ok: false, code: 'fuori_vista' });
});

test('Screenshot dal menu fotografa la pagina dove l\'utente l\'ha chiesto: la scheda in vista e il popup di accesso', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina('#ff00ff', 'pagina da fotografare'));
  await screenshotDalMenu(page);
  expect(await coloreDi(app, await immagineNegliAppunti(shell))).toBe('magenta');

  await shell.evaluate(() => window.filoShell.message({ type: 'clear_clipboard_history' }));
  await apriPopupDiAccesso(app, openTab, testServer);
  const finestra = app.windows().find((w) => w.url().includes('client_id=filo5895'));
  expect(finestra, 'la pagina del popup non si trova').toBeTruthy();
  await screenshotDalMenu(finestra);
  expect(await coloreDi(app, await immagineNegliAppunti(shell))).toBe('verde');
});
