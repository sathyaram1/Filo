// Verifica #2382.1, giro 1: il bordo alto dello schermo a finestra massimizzata, col puntatore VERO del sistema (XTest),
// che passa dalla regione di trascinamento come la mano; e il bordo del menu sopra la barra laterale.

import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync } from 'node:child_process';
import * as Gesti from '../../helpers/gestiVeri.mjs';
import { comandaBarra, barraPage, pannelloFermo, statoBarra } from '../../helpers/barra.mjs';
import { vociDelMenu } from '../../helpers/menuLinguetta.mjs';

const XTEST = `
import ctypes, sys, time
x11 = ctypes.cdll.LoadLibrary('libX11.so.6'); xt = ctypes.cdll.LoadLibrary('libXtst.so.6')
x11.XOpenDisplay.restype = ctypes.c_void_p
d = ctypes.c_void_p(x11.XOpenDisplay(None))
for s in sys.argv[1].split(';'):
    p = s.strip().split(':')
    if p[0] == 'move': xt.XTestFakeMotionEvent(d, -1, int(float(p[1])), int(float(p[2])), 0)
    elif p[0] == 'wait': time.sleep(int(p[1]) / 1000)
    elif p[0] == 'down': xt.XTestFakeButtonEvent(d, int(p[1]), 1, 0)
    elif p[0] == 'up': xt.XTestFakeButtonEvent(d, int(p[1]), 0, 0)
    x11.XFlush(d)
x11.XCloseDisplay(d)
`;
const puntatore = (passi) => execFileSync('python3', ['-I', '-c', XTEST, passi], { env: process.env });

const aperte = (shell) => shell.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map((el) => el.dataset.id));
const attiva = (shell) => shell.evaluate(() => document.querySelector('#tabs .tab.active')?.dataset.id || null);

