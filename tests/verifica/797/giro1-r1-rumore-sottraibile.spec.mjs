// #797 giro 1 — r1: il rumore dipende solo dalla posizione, non dal contenuto: si misura su un segnale noto e si toglie.

import { test, expect } from '../../fixtures/electron.mjs';

const FP = `function (len) {
  var ctx = new OfflineAudioContext(1, len, 44100);
  var osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 10000;
  var comp = ctx.createDynamicsCompressor(); comp.threshold.value = -50; comp.knee.value = 40;
  comp.ratio.value = 12; comp.attack.value = 0; comp.release.value = 0.25;
  osc.connect(comp); comp.connect(ctx.destination); osc.start(0);
  return new Promise(function (res) { ctx.oncomplete = function (e) { res(Array.from(e.renderedBuffer.getChannelData(0).slice(4500, 5000))); }; ctx.startRendering(); });
}`;

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

test('r1 audio: un rendering muto resta muto, e il rumore misurato su un suono noto non restituisce l\'impronta vera', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<title>R1</title><p>r1</p>');
  const leggi = () => page.evaluate(async (src) => {
    const fp = eval('(' + src + ')');
    const muto = await new OfflineAudioContext(1, 4410, 44100).startRendering();
    const nonZero = muto.getChannelData(0).filter((v) => v !== 0).length;
    const dcCtx = new OfflineAudioContext(1, 44100, 44100);
    const cs = dcCtx.createConstantSource(); cs.offset.value = 0.001; cs.connect(dcCtx.destination); cs.start(0);
    const dc = (await dcCtx.startRendering()).getChannelData(0);
    const vero = await fp(44100);
    const tolto = vero.map((v, k) => Math.fround(v - (dc[4500 + k] - Math.fround(0.001))));
    return { guard: !!window.__filoFpGuard, nonZero, vero, tolto };
  }, FP);
  const on = await leggi();
  await setFpMode(openTab, 'off');
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  const off = await leggi();
  expect(on.guard).toBe(true);
  expect(off.guard).toBe(false);
  expect(on.vero.filter((v, k) => v === off.vero[k]).length).toBeLessThan(250);
  expect(off.nonZero).toBe(0);
  expect(on.nonZero).toBe(0);
  const ricostruiti = on.tolto.filter((v, k) => v === off.vero[k]).length;
  expect(ricostruiti).toBeLessThan(250);
});

test('r1 canvas: lo stesso pixel cambia allo stesso modo qualunque colore abbia', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<title>R1C</title><p>r1</p>');
  const r = await page.evaluate(() => {
    const W = 200, H = 60;
    const maschera = (R, G, B) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'); x.fillStyle = `rgb(${R},${G},${B})`; x.fillRect(0, 0, W, H);
      const d = x.getImageData(0, 0, W, H).data, m = [];
      for (let i = 0; i < d.length; i += 4) m.push(((d[i] ^ R) << 2) | ((d[i + 1] ^ G) << 1) | (d[i + 2] ^ B));
      return m;
    };
    const a = maschera(120, 60, 200), b = maschera(30, 170, 90);
    let toccati = 0, uguali = 0;
    for (let k = 0; k < a.length; k++) if (a[k] || b[k]) { toccati++; if (a[k] === b[k]) uguali++; }
    return { toccati, uguali, guard: !!window.__filoFpGuard };
  });
  expect(r.guard).toBe(true);
  expect(r.toccati).toBeGreaterThan(0);
  expect(r.uguali / r.toccati).toBeLessThan(0.5);
});
