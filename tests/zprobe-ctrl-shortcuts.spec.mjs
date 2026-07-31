// PROBE (temporaneo): le scorciatoie da browser Ctrl+L / Ctrl+T / Ctrl+W /
// Ctrl+R funzionano MENTRE si naviga un sito (focus sulla pagina)?
//
// Contesto: la barra degli indirizzi in alto è stata rimossa; l'unico modo
// documentato per digitare un indirizzo è Ctrl+L (apre la home/newtab dove si
// scrive "/indirizzo"). Ctrl+L/T/W/R sono gestiti SOLO nel keydown della shell
// (src/renderer/shell.js), che NON riceve eventi quando il focus è dentro la
// WebContentsView di una pagina. Il before-input-event per-pagina in tabs.js
// gestisce solo Alt+cifra ed Escape. Ipotesi: da una pagina web queste
// scorciatoie sono morte.

import { test, expect } from './fixtures/electron.mjs';

function activeUrl(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return { url: t ? t.url : null, count: tm.tabs.length, active: tm.activeId };
  });
}

test('Ctrl+L da una pagina web apre la home per digitare un indirizzo', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<title>SITO</title><h1 id="ok">ciao</h1><input id="f">');
  await page.click('#ok'); // porta il focus sulla WebContentsView della pagina
  const before = await activeUrl(app);
  expect(before.url).toContain('127.0.0.1'); // partiamo da un sito

  await page.keyboard.press('Control+l');
  // Diamo tempo all'eventuale navigazione.
  await page.waitForTimeout(800);

  const after = await activeUrl(app);
  // Atteso dal design (Ctrl+L "porta alla home"): la scheda attiva è ora newtab.
  expect(after.url, `Ctrl+L da pagina: url atteso newtab, ottenuto ${after.url}`).toContain('newtab');
});

test('Ctrl+T da una pagina web apre una nuova scheda', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<title>SITO2</title><h1 id="ok">ciao</h1>');
  await page.click('#ok');
  const before = await activeUrl(app);

  await page.keyboard.press('Control+t');
  await page.waitForTimeout(800);

  const after = await activeUrl(app);
  expect(after.count, `Ctrl+T da pagina: conteggio schede prima ${before.count}, dopo ${after.count}`).toBe(before.count + 1);
});
