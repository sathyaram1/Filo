// Stage 5: sandbox (detonation).
//
// Per la coda sospetta in cui la destinazione vera è incerta (redirect,
// accorciatori): apri il link in anticipo in una finestra NASCOSTA e ISOLATA,
// senza cookie né dati dell'utente, segui i redirect, esegui il JS, e osserva
// URL finale + download. Verdetto in cache (gestita da index.js).
//
// Principi (vedi spec):
//   - "sembra pulito" vale poco (gli attacchi mascherano il contenuto agli
//     scanner) → al massimo 'clean', mai una patente di sicurezza.
//   - "sembra pericoloso" è un forte rinforzo → 'dangerous'.
//   - Non bloccare MAI il click su questo controllo (è sempre async/background).
//   - Niente caccia alla perfezione anti-rilevamento.
//
// Richiede Electron (BrowserWindow/session) → funziona solo a runtime nel main.
// In ambiente senza Electron ritorna null.

'use strict';

const DETONATE_TIMEOUT_MS = 9000;

let _electron = null;
function electron() {
  if (_electron === null) {
    try { _electron = require('electron'); } catch (_) { _electron = false; }
  }
  return _electron;
}

// `evaluateFinal(finalUrl)` è iniettata: ri-valuta l'URL finale con l'engine
// (segnali locali) per capire se la destinazione vera è ingannevole.
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
    // Svuota i dati effimeri della sessione.
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
        // Verdetto: download forzato → pericoloso. Altrimenti valuta l'URL
        // finale: se la destinazione vera è impersonazione/blacklist → pericoloso.
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
