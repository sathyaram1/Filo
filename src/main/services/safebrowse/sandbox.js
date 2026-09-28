// Stage 5 (detonation): apre un link sospetto in una finestra NASCOSTA e ISOLATA, segue i redirect e guarda dove finisce.
// Non blocca mai il clic, e «sembra pulito» vale poco: può solo rinforzare un sospetto. Senza Electron torna null.
// Finestre vive insieme, coda e vita massima hanno un tetto (#591): una pagina ostile non deve poterne aprire a volontà.

'use strict';

const MAX_CONCURRENT = 2;
// Oltre questa coda un link nuovo resta senza detonation (il verdetto locale vale comunque) e lo si scrive nel log.
const MAX_QUEUE = 50;
const LOAD_TIMEOUT_MS = 9000;
// Vale anche dopo la fine del caricamento: qualunque cosa faccia la pagina, la finestra muore entro questo tempo.
const MAX_LIFETIME_MS = 15000;

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

  function pump() {
    while (live < maxConcurrent && queue.length) {
      const job = queue.shift();
      live++;
      Promise.resolve()
        .then(() => runOne(job.url, job.evaluateFinal))
        .catch(() => null)
        .then((r) => {
          live--;
          job.resolve(r);
          pump();
        });
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

  function runOne(url, evaluateFinal) {
    const e = el();
    const partition = `filo-detonate-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ses = e.session.fromPartition(partition, { cache: false });

    let downloadStarted = false;
    let downloadName = '';
    try {
      ses.on('will-download', (ev, item) => {
        downloadStarted = true;
        try { downloadName = item.getFilename(); } catch (_) {}
        ev.preventDefault(); // non scaricare davvero nulla
      });
    } catch (_) {}

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

    const cleanup = () => {
      try { if (!win.isDestroyed()) win.destroy(); } catch (_) {}
      try { ses.clearStorageData().catch(() => {}); } catch (_) {}
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
        resolve({ verdict, finalUrl, redirects, download: downloadStarted ? (downloadName || true) : false, ...extra });
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
        done(null);
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
