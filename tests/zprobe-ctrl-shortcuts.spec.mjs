// PROBE (temporaneo): le scorciatoie da browser Ctrl+L / Ctrl+T funzionano
// MENTRE si naviga un sito (focus sulla pagina)?
//
// Contesto: la barra degli indirizzi in alto è stata rimossa; l'unico modo
// documentato per digitare un indirizzo è Ctrl+L. Ctrl+L/T/W/R sono gestiti
// SOLO nel keydown della shell (src/renderer/shell.js), che NON riceve eventi
// quando il focus è dentro la WebContentsView di una pagina. Il
// before-input-event per-pagina in tabs.js gestisce solo Alt+cifra ed Escape.
//
// Metodo: iniettiamo l'evento con webContents.sendInputEvent (stesso identico
// canale della suite Alt+cifra, che PASSA), così l'esito non è un artefatto
// dell'harness. Includiamo Alt+cifra come CONTROLLO POSITIVO.

import { test, expect } from './fixtures/electron.mjs';

function activeInfo(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return { url: t ? t.url : null, count: tm.tabs.length, active: tm.activeId };
  });
}

// Invia un keyDown alla webContents della scheda ATTIVA (dove sta il focus).
function sendToActive(app, keyCode, modifiers) {
  return app.evaluate(({ BrowserWindow }, { keyCode, modifiers }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    t.view.webContents.focus();
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    t.view.webContents.sendInputEvent({ type: 'char', keyCode, modifiers });
    t.view.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  }, { keyCode, modifiers });
}

test('CONTROLLO POSITIVO: Alt+1 da una pagina web cambia scheda', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, '<title>UNO</title><h1 id="ok">1</h1>');
  const page2 = await testServer.openReady(openTab, '<title>DUE</title><h1 id="ok">2</h1>');
  await page2.click('#ok');
  const before = await activeInfo(app);
  await sendToActive(app, '1', ['alt']);
  await page2.waitForTimeout(500);
  const after = await activeInfo(app);
  // Alt+1 → prima scheda: l'attiva DEVE cambiare (prova che il canale funziona).
  expect(after.active, 'Alt+1 dovrebbe cambiare scheda attiva').not.toBe(before.active);
});

test('Ctrl+L da una pagina web apre la home per digitare un indirizzo', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<title>SITO</title><h1 id="ok">ciao</h1>');
  await page.click('#ok');
  const before = await activeInfo(app);
  expect(before.url).toContain('127.0.0.1');

  await sendToActive(app, 'l', ['control']);
  await page.waitForTimeout(800);

  const after = await activeInfo(app);
  expect(after.url, `Ctrl+L da pagina: atteso newtab, ottenuto ${after.url}`).toContain('newtab');
});

test('Ctrl+T da una pagina web apre una nuova scheda', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<title>SITO2</title><h1 id="ok">ciao</h1>');
  await page.click('#ok');
  const before = await activeInfo(app);

  await sendToActive(app, 't', ['control']);
  await page.waitForTimeout(800);

  const after = await activeInfo(app);
  expect(after.count, `Ctrl+T da pagina: schede prima ${before.count}, dopo ${after.count}`).toBe(before.count + 1);
});
