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

const PAGINA = `<!doctype html><meta charset="utf-8"><title>porte</title><body><p>ok</p><script>${FNV}</script></body>`;
const FIGLIO = '<!doctype html><meta charset="utf-8"><p>figlio</p>';

async function porte() {
  /* global fnv, tela */
  const c = tela();
  const leggi = (W) => { try { return fnv(W.HTMLCanvasElement.prototype.toDataURL.call(c)); } catch (e) { return 'errore ' + e.message; } };
  const ultimo = () => window[window.length - 1];
  const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { pagina: fnv(c.toDataURL()) };
  { const f = document.createElement('iframe'); document.body.appendChild(f); out.controllo = leggi(ultimo()); }
  { const b = document.createElement('body'); b.innerHTML = '<p>ok</p>'; const f = document.createElement('iframe'); b.appendChild(f); const vecchio = document.body; document.body = b; out.bodySetter = leggi(ultimo()); document.body = vecchio; }
  { const t = document.createElement('table'); document.body.appendChild(t); const cap = document.createElement('caption'); cap.appendChild(document.createElement('iframe')); t.caption = cap; out.tableCaption = leggi(ultimo()); }
  { const t = document.createElement('table'); document.body.appendChild(t); const th = document.createElement('thead'); th.appendChild(document.createElement('iframe')); t.tHead = th; out.tableTHead = leggi(ultimo()); }
  { const s = document.createElement('select'); document.body.appendChild(s); const o = document.createElement('option'); o.appendChild(document.createElement('iframe')); s.add(o); out.selectAdd = leggi(ultimo()); }
  { const s = document.createElement('select'); document.body.appendChild(s); const o = document.createElement('option'); o.appendChild(document.createElement('iframe')); s.options[0] = o; out.optionsSetter = leggi(ultimo()); }
  // Durante l'inserimento: una reazione di elemento personalizzato e il load sincrono del riquadro vuoto.
  {
    let r = 'non chiamato';
    customElements.define('x-legge', class extends HTMLElement { connectedCallback() { r = leggi(ultimo()); } });
    const fr = document.createDocumentFragment(); fr.appendChild(document.createElement('iframe')); fr.appendChild(document.createElement('x-legge'));
    document.body.appendChild(fr); out.connectedCallback = r;
  }
  {
    let r = 'nessun load';
    const h = (e) => { if (e.target && e.target.tagName === 'IFRAME') r = leggi(ultimo()); };
    window.addEventListener('load', h, true);
    document.body.appendChild(document.createElement('iframe'));
    window.removeEventListener('load', h, true);
    out.loadSincronoCatturaFinestra = r;
  }
  // Riquadro della stessa origine riportato a vuoto, col load fermato prima del documento.
  {
    const f = document.createElement('iframe'); f.src = '/figlio'; document.body.appendChild(f);
    await new Promise((r) => f.addEventListener('load', r, { once: true }));
    const idx = window.length - 1;
    const ferma = (e) => { if (e.target === f) e.stopPropagation(); };
    window.addEventListener('load', ferma, true);
    f.src = 'about:blank';
    await pausa(800);
    out.tornatoVuotoLoadFermato = leggi(window[idx]);
    window.removeEventListener('load', ferma, true);
  }
  {
    const f = document.createElement('iframe'); f.src = '/figlio'; document.body.appendChild(f);
    await new Promise((r) => f.addEventListener('load', r, { once: true }));
    const idx = window.length - 1;
    f.src = 'about:blank';
    await pausa(800);
    out.tornatoVuotoNormale = leggi(window[idx]);
  }
  out.setHTML = typeof Element.prototype.setHTML;
  return out;
}

test('esplora', async ({ openTab }) => {
  test.setTimeout(90_000);
  const srv = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(req.url.startsWith('/figlio') ? FIGLIO : PAGINA); });
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
