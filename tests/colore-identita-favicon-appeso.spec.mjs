// #1456 — Il colore identità della scheda (src/content/pageColor.js) chiede il favicon del sito: un sito che non lo
// manda mai non deve lasciare la pagina in caricamento. Il favicon si chiede a pagina caricata, e la richiesta rimasta
// appesa si chiude da sola.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

test('un sito che non manda mai il favicon finisce di caricarsi lo stesso, e la richiesta appesa si chiude', async ({ app, openTab }) => {
  const appese = [];
  const server = createServer((req, res) => {
    if (req.url.startsWith('/favicon.ico')) {
      const r = { dest: req.headers['sec-fetch-dest'] || '', chiusa: false, at: Date.now() };
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
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      return w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents.isLoading();
    })).toBe(false);
    // Il favicon la pagina lo chiede comunque, e dopo il tetto di attesa la richiesta non resta aperta.
    await expect.poll(() => appese.filter((a) => a.r.dest === 'image').length, { timeout: 5_000 }).toBeGreaterThan(0);
    await expect.poll(() => appese.filter((a) => a.r.dest === 'image').every((a) => a.r.chiusa), { timeout: 8_000 }).toBe(true);
  } finally {
    for (const a of appese) { try { a.res.destroy(); } catch (_) {} }
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
  }
});
