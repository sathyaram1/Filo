import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

const FNV = `function fnv(s){var a=2166136261;for(var i=0;i<s.length;i++)a=Math.imul(a^s.charCodeAt(i),16777619)>>>0;return a.toString(16);}
function tela(){var c=document.createElement('canvas');c.width=80;c.height=40;var x=c.getContext('2d');x.fillStyle='#1e90ff';x.fillRect(0,0,80,40);x.fillStyle='#000';x.font='16px sans-serif';x.fillText('filo',4,24);return c;}`;

const PAGINA = `<!doctype html><meta charset="utf-8"><title>porte</title><body>
<div id="host"><template shadowrootmode="open"><iframe></iframe></template></div>
<script>${FNV}
window.statico = (function(){ try { return fnv(window[0].HTMLCanvasElement.prototype.toDataURL.call(tela())); } catch(e){ return 'err '+e.message; } })();
</script></body>`;

async function porte() {
  /* global fnv, tela */
  const c = tela();
  const leggi = (W) => { try { return fnv(W.HTMLCanvasElement.prototype.toDataURL.call(c)); } catch (e) { return 'errore ' + e.message; } };
  const ultimo = () => window[window.length - 1];
  const out = { pagina: fnv(c.toDataURL()), statico: window.statico };
  await new Promise((r) => setTimeout(r, 500));
  out.staticoDopo = leggi(window[0]);
  { const h = document.createElement('div'); const s = h.attachShadow({ mode: 'open' }); s.innerHTML = '<iframe></iframe>'; document.body.appendChild(h); out.ombraStaccata = leggi(ultimo()); await new Promise((r) => setTimeout(r, 800)); out.ombraStaccataDopo = leggi(ultimo()); }
  { const h = document.createElement('div'); const s = h.attachShadow({ mode: 'closed' }); s.appendChild(document.createElement('iframe')); document.body.append(h); out.ombraChiusaAppend = leggi(ultimo()); }
  { const h = document.createElement('div'); document.body.appendChild(h); const s = h.attachShadow({ mode: 'open' }); s.appendChild(document.createElement('iframe')); out.ombraAttaccata = leggi(ultimo()); }
  { const d = document.createElement('div'); document.body.appendChild(d); d.setHTMLUnsafe('<div><template shadowrootmode="open"><iframe></iframe></template></div>'); out.setHTMLUnsafeOmbra = leggi(ultimo()); }
  { const d = document.createElement('div'); document.body.appendChild(d); d.setHTMLUnsafe('<iframe></iframe>'); out.setHTMLUnsafePiano = leggi(ultimo()); }
  // pila degli errori
  const righe = (fn) => { try { fn(); return 'nessun errore'; } catch (e) { return String(e.stack).split('\n').length; } };
  out.pilaAppend = righe(() => document.body.appendChild(null));
  out.pilaToData = righe(() => HTMLCanvasElement.prototype.toDataURL.call({}));
  out.pilaCw = righe(() => Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow').get.call({}));
  out.toStr = Function.prototype.toString.call(HTMLCanvasElement.prototype.toDataURL);
  return out;
}

test('esplora', async ({ openTab }) => {
  test.setTimeout(90_000);
  const srv = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PAGINA); });
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
  } finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
});
