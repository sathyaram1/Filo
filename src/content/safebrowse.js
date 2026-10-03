// Rilevamento siti pericolosi, lato pagina: manda al main l'indirizzo e gli indizi (campi password o di pagamento),
// all'apertura del documento e quando i campi compaiono. Non disegna niente: l'avviso sta in una vista sopra la
// scheda (src/main/avvisoSito.js), dove la pagina non lo sente, non lo copre e non lo cancella.

(function (global) {
  'use strict';

  const MSG = (global.SN_MSG && global.SN_MSG.MSG) || {};
  const T_GET = MSG.SAFEBROWSE_GET || 'safebrowse_get';

  const chrome = global.chrome;
  function send(msg, cb) {
    try { chrome.runtime.sendMessage(msg, cb); } catch (_) { if (cb) cb(null); }
  }

  let hintsOf = null;
  try { hintsOf = require('./safebrowseHints.js').pageHints; } catch (_) {}
  function pageHints() {
    try { if (hintsOf) return hintsOf(document); } catch (_) {}
    return { hasPassword: false, hasPayment: false };
  }

  let level = 'safe';
  let sentHints = { hasPassword: false, hasPayment: false };
  function requestVerdict() {
    const hints = pageHints();
    sentHints = hints;
    send({ type: T_GET, url: location.href, hasPassword: hints.hasPassword, hasPayment: hints.hasPayment }, (r) => {
      if (r && r.ok) level = r.level || 'safe';
    });
  }

  // Un campo password o di carta alza la gravità: va chiesto appena compare, non quando la pagina dice di aver finito.
  function hintsGrew() {
    if (sentHints.hasPassword && sentHints.hasPayment) return;
    const h = pageHints();
    if ((h.hasPassword && !sentHints.hasPassword) || (h.hasPayment && !sentHints.hasPayment)) requestVerdict();
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

  if (document.readyState === 'loading') {
    requestVerdict();
    watchLoading();
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }

  global.SN_SAFEBROWSE_UI = { requestVerdict, _state: () => level };
})(typeof globalThis !== 'undefined' ? globalThis : self);
