// Verifica #798 giro 9: esplorazione 2 (radici ombra, tempi).
import { test, expect } from '../../fixtures/electron.mjs';

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

const IMPRONTA = `
  function fnv(s) { var a = 2166136261; for (var i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; return a.toString(16); }
  function scena(doc) { var c = doc.createElement('canvas'); c.width = 80; c.height = 40; var x = c.getContext('2d');
    x.fillStyle = '#1e90ff'; x.fillRect(0, 0, 80, 40); x.fillStyle = '#000'; x.font = '16px sans-serif'; x.fillText('filo', 4, 24); return { c: c, x: x }; }
  var C0 = null;
  function leggi(W) { try { C0 = C0 || scena(document).c; return fnv(W.HTMLCanvasElement.prototype.toDataURL.call(C0)); } catch (e) { return 'errore ' + e.message; } }
  window.__o = {};
`;

async function prove(urls) {
  const out = { ...window.__o };
  const { c } = scena(document);
  out.pagina = fnv(c.toDataURL());
  const ultimo = () => window[window.length - 1];
  // setHTMLUnsafe con radice ombra dichiarativa
  { const d = document.createElement('div'); document.body.appendChild(d); d.setHTMLUnsafe('<div><template shadowrootmode="open"><iframe></iframe></template></div>'); out.setHTMLUnsafeOmbra = leggi(ultimo()); await new Promise((r) => setTimeout(r, 500)); out.setHTMLUnsafeOmbraDopo = leggi(ultimo()); }
  // parseHTMLUnsafe + append
  { const doc = Document.parseHTMLUnsafe('<div id=h><template shadowrootmode="open"><iframe></iframe></template></div>'); const h = doc.getElementById('h'); document.body.append(document.adoptNode(h)); out.parseHTMLUnsafeOmbra = leggi(ultimo()); await new Promise((r) => setTimeout(r, 500)); out.parseHTMLUnsafeOmbraDopo = leggi(ultimo()); }
  // radice ombra: riquadro dello stesso sito rimandato a vuoto
  { const h = document.createElement('div'); document.body.appendChild(h); const sr = h.attachShadow({ mode: 'closed' }); const f = document.createElement('iframe'); f.src = urls.stesso; sr.appendChild(f);
    await new Promise((r) => f.addEventListener('load', r, { once: true })); await new Promise((r) => setTimeout(r, 200));
    const idx = window.length - 1; out.ombraCarico = leggi(window[idx]);
    f.src = 'about:blank'; await new Promise((r) => f.addEventListener('load', r, { once: true })); await new Promise((r) => setTimeout(r, 300));
    out.ombraTornatoVuoto = leggi(window[idx]); }
  // fuori ombra, stesso caso, come controllo
  { const f = document.createElement('iframe'); f.src = urls.stesso2; document.body.appendChild(f);
    await new Promise((r) => f.addEventListener('load', r, { once: true })); await new Promise((r) => setTimeout(r, 200));
    const idx = window.length - 1;
    f.src = 'about:blank'; await new Promise((r) => f.addEventListener('load', r, { once: true })); await new Promise((r) => setTimeout(r, 300));
    out.fuoriTornatoVuoto = leggi(window[idx]); }
  { const t0 = performance.now(); const root = document.createElement('div'); for (let i = 0; i < 100000; i++) root.appendChild(document.createElement('i')); out.msFoglie = Math.round(performance.now() - t0); }
  { const t0 = performance.now(); const root = document.createElement('div'); document.body.appendChild(root); for (let i = 0; i < 20000; i++) { const li = document.createElement('li'); li.appendChild(document.createElement('a')); li.appendChild(document.createElement('b')); root.appendChild(li); } root.remove(); out.msConFigli = Math.round(performance.now() - t0); }
  { const t0 = performance.now(); const root = document.createElement('div'); document.body.appendChild(root); for (let i = 0; i < 20000; i++) { const li = document.createElement('li'); li.append('testo', document.createElement('b')); root.append(li); } root.remove(); out.msAppend = Math.round(performance.now() - t0); }
  // tempi: costruzione di un albero grande
  { const t0 = performance.now(); for (let k = 0; k < 20; k++) { const root = document.createElement('div'); let cur = root; for (let i = 0; i < 2000; i++) { const n = document.createElement('div'); n.appendChild(document.createElement('span')); cur.appendChild(n); if (i % 50 === 0) cur = n; } document.body.appendChild(root); root.remove(); } out.msAlbero = Math.round(performance.now() - t0); }
  { const t0 = performance.now(); for (let k = 0; k < 300; k++) { const d = document.createElement('div'); d.innerHTML = '<ul>' + '<li><a href="#">x</a><object></object></li>'.repeat(50) + '</ul>'; document.body.appendChild(d); d.remove(); } out.msInnerHTML = Math.round(performance.now() - t0); }
  return out;
}

const HTML = (u) => `<!doctype html><html><head><meta charset="utf-8"><script>${IMPRONTA}</script></head><body>
<div id="dsd"><template shadowrootmode="open"><iframe></iframe></template></div>
<script>window.__o.parserOmbra = leggi(window[window.length - 1]);</script>
</body></html>`;

test('esplora 2', async ({ openTab, testServer }) => {
  test.setTimeout(120_000);
  const urls = { stesso: testServer.html('<p>stesso</p>'), stesso2: testServer.html('<p>stesso2</p>') };
  const pagina = testServer.html(HTML());
  const page = await openTab(pagina);
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
  const on = await page.evaluate(prove, urls);
  await setFpMode(openTab, 'off');
  await page.goto(pagina + '?off');
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
  const off = await page.evaluate(prove, urls);
  console.log('ON', JSON.stringify(on, null, 1));
  console.log('OFF', JSON.stringify(off, null, 1));
});
