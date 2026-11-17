// #2390 giro 1 — prove esplorative del verificatore.

import { test, expect } from '../../fixtures/electron.mjs';

async function homePage(app) {
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 8_000 });
  return page;
}

async function vaiAllaHome(shell) {
  const s = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const h = s.tabs.find((t) => String(t.url || '').startsWith('filo://newtab'));
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), h.id);
}

async function timerScaduto(app, shell, etichetta) {
  const tipo = await shell.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await shell.evaluate(([t, l]) => window.filoShell.message({ type: t, label: l, seconds: 1 }), [tipo, etichetta]);
  await shell.waitForTimeout(1300);
  await app.evaluate(async () => { await globalThis.__filoAlarmWatcher._tick(); });
}

test('timer scaduto su un sito, poi la home: l\'avviso lascia subito l\'angolo e non diventa una carta in più', async ({ app, shell, avvisi, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>Un sito</h1>');
  await timerScaduto(app, shell, 'Riso');
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: 'Timer «Riso» scaduto' })).toBeVisible({ timeout: 8_000 });
  await vaiAllaHome(shell);
  const home = await homePage(app);
  const t0 = Date.now();
  await expect.poll(() => shell.locator('.shell-notif[data-luogo="angolo"]:not([data-closing="1"])').count(), { timeout: 12_000, intervals: [100] }).toBe(0);
  const restata = Date.now() - t0;
  console.log('ms nell\'angolo dopo l\'arrivo nella home:', restata);
  await expect(home.locator('#accade > .dash-carta[data-tipo="cornice"]')).toHaveCount(0);
  await expect(home.locator('#accade > .dash-carta[data-chiave^="timer:"]')).toHaveCount(1);
});

test('scaricamento avviato su un sito, poi la home: nessuna carta in più accanto a quella dello scaricamento', async ({ app, shell, avvisi, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>Un sito</h1>');
  // Lo stesso avviso che il main manda alla partenza di uno scaricamento (chiave dello scaricamento, 5 secondi).
  await shell.evaluate(() => window.filoNotify('Scaricamento avviato: grande.zip', { durationSec: 5, key: 'download:prova1' }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: 'Scaricamento avviato' })).toBeVisible();
  await vaiAllaHome(shell);
  const home = await homePage(app);
  await home.waitForTimeout(7000);
  const cornice = await home.locator('#accade > .dash-carta[data-tipo="cornice"]').allTextContents();
  console.log('carte volate:', JSON.stringify(cornice));
});

test('nella home l\'avviso nell\'angolo e il tasto Invia: misura della sovrapposizione', async ({ app, shell, avvisi }) => {
  const home = await homePage(app);
  await shell.evaluate(() => window.filoNotify('Un errore qualunque con un testo di media lunghezza', { durationSec: 3 }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toBeVisible();
  await vista.waitForTimeout(500);
  const bordi = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const att = (tm.tabs || []).find((t) => t.id === tm.activeId);
    return { avvisi: tm.avvisi && tm.avvisi.vista ? tm.avvisi.vista.getBounds() : null, home: att.view.getBounds() };
  });
  const invia = await home.locator('#sendBtn').boundingBox();
  const carta = await vista.locator('.shell-notif.show').boundingBox();
  const c = { x: bordi.avvisi.x + carta.x, y: bordi.avvisi.y + carta.y, w: carta.width, h: carta.height };
  const i = { x: bordi.home.x + invia.x, y: bordi.home.y + invia.y, w: invia.width, h: invia.height };
  const sovrapposti = c.x < i.x + i.w && i.x < c.x + c.w && c.y < i.y + i.h && i.y < c.y + c.h;
  console.log('avviso', JSON.stringify(c), 'invia', JSON.stringify(i), 'sovrapposti', sovrapposti);
  await vista.screenshot({ path: 'tests/.shots/2390-v-angolo-home.png' });
  await home.screenshot({ path: 'tests/.shots/2390-v-home.png' });
});

test('menu del tasto destro sull\'avviso nell\'angolo: azioni, chiudi, apri', async ({ app, shell, avvisi, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>Un sito</h1>');
  await timerScaduto(app, shell, 'Menu');
  const vista = await avvisi();
  const carta = vista.locator('.shell-notif.show', { hasText: 'Timer «Menu» scaduto' });
  await expect(carta).toBeVisible({ timeout: 8_000 });
  const voci = await app.evaluate(() => new Promise((ok) => {
    const pm = require('./popup-menu');
    ok(typeof pm.showPopupMenu);
  })).catch((e) => String(e));
  console.log('popup', voci);
  await carta.click({ button: 'right' });
  await vista.waitForTimeout(800);
  const finestre = app.windows().map((w) => { try { return w.url(); } catch (_) { return ''; } });
  console.log('finestre', JSON.stringify(finestre));
});
