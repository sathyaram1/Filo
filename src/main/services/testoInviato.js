'use strict';

// Il testo che una richiesta porta, ridotto a lettere e cifre minuscole dopo averlo tolto dalle forme
// in cui i siti lo scrivono (indirizzo, modulo, JSON, HTML, Markdown): il content script ci cerca le
// righe dell'utente (#824). Logica pura; chi la usa è src/main/tabs.js. Sentinella: tests/unit/testoInviato.test.mjs.

// Oltre si legge l'inizio: una riga che sta più in là resta protetta, e il processo principale non si ferma.
const LIMITE_CORPO = 256 * 1024;
const SEPARATORE = '\u0001';

// La stessa riduzione la fa il content script sulle righe dell'utente.
const essenziale = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '');

function decodificaPercento(s) {
  return String(s).replace(/\+/g, ' ').replace(/(?:%[0-9a-fA-F]{2})+/g, (m) => {
    try { return decodeURIComponent(m); } catch (_) { return m; }
  });
}

const ESCAPE_JSON = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
function sciogliJson(s) {
  return String(s).replace(/\\(u[0-9a-fA-F]{4}|["\\/bfnrt])/g, (_, e) => (
    e.length === 5 ? String.fromCharCode(parseInt(e.slice(1), 16)) : ESCAPE_JSON[e]));
}

// Gli editor classici scrivono le lettere accentate per nome (&egrave;).
const ENTITA = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', szlig: 'ß', aelig: 'æ', oslash: 'ø' };
const SEGNI = { grave: '̀', acute: '́', circ: '̂', tilde: '̃', uml: '̈', ring: '̊', cedil: '̧' };
function entita(nome) {
  if (ENTITA[nome.toLowerCase()]) return ENTITA[nome.toLowerCase()];
  const m = /^([a-zA-Z])(grave|acute|circ|tilde|uml|ring|cedil)$/.exec(nome);
  return m ? (m[1] + SEGNI[m[2]]).normalize('NFC') : null;
}
function soloTesto(s) {
  return String(s).replace(/<[^<>]*>/g, ' ').replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return entita(e) ?? m;
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try { return String.fromCodePoint(n); } catch (_) { return m; }
  });
}

// I primi LIMITE_CORPO byte, copiati: la richiesta si legge solo quando il sito ha risposto.
// Un corpo binario (un file, una foto) non porta testo da cercare.
function corpoDa(uploadData) {
  const pezzi = [];
  let n = 0;
  for (const parte of Array.isArray(uploadData) ? uploadData : []) {
    const b = parte && parte.bytes;
    if (!b || !b.length || n >= LIMITE_CORPO) continue;
    const quanto = Math.min(b.length, LIMITE_CORPO - n);
    pezzi.push(Buffer.from((Buffer.isBuffer(b) ? b : Buffer.from(b)).subarray(0, quanto)));
    n += quanto;
  }
  const tutto = Buffer.concat(pezzi);
  return tutto.subarray(0, 1024).includes(0) ? Buffer.alloc(0) : tutto;
}

// '' se la richiesta non porta testo. `corpo` è quello di corpoDa.
function testoDellaRichiesta({ url = '', corpo } = {}) {
  let indirizzo = '';
  try { const u = new URL(url); indirizzo = u.pathname + u.search; } catch (_) {}
  const sciolto = sciogliJson(decodificaPercento(`${indirizzo}\n${corpo ? corpo.toString('utf8') : ''}`));
  // Con i segnaposto delle etichette e senza: un «<» scritto dall'utente non è un'etichetta.
  const forme = new Set([essenziale(sciolto), essenziale(soloTesto(sciolto))]);
  forme.delete('');
  return [...forme].join(SEPARATORE);
}

module.exports = { testoDellaRichiesta, corpoDa, essenziale, LIMITE_CORPO };
