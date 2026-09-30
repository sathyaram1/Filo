// Avviso di sito pericoloso o sospetto (content script): il verdetto arriva dal main (services/safebrowse),
// la domanda la fa il popup di Filo, che su un sito sta sopra la scheda e fuori dal suo documento: la pagina
// di cui l'avviso parla non può né toglierlo né rispondere al posto dell'utente (#592.6). Non blocca la navigazione.

(function (global) {
  'use strict';

  const MSG = (global.SN_MSG && global.SN_MSG.MSG) || {};
  const T_GET = MSG.SAFEBROWSE_GET || 'safebrowse_get';
  const T_PROCEED = MSG.SAFEBROWSE_PROCEED || 'safebrowse_proceed';
  const T_DISMISS = MSG.SAFEBROWSE_DISMISS || 'safebrowse_dismiss';
  const T_UPDATE = MSG.SAFEBROWSE_UPDATE || 'safebrowse_update';

  let currentLevel = 'safe';
  let aperta = null; // { level, chiave, ritiro }
  let uscendo = false;

  const chrome = global.chrome;
  function send(msg, cb) {
    try { chrome.runtime.sendMessage(msg, cb); } catch (_) { if (cb) cb(null); }
  }

  // Indizi di pagina: la presenza di campi sensibili alza la gravità lato motore.
  let hintsOf = null;
  try { hintsOf = require('./safebrowseHints.js').pageHints; } catch (_) {}
  function pageHints() {
    try { if (hintsOf) return hintsOf(document); } catch (_) {}
    return { hasPassword: false, hasPayment: false };
  }

  function sameHost(a, b) {
    try { return new URL(a).host === new URL(b).host; } catch (_) { return true; }
  }

  try {
    global.addEventListener('beforeunload', () => { uscendo = true; }, true);
    global.addEventListener('pageshow', () => { uscendo = false; }, true);
  } catch (_) {}

  function ritira() {
    const a = aperta;
    aperta = null;
    if (a) a.ritiro.abort();
  }

  function clear() {
    currentLevel = 'safe';
    ritira();
  }

  function testi(level, message) {
    const m = message || {};
    if (level === 'pericoloso') {
      return {
        title: m.title || 'Sito pericoloso',
        text: m.body || 'Questo sito potrebbe essere una truffa o tentare di rubare i tuoi dati.',
      };
    }
    return {
      title: m.title || 'Sito potenzialmente sospetto',
      text: m.body || 'Questo sito ha alcune caratteristiche sospette. Fai attenzione ai dati che inserisci.',
    };
  }

  // «Torna indietro» non conferma MAI il sito (#288): senza una pagina prima si esce e basta.
  function tornaIndietro(level, url, message) {
    try {
      if (history.length > 1) history.back();
      else if (level === 'sospetto') send({ type: T_DISMISS, url }, () => location.replace('about:blank'));
      else location.replace('about:blank');
    } catch (_) {}
    // Un «indietro» che resta in questo documento (voci aggiunte dalla pagina) non la lascia scoperta.
    setTimeout(() => {
      if (!uscendo && !aperta && currentLevel === level) chiedi(level, url, message);
    }, 1000);
  }

  function chiedi(level, url, message) {
    const Ui = global.SN_CONFIRM_UI;
    if (!Ui) return;
    ritira();
    const t = testi(level, message);
    const voce = { level, chiave: `${level}\n${t.title}\n${t.text}`, ritiro: new AbortController() };
    aperta = voce;
    const pericoloso = level === 'pericoloso';
    const opts = {
      ...t,
      okLabel: pericoloso ? 'Procedi comunque' : 'Continua',
      cancelLabel: 'Torna indietro',
      coprePagina: true,
      segnale: voce.ritiro.signal,
    };
    const domanda = pericoloso ? Ui.confirmTyped({ ...opts, word: 'confermo', reversibile: true }) : Ui.confirm(opts);
    domanda.then((ok) => {
      if (aperta !== voce) return;
      aperta = null;
      if (ok) {
        currentLevel = 'safe';
        send({ type: pericoloso ? T_PROCEED : T_DISMISS, url });
      } else {
        tornaIndietro(level, url, message);
      }
    });
  }

  function render(level, message, url) {
    const u = url || location.href;
    if (level !== 'pericoloso' && level !== 'sospetto') { clear(); return; }
    currentLevel = level;
    const t = testi(level, message);
    if (aperta && aperta.chiave === `${level}\n${t.title}\n${t.text}`) return;
    chiedi(level, u, message);
  }

  function requestVerdict() {
    const hints = pageHints();
    send({ type: T_GET, url: location.href, hasPassword: hints.hasPassword, hasPayment: hints.hasPayment }, (r) => {
      if (r && r.ok) render(r.level, r.message);
    });
  }

  // Broadcast dal main: il verdetto per la URL è cambiato.
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== T_UPDATE) return;
      if (msg.url && !sameHost(msg.url, location.href)) return;
      render(msg.level, msg.message, msg.url);
    });
  } catch (_) {}

  function start() {
    requestVerdict();
    // Ricontrolla dopo un attimo: alcuni siti montano i campi password/pagamento
    // via JS dopo il primo paint, alzando la gravità del verdetto.
    setTimeout(() => { if (currentLevel === 'safe') requestVerdict(); }, 1600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  global.SN_SAFEBROWSE_UI = { render, requestVerdict, clear, _state: () => currentLevel };
})(typeof globalThis !== 'undefined' ? globalThis : self);
