// Verifica #430 giro 2 — attrezzi comuni alle prove del giro: stato delle schede e della carta di anteprima.
import { expect } from '../../fixtures/electron.mjs';

export const pagina = (colore, titolo, corpo = '') => `<!doctype html><title>${titolo}</title>
<style>html,body{margin:0;height:100%;background:${colore}}a{display:block;font:30px sans-serif;padding:20px}</style>
<h1 style="margin:0;padding:40px;font:40px sans-serif">${titolo}</h1>${corpo}`;

export async function schede(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    return { attiva: t.activeId, tutte: t.tabs.map((x) => ({ id: x.id, url: x.url, title: x.title, loading: x.loading, foto: !!t.anteprime.get(x.id) })) };
  });
}

export async function idDi(app, pred, timeout = 15_000) {
  let id = null;
  await expect.poll(async () => {
    const t = (await schede(app)).tutte.find(pred);
    id = t && !t.loading ? t.id : null;
    return !!id;
  }, { timeout }).toBe(true);
  return id;
}

export async function carta(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const c = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL() === 'filo://shell/anteprima.html');
    if (!c) return { visibile: false, mostrata: false };
    const dom = await c.webContents.executeJavaScript(`(() => {
      const img = document.querySelector('#foto img');
      const r = img ? img.getBoundingClientRect() : null;
      return {
        mostrata: !document.getElementById('carta').hidden,
        titolo: document.getElementById('titolo').textContent,
        foto: r ? { x: r.left + r.width / 2, y: r.top + r.height * 0.8 } : null,
        dpr: devicePixelRatio,
      };
    })()`);
    let colore = null;
    if (dom.foto && dom.mostrata) {
      const shot = await c.webContents.capturePage();
      const s = shot.getSize();
      const px = Math.round(dom.foto.x * dom.dpr);
      const py = Math.round(dom.foto.y * dom.dpr);
      if (px < s.width && py < s.height) {
        const b = shot.toBitmap();
        const i = (py * s.width + px) * 4;
        colore = [b[i + 2], b[i + 1], b[i]];
      }
    }
    return { visibile: c.isVisible(), ...dom, colore, bounds: c.getBounds() };
  });
}

export const verde = (c) => !!c && c[1] > 150 && c[0] < 100 && c[2] < 100;
export const rosso = (c) => !!c && c[0] > 180 && c[1] < 90 && c[2] < 90;
