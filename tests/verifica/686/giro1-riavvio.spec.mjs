// #686, primo giro — LA PROMESSA DEL RIAVVIO.
//
// Lo strumento dello zoom dice a Filo, fra le istruzioni che il modello legge a
// ogni messaggio, che «lo zoom resta sul sito, anche dopo il riavvio». È una
// frase che l'utente si sente ripetere quando chiede «resta così?». Qui la si
// mette alla prova coi passi dell'utente: zoom al 150% chiesto a parole, Filo
// chiuso e riaperto, stesso sito.
//
// La prova asserisce il successo dal punto di vista dell'utente: il sito si
// riapre grande come l'ha lasciato.

import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>zoom</title></head>
<body><h1>una pagina qualunque</h1><p>testo da ingrandire</p></body></html>`;

// Un server che vive per tutta la prova: l'origine (host:porta) deve essere la
// STESSA prima e dopo il riavvio, altrimenti non si starebbe provando la
// memoria del sito ma quella di due siti diversi.
async function servi(html) {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}/pagina`,
    async chiudi() {
      try { server.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => server.close(r));
    },
  };
}

async function apri(userData) {
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: {
      ...process.env,
      FILO_USER_DATA: userData,
      FILO_DOWNLOAD_DIR: join(userData, 'downloads'),
      NODE_ENV: 'test',
    },
  });
  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  return { app, shell };
}

// Apre l'indirizzo come scheda e aspetta che i content script siano montati.
async function apriScheda(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const scadenza = Date.now() + 15000;
  let page = null;
  while (Date.now() < scadenza) {
    page = app.windows().find((w) => {
      try { return w.url().startsWith(url); } catch (_) { return false; }
    });
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!page) throw new Error(`nessuna scheda per ${url}`);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForFunction(
    () => document.documentElement.dataset.filoReady === '1',
    null,
    { timeout: 10000 },
  ).catch(() => {});
  return page;
}

const percentuale = (app, url) => app.evaluate(({ webContents }, u) => {
  for (const wc of webContents.getAllWebContents()) {
    let qui = '';
    try { qui = wc.getURL(); } catch (_) {}
    if (qui.startsWith(u)) return Math.round(wc.getZoomFactor() * 100);
  }
  return null;
}, url);

const chiediZoom = (app, action) => app.evaluate(({ BrowserWindow }, a) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  return globalThis.SN_EXECUTE_FILO_ACTION(a, { sender: { win, wc: win.webContents } });
}, action);

test('lo zoom chiesto a parole si ritrova al riavvio di Filo, come Filo promette', async () => {
  test.setTimeout(180000);
  const userData = cartellaTemporanea('filo-test-686-');
  const sito = await servi(PAGINA);
  let primo = null;
  let secondo = null;
  try {
    primo = await apri(userData);
    await apriScheda(primo.app, primo.shell, sito.url);
    const r = await chiediZoom(primo.app, { type: 'ZOOM_PAGINA', percentuale: 150 });
    expect(r.executed).toBe(true);
    expect(r.output.percentuale).toBe(150);
    await expect.poll(() => percentuale(primo.app, sito.url)).toBe(150);

    // L'utente chiude Filo e lo riapre: stessa installazione, stessi dati.
    await chiudiApp(primo.app);
    primo = null;

    secondo = await apri(userData);
    await apriScheda(secondo.app, secondo.shell, sito.url);
    // Il sito si riapre grande come l'utente l'aveva lasciato.
    await expect.poll(() => percentuale(secondo.app, sito.url), { timeout: 15000 }).toBe(150);
  } finally {
    if (primo) await chiudiApp(primo.app);
    if (secondo) await chiudiApp(secondo.app);
    await sito.chiudi();
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
