// Rilevamento siti pericolosi, lato pagina: manda al main l'indirizzo e gli indizi (campi password o di pagamento)
// quando compaiono, e avvisa quando l'utente scrive una password (accessi, #758). Non disegna niente: l'avviso sta in
// una vista sopra la scheda (src/main/avvisoSito.js), dove la pagina non lo sente, non lo copre e non lo cancella.

(function (global) {
  'use strict';

  const MSG = (global.SN_MSG && global.SN_MSG.MSG) || {};
  const T_GET = MSG.SAFEBROWSE_GET || 'safebrowse_get';
  const T_CAMPI = MSG.CAMPI_DELICATI || 'campi_delicati';

  const chrome = global.chrome;
  function send(msg, cb) {
    try { chrome.runtime.sendMessage(msg, cb); } catch (_) { if (cb) cb(null); }
  }

  let hintsOf = null;
  try { hintsOf = require('./safebrowseHints.js').pageHints; } catch (_) {}
  function pageHints() {
    try { if (hintsOf) return hintsOf(document); } catch (_) {}
    return { hasPassword: false, hasPayment: false, shownPassword: false, shownPayment: false, insecureForm: false };
  }

  // Un campo password o carta a schermo rende delicato il sito (#1004): uno solo nascosto nel codice no. Si dice una volta.
  let campiDetti = false;
  function campiMostrati(h) {
    if (campiDetti || !h || !(h.shownPassword || h.shownPayment)) return;
    campiDetti = true;
    send({ type: T_CAMPI, hasPassword: !!h.shownPassword, hasPayment: !!h.shownPayment });
  }

  let level = 'safe';
  let sentHints = { shownPassword: false, shownPayment: false, insecureForm: false };
  function requestVerdict() {
    const hints = pageHints();
    sentHints = hints;
    campiMostrati(hints);
    send({ type: T_GET, url: location.href, hasPassword: hints.shownPassword, hasPayment: hints.shownPayment, insecureForm: hints.insecureForm }, (r) => {
      if (r && r.ok) level = r.level || 'safe';
    });
  }

  // Un campo password o di carta, o il suo modulo che li manda in chiaro, alza la gravità: va chiesto appena compare,
  // non quando la pagina dice di aver finito.
  function hintsGrew() {
    if (sentHints.shownPassword && sentHints.shownPayment && sentHints.insecureForm && campiDetti) return;
    const h = pageHints();
    campiMostrati(h);
    if (['shownPassword', 'shownPayment', 'insecureForm'].some((k) => h[k] && !sentHints[k])) requestVerdict();
  }

  // Finché il parser lavora i campi sensibili si guardano a ogni pezzo di pagina (al più ogni 200 ms).
  function watchLoading() {
    if (typeof MutationObserver !== 'function') return;
    let timer = null;
    const mo = new MutationObserver(() => {
      if (!timer) timer = setTimeout(() => { timer = null; hintsGrew(); }, 200);
    });
    try { mo.observe(document, { childList: true, subtree: true }); } catch (_) { return; }
    document.addEventListener('DOMContentLoaded', () => { mo.disconnect(); clearTimeout(timer); }, { once: true });
  }

  function onReady() {
    requestVerdict();
    // Alcuni siti montano i campi password o di pagamento via JS dopo il primo disegno.
    setTimeout(() => { if (level === 'safe') requestVerdict(); }, 1600);
  }

  // Il campo che compare dopo, in una finestrella di accesso aperta da un clic, si vede quando ci si entra.
  document.addEventListener('focusin', (e) => {
    if (e.target && e.target.tagName === 'INPUT') hintsGrew();
  }, true);

  // #758 — un accesso vale solo dopo una password scritta dall'utente: gli eventi creati da uno script della pagina
  // (isTrusted falso) non contano. Il main lega l'avviso alla richiesta che segue.
  const T_CRED = MSG.ACCESSO_CREDENZIALI || 'accesso_credenziali';
  let credenzialiAt = 0;
  function passwordScritta(e) {
    const t = e.composedPath ? e.composedPath()[0] : e.target;
    if (t && t.type === 'password' && t.value) return true;
    if (e.type === 'input') return false;
    try { for (const el of document.querySelectorAll('input[type="password"]')) if (el.value) return true; } catch (_) {}
    return false;
  }
  function forseCredenziali(e) {
    if (!e || !e.isTrusted) return;
    if (e.type === 'keydown' && e.key !== 'Enter') return;
    if (Date.now() - credenzialiAt < 5000 || !passwordScritta(e)) return;
    credenzialiAt = Date.now();
    send({ type: T_CRED });
  }
  for (const t of ['input', 'submit', 'click', 'keydown']) {
    try { document.addEventListener(t, forseCredenziali, true); } catch (_) {}
  }

  if (document.readyState === 'loading') {
    requestVerdict();
    watchLoading();
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
