// Il pulsante "schermo intero" di un sito (HTML5 requestFullscreen, es. il
// player di YouTube) deve portare DAVVERO la pagina a tutto schermo: la
// WebContentsView attiva copre l'intera finestra, nascondendo la barra delle
// tab. Feedback "non funziona il tasto a schermo intero del sito".
//
// Il test ASSERISCE il successo: dopo una requestFullscreen della pagina, lo
// stato `contentFullscreen` del TabManager diventa true (la view sale a top=0).
// Senza gli handler enter/leave-html-full-screen lo stato resterebbe false e
// l'assert sarebbe rosso. Verifica anche l'uscita (leave → torna false).

import { test, expect } from './fixtures/electron.mjs';

async function activeId(shell) {
  return shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
}

function fsState(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return win ? win._filoTabs.contentFullscreen : null;
  });
}

test('la richiesta di fullscreen della pagina porta la view a tutto schermo', async ({ app, shell, openTab, testServer }) => {
  const url = testServer.html(
    '<html><body style="margin:0"><div id="box" style="width:100px;height:100px;background:#09f"></div></body></html>',
  );
  await openTab(url);
  const id = await activeId(shell);

  // All'inizio non siamo in fullscreen.
  expect(await fsState(app)).toBe(false);

  // requestFullscreen ha bisogno di un gesto utente: lo forniamo eseguendo lo
  // script con userGesture=true sul webContents della tab attiva.
  await app.evaluate(({ BrowserWindow }, tabId) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => t.id === tabId);
    return tab.view.webContents.executeJavaScript(
      'document.getElementById("box").requestFullscreen().catch(()=>{}); true',
      true,
    );
  }, id);

  // Il TabManager deve essere entrato in modalità contenuto a tutto schermo.
  await expect.poll(() => fsState(app), { timeout: 8_000 }).toBe(true);

  // Uscita: la pagina esce dal fullscreen → leave-html-full-screen → torna false.
  const r = await app.evaluate(({ BrowserWindow }, tabId) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => t.id === tabId);
    globalThis.__diag.push(`${Date.now() - globalThis.__t0} exit call isFS=${win.isFullScreen()}`);
    return tab.view.webContents.executeJavaScript('(async () => { const fe = !!document.fullscreenElement; try { await document.exitFullscreen(); return "ok fe=" + fe; } catch (e) { return "rej fe=" + fe + " " + e; } })()', true);
  }, id);
  try {
    await expect.poll(() => fsState(app), { timeout: 8_000 }).toBe(false);
  } finally {
    const d = await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs); return [...globalThis.__diag, `end isFS=${win.isFullScreen()} cf=${win._filoTabs.contentFullscreen} pf=${win._filoTabs.pageFullscreen}`]; });
    console.log('DIAG', r, JSON.stringify(d));
  }
});
