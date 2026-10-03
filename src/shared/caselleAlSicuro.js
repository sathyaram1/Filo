// Caselle senza «Salva» nelle pagine filo://: quello che si scrive parte dopo una pausa e al primo segno di uscita,
// perché chiudere la scheda non avvisa la pagina (#590.2, #590.5). Non salva niente da sé: chiama chi la pagina registra.
// Regole: patterns/un-testo-scritto-in-una-casella-si-salva-da-solo-o-lo-perdi.md.

(function (global) {
  'use strict';

  // Aspetta la pausa solo chi batte un carattere: incolla, trascinamento, taglio, annulla e parola tolta col Ctrl
  // partono subito, perché chi incolla e chiude tiene il Ctrl giù da prima e alla pagina non arriva un Ctrl nuovo.
  const BATTUTA = new Set(['insertText', 'insertLineBreak', 'insertParagraph', 'insertCompositionText', 'deleteContentBackward', 'deleteContentForward']);
  const PAUSA_MS = 400;

  // `uscita` gira all'uscita vera (scheda in secondo piano, ricarica): lì si accendono gli avvisi rimasti in attesa.
  function crea(opts) {
    const uscita = opts && typeof opts.uscita === 'function' ? opts.uscita : null;
    const spedizioni = new Map();
    const daSpedire = new Set();
    let timer = null;

    function parti(avvisi) {
      clearTimeout(timer);
      timer = null;
      const nomi = [...daSpedire];
      daSpedire.clear();
      for (const n of nomi) {
        const fn = spedizioni.get(n);
        if (fn) fn(avvisi);
      }
    }

    // `pausa: false` per un valore che a metà vale altro e ha effetto subito: parte solo all'uscita.
    function cambiato(nome, e, o) {
      daSpedire.add(nome);
      if (e && e.inputType && !BATTUTA.has(e.inputType)) { parti(false); return; }
      if (o && o.pausa === false) return;
      clearTimeout(timer);
      timer = setTimeout(() => parti(false), PAUSA_MS);
    }

    function spedita(nome) {
      daSpedire.delete(nome);
      if (!daSpedire.size) { clearTimeout(timer); timer = null; }
    }

    function subito(avvisi) {
      if (daSpedire.size) parti(avvisi);
    }

    function esci() {
      parti(true);
      if (uscita) uscita();
    }

    // Il fuoco esce anche per un menu del tasto destro: si salva, ma gli avvisi aspettano l'uscita vera.
    global.addEventListener('blur', () => subito(false));
    // Ctrl, Cmd o Alt da soli arrivano alla pagina prima della lettera di Ctrl+W, Ctrl+Tab o Alt+cifra, che il main si tiene.
    global.document.addEventListener('keydown', (e) => {
      if (e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt') subito(false);
    }, true);
    // In una scheda di Filo il cambio di scheda lo annuncia il main con TAB_IN_VISTA: `document.hidden` resta falso.
    global.document.addEventListener('visibilitychange', () => {
      if (global.document.visibilityState === 'hidden') esci();
    });
    const MSG = global.SN_MSG && global.SN_MSG.MSG;
    if (MSG && global.chrome && global.chrome.runtime && global.chrome.runtime.onMessage) {
      global.chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === MSG.TAB_IN_VISTA && !msg.inVista) esci();
      });
    }

    return {
      registra: (nome, fn) => { spedizioni.set(nome, fn); },
      cambiato,
      spedita,
      subito,
      inSospeso: (nome) => (nome ? daSpedire.has(nome) : daSpedire.size > 0),
    };
  }

  global.SN_CASELLE = { crea, BATTUTA, PAUSA_MS };
})(typeof window !== 'undefined' ? window : globalThis);
