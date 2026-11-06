// Verifica #798 giro 11. r1: un riquadro della stessa origine dentro un'ombra (shadow root), appena ci carica un
// documento (col suo indirizzo, con srcdoc, o cambiando documento dopo l'aggiunta), dà funzioni di esportazione del
// canvas che leggono il canvas della pagina senza rumore, come con Off. Lo stesso riquadro fuori dall'ombra ha il rumore.
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
const PAGINA = `<!doctype html><meta charset="utf-8"><title>ombra</title><script>${IMPRONTA}</script><body><p>ok</p></body>`;
const FIGLIO = '<!doctype html><meta charset="utf-8"><body><p>figlio</p></body>';

async function porte() {
  /* global fnv, scena */
  const c = scena(document);
  const out = { pagina: fnv(c.toDataURL()) };
  const leggi = (W) => { try { return fnv(W.HTMLCanvasElement.prototype.toDataURL.call(c)); } catch (e) { return 'errore ' + e.message; } };
  const pausa = () => new Promise((r) => setTimeout(r, 300));
  const carico = (f) => new Promise((r) => { f.addEventListener('load', r, { once: true }); setTimeout(r, 5000); });
  const ombra = () => { const d = document.createElement('div'); document.body.appendChild(d); return d.attachShadow({ mode: 'open' }); };
  const blob = async (W) => { const b = await new Promise((r) => W.HTMLCanvasElement.prototype.toBlob.call(c, r));
    return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fnv(fr.result)); fr.readAsDataURL(b); }); };
  out.paginaBlob = await blob(window);
  { const f = document.createElement('iframe'); f.src = '/figlio?1'; document.body.appendChild(f); await carico(f); await pausa(); out.fuoriDallOmbra = leggi(f.contentWindow); }
  { const sr = ombra(); sr.innerHTML = '<iframe src="/figlio?2"></iframe>'; const f = sr.querySelector('iframe'); await carico(f); await pausa();
    out.conIndirizzo = leggi(f.contentWindow); out.conIndirizzoBlob = await blob(f.contentWindow); }
  { const sr = ombra(); const f = document.createElement('iframe'); f.src = '/figlio?3'; sr.appendChild(f); await carico(f); await pausa(); out.aggiunto = leggi(f.contentWindow); }
  { const sr = ombra(); const f = document.createElement('iframe'); sr.appendChild(f); leggi(f.contentWindow); f.src = '/figlio?4'; await carico(f); await pausa(); out.cambiaDocumento = leggi(f.contentWindow); }
  { const sr = ombra(); const f = document.createElement('iframe'); sr.appendChild(f); leggi(f.contentWindow); f.srcdoc = '<p>x</p>'; await carico(f); await pausa(); out.srcdoc = leggi(f.contentWindow); }
  return out;
}

test('r1 un riquadro della stessa origine dentro un\'ombra legge il canvas della pagina col suo rumore', async ({ openTab }) => {
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
    expect(on.pagina).not.toBe(off.pagina);
    expect(on.fuoriDallOmbra, 'fuori dall\'ombra ha il rumore').toBe(on.pagina);
    for (const k of ['conIndirizzo', 'aggiunto', 'cambiaDocumento', 'srcdoc']) expect.soft(on[k], k).toBe(on.pagina);
    expect.soft(on.conIndirizzoBlob, 'toBlob').toBe(on.paginaBlob);
  } finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
});
