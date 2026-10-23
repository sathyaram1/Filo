// Protocollo filo://: serve pagine interne e asset dal disco (la tabella
// host → cartella sta in filoHandler). Registrato standard+secure+fetch, quindi
// non deve MAI servire un file fuori dalla root del progetto (filo://icone: dalla cartella dati).

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
        // Senza, Electron tiene la cache del codice V8 solo per http(s) e ogni pagina interna ricompila i suoi script a ogni apertura (#1091).
        codeCache: true,
      },
    },
  ]);
}

// Un segmento `..` rimasto in `rel` (path relativo già decodificato) significa
// tentativo di uscire dalla cartella attesa. Lo schema filo è "standard": il
// parser normalizza i `..` NON codificati, ma i `..` percent-encoded (%2e%2e)
// sopravvivono e ridiventano `..` solo dopo decodeURIComponent — finendo in
// path.join. Esportato per i test.
// Le pagine in pausa, Red Team (#896) e Deck builder (#1592): a chi non le vede, ogni indirizzo della loro cartella
// risponde con la sola frase. Si decide dalla cartella, non dal nome: Windows porta allo stesso file anche con altri
// nomi (`::$DATA`, nome corto). La Bacheca no: in pausa resta la parte con le segnalazioni dell'utente.
const CARTELLE_IN_PAUSA = [
  ['redteam', () => require('./services/redteamGate')],
  ['decks', () => require('./services/inPausa').cancello('mazzi')],
].map(([cartella, cancello]) => ({
  dir: path.join(SRC, 'pages', cartella) + path.sep,
  pausa: path.join(SRC, 'pages', cartella, 'pausa.html'),
  cancello,
}));

/** La pagina della pausa da servire al posto di `resolved`, o null. */
async function paginaInPausa(resolved) {
  const p = resolved.toLowerCase();
  for (const c of CARTELLE_IN_PAUSA) {
    if (!(p + path.sep).startsWith(c.dir.toLowerCase()) || p === c.pausa.toLowerCase()) continue;
    return (await c.cancello().assicura()).visible ? null : c.pausa;
  }
  return null;
}

function relIsUnsafe(rel) {
  return /(^|[\\/])\.\.([\\/]|$)/.test(String(rel || ''));
}

// Le pagine dell'owner entrate in Gestione (#1414): l'indirizzo di prima, da un link, un avviso salvato o una scheda
// riaperta, porta alla sezione. Qui e non nelle pagine: è l'unico punto da cui passano tutte le strade.
const INDIRIZZI_SPOSTATI = Object.freeze({
  'admin-defaults/admin-defaults.html': 'filo://manage/manage.html#predefiniti',
  'credits/owner.html': 'filo://manage/manage.html#utenti',
});
function indirizzoSpostato(host, rel) {
  return INDIRIZZI_SPOSTATI[`${host}/${rel || `${host}.html`}`.toLowerCase()] || null;
}

// Risolutore della richiesta filo:// → Response. Estratto come funzione pura
// così possiamo registrarlo sia sulla sessione di default sia sulle sessioni
// effimere delle finestre incognito (vedi registerFiloProtocolForSession).
async function filoHandler(request) {
  try {
    const url = new URL(request.url);
    const host = url.hostname; // shell | newtab | dashboard | history | ...
    const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''));

    if (relIsUnsafe(rel)) {
      return new Response('Forbidden', { status: 403 });
    }

    const spostato = indirizzoSpostato(host, rel);
    if (spostato) return new Response(null, { status: 302, headers: { Location: spostato } });
    // Le icone che Filo tiene per pagine salvate e schede archiviate (#1273) stanno nella cartella dati, non nel pacchetto.
    if (host === 'icone') return require('./services/copieIcone').risposta(rel);

    let fsPath;
    if (host === 'shell') {
      fsPath = path.join(SRC, 'renderer', rel || 'shell.html');
    } else if (host === 'newtab') {
      // La home sta nella cartella dashboard: «newtab.html» è il nome che la regola <host>/<host>.html delle altre
      // pagine fa scrivere, e deve aprire la home invece di un file che non c'è (#830.4).
      const home = !rel || rel.toLowerCase() === 'newtab.html';
      fsPath = path.join(SRC, 'pages', 'dashboard', home ? 'dashboard.html' : rel);
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

    const servito = (await paginaInPausa(resolved)) || resolved;
    const res = await net.fetch(pathToFileURL(servito).href);
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

// protocol.handle() globale copre solo la sessione di default: senza questa,
// nella partizione effimera dell'incognito le pagine filo:// non caricano.
function registerFiloProtocolForSession(sess) {
  try {
    sess.protocol.handle('filo', filoHandler);
  } catch (err) {
    // Lancia se 'filo' è già registrato su quella sessione: allora è già servito.
    console.warn('[Filo protocol] per-session register:', err.message || err);
  }
}

module.exports = {
  registerProtocolSchemes, registerFiloProtocol, registerFiloProtocolForSession,
  filoHandler, relIsUnsafe, FILO_PAGE_CSP, ROOT, INDIRIZZI_SPOSTATI,
};
