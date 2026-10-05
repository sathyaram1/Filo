// Esplorazione giro 2 di #799: stesse pagine con la guardia (Automatico) e senza (Off).
import { test, expect } from '../../fixtures/electron.mjs';

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

async function onOff(openTab, testServer, probe, arg) {
  const page = await testServer.openReady(openTab, '<title>FP_ON</title><p>ok</p>');
  await page.waitForFunction(() => window.__filoFpGuard === true, null, { timeout: 6_000 });
  const on = await page.evaluate(probe, arg);
  await setFpMode(openTab, 'off');
  await page.goto(testServer.html('<title>FP_OFF</title><p>ok</p>'));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
  const off = await page.evaluate(probe, arg);
  return { page, on, off };
}

async function decodifica(page, urls) {
  return page.evaluate(async (list) => {
    const out = [];
    for (const u of list) {
      const img = new Image(); img.src = u; await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      out.push(Array.from(x.getImageData(0, 0, c.width, c.height).data));
    }
    return out;
  }, urls);
}

function scarto(a, b) {
  let maxRGB = 0, alpha = 0, diversi = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    if (d) diversi++;
    maxRGB = Math.max(maxRGB, d);
    if (a[i + 3] !== b[i + 3]) alpha++;
  }
  return { lunghezze: a.length === b.length, maxRGB, alpha, diversi, pixel: a.length / 4 };
}

async function sonda({ W, H }) {
  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
  const scena = (opts, ver) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    document.body.appendChild(c);
    const gl = c.getContext(ver || 'webgl', Object.assign({ antialias: false }, opts));
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }'));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, 'precision mediump float; void main(){ vec2 q = gl_FragCoord.xy; gl_FragColor = vec4(fract(q.x / 17.0), fract(q.y / 13.0), fract((q.x + 2.0 * q.y) / 23.0), 1.0); }'));
    gl.linkProgram(pr); gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.clearColor(0.2, 0.4, 0.6, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 6);
    return { c, gl };
  };
  const out = {};
  // A: canvas 3D visibile, esportato dopo che il fotogramma è andato a schermo (bottone «salva immagine»).
  { const { c } = scena({}); await raf(); await raf(); out.tardiNoPreserve = c.toDataURL(); }
  { const { c } = scena({ preserveDrawingBuffer: true }); await raf(); await raf(); out.tardiPreserve = c.toDataURL(); }
  // B: webgl2 nello stesso compito.
  { const { c, gl } = scena({}, 'webgl2'); out.gl2 = c.toDataURL();
    const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); out.gl2px = Array.from(px.slice(0, 400)); }
  // C: 2D, rilettura e riscrittura dei pixel prima dell'esportazione.
  { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    for (let i = 0; i < 6; i++) { x.fillStyle = `rgb(${40 * i},${200 - 30 * i},${90 + 20 * i})`; x.fillRect(Math.floor(i * W / 6), 0, Math.ceil(W / 6), H); }
    out.d2 = c.toDataURL();
    x.putImageData(x.getImageData(0, 0, W, H), 0, 0);
    out.d2giro = c.toDataURL();
    out.d2get2 = Array.from(x.getImageData(0, 0, W, H).data);
  }
  // D: testo semitrasparente come fpjs.
  { const c = document.createElement('canvas'); c.width = 240; c.height = 60; const x = c.getContext('2d');
    x.textBaseline = 'top'; x.font = "14px 'Arial'"; x.fillStyle = '#f60'; x.fillRect(125, 1, 62, 20);
    x.fillStyle = '#069'; x.fillText('Cwm fjordbank glyphs vext quiz', 2, 15);
    x.fillStyle = 'rgba(102, 204, 0, 0.2)'; x.fillText('Cwm fjordbank glyphs vext quiz', 4, 17);
    out.fp = c.toDataURL(); out.fpjpeg = c.toDataURL('image/jpeg', 0.3).slice(0, 30); }
  // E: canvas grande.
  { const c = document.createElement('canvas'); c.width = 3000; c.height = 3000; const x = c.getContext('2d');
    x.fillStyle = 'rgb(120,60,200)'; x.fillRect(0, 0, 20, 20);
    const u = c.toDataURL();
    const img = new Image(); img.src = u; await img.decode();
    const d = document.createElement('canvas'); d.width = 20; d.height = 20; const dx = d.getContext('2d'); dx.drawImage(img, 0, 0);
    // Rilettura via Off impossibile qui: si conta lo scarto dal colore pieno con getImageData (che però è rumoroso).
    out.grandeUrlLen = u.length; out.grande = u;
  }
  // F: riconoscibilità.
  { const ifr = document.createElement('iframe'); document.body.appendChild(ifr);
    const ts = ifr.contentWindow.Function.prototype.toString;
    out.crossRealm = ts.call(HTMLCanvasElement.prototype.toDataURL);
    out.crossRealmGI = ts.call(CanvasRenderingContext2D.prototype.getImageData);
    out.ifrNative = ifr.contentWindow.HTMLCanvasElement.prototype.toDataURL === HTMLCanvasElement.prototype.toDataURL;
    try { HTMLCanvasElement.prototype.toDataURL.call({}); } catch (e) { out.stack = String(e.stack).split('\n').length; out.stackTxt = String(e.stack); }
  }
  return out;
}

test('esplora', async ({ openTab, testServer }) => {
  test.setTimeout(120_000);
  const W = 64, H = 32;
  const { page, on, off } = await onOff(openTab, testServer, sonda, { W, H });
  const [a1, a0, b1, b0, g1, g0, c1, c0, cg1, cg0, f1, f0] = await decodifica(page,
    [on.tardiNoPreserve, off.tardiNoPreserve, on.tardiPreserve, off.tardiPreserve, on.gl2, off.gl2, on.d2, off.d2, on.d2giro, off.d2giro, on.fp, off.fp]);
  const [big1, big0] = await decodifica(page, [on.grande, off.grande]);
  const r = {
    tardiNoPreserve: scarto(a1, a0), tardiPreserve: scarto(b1, b0), gl2: scarto(g1, g0),
    gl2px: scarto(on.gl2px, off.gl2px),
    d2: scarto(c1, c0), d2giro: scarto(cg1, cg0), d2get2: scarto(on.d2get2, off.d2get2), fp: scarto(f1, f0),
    fpjpeg: [on.fpjpeg, off.fpjpeg], grande: scarto(big1, big0),
    crossRealm: [on.crossRealm, off.crossRealm], crossRealmGI: [on.crossRealmGI, off.crossRealmGI],
    ifrNative: [on.ifrNative, off.ifrNative], stack: [on.stack, off.stack], stackTxt: [on.stackTxt, off.stackTxt],
    offBlankNoPreserve: a0.every((v, i) => (i % 4 === 3) || v === 0),
  };
  console.log(JSON.stringify(r, null, 1));
});
