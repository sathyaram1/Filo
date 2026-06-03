// Feedback alpha: "leva la barra dell'url, voglio che ci siano solo le tab ed i
// tasti della finestra. le altre icone devono comparire in alto solo nella home
// di filo".
//
// La barra indirizzi (icone di navigazione + campo URL) deve sparire fuori dalla
// home di Filo (la newtab) e ricomparire quando si torna sulla home. Quando è
// nascosta, la WebContentsView attiva deve risalire a coprire lo spazio liberato
// (niente fascia vuota), cioè il suo top passa da 88px (shell intera) a 40px (la
// sola fila di tab).
//
// Asserisce IL SUCCESSO: non solo il toggle CSS lato shell, ma anche che il main
// riposiziona davvero la view del tab attivo.

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

test('la barra indirizzi compare solo sulla home; sui siti resta solo la fila di tab', async ({ app, shell, testServer, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  const addr = shell.locator('nav.addr');
  const compactAttr = shell.locator('html[data-chrome-compact="1"]');

  // ── Stato iniziale: home (newtab) → barra indirizzi visibile, chrome esteso.
  await expect(addr).toBeVisible();
  await expect(compactAttr).toHaveCount(0);
  await expect.poll(() => layoutState(app), { timeout: 6_000 }).toMatchObject({
    compact: false, top: 88,
  });

  // ── Apre un sito esterno: la home se ne va → barra indirizzi nascosta e la
  //    view risale a coprire lo spazio (top = 40, la sola tab-row).
  await testServer.openReady(openTab, '<title>Sito</title><h1>ciao</h1>');
  await expect(compactAttr).toHaveCount(1, { timeout: 6_000 });
  await expect(addr).toBeHidden();
  await expect.poll(() => layoutState(app), { timeout: 6_000 }).toMatchObject({
    compact: true, top: 40,
  });

  // ── Torna sulla home aprendo una nuova scheda: la barra indirizzi (con tutte
  //    le icone) ricompare e il chrome torna esteso.
  await openTab('filo://newtab/');
  await expect(compactAttr).toHaveCount(0, { timeout: 6_000 });
  await expect(addr).toBeVisible();
  await expect.poll(() => layoutState(app), { timeout: 6_000 }).toMatchObject({
    compact: false, top: 88,
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
  // La barra indirizzi e le sue icone, invece, sono nascoste.
  await expect(shell.locator('#nav-back')).toBeHidden();
  await expect(shell.locator('#addr')).toBeHidden();
});
