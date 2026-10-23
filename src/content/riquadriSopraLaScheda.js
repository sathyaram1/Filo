// Su un sito i riquadri di Filo (spiegazione, Modifica, feedback, attacco red-team) non entrano nel suo documento: li
// apre il main nello strato sopra la scheda (#1509.1). Qui si chiede l'apertura e si fa sulla pagina quello che il
// riquadro decide (Sostituisci). Regole: patterns/i-riquadri-di-filo-su-un-sito-stanno-sopra-la-scheda.md

(function (global) {
  'use strict';

  const MSG = (global.SN_MSG && global.SN_MSG.MSG) || {};
  const inPaginaDiFilo = (() => { try { return location.protocol === 'filo:'; } catch (_) { return false; } })();
  // Quello che la Modifica sostituirà, per riquadro: il campo e la selezione di quando è stata chiesta.
  const sostituzioni = new Map();
  const SOSTITUZIONI_MAX = 20;

  // `apri(tipo, dati, ripiego)`: false sulle pagine di Filo, dove il riquadro resta nel documento. Se lo strato non si
  // può fare (una finestra che non ne ha), il riquadro si apre col ripiego, nel documento come prima; una richiesta
  // troppo grossa per lo strato lo dice col numero, invece di aprirsi dove il sito la legge.
  function apri(tipo, dati, ripiego) {
    if (inPaginaDiFilo || !MSG.RIQUADRO_APRI || !global.chrome?.runtime?.sendMessage) return false;
    const conSostituzione = tipo === 'modifica' && dati && dati.contesto;
    const richiesta = { type: MSG.RIQUADRO_APRI, tipo, dati: { ...dati, contesto: undefined } };
    Promise.resolve(global.chrome.runtime.sendMessage(richiesta)).then((r) => {
      if (r && r.ok) {
        if (conSostituzione && r.id) {
          sostituzioni.set(r.id, dati.contesto);
          while (sostituzioni.size > SOSTITUZIONI_MAX) sostituzioni.delete(sostituzioni.keys().next().value);
        }
        return;
      }
      if (r && r.error === 'troppo') {
        const mb = Math.round((Number(r.limite) || 0) / (1024 * 1024));
        global.SN_POPUP?.showToast?.(`Il testo è troppo lungo per aprirlo in un riquadro: il massimo è ${mb} MB.`);
        return;
      }
      if (typeof ripiego === 'function') ripiego();
    }, () => { if (typeof ripiego === 'function') ripiego(); });
    return true;
  }

  try {
    global.chrome?.runtime?.onMessage?.addListener((m) => {
      if (!m || m.type !== MSG.RIQUADRO_SOSTITUISCI) return;
      const ctx = sostituzioni.get(m.id);
      if (!ctx) return;
      sostituzioni.delete(m.id);
      try { global.SN_EDITBOX?.sostituisci?.(ctx, String(m.testo || '')); } catch (e) { console.error('[Filo] Sostituisci', e); }
    });
  } catch (_) {}

  global.SN_RIQUADRI_SOPRA = { apri };
})(typeof globalThis !== 'undefined' ? globalThis : self);
