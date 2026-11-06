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
  function scena(doc, gc) { var c = doc.createElement('canvas'); c.width = 80; c.height = 40; var x = gc ? gc.call(c, '2d') : c.getContext('2d');
    x.fillStyle = '#1e90ff'; x.fillRect(0, 0, 80, 40); x.fillStyle = '#000'; x.font = '16px sans-serif'; x.fillText('filo', 4, 24); return c; }
  window.__l = {};
  addEventListener('message', function (e) { if (e.data && e.data.lettura) window.__l[e.data.lettura] = e.data.valore; });
`;
const interno = (chi) => `<!doctype html><meta charset="utf-8"><body><script>${IMPRONTA}
  parent.postMessage({ lettura: ${JSON.stringify(chi)}, valore: fnv(scena(document).toDataURL()) }, '*');
</script></body>`;
const PAGINA = `<!doctype html><meta charset="utf-8"><title>porte</title><script>${IMPRONTA}</script><body>
<iframe src="/figlio?html"></iframe><script>window.__html = frames[0];</script></body>`;

async function porte() {
  /* global fnv, scena */
  const attendi = (k) => new Promise((res) => { const t0 = Date.now(); const t = () => (window.__l[k] || Date.now() - t0 > 8000 ? res(window.__l[k] || 'nessuna risposta') : setTimeout(t, 25)); t(); });
  const c = scena(document);
  const leggi = (W) => { try { return fnv(W.HTMLCanvasElement.prototype.toDataURL.call(c)); } catch (e) { return 'errore ' + e.message; } };
  const out = { pagina: fnv(c.toDataURL()) };
  out.htmlDentro = await attendi('html');
  out.htmlDaQui = leggi(window.__html);
  { const f = document.createElement('iframe'); f.src = '/figlio?script'; document.body.appendChild(f); const w = window[window.length - 1]; out.scriptDentro = await attendi('script'); out.scriptDaQui = leggi(w); }
  return out;
}

async function riscritta() {
  /* global fnv, scena */
  document.open(); document.write('<!doctype html><meta charset="utf-8"><body><p>riscritta</p></body>'); document.close();
  const carico = (f) => new Promise((r) => { f.addEventListener('load', r, { once: true }); setTimeout(r, 5000); });
  const out = { pagina: fnv(scena(document).toDataURL()) };
  const f = document.createElement('iframe'); f.src = '/figlio?r'; document.body.appendChild(f); await carico(f);
  const c = scena(document, f.contentWindow.HTMLCanvasElement.prototype.getContext);
  out.contestoDelRiquadroEsportatoQui = fnv(c.toDataURL());
  return out;
}

for (const modo of ['default', 'privacy']) {
  test(`esplora ${modo}`, async ({ openTab }) => {
    test.setTimeout(120_000);
    const srv = createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(u.pathname === '/figlio' ? interno(u.search.slice(1)) : PAGINA);
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${srv.address().port}/`;
    try {
      if (modo !== 'default') await setFpMode(openTab, modo);
      const page = await openTab(url);
      await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
      const on = await page.evaluate(porte);
      await page.goto(url + '?b');
      await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
      const ris = await page.evaluate(riscritta);
      console.log('ON', modo, JSON.stringify(on), JSON.stringify(ris));
    } finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
  });
}
