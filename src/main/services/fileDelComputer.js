// I file del computer che si aprono in una scheda (#1905): locali, esistenti, di un tipo che la scheda mostra.
// Vivono in una sessione loro, dove una pagina locale legge solo la cartella del file aperto e non legge altri file.
// Chi può chiederli lo decide chi chiama. Regole: patterns/un-file-del-computer-in-una-scheda-vive-in-una-sessione-sua.md.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PARTIZIONE = 'file-del-computer';

// Quello che Chromium mostra da sé; il resto (Word, archivi, programmi) in una scheda diventerebbe uno scaricamento.
const VISIBILI = new Set([
  'html', 'htm', 'xhtml', 'svg', 'pdf', 'txt', 'log', 'json', 'xml',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'apng',
  'mp4', 'webm', 'ogv', 'ogg', 'mp3', 'wav', 'm4a', 'flac', 'opus',
]);

// Una pagina del computer si mostra senza rete: carica solo file della sua concessione (servi), così quello che riesce
// a leggere non ha dove andare. Niente richieste di dati, riquadri, worker né moduli inviati.
const LOCALI = 'file: data: blob:';
const CSP_DOCUMENTO = [
  "default-src 'none'",
  `script-src ${LOCALI} 'unsafe-inline' 'unsafe-eval'`,
  `style-src ${LOCALI} 'unsafe-inline'`,
  `img-src ${LOCALI}`,
  `media-src ${LOCALI}`,
  `font-src ${LOCALI}`,
  'connect-src data: blob:',
  "form-action 'none'",
].join('; ');
// Il contenuto dei file accanto resta chiuso come in un browser (tela sporca, regole CSS chiuse, errori senza testo)
// col fusibile dei privilegi file:// spento (scripts/lib/fusibili-electron.js), non con `sandbox`, che in Chromium non
// mostra più le immagini file:. `nosniff`: un .txt o un .json non gira come script né si applica come stile.
const RETE = ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'];

const fileDi = (input) => globalThis.SN_URL_NAV.fileDiQuestoComputer(input);

