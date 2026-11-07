// Verifica #2091 giro 1: la scheda trascinata con gesti veri del sistema (XTest), dalla fila alla pagina, al campo di un
// sito, alla chat della home e all'Aiuto; poi il gettone nella chat (anteprima, invio, Backspace, scheda chiusa).

import { test, expect } from '../../fixtures/electron.mjs';
import * as Gesti from '../../helpers/gestiVeri.mjs';
import { home, modelloFinto, chiamateAlModello } from '../../helpers/chatFinta.mjs';
import { paginaDelloStrato } from '../../helpers/riquadri.mjs';

const ARTICOLO = `<!doctype html><html><head><meta charset="utf-8"><title>Articolo sulla Tesla volante</title></head>
  <body style="font:16px sans-serif;padding:40px"><h1>La Tesla vola</h1><p>Testo-segreto-2091 della pagina: il razzo era nel bagagliaio.</p></body></html>`;
const CAMPO = `<!doctype html><html><head><meta charset="utf-8"><title>Modulo</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif"><textarea id="ta" style="width:400px;height:120px"></textarea>
  <p style="margin-top:200px">vuoto</p></body></html>`;

const ordine = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.id));
const attiva = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
const idDi = (shell, frammento) => shell.evaluate(async (f) => (await window.filoShell.tabs.snapshot()).tabs.find((t) => String(t.url || '').includes(f))?.id, frammento);

// Il centro della linguetta `id` in px dello schermo.
async function linguetta(app, shell, id, dx = 0, dy = 0) {
  const r = await shell.locator(`.tab[data-id="${id}"]`).boundingBox();
  const o = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const cb = w.getContentBounds();
    return { x: cb.x, y: cb.y, z: w.webContents.getZoomFactor() || 1 };
  });
  return { x: Math.round(o.x + (r.x + r.width / 2 + dx) * o.z), y: Math.round(o.y + (r.y + r.height / 2 + dy) * o.z) };
}

async function preparaDue(app, shell, openTab, testServer) {
  await Gesti.finestraASchermo(app);
  const articolo = await testServer.openReady(openTab, ARTICOLO);
  const idArticolo = await attiva(shell);
  return { articolo, idArticolo };
}

// I gesti veri passano dallo stesso schermo: una prova per volta.
test.describe.configure({ mode: 'serial' });

test('riordino con gesto vero: la scheda lasciata sulla prima posizione ci resta', async ({ app, shell, openTab, testServer }) => {
  test.skip(!Gesti.disponibili(), 'servono XTest e un display X');
  const { idArticolo } = await preparaDue(app, shell, openTab, testServer);
  const prima = await ordine(shell);
  expect(prima.length).toBeGreaterThanOrEqual(2);
  const primo = prima[0];
  Gesti.trascina(await linguetta(app, shell, idArticolo), await linguetta(app, shell, primo, -30));
  await expect.poll(() => ordine(shell)).toEqual([idArticolo, ...prima.filter((i) => i !== idArticolo)]);
});

test('fuori e dentro la fila con gesto vero: esce sulla pagina, rientra, e il riordino vale', async ({ app, shell, openTab, testServer }) => {
  test.skip(!Gesti.disponibili(), 'servono XTest e un display X');
  const { idArticolo } = await preparaDue(app, shell, openTab, testServer);
  const prima = await ordine(shell);
  const da = await linguetta(app, shell, idArticolo);
  const giu = { x: da.x - 60, y: da.y + 250 };
  const arrivo = await linguetta(app, shell, prima[0], -30);
  // Due tratti senza lasciare: un python a passi, tenendo premuto.
  const { execFileSync } = await import('node:child_process');
  execFileSync('python3', ['-I', '-c', `
import ctypes, time
X = ctypes.cdll.LoadLibrary('libX11.so.6'); T = ctypes.cdll.LoadLibrary('libXtst.so.6')
X.XOpenDisplay.restype = ctypes.c_void_p
d = ctypes.c_void_p(X.XOpenDisplay(None))
def m(x, y): T.XTestFakeMotionEvent(d, -1, int(x), int(y), 0); X.XFlush(d)
def b(g): T.XTestFakeButtonEvent(d, 1, 1 if g else 0, 0); X.XFlush(d)
pts = [(${da.x}, ${da.y}), (${giu.x}, ${giu.y}), (${arrivo.x}, ${arrivo.y})]
m(*pts[0]); time.sleep(0.2); b(True); time.sleep(0.15)
for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
    for i in range(1, 26):
        m(x1 + (x2 - x1) * i / 25, y1 + (y2 - y1) * i / 25); time.sleep(0.04)
    time.sleep(0.3)
m(pts[-1][0] + 1, pts[-1][1]); time.sleep(0.2); b(False); time.sleep(0.3)
`], { env: process.env });
  await expect.poll(() => ordine(shell)).toEqual([idArticolo, ...prima.filter((i) => i !== idArticolo)]);
});

