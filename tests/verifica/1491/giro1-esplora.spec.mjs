// Esplorazione della verifica #1491: icone solo sopra la colonna destra, filo e sinistra dall'alto.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuAperto } from '../../helpers/barra.mjs';

const misura = (page) => page.evaluate(() => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  return {
    ctrl: r('#dashControls'), left: r('#left'), center: r('#center'), right: r('#right'),
    cerca: r('#cercaFilo'), primaRight: r('#right > *:not([hidden])'), vw: innerWidth,
  };
});

async function dimensiona(app, w, h) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    win.setSize(w, h);
  }, [w, h]);
}

for (const [w, h] of [[1600, 1000], [960, 700], [700, 600]]) {
  test(`layout ${w}x${h}`, async ({ app, openTab }) => {
    await dimensiona(app, w, h);
    const page = await openTab('filo://newtab/');
    await page.waitForSelector('#dashControls .dash-ctrl');
    await page.waitForTimeout(800);
    const m = await misura(page);
    console.log(JSON.stringify(m));
    expect(m.ctrl.l).toBeGreaterThanOrEqual(m.right.l - 1);
    expect(m.ctrl.r).toBeLessThanOrEqual(m.right.r + 1);
    expect(m.cerca.t).toBeLessThan(m.ctrl.b);
    expect(m.left.t).toBeLessThan(m.ctrl.b);
    expect(m.right.t).toBeGreaterThanOrEqual(m.ctrl.b - 1);
    for (const tema of ['dark', 'light']) {
      await page.evaluate((t) => { document.documentElement.dataset.snTheme = t; }, tema);
      await page.waitForTimeout(200);
      await page.screenshot({ path: `tests/.shots/v1491-${w}-${tema}.png` });
    }
  });
}

for (const zoom of [1, 1.5]) {
  for (const cmd of ['settings', 'account']) {
    test(`menu ${cmd} sotto l'icona, zoom ${zoom}`, async ({ app, openTab }) => {
      await dimensiona(app, 1400, 900);
      const page = await openTab('filo://newtab/');
      await page.waitForSelector('#dashControls .dash-ctrl');
      if (zoom !== 1) {
        await app.evaluate(({ webContents }, z) => {
          const wc = webContents.getAllWebContents().find((c) => c.getURL().startsWith('filo://newtab'));
          wc.setZoomFactor(z);
        }, zoom);
        await page.waitForTimeout(500);
      }
      const icona = await page.$eval(`#dashControls [data-command="${cmd}"]`, (e) => { const b = e.getBoundingClientRect(); return { l: b.left, b: b.bottom }; });
      const vista = await app.evaluate(({ BrowserWindow, webContents }) => {
        const win = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
        const wc = webContents.getAllWebContents().find((c) => c.getURL().startsWith('filo://newtab'));
        const tab = win._filoTabs.tabs.find((t) => t.view && t.view.webContents === wc);
        return { cont: win.getContentBounds(), view: tab.view.getBounds(), zoom: wc.getZoomFactor() };
      });
      await page.click(`#dashControls [data-command="${cmd}"]`);
      const menu = await menuAperto(app);
      expect(menu).not.toBeNull();
      const pos = await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find((x) => { try { return x.webContents.getURL().startsWith('data:text/html') && x.isVisible(); } catch (_) { return false; } });
        return w ? w.getBounds() : null;
      });
      const atteso = { x: vista.cont.x + vista.view.x + icona.l * vista.zoom, y: vista.cont.y + vista.view.y + icona.b * vista.zoom };
      console.log(cmd, zoom, JSON.stringify({ icona, vista, pos, atteso }));
      await page.screenshot({ path: `tests/.shots/v1491-menu-${cmd}-${zoom}.png` });
      expect(Math.abs(pos.y - atteso.y)).toBeLessThan(40);
      expect(pos.x).toBeGreaterThan(atteso.x - 300);
      expect(pos.x).toBeLessThan(atteso.x + 60);
    });
  }
}