// Il percorso sul disco di un indirizzo file: di questo computer, o null.
function percorsoDi(input) {
  const url = fileDi(input);
  if (!url) return null;
  let p;
  try { p = decodeURIComponent(new URL(url).pathname); } catch (_) { return null; }
  if (/^\/~(?:\/|$)/.test(p)) p = path.join(os.homedir(), p.slice(2));
  else if (/^\/[a-z]:(?:\/|$)/i.test(p)) p = p.slice(1);
  if (process.platform === 'win32') p = p.replace(/\//g, '\\');
  return path.isAbsolute(p) ? path.normalize(p) : null;
}

function indirizzoDi(percorso) {
  return require('node:url').pathToFileURL(percorso).href;
}

// { ok: true, percorso, url } o { ok: false, motivo: 'rete'|'tipo'|'assente'|'cartella', percorso }.
async function giudica(input) {
  const percorso = percorsoDi(input);
  if (!percorso) return { ok: false, motivo: 'rete', percorso: String(input || '') };
  // Già lo stat contatterebbe l'altro computer (/net/<host> del Mac, unità di rete di Windows): la regola è quella di
  // comandi e documenti, non una copia.
  if (require('./documentRead').percorsoDiRete(percorso)) return { ok: false, motivo: 'rete', percorso };
  let st = null;
  try { st = await fs.promises.stat(percorso); } catch (_) {}
  if (!st) return { ok: false, motivo: 'assente', percorso };
  if (st.isDirectory()) return { ok: false, motivo: 'cartella', percorso };
  if (!VISIBILI.has(path.extname(percorso).slice(1).toLowerCase())) return { ok: false, motivo: 'tipo', percorso };
  return { ok: true, percorso, url: indirizzoDi(percorso) };
}

// Il percorso compare in quello che l'utente ha scritto, con barre di qualunque verso, %20 o spazi, «~» per la casa.
function scrittoDallUtente(percorso, parole) {
  const norma = (s) => {
    let t = String(s || '');
    try { t = decodeURIComponent(t); } catch (_) { t = t.replace(/%20/gi, ' '); }
    return t.replace(/\\/g, '/').replace(/\/{2,}/g, '/').toLowerCase();
  };
  const testo = norma(parole);
  const p = norma(percorso);
  if (!testo || !p) return false;
  const casa = norma(os.homedir());
  const forme = [p];
  if (casa && p.startsWith(`${casa}/`)) forme.push(`~${p.slice(casa.length)}`);
  return forme.some((f) => testo.includes(f));
}

// Ogni scheda di un file ha la sua sessione e la sua concessione, che si toglie quando la scheda si chiude: una pagina
// non legge le cartelle aperte da un'altra. `PARTIZIONE` da sola non concede niente.
const concessioni = new Map();
let progressivo = 0;
const chiave = (p) => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p);
const dentro = (cartella, p) => {
  const rel = path.relative(cartella, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// La cartella di casa (o una che la contiene) e la radice di un disco non si concedono intere: lì ci sono chiavi,
// profili e documenti che il file aperto non ha chiesto.
function cartellaTroppoLarga(cartella) {
  const c = chiave(cartella);
  if (path.parse(c).root === c) return true;
  const casa = chiave(path.normalize(os.homedir() || ''));
  return Boolean(casa) && dentro(c, casa);
}

// Quello che una pagina si porta dietro: immagini, stili, script, caratteri, media, altre pagine.
const RISORSE = new Set([...VISIBILI, 'css', 'js', 'mjs', 'wasm', 'webmanifest', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'map',
  'vtt', 'srt', 'jfif', 'tif', 'tiff']);
const NOMINA = /\b(?:src|href|data|poster|background|srcset|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))|url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gi;
const LETTURA_MAX = 16 * 1024 * 1024;

// I file che una pagina in una cartella troppo larga nomina accanto a sé o sotto: solo questi, oltre a lei.
function nominati(percorso, cartella) {
  if (!/^(html?|xhtml|svg|xml)$/i.test(path.extname(percorso).slice(1))) return [];
  let testo = '';
  try {
    const fd = fs.openSync(percorso, 'r');
    try {
      const buf = Buffer.alloc(Math.min(fs.fstatSync(fd).size, LETTURA_MAX));
      testo = buf.toString('utf8', 0, fs.readSync(fd, buf, 0, buf.length, 0));
    } finally { fs.closeSync(fd); }
  } catch (_) { return []; }
  const base = indirizzoDi(percorso);
  const cartelle = cartelleDi(cartella);
  const nellaCartella = (p) => cartelle.some((c) => dentro(c, p) && permessoNellaCartella(c, p));
  const fuori = [];
  for (const m of testo.matchAll(NOMINA)) {
    const valore = m.slice(1).find((v) => v != null) || '';
    for (const pezzo of /srcset/i.test(m[0]) ? valore.split(',') : [valore]) {
      const ref = pezzo.trim().split(/\s+/)[0].replace(/&amp;/g, '&');
      if (!ref || ref.startsWith('#')) continue;
      let p = null;
      try { p = percorsoDi(new URL(ref, base).href); } catch (_) {}
      if (!p) continue;
      const nome = chiave(p);
      const reale = chiave(vero(p));
      if (nellaCartella(nome) && nellaCartella(reale)) fuori.push(nome, reale);
    }
  }
  return fuori;
}

// Il percorso vero, coi collegamenti simbolici sciolti; quello dato se il file non c'è.
function vero(p) {
  try { return fs.realpathSync.native(p); } catch (_) { return p; }
}
const cartelleDi = (cartella) => [...new Set([chiave(cartella), chiave(vero(cartella))])];

// Sotto la cartella concessa: niente cartelle e file nascosti (.git, .ssh, .env), e solo tipi da pagina, così un file
// senza estensione con dentro HTML non si apre come pagina.
function permessoNellaCartella(cartella, p) {
  const rel = path.relative(cartella, p);
  if (rel.split(/[\\/]/).some((s) => s.startsWith('.'))) return false;
  return RISORSE.has(path.extname(p).slice(1).toLowerCase());
}

// Il nome e il file vero devono stare tutti e due nella concessione: un «foto.png» che punta fuori non passa.
function permesso(c, percorso) {
  if (!c || !percorso) return false;
  const ok = (p) => c.file.has(p) || c.cartelle.some((d) => dentro(d, p) && permessoNellaCartella(d, p));
  return ok(chiave(percorso)) && ok(chiave(vero(percorso)));
}

// Cosa legge la pagina del file `percorso`: la sua cartella, o in una troppo larga solo lei e i file che nomina.
// Vale il percorso vero: la cartella col nome scritto e quella dove sta davvero (/var e /private/var del Mac).
function concessioneDi(percorso) {
  const cartella = path.dirname(percorso);
  const larga = cartellaTroppoLarga(cartella) || cartellaTroppoLarga(vero(cartella));
  return {
    cartelle: larga ? [] : cartelleDi(cartella),
    file: new Set([chiave(percorso), chiave(vero(percorso)), ...(larga ? nominati(percorso, cartella) : [])]),
  };
}

// Ogni risposta, di qualunque tipo: un XML o un file senza estensione che Chromium riconosce come HTML eseguono script.
async function servi(partizione, req) {
  if (!permesso(concessioni.get(partizione), percorsoDi(req.url))) return new Response('', { status: 403 });
  let r;
  try { r = await require('electron').net.fetch(req, { bypassCustomProtocolHandlers: true }); } catch (_) {
    return new Response('', { status: 404 });
  }
  const h = new Headers(r.headers);
  h.set('Content-Security-Policy', CSP_DOCUMENTO);
  h.set('X-Content-Type-Options', 'nosniff');
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
}

const sessioni = new Map();
function preparaSessione(partizione = PARTIZIONE) {
  if (sessioni.has(partizione)) return sessioni.get(partizione);
  const { session } = require('electron');
  const s = session.fromPartition(partizione);
  s.protocol.handle('file', (req) => servi(partizione, req));
  // Le pagine d'errore di Filo, come nelle altre sessioni delle schede.
  try { require('../protocol').registerFiloProtocolForSession(s); } catch (_) {}
  // Sotto la CSP, la rete della sessione è chiusa da sé: le richieste web si annullano, e quello che la CSP non vede
  // (preconnessioni, WebRTC per TCP) trova un proxy che non risponde. Unico ascolto onBeforeRequest: nient'altro qui.
  s.webRequest.onBeforeRequest({ urls: RETE }, (_d, cb) => cb({ cancel: true }));
  s.setProxy({ proxyRules: 'http://127.0.0.1:9', proxyBypassRules: '<-loopback>' }).catch(() => {});
  sessioni.set(partizione, s);
  return s;
}

// Vero per una pagina della sessione di un file: lei e quello che apre restano senza rete, WebRTC compreso, che
// esce per UDP senza passare né dalla CSP né dal proxy (_applySecurity in tabs.js lo manda solo al proxy).
function inSessioneDiFile(wc) {
  try { return Boolean(wc && [...sessioni.values()].includes(wc.session)); } catch (_) { return false; }
}

// Da chiamare prima di caricare il file, da ogni strada che lo apre: dà la partizione della scheda nuova, o null.
function concedi(input) {
  const percorso = percorsoDi(input);
  if (!percorso || require('./documentRead').percorsoDiRete(percorso)) return null;
  progressivo += 1;
  const partizione = `${PARTIZIONE}:${progressivo}`;
  concessioni.set(partizione, concessioneDi(percorso));
  preparaSessione(partizione);
  return partizione;
}

function revoca(partizione) {
  if (partizione) concessioni.delete(partizione);
}

// Un collegamento da un file aperto a un altro che la sua scheda può leggere si segue come sul web.
function concessoDaLink(partizione, input) {
  return permesso(concessioni.get(partizione), percorsoDi(input));
}

module.exports = { PARTIZIONE, VISIBILI, percorsoDi, indirizzoDi, giudica, scrittoDallUtente, concedi, revoca, concessoDaLink, preparaSessione,
  concessioneDi, permesso, inSessioneDiFile, CSP_DOCUMENTO };
