// #797 giro 1 — l'impronta audio dalla via dell'evento complete, contro Off, con le porte vicine.

import { test, expect } from '../../fixtures/electron.mjs';

const LIB = `
window.__fp = function (useEvent, order, listener) {
  return new Promise(function (resolve) {
    var ctx = new OfflineAudioContext(1, 44100, 44100);
    var osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(10000, ctx.currentTime);
    var comp = ctx.createDynamicsCompressor();
    [['threshold', -50], ['knee', 40], ['ratio', 12], ['reduction', -20], ['attack', 0], ['release', 0.25]].forEach(function (kv) {
      if (comp[kv[0]] !== undefined && typeof comp[kv[0]].setValueAtTime === 'function') comp[kv[0]].setValueAtTime(kv[1], ctx.currentTime);
    });
    osc.connect(comp); comp.connect(ctx.destination); osc.start(0);
    var sum = function (b) { var d = b.getChannelData(0), s = 0; for (var i = 4500; i < 5000; i++) s += Math.abs(d[i]); return s; };
    var copy = function (b) { var a = new Float32Array(500); b.copyFromChannel(a, 0, 4500); var s = 0; for (var i = 0; i < 500; i++) s += Math.abs(a[i]); return s; };
    var out = {};
    var onEv = function (e) { out.ev = sum(e.renderedBuffer); out.evCopy = copy(e.renderedBuffer); out.evBuf = e.renderedBuffer; };
    if (order === 'before') { if (listener) ctx.addEventListener('complete', onEv); else ctx.oncomplete = onEv; }
    var p = ctx.startRendering();
    if (order !== 'before') { if (listener) ctx.addEventListener('complete', onEv); else ctx.oncomplete = onEv; }
    p.then(function (b) {
      out.pr = sum(b); out.same = out.evBuf === b; delete out.evBuf;
      setTimeout(function () { resolve(out); }, 0);
    });
  });
};
window.__dc = function (offset) {
  var ctx = new OfflineAudioContext(1, 44100, 44100);
  var src = ctx.createConstantSource(); src.offset.value = offset;
  src.connect(ctx.destination); src.start(0);
  return ctx.startRendering().then(function (b) { return Array.from(b.getChannelData(0)); });
};
window.__silence = function () {
  var ctx = new OfflineAudioContext(1, 4410, 44100);
  return ctx.startRendering().then(function (b) { var d = b.getChannelData(0), nz = 0; for (var i = 0; i < d.length; i++) if (d[i] !== 0) nz++; return nz; });
};
`;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>AUDIO</title><script>${LIB}
window.__guardAtHead = !!window.__filoFpGuard;
window.__head = window.__fp(true, 'after', false);
</script></head><body><p>ok</p></body></html>`;

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

async function misura(openTab, testServer) {
  const page = await testServer.openReady(openTab, PAGE);
  return page.evaluate(async () => {
    const head = await window.__head;
    const ascolto = await window.__fp(true, 'before', true);
    const dc = await window.__dc(0.001);
    const silenzio = await window.__silence();
    return { guardAtHead: window.__guardAtHead, head, ascolto, dc, silenzio };
  });
}

test('esplora: evento, promessa, ascoltatore, copyFromChannel contro Off; silenzio e rumore sottraibile', async ({ openTab, testServer }) => {
  test.setTimeout(120_000);
  const on1 = await misura(openTab, testServer);
  const on2 = await misura(openTab, testServer);
  await setFpMode(openTab, 'off');
  const off = await misura(openTab, testServer);
  const n = on1.dc.map((v) => v - 0.001);
  console.log(JSON.stringify({ on1: { ...on1, dc: undefined }, on2: { ...on2, dc: undefined }, off: { ...off, dc: undefined }, dcOffMax: Math.max(...off.dc.map((v) => Math.abs(v - 0.001))), dcOnMax: Math.max(...n.map(Math.abs)) }));
  expect(on1.guardAtHead).toBe(true);
  expect(on1.head.ev).not.toBe(off.head.ev);
  expect(on1.head.ev).toBe(on2.head.ev);
  expect(on1.head.pr).toBe(on1.head.ev);
  expect(on1.head.evCopy).toBe(on1.head.ev);
  expect(on1.ascolto.ev).toBe(on1.head.ev);
  expect(on1.ascolto.pr).toBe(on1.head.ev);
  expect(off.head.ev).toBe(off.head.pr);
});
