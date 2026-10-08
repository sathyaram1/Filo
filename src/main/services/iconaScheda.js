// Icona di una scheda: la scarica il main con la sessione della scheda e la consegna come data: URL.
// La barra non carica mai un indirizzo dichiarato da una pagina: girerebbe con i cookie, il proxy e la cache di un'altra sessione (#1083).
// Prove: tests/unit/iconaScheda.test.mjs, tests/icona-scheda-sessione.spec.mjs.

'use strict';

// Una favicon vera sta sotto i 400 KB (un .ico col 256 px non compresso): oltre, la scheda resta senza icona.
const TETTO_BYTE = 1024 * 1024;
const ATTESA_MS = 15000;
// Le icone dichiarate oltre le prime dieci non servono mai: una pagina che ne elenca mille non fa mille richieste.
const MAX_CANDIDATI = 10;

const FIRME = [
  [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png'],
  [[0xff, 0xd8, 0xff], 'image/jpeg'],
  [[0x47, 0x49, 0x46, 0x38], 'image/gif'],
  [[0x00, 0x00, 0x01, 0x00], 'image/x-icon'],
  [[0x00, 0x00, 0x02, 0x00], 'image/x-icon'],
  [[0x42, 0x4d], 'image/bmp'],
];

// Radice <svg> dopo dichiarazione, commenti e doctype: una pagina 404 con dentro un'icona svg non è un'icona.
const RADICE_SVG = /^\uFEFF?\s*(<\?xml[^>]*\?>\s*)?((<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>)\s*)*<svg[\s>]/i;

// Il tipo lo dicono i byte, non l'intestazione del server né il data: URL della pagina.
function tipoImmagine(buf) {
  if (!buf || !buf.length) return '';
  for (const [firma, tipo] of FIRME) {
    if (buf.length >= firma.length && firma.every((b, i) => buf[i] === b)) return tipo;
  }
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp' && /^avi[fs]$/.test(buf.toString('latin1', 8, 12))) return 'image/avif';
  if (RADICE_SVG.test(buf.toString('utf8', 0, Math.min(buf.length, 8192)))) return 'image/svg+xml';
  return '';
}

function bytesDaDataUrl(url) {
  const m = /^data:([^,]*),([\s\S]*)$/i.exec(String(url || ''));
  if (!m) return null;
  const grezzo = m[2].replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return /;\s*base64\s*$/i.test(m[1]) ? Buffer.from(grezzo, 'base64') : Buffer.from(grezzo, 'latin1');
}

async function scarica(ses, url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ATTESA_MS);
  try {
    const res = await ses.fetch(url, { signal: ctrl.signal, credentials: 'include', redirect: 'follow' });
    if (!res.ok || !res.body) return null;
    if (Number(res.headers.get('content-length')) > TETTO_BYTE) return null;
    const lettore = res.body.getReader();
    const pezzi = [];
    let tot = 0;
    for (;;) {
      const { done, value } = await lettore.read();
      if (done) break;
      tot += value.length;
      if (tot > TETTO_BYTE) return null;
      pezzi.push(Buffer.from(value));
    }
    return Buffer.concat(pezzi);
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
}

// Una pagina web può dichiarare come icona un indirizzo qualunque: file: e i protocolli interni non si seguono.
function bytesDi(ses, url, { interna }) {
  const schema = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase() || '';
  if (schema === 'data') return Promise.resolve(bytesDaDataUrl(url));
  if (schema === 'http' || schema === 'https' || (schema === 'filo' && interna)) return scarica(ses, url);
  return Promise.resolve(null);
}

// `candidati`: gli indirizzi di page-favicon-updated, nell'ordine della pagina. Torna il primo che è davvero un'immagine.
async function iconaPer(ses, candidati, { interna = false, vivo = () => true } = {}) {
  const lista = (Array.isArray(candidati) ? candidati : []).filter((u) => typeof u === 'string' && u).slice(0, MAX_CANDIDATI);
  for (const url of lista) {
    if (!vivo()) break;
    const buf = await bytesDi(ses, url, { interna });
    const tipo = buf && buf.length <= TETTO_BYTE ? tipoImmagine(buf) : '';
    if (tipo) return { url, dato: `data:${tipo};base64,${buf.toString('base64')}` };
  }
  return { url: '', dato: '' };
}

module.exports = { iconaPer, tipoImmagine, bytesDaDataUrl, TETTO_BYTE };
