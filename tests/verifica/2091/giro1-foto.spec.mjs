// Verifica #2091 giro 1: fotografie a metà trascinamento con gesti veri (linguetta che segue, luce sulla destinazione).

import { test, expect } from '../../fixtures/electron.mjs';
import { spawn } from 'node:child_process';
import * as Gesti from '../../helpers/gestiVeri.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const ARTICOLO = `<!doctype html><html><head><meta charset="utf-8"><title>Articolo sulla Tesla volante</title></head>
  <body style="font:16px sans-serif;padding:40px"><h1>La Tesla vola</h1></body></html>`;
const CAMPO = `<!doctype html><html><head><meta charset="utf-8"><title>Modulo</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif"><textarea id="ta" style="width:400px;height:120px"></textarea></body></html>`;

async function linguetta(app, shell, id) {
  const r = await shell.locator(`.tab[data-id="${id}"]`).boundingBox();
  const o = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const cb = w.getContentBounds();
    return { x: cb.x, y: cb.y };
  });
  return { x: Math.round(o.x + r.x + r.width / 2), y: Math.round(o.y + r.y + r.height / 2) };
}

// Preme, porta il puntatore a `a` e ci resta `fermo` secondi prima di lasciare.
function tieni(da, a, fermo = 3) {
  return spawn('python3', ['-I', '-c', `
import ctypes, time
X = ctypes.cdll.LoadLibrary('libX11.so.6'); T = ctypes.cdll.LoadLibrary('libXtst.so.6')
X.XOpenDisplay.restype = ctypes.c_void_p
d = ctypes.c_void_p(X.XOpenDisplay(None))
def m(x, y): T.XTestFakeMotionEvent(d, -1, int(x), int(y), 0); X.XFlush(d)
def b(g): T.XTestFakeButtonEvent(d, 1, 1 if g else 0, 0); X.XFlush(d)
m(${da.x}, ${da.y}); time.sleep(0.2); b(True); time.sleep(0.15)
for i in range(1, 26):
    m(${da.x} + (${a.x} - ${da.x}) * i / 25, ${da.y} + (${a.y} - ${da.y}) * i / 25); time.sleep(0.04)
time.sleep(${fermo}); b(False); time.sleep(0.3)
`], { env: process.env, stdio: 'ignore' });
}

// Lo schermo X intero: la shell e le viste sopra, come le vede l'utente.
async function fotoFinestra(app, nome) {
  const { execFileSync } = await import('node:child_process');
  const { mkdirSync } = await import('node:fs');
  mkdirSync('tests/.shots', { recursive: true });
  execFileSync('import', ['-window', 'root', `tests/.shots/${nome}.png`], { env: process.env });
}

test('foto a metà: in fila, sopra la textarea, sopra la chat della home', async ({ app, shell, openTab, testServer }) => {
  test.skip(!Gesti.disponibili(), 'servono XTest e un display X');
  test.setTimeout(90_000);
  await Gesti.finestraASchermo(app);
  await testServer.openReady(openTab, ARTICOLO);
  const idArticolo = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  const modulo = await testServer.openReady(openTab, CAMPO);
  await Gesti.finestraASchermo(app);

  let p = tieni(await linguetta(app, shell, idArticolo), { ...(await linguetta(app, shell, idArticolo)), x: (await linguetta(app, shell, idArticolo)).x + 90 });
  await shell.waitForTimeout(1800);
  await shell.screenshot({ path: 'tests/.shots/2091-metà-fila.png' });
  const tr = await shell.locator(`.tab[data-id="${idArticolo}"]`).evaluate((el) => getComputedStyle(el).transform);
  await new Promise((r) => p.on('exit', r));

  p = tieni(await linguetta(app, shell, idArticolo), await Gesti.sulloSchermo(app, modulo, modulo, '#ta'));
  await shell.waitForTimeout(1800);
  await fotoFinestra(app, '2091-metà-textarea');
  const luce = await modulo.evaluate(() => !!document.querySelector('filo-luce'));
  await new Promise((r) => p.on('exit', r));

  const nuova = await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab'));
  const casa = await home(app, { scheda: nuova?.id });
  await Gesti.finestraASchermo(app);
  p = tieni(await linguetta(app, shell, idArticolo), await Gesti.sulloSchermo(app, casa, casa, '#input'));
  await shell.waitForTimeout(1800);
  await fotoFinestra(app, '2091-metà-home');
  await new Promise((r) => p.on('exit', r));
  await casa.waitForTimeout(500);
  await fotoFinestra(app, '2091-dopo-home');
  expect(tr).not.toBe('none');
  expect(luce).toBe(true);
});
