// captureComposite (tests/agent/driver.mjs): l'immagine è la finestra com'è, shell + scheda + finestre figlie,
// anche quando nessuno schermo la mostra (nella suite è parcheggiata fuori schermo: src/main/test-window-mode.js).
// Si guardano i pixel, non solo il peso del file: un'immagine nera o con mezza finestra deve essere rossa.

import { test, expect } from '@playwright/test';
import { statSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchFilo, closeFilo, captureComposite, navigate, activeView, contentBounds, sleep } from './agent/driver.mjs';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '.shots');
// Un PNG della finestra tutta nera pesa pochi kB; la UI di Filo, decine.
const MIN_PNG_BYTES = 30_000;
// Rosso e blu uguali: il colore si riconosce qualunque sia l'ordine dei canali della bitmap.
const VERDE = [40, 200, 40];

/** Cosa c'è nell'immagine: misure, varietà e quota di nero di una fascia, colore di un punto. */
async function guarda(app, file, { fasce = [], punti = [] } = {}) {
  return app.evaluate(({ nativeImage }, { file, fasce, punti }) => {
    const img = nativeImage.createFromPath(file);
    const { width, height } = img.getSize();
    const bmp = img.toBitmap();
    const px = (x, y) => { const i = (y * width + x) * 4; return [bmp[i + 2], bmp[i + 1], bmp[i]]; };
    const fascia = ([y0, y1]) => {
      const colori = new Set(); let neri = 0, n = 0;
      for (let y = Math.max(0, y0); y < Math.min(height, y1); y += 2) {
        for (let x = 0; x < width; x += 2) {
          const [r, g, b] = px(x, y);
          colori.add((r << 16) | (g << 8) | b);
          if (r + g + b < 30) neri++;
          n++;
        }
      }
      return { colori: colori.size, neri: n ? neri / n : 1 };
    };
    return { width, height, fasce: fasce.map(fascia), punti: punti.map(([x, y]) => px(x, y)) };
  }, { file, fasce, punti });
}

async function vistaAttiva(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const t = win._filoTabs;
    return t.tabs.find((x) => x.id === t.activeId).view.getBounds();
  });
}

const vicino = (a, b, tolleranza = 6) => a.every((v, i) => Math.abs(v - b[i]) <= tolleranza);

