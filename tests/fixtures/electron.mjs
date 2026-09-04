// Fixture Playwright per Filo Electron.
//
// Lancia l'app via _electron.launch e fornisce ai test:
//   - app:        l'istanza ElectronApplication
//   - shell:      Page object della shell (BrowserWindow primary)
//   - openTab:    apre una URL come nuovo tab e ritorna la Page del WebContentsView
//   - testServer: mini HTTP server locale per pagine di test (i content
//                 script Filo si caricano via preload anche su http://127.0.0.1)
//
// Punti d'attenzione:
//   - userData isolato: ogni test mette FILO_USER_DATA in env così non
//     calpesta lo storage reale dell'utente
//   - Playwright per Electron passa attraverso il debugger CDP; setAlwaysOnTop
//     può interferire con altri test → lo lasciamo decidere ai test che
//     vogliono il pixel-perfect.

import { test as base, _electron as electron, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { lento } from './tempi.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..', '..');

/**
 * Chiude l'app senza poterci mettere un tempo indefinito.
 *
 * `app.close()` a volte non torna: sotto Xvfb, su una macchina lenta, Electron
 * ci mette più del previsto a morire — e finché non torna il test è "in
 * chiusura", cioè fermo. Qui la chiusura gentile ha un tetto suo; scaduto
 * quello, il processo si ammazza. Un test già passato non deve poter diventare
 * rosso per il modo in cui l'app si spegne.
 */
async function chiudiApp(app) {
  const tetto = new Promise((r) => { setTimeout(r, lento(20_000)).unref?.(); });
  try { await Promise.race([app.close(), tetto]); } catch (_) { /* chiusura sporca: sotto si ammazza */ }
  try {
    const p = app.process && app.process();
    if (p && p.exitCode === null && p.pid) p.kill('SIGKILL');
  } catch (_) { /* già morto */ }
}

export const test = base.extend({
  // Il tetto è della FIXTURE, non del test: senza, l'avvio e lo smontaggio di
  // Electron si mangiano il tempo del test, e su una macchina lenta un test che
  // ha fatto tutto quello che doveva muore in chiusura ("Tearing down app
  // exceeded the test timeout"). Erano sette spec rosse solo sul runner di
  // GitHub Actions, scusate per mesi come se fossero rossi d'ambiente.
  app: [async ({}, use) => {
    const userData = mkdtempSync(join(tmpdir(), 'filo-test-'));
    const app = await electron.launch({
      // host-resolver-rules: fa risolvere il dominio finto "blocked.test" al
      // loopback, così l'e2e del blocco siti (siteBlock.spec.mjs) può mettere in
      // blacklist un DOMINIO REALE (con estensione valida) — non un IP, che l'app
      // scarta di proposito — e comunque farlo servire dal testServer locale.
      args: ['--host-resolver-rules=MAP blocked.test 127.0.0.1', '.'],
      cwd: APP_ROOT,
      env: {
        ...process.env,
        FILO_USER_DATA: userData,
        // I download ("Salva immagine come…") finiscono qui SENZA dialogo
        // nativo (impossibile da automatizzare headless). Vive dentro
        // userData così viene ripulito insieme al resto.
        FILO_DOWNLOAD_DIR: join(userData, 'downloads'),
        // NB: la finestra invisibile durante i test NON si attiva qui — la
        // attiva `playwright.config.js` sull'ambiente del worker, così vale
        // anche per la cinquantina di spec che lancia Electron senza passare da
        // questa fixture. Qui la eredita e basta (`...process.env` sopra).
        NODE_ENV: 'test',
      },
    });
    await use(app);
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }, { timeout: 90_000 }],

  // Pagina della shell del browser (tab bar + barra indirizzi). È la prima
  // window che Filo apre.
  shell: async ({ app }, use) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await use(win);
  },

  // Apre un URL come tab e ritorna la Page corrispondente al WebContentsView.
  // Polling sull'URL: app.waitForEvent('window') può risolvere con la
  // newtab (già pendente al boot), non con il tab appena aperto. Per evitare
  // race usiamo app.windows() filtrato per hostname della URL richiesta.
  openTab: async ({ app, shell }, use) => {
    const fn = async (url) => {
      const target = new URL(url).hostname;
      await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
      const deadline = Date.now() + lento(10_000);
      let page = null;
      while (Date.now() < deadline) {
        page = app.windows().find((w) => {
          try { return new URL(w.url()).hostname === target; }
          catch (_) { return false; }
        });
        if (page) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!page) throw new Error(`openTab: nessuna window per ${url}`);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      return page;
    };
    await use(fn);
  },

  // Server HTTP locale: i content script di Filo si caricano via preload su
  // QUALSIASI url (anche file://), ma per uniformità con la suite dell'estensione
  // serviamo HTML su 127.0.0.1.
  testServer: async ({}, use) => {
    const pages = new Map();
    let nextId = 0;
    const server = createServer((req, res) => {
      const id = req.url.replace(/^\//, '').split('?')[0];
      const html = pages.get(id);
      if (!html) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const api = {
      html(body) {
        const id = String(++nextId);
        pages.set(id, body);
        return `http://127.0.0.1:${port}/${id}`;
      },
      origin: `http://127.0.0.1:${port}`,
      // Naviga e aspetta che i content script si siano montati: il page-preload
      // imposta data-filo-ready su <html> al termine di start().
      async openReady(openTab, html, opts = {}) {
        const url = this.html(html);
        const page = await openTab(url);
        await page.waitForFunction(
          () => document.documentElement.dataset.filoReady === '1',
          null,
          { timeout: lento(8000) },
        );
        return page;
      },
    };
    await use(api);
    try { server.closeAllConnections?.(); } catch (_) {}
    // `server.close` chiama indietro solo quando l'ultima connessione è andata:
    // se una resta appesa non torna MAI, e quell'attesa senza fine diventa un
    // "Worker teardown timeout" che nessuno collega al server di prova. Il
    // processo muore comunque alla fine della fetta.
    await Promise.race([
      new Promise((r) => server.close(r)),
      new Promise((r) => { setTimeout(r, lento(5000)).unref?.(); }),
    ]);
  },
});

export { expect };
