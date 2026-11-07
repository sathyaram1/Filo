// Esplorazione: col puntatore vero di X il rettangolo nativo compare o no?
import { execFileSync } from 'node:child_process';
import { test, expect } from '../../fixtures/electron.mjs';

const XMOVE = '/tmp/claude-0/-home-user-Filo/2a452da3-2895-5eea-97ac-497fca87a12d/scratchpad/xmove.py';
const OUT = '/tmp/claude-0/-home-user-Filo/2a452da3-2895-5eea-97ac-497fca87a12d/scratchpad';

async function schermo(app, page, sel) {
  const r = await page.locator(sel).first().evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  const url = page.url();
  const off = await app.evaluate(({ BrowserWindow }, u) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const cb = w.getContentBounds();
      for (const v of w.contentView.children) {
        if (v.webContents && v.webContents.getURL() === u) { const b = v.getBounds(); return { x: cb.x + b.x, y: cb.y + b.y, z: v.webContents.getZoomFactor(), display: process.env.DISPLAY }; }
      }
    }
    return null;
  }, url);
  return { x: Math.round(off.x + r.x * off.z), y: Math.round(off.y + r.y * off.z), display: off.display };
}

function x(display, ...a) { return execFileSync('python3', [XMOVE, ...a.map(String)], { env: { ...process.env, DISPLAY: display } }).toString(); }
function foto(display, nome) { execFileSync('import', ['-window', 'root', `${OUT}/${nome}.png`], { env: { ...process.env, DISPLAY: display } }); }

async function prova(app, page, sel, nome) {
  const p = await schermo(app, page, sel);
  x(p.display, 'move', 5, 5);
  await page.waitForTimeout(300);
  x(p.display, 'move', p.x - 3, p.y - 2);
  await page.waitForTimeout(40);
  x(p.display, 'move', p.x, p.y);
  await page.waitForTimeout(2500);
  foto(p.display, nome);
  const stato = await page.evaluate((s) => ({ title: document.querySelector(s)?.getAttribute('title'), fumetto: window.SN_SUGGERIMENTO?.aperto?.()?.testo || null }), sel);
  console.log(nome, JSON.stringify(p), JSON.stringify(stato));
  x(p.display, 'move', 5, 5);
  await page.waitForTimeout(300);
}

test('nativo: sito di controllo e pagine di Filo', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const sito = await testServer.openReady(openTab, '<!doctype html><html><body style="padding:60px">'
    + '<button id="delSito" style="font-size:30px" title="TITOLO DEL SITO">Bottone</button></body></html>');
  await prova(app, sito, '#delSito', 'a-sito');

  const home = await openTab('filo://newtab/');
  await home.waitForFunction(() => !!window.SN_SUGGERIMENTO);
  await home.waitForTimeout(800);
  await prova(app, home, '#sendBtn', 'b-home-invia');

  const pref = await openTab('filo://preferences/preferences.html');
  await pref.waitForFunction(() => !!window.SN_SUGGERIMENTO);
  await pref.evaluate(() => {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:200px;top:200px;z-index:2147480000;display:flex;gap:30px';
    box.innerHTML = '<button id="pSpento" disabled title="SPENTO CON TITOLO" style="font-size:30px">B</button>'
      + '<button id="pAcceso" title="ACCESO CON TITOLO" style="font-size:30px">C</button>'
      + '<span id="pSpan" title="SPAN NEL TESTO" style="font-size:30px">testo</span>';
    document.body.appendChild(box);
  });
  await prova(app, pref, '#pSpento', 'c-pref-spento');
  await prova(app, pref, '#pAcceso', 'd-pref-acceso');
  await prova(app, pref, '#pSpan', 'e-pref-span');
  expect(true).toBe(true);
});
