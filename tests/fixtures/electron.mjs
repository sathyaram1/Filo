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
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..', '..');

// Zoom di sistema simulato. Lo schermo di chi sviluppa Filo sta al 125%, quindi
// `devicePixelRatio` parte da 1.25 e non da 1: bastava quello a far divergere
// una manciata di spec fra la sua macchina e le routine cloud, dove ogni schermo
// è al 100%. `FILO_TEST_SCALE=1.25 npx playwright test …` rimette quel fattore
// anche su Linux, che è l'unico modo di RIVEDERE quei rossi senza avere lo
// stesso schermo sotto mano.
const SCALA = Number(process.env.FILO_TEST_SCALE) > 0 ? Number(process.env.FILO_TEST_SCALE) : 0;
export const argomentiScala = SCALA ? [`--force-device-scale-factor=${SCALA}`] : [];

export const test = base.extend({
  app: async ({}, use) => {
    const userData = mkdtempSync(join(tmpdir(), 'filo-test-'));
    const app = await electron.launch({
      // host-resolver-rules: fa risolvere il dominio finto "blocked.test" al
      // loopback, così l'e2e del blocco siti (siteBlock.spec.mjs) può mettere in
      // blacklist un DOMINIO REALE (con estensione valida) — non un IP, che l'app
      // scarta di proposito — e comunque farlo servire dal testServer locale.
      args: [...argomentiScala, '--host-resolver-rules=MAP blocked.test 127.0.0.1', '.'],
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
    try { await app.close(); } catch (_) {}
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  },

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
      const deadline = Date.now() + 10_000;
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
          { timeout: 8000 },
        );
        return page;
      },
    };
    await use(api);
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
  },
});

export { expect };
