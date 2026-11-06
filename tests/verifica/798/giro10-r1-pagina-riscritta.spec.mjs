// Verifica #798 giro 10. r1: una pagina (o un suo riquadro vuoto) che si riscrive da capo con document.open toglie
// alla protezione gli ascolti con cui riconosce i riquadri della stessa origine: le funzioni di quei riquadri leggono
// il canvas della pagina senza rumore, come con Off.
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
const PAGINA = `<!doctype html><meta charset="utf-8"><title>riscritta</title><script>${IMPRONTA}</script><body><p>ok</p></body>`;
const FIGLIO = '<!doctype html><meta charset="utf-8"><body><p>figlio</p></body>';

async function porte(daCapo) {
  /* global fnv, scena */
  const carico = (f) => new Promise((r) => { f.addEventListener('load', r, { once: true }); setTimeout(r, 5000); });
  const pausa = () => new Promise((r) => setTimeout(r, 300));
  let doc = document;
  if (daCapo === 'pagina') {
    document.open(); document.write('<!doctype html><meta charset="utf-8"><body><p>riscritta</p></body>'); document.close();
  } else if (daCapo === 'riquadro') {
    // La pagina resta com'è: si riscrive solo un suo riquadro vuoto, e i riquadri nascono lì dentro.
    const a = document.createElement('iframe'); document.body.appendChild(a);
    doc = a.contentDocument; doc.open(); doc.write('<!doctype html><body></body>'); doc.close();
  }
  const c = scena(document);
  const leggi = (W) => { try { return fnv(W.HTMLCanvasElement.prototype.toDataURL.call(c)); } catch (e) { return 'errore ' + e.message; } };
  const out = { pagina: fnv(c.toDataURL()) };
  const vista = doc.defaultView;
  { const f = doc.createElement('iframe'); f.src = location.origin + '/figlio?1'; doc.body.appendChild(f); await carico(f); await pausa(); out.stessaOrigine = leggi(f.contentWindow); }
  { const f = doc.createElement('iframe'); f.src = location.origin + '/figlio?2'; doc.body.appendChild(f); const w = vista[vista.length - 1]; await carico(f); await pausa(); out.presoPerIndice = leggi(w); }
  { const f = doc.createElement('iframe'); f.src = location.origin + '/figlio?3'; doc.body.appendChild(f); await carico(f); await pausa();
    out.contestoDelRiquadro = fnv(scena(document, f.contentWindow.HTMLCanvasElement.prototype.getContext).toDataURL()); }
  return out;
}

for (const daCapo of ['pagina', 'riquadro']) {
  test(`r1 riscritto da capo (${daCapo}): i riquadri della stessa origine leggono col rumore della pagina`, async ({ openTab }) => {
    test.setTimeout(120_000);
    const srv = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(req.url.startsWith('/figlio') ? FIGLIO : PAGINA);
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${srv.address().port}/`;
    try {
      const page = await openTab(url);
      await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
      const intatta = await page.evaluate(porte, '');
      await page.goto(url + '?2');
      await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
      const on = await page.evaluate(porte, daCapo);
      await setFpMode(openTab, 'off');
      await page.goto(url + '?off');
      await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
      const off = await page.evaluate(porte, daCapo);
      expect(on.pagina).not.toBe(off.pagina);
      for (const k of ['stessaOrigine', 'presoPerIndice', 'contestoDelRiquadro']) {
        expect(intatta[k], `${k}: senza riscrittura ha il rumore`).toBe(intatta.pagina);
        expect.soft(on[k], `${k}: col rumore della pagina`).toBe(on.pagina);
      }
    } finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
  });
}