async function treSchede(shell, testServer) {
  for (let i = 0; i < 3; i++) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>Pagina ${i}</title><p>${i}</p>`));
  }
  await expect.poll(() => shell.evaluate(() => [...document.querySelectorAll('#tabs .tab .title')].filter((t) => /Pagina \d/.test(t.textContent)).length), { timeout: 15_000 }).toBe(3);
  const ids = await aperte(shell);
  await shell.evaluate((x) => window.filoShell.tabs.activate(x), ids.at(-1));
  await expect(shell.locator('#tabs .tab.active')).toHaveAttribute('data-id', ids.at(-1));
  return ids;
}

// La finestra a schermo in (0,0) e il sistema che dice «massimizzata»: il primo pixel della barra è il bordo dello schermo.
async function massimizzataASchermo(app, shell) {
  await Gesti.finestraASchermo(app);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.setPosition(0, 0);
    w.isMaximized = () => true;
    w.emit('maximize');
  });
  await expect(shell.locator('html')).toHaveAttribute('data-schede-al-bordo', '');
  await shell.waitForTimeout(500);
}

// Il punto dello schermo (px veri) sul primo pixel in alto sopra il centro di `sel`.
async function primoPixelSopra(app, shell, sel) {
  const r = await shell.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left + b.width / 2 }; }, sel);
  const o = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return { cb: w.getContentBounds(), z: w.webContents.getZoomFactor() || 1, s: screen.getPrimaryDisplay().scaleFactor };
  });
  return { x: Math.round((o.cb.x + r.x * o.z) * o.s), y: Math.round(o.cb.y * o.s), s: o.s, z: o.z, cb: o.cb };
}

test.describe('col puntatore vero, a finestra massimizzata', () => {
  test.skip(!Gesti.disponibili(), 'servono un display X e XTest (lo schermo virtuale delle prove su Linux)');

  test('esplora', async ({ app, shell, testServer }) => {
    const ids = await treSchede(shell, testServer);
    await massimizzataASchermo(app, shell);
    await shell.evaluate(() => { window.__ev = []; for (const t of ['mousedown', 'mouseup', 'click', 'mousemove']) document.addEventListener(t, (e) => window.__ev.push(`${t}@${e.clientX},${e.clientY}`), true); });
    const info = await app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      return { b: w.getBounds(), cb: w.getContentBounds(), vis: w.isVisible(), op: w.getOpacity(), foc: w.isFocused(), cur: screen.getCursorScreenPoint() };
    });
    console.log('INFO', JSON.stringify(info));
    const esiti = [];
    for (const [i, dy] of [[0, 20], [1, 10], [0, 4], [1, 0]]) {
      const p = await primoPixelSopra(app, shell, `#tabs .tab[data-id="${ids[i]}"]`);
      await shell.evaluate((x) => window.filoShell.tabs.activate(x), ids.at(-1));
      await shell.waitForTimeout(300);
      puntatore(`move:${p.x}:${p.y + dy};wait:200;down:1;wait:80;up:1;wait:300`);
      await shell.waitForTimeout(500);
      esiti.push({ dy, p, attiva: await attiva(shell), voluta: ids[i], ev: await shell.evaluate(() => window.__ev.splice(0).filter((e) => !e.startsWith('mousemove')).join(' ')) });
    }
    console.log('ESITI', JSON.stringify(esiti, null, 1));
  });

  test('clic sul primo pixel dello schermo sopra una scheda la apre', async ({ app, shell, testServer }) => {
    const ids = await treSchede(shell, testServer);
    await massimizzataASchermo(app, shell);
    const p = await primoPixelSopra(app, shell, `#tabs .tab[data-id="${ids[0]}"]`);
    expect(p.y).toBe(0);
    puntatore(`move:${p.x}:${p.y};wait:200;down:1;wait:80;up:1;wait:200`);
    await expect.poll(() => attiva(shell), { timeout: 3_000 }).toBe(ids[0]);
  });

  test('col puntatore fermo sul primo pixel la scheda sotto risponde all\'hover', async ({ app, shell, testServer }) => {
    const ids = await treSchede(shell, testServer);
    await massimizzataASchermo(app, shell);
    const p = await primoPixelSopra(app, shell, `#tabs .tab[data-id="${ids[0]}"]`);
    puntatore(`move:${p.x}:${p.y + 20};wait:150;move:${p.x}:${p.y};wait:300`);
    await expect.poll(() => shell.evaluate((x) => document.querySelector(`#tabs .tab[data-id="${x}"]`).matches(':hover'), ids[0]), { timeout: 3_000 }).toBe(true);
  });

  test('tasto centrale sul primo pixel sopra una scheda la chiude', async ({ app, shell, testServer }) => {
    const ids = await treSchede(shell, testServer);
    await massimizzataASchermo(app, shell);
    const p = await primoPixelSopra(app, shell, `#tabs .tab[data-id="${ids[1]}"]`);
    puntatore(`move:${p.x}:${p.y};wait:200;down:2;wait:80;up:2;wait:300`);
    await expect.poll(() => aperte(shell), { timeout: 3_000 }).not.toContain(ids[1]);
  });

  test('una scheda presa dal primo pixel e portata in fondo alla fila cambia posto', async ({ app, shell, testServer }) => {
    const ids = await treSchede(shell, testServer);
    await massimizzataASchermo(app, shell);
    const da = await primoPixelSopra(app, shell, `#tabs .tab[data-id="${ids[0]}"]`);
    const a = await primoPixelSopra(app, shell, `#tabs .tab[data-id="${ids.at(-1)}"]`);
    const passi = [];
    for (let i = 1; i <= 20; i++) passi.push(`move:${Math.round(da.x + (a.x + 30 - da.x) * i / 20)}:${16}`, 'wait:40');
    puntatore(`move:${da.x}:${da.y};wait:200;down:1;wait:150;${passi.join(';')};wait:300;up:1;wait:300`);
    await expect.poll(async () => (await aperte(shell)).indexOf(ids[0]), { timeout: 5_000 }).toBe(ids.length - 1);
  });

  test('clic sul primo pixel sopra il pulsante della scheda nuova apre una scheda', async ({ app, shell, testServer }) => {
    const ids = await treSchede(shell, testServer);
    await massimizzataASchermo(app, shell);
    const p = await primoPixelSopra(app, shell, '#tab-new');
    puntatore(`move:${p.x}:${p.y};wait:200;down:1;wait:80;up:1;wait:300`);
    await expect.poll(async () => (await aperte(shell)).length, { timeout: 3_000 }).toBe(ids.length + 1);
  });
});

