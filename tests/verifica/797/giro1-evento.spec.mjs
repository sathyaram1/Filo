// #797 giro 1 — la lamentela: l'impronta audio letta nel gestore complete esce col rumore, contro Off.

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

async function misura(page) {
  return page.evaluate(async () => {
    const head = await window.__head;
    const ascolto = await window.__fp(true, 'before', true);
    return { guardAtHead: window.__guardAtHead, head, ascolto };
  });
}

test('evento, promessa, ascoltatore e copyFromChannel: col rumore, uguali fra loro e fra due caricamenti', async ({ openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, PAGE);
  const ricarica = async () => { await page.reload(); await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1'); };
  const on1 = await misura(page);
  await ricarica();
  const on2 = await misura(page);
  await setFpMode(openTab, 'off');
  await ricarica();
  const off = await misura(page);
  expect(on1.guardAtHead).toBe(true);
  expect(on1.head.ev).not.toBe(off.head.ev);
  expect(on1.head.ev).toBe(on2.head.ev);
  expect(on1.head.pr).toBe(on1.head.ev);
  expect(on1.head.evCopy).toBe(on1.head.ev);
  expect(on1.ascolto.ev).toBe(on1.head.ev);
  expect(on1.ascolto.pr).toBe(on1.head.ev);
  expect(off.head.ev).toBe(off.head.pr);
  expect(off.guardAtHead).toBe(false);
});


test('getter mascherato, evento sintetico intatto, letture tardive, rendering in parallelo', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);
  const r = await page.evaluate(async () => {
    const d = Object.getOwnPropertyDescriptor(OfflineAudioCompletionEvent.prototype, 'renderedBuffer');
    const out = {
      str: Function.prototype.toString.call(d.get), name: d.get.name, proto: 'prototype' in d.get,
      own: Object.getOwnPropertyNames(d.get).sort().join(','), len: d.get.length, set: typeof d.set,
      enumer: d.enumerable,
    };
    try { d.get.call({}); out.illegal = 'no-throw'; } catch (e) { out.illegal = e.constructor.name + ':' + e.message; }
    const b = new AudioBuffer({ length: 10, sampleRate: 44100 });
    b.getChannelData(0).fill(0.25);
    const ev = new OfflineAudioCompletionEvent('complete', { renderedBuffer: b });
    out.sintetico = Array.from(ev.renderedBuffer.getChannelData(0)).every((v) => v === 0.25);
    // Letture tardive dello stesso evento dopo la promessa, e due rendering insieme.
    const [a1, a2] = await Promise.all([window.__fp(true, 'after', false), window.__fp(true, 'after', true)]);
    out.paralleli = a1.ev === a2.ev && a1.pr === a2.pr && a1.ev === a1.pr;
    const ctx = new OfflineAudioContext(1, 4410, 44100);
    const o = ctx.createOscillator(); o.connect(ctx.destination); o.start(0);
    let saved;
    ctx.oncomplete = (e) => { saved = e; };
    const buf = await ctx.startRendering();
    const s1 = buf.getChannelData(0)[100];
    await new Promise((r) => setTimeout(r, 50));
    const s2 = saved.renderedBuffer.getChannelData(0)[100];
    out.tardiva = s1 === s2;
    try { await ctx.startRendering(); out.doppio = 'ok'; } catch (e) { out.doppio = e.name; }
    return out;
  });
  expect(r).toMatchObject({ str: 'function get renderedBuffer() { [native code] }', name: 'get renderedBuffer', proto: false,
    own: 'length,name', len: 0, illegal: 'TypeError:Illegal invocation', sintetico: true, paralleli: true, tardiva: true,
    doppio: 'InvalidStateError' });
});
