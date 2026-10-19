// Verifica #798 giro 1. r1: la pagina raggiunge per indice (window[n]) un suo riquadro senza documento proprio prima
// che la guardia lo prepari, e ne legge il canvas senza rumore. r2: con la protezione accesa la finestra porta una
// proprietà in più che un sito vede, e con Off no.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

const PAGINA = '<!doctype html><meta charset="utf-8"><title>porte</title><body><p>ok</p></body>';

async function porte() {
  const fnv = (s) => { let a = 2166136261; for (let i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; return a.toString(16); };
  const c = document.createElement('canvas'); c.width = 80; c.height = 40;
  const x = c.getContext('2d'); x.fillStyle = '#1e90ff'; x.fillRect(0, 0, 80, 40); x.fillStyle = '#000'; x.font = '16px sans-serif'; x.fillText('filo', 4, 24);
  const leggi = (W) => { try { return fnv(W.HTMLCanvasElement.prototype.toDataURL.call(c)); } catch (e) { return 'errore ' + e.message; } };
  const ultimo = () => window[window.length - 1];
  const out = { pagina: fnv(c.toDataURL()) };
  { const f = document.createElement('iframe'); document.body.appendChild(f); out.subitoDopoAppendChild = leggi(ultimo()); }
  { document.body.insertAdjacentHTML('beforeend', '<iframe></iframe>'); out.subitoDopoInsertAdjacentHTML = leggi(ultimo()); }
  { const f = document.createElement('iframe'); f.srcdoc = '<p>x</p>'; document.body.appendChild(f); out.srcdocNonAncoraCarico = leggi(ultimo()); }
  { const f = document.createElement('iframe'); f.src = '/204'; document.body.appendChild(f); await new Promise((r) => setTimeout(r, 1500)); out.indirizzoStessoSitoSenzaContenuto = leggi(ultimo()); }
  { const f = document.createElement('iframe'); f.src = location.protocol + '//sito-pubblico.test:' + location.port + '/lento'; document.body.appendChild(f); await new Promise((r) => setTimeout(r, 300)); out.altroSitoAncoraInCarico = leggi(ultimo()); }
  out.proprieta = Object.getOwnPropertyNames(window).filter((k) => /filo/i.test(k)).sort().join(',');
  return out;
}

async function apri(openTab) {
  const srv = createServer((req, res) => {
    if (req.url === '/204') { res.writeHead(204); res.end(); return; }
    if (req.url === '/lento') { setTimeout(() => { try { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<p>lento</p>'); } catch (_) {} }, 8000); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PAGINA);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, url: `http://127.0.0.1:${srv.address().port}/` };
}

test('r1 un riquadro della pagina raggiunto per indice prima che sia preparato ha lo stesso rumore della pagina', async ({ openTab }) => {
  test.setTimeout(90_000);
  const { srv, url } = await apri(openTab);
  try {
    const page = await openTab(url);
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
    const on = await page.evaluate(porte);
    await setFpMode(openTab, 'off');
    await page.goto(url + '?off');
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
    const off = await page.evaluate(porte);
    expect(on.pagina).not.toBe(off.pagina);
    // srcdoc prima che carichi e un indirizzo della stessa origine muto restano scoperti in Automatico: scelta dell'owner.
    for (const k of ['subitoDopoAppendChild', 'subitoDopoInsertAdjacentHTML', 'altroSitoAncoraInCarico']) {
      expect.soft(on[k], `${k}: col rumore della pagina`).toBe(on.pagina);
    }
  } finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
});

test('r2 la finestra della pagina ha le stesse proprietà con la protezione accesa e con Off', async ({ openTab }) => {
  test.setTimeout(90_000);
  const { srv, url } = await apri(openTab);
  try {
    const page = await openTab(url);
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
    const on = await page.evaluate(() => Object.getOwnPropertyNames(window).filter((k) => /filo/i.test(k)).sort().join(','));
    await setFpMode(openTab, 'off');
    await page.goto(url + '?off');
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
    const off = await page.evaluate(() => Object.getOwnPropertyNames(window).filter((k) => /filo/i.test(k)).sort().join(','));
    expect(on).toBe(off);
  } finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
});
