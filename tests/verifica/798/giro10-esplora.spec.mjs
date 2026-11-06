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
const PAGINA = `<!doctype html><meta charset="utf-8"><title>porte</title><script>${IMPRONTA}</script><body><p>ok</p></body>`;
const FIGLIO = `<!doctype html><meta charset="utf-8"><body><p>figlio</p></body>`;

async function porte(riscrivi) {
  /* global fnv, scena */
  if (riscrivi) { document.open(); document.write('<!doctype html><meta charset="utf-8"><body><p>riscritta</p></body>'); document.close(); }
  const c = scena(document);
  const leggi = (W) => { try { return fnv(W.HTMLCanvasElement.prototype.toDataURL.call(c)); } catch (e) { return 'errore ' + e.message; } };
  const ultimo = () => window[window.length - 1];
  const carico = (f) => new Promise((r) => { f.addEventListener('load', r, { once: true }); setTimeout(r, 5000); });
  const out = { pagina: fnv(c.toDataURL()) };
  { const f = document.createElement('iframe'); f.src = '/figlio'; document.body.appendChild(f); await carico(f); await new Promise((r) => setTimeout(r, 300)); out.stessaOrigineDaQui = leggi(f.contentWindow); }
  { const f = document.createElement('iframe'); f.src = '/figlio?2'; document.body.appendChild(f); const w = ultimo(); await carico(f); await new Promise((r) => setTimeout(r, 300)); out.indicePrimaDelCarico = leggi(w); }
  { const f = document.createElement('iframe'); f.src = '/figlio?3'; document.body.appendChild(f); await carico(f); const i = window.length - 1; f.src = 'about:blank'; await carico(f); await new Promise((r) => setTimeout(r, 300)); out.tornatoVuotoIndice = leggi(window[i]); }
  { const f = document.createElement('iframe'); document.body.appendChild(f); out.vuotoElemento = leggi(f.contentWindow); }
  return out;
}

for (const riscrivi of [false, true]) {
  test(`esplora riscrivi=${riscrivi}`, async ({ openTab }) => {
    test.setTimeout(120_000);
    const srv = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(req.url.startsWith('/figlio') ? FIGLIO : PAGINA);
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${srv.address().port}/`;
    try {
      const page = await openTab(url);
      await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
      const on = await page.evaluate(porte, riscrivi);
      await setFpMode(openTab, 'off');
      await page.goto(url + '?off');
      await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
      const off = await page.evaluate(porte, riscrivi);
      console.log('ON', riscrivi, JSON.stringify(on));
      console.log('OFF', riscrivi, JSON.stringify(off));
      expect(on.pagina).not.toBe(off.pagina);
    } finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
  });
}
