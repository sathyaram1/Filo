import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

const PAGINA = '<!doctype html><meta charset="utf-8"><title>porte</title><body><p>ok</p></body>';

async function porte() {
  const fnv = (s) => { let a = 2166136261; for (let i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; return a.toString(16); };
  const c = document.createElement('canvas'); c.width = 80; c.height = 40;
  const x = c.getContext('2d'); x.fillStyle = '#1e90ff'; x.fillRect(0, 0, 80, 40); x.fillStyle = '#000'; x.font = '16px sans-serif'; x.fillText('filo', 4, 24);
  const px = (a) => fnv(Array.prototype.join.call(a, ','));
  const leggi = (W) => { try { return fnv(W.HTMLCanvasElement.prototype.toDataURL.call(c)); } catch (e) { return 'errore ' + e.message; } };
  const ultimo = () => window[window.length - 1];
  const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
  const carico = (f) => new Promise((r) => { f.addEventListener('load', r, { once: true }); setTimeout(r, 4000); });
  const out = { pagina: fnv(c.toDataURL()), paginaPx: px(x.getImageData(0, 0, 80, 40).data) };
  // staccato
  { const f = document.createElement('iframe'); document.body.appendChild(f); const W = f.contentWindow;
    const td = W.HTMLCanvasElement.prototype.toDataURL, gi = W.CanvasRenderingContext2D.prototype.getImageData;
    f.remove();
    try { out.staccatoToDataURL = fnv(td.call(c)); } catch (e) { out.staccatoToDataURL = 'errore ' + e.message; }
    try { out.staccatoPx = px(gi.call(x, 0, 0, 80, 40).data); } catch (e) { out.staccatoPx = 'errore ' + e.message; } }
  // navigato altrove
  { const f = document.createElement('iframe'); document.body.appendChild(f); const W = f.contentWindow;
    const td = W.HTMLCanvasElement.prototype.toDataURL;
    f.src = location.protocol + '//sito-pubblico.test:' + location.port + '/altro'; await carico(f);
    try { out.navigatoAltroSito = fnv(td.call(c)); } catch (e) { out.navigatoAltroSito = 'errore ' + e.message; }
    try { out.navigatoAltroSitoBlob = await new Promise((res) => td && W && HTMLCanvasElement && (function () {
      const tb = f.__tb; res(tb ? 'x' : 'n/a'); })()); } catch (e) { out.navigatoAltroSitoBlob = 'errore ' + e.message; } }
  { const f = document.createElement('iframe'); document.body.appendChild(f); const W = f.contentWindow;
    const tb = W.HTMLCanvasElement.prototype.toBlob;
    f.src = location.protocol + '//sito-pubblico.test:' + location.port + '/altro'; await carico(f);
    try { out.navigatoAltroSitoToBlob = await new Promise((res) => tb.call(c, (b) => { const fr = new FileReader(); fr.onload = () => res(fnv(fr.result)); fr.readAsDataURL(b); })); } catch (e) { out.navigatoAltroSitoToBlob = 'errore ' + e.message; } }
  { const f = document.createElement('iframe'); document.body.appendChild(f); const W = f.contentWindow;
    const td = W.HTMLCanvasElement.prototype.toDataURL;
    f.src = '/stessa'; await carico(f);
    try { out.navigatoStessoSito = fnv(td.call(c)); } catch (e) { out.navigatoStessoSito = 'errore ' + e.message; } }
  // inserimenti per setter
  { const t = document.createElement('table'); document.body.appendChild(t); const cap = document.createElement('caption'); cap.appendChild(document.createElement('iframe'));
    t.caption = cap; out.didascalia = leggi(ultimo()); }
  { const t = document.createElement('table'); document.body.appendChild(t); const th = document.createElement('thead'); const tr = th.insertRow(); const td = tr.insertCell(); td.appendChild(document.createElement('iframe'));
    t.tHead = th; out.testata = leggi(ultimo()); }
  { const s = document.createElement('select'); document.body.appendChild(s); const o = document.createElement('option'); o.appendChild(document.createElement('iframe'));
    s.add(o); out.selectAdd = leggi(ultimo()); }
  { const s = document.createElement('select'); document.body.appendChild(s); const o = document.createElement('option'); o.appendChild(document.createElement('iframe'));
    s.options[0] = o; out.selectOpzioniIndice = leggi(ultimo()); }
  // chiamate riscritte (giro 7)
  { const fc = Function.prototype.call, fa = Function.prototype.apply;
    try {
      Function.prototype.call = function () { throw new Error('no call'); };
      Function.prototype.apply = function () { throw new Error('no apply'); };
      let ok = 'ok';
      const f = document.createElement('iframe');
      try { document.body.appendChild(f); } catch (e) { ok = 'append lancia'; }
      let v; try { v = Reflect.apply(f.contentWindow.HTMLCanvasElement.prototype.toDataURL, c, []); } catch (e) { v = 'errore ' + e.message; }
      out.chiamateRiscritte = ok === 'ok' ? fnv(v) : ok;
    } finally { Function.prototype.call = fc; Function.prototype.apply = fa; }
  }
  // pila di un errore
  try { document.body.appendChild(null); } catch (e) { out.pilaAppend = String(e.stack.split('\n').length); }
  try { HTMLCanvasElement.prototype.toDataURL.call({}); } catch (e) { out.pilaToDataURL = String(e.stack.split('\n').length); }
  // WebGL2 con buffer di lettura
  { const gc = document.createElement('canvas'); gc.width = 32; gc.height = 16;
    const gl = gc.getContext('webgl2', { preserveDrawingBuffer: true });
    if (gl) {
      gl.clearColor(0.2, 0.4, 0.6, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      const a = new Uint8Array(32 * 16 * 4); gl.readPixels(0, 0, 32, 16, gl.RGBA, gl.UNSIGNED_BYTE, a); out.gl2Diretto = px(a);
      const b = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b); gl.bufferData(gl.PIXEL_PACK_BUFFER, 32 * 16 * 4, gl.STREAM_READ);
      gl.readPixels(0, 0, 32, 16, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      const d = new Uint8Array(32 * 16 * 4); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, d); out.gl2Buffer = px(d);
    } else out.gl2Diretto = out.gl2Buffer = 'senza webgl2';
  }
  // riquadro vuoto riempito con document.write dopo la preparazione
  { const f = document.createElement('iframe'); document.body.appendChild(f); const d = f.contentDocument; d.open(); d.write('<p>x</p>'); d.close();
    out.dopoWrite = leggi(f.contentWindow); }
  await dorme(10);
  return out;
}

async function apri() {
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PAGINA);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, url: `http://127.0.0.1:${srv.address().port}/` };
}

test('esplora porte giro 8', async ({ openTab }) => {
  test.setTimeout(120_000);
  const { srv, url } = await apri();
  try {
    const page = await openTab(url);
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
    const on = await page.evaluate(porte);
    await setFpMode(openTab, 'off');
    await page.goto(url + '?off');
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
    const off = await page.evaluate(porte);
    console.log('ON ', JSON.stringify(on, null, 1));
    console.log('OFF', JSON.stringify(off, null, 1));
  } finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
});
