// Verifica #965 giro 1: un link da avviso fermato al clic anche quando scarica (attributo download) o quando è un modulo.

import { test, expect } from '../../fixtures/electron.mjs';
import { vistaAvviso, copertura } from '../../helpers/avvisoSito.mjs';
import { createServer } from 'node:http';

async function sito(t) {
  const richieste = [];
  const pagine = {};
  const server = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      richieste.push({ metodo: req.method, url: req.url, corpo });
      const path = req.url.split('?')[0];
      if (path.endsWith('.exe')) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': 4 });
        res.end('MZ00');
        return;
      }
      const html = pagine[path] || '<title>ok</title><p id="arrivato">arrivato</p>';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after = () => new Promise((r) => server.close(r));
  return { origin: `http://127.0.0.1:${server.address().port}`, pagine, richieste, chiudi: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

async function clic(app, sel) {
  await app.evaluate(async ({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    win.focus();
    const wc = win._filoTabs.tabs.find((t) => t.id === win._filoTabs.activeId).view.webContents;
    wc.focus();
    const r = await wc.executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(s)});
      el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect();
      return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
    const p = { x: r.x, y: r.y, button: 'left', clickCount: 1 };
    wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
    wc.sendInputEvent({ type: 'mouseDown', ...p });
    wc.sendInputEvent({ type: 'mouseUp', ...p });
  }, sel);
}

const contaScaricamenti = (app) => app.evaluate(({ BrowserWindow }) => {
  globalThis.__scaricati = [];
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
  const ses = win._filoTabs.tabs.find((t) => t.id === win._filoTabs.activeId).view.webContents.session;
  ses.prependListener('will-download', (e, item) => { globalThis.__scaricati.push(item.getURL()); e.preventDefault(); });
});

async function apri(openTab, url) {
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  return page;
}

test('r1 un link a un file travestito con l\'attributo download: al clic l\'avviso, e il file non parte', async ({ app, openTab }) => {
  const s = await sito({});
  s.pagine['/'] = '<title>Archivio</title><a id="file" download href="/documenti/fattura.pdf.exe">la tua fattura</a>';
  try {
    await apri(openTab, s.origin + '/');
    await contaScaricamenti(app);
    await clic(app, '#file');
    await new Promise((r) => setTimeout(r, 2500));
    const scaricati = await app.evaluate(() => globalThis.__scaricati);
    const coperta = (await copertura(app)).coperta;
    expect({ coperta, scaricati }).toEqual({ coperta: true, scaricati: [] });
  } finally { await s.chiudi(); }
});

test('controllo: lo stesso link senza download si ferma all\'avviso', async ({ app, openTab }) => {
  const s = await sito({});
  s.pagine['/'] = '<title>Archivio</title><a id="file" href="/documenti/fattura.pdf.exe">la tua fattura</a>';
  try {
    await apri(openTab, s.origin + '/');
    await contaScaricamenti(app);
    await clic(app, '#file');
    await expect.poll(async () => (await copertura(app)).coperta).toBe(true);
    expect(await app.evaluate(() => globalThis.__scaricati)).toEqual([]);
  } finally { await s.chiudi(); }
});

test('r2 un modulo che invia a un indirizzo da avviso: dopo «Continua» i dati arrivano', async ({ app, openTab }) => {
  const s = await sito({});
  s.pagine['/'] = '<title>Modulo</title><form id="m" method="post" action="/invio/ricevuta.pdf.exe?x=1">'
    + '<input name="nome" value="Mario"><button id="vai">Invia</button></form>';
  try {
    await apri(openTab, s.origin + '/');
    await contaScaricamenti(app);
    await clic(app, '#vai');
    const avviso = await vistaAvviso(app);
    await expect.poll(async () => (await copertura(app)).coperta).toBe(true);
    const continua = avviso.getByRole('button', { name: 'Continua' });
    await expect(continua).toBeEnabled({ timeout: 5_000 });
    await continua.click();
    await expect.poll(() => s.richieste.filter((r) => r.url.startsWith('/invio/')).length, { timeout: 10_000 }).toBeGreaterThan(0);
    const invio = s.richieste.filter((r) => r.url.startsWith('/invio/'));
    expect(invio.map((r) => `${r.metodo} ${r.corpo}`)).toEqual(['POST nome=Mario']);
  } finally { await s.chiudi(); }
});
