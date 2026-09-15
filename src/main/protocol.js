// Protocollo filo://: serve pagine interne e asset dal disco (la tabella
// host → cartella sta in filoHandler). Registrato standard+secure+fetch, quindi
// non deve MAI servire un file fuori dalla root del progetto.

const { protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const ASSETS = path.join(ROOT, 'assets');

// CSP applicata ai soli documenti HTML serviti via filo:// (vedi filoHandler).
const FILO_PAGE_CSP = [
  "default-src 'self' filo:",
  "script-src 'self' filo:",
  "style-src 'self' filo: 'unsafe-inline'",
  "img-src 'self' filo: data: blob: https:",
  "media-src 'self' filo: data: blob: https:",
  "font-src 'self' filo: data:",
  "connect-src 'self' filo: https: data: blob:",
  "frame-src 'self' filo: https:",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

function registerProtocolSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'filo',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

// Il parser dello schema normalizza i `..` in chiaro, ma quelli percent-encoded
// (%2e%2e) ridiventano `..` dopo decodeURIComponent e arrivano a path.join.
function relIsUnsafe(rel) {
  return /(^|[\\/])\.\.([\\/]|$)/.test(String(rel || ''));
}

// Funzione a sé perché va registrata sia sulla sessione di default sia su
// quelle effimere delle finestre incognito.
async function filoHandler(request) {
  try {
    const url = new URL(request.url);
    const host = url.hostname; // shell | newtab | dashboard | history | ...
    const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''));

    if (relIsUnsafe(rel)) {
      return new Response('Forbidden', { status: 403 });
    }

    let fsPath;
    if (host === 'shell') {
      fsPath = path.join(SRC, 'renderer', rel || 'shell.html');
    } else if (host === 'newtab') {
      fsPath = path.join(SRC, 'pages', 'dashboard', rel || 'dashboard.html');
    } else if (host === 'asset') {
      fsPath = path.join(ASSETS, rel);
    } else if (host === 'style') {
      fsPath = path.join(SRC, 'styles', rel);
    } else if (host === 'shared') {
      fsPath = path.join(SRC, 'shared', rel);
    } else if (host === 'src') {
      // Il codice portato chiama chrome.runtime.getURL('src/...') e lo shim
      // costruisce filo://src/..., che atterra qui.
      fsPath = path.join(SRC, rel);
    } else {
      // filo://<page>/<file?> → src/pages/<page>/<file or page.html>
      fsPath = path.join(SRC, 'pages', host, rel || `${host}.html`);
    }

    // Il confine include il separatore: senza, una cartella sorella che inizia
    // con la stessa stringa ("Filo-altro" accanto a "Filo") passerebbe.
    const resolved = path.resolve(fsPath);
    if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }

    const res = await net.fetch(pathToFileURL(resolved).href);
    // CSP solo per i documenti HTML (le pagine privilegiate filo://): rete di
    // sicurezza contro un eventuale XSS futuro su una pagina che ha accesso a
    // storage + shellExec. Oggi nessun XSS sfruttabile (gli innerHTML esaminati
    // escapano a monte), ma se in futuro un sink non escapato venisse introdotto,
    // questa CSP impedisce l'esecuzione di script inline/eval iniettati.
    //   - script-src 'self' filo:  → niente inline/eval; copre tutti gli host
    //     filo:// (shared/shell/<page>). Verificato: nessun <script> inline,
    //     nessun eval/new Function, nessun handler on*= nelle pagine.
    //   - style-src include 'unsafe-inline' perché le pagine usano attributi
    //     style= e stili dinamici (non un vettore di esecuzione codice).
    //   - img/media/connect permissivi (https:, data:, blob:) per non rompere
    //     favicon, anteprime e risorse caricate dalle pagine.
    const ct = res.headers.get('content-type') || '';
    if (/text\/html/i.test(ct)) {
      const headers = new Headers(res.headers);
      headers.set('Content-Security-Policy', FILO_PAGE_CSP);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }
    return res;
  } catch (err) {
    return new Response('Filo protocol error: ' + (err.message || err), { status: 500 });
  }
}

async function registerFiloProtocol() {
  protocol.handle('filo', filoHandler);
}

// Registra filo:// su una sessione specifica. protocol.handle() globale copre
// solo la sessione di default; le finestre incognito usano una partizione
// effimera propria (session.fromPartition senza 'persist:'), e senza questa
// registrazione le pagine interne filo:// non caricherebbero lì.
function registerFiloProtocolForSession(sess) {
  try {
    sess.protocol.handle('filo', filoHandler);
  } catch (err) {
    // handle() lancia se 'filo' è già registrato su quella sessione: ok,
    // significa che è già servito (es. doppia init).
    console.warn('[Filo protocol] per-session register:', err.message || err);
  }
}

module.exports = {
  registerProtocolSchemes, registerFiloProtocol, registerFiloProtocolForSession,
  filoHandler, relIsUnsafe, FILO_PAGE_CSP, ROOT,
};
