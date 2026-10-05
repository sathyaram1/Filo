// #799 giro 1: esplorazione avversariale della guardia su WebGL esportato dopo un frame, alpha
// traslucido, jpeg, canvas grandi. Stampa le misure; asserisce solo ciò che l'utente vedrebbe.

import { test, expect } from '../../fixtures/electron.mjs';

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
  return sec;
}

async function protettaPoiOff(openTab, testServer, probe, arg) {
  const page = await testServer.openReady(openTab, '<title>FP_ON</title><p>ok</p>');
  await page.waitForFunction(() => window.__filoFpGuard === true, null, { timeout: 6_000 });
  const on = await page.evaluate(probe, arg);
  await setFpMode(openTab, 'off');
  await page.goto(testServer.html('<title>FP_OFF</title><p>ok</p>'));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
  expect(await page.evaluate(() => !!window.__filoFpGuard)).toBe(false);
  const off = await page.evaluate(probe, arg);
  return { page, on, off };
}

async function decodifica(page, urls) {
  return page.evaluate(async (list) => {
    const out = [];
    for (const u of list) {
      const img = new Image();
      img.src = u;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      out.push(Array.from(x.getImageData(0, 0, c.width, c.height).data));
    }
    return out;
  }, urls);
}

function scarto(a, b) {
  let maxRGB = 0, alpha = 0, diversi = 0, maxA = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    if (d) diversi++;
    maxRGB = Math.max(maxRGB, d);
    if (a[i + 3] !== b[i + 3]) alpha++;
    maxA = Math.max(maxA, b[i + 3]);
  }
  return { lunghezze: a.length === b.length, maxRGB, alpha, diversi, pixel: a.length / 4, maxAlphaOff: maxA };
}

async function probe({ W, H }) {
  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
  const scena = (gl) => {
    const sh = (tipo, src) => { const s = gl.createShader(tipo); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }'));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, 'precision mediump float; uniform float a; void main(){ vec2 q = gl_FragCoord.xy; gl_FragColor = vec4(fract(q.x / 17.0) * a, fract(q.y / 13.0) * a, fract((q.x + 2.0 * q.y) / 23.0) * a, a); }'));
    gl.linkProgram(pr); gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    return (a) => { gl.uniform1f(gl.getUniformLocation(pr, 'a'), a); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 6); };
  };
  const mk = (attrs, inDom) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    if (inDom) document.body.appendChild(c);
    const gl = c.getContext('webgl', Object.assign({ antialias: false }, attrs));
    return { c, gl, draw: scena(gl) };
  };
  const out = {};
  // Screenshot di una app 3D: preserveDrawingBuffer, esportato in un compito successivo.
  { const s = mk({ preserveDrawingBuffer: true }, true); s.draw(1); await raf(); await raf(); out.pdbTrue = s.c.toDataURL(); }
  // Buffer non preservato, esportato dopo che il frame è stato mostrato.
  { const s = mk({}, true); s.draw(1); await raf(); await raf(); out.pdbFalse = s.c.toDataURL(); }
  // Scena traslucida (alpha 0.5 premoltiplicato) esportata subito.
  { const s = mk({}, false); s.draw(0.5); out.trasl = s.c.toDataURL(); }
  { const s = mk({}, false); s.draw(0.1); out.trasl01 = s.c.toDataURL(); }
  // JPEG con qualità.
  { const s = mk({}, false); s.draw(1); out.jpeg = s.c.toDataURL('image/jpeg', 0.92); out.jpegLen = out.jpeg.length; }
  // Canvas 2D traslucido esportato.
  { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    for (let i = 0; i < W; i++) { x.fillStyle = `rgba(${i % 256},${(i * 3) % 256},${(i * 7) % 256},${0.05 + (i % 10) / 11})`; x.fillRect(i, 0, 1, H); }
    out.trasl2d = c.toDataURL(); }
  // Tempo: canvas WebGL 1920x1080 esportato.
  { const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const gl = c.getContext('webgl'); scena(gl)(1);
    const t0 = performance.now(); const u = c.toDataURL(); out.msGrande = performance.now() - t0; out.lenGrande = u.length; }
  // Rilevabilità del travestimento.
  out.getCtxStr = HTMLCanvasElement.prototype.getContext.toString();
  out.getCtxProto = 'prototype' in HTMLCanvasElement.prototype.getContext;
  out.fnToStr = Function.prototype.toString.call(HTMLCanvasElement.prototype.getContext).slice(0, 60);
  return out;
}

test('esplora WebGL e alpha', async ({ openTab, testServer }) => {
  const W = 64, H = 32;
  const { page, on, off } = await protettaPoiOff(openTab, testServer, probe, { W, H });
  const chiavi = ['pdbTrue', 'pdbFalse', 'trasl', 'trasl01', 'trasl2d'];
  const imgs = await decodifica(page, chiavi.flatMap((k) => [on[k], off[k]]));
  const res = {};
  chiavi.forEach((k, i) => { res[k] = scarto(imgs[2 * i], imgs[2 * i + 1]); });
  console.log('MISURE', JSON.stringify(res, null, 1));
  console.log('ALTRO', JSON.stringify({ jpegOn: on.jpegLen, jpegOff: off.jpegLen, msOn: on.msGrande, msOff: off.msGrande,
    lenOn: on.lenGrande, lenOff: off.lenGrande, getCtxStr: on.getCtxStr, getCtxProto: [on.getCtxProto, off.getCtxProto], fnToStr: on.fnToStr }));
  expect(res.pdbTrue.maxRGB).toBeLessThanOrEqual(1);
  expect(res.pdbFalse.maxRGB).toBeLessThanOrEqual(1);
});
