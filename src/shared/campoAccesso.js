// Quali campi di un sito chiedono un'email o un nome utente, e quando proporci l'email dell'account (#1124). PURO:
// il content script ci passa il campo, il main il valore. L'email non passa mai di qui verso la pagina.
// Regole: patterns/una-conferma-su-un-sito-sta-fuori-dal-suo-documento.md

(function (global) {
  'use strict';

  const TIPI = new Set(['', 'text', 'email']);
  // Un campo che dice di volere una password, un codice o una carta non è quello dell'accesso, anche se si chiama «login».
  const AC_NO = /\b(current-password|new-password|one-time-code|cc-[a-z-]+|tel(-[a-z-]+)?)\b/;
  const AC_SI = /\b(username|email)\b/;
  const PAROLE_NOME = new Set(['email', 'mail', 'username', 'login', 'userid', 'loginid', 'utente', 'nomeutente',
    'identifier', 'loginfmt', 'usuario', 'benutzername', 'identifiant', 'courriel']);
  const PAROLE_NO = new Set(['password', 'passwd', 'pass', 'pwd', 'otp', 'code', 'codice', 'pin', 'search', 'cerca',
    'query', 'coupon', 'promo', 'captcha', 'card', 'carta', 'iban', 'cvv', 'cvc']);
  // «user» da solo dice poco: «user_name» è il nome utente, «user[first_name]» il nome di battesimo.
  const USER_NO = new Set(['first', 'last', 'given', 'family', 'surname', 'cognome', 'full', 'display', 'nick', 'phone',
    'telefono', 'mobile', 'address', 'city', 'birth', 'age', 'comment', 'message', 'bio']);
  // Nel testo che legge l'utente (etichetta, segnaposto): parole intere, in più lingue.
  const TESTO_SI = /(^|[^\p{L}])(e-?mail|username|user name|user id|nome utente|login|utente|usuario|courriel|benutzername)([^\p{L}]|$)/iu;
  const TESTO_NO = /(^|[^\p{L}])(password|codice|code|cerca|search|coupon)([^\p{L}]|$)/iu;
  const LUNGO = 200;

  const testo = (v) => (typeof v === 'string' ? v : '').slice(0, LUNGO);

  // «userEmail», «session[username_or_email]», «j_username» → parole minuscole.
  function parole(v) {
    return testo(v).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  }

  function googleAccesso(host) {
    return String(host || '').toLowerCase() === 'accounts.google.com';
  }

  /**
   * c: { tag, type, autocomplete, name, id, placeholder, ariaLabel, labelledBy, title, label, disabled, readOnly };
   * host del frame. `labelledBy` è il testo dei nodi di aria-labelledby: il nome che l'utente legge sopra il campo.
   * True se il campo chiede un'email o un nome utente.
   */
  function chiedeAccesso(c, host) {
    if (!c || String(c.tag || '').toLowerCase() !== 'input') return false;
    if (c.disabled || c.readOnly) return false;
    const tipo = String(c.type || '').toLowerCase();
    if (!TIPI.has(tipo)) return false;
    const ac = testo(c.autocomplete).toLowerCase();
    if (AC_NO.test(ac)) return false;
    if (AC_SI.test(ac) || tipo === 'email') return true;
    if (googleAccesso(host) && (c.id === 'identifierId' || c.name === 'identifier')) return true;
    const nomi = [...parole(c.name), ...parole(c.id)];
    if (nomi.some((p) => PAROLE_NO.has(p))) return false;
    if (nomi.some((p) => PAROLE_NOME.has(p))) return true;
    if (nomi.includes('user') && !nomi.some((p) => USER_NO.has(p))) return true;
    const leggibile = [c.placeholder, c.ariaLabel, c.labelledBy, c.label, c.title].map(testo).join(' · ');
    return TESTO_SI.test(leggibile) && !TESTO_NO.test(leggibile);
  }

  // Oltre questa lunghezza un valore non è l'inizio di un indirizzo.
  const VALORE_MAX = 320;

  /**
   * Si propone l'email se il campo è vuoto, o se contiene l'inizio dell'email scritto dall'utente stesso: un
   * valore messo dalla pagina non conta, se no la pagina interrogherebbe prefisso dopo prefisso (`digitato`).
   */
  function daProporre(valore, email, digitato) {
    const e = String(email || '').trim().toLowerCase();
    if (!e || typeof valore !== 'string' || valore.length > VALORE_MAX) return false;
    if (valore === '') return true;
    if (digitato !== true) return false;
    const v = valore.trim().toLowerCase();
    if (!v) return true;
    return v !== e && e.startsWith(v);
  }

  global.SN_CAMPO_ACCESSO = { chiedeAccesso, daProporre, parole, VALORE_MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.SN_CAMPO_ACCESSO;
})(typeof globalThis !== 'undefined' ? globalThis : self);
