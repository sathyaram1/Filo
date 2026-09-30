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
import { argomentiScala } from '../helpers/scala.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..', '..');

// Zoom di sistema simulato: la manopola vive in tests/helpers/scala.mjs, perché
// Filo si apre anche da porte che non passano di qui (il pilota condiviso, e la
// ventina di spec che chiamano `electron.launch` per conto proprio). Qui la si
// ri-esporta perché quegli spec la importano da questa fixture da sempre.
export { argomentiScala };

// Chiusura con un tetto. `app.close()` aspetta che il processo di Electron
// esca, e se non esce (un'apertura di sistema appesa, un renderer morto male)
// Playwright aspetta il tetto del test — 60 secondi — e poi altri 60 per il
// worker, e li segna come «Worker teardown timeout»: nella prima corsa della
// suite in GitHub (2026-09-16) ne sono venuti quindici così, da tre spec.
// Cinque secondi bastano a una chiusura normale (misurata sotto il secondo);
// scaduti, il processo si ammazza. Su Windows SIGKILL è un TerminateProcess;
// a processo già uscito `kill` lancia, e si ignora.
export async function chiudiApp(app, { tetto = 5000 } = {}) {
  let pid = null;
  try { pid = app.process().pid; } catch (_) {}
  let timer = null;
  const scaduto = new Promise((r) => { timer = setTimeout(r, tetto); timer.unref?.(); });
  await Promise.race([app.close(), scaduto]).catch(() => {});
  clearTimeout(timer);
  if (pid) { try { process.kill(pid, 'SIGKILL'); } catch (_) {} }
}

// La Page della scheda davanti nella finestra della shell: la si riconosce da un segno messo dal main.
async function paginaDavanti(app, shell) {
  const segno = `s${Date.now()}${Math.random().toString(36).slice(2)}`;
  let messo = false;
  try {
    const bw = await app.browserWindow(shell);
    messo = await bw.evaluate(async (w, s) => {
      const t = w._filoTabs && w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
      if (!t || !/^filo:\/\/newtab\//.test(t.view.webContents.getURL())) return false;
      await t.view.webContents.executeJavaScript(`window.__filoSchedaDavanti = ${JSON.stringify(s)}`);
      return true;
    }, segno);
  } catch (_) { return null; }
  if (!messo) return null;
  for (const w of app.windows()) {
    try {
      if (new URL(w.url()).hostname !== 'newtab') continue;
      if (await w.evaluate(() => window.__filoSchedaDavanti) === segno) return w;
    } catch (_) { /* una pagina che sta cambiando: al giro dopo */ }
  }
  return null;
}

export const test = base.extend({
  app: async ({}, use) => {
    // Canonica, non abbreviata: vedi tests/helpers/percorsi.mjs. Da qui esce
    // anche FILO_DOWNLOAD_DIR, che gli spec degli scaricamenti confrontano con
    // il percorso che l'app riporta.
    const userData = cartellaTemporanea('filo-test-');
    const app = await electron.launch({
      // host-resolver-rules:
      //  • "blocked.test" al loopback, così l'e2e del blocco siti
      //    (siteBlock.spec.mjs) può mettere in blacklist un DOMINIO REALE (con
      //    estensione valida) — non un IP, che l'app scarta di proposito — e
      //    comunque farlo servire dal testServer locale;
      //  • 192.168.1.1 su una porta CHIUSA del loopback: è l'indirizzo del
      //    router di casa di mezzo mondo, e dove risponde davvero la pagina
      //    rimbalza altrove (https, o un nome tipo `fritz.box`) e gli spec che
      //    guardano l'indirizzo della scheda diventano rossi per colpa della
      //    rete di chi li lancia. Nessun test deve parlare con un apparecchio
      //    vero della LAN di qualcuno: la connessione viene rifiutata e la
      //    scheda resta sull'indirizzo chiesto, uguale ovunque.
      //  • "sito-pubblico.test" al loopback: le pagine della rete di casa non vanno
      //    ai lavori automatici col modello (#591), e chi prova quei lavori serve
      //    la pagina con un nome da internet (testServer.html(…, { pubblico: true })).
      args: [
        ...argomentiScala,
        '--host-resolver-rules=MAP blocked.test 127.0.0.1, MAP 192.168.1.1 127.0.0.1:9, MAP sito-pubblico.test 127.0.0.1',
        '.',
      ],
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
  },

  // Pagina della shell del browser (tab bar + barra indirizzi). È la prima
  // window che Filo apre.
  shell: async ({ app }, use) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await use(win);
  },

  // La vista che disegna sopra la pagina gli avvisi della barra (#588.5); nasce al primo avviso.
  // La pila nella shell è solo il modello, nascosto: quello che l'utente vede e clicca sta qui.
  avvisi: async ({ app }, use) => {
    await use(async () => {
      const scadenza = Date.now() + 10_000;
      while (Date.now() < scadenza) {
        const p = app.windows().find((w) => { try { return w.url().startsWith('filo://shell/avvisi.html'); } catch (_) { return false; } });
        if (p) return p;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('avvisi: la vista degli avvisi non è nata');
    });
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
        // La nuova scheda c'è già all'avvio: col solo nome si guiderebbe quella rimasta dietro, che l'anteprima
        // delle schede (#430) allarga e fotografa sotto quella davanti. Qui serve la scheda che l'utente ha davanti.
        page = target === 'newtab' ? await paginaDavanti(app, shell) : app.windows().find((w) => {
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
      html(body, { pubblico = false } = {}) {
        const id = String(++nextId);
        pages.set(id, body);
        return `${pubblico ? this.originPubblico : this.origin}/${id}`;
      },
      origin: `http://127.0.0.1:${port}`,
      originPubblico: `http://sito-pubblico.test:${port}`,
      // Naviga e aspetta che i content script si siano montati: il page-preload
      // imposta data-filo-ready su <html> al termine di start().
      async openReady(openTab, html, opts = {}) {
        const url = this.html(html, opts);
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
