import { test } from '../../fixtures/electron.mjs';

test('sonda: setVisible(false) rende nascosta la pagina?', async ({ app, openTab, testServer }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('domcontentloaded');
  const stato = async (etichetta) => {
    const v = await page.evaluate(() => ({ hidden: document.hidden, vs: document.visibilityState }));
    console.log('SONDA', etichetta, JSON.stringify(v));
  };
  await stato('subito');
  await openTab(testServer.html('<html><body>altro</body></html>'));
  await new Promise((r) => setTimeout(r, 600));
  const info = await app.evaluate(() => {
    const tm = globalThis.__filoTabs || globalThis.tabs || null;
    if (!tm) return 'nessun tab manager su globalThis';
    return { activeId: tm.activeId, tabs: (tm.tabs || []).map((t) => ({ id: t.id, url: t.view?.webContents?.getURL?.() })) };
  });
  console.log('SONDA tabs', JSON.stringify(info));
  await stato('dopo-altra-scheda');

  // Il meccanismo vero, chiamato a mano sulla view di Gestione.
  const esito = await app.evaluate(({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => String(w.getURL()).includes('manage/manage.html'));
    if (!wc) return 'nessuna webContents di Gestione';
    try { wc.hostWebContents; } catch (_) {}
    const view = wc.__filoView || null;
    if (view && view.setVisible) { view.setVisible(false); return 'setVisible(false) chiamato sulla view'; }
    return 'view non raggiungibile da webContents';
  });
  console.log('SONDA esito', esito);
  await new Promise((r) => setTimeout(r, 600));
  await stato('dopo-setVisible-false');
});
