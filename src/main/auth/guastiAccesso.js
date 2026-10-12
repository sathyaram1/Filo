// Un rinnovo andato storto e un file che non si decifra non distruggono credenziali: solo un rifiuto
// definitivo del servizio dei token chiude, e i file si mettono da parte, mai cancellati (#1085).
// Regole e casi in tests/unit/guastiAccesso.test.mjs.

const fs = require('node:fs');
const path = require('node:path');

// Le sole risposte di securetoken che dicono «questa credenziale non vale più». Tutto il resto (5xx, 429,
// un proxy che risponde 403, la chiave API del progetto rifiutata) è un servizio che adesso non serve.
const RIFIUTI_DEFINITIVI = new Set(['INVALID_REFRESH_TOKEN', 'TOKEN_EXPIRED', 'USER_DISABLED', 'USER_NOT_FOUND']);

// Firebase scrive a volte «CODICE : spiegazione»: conta solo il codice.
function codiceRifiuto(testo) {
  let msg = '';
  try { msg = String(JSON.parse(String(testo || ''))?.error?.message || ''); } catch (_) { return ''; }
  return msg.trim().split(/[\s:]/)[0];
}

function rinnovoRifiutato(testo) {
  return RIFIUTI_DEFINITIVI.has(codiceRifiuto(testo));
}

// Niente «(503)» fra parentesi: chi legge lo stato HTTP dal messaggio lo scambierebbe per la risposta
// della chiamata che stava facendo (un 403 della bacheca vuol dire «scheda sparita»).
function nonRaggiungibile(status) {
  const e = new Error(`servizio di accesso non raggiungibile (HTTP ${status})`);
  e.code = 'servizio_non_raggiungibile';
  e.httpStatus = status;
  return e;
}

// Due punti e punti non stanno in un nome di file su Windows.
function timbro() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// Rinomina `file` in `file.<etichetta>`, senza mai sovrascrivere un file messo da parte prima.
function metteDaParte(file, etichetta) {
  if (!fs.existsSync(file)) return null;
  let dest = `${file}.${etichetta}`;
  for (let n = 2; fs.existsSync(dest); n++) dest = `${file}.${etichetta}-${n}`;
  try {
    fs.renameSync(file, dest);
    return dest;
  } catch (e) {
    console.warn('[auth] file non messo da parte:', file, e?.message || e);
    return null;
  }
}

// Il più recente fra i file messi da parte con quell'etichetta (il timbro ISO si ordina come testo).
function ultimoDaParte(file, etichetta) {
  const dir = path.dirname(file);
  const prefisso = `${path.basename(file)}.${etichetta}`;
  let nomi = [];
  try { nomi = fs.readdirSync(dir).filter((n) => n.startsWith(prefisso)); } catch (_) { return null; }
  nomi.sort();
  return nomi.length ? path.join(dir, nomi[nomi.length - 1]) : null;
}

module.exports = { rinnovoRifiutato, codiceRifiuto, nonRaggiungibile, timbro, metteDaParte, ultimoDaParte };
