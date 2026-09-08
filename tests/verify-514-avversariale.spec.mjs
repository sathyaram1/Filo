// #514 avversariale — «esc deve far uscire dalla modalità schermo intero».
// Porte non coperte dagli spec esistenti: pagina interna filo://, cicli di
// entra/esci, stato residuo della deroga, scheda nuova aperta a tutto schermo,
// pagina che si mangia i tasti, Esc reale sul fullscreen del sito.
import { test, expect } from './fixtures/electron.mjs';

function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tabs = win._filoTabs;
    return {
      contentFullscreen: tabs.contentFullscreen,
      pageFullscreen: tabs.pageFullscreen,
      pageFullscreenTabId: tabs.pageFullscreenTabId,
      osFullscreen: win.isFullScreen(),
      topChrome: tabs.topChromeHeight(),
      nTabs: tabs.tabs.length,
    };
  });
}

function premiEsc(app, { dallaBarra = false } = {}) {
  return app.evaluate(({ BrowserWindow }, barra) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tabs = win._filoTabs;
    const active = tabs.tabs.find((t) => t.id === tabs.activeId);
    const wc = barra ? win.webContents : active.view.webContents;
    try { wc.focus(); } catch (_) {}
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  }, dallaBarra);
}

function accendi(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    win._filoTabs.toggleContentFullscreen();
  });
}

async function fullscreenDalSito(app, selettore = '#box') {
  await app.evaluate(({ BrowserWindow }, sel) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tabs = win._filoTabs;
    const active = tabs.tabs.find((t) => t.id === tabs.activeId);
    return active.view.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(sel)}).requestFullscreen().catch(()=>{}); true`,
      true,
    );
  }, selettore);
  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 8000 }).toBe(true);
}

const PAGINA = '<html><body style="margin:0"><div id="box" style="width:100px;height:100px;background:#09f"></div></body></html>';
// Pagina "ostile": si mangia ogni tasto in capture, come fanno i player e i
// giochi che rimappano la tastiera.
const PAGINA_OSTILE = `<html><body style="margin:0">
<div id="box" style="width:100px;height:100px;background:#f30"></div>
<script>window.addEventListener('keydown', (e) => { e.preventDefault(); e.stopPropagation(); }, true);</script>
</body></html>`;

test('pagina interna di Filo: Esc esce dallo schermo intero', async ({ app, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await accendi(app);
  await expect.poll(async () => (await stato(app)).contentFullscreen).toBe(true);
  expect((await stato(app)).topChrome).toBe(0);

  await premiEsc(app);
  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 5000 }).toBe(false);
  expect((await stato(app)).topChrome).toBeGreaterThan(0);
});

test('entra ed esci tre volte di fila: nessuno stato residuo', async ({ app, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  for (let i = 0; i < 3; i++) {
    await accendi(app);
    await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 5000 }).toBe(true);
    await premiEsc(app);
    await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 5000 }).toBe(false);
    const s = await stato(app);
    expect(s.osFullscreen).toBe(false);
    expect(s.pageFullscreen).toBe(false);
  }
});

test('due Esc di fila (doppio tocco rapido) non lasciano stati strani', async ({ app, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await accendi(app);
  await expect.poll(async () => (await stato(app)).contentFullscreen).toBe(true);
  await premiEsc(app);
  await premiEsc(app);
  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 5000 }).toBe(false);
  expect((await stato(app)).osFullscreen).toBe(false);
});

test('Esc VERO sulla scheda che il sito ha messo a tutto schermo: si esce davvero', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  await fullscreenDalSito(app);
  await premiEsc(app);
  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 8000 }).toBe(false);
  await expect.poll(async () => (await stato(app)).pageFullscreen, { timeout: 8000 }).toBe(false);
  await expect.poll(async () => (await stato(app)).osFullscreen, { timeout: 8000 }).toBe(false);
});

test('sito a tutto schermo che si mangia i tasti: Esc esce lo stesso', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA_OSTILE);
  await fullscreenDalSito(app);
  await premiEsc(app);
  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 8000 }).toBe(false);
});

test('dopo il tutto schermo del sito, quello di Filo si spegne ancora con Esc', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  await fullscreenDalSito(app);
  await premiEsc(app, { dallaBarra: true });
  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 8000 }).toBe(false);
  await expect.poll(async () => (await stato(app)).pageFullscreenTabId, { timeout: 8000 }).toBe(null);

  // Ora la stessa scheda, a tutto schermo per la strada di Filo: nessuna deroga
  // residua deve trattenere l'Esc.
  await accendi(app);
  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 5000 }).toBe(true);
  await premiEsc(app);
  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 8000 }).toBe(false);
});

test('scheda nuova aperta mentre si è a tutto schermo: Esc esce, e il menu non mente', async ({ app, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await accendi(app);
  await expect.poll(async () => (await stato(app)).contentFullscreen).toBe(true);

  const nuova = await openTab('filo://editor/editor.html');
  await nuova.waitForLoadState('domcontentloaded').catch(() => {});
  expect((await stato(app)).contentFullscreen).toBe(true);

  await premiEsc(app);
  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 8000 }).toBe(false);
});

test('a tutto schermo la view copre davvero tutta la finestra, e dopo Esc torna sotto la barra', async ({ app, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  const geom = () => app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tabs = win._filoTabs;
    const active = tabs.tabs.find((t) => t.id === tabs.activeId);
    return { b: active.view.getBounds(), c: win.getContentBounds() };
  });
  await accendi(app);
  await expect.poll(async () => (await stato(app)).contentFullscreen).toBe(true);
  await expect.poll(async () => (await geom()).b.y, { timeout: 5000 }).toBe(0);

  await premiEsc(app);
  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 5000 }).toBe(false);
  await expect.poll(async () => (await geom()).b.y, { timeout: 5000 }).toBeGreaterThan(0);
});
