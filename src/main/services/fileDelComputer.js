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

// Con i privilegi di Electron su file:// una pagina locale leggerebbe con fetch ogni file del disco: nei documenti
// le richieste e i riquadri vanno solo verso il web, e il resto lo ferma la cartella concessa (servi).
const CSP_DOCUMENTO = [
  'connect-src http: https: ws: wss: data: blob:',
  'frame-src http: https: data: blob:',
  'worker-src http: https: data: blob:',
  "object-src 'none'",
].join('; ');

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
  const k = chiave(cartella);
  const fuori = [];
  for (const m of testo.matchAll(NOMINA)) {
    const valore = m.slice(1).find((v) => v != null) || '';
    for (const pezzo of /srcset/i.test(m[0]) ? valore.split(',') : [valore]) {
      const ref = pezzo.trim().split(/\s+/)[0].replace(/&amp;/g, '&');
      if (!ref || ref.startsWith('#')) continue;
      let p = null;
      try { p = percorsoDi(new URL(ref, base).href); } catch (_) {}
      if (p && dentro(k, chiave(p)) && permessoNellaCartella(k, chiave(p))) fuori.push(chiave(p));
    }
  }
  return fuori;
}

// Sotto la cartella concessa: niente cartelle e file nascosti (.git, .ssh, .env), e solo tipi da pagina, così un file
// senza estensione con dentro HTML non si apre come pagina.
function permessoNellaCartella(cartella, p) {
  const rel = path.relative(cartella, p);
  if (rel.split(/[\\/]/).some((s) => s.startsWith('.'))) return false;
  return RISORSE.has(path.extname(p).slice(1).toLowerCase());
}

function permesso(c, percorso) {
  if (!c || !percorso) return false;
  const p = chiave(percorso);
  if (c.file.has(p)) return true;
  return c.cartella != null && dentro(c.cartella, p) && permessoNellaCartella(c.cartella, p);
}

// Cosa legge la pagina del file `percorso`: la sua cartella, o in una troppo larga solo lei e i file che nomina.
function concessioneDi(percorso) {
  const cartella = path.dirname(percorso);
  const larga = cartellaTroppoLarga(cartella);
  return {
    cartella: larga ? null : chiave(cartella),
    file: new Set([chiave(percorso), ...(larga ? nominati(percorso, cartella) : [])]),
  };
}

// Ogni risposta, di qualunque tipo: un XML o un file senza estensione che Chromium riconosce come HTML eseguono script.
async function servi(partizione, req) {
  const percorso = percorsoDi(req.url);
  if (!permesso(concessioni.get(partizione), percorso)) return new Response('', { status: 403 });
  let r;
  try { r = await require('electron').net.fetch(req, { bypassCustomProtocolHandlers: true }); } catch (_) {
    return new Response('', { status: 404 });
  }
  const h = new Headers(r.headers);
  h.set('Content-Security-Policy', CSP_DOCUMENTO);
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
}

const sessioni = new Map();
function preparaSessione(partizione = PARTIZIONE) {
  if (sessioni.has(partizione)) return sessioni.get(partizione);
  const { session } = require('electron');
  const s = session.fromPartition(partizione);
  s.protocol.handle('file', (req) => servi(partizione, req));
  // Come le altre sessioni delle schede: le pagine d'errore di Filo, e le richieste che la pagina locale fa al web.
  try { require('../protocol').registerFiloProtocolForSession(s); } catch (_) {}
  try { const Cookies = require('./cookies'); Cookies.ensureRequestHook(s); Cookies.coverAdblock(s); } catch (_) {}
  sessioni.set(partizione, s);
  return s;
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
  concessioneDi, permesso, CSP_DOCUMENTO };