test.describe('captureComposite — la finestra intera, anche senza uno schermo', () => {
  let app = null;
  let shell = null;

  test.beforeAll(async () => {
    mkdirSync(OUT_DIR, { recursive: true });
    ({ app, shell } = await launchFilo());
    await sleep(1500);
  });

  test.afterAll(async () => {
    if (app) await closeFilo(app);
  });

  /** La cattura ha le misure della finestra e mostra sia la shell sia la pagina della scheda. */
  async function attesaFinestraIntera(file) {
    const c = await contentBounds(app);
    const v = await vistaAttiva(app);
    const k = c.scale;
    const vista = await guarda(app, file, { fasce: [[0, Math.round(v.y * k)], [Math.round(v.y * k), Math.round((v.y + v.height) * k)]] });
    expect(Math.abs(vista.width - Math.round(c.width * k)), `larga ${vista.width}: non è la finestra`).toBeLessThanOrEqual(1);
    expect(Math.abs(vista.height - Math.round(c.height * k)), `alta ${vista.height}: non è la finestra`).toBeLessThanOrEqual(1);
    const [cornice, pagina] = vista.fasce;
    expect(cornice.neri, 'la fascia della shell è nera: la cattura non vede la finestra').toBeLessThan(0.5);
    expect(cornice.colori, 'la fascia della shell è un colore solo: manca la barra delle schede').toBeGreaterThan(8);
    expect(pagina.neri, 'la fascia della pagina è nera: la scheda non è nella cattura').toBeLessThan(0.5);
    expect(pagina.colori, 'la fascia della pagina è un colore solo: la scheda non è nella cattura').toBeGreaterThan(8);
    const { size } = statSync(file);
    expect(size, `PNG troppo piccolo (${size} B): probabile schermata vuota`).toBeGreaterThan(MIN_PNG_BYTES);
  }

  test('screenshot newtab: file esiste e non è vuoto', async () => {
    const outPath = join(OUT_DIR, 'spike-newtab.png');
    await captureComposite(app, outPath);
    expect(existsSync(outPath), 'PNG non creato da captureComposite').toBe(true);
    await attesaFinestraIntera(outPath);
  });

  test('screenshot dashboard (filo://dashboard): file esiste e non è vuoto', async () => {
    const outPath = join(OUT_DIR, 'spike-dashboard.png');
    await navigate(app, shell, 'filo://dashboard/dashboard.html');
    await sleep(1200);
    await captureComposite(app, outPath);
    expect(existsSync(outPath), 'PNG non creato per dashboard').toBe(true);
    await attesaFinestraIntera(outPath);
  });

  test('la pagina della scheda sta nell’immagine nel punto in cui sta nella finestra', async () => {
    const pagina = await activeView(app, shell);
    await pagina.evaluate(([r, g, b]) => {
      const d = document.createElement('div');
      d.id = 'prova-cattura';
      d.style.cssText = `position:fixed;left:0;top:0;width:200px;height:120px;background:rgb(${r},${g},${b});z-index:2147483647`;
      document.body.appendChild(d);
    }, VERDE);
    await sleep(400);
    const outPath = join(OUT_DIR, 'capture-composite-posto.png');
    await captureComposite(app, outPath);
    const c = await contentBounds(app);
    const v = await vistaAttiva(app);
    const k = c.scale;
    const dentro = [Math.round((v.x + 100) * k), Math.round((v.y + 60) * k)];
    const sopra = [Math.round((v.x + 100) * k), Math.max(0, Math.round((v.y - 10) * k))];
    const fuori = [Math.round((v.x + 260) * k), Math.round((v.y + 60) * k)];
    const { punti: [a, b, d] } = await guarda(app, outPath, { punti: [dentro, sopra, fuori] });
    expect(vicino(a, VERDE), `dentro il riquadro della pagina doveva esserci il verde, c'è rgb(${a})`).toBe(true);
    expect(vicino(b, VERDE), 'il riquadro è finito sopra la shell: la pagina è fuori posto').toBe(false);
    expect(vicino(d, VERDE), 'il verde esce dal riquadro: la pagina è fuori scala').toBe(false);
    await pagina.evaluate(() => document.getElementById('prova-cattura')?.remove());
  });

  test('un menu aperto sopra la pagina entra nell’immagine', async () => {
    test.skip(process.platform === 'win32', 'su Windows la cattura è PrintWindow, che fotografa solo la finestra madre: un menu è una finestra a sé');
    const pagina = await activeView(app, shell);
    await pagina.evaluate(([r, g, b]) => {
      const d = document.createElement('div');
      d.id = 'prova-cattura';
      d.style.cssText = `position:fixed;inset:0;background:rgb(${r},${g},${b});z-index:2147483647`;
      document.body.appendChild(d);
    }, VERDE);
    const v = await vistaAttiva(app);
    const x = v.x + 300, y = v.y + 200;
    await shell.evaluate(([x, y]) => window.filoShell.popupMenu([
      { label: 'Prima voce della prova di cattura', url: 'filo://history/' },
      { label: 'Seconda voce', url: 'filo://history/' },
    ], x, y), [x, y]);
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find((w) => w._filoTabs).getChildWindows().some((f) => f.isVisible())), { timeout: 5000 }).toBe(true);
    await sleep(500);
    const outPath = join(OUT_DIR, 'capture-composite-menu.png');
    await captureComposite(app, outPath);
    const k = (await contentBounds(app)).scale;
    // Il menu si apre col suo angolo appena sotto il punto chiesto (src/main/popup-menu.js).
    const nelMenu = [Math.round((x + 60) * k), Math.round((y + 30) * k)];
    const accanto = [Math.round((x - 80) * k), Math.round((y + 30) * k)];
    const { punti: [m, p] } = await guarda(app, outPath, { punti: [nelMenu, accanto] });
    expect(vicino(p, VERDE), `accanto al menu doveva vedersi la pagina verde, c'è rgb(${p})`).toBe(true);
    expect(vicino(m, VERDE), 'dove sta il menu si vede ancora la pagina: il menu non è nella cattura').toBe(false);
    await pagina.evaluate(() => document.getElementById('prova-cattura')?.remove());
  });
});
