// Proposta «Apri da un altro paese» (content script, #151, proxy-per-tab-spec.md §5): quando il main trova un
// contenuto bloccato su una scheda con un accesso attivo non riprova da sé, lo chiede. La domanda la fa il popup
// di Filo, che su un sito sta sopra la scheda: la pagina non la vede e non la può accettare da sé (#592.6).

(function (global) {
  'use strict';

  const MSG = (global.SN_MSG && global.SN_MSG.MSG) || {};
  const T_PROPOSE = MSG.GEO_PROPOSE || 'geo_propose';
  const T_ACCEPT = MSG.GEO_PROPOSE_ACCEPT || 'geo_propose_accept';
  const T_DISMISS = MSG.GEO_PROPOSE_DISMISS || 'geo_propose_dismiss';

  let aperta = null; // AbortController della proposta a schermo

  const chrome = global.chrome;
  function send(msg, cb) {
    try { chrome.runtime.sendMessage(msg, cb); } catch (_) { if (cb) cb(null); }
  }

  function clear() {
    const a = aperta;
    aperta = null;
    if (a) a.abort();
  }

  function render(url, country, label) {
    const Ui = global.SN_CONFIRM_UI;
    if (!Ui) return;
    clear();
    const ritiro = new AbortController();
    aperta = ritiro;
    Ui.confirm({
      title: 'Questo contenuto è bloccato in Italia',
      text: `Lo apro da ${label}? In questa tab non sarai loggato.`,
      okLabel: `Apri da ${label}`,
      cancelLabel: 'No',
      segnale: ritiro.signal,
    }).then((ok) => {
      if (aperta !== ritiro) return;
      aperta = null;
      send(ok ? { type: T_ACCEPT, url, country } : { type: T_DISMISS, url });
    });
  }

  function sameHost(a, b) {
    try { return new URL(a).host === new URL(b).host; } catch (_) { return true; }
  }

  // Broadcast dal main: c'è una proposta geo-block per questa pagina.
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== T_PROPOSE) return;
      if (msg.url && !sameHost(msg.url, location.href)) return;
      render(msg.url || location.href, msg.country, msg.countryLabel || (msg.country || '').toUpperCase());
    });
  } catch (_) {}

  global.SN_GEO_PROPOSAL_UI = { render, clear };
})(typeof globalThis !== 'undefined' ? globalThis : self);
