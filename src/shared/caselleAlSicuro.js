// Caselle senza «Salva» nelle pagine filo://: quello che si scrive parte dopo una pausa, al primo segno di uscita e prima
// che la scheda si chiuda (#590.2, #590.5, #666). Non salva niente da sé: chiama chi la pagina registra.
// Regole: patterns/un-testo-scritto-in-una-casella-si-salva-da-solo-o-lo-perdi.md.

(function (global) {
  'use strict';

  // Aspetta la pausa solo chi batte un carattere: incolla, trascinamento, taglio, annulla e parola tolta col Ctrl
  // partono subito, perché chi incolla e chiude tiene il Ctrl giù da prima e alla pagina non arriva un Ctrl nuovo.
  const BATTUTA = new Set(['insertText', 'insertLineBreak', 'insertParagraph', 'insertCompositionText', 'deleteContentBackward', 'deleteContentForward']);
  const PAUSA_MS = 400;
  // Per un valore che a metà vale altro e ha effetto subito (un tetto «1» scrivendo «15»): parte quando sta fermo,
  // come la lista dei bloccati che le schede aperte seguono dopo tre secondi, o all'uscita.
  const PAUSA_LUNGA_MS = 3000;

  // `uscita` gira all'uscita vera (scheda in secondo piano, ricarica): lì si accendono gli avvisi rimasti in attesa.
  function crea(opts) {
    const uscita = opts && typeof opts.uscita === 'function' ? opts.uscita : null;
    const spedizioni = new Map();
    const daSpedire = new Set();
    let timer = null;

    // Il main sa se c'è qualcosa da spedire: chiudendo la scheda avvisa la pagina e aspetta il «niente più» (#666). Chi
    // spedisce manda il suo messaggio senza await davanti, così sullo stesso canale arriva prima di questo.
    const MSG = global.SN_MSG && global.SN_MSG.MSG;
    let segnalato = false;
    function segnala() {
      const ora = daSpedire.size > 0;
      if (ora === segnalato || !MSG || !MSG.CASELLE_IN_SOSPESO) return;
      segnalato = ora;
      try {
        const p = global.chrome.runtime.sendMessage({ type: MSG.CASELLE_IN_SOSPESO, inSospeso: ora });
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (_) {}
    }

    function parti(avvisi) {
      clearTimeout(timer);
      timer = null;
      const nomi = [...daSpedire];
      daSpedire.clear();
      for (const n of nomi) {
        const fn = spedizioni.get(n);
        if (fn) fn(avvisi);
      }
      segnala();
    }

    function cambiato(nome, e, o) {
      daSpedire.add(nome);
      segnala();
      if (e && e.inputType && !BATTUTA.has(e.inputType)) { parti(false); return; }
      clearTimeout(timer);
      timer = setTimeout(() => parti(false), (o && o.pausa) || PAUSA_MS);
    }

    function spedita(nome) {
      daSpedire.delete(nome);
      if (!daSpedire.size) { clearTimeout(timer); timer = null; }
      segnala();
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
    };
  }

  global.SN_CASELLE = { crea, BATTUTA, PAUSA_MS, PAUSA_LUNGA_MS };
})(typeof window !== 'undefined' ? window : globalThis);
