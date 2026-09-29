// #588.5 giro 3, rilievo 1: col riquadro Aiuto aperto, l'avviso della barra non deve coprire la sua riga per scrivere.
import { test, expect } from '../../fixtures/electron.mjs';

test('riquadro Aiuto aperto: «Scaricato» non copre la riga dove si scrive e il tasto per mandare', async ({ app, shell, avvisi }) => {
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => typeof window.SN_SIDEBAR?.open === 'function', null, { timeout: 8000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs).setContentSize(1280, 800));
  await page.evaluate(() => window.SN_SIDEBAR.open());
  await page.waitForSelector('.sn-sidebar-input', { timeout: 8000 });

  await shell.evaluate(() => window.filoNotify('Scaricato: report.pdf', {
    durationSec: 0,
    actions: [{ label: 'Apri file', onClick: () => {} }, { label: 'Apri cartella', onClick: () => {} }],
  }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);

  const coperto = async () => {
    const g = await app.evaluate(({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      return { v: tm.avvisi.vista.getBounds(), t: tm.tabs.find((t) => t.id === tm.activeId).view.getBounds() };
    });
    const riga = await page.evaluate(() => {
      const r = document.querySelector('.sn-sidebar-input').getBoundingClientRect();
      return { x: r.left, y: r.top, right: r.right, bottom: r.bottom };
    });
    const c = await vista.evaluate(() => {
      const r = document.querySelector('.shell-notif').getBoundingClientRect();
      return { x: r.left, y: r.top, right: r.right, bottom: r.bottom };
    });
    const dx = g.v.x - g.t.x;
    const dy = g.v.y - g.t.y;
    return riga.x < c.right + dx && c.x + dx < riga.right && riga.y < c.bottom + dy && c.y + dy < riga.bottom;
  };
  await expect.poll(coperto, { timeout: 5000 }).toBe(false);
});
