// Verifica #798 giro 8. r1: le funzioni di esportazione del canvas prese da un riquadro della pagina leggono il canvas
// senza rumore appena quel riquadro passa a un documento di un'altra origine (un altro sito, un data:).
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

const PAGINA = '<!doctype html><meta charset="utf-8"><title>altrove</title><body><p>ok</p></body>';

async function porte() {
  const fnv = (s) => { let a = 2166136261; for (let i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; return a.toString(16); };
  const c = document.createElement('canvas'); c.width = 80; c.height = 40;
  const x = c.getContext('2d'); x.fillStyle = '#1e90ff'; x.fillRect(0, 0, 80, 40); x.fillStyle = '#000'; x.font = '16px sans-serif'; x.fillText('filo', 4, 24);
  const carico = (f) => new Promise((r) => { f.addEventListener('load', r, { once: true }); setTimeout(r, 4000); });
  const blob = (tb) => new Promise((res) => tb.call(c, (b) => { const fr = new FileReader(); fr.onload = () => res(fnv(fr.result)); fr.readAsDataURL(b); }));
  const prova = async (src, conBlob, iniziale) => {
    const f = document.createElement('iframe');
    if (iniziale) { f.src = iniziale; document.body.appendChild(f); await carico(f); } else document.body.appendChild(f);
    const P = f.contentWindow.HTMLCanvasElement.prototype, td = P.toDataURL, tb = P.toBlob;
    f.src = src; await carico(f);
    try { return conBlob ? await blob(tb) : fnv(td.call(c)); } catch (e) { return 'errore ' + e.message; }
  };
  const altro = location.protocol + '//sito-pubblico.test:' + location.port + '/altro';
  return {
    pagina: fnv(c.toDataURL()),
    vuotoAltroSito: await prova(altro),
    vuotoAltroSitoToBlob: await prova(altro, true),
    vuotoData: await prova('data:text/html,<p>x</p>'),
    stessoSitoPoiAltroSito: await prova(altro, false, '/stesso'),
  };
}

test('r1 le funzioni di un riquadro della pagina passato a un\'altra origine esportano il canvas col rumore della pagina', async ({ openTab }) => {
  test.setTimeout(120_000);
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
    expect(on.pagina).not.toBe(off.pagina);
    for (const k of ['vuotoAltroSito', 'vuotoAltroSitoToBlob', 'vuotoData', 'stessoSitoPoiAltroSito']) {
      expect.soft(on[k], `${k}: col rumore della pagina`).toBe(on.pagina);
    }
  } finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
});
