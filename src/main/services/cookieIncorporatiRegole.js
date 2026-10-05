// Le decisioni sui cookie dei contenuti incorporati (#758), senza Electron: chi si declassa a cookie di sessione,
// quando si cancella, quando un cookie dice che l'utente è entrato con un account.
// Il cablaggio sta in cookieIncorporati.js; le regole le tiene tests/unit/cookieIncorporati.test.mjs.

'use strict';

// Nomi che dicono un accesso. I token anti-falsificazione e i cookie di consenso o statistica nascono anche senza entrare.
const NOME_ACCESSO = /sess|auth|jwt|login|logged|oauth|passport|remember|user|account|token|(^|[^a-z])uid([^a-z]|$)|sid([^a-z]|$)|^sid/i;
const NON_ACCESSO = /csrf|xsrf|consent|gdpr|^_ga|^_gid|^_gat|^_gcl|analytics|^__cf|cf_clearance|^_fbp$|^_hj|^__utm/i;

function nomeDiAccesso(nome) {
  const n = String(nome || '');
  return !!n && !NON_ACCESSO.test(n) && NOME_ACCESSO.test(n);
}

// Il cookie arrivato dopo la pagina di accesso dice che l'utente è entrato: un nome da sessione con un valore nuovo,
// o un cookie del server che prima non c'era. `prima`: nome → valore quando si è vista la pagina di accesso.
function segnaleDiAccesso(cookie, prima) {
  if (!cookie || !cookie.name || NON_ACCESSO.test(cookie.name)) return false;
  const vecchio = prima instanceof Map ? prima.get(cookie.name) : undefined;
  if (vecchio !== undefined && vecchio === cookie.value) return false;
  if (NOME_ACCESSO.test(cookie.name)) return true;
  return !!cookie.httpOnly && vecchio === undefined;
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

// Una riga Set-Cookie con scadenza diventa di sessione. Una che cancella (scadenza passata, Max-Age non positivo) resta
// com'è: senza scadenza diventerebbe un cookie vivo.
function declassaSetCookie(riga, ora) {
  const testo = String(riga || '');
  const parti = testo.split(';');
  const nome = String(parti[0] || '').split('=')[0].trim();
  let scade = false;
  let cancella = false;
  const resto = [];
  for (const p of parti.slice(1)) {
    const i = p.indexOf('=');
    const chiave = (i < 0 ? p : p.slice(0, i)).trim().toLowerCase();
    const valore = i < 0 ? '' : p.slice(i + 1).trim();
    if (chiave === 'max-age') {
      scade = true;
      if (!(Number(valore) > 0)) cancella = true;
      continue;
    }
    if (chiave === 'expires') {
      scade = true;
      const t = Date.parse(valore);
      if (!Number.isFinite(t) || t <= ora) cancella = true;
      continue;
    }
    resto.push(p);
  }
  if (!nome || !scade || cancella) return { riga: testo, nome, declassato: false };
  return { riga: [parti[0], ...resto].join(';'), nome, declassato: true };
}

module.exports = { nomeDiAccesso, segnaleDiAccesso, daDeclassare, esitoVoce, declassaSetCookie };
