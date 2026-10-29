// Verifica #1701 giro 1: il colore del sito sulla scheda, sui siti lenti e su quelli con una politica dei contenuti.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const ICONA = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#e02020"/></svg>';

async function sito(gestore) {
  const tenute = [];
  const server = createServer((req, res) => {
    if (req.url.startsWith('/icona.svg')) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end(ICONA);
      return;
    }
    gestore(req, res, tenute);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    async chiudi() {
      for (const r of tenute) { try { r.destroy(); } catch (_) {} }
      try { server.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => server.close(r));
    },
  };
}

// La scheda come la vede l'utente: aperta dietro, la tinta del sito la porta la barra.
const apriDietro = (app, url) => app.evaluate(({ BrowserWindow }, u) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  return w._filoTabs.openTab(u, { activate: false });
}, url);
const statoScheda = (app, shell, id) => Promise.all([
  app.evaluate(({ BrowserWindow }, tid) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === tid);
    return t ? { colore: t.identityColor || null, inCaricamento: t.view.webContents.isLoading() } : null;
  }, id),
  shell.evaluate((tid) => {
    const el = document.querySelector(`.tab[data-id="${tid}"]`);
    return el ? el.style.getPropertyValue('--tab-bg-eff') || null : null;
  }, id),
]).then(([m, tinta]) => ({ ...m, tinta }));
const rosso = (c) => { const [r, g, b] = String(c).match(/\d+/g).map(Number); return r > Math.max(g, b) + 100; };

test('scheda aperta dietro, sito con immagine lenta: la barra la tinge mentre carica ancora', async ({ app, shell }) => {
  const s = await sito((req, res, tenute) => {
    if (req.url.startsWith('/lento.png')) { tenute.push(res); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<title>Lento</title><link rel="icon" href="/icona.svg"><p>Ciao</p><img src="/lento.png">');
  });
  try {
    const id = await apriDietro(app, s.url);
    const t0 = Date.now();
    await expect.poll(async () => (await statoScheda(app, shell, id)).tinta, { timeout: 4_000 }).not.toBe(null);
    const st = await statoScheda(app, shell, id);
    console.log('dietro, immagine lenta: tinta dopo', Date.now() - t0, 'ms', st);
    expect(rosso(st.colore)).toBe(true);
    expect(st.inCaricamento).toBe(true);
  } finally { await s.chiudi(); }
});

test('sito con uno script lento a metà pagina: la pagina si vede, il colore arriva subito', async ({ app, shell }) => {
  const s = await sito((req, res, tenute) => {
    if (req.url.startsWith('/lento.js')) {
      tenute.push(res);
      setTimeout(() => { try { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(''); } catch (_) {} }, 8_000);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<title>Lento</title><link rel="icon" href="/icona.svg"><h1>Notizie</h1><p>Articolo</p><script src="/lento.js"></script><p>Fine</p>');
  });
  try {
    const id = await apriDietro(app, s.url);
    const t0 = Date.now();
    await expect.poll(async () => (await statoScheda(app, shell, id)).tinta, { timeout: 3_000 }).not.toBe(null);
    console.log('script lento: tinta dopo', Date.now() - t0, 'ms');
  } finally { await s.chiudi(); }
});

for (const [nome, csp] of [
  ['default-src self', "default-src 'self'"],
  ['img-src self https', "img-src 'self' https:"],
]) {
  test(`sito con politica dei contenuti (${nome}): la scheda prende il colore dell'icona`, async ({ app, shell }) => {
    const s = await sito((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp });
      res.end('<title>Sicuro</title><link rel="icon" href="/icona.svg"><p>Ciao</p>');
    });
    try {
      const id = await apriDietro(app, s.url);
      await expect.poll(async () => (await statoScheda(app, shell, id)).colore, { timeout: 6_000 }).not.toBe(null);
      expect(rosso((await statoScheda(app, shell, id)).colore)).toBe(true);
    } finally { await s.chiudi(); }
  });
}
