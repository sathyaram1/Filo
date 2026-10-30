// Esplorazione verifica #1701 giro 3: pagina che arriva a pezzi, e navigazione nella stessa scheda verso un sito lento.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const svg = (c) => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="${c}"/></svg>`;

const coloreAttiva = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return { c: t.identityColor || null, l: t.view.webContents.isLoading(), u: t.url };
});

async function servi(handler) {
  const s = createServer(handler);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return s;
}
async function chiudi(s) { try { s.closeAllConnections?.(); } catch (_) {} await new Promise((r) => s.close(r)); }

test('pagina che arriva a pezzi: testa e articolo subito, il resto dopo 10 s', async ({ app, openTab }) => {
  const s = await servi((req, res) => {
    if (req.url.startsWith('/icona.svg')) { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); res.end(svg('#e02020')); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.write('<!doctype html><html><head><title>X</title><link rel="icon" href="/icona.svg"></head><body><h1>Titolo</h1><p>' + 'testo '.repeat(400) + '</p>');
    setTimeout(() => { try { res.end('<p>fine</p></body></html>'); } catch (_) {} }, 10_000);
  });
  try {
    const t0 = Date.now();
    await openTab(`http://127.0.0.1:${s.address().port}/`).catch(() => {});
    await expect.poll(async () => (await coloreAttiva(app)).c, { timeout: 4_000, intervals: [100] }).not.toBe(null);
    console.log('pezzi: colore dopo', Date.now() - t0, 'ms', JSON.stringify(await coloreAttiva(app)));
  } finally { await chiudi(s); }
});

test('stessa scheda: da un sito rosso a uno blu lento', async ({ app, openTab }) => {
  const a = await servi((req, res) => {
    if (req.url.startsWith('/icona.svg')) { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); res.end(svg('#e02020')); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<title>A</title><link rel="icon" href="/icona.svg"><p>A</p>');
  });
  const lente = [];
  const b = await servi((req, res) => {
    if (req.url.startsWith('/icona.svg')) { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); res.end(svg('#2040e0')); return; }
    if (req.url.startsWith('/lento.png')) { lente.push(res); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<title>B</title><link rel="icon" href="/icona.svg"><p>B</p><img src="/lento.png">');
  });
  try {
    const p = await openTab(`http://127.0.0.1:${a.address().port}/`);
    await expect.poll(async () => (await coloreAttiva(app)).c, { timeout: 5_000 }).not.toBe(null);
    const rosso = (await coloreAttiva(app)).c;
    const t0 = Date.now();
    await p.evaluate((u) => { location.href = u; }, `http://localhost:${b.address().port}/`);
    await expect.poll(async () => { const x = await coloreAttiva(app); return x.c && x.c !== rosso ? x.c : null; }, { timeout: 4_000, intervals: [100] }).not.toBe(null);
    const x = await coloreAttiva(app);
    console.log('nav: da', rosso, 'a', x.c, 'dopo', Date.now() - t0, 'ms, carica ancora', x.l);
    const [r, , bl] = x.c.match(/\d+/g).map(Number);
    expect(bl).toBeGreaterThan(r + 100);
  } finally { for (const r of lente) { try { r.destroy(); } catch (_) {} } await chiudi(a); await chiudi(b); }
});
