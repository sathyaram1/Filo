// Verifica #798 giro 4, esplorazione: porte nuove verso una finestra della pagina senza rumore.
import { test, expect } from '../../fixtures/electron.mjs';

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

const IMPRONTA = `
  function fnv(s) { var a = 2166136261; for (var i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; return a.toString(16); }
  function impronta(doc) {
    var c = doc.createElement('canvas'); c.width = 80; c.height = 40;
    var x = c.getContext('2d'); x.fillStyle = '#1e90ff'; x.fillRect(0, 0, 80, 40);
    x.fillStyle = '#000'; x.font = '16px sans-serif'; x.fillText('filo', 4, 24);
    return fnv(c.toDataURL());
  }`;
const interno = (chi) => `<!doctype html><meta charset="utf-8"><body><script>${IMPRONTA}
  parent.postMessage({ chi: ${chi ? JSON.stringify(chi) : 'location.hash.slice(1)'}, valore: impronta(document) }, '*');</script></body>`;
const PAGINA = `<!doctype html><meta charset="utf-8"><body><script>${IMPRONTA}</script></body>`;

async function letture({ urlInterno, html }) {
  /* global impronta */
  const dalDocumento = {};
  window.addEventListener('message', (e) => { if (e.data && e.data.chi) dalDocumento[e.data.chi] = e.data.valore; });
  const carico = (f) => new Promise((r) => { f.addEventListener('load', r, { once: true }); setTimeout(r, 4000); });
  const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
  const c = document.createElement('canvas'); c.width = 80; c.height = 40;
  const x = c.getContext('2d'); x.fillStyle = '#1e90ff'; x.fillRect(0, 0, 80, 40); x.fillStyle = '#000'; x.font = '16px sans-serif'; x.fillText('filo', 4, 24);
  const fnv = (s) => { let a = 2166136261; for (let i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; return a.toString(16); };
  const conLe = (W) => { try { return fnv(W.HTMLCanvasElement.prototype.toDataURL.call(c)); } catch (e) { return 'errore ' + e.message; } };
  const out = { pagina: fnv(c.toDataURL()) };
  try {
    const vf = new VideoFrame(c, { timestamp: 0 }); const buf = new Uint8Array(vf.allocationSize()); await vf.copyTo(buf); vf.close();
    let s2 = ''; for (let i = 0; i < buf.length; i++) s2 += String.fromCharCode(buf[i]); out.videoFrame = fnv(s2);
    const ib = await createImageBitmap(c); const c2 = document.createElement('canvas'); c2.width = 80; c2.height = 40; const x2 = c2.getContext('bitmaprenderer'); x2.transferFromImageBitmap(ib); out.bitmapRenderer = fnv(c2.toDataURL());
  } catch (e) { out.videoFrame = 'errore ' + e.message; }
  const js = (h) => 'javascript:' + encodeURIComponent(JSON.stringify(h));

  { const f = document.createElement('iframe'); f.src = js(html.jsSubito); document.body.appendChild(f); await carico(f); await pausa(300); }
  { const f = document.createElement('iframe'); document.body.appendChild(f); f.src = js(html.jsDopo); await carico(f); await pausa(300); }
  {
    const f = document.createElement('iframe'); document.body.appendChild(f); const i = window.length - 1;
    const prima = window[i].document; let visto = 0;
    f.src = 'about:blank';
    out.corsaVuoto = await new Promise((r) => { const t = () => { visto++; const W = window[i]; if (W.document !== prima) r(conLe(W) + (visto ? '' : '')); else if (visto > 2000) r('mai'); else setTimeout(t, 0); }; t(); });
    const n = document.createElement('iframe'); n.src = urlInterno + '#corsa'; document.body.appendChild(n); const j = window.length - 1;
    await carico(n); const prima2 = window[j].document; n.src = 'about:blank';
    out.corsaVuotoDaPagina = await new Promise((r) => { let k = 0; const t = () => { k++; let W = window[j], d = null; try { d = W.document; } catch (e) {} if (d && d !== prima2 && W.location.href === 'about:blank') r(conLe(W)); else if (k > 4000) r('mai'); else setTimeout(t, 0); }; t(); });
  }
  { const f = document.createElement('iframe'); document.body.appendChild(f); const i = window.length - 1; f.src = js('<p>vuoto</p>'); await carico(f); await pausa(300); out.jsDopoIndice = conLe(window[i]); out.jsDopoElemento = conLe(f.contentWindow); }
  { const f = document.createElement('iframe'); document.body.appendChild(f); f.contentWindow.location.href = js(html.jsLocation); await carico(f); await pausa(300); }
  { const f = document.createElement('iframe'); document.body.appendChild(f); f.setAttribute('src', js(html.jsAttr)); await carico(f); await pausa(300); }
  { document.body.insertAdjacentHTML('beforeend', '<iframe id="jsm"></iframe>'); const f = document.getElementById('jsm'); await pausa(50); f.src = js(html.jsMarkup); await carico(f); await pausa(300); }
  { const f = document.createElement('iframe'); document.body.appendChild(f); const d = f.contentDocument; d.open(); d.write(html.scritto); d.close(); await pausa(300); }
  { const b = URL.createObjectURL(new Blob([html.blob], { type: 'text/html' })); const f = document.createElement('iframe'); f.src = b; document.body.appendChild(f); await carico(f); await pausa(300); }
  {
    const host = document.createElement('div'); const sr = host.attachShadow({ mode: 'open' });
    sr.appendChild(document.createElement('iframe')); document.body.appendChild(host);
    out.ombraIndice = conLe(window[window.length - 1]);
  }
  {
    const host = document.createElement('div'); const sr = host.attachShadow({ mode: 'open' });
    const f = document.createElement('iframe'); f.src = urlInterno + '#ombraStessaOrigine'; sr.appendChild(f); document.body.appendChild(host);
    const i = window.length - 1;
    await carico(f); await pausa(300);
    out.ombraStessaOrigineDaQui = conLe(window[i]);
  }
  {
    const a = document.createElement('iframe'); document.body.appendChild(a);
    const A = a.contentWindow; const b = A.document.createElement('iframe'); A.document.body.appendChild(b);
    out.annidatoIndice = conLe(A[0]);
  }
  {
    const blocca = (e) => { if (e.target && e.target.tagName === 'IFRAME') e.stopImmediatePropagation(); };
    window.addEventListener('load', blocca, true);
    const n = document.createElement('iframe'); n.src = urlInterno + '#bloccato'; document.body.appendChild(n);
    const j = window.length - 1;
    await carico(n); n.src = 'about:blank'; await carico(n); await pausa(300);
    out.tornatoVuotoLoadFermato = conLe(window[j]);
    window.removeEventListener('load', blocca, true);
  }
  for (const k of ['jsSubito', 'jsDopo', 'jsLocation', 'jsAttr', 'jsMarkup', 'scritto', 'blob', 'ombraStessaOrigine']) out[k + ':documento'] = dalDocumento[k] || 'nessuna risposta';
  return out;
}

async function leggi(openTab, testServer) {
  const urlInterno = testServer.html(interno(null));
  const page = await openTab(testServer.html(PAGINA));
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
  const html = { jsSubito: interno('jsSubito'), jsDopo: interno('jsDopo'), jsLocation: interno('jsLocation'), jsAttr: interno('jsAttr'), jsMarkup: interno('jsMarkup'), scritto: interno('scritto'), blob: interno('blob') };
  return page.evaluate(letture, { urlInterno: urlInterno.replace(/#.*/, ''), html });
}

test('esplora: porte nuove', async ({ openTab, testServer }) => {
  test.setTimeout(150_000);
  const on = await leggi(openTab, testServer);
  await setFpMode(openTab, 'off');
  const off = await leggi(openTab, testServer);
  console.log('ON', JSON.stringify(on, null, 1));
  console.log('OFF', JSON.stringify(off, null, 1));
  expect(on.pagina).not.toBe(off.pagina);
  expect.soft(on.videoFrame, 'videoFrame diverso da Off').not.toBe(off.videoFrame);
  for (const k of Object.keys(on)) {
    if (k === 'pagina' || k === 'videoFrame') continue;
    expect.soft(off[k], `${k}: con Off la lettura riesce`).toBe(off.pagina);
    expect.soft(on[k], `${k}: col rumore della pagina`).toBe(on.pagina);
  }
});
