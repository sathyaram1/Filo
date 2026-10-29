// #1456 — Il colore identità della scheda (src/content/pageColor.js) chiede il favicon del sito: un sito che non lo
// manda mai non deve lasciare la pagina in caricamento, e la richiesta appesa si chiude da sola. #1456.2 — su un sito
// lento il colore arriva a testa della pagina letta, non quando la pagina finisce di caricarsi.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

const schedaAttiva = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return { colore: t.identityColor || null, inCaricamento: t.view.webContents.isLoading() };
});

test('un sito che non manda mai il favicon finisce di caricarsi lo stesso, e la richiesta appesa si chiude', async ({ app, openTab }) => {
  const appese = [];
  const server = createServer((req, res) => {
    if (req.url.startsWith('/favicon.ico')) {
      // L'icona della barra la scarica il main per conto suo (no-cors): se parte prima, la richiesta della pagina aspetta
      // dietro di lei nella cache della sessione e qui non arriva mai (#1492). A lei si risponde subito: la prova è sulla pagina.
      if (req.headers['sec-fetch-mode'] !== 'cors') { res.writeHead(404); res.end(); return; }
      const r = { chiusa: false };
      res.on('close', () => { r.chiusa = true; });
      appese.push({ r, res });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<title>In arrivo</title><body onload="document.title = \'Caricata\'"><p>Ciao</p></body>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const pagina = await openTab(`http://127.0.0.1:${server.address().port}/`);
    await pagina.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
    // Il codice del sito che aspetta il caricamento parte, e la scheda non resta in caricamento.
    await expect(pagina).toHaveTitle('Caricata', { timeout: 5_000 });
    // Nemmeno per il tetto di attesa del favicon (3 s): il caricamento non lo aspetta.
    const attesa = await pagina.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      return n.loadEventStart - n.domContentLoadedEventEnd;
    });
    expect(attesa).toBeLessThan(1500);
    await expect.poll(async () => (await schedaAttiva(app)).inCaricamento).toBe(false);
    // Il favicon la pagina lo chiede comunque, e dopo il tetto di attesa la richiesta non resta aperta.
    await expect.poll(() => appese.length, { timeout: 5_000 }).toBeGreaterThan(0);
    await expect.poll(() => appese.every((a) => a.r.chiusa), { timeout: 8_000 }).toBe(true);
  } finally {
    for (const a of appese) { try { a.res.destroy(); } catch (_) {} }
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
  }
});

test('su un sito con un\'immagine lenta la scheda prende il colore del sito mentre la pagina carica ancora', async ({ app, openTab }) => {
  const lente = [];
  const server = createServer((req, res) => {
    if (req.url.startsWith('/icona.svg')) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#e02020"/></svg>');
      return;
    }
    // Un'immagine che il sito manda dopo 12 s tiene la pagina in caricamento, come un sito pieno di pubblicità.
    if (req.url.startsWith('/lento.png')) {
      lente.push(res);
      setTimeout(() => { try { res.writeHead(404); res.end(); } catch (_) {} }, 12_000);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<title>Lento</title><link rel="icon" href="/icona.svg"><p>Ciao</p><img src="/lento.png">');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await openTab(`http://127.0.0.1:${server.address().port}/`);
    await expect.poll(async () => (await schedaAttiva(app)).colore, { timeout: 4_000 }).not.toBe(null);
    const scheda = await schedaAttiva(app);
    const [r, g, b] = scheda.colore.match(/\d+/g).map(Number);
    expect(r).toBeGreaterThan(Math.max(g, b) + 100);
    // Il colore non ha aspettato la fine del caricamento: la pagina carica ancora.
    expect(scheda.inCaricamento).toBe(true);
  } finally {
    for (const r of lente) { try { r.destroy(); } catch (_) {} }
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
  }
});