test('col menu della barra laterale aperto, il clic sul suo bordo sopra la barra lo chiude e non arriva a nessuno', async ({ app, shell, testServer }) => {
  await treSchede(shell, testServer);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await expect.poll(async () => (await statoBarra(app))?.aperta, { timeout: 5_000 }).toBe(true);
  const spia = `window.__pressioni = 0;
    for (const ev of ['mousedown', 'mouseup', 'click', 'contextmenu', 'pointerdown']) document.addEventListener(ev, () => { window.__pressioni++; }, true); true`;
  await barra.evaluate(spia);
  await shell.evaluate(spia);
  await app.evaluate(({ BrowserWindow }, js) => {
    const madre = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const t = madre._filoTabs.tabs.find((x) => x.id === madre._filoTabs.activeId);
    return t.view.webContents.executeJavaScript(js);
  }, spia);
  await barra.locator('#nav .ico').first().click({ button: 'right' });
  await expect.poll(() => vociDelMenu(app), { timeout: 8_000 }).not.toBe(null);
  await barra.evaluate(() => { window.__pressioni = 0; });
  await shell.evaluate(() => { window.__pressioni = 0; });
  // Un punto del bordo trasparente del menu (fuori dal riquadro) che cade sopra la vista della barra laterale.
  const b = await app.evaluate(async ({ BrowserWindow }) => {
    const madre = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const m = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible() && w.webContents.getURL().startsWith('data:text/html'));
    const r = JSON.parse(await m.webContents.executeJavaScript('JSON.stringify(document.querySelector(".menu").getBoundingClientRect())'));
    const cm = madre.getContentBounds();
    const cb = m.getContentBounds();
    const vb = madre._filoTabs.barra.vista.getBounds();
    for (let ly = 0; ly < cb.height; ly += 2) {
      for (let lx = 0; lx < cb.width; lx += 2) {
        if (lx >= r.left && lx <= r.right && ly >= r.top && ly <= r.bottom) continue;
        const x = cb.x + lx - cm.x;
        const y = cb.y + ly - cm.y;
        if (x >= vb.x + 2 && x < vb.x + vb.width - 2 && y >= vb.y + 2 && y < vb.y + vb.height - 2) {
          m.webContents.sendInputEvent({ type: 'mouseMove', x: lx, y: ly });
          m.webContents.sendInputEvent({ type: 'mouseDown', x: lx, y: ly, button: 'left', clickCount: 1 });
          m.webContents.sendInputEvent({ type: 'mouseUp', x: lx, y: ly, button: 'left', clickCount: 1 });
          return { trovato: true, x, y, vb, cb, r };
        }
      }
    }
    return { trovato: false, vb, cb, r, cm };
  });
  expect(b.trovato, `nessun punto del bordo del menu sopra la barra laterale: ${JSON.stringify(b)}`).toBe(true);
  await expect.poll(() => vociDelMenu(app), { timeout: 3_000 }).toBe(null);
  await shell.waitForTimeout(400);
  expect(await barra.evaluate(() => window.__pressioni), 'il clic non deve arrivare alla barra laterale').toBe(0);
  expect(await shell.evaluate(() => window.__pressioni), 'il clic non deve arrivare alla fila delle schede').toBe(0);
  const allaPagina = await app.evaluate(({ BrowserWindow }) => {
    const madre = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const t = madre._filoTabs.tabs.find((x) => x.id === madre._filoTabs.activeId);
    return t.view.webContents.executeJavaScript('window.__pressioni');
  });
  expect(allaPagina, 'il clic non deve arrivare alla pagina').toBe(0);
});
