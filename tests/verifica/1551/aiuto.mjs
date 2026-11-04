// Misure condivise delle prove del giro: tasto Invia della home e carte degli avvisi, in px della finestra.
import { expect } from '../../fixtures/electron.mjs';
import { paginaDellaScheda } from '../../helpers/schede.mjs';

export async function homeLarga(app, W, H) {
  await app.evaluate(({ BrowserWindow }, [W, H]) => { BrowserWindow.getAllWindows().find((w) => w._filoTabs).setContentSize(W, H); }, [W, H]);
  const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activeId);
  let p = null;
  await expect.poll(async () => { p = await paginaDellaScheda(app, id); return p ? p.url() : ''; }, { timeout: 20_000 }).toContain('newtab');
  await p.waitForSelector('#sendBtn');
  return p;
}

// Bordo destro del tasto Invia e bordo sinistro della carta più a sinistra, nelle coordinate della finestra.
export async function invioEcarte(app, page, avvisi) {
  const g = await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const tab = tm.tabs.find((t) => t.id === tm.activeId);
    return { vista: tm.avvisi.vista ? tm.avvisi.vista.getBounds() : null, scheda: tab.view.getBounds(), zoom: tab.view.webContents.getZoomFactor() };
  });
  const r = await page.evaluate(() => { const b = document.querySelector('#sendBtn').getBoundingClientRect(); return { l: b.left, r: b.right }; });
  let sinistra = Infinity;
  if (g.vista && g.vista.width) {
    const v = await avvisi();
    const xs = await v.evaluate(() => [...document.querySelectorAll('.shell-notif')].map((c) => c.getBoundingClientRect().left));
    if (xs.length) sinistra = g.vista.x + Math.min(...xs);
  }
  return { invioDestra: g.scheda.x + r.r * g.zoom, invioSinistra: g.scheda.x + r.l * g.zoom, cartaSinistra: sinistra };
}
