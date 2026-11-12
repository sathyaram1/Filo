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

function nellaPagina(app, tabId, codice) {
  return app.evaluate(({ BrowserWindow }, { tabId, codice }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => t.id === tabId);
    return tab.view.webContents.executeJavaScript(codice, true);
  }, { tabId, codice });
}

test('la richiesta di fullscreen della pagina porta la view a tutto schermo', async ({ app, shell, openTab, testServer }) => {
  const url = testServer.html(
    '<html><body style="margin:0"><div id="box" style="width:100px;height:100px;background:#09f"></div></body></html>',
  );
  await openTab(url);
  const id = await activeId(shell);

  // All'inizio non siamo in fullscreen.
  expect(await fsState(app)).toBe(false);

  // requestFullscreen ha bisogno di un gesto utente: executeJavaScript con userGesture=true.
  await nellaPagina(app, id, 'document.getElementById("box").requestFullscreen().catch(()=>{}); true');

  // Il TabManager deve essere entrato in modalità contenuto a tutto schermo.
  await expect.poll(() => fsState(app), { timeout: 8_000 }).toBe(true);
  // enter-html-full-screen arriva al main prima che il documento abbia il suo fullscreenElement: un
  // exitFullscreen in quella finestra di millisecondi è rifiutato («Document not active») e niente esce (#2091.3).
  await expect.poll(() => nellaPagina(app, id, 'document.fullscreenElement?.id || null'), { timeout: 8_000 }).toBe('box');

  // Uscita: la pagina esce dal fullscreen → leave-html-full-screen → torna false.
  const uscita = await nellaPagina(app, id, 'document.exitFullscreen().then(() => "ok", (e) => String(e))');
  expect(uscita, 'la pagina deve poter uscire dal suo schermo intero').toBe('ok');

  await expect.poll(() => fsState(app), { timeout: 8_000 }).toBe(false);
});
