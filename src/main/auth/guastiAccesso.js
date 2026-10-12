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

// Nessun numero di stato nel testo: chi legge lo stato dal messaggio lo scambierebbe per la risposta della
// chiamata che stava facendo (un 403 in Gestione diventa «non sei amministratore»). Lo stato sta in httpStatus.
function nonRaggiungibile(status) {
  const e = new Error('il servizio di accesso non risponde adesso: riprova fra poco');
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

// I file messi da parte con quell'etichetta, dal più recente (il timbro ISO si ordina come testo).
function daParte(file, etichetta) {
  const dir = path.dirname(file);
  const prefisso = `${path.basename(file)}.${etichetta}`;
  let nomi = [];
  try { nomi = fs.readdirSync(dir).filter((n) => n.startsWith(prefisso)); } catch (_) { return []; }
  return nomi.sort().reverse().map((n) => path.join(dir, n));
}

// Tornata la chiave del sistema, la copia messa da parte che adesso si decifra torna al suo posto. Si
// provano tutte, dalla più recente: dopo un portachiavi che va e viene la più recente può essere quella
// scritta con la chiave sbagliata. `decifra(file)` → dati o null.
function riprendiDaParte(file, etichetta, decifra) {
  if (fs.existsSync(file)) return null;
  for (const vecchio of daParte(file, etichetta)) {
    const dati = decifra(vecchio);
    if (!dati) continue;
    try { fs.renameSync(vecchio, file); } catch (_) {}
    return dati;
  }
  return null;
}

// Un'uscita voluta non deve resuscitare con la chiave che torna: le copie messe da parte se ne vanno con lei.
function togliDaParte(file, etichetta) {
  for (const f of daParte(file, etichetta)) { try { fs.rmSync(f, { force: true }); } catch (_) {} }
}

module.exports = { rinnovoRifiutato, codiceRifiuto, nonRaggiungibile, timbro, metteDaParte, riprendiDaParte, togliDaParte };
