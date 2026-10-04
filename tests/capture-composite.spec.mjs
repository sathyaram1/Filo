// captureComposite (tests/agent/driver.mjs), il fotografo di test:shoot e test:explore: lo scatto
// mostra shell, scheda e menu ciascuno al suo posto, anche con la finestra fuori schermo e senza
// schermo vero (xvfb). Ogni prova posa un riquadro di colore noto e lo cerca nei pixel del PNG.

import { test, expect } from '@playwright/test';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchFilo, closeFilo, captureComposite, navigate, sleep } from './agent/driver.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '.shots');

const VERDE = [0, 255, 0];
const MAGENTA = [255, 0, 255];
const LATO = 24;

// Un riquadro opaco in cima a tutto, e la promessa si scioglie solo a riquadro dipinto.
const posaRiquadro = ({ id, x, y, lato, rgb }) => new Promise((ok) => {
  const d = document.createElement('div');
  d.id = id;
  d.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${lato}px;height:${lato}px;`
    + `background:rgb(${rgb.join(',')});z-index:2147483647;pointer-events:none;margin:0;border:0`;
  document.documentElement.appendChild(d);
  requestAnimationFrame(() => requestAnimationFrame(() => ok(true)));
});
const togliRiquadro = (id) => { document.getElementById(id)?.remove(); };

async function geometria(app) {
  return app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const t = win._filoTabs.tabs.find((x) => x.id === win._filoTabs.activeId);
    const cb = win.getContentBounds();
    return { cb, vista: t.view.getBounds(), scala: screen.getDisplayMatching(cb).scaleFactor || 1 };
  });
}

// Legge il PNG con il decodificatore di Electron: colore in alcuni punti e quanti colori diversi ha.
async function leggiPng(app, percorso, punti) {
  return app.evaluate(({ nativeImage }, { percorso, punti }) => {
    const img = nativeImage.createFromPath(percorso);
    const sf = img.getScaleFactors()[0] || 1;
    const { width } = img.getSize(sf);
    const bmp = img.toBitmap({ scaleFactor: sf });
    const height = bmp.length / (4 * width);
    // BGRA: i colori dei riquadri sono simmetrici fra rosso e blu, quindi l'ordine non conta.
    const colore = (x, y) => { const i = (y * width + x) * 4; return [bmp[i + 2], bmp[i + 1], bmp[i]]; };
    const visti = new Set();
    for (let y = 0; y < height; y += 7) for (let x = 0; x < width; x += 7) visti.add(colore(x, y).join(','));
    return { width, height, colori: punti.map(([x, y]) => colore(x, y)), distinti: visti.size };
  }, { percorso, punti });
}

function vicino(colore, atteso) {
  return colore.every((c, i) => Math.abs(c - atteso[i]) <= 8);
}

// Riquadro verde nella shell (fila delle schede) e magenta nella scheda attiva: entrambi devono
// stare nello scatto alle coordinate della finestra, in pixel fisici.
async function scattoVerificato(app, shell, nome) {
  const outPath = join(OUT_DIR, nome);
  const { cb, vista, scala } = await geometria(app);
  expect(vista.y, 'la scheda attiva deve lasciare spazio alla shell sopra di sé').toBeGreaterThanOrEqual(LATO + 8);
  const shellR = { id: 'cc-shell', x: Math.round(cb.width / 2), y: 4, lato: LATO, rgb: VERDE };
  const vistaR = { id: 'cc-vista', x: 40, y: 40, lato: LATO, rgb: MAGENTA };
  await shell.evaluate(posaRiquadro, shellR);
  await app.evaluate(async ({ BrowserWindow }, { codice, r }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const t = win._filoTabs.tabs.find((x) => x.id === win._filoTabs.activeId);
    await t.view.webContents.executeJavaScript(`(${codice})(${JSON.stringify(r)})`);
  }, { codice: posaRiquadro.toString(), r: vistaR });

  try {
    await captureComposite(app, outPath);
  } finally {
    await shell.evaluate(togliRiquadro, shellR.id).catch(() => {});
    await app.evaluate(async ({ BrowserWindow }, id) => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
      const t = win._filoTabs.tabs.find((x) => x.id === win._filoTabs.activeId);
      await t.view.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(id)})?.remove()`);
    }, vistaR.id).catch(() => {});
  }

  expect(existsSync(outPath), 'PNG non creato da captureComposite').toBe(true);
  const centro = (r, ox, oy) => [Math.round((ox + r.x + LATO / 2) * scala), Math.round((oy + r.y + LATO / 2) * scala)];
  const letto = await leggiPng(app, outPath, [centro(shellR, 0, 0), centro(vistaR, vista.x, vista.y)]);
  expect(letto.width).toBe(Math.round(cb.width * scala));
  expect(letto.height).toBe(Math.round(cb.height * scala));
  expect(vicino(letto.colori[0], VERDE), `nella fila delle schede c'è ${letto.colori[0]} invece del riquadro verde della shell`).toBe(true);
  expect(vicino(letto.colori[1], MAGENTA), `sotto la shell c'è ${letto.colori[1]} invece del riquadro magenta della scheda`).toBe(true);
  // Uno scatto nero o di un colore solo ne avrebbe uno; la pagina vera ne ha decine.
  expect(letto.distinti, 'lo scatto è quasi tutto di un colore: la finestra non c\'è').toBeGreaterThan(20);
  return outPath;
}

test.describe('captureComposite — scatto della finestra senza chiedere allo schermo', () => {
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

  test('screenshot newtab: file esiste e non è vuoto', async () => {
    await scattoVerificato(app, shell, 'spike-newtab.png');
  });

  test('screenshot dashboard (filo://dashboard): file esiste e non è vuoto', async () => {
    await navigate(app, shell, 'filo://dashboard/dashboard.html');
    await sleep(1200);
    await scattoVerificato(app, shell, 'spike-dashboard.png');
  });

  test('un menu aperto, che è una finestra a sé, compare nello scatto al suo posto', async () => {
    await shell.click('.tab.active', { button: 'right' });
    let menu = null;
    await expect.poll(async () => {
      menu = await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
        const f = win.getChildWindows().find((c) => c.isVisible() && c.webContents.getURL().startsWith('data:'));
        return f ? { b: f.getContentBounds(), id: f.id } : null;
      });
      return !!menu;
    }, { message: 'il tasto destro sulla scheda non ha aperto il menu' }).toBe(true);

    const r = { id: 'cc-menu', x: Math.round(menu.b.width / 2 - LATO / 2), y: Math.round(menu.b.height / 2 - LATO / 2), lato: LATO, rgb: MAGENTA };
    await app.evaluate(async ({ BrowserWindow }, { id, codice, r }) => {
      await BrowserWindow.fromId(id).webContents.executeJavaScript(`(${codice})(${JSON.stringify(r)})`);
    }, { id: menu.id, codice: posaRiquadro.toString(), r });

    const outPath = join(OUT_DIR, 'spike-menu.png');
    await captureComposite(app, outPath);
    await shell.keyboard.press('Escape').catch(() => {});

    const { cb, scala } = await geometria(app);
    const punto = [
      Math.round((menu.b.x - cb.x + r.x + LATO / 2) * scala),
      Math.round((menu.b.y - cb.y + r.y + LATO / 2) * scala),
    ];
    const letto = await leggiPng(app, outPath, [punto]);
    expect(vicino(letto.colori[0], MAGENTA), `dove sta il menu lo scatto mostra ${letto.colori[0]}: il menu non c'è`).toBe(true);
  });
});
