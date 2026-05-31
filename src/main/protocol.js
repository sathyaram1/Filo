// Protocollo filo:// — serve pagine interne e asset.
//
// URL schema:
//   filo://shell/<file>          → src/renderer/<file>   (chrome del browser)
//   filo://newtab/                → src/pages/dashboard/dashboard.html
//   filo://<page>/<file?>         → src/pages/<page>/<file or page.html>
//   filo://asset/<path>           → assets/<path>
//   filo://style/<file>           → src/styles/<file>
//   filo://shared/<file>          → src/shared/<file>
//
// Privilegi: il protocollo è registrato come "standard, secure, supportsFetchAPI"
// così la fetch() funziona e le politiche CORS sono ragionevoli.

const { protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const ASSETS = path.join(ROOT, 'assets');

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

// Risolutore della richiesta filo:// → Response. Estratto come funzione pura
// così possiamo registrarlo sia sulla sessione di default sia sulle sessioni
// effimere delle finestre incognito (vedi registerFiloProtocolForSession).
async function filoHandler(request) {
  try {
    const url = new URL(request.url);
    const host = url.hostname; // shell | newtab | dashboard | history | ...
    const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''));

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
      // Passthrough per i casi legacy in cui il codice estensione
      // chiama chrome.runtime.getURL('src/pages/X/Y.html'): lo shim
      // costruisce filo://src/pages/X/Y.html e atterriamo qui.
      fsPath = path.join(SRC, rel);
    } else {
      // filo://<page>/<file?> → src/pages/<page>/<file or page.html>
      fsPath = path.join(SRC, 'pages', host, rel || `${host}.html`);
    }

    // Sicurezza: non lasciare uscire dalla root del progetto.
    const resolved = path.resolve(fsPath);
    if (!resolved.startsWith(ROOT)) {
      return new Response('Forbidden', { status: 403 });
    }

    return net.fetch(pathToFileURL(resolved).href);
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

module.exports = { registerProtocolSchemes, registerFiloProtocol, registerFiloProtocolForSession };
