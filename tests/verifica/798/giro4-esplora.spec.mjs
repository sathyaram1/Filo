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
  parent.postMessage({ chi: ${JSON.stringify(chi)}, valore: impronta(document) }, '*');</script></body>`;
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
  const js = (h) => 'javascript:' + encodeURIComponent(JSON.stringify(h));

  { const f = document.createElement('iframe'); f.src = js(html.jsSubito); document.body.appendChild(f); await carico(f); await pausa(300); }
  { const f = document.createElement('iframe'); document.body.appendChild(f); f.src = js(html.jsDopo); await carico(f); await pausa(300); }
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
  for (const k of ['jsSubito', 'jsDopo', 'scritto', 'blob', 'ombraStessaOrigine']) out[k + ':documento'] = dalDocumento[k] || 'nessuna risposta';
  return out;
}

async function leggi(openTab, testServer) {
  const urlInterno = testServer.html(interno('x'));
  const page = await openTab(testServer.html(PAGINA));
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
  const html = { jsSubito: interno('jsSubito'), jsDopo: interno('jsDopo'), scritto: interno('scritto'), blob: interno('blob') };
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
  for (const k of Object.keys(on)) {
    if (k === 'pagina') continue;
    expect.soft(off[k], `${k}: con Off la lettura riesce`).toBe(off.pagina);
    expect.soft(on[k], `${k}: col rumore della pagina`).toBe(on.pagina);
  }
});
