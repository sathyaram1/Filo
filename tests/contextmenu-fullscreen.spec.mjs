// Feedback alpha: «dentro la pagina del video non riesco a inviare il feedback
// perché non funziona il tasto destro». Causa: quando un player va a tutto
// schermo (HTML5 requestFullscreen), il browser disegna SOLO l'elemento
// fullscreen e i suoi discendenti (top layer). Il menu contestuale di Filo era
// appeso a <html>, fuori da quell'elemento → restava nascosto dietro al video,
// quindi il tasto destro "non faceva niente". Fix: montare il menu dentro
// document.fullscreenElement quando esiste.
//
// Il test ASSERISCE il successo: con un elemento a tutto schermo, il tasto
// destro fa comparire il menu Filo ED è figlio dell'elemento fullscreen (senza
// il fix sarebbe figlio di <html> e l'assert sarebbe rosso).

import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0">
  <div id="stage" style="width:480px;height:320px;background:#000;position:relative">
    <video id="player" width="320" height="180" style="background:#111"></video>
  </div>
</body></html>`;

test('col contenuto a tutto schermo il tasto destro apre il menu Filo nel top layer', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);

  // Entra in fullscreen HTML5 su #stage (serve un gesto utente → userGesture=true).
  await app.evaluate(({ BrowserWindow }, tabId) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => t.id === tabId);
    return tab.view.webContents.executeJavaScript(
      'document.getElementById("stage").requestFullscreen().catch(()=>{}); true', true);
  }, id);

  await page.waitForFunction(
    () => document.fullscreenElement && document.fullscreenElement.id === 'stage',
    null, { timeout: 8_000 },
  );

  // Tasto destro sul player, dentro l'elemento a tutto schermo.
  await page.locator('#player').click({ button: 'right' });

  // Il menu Filo compare…
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 8_000 });
  // …ed è montato DENTRO l'elemento fullscreen (altrimenti sarebbe nel sottoalbero
  // sbagliato e invisibile sotto al video).
  const insideFs = await page.evaluate(() => {
    const m = document.querySelector('.sn-menu');
    const fs = document.fullscreenElement;
    return !!(m && fs && fs.contains(m));
  });
  expect(insideFs).toBe(true);
});
