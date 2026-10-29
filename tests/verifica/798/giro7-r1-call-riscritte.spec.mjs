// Verifica #798 giro 7 (dopo il riallineamento). r1: una pagina che ha riscritto call e apply aggiunge un riquadro
// vuoto: l'aggiunta non deve lanciare e il canvas letto con le funzioni del riquadro deve avere il rumore della pagina.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const PAGINA = '<!doctype html><meta charset="utf-8"><title>call</title><body><p>ok</p></body>';

function prova() {
  const fnv = (s) => { let a = 2166136261; for (let i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; return a.toString(16); };
  const c = document.createElement('canvas'); c.width = 80; c.height = 40;
  const x = c.getContext('2d'); x.fillStyle = '#1e90ff'; x.fillRect(0, 0, 80, 40); x.fillStyle = '#000'; x.font = '16px sans-serif'; x.fillText('filo', 4, 24);
  const out = { pagina: fnv(c.toDataURL()) };
  const salva = { call: Function.prototype.call, apply: Function.prototype.apply };
  const spia = function () { throw new Error('rubato'); };
  let f = null;
  try {
    Function.prototype.call = spia; Function.prototype.apply = spia;
    f = document.createElement('iframe');
    try { document.body.appendChild(f); out.aggiunta = 'ok'; } catch (e) { out.aggiunta = 'errore: ' + e.message; }
    try { c.leggi = f.contentWindow.HTMLCanvasElement.prototype.toDataURL; out.riquadro = c.leggi(); } catch (e) { out.riquadro = 'errore: ' + e.message; }
  } finally {
    Function.prototype.call = salva.call; Function.prototype.apply = salva.apply;
  }
  if (/^data:/.test(out.riquadro)) out.riquadro = fnv(out.riquadro);
  return out;
}

test('r1 una pagina che ha riscritto call e apply aggiunge un riquadro vuoto senza errori e ne legge il canvas col rumore della pagina', async ({ openTab }) => {
  test.setTimeout(60_000);
  const srv = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PAGINA); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const page = await openTab(`http://127.0.0.1:${srv.address().port}/`);
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
    const r = await page.evaluate(prova);
    expect.soft(r.aggiunta, 'aggiungere il riquadro non lancia').toBe('ok');
    expect(r.riquadro, 'il canvas letto dal riquadro ha il rumore della pagina').toBe(r.pagina);
  } finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
});
