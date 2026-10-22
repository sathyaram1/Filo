// Fixture Playwright per Filo Electron.
//
// Lancia l'app via _electron.launch e fornisce ai test:
//   - app:        l'istanza ElectronApplication
//   - shell:      Page object della shell (BrowserWindow primary)
//   - openTab:    apre una URL come nuovo tab e ritorna la Page della sua vista
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
import { rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { argomentiScala } from '../helpers/scala.mjs';
import { primaFinestra } from '../helpers/primaFinestra.mjs';
import { paginaDellaScheda } from '../helpers/schede.mjs';

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
  if (!pid) return;
  // Fuori da Windows Playwright fa di Electron il capo di un gruppo di processi: si ammazza il gruppo,
  // perché un figlio rimasto (un renderer) tiene aperte le pipe e Playwright aspetta che si chiudano.
  if (process.platform === 'win32') { try { process.kill(pid, 'SIGKILL'); } catch (_) {} }
  else { try { process.kill(-pid, 'SIGKILL'); } catch (_) { try { process.kill(pid, 'SIGKILL'); } catch (_) {} } }
}

// Una finestra arriva quando arriva: con la macchina carica ci mette più di dieci secondi (#1212). L'attesa la
// ferma il tetto del test, non un tempo suo, e il rosso dice quale finestra mancava.
export async function aspettaFinestra(app, trova, perche) {
  let win = null;
  const cerca = () => {
    win = app.windows().find((w) => { try { return trova(w); } catch (_) { return false; } }) || null;
    return Boolean(win);
  };
  await expect.poll(cerca, { message: perche, timeout: 0, intervals: [100] }).toBe(true);
  return win;
}

// Quello che l'app scrive su stdout/stderr (in test le righe render-process-gone e did-fail-load)
// Playwright non lo mostra: senza, un rosso che c'è solo in GitHub non si spiega (#639).
const TETTO_RIGHE_APP = 20_000;
function registraUsciteApp(app) {
  const righe = [];
  let perse = 0;
  const t0 = Date.now();
  const resti = { out: '', err: '' };
  const prendi = (canale) => (pezzo) => {
    const parti = (resti[canale] + pezzo.toString('utf8')).split('\n');
    resti[canale] = parti.pop();
    for (const r of parti) {
      righe.push(`+${Date.now() - t0}ms [${canale}] ${r}`);
      if (righe.length > TETTO_RIGHE_APP) { righe.shift(); perse++; }
    }
  };
  try {
    const proc = app.process();
    proc.stdout?.on('data', prendi('out'));
    proc.stderr?.on('data', prendi('err'));
  } catch (_) {}
  return () => [
    'Uscita dell\'app (stdout e stderr dal momento in cui Playwright l\'ha agganciata):',
    ...(perse ? [`… ${perse} righe più vecchie non tenute: il tetto è ${TETTO_RIGHE_APP}`] : []),
    ...righe,
    ...Object.entries(resti).filter(([, r]) => r).map(([c, r]) => `[${c}, senza a capo] ${r}`),
  ].join('\n');
}

