// Verifica #798 giro 11: porte nuove per i riquadri della pagina (ombra, open per nome, documento sostituito).
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
  function scena(doc, gc) { var c = doc.createElement('canvas'); c.width = 80; c.height = 40; var x = gc ? gc.call(c, '2d') : c.getContext('2d');
    x.fillStyle = '#1e90ff'; x.fillRect(0, 0, 80, 40); x.fillStyle = '#000'; x.font = '16px sans-serif'; x.fillText('filo', 4, 24); return c; }
`;
const PAGINA = `<!doctype html><meta charset="utf-8"><title>giro11</title><script>${IMPRONTA}
  window.__l = {}; addEventListener('message', function (e) { if (e.data && e.data.lettura) window.__l[e.data.lettura] = e.data.valore; });
</script><body><p>ok</p></body>`;
const FIGLIO = `<!doctype html><meta charset="utf-8"><body><script>${IMPRONTA}
  top.postMessage({ lettura: new URLSearchParams(location.search).get('k'), valore: fnv(scena(document).toDataURL()) }, '*');
</script><p>figlio</p></body>`;

async function porte() {
  /* global fnv, scena */
  const out = {};
  const c = scena(document);
  out.pagina = fnv(c.toDataURL());
  const leggi = (W) => { try { return fnv(W.HTMLCanvasElement.prototype.toDataURL.call(c)); } catch (e) { return 'errore ' + e.message; } };
  const ultimo = () => window[window.length - 1];
  const pausa = (ms = 300) => new Promise((r) => setTimeout(r, ms));
  const attendi = (k) => new Promise((res) => { const t0 = Date.now(); const t = () => (window.__l[k] || Date.now() - t0 > 6000 ? res(window.__l[k] || 'nessuna risposta') : setTimeout(t, 25)); t(); });
  const ombra = (mode = 'open') => { const d = document.createElement('div'); document.body.appendChild(d); return d.attachShadow({ mode }); };
  const prova = async (k, fn) => { try { out[k] = await fn(); } catch (e) { out[k] = 'eccezione ' + e.message; } };

  await prova('ombraInner', () => { const sr = ombra(); sr.innerHTML = '<iframe></iframe>'; return leggi(ultimo()); });
  await prova('ombraAppend', () => { const sr = ombra(); sr.appendChild(document.createElement('iframe')); return leggi(ultimo()); });
  await prova('ombraChiusa', () => { const sr = ombra('closed'); sr.innerHTML = '<iframe></iframe>'; return leggi(ultimo()); });
  await prova('ombraDichiarata', () => { const d = document.createElement('div'); document.body.appendChild(d);
    d.setHTMLUnsafe('<template shadowrootmode="open"><iframe></iframe></template>'); return leggi(ultimo()); });
  await prova('ombraDopo', async () => { const sr = ombra(); sr.innerHTML = '<iframe></iframe>'; await pausa(); return leggi(ultimo()); });
  await prova('ombraSrcDaQui', async () => { const sr = ombra(); sr.innerHTML = '<iframe src="/figlio?k=ombra"></iframe>'; const w = ultimo();
    out.ombraDentro = await attendi('ombra'); await pausa(); return leggi(w); });
  await prova('ombraSrcElemento', async () => { await pausa(); const sr = ombra(); sr.innerHTML = '<iframe src="/figlio?k=ombra2"></iframe>';
    out.ombraDentro2 = await attendi('ombra2'); await pausa(); return leggi(sr.querySelector('iframe').contentWindow); });
  await prova('openDaQui', async () => { const f = document.createElement('iframe'); f.name = 'perOpen'; f.src = '/figlio?k=open'; document.body.appendChild(f);
    const w = open('', 'perOpen'); out.openDentro = await attendi('open'); await pausa(); return leggi(w); });
  await prova('openVuoto', () => { const f = document.createElement('iframe'); f.name = 'perOpenVuoto'; document.body.appendChild(f); return leggi(open('', 'perOpenVuoto')); });
  await prova('adottato', () => { const d = document.implementation.createHTMLDocument(''); d.body.innerHTML = '<iframe></iframe>';
    document.body.append(d.body.firstChild); return leggi(ultimo()); });
  await prova('nipote', () => { const a = document.createElement('iframe'); document.body.appendChild(a);
    const b = a.contentDocument.createElement('iframe'); a.contentDocument.body.appendChild(b); return leggi(a.contentWindow[0]); });
  await prova('nipoteOmbra', () => { const a = document.createElement('iframe'); document.body.appendChild(a);
    const d = a.contentDocument.createElement('div'); a.contentDocument.body.appendChild(d); d.attachShadow({ mode: 'open' }).innerHTML = '<iframe></iframe>';
    return leggi(a.contentWindow[0]); });
  await prova('outerHTML', () => { const d = document.createElement('div'); document.body.appendChild(d); d.outerHTML = '<iframe></iframe>'; return leggi(ultimo()); });
  return out;
}

async function sostituito(come) {
  const out = {};
  const pausa = (ms = 300) => new Promise((r) => setTimeout(r, ms));
  const carico = (f) => new Promise((r) => { f.addEventListener('load', r, { once: true }); setTimeout(r, 5000); });
  if (come === 'html') {
    const h = document.createElement('html'); h.appendChild(document.createElement('head')); h.appendChild(document.createElement('body'));
    document.replaceChild(h, document.documentElement);
  } else if (come === 'body') {
    document.documentElement.replaceChild(document.createElement('body'), document.body);
  } else if (come === 'staccato') {
    const h = document.documentElement; document.removeChild(h); document.appendChild(h);
  }
  const c = scena(document);
  out.pagina = fnv(c.toDataURL());
  const leggi = (W) => { try { return fnv(W.HTMLCanvasElement.prototype.toDataURL.call(c)); } catch (e) { return 'errore ' + e.message; } };
  { const f = document.createElement('iframe'); f.src = '/figlio?k=s1'; document.body.appendChild(f); await carico(f); await pausa(); out.elemento = leggi(f.contentWindow); }
  { const f = document.createElement('iframe'); f.src = '/figlio?k=s2'; document.body.appendChild(f); const w = window[window.length - 1]; await carico(f); await pausa(); out.indice = leggi(w); }
  { const f = document.createElement('iframe'); document.body.appendChild(f); out.vuoto = leggi(window[window.length - 1]); }
  return out;
}

function server() {
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(req.url.startsWith('/figlio') ? FIGLIO : PAGINA);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

async function apri(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
}

for (const modo of ['default', 'privacy']) {
  test(`esplora porte (${modo})`, async ({ openTab }) => {
    test.setTimeout(240_000);
    const srv = await server();
    const url = `http://127.0.0.1:${srv.address().port}/`;
    try {
      if (modo !== 'default') await setFpMode(openTab, modo);
      const page = await openTab(url);
      await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
      const on = await page.evaluate(porte);
      const sost = {};
      for (const come of ['html', 'body', 'staccato']) { await apri(page, url + '?' + come); sost[come] = await page.evaluate(sostituito, come); }
      await setFpMode(openTab, 'off');
      await apri(page, url + '?off');
      const off = await page.evaluate(porte);
      console.log(modo, JSON.stringify({ on, off, sost }, null, 1));
      expect(on.pagina).not.toBe(off.pagina);
      for (const k of Object.keys(on)) {
        if (k === 'pagina' || (/Dentro/.test(k) && modo === 'default')) continue;
        expect.soft(on[k], `${k}`).toBe(on.pagina);
      }
      for (const come of Object.keys(sost)) for (const k of ['elemento', 'indice', 'vuoto']) expect.soft(sost[come][k], `${come}.${k}`).toBe(sost[come].pagina);
    } finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
  });
}
