// Detonation: per la coda sospetta con destinazione incerta il link si apre prima in una
// finestra nascosta e isolata, senza dati dell'utente, per vedere URL finale e download.
// «Sembra pulito» vale poco: al massimo 'clean'. Non blocca mai il click.

'use strict';

const DETONATE_TIMEOUT_MS = 9000;

let _electron = null;
function electron() {
  if (_electron === null) {
    try { _electron = require('electron'); } catch (_) { _electron = false; }
  }
  return _electron;
}

// `evaluateFinal` è iniettata: ri-valuta l'URL finale per capire se la destinazione vera è
// ingannevole.
async function detonate(url, evaluateFinal) {
  const el = electron();
  if (!el || !el.BrowserWindow || !el.session) return null;

  const partition = `filo-detonate-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ses = el.session.fromPartition(partition, { cache: false });

  let downloadStarted = false;
  let downloadName = '';
  try {
    ses.on('will-download', (e, item) => {
      downloadStarted = true;
      try { downloadName = item.getFilename(); } catch (_) {}
      e.preventDefault(); // non scaricare davvero nulla
    });
  } catch (_) {}

  const win = new el.BrowserWindow({
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

  return await new Promise((resolve) => {
    const done = (verdict, extra = {}) => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve({ verdict, finalUrl, redirects, download: downloadStarted ? (downloadName || true) : false, ...extra });
    };

    const timer = setTimeout(() => done(downloadStarted ? 'dangerous' : 'clean'), DETONATE_TIMEOUT_MS);

    try {
      wc.on('did-redirect-navigation', (_e, u) => { if (u) { redirects.push(u); finalUrl = u; } });
      wc.on('did-navigate', (_e, u) => { if (u) finalUrl = u; });
      wc.on('did-create-window', (child) => { try { child.destroy(); } catch (_) {} }); // niente popup
      wc.setWindowOpenHandler(() => ({ action: 'deny' }));

      wc.on('did-stop-loading', async () => {
        clearTimeout(timer);
        // Download forzato → pericoloso. Altrimenti decide la destinazione vera dell'URL finale.
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
        // -3 = ABORTED (spesso per un download intercettato): non è un errore.
        if (code === -3 && downloadStarted) return; // lascia decidere will-download/timer
      });

      wc.loadURL(url).catch(() => done(downloadStarted ? 'dangerous' : 'clean'));
    } catch (_) {
      clearTimeout(timer);
      done(null);
    }
  });
}

module.exports = { detonate };