// Chi apre Filo in una prova è già stato accolto (FILO_TEST_ACCOLTO, da playwright.config.js). Una prova
// dell'accoglienza parte dal profilo nuovo con `test.use({ accoglienzaFatta: false })`.
// `argomentiInPiu` vanno dopo la manopola della scala: una prova che fissa il suo fattore lo tiene anche con FILO_TEST_SCALE.
export const test = base.extend({
  accoglienzaFatta: [true, { option: true }],
  // La home nascosta pronta per la scheda nuova (#1128) nelle prove è spenta (playwright.config.js): chi la prova la
  // riaccende con `test.use({ riservaNuovaScheda: true })`.
  riservaNuovaScheda: [false, { option: true }],
  // Lo strato del menu del tasto destro sopra la scheda (#1053) è spento di serie: chi lo prova lo accende con
  // `test.use({ stratoDelMenu: true })`.
  stratoDelMenu: [false, { option: true }],
  argomentiInPiu: [[], { option: true }],
  // Nomi in più portati al loopback, per le prove che vogliono un sito col suo nome (example.org, #823).
  hostInPiu: [[], { option: true }],
  // Bacheca e Deck builder (#1592) sono in pausa per chi non è owner: le loro prove li trovano aperti a tutti.
  // Chi prova la pausa e l'interruttore passa `test.use({ inPausaAperte: false })`.
  inPausaAperte: [true, { option: true }],

  app: async ({ accoglienzaFatta, riservaNuovaScheda, stratoDelMenu, argomentiInPiu, hostInPiu, inPausaAperte }, use, testInfo) => {
    // Canonica, non abbreviata: vedi tests/helpers/percorsi.mjs. Da qui esce
    // anche FILO_DOWNLOAD_DIR, che gli spec degli scaricamenti confrontano con
    // il percorso che l'app riporta.
    const userData = cartellaTemporanea('filo-test-');
    if (typeof accoglienzaFatta !== 'boolean') throw new Error(`accoglienzaFatta vuole true o false, non ${JSON.stringify(accoglienzaFatta)}`);
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
        ...argomentiInPiu,
        `--host-resolver-rules=MAP blocked.test 127.0.0.1, MAP 192.168.1.1 127.0.0.1:9, MAP sito-pubblico.test 127.0.0.1${hostInPiu.map((h) => `, MAP ${h} 127.0.0.1`).join('')}`,
        '.',
      ],
      cwd: APP_ROOT,
      env: {
        ...process.env,
        FILO_USER_DATA: userData,
        FILO_TEST_ACCOLTO: accoglienzaFatta ? '1' : '0',
        ...(riservaNuovaScheda ? { FILO_RISERVA_NUOVA_SCHEDA: '1' } : {}),
        FILO_STRATO_MENU: stratoDelMenu ? '1' : '0',
        FILO_TEST_IN_PAUSA_APERTE: inPausaAperte ? '1' : '0',
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
    const usciteApp = registraUsciteApp(app);
    await use(app);
    await chiudiApp(app);
    // Dopo la chiusura, così ci sono anche le righe di un'app che muore male uscendo.
    if (testInfo.status !== testInfo.expectedStatus) {
      try {
        const file = testInfo.outputPath('uscita-app.txt');
        writeFileSync(file, usciteApp());
        await testInfo.attach('uscita-app', { path: file, contentType: 'text/plain' });
      } catch (_) {}
    }
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  },

  // Pagina della shell del browser (tab bar + barra indirizzi). È la prima
  // window che Filo apre.
  shell: async ({ app }, use) => {
    const win = await primaFinestra(app);
    await win.waitForLoadState('domcontentloaded');
    await use(win);
  },

  // La vista che disegna sopra la pagina gli avvisi della barra (#588.5); nasce al primo avviso.
  // La pila nella shell è solo il modello, nascosto: quello che l'utente vede e clicca sta qui.
  avvisi: async ({ app }, use) => {
    await use(() => aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/avvisi.html'), 'avvisi: la vista degli avvisi non è nata'));
  },

  // Apre un URL come scheda e torna la Page della scheda che Filo dice di aver aperto, arrivata sull'host chiesto: per
  // indirizzo si prendeva una scheda vecchia o una finestra nascosta sullo stesso host (#877, tests/helpers/schede.mjs).
  openTab: async ({ app, shell }, use) => {
    const fn = async (url) => {
      const target = new URL(url).hostname;
      const sulPosto = (w) => new URL(w.url()).hostname === target;
      const aperta = await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
      let page = null;
      // Nessuna scheda (indirizzo fermato, sito bloccato): resta la ricerca per host, e il rosso dice perché.
      if (!aperta?.id) page = await aspettaFinestra(app, sulPosto, `openTab: Filo non ha aperto una scheda per ${url} (${JSON.stringify(aperta)}) e nessuna finestra è su ${target}`);
      else {
        await expect.poll(async () => Boolean(page = await paginaDellaScheda(app, aperta.id, sulPosto)),
          { message: `openTab: la scheda aperta per ${url} non è arrivata su ${target}`, timeout: 0, intervals: [100] }).toBe(true);
      }
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
    // File binari serviti come li servirebbe un sito: un'immagine di prova deve
    // arrivare coi suoi byte veri, non riscritta da un data: URL.
    const assets = new Map();
    let nextId = 0;
    const server = createServer((req, res) => {
      const id = req.url.replace(/^\//, '').split('?')[0];
      const asset = assets.get(id);
      if (asset) {
        res.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': asset.body.length });
        res.end(asset.body);
        return;
      }
      const page = pages.get(id);
      if (!page) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { ...page.headers, 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page.body);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const api = {
      // `headers`: intestazioni della risposta, per i siti che le usano per stringere la pagina (CSP).
      html(body, { pubblico = false, headers = {} } = {}) {
        const id = String(++nextId);
        pages.set(id, { body, headers });
        return `${pubblico ? this.originPubblico : this.origin}/${id}`;
      },
      /** Serve dei byte a un indirizzo di questo server e torna la URL. */
      asset(body, type = 'application/octet-stream') {
        const id = `a${++nextId}`;
        assets.set(id, { body: Buffer.from(body), type });
        return `http://127.0.0.1:${port}/${id}`;
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