test('lasciata sulla pagina vuota con gesto vero: ordine uguale, niente errori', async ({ app, shell, openTab, testServer }) => {
  test.skip(!Gesti.disponibili(), 'servono XTest e un display X');
  const errori = [];
  shell.on('console', (m) => { if (m.type() === 'error') errori.push(m.text()); });
  shell.on('pageerror', (e) => errori.push(String(e)));
  const { idArticolo } = await preparaDue(app, shell, openTab, testServer);
  const prima = await ordine(shell);
  const da = await linguetta(app, shell, idArticolo);
  Gesti.trascina(da, { x: da.x, y: da.y + 300 });
  await shell.waitForTimeout(600);
  expect(await ordine(shell)).toEqual(prima);
  expect(await shell.evaluate(() => [...document.querySelectorAll('.tab')].map((t) => t.style.transform).filter(Boolean))).toEqual([]);
  expect(errori).toEqual([]);
});

test('lasciata nella textarea di un sito con gesto vero: titolo e indirizzo', async ({ app, shell, openTab, testServer }) => {
  test.skip(!Gesti.disponibili(), 'servono XTest e un display X');
  const { idArticolo, articolo } = await preparaDue(app, shell, openTab, testServer);
  const urlArticolo = articolo.url();
  const modulo = await testServer.openReady(openTab, CAMPO);
  await Gesti.finestraASchermo(app);
  Gesti.trascina(await linguetta(app, shell, idArticolo), await Gesti.sulloSchermo(app, modulo, modulo, '#ta'));
  await expect(modulo.locator('#ta')).toHaveValue(/Articolo sulla Tesla volante/);
  await expect(modulo.locator('#ta')).toHaveValue(new RegExp(urlArticolo.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')));
});

test('lasciata nella chat della home con gesto vero: gettone', async ({ app, shell, openTab, testServer }) => {
  test.skip(!Gesti.disponibili(), 'servono XTest e un display X');
  const { idArticolo } = await preparaDue(app, shell, openTab, testServer);
  const nuova = await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab'));
  const casa = await home(app, { scheda: nuova?.id });
  await Gesti.finestraASchermo(app);
  Gesti.trascina(await linguetta(app, shell, idArticolo), await Gesti.sulloSchermo(app, casa, casa, '#input'));
  await expect.poll(() => casa.evaluate(() => document.getElementById('input')._snGettoni?.schede().length || 0)).toBe(1);
  await expect(casa.locator('#input')).toHaveValue(/⟦/);
});

test('lasciata nella chat dell\'Aiuto su un sito con gesto vero: gettone', async ({ app, shell, openTab, testServer }) => {
  test.skip(!Gesti.disponibili(), 'servono XTest e un display X');
  test.setTimeout(90_000);
  const { idArticolo } = await preparaDue(app, shell, openTab, testServer);
  const modulo = await testServer.openReady(openTab, CAMPO);
  const id = await attiva(shell);
  await shell.evaluate((i) => window.filoShell.tabs.help(i), id);
  const strato = await paginaDelloStrato(app, modulo);
  const casella = strato.locator('.sn-sidebar-input textarea');
  await casella.waitFor({ timeout: 10_000 });
  await Gesti.finestraASchermo(app);
  Gesti.trascina(await linguetta(app, shell, idArticolo), await Gesti.sulloSchermo(app, modulo, strato, '.sn-sidebar-input textarea'));
  await expect(casella).toHaveValue(/⟦/);
});

test('a metà trascinamento la linguetta sta sotto il puntatore (mouse sintetico)', async ({ app, shell, openTab, testServer }) => {
  const { idArticolo } = await preparaDue(app, shell, openTab, testServer);
  const r = await shell.locator(`.tab[data-id="${idArticolo}"]`).boundingBox();
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  await shell.mouse.move(cx, cy);
  await shell.mouse.down();
  for (let i = 1; i <= 10; i++) await shell.mouse.move(cx - i * 8, cy);
  const t = await shell.locator(`.tab[data-id="${idArticolo}"]`).evaluate((el) => getComputedStyle(el).transform);
  const r2 = await shell.locator(`.tab[data-id="${idArticolo}"]`).boundingBox();
  await shell.mouse.up();
  expect(t).not.toBe('none');
  expect(Math.abs(r2.x + r2.width / 2 - (cx - 80))).toBeLessThan(6);
});

test('gettone: anteprima, invio, filo, Backspace, scheda chiusa, ricarica', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const { idArticolo, articolo } = await preparaDue(app, shell, openTab, testServer);
  const urlArticolo = articolo.url();
  await modelloFinto(app, [{ text: 'Risposta finta.' }]);
  const nuova = await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab'));
  const casa = await home(app, { scheda: nuova?.id });
  // Il rilascio come lo farebbe il main sotto il puntatore.
  const lascia = () => app.evaluate(({ BrowserWindow }, { id }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return t.view.webContents.executeJavaScript(`(() => { const r = document.getElementById('inputForm').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`)
      .then(([x, y]) => {
        const S = require(require('path').join(process.cwd(), 'src/main/schedaTrascinata.js'));
        const b = t.view.getBounds();
        S.riceve(w, { fase: 'lascia', id, x: b.x + x, y: b.y + y }, 1);
      });
  }, { id: idArticolo });
  await casa.locator('#input').fill('come ha fatto a volare?');
  await lascia();
  await expect.poll(() => casa.evaluate(() => document.getElementById('input')._snGettoni?.schede().length || 0)).toBe(1);
  await casa.screenshot({ path: 'tests/.shots/2091-campo.png' });

  // Backspace toglie il gettone come un carattere, poi lo rimetto.
  await casa.locator('#input').focus();
  await casa.keyboard.press('End');
  await casa.keyboard.press('Backspace'); // lo spazio dopo il gettone
  await casa.keyboard.press('Backspace');
  await expect.poll(() => casa.evaluate(() => document.getElementById('input')._snGettoni.schede().length)).toBe(0);
  await expect(casa.locator('#input')).not.toHaveValue(/⟦/);
  await lascia();
  await expect.poll(() => casa.evaluate(() => document.getElementById('input')._snGettoni?.schede().length || 0)).toBe(1);

  await casa.locator('#sendBtn').click();
  await expect.poll(async () => (await chiamateAlModello(app)).length).toBeGreaterThan(0);
  const tutto = JSON.stringify((await chiamateAlModello(app))[0]);
  expect(tutto).toContain('Articolo sulla Tesla volante');
  expect(tutto).toContain(urlArticolo);
  expect(tutto).toContain('Testo-segreto-2091');
  const bolla = casa.locator('.sn-bolla-gettone').first();
  await expect(bolla).toBeVisible();
  await casa.screenshot({ path: 'tests/.shots/2091-filo.png' });

  // Hover: la carta.
  const carta = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .some((w) => !w.isDestroyed() && w.webContents.getURL().includes('anteprima.html') && w.isVisible()));
  await bolla.hover();
  await expect.poll(carta).toBe(true);
  await casa.mouse.move(5, 5);

  // Scheda chiusa: il gettone resta, hover e clic riaprono.
  await shell.evaluate((i) => window.filoShell.tabs.close(i), idArticolo);
  await expect.poll(() => idDi(shell, new URL(urlArticolo).pathname)).toBeUndefined();
  await expect(bolla).toBeVisible();
  await bolla.hover();
  await expect.poll(carta).toBe(true);
  await bolla.click();
  await expect.poll(async () => {
    const s = await shell.evaluate(async () => window.filoShell.tabs.snapshot());
    return s.tabs.find((t) => t.id === s.activeId)?.url;
  }).toBe(urlArticolo);
});
