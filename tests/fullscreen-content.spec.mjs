// Feedback alpha: la voce "Schermo intero" del menu tasto destro deve rendere
// il CONTENUTO della pagina a tutto schermo, nascondendo la barra (tab +
// indirizzo) della shell — non limitarsi a ingrandire la finestra. Esc esce.
//
// Verifica sul comportamento osservabile: i bounds della WebContentsView attiva
// passano a coprire l'intera finestra (y=0) quando si attiva il fullscreen, e
// tornano sotto la barra (y=shellHeight) all'uscita con Esc.

import { test, expect } from './fixtures/electron.mjs';

function readActiveView(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tabs = win._filoTabs;
    const active = tabs.tabs.find((t) => t.id === tabs.activeId);
    const b = active.view.getBounds();
    // Altezza di chrome "a riposo": fuori dalla home la barra indirizzi è
    // nascosta (chrome compatto) e la view parte dalla sola fila di tab.
    const restingTop = tabs.chromeCompact ? tabs.tabRowHeight : tabs.shellHeight;
    return { y: b.y, x: b.x, contentFullscreen: tabs.contentFullscreen, restingTop };
  });
}

test('fullscreen: il contenuto copre la barra e Esc ripristina', async ({ app, openTab }) => {
  // Pagina interna (chrome shim disponibile via internal-preload) e istanza
  // unica, così la Page trovata è proprio il tab attivo.
  const page = await openTab('filo://editor/editor.html');
  await page.waitForFunction(() => !!(window.chrome && chrome.runtime && chrome.runtime.sendMessage), null, { timeout: 8000 });

  // Stato iniziale: la view sta SOTTO la barra della shell (qui l'editor non è
  // la home, quindi chrome compatto → la barra indirizzi è già nascosta e la
  // view parte dalla sola fila di tab).
  const before = await readActiveView(app);
  expect(before.contentFullscreen).toBe(false);
  expect(before.y).toBe(before.restingTop);
  expect(before.y).toBeGreaterThan(0);

  // Attiva il fullscreen attraverso il vero percorso messaggio (come fa il menu).
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'toggle_fullscreen' }));

  await expect.poll(async () => (await readActiveView(app)).contentFullscreen).toBe(true);
  const during = await readActiveView(app);
  // La view ora parte da y=0: copre la barra → barra nascosta.
  expect(during.y).toBe(0);

  // Esc deve far uscire dalla modalità (gestito da before-input-event in main).
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tabs = win._filoTabs;
    const active = tabs.tabs.find((t) => t.id === tabs.activeId);
    try { active.view.webContents.focus(); } catch (_) {}
  });
  await page.keyboard.press('Escape');

  await expect.poll(async () => (await readActiveView(app)).contentFullscreen, { timeout: 5000 }).toBe(false);
  const after = await readActiveView(app);
  expect(after.y).toBe(after.shellHeight);
});
