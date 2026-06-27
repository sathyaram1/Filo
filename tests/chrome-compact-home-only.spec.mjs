// Feedback 1tsAuna: "leva questa barra, metti le icone nel contenuto della
// pagina home". La barra in alto di Filo (indietro/avanti/ricarica +
// home/impostazioni/app/profilo) è stata TOLTA del tutto: resta solo la fila di
// tab + i controlli finestra, ovunque (home e siti). Le icone di controllo si
// trovano ora DENTRO la home (vedi home-controls-in-page.spec.mjs); le frecce di
// navigazione vivono nel menu tasto destro.
//
// Questo file asserisce l'invariante di LAYOUT: chrome sempre compatto, barra
// indirizzi sempre nascosta, e la WebContentsView attiva sempre risalita a
// coprire lo spazio (top = 40px, la sola tab-row) — non più 88px sulla home.
//
// (Supersede il vecchio comportamento "icone in alto solo nella home": ora le
// icone non sono più nella barra, ma nel contenuto della home.)

import { test, expect } from './fixtures/electron.mjs';

// Stato di layout dal main process: chromeCompact + top della view attiva.
function layoutState(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    if (!win) return null;
    const tm = win._filoTabs;
    const tab = tm.tabs.find((t) => t.id === tm.activeId);
    let top = null;
    try { top = tab ? Math.round(tab.view.getBounds().y) : null; } catch (_) {}
    return { compact: tm.chromeCompact, top };
  });
}

test('la barra indirizzi è sempre nascosta (home e siti): resta solo la fila di tab', async ({ app, shell, testServer, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  const addr = shell.locator('nav.addr');
  const compactAttr = shell.locator('html[data-chrome-compact="1"]');

  // ── Stato iniziale: home (newtab) → barra indirizzi GIÀ nascosta, chrome
  //    compatto, view risalita a top=40 (niente più fascia da 88px).
  await expect(addr).toBeHidden();
  await expect(compactAttr).toHaveCount(1, { timeout: 6_000 });
  await expect.poll(() => layoutState(app), { timeout: 6_000 }).toMatchObject({
    compact: true, top: 40,
  });

  // ── Apre un sito esterno: resta tutto compatto (nessun cambio di chrome).
  await testServer.openReady(openTab, '<title>Sito</title><h1>ciao</h1>');
  await expect(compactAttr).toHaveCount(1, { timeout: 6_000 });
  await expect(addr).toBeHidden();
  await expect.poll(() => layoutState(app), { timeout: 6_000 }).toMatchObject({
    compact: true, top: 40,
  });

  // ── Torna sulla home: ancora compatto, barra mai più visibile.
  await openTab('filo://newtab/');
  await expect(compactAttr).toHaveCount(1, { timeout: 6_000 });
  await expect(addr).toBeHidden();
  await expect.poll(() => layoutState(app), { timeout: 6_000 }).toMatchObject({
    compact: true, top: 40,
  });
});

test('le tab e i controlli finestra restano sempre visibili (anche sui siti)', async ({ app, shell, testServer, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  // Su un sito esterno (chrome compatto) la fila di tab e i tasti finestra
  // devono restare: sono l'unico chrome che il feedback chiede di mantenere.
  await testServer.openReady(openTab, '<title>Sito</title><h1>ciao</h1>');
  await expect(shell.locator('html[data-chrome-compact="1"]')).toHaveCount(1, { timeout: 6_000 });

  await expect(shell.locator('.tab-row')).toBeVisible();
  await expect(shell.locator('#win-min')).toBeVisible();
  await expect(shell.locator('#win-max')).toBeVisible();
  await expect(shell.locator('#win-close')).toBeVisible();
  await expect(shell.locator('#tab-new')).toBeVisible();
  // La fila di icone di navigazione, invece, è nascosta sui siti.
  await expect(shell.locator('#nav-back')).toBeHidden();
  // La barra dell'URL non esiste più: è stata rimossa del tutto (anche sulla home).
  await expect(shell.locator('#addr')).toHaveCount(0);
});
