// #797 giro 2 — esplorazione: massima privacy, riquadro vuoto creato dalla pagina.

import { test, expect } from '../../fixtures/electron.mjs';

const LIB = `
window.__fp = function (W) {
  W = W || window;
  return new Promise(function (resolve) {
    var ctx = new W.OfflineAudioContext(1, 44100, 44100);
    var osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(10000, ctx.currentTime);
    var comp = ctx.createDynamicsCompressor();
    osc.connect(comp); comp.connect(ctx.destination); osc.start(0);
    var sum = function (b) { var d = b.getChannelData(0), s = 0; for (var i = 4500; i < 5000; i++) s += Math.abs(d[i]); return s; };
    var out = {};
    ctx.oncomplete = function (e) { out.ev = sum(e.renderedBuffer); };
    ctx.startRendering().then(function (b) { out.pr = sum(b); setTimeout(function () { resolve(out); }, 0); });
  });
};
window.__iframe = function () {
  var f = document.createElement('iframe'); document.body.appendChild(f);
  return window.__fp(f.contentWindow);
};
window.__getterRubato = function () {
  var f = document.createElement('iframe'); document.body.appendChild(f);
  var g = Object.getOwnPropertyDescriptor(f.contentWindow.OfflineAudioCompletionEvent.prototype, 'renderedBuffer').get;
  return new Promise(function (resolve) {
    var ctx = new OfflineAudioContext(1, 44100, 44100);
    var osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.setValueAtTime(10000, 0);
    var comp = ctx.createDynamicsCompressor(); osc.connect(comp); comp.connect(ctx.destination); osc.start(0);
    ctx.oncomplete = function (e) {
      try { var b = g.call(e); var d = b.getChannelData(0), s = 0; for (var i = 4500; i < 5000; i++) s += Math.abs(d[i]); resolve(s); }
      catch (err) { resolve('err:' + err.message); }
    };
    ctx.startRendering();
  });
};
`;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>AUDIO</title><script>${LIB}</script></head><body><p>ok</p></body></html>`;

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

test('esplora', async ({ openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, PAGE);
  const ricarica = async () => { await page.reload(); await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1'); };
  const mis = () => page.evaluate(async () => ({ main: await window.__fp(), iframe: await window.__iframe(), rubato: await window.__getterRubato() }));
  const def = await mis();
  await setFpMode(openTab, 'privacy');
  await ricarica();
  const priv = await mis();
  await setFpMode(openTab, 'off');
  await ricarica();
  const off = await mis();
  console.log(JSON.stringify({ def, priv, off }, null, 1));
});
