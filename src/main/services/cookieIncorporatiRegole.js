// Le decisioni sui cookie dei contenuti incorporati (#758), senza Electron: chi si declassa a cookie di sessione,
// quando si cancella, quando un cookie nuovo dice che l'utente è entrato con un account.
// Il cablaggio sta in cookieIncorporati.js; le regole le tiene tests/unit/cookieIncorporati.test.mjs.

'use strict';

// Nomi che dicono un accesso. I token anti-falsificazione e i cookie di consenso o statistica nascono anche senza entrare.
const NOME_ACCESSO = /sess|auth|jwt|login|logged|oauth|passport|remember|user|account|token|(^|[^a-z])uid([^a-z]|$)|(^|[^a-z])sid([^a-z]|$)/i;
const NON_ACCESSO = /csrf|xsrf|consent|gdpr|^_ga|^_gid|^_gat|^_gcl|analytics|^__cf|cf_clearance|^_fbp$|^_hj|^__utm/i;

function nomeDiAccesso(nome) {
  const n = String(nome || '');
  return !!n && !NON_ACCESSO.test(n) && NOME_ACCESSO.test(n);
}

// Il cookie arrivato dopo la pagina di accesso dice che l'utente è entrato: un nome da sessione con un valore nuovo.
// `prima`: nome → valore quando si è vista la pagina di accesso. `forte` (la pagina aveva un campo password) ammette
// anche un cookie del server dal nome qualunque: senza, un cookie da visitatore basterebbe a dichiarare un accesso.
function segnaleDiAccesso(cookie, prima, { forte = false } = {}) {
  if (!cookie || !cookie.name || NON_ACCESSO.test(String(cookie.name))) return false;
  const vecchio = prima instanceof Map ? prima.get(cookie.name) : undefined;
  if (vecchio !== undefined && vecchio === cookie.value) return false;
  if (nomeDiAccesso(cookie.name)) return true;
  return forte && !!cookie.httpOnly && vecchio === undefined;
}

// La richiesta che porta un accesso: una scrittura verso il sito dopo che l'utente ha compilato una password nella
// pagina (`credenziali`), o la pagina di ritorno da un accesso fatto altrove (OAuth, link via email). Le richieste che
// la pagina fa da sola (statistiche in POST, chiamate con un `token`) non lo sono (#758).
const PARAM_RITORNO = ['oauth_verifier', 'ticket', 'token', 'magic', 'otp', 'login_token'];
function richiestaDiAccesso({ method, url, resourceType } = {}, { credenziali = false } = {}) {
  const m = String(method || 'GET').toUpperCase();
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') return !!credenziali;
  if (resourceType !== 'mainFrame') return false;
  let q;
  try { q = new URL(String(url || '')).searchParams; } catch (_) { return false; }
  if (q.has('code') && q.has('state')) return true;
  return PARAM_RITORNO.some((k) => q.has(k));
}

// Un Set-Cookie partizionato con una scadenza futura: il suo nome, o null. Una scadenza passata è una cancellazione,
// e senza scadenza è già di sessione.
function nomePartizionatoConScadenza(riga, ora = Date.now()) {
  const r = String(riga || '');
  if (!/;\s*partitioned\s*(;|$)/i.test(r)) return null;
  const maxAge = /;\s*max-age\s*=\s*([^;]*)/i.exec(r);
  const scade = /;\s*expires\s*=\s*([^;]*)/i.exec(r);
  if (maxAge ? !(Number(maxAge[1]) > 0) : !(scade && Date.parse(scade[1]) > ora)) return null;
  return r.split(';')[0].split('=')[0].trim() || null;
}

// `protetti`: siti con accesso e siti «resta connesso». Il sito principale di una scheda aperta non si tocca mai.
function daDeclassare({ modo, sito, ospiti, aperti, protetti }) {
  if (modo !== 'default' || !sito || !ospiti || !ospiti.size || ospiti.has(sito)) return false;
  return !aperti.has(sito) && !protetti.has(sito);
}

// Una voce (i cookie di sessione di un sito incorporato) si cancella quando né lui né i siti che lo ospitavano sono
// aperti da `margine` ms. `chiusoDa` è da quando: torna 0 se qualcuno li riapre.
function esitoVoce(voce, { aperti, protetti, ora, margine }) {
  if (!voce || protetti.has(voce.sito)) return { azione: 'dimentica', chiusoDa: 0 };
  const inUso = aperti.has(voce.sito) || [...voce.ospiti].some((o) => aperti.has(o));
  if (inUso) return { azione: 'aspetta', chiusoDa: 0 };
  const chiusoDa = voce.chiusoDa || ora;
  return { azione: ora - chiusoDa >= margine ? 'cancella' : 'aspetta', chiusoDa };
}

module.exports = { nomeDiAccesso, segnaleDiAccesso, richiestaDiAccesso, nomePartizionatoConScadenza, daDeclassare, esitoVoce };
