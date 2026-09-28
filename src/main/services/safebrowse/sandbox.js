// Stage 5 (detonation): apre un link sospetto in una finestra NASCOSTA e ISOLATA, segue i redirect e guarda dove finisce.
// Non blocca mai il clic, e «sembra pulito» vale poco: può solo rinforzare un sospetto. Senza Electron torna null.
// Finestre vive insieme, coda e vita massima hanno un tetto (#591): una pagina ostile non deve poterne aprire a volontà.

'use strict';

const Permessi = require('../permessiPagine');

const MAX_CONCURRENT = 2;
// Oltre questa coda un link nuovo resta senza detonation (il verdetto locale vale comunque) e lo si scrive nel log.
const MAX_QUEUE = 50;
const LOAD_TIMEOUT_MS = 9000;
// Vale anche dopo la fine del caricamento: qualunque cosa faccia la pagina, la finestra muore entro questo tempo.
const MAX_LIFETIME_MS = 15000;
// Lo svuotamento della memoria fra due controlli non deve poter tenere fermo il posto.
const CLEAR_TIMEOUT_MS = 3000;
let detonators = 0;
const wait = (ms) => new Promise((ok) => { const t = setTimeout(ok, ms); if (t && t.unref) t.unref(); });

let _electron = null;
function realElectron() {
  if (_electron === null) {
    try { _electron = require('electron'); } catch (_) { _electron = false; }
  }
  return _electron;
}

function createDetonator({
  electron = realElectron,
  maxConcurrent = MAX_CONCURRENT,
  maxQueue = MAX_QUEUE,
  loadTimeoutMs = LOAD_TIMEOUT_MS,
  maxLifetimeMs = MAX_LIFETIME_MS,
} = {}) {
  const el = () => (typeof electron === 'function' ? electron() : electron);
  let live = 0;
  const queue = [];
  // Una memoria isolata per posto, riusata e svuotata fra un controllo e l'altro: Electron non ne libera mai una creata.
  const detonatorId = ++detonators;
  const freeSlots = Array.from({ length: maxConcurrent }, (_, i) => `filo-detonate-${detonatorId}-${i}`);

  function pump() {
    while (freeSlots.length && queue.length) {
      const job = queue.shift();
      const partition = freeSlots.shift();
      live++;
      Promise.resolve()
        .then(() => runOne(job.url, job.evaluateFinal, partition))
        .catch(() => ({ result: null, cleared: null }))
        .then(({ result, cleared }) => Promise.race([Promise.resolve(cleared).catch(() => {}), wait(CLEAR_TIMEOUT_MS)])
          .then(() => {
            live--;
            freeSlots.push(partition);
            job.resolve(result);
            pump();
          }));
    }
  }

  // `evaluateFinal(finalUrl)` è iniettata: ri-valuta l'URL finale con i segnali locali.
  function detonate(url, evaluateFinal) {
    const e = el();
    if (!e || !e.BrowserWindow || !e.session) return Promise.resolve(null);
    if (queue.length >= maxQueue) {
      console.warn(`[safebrowse] coda della sandbox piena (${maxQueue}): ${url} resta col solo verdetto locale`);
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      queue.push({ url, evaluateFinal, resolve });
      pump();
    });
  }

  function runOne(url, evaluateFinal, partition) {
    const e = el();
    const ses = e.session.fromPartition(partition, { cache: false });
    // Una pagina sospetta riaperta di nascosto: nessuno può rispondere a una sua domanda, microfono e appunti compresi.
    Permessi.negaTutto(ses);

    let downloadStarted = false;
    let downloadName = '';
    const onDownload = (ev, item) => {
      downloadStarted = true;
      try { downloadName = item.getFilename(); } catch (_) {}
      ev.preventDefault(); // non scaricare davvero nulla
    };
    try { ses.on('will-download', onDownload); } catch (_) {}

    const win = new e.BrowserWindow({
      show: false,
      width: 1024,
      height: 768,
      webPreferences: {
        session: ses,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        javascript: true,
        images: false,
        webgl: false,
        // niente preload: la pagina gira nuda, isolata dall'app.
      },
    });

    const wc = win.webContents;
    const redirects = [];
    let finalUrl = url;
    let finished = false;

    let cleared = null;
    const cleanup = () => {
      try { if (!win.isDestroyed()) win.destroy(); } catch (_) {}
      try { if (typeof ses.removeListener === 'function') ses.removeListener('will-download', onDownload); } catch (_) {}
      try { cleared = Promise.resolve(ses.clearStorageData()).catch(() => {}); } catch (_) { cleared = null; }
    };

    return new Promise((resolve) => {
      let loadTimer = null;
      let lifeTimer = null;
      const done = (verdict, extra = {}) => {
        if (finished) return;
        finished = true;
        clearTimeout(loadTimer);
        clearTimeout(lifeTimer);
        cleanup();
        resolve({ result: { verdict, finalUrl, redirects, download: downloadStarted ? (downloadName || true) : false, ...extra }, cleared });
      };
      const byNow = () => (downloadStarted ? 'dangerous' : 'clean');

      loadTimer = setTimeout(() => done(byNow()), loadTimeoutMs);
      lifeTimer = setTimeout(() => done(byNow(), { expired: true }), maxLifetimeMs);

      try {
        wc.on('did-redirect-navigation', (_e, u) => { if (u) { redirects.push(u); finalUrl = u; } });
        wc.on('did-navigate', (_e, u) => { if (u) finalUrl = u; });
        wc.on('did-create-window', (child) => { try { child.destroy(); } catch (_) {} }); // niente popup
        wc.setWindowOpenHandler(() => ({ action: 'deny' }));

        wc.on('did-stop-loading', async () => {
          clearTimeout(loadTimer);
          // Download forzato → pericoloso; altrimenti conta dove porta davvero il link.
          if (downloadStarted) return done('dangerous');
          let verdict = 'clean';
          if (typeof evaluateFinal === 'function' && finalUrl && finalUrl !== url) {
            try {
              const v = await evaluateFinal(finalUrl);
              if (v && v.level === 'pericoloso') verdict = 'dangerous';
              else if (v && v.level === 'sospetto') verdict = 'suspicious';
            } catch (_) {}
          }
          done(verdict);
        });

        wc.on('did-fail-load', (_e, code) => {
          // -3 = ABORTED (spesso per un download intercettato): decidono will-download e i timer.
          if (code === -3 && downloadStarted) return;
        });

        Promise.resolve(wc.loadURL(url)).catch(() => done(byNow()));
      } catch (_) {
        if (!finished) { finished = true; clearTimeout(loadTimer); clearTimeout(lifeTimer); cleanup(); resolve({ result: null, cleared }); }
      }
    });
  }

  return { detonate, stats: () => ({ live, queued: queue.length }) };
}

const shared = createDetonator();

module.exports = {
  detonate: shared.detonate,
  stats: shared.stats,
  createDetonator,
  MAX_CONCURRENT,
  MAX_QUEUE,
  LOAD_TIMEOUT_MS,
  MAX_LIFETIME_MS,
};
