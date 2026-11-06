// Verifica #798 giro 10: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

const IMPRONTA = `
  function fnv(s) { var a = 2166136261; for (var i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; return a.toString(16); }
  function scena(doc) { var c = doc.createElement('canvas'); c.width = 80; c.height = 40; var x = c.getContext('2d');
    x.fillStyle = '#1e90ff'; x.fillRect(0, 0, 80, 40); x.fillStyle = '#000'; x.font = '16px sans-serif'; x.fillText('filo', 4, 24); return c; }
`;
const PAGINA = `<!doctype html><meta charset="utf-8"><title>porte</title><script>${IMPRONTA}</script><body>
<div id="dsd"><template shadowrootmode="closed"><iframe></iframe></template></div>
<script>window.__dsdParser = window[window.length - 1];</script>
<button id="pip">pip</button></body>`;
const FIGLIO = `<!doctype html><meta charset="utf-8"><body><p>figlio</p></body>`;

async function porte() {
  /* global fnv, scena */
  const c = scena(document);
  const leggi = (W) => { try { return fnv(W.HTMLCanvasElement.prototype.toDataURL.call(c)); } catch (e) { return 'errore ' + e.message; } };
  const ultimo = () => window[window.length - 1];
  const carico = (f) => new Promise((r) => { f.addEventListener('load', r, { once: true }); setTimeout(r, 5000); });
  const out = { pagina: fnv(c.toDataURL()) };
  out.dsdParser = leggi(window.__dsdParser);
  { const t = document.createElement('table'); document.body.appendChild(t); const cap = document.createElement('caption'); cap.appendChild(document.createElement('iframe')); t.caption = cap; out.caption = leggi(ultimo()); }
  { const t = document.createElement('table'); document.body.appendChild(t); const h = document.createElement('thead'); h.appendChild(document.createElement('tr')).appendChild(document.createElement('td')).appendChild(document.createElement('iframe')); t.tHead = h; out.tHead = leggi(ultimo()); }
  { const s = document.createElement('select'); document.body.appendChild(s); const o = document.createElement('option'); o.appendChild(document.createElement('iframe')); s.add(o); out.selectAdd = leggi(ultimo()); }
  { const s = document.createElement('select'); document.body.appendChild(s); const o = document.createElement('option'); o.appendChild(document.createElement('iframe')); s.options[0] = o; out.optionsIndice = leggi(ultimo()); }
  { const h = document.createElement('div'); const sr = h.attachShadow({ mode: 'closed' }); sr.appendChild(document.createElement('iframe')); document.body.appendChild(h); out.ombraPrimaDiEntrare = leggi(ultimo()); }
  { const d = document.createElement('div'); document.body.appendChild(d); d.setHTMLUnsafe('<div><template shadowrootmode="closed"><iframe></iframe></template></div>'); out.dsdScript = leggi(ultimo()); }
  // Ombra, riquadro della stessa origine preso per indice prima del carico: letto dopo il carico.
  { const h = document.createElement('div'); document.body.appendChild(h); const sr = h.attachShadow({ mode: 'closed' }); const f = document.createElement('iframe'); f.src = '/figlio'; sr.appendChild(f); const w = ultimo(); await carico(f); await new Promise((r) => setTimeout(r, 300)); out.ombraStessaOrigineDopoCarico = leggi(w); }
  // Ombra, riquadro vuoto che riceve un indirizzo javascript: (letto da fuori dopo il carico).
  { const h = document.createElement('div'); document.body.appendChild(h); const sr = h.attachShadow({ mode: 'closed' }); const f = document.createElement('iframe'); sr.appendChild(f); f.src = 'javascript:"<p>js</p>"'; await carico(f); await new Promise((r) => setTimeout(r, 300)); out.ombraJavascript = leggi(f.contentWindow); out.ombraJavascriptIndice = leggi(ultimo()); }
  // Ombra, riquadro della stessa origine riportato a vuoto.
  { const h = document.createElement('div'); document.body.appendChild(h); const sr = h.attachShadow({ mode: 'closed' }); const f = document.createElement('iframe'); f.src = '/figlio'; sr.appendChild(f); await carico(f); f.src = 'about:blank'; await carico(f); await new Promise((r) => setTimeout(r, 300)); out.ombraTornatoVuotoIndice = leggi(ultimo()); out.ombraTornatoVuotoElemento = leggi(f.contentWindow); }
  out.dsdParserDopo = leggi(window.__dsdParser);
  out.pip = 'documentPictureInPicture' in window;
  return out;
}

test('esplora', async ({ openTab }) => {
  test.setTimeout(120_000);
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(req.url.startsWith('/figlio') ? FIGLIO : PAGINA);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/`;
  try {
    const page = await openTab(url);
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
    const on = await page.evaluate(porte);
    await setFpMode(openTab, 'off');
    await page.goto(url + '?off');
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
    const off = await page.evaluate(porte);
    console.log('ON', JSON.stringify(on, null, 1));
    console.log('OFF', JSON.stringify(off, null, 1));
    expect(on.pagina).not.toBe(off.pagina);
  } finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
});
