// Verifica #798 giro 8. r2: la lettura dei pixel WebGL2 fatta in un buffer della scheda grafica e poi copiata fuori
// esce senza rumore, nella pagina principale, mentre la lettura diretta ce l'ha.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

function letture() {
  const fnv = (s) => { let a = 2166136261; for (let i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; return a.toString(16); };
  const px = (a) => fnv(Array.prototype.join.call(a, ','));
  const gc = document.createElement('canvas'); gc.width = 32; gc.height = 16;
  const gl = gc.getContext('webgl2', { preserveDrawingBuffer: true });
  if (!gl) return { diretto: 'senza webgl2', buffer: 'senza webgl2' };
  gl.clearColor(0.2, 0.4, 0.6, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  const a = new Uint8Array(32 * 16 * 4); gl.readPixels(0, 0, 32, 16, gl.RGBA, gl.UNSIGNED_BYTE, a);
  const b = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b); gl.bufferData(gl.PIXEL_PACK_BUFFER, 32 * 16 * 4, gl.STREAM_READ);
  gl.readPixels(0, 0, 32, 16, gl.RGBA, gl.UNSIGNED_BYTE, 0);
  const d = new Uint8Array(32 * 16 * 4); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, d);
  return { diretto: px(a), buffer: px(d) };
}

test('r2 la lettura WebGL2 passata da un buffer ha lo stesso rumore della lettura diretta', async ({ openTab }) => {
  test.setTimeout(90_000);
  const srv = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!doctype html><body>gl</body>'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/`;
  try {
    const page = await openTab(url);
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
    const on = await page.evaluate(letture);
    await setFpMode(openTab, 'off');
    await page.goto(url + '?off');
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
    const off = await page.evaluate(letture);
    test.skip(on.diretto === 'senza webgl2', 'WebGL2 non disponibile');
    expect(on.diretto).not.toBe(off.diretto);
    expect(on.buffer).toBe(on.diretto);
  } finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
});
