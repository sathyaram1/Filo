// #419 — L'agente della home deve poter COMANDARE i controlli del browser Filo
// (schermo intero, riduci a icona, menu), non solo spiegare a parole dove
// cliccare. Il caso emblematico è "metti a schermo intero": la funzione esiste
// nel browser ma l'agente non aveva alcuna azione per attivarla.
//
// Verifica sul comportamento osservabile: l'azione COMANDO_FINESTRA con
// comando "fullscreen" porta DAVVERO la view attiva a coprire l'intera finestra
// (contenuto a tutto schermo, barra nascosta), e un secondo comando la
// ripristina. Senza il fix l'azione non è registrata → verrebbe rifiutata dal
// dispatch e lo schermo intero non si attiverebbe mai.

import { test, expect } from './fixtures/electron.mjs';

// Esegue un'azione Filo nel main process, come farebbe la chat della home.
const execAction = (app, action) =>
  app.evaluate((_electron, { action }) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action), { action });

function readActiveView(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tabs = win._filoTabs;
    const active = tabs.tabs.find((t) => t.id === tabs.activeId);
    const b = active.view.getBounds();
    const restingTop = tabs.chromeCompact ? tabs.tabRowHeight : tabs.shellHeight;
    return { y: b.y, contentFullscreen: tabs.contentFullscreen, restingTop };
  });
}

test('COMANDO_FINESTRA fullscreen mette e toglie lo schermo intero', async ({ app, openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForFunction(
    () => !!(window.chrome && chrome.runtime && chrome.runtime.sendMessage), null, { timeout: 8000 });

  // Stato iniziale: la view sta sotto la barra della shell.
  const before = await readActiveView(app);
  expect(before.contentFullscreen).toBe(false);
  expect(before.y).toBe(before.restingTop);
  expect(before.y).toBeGreaterThan(0);

  // L'agente comanda lo schermo intero: l'azione viene ESEGUITA (registrata,
  // livello 1) e il contenuto va davvero a tutto schermo.
  const r = await execAction(app, { type: 'COMANDO_FINESTRA', comando: 'fullscreen' });
  expect(r.executed).toBe(true);

  await expect.poll(async () => (await readActiveView(app)).contentFullscreen).toBe(true);
  const during = await readActiveView(app);
  expect(during.y).toBe(0); // la view copre la barra → barra nascosta

  // Un secondo comando toglie lo schermo intero (simmetria: se lo metti, lo togli).
  const r2 = await execAction(app, { type: 'COMANDO_FINESTRA', comando: 'fullscreen' });
  expect(r2.executed).toBe(true);
  await expect.poll(async () => (await readActiveView(app)).contentFullscreen).toBe(false);
  const after = await readActiveView(app);
  expect(after.y).toBe(after.restingTop);
});

test('COMANDO_FINESTRA con comando non ammesso non esegue nulla', async ({ app, openTab }) => {
  await openTab('filo://editor/editor.html');
  // "close" è escluso di proposito: l'AI non chiude la finestra.
  const r = await execAction(app, { type: 'COMANDO_FINESTRA', comando: 'close' });
  expect(r.executed).toBe(false);
  const view = await readActiveView(app);
  expect(view.contentFullscreen).toBe(false);
});
