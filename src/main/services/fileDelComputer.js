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

// Le cartelle dei file aperti: lì la pagina locale prende immagini, stili e script suoi.
const cartelle = new Set();
const chiave = (p) => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p);

function dentroConcesse(percorso) {
  if (!percorso) return false;
  const p = chiave(percorso);
  for (const c of cartelle) {
    const rel = path.relative(c, p);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return true;
  }
  return false;
}

async function servi(req) {
  const percorso = percorsoDi(req.url);
  if (!percorso || !dentroConcesse(percorso)) return new Response('', { status: 403 });
  let r;
  try { r = await require('electron').net.fetch(req, { bypassCustomProtocolHandlers: true }); } catch (_) {
    return new Response('', { status: 404 });
  }
  const tipo = String(r.headers.get('content-type') || '').toLowerCase();
  if (!/^(text\/html|application\/xhtml\+xml|image\/svg\+xml)/.test(tipo)) return r;
  const h = new Headers(r.headers);
  h.set('Content-Security-Policy', CSP_DOCUMENTO);
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
}

let sessione = null;
function preparaSessione() {
  if (sessione) return sessione;
  const { session } = require('electron');
  sessione = session.fromPartition(PARTIZIONE);
  sessione.protocol.handle('file', servi);
  return sessione;
}

// Da chiamare prima di caricare il file: apre la sua cartella alla pagina.
function concedi(input) {
  const percorso = percorsoDi(input);
  if (!percorso) return false;
  preparaSessione();
  cartelle.add(chiave(path.dirname(percorso)));
  return true;
}

// Un collegamento da un file aperto a un altro della stessa cartella si segue come sul web.
function concessoDaLink(input) {
  return dentroConcesse(percorsoDi(input));
}

module.exports = { PARTIZIONE, VISIBILI, percorsoDi, indirizzoDi, giudica, scrittoDallUtente, concedi, concessoDaLink, preparaSessione };
