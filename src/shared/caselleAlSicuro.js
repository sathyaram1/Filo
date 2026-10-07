// Caselle senza «Salva» nelle pagine filo://: quello che si scrive parte dopo una pausa e al primo segno di uscita,
// perché chiudere la scheda non avvisa la pagina (#590.2, #590.5). Non salva niente da sé: chiama chi la pagina registra.
// Regole: patterns/un-testo-scritto-in-una-casella-si-salva-da-solo-o-lo-perdi.md, tests/unit/caselleAlSicuro.test.mjs.

(function (global) {
  'use strict';

  // Aspetta la pausa solo chi batte un carattere: incolla, trascinamento, taglio, annulla e parola tolta col Ctrl
  // partono subito, perché chi incolla e chiude tiene il Ctrl giù da prima e alla pagina non arriva un Ctrl nuovo.
  const BATTUTA = new Set(['insertText', 'insertLineBreak', 'insertParagraph', 'insertCompositionText', 'deleteContentBackward', 'deleteContentForward']);
  const PAUSA_MS = 400;
  // Per un valore che a metà vale altro e ha effetto subito (un tetto «1» scrivendo «15»): parte quando sta fermo,
  // come la lista dei bloccati che le schede aperte seguono dopo tre secondi, o all'uscita.
  const PAUSA_LUNGA_MS = 3000;

  // Le uscite vere della pagina, una lista sola per tutte le istanze. Il `pagehide` arriva anche da
  // src/main/congedo.js prima che una scheda interna venga distrutta, cosa che da sola non avvisa nessuno.
  const alleUscite = new Set();
  function uscitaVera() {
    for (const fn of [...alleUscite]) {
      try { fn(); } catch (_) {}
    }
  }
  // Acceso alla prima casella, non al caricamento: SN_MSG può arrivare dopo questo file.
  let ascolto = false;
  function accendi() {
    if (ascolto || !global.addEventListener || !global.document) return;
    ascolto = true;
    global.addEventListener('pagehide', uscitaVera);
    // In una scheda di Filo il cambio di scheda lo annuncia il main con TAB_IN_VISTA: `document.hidden` resta falso.
    global.document.addEventListener('visibilitychange', () => {
      if (global.document.visibilityState === 'hidden') uscitaVera();
    });
    const MSG = global.SN_MSG && global.SN_MSG.MSG;
    if (MSG && global.chrome && global.chrome.runtime && global.chrome.runtime.onMessage) {
      global.chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === MSG.TAB_IN_VISTA && !msg.inVista) uscitaVera();
      });
    }
  }

  // `uscita` gira all'uscita vera (scheda in secondo piano, ricarica, chiusura): lì si accendono gli avvisi in attesa.
  // `spegni(nome)` toglie la conferma di prima appena arriva una modifica: «Salvato» non resta acceso su un testo nuovo.
  function crea(opts) {
    const uscita = opts && typeof opts.uscita === 'function' ? opts.uscita : null;
    const spegni = opts && typeof opts.spegni === 'function' ? opts.spegni : null;
    const spedizioni = new Map();
    const daSpedire = new Set();
    // Un numero per casella che cresce a ogni modifica e a ogni spedizione: la conferma di un salvataggio vale
    // solo se dopo non è cambiato niente, altrimenti «Salvato» parlerebbe di uno stato già superato.
    const giro = new Map();
    let timer = null;
    const avanza = (nome) => { const n = (giro.get(nome) || 0) + 1; giro.set(nome, n); return n; };

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

    function cambiato(nome, e, o) {
      avanza(nome);
      daSpedire.add(nome);
      if (spegni) { try { spegni(nome); } catch (_) {} }
      if (e && e.inputType && !BATTUTA.has(e.inputType)) { parti(false); return; }
      clearTimeout(timer);
      timer = setTimeout(() => parti(false), (o && o.pausa) || PAUSA_MS);
    }

    // Restituisce il biglietto da passare ad `aggiornata` quando la scrittura torna.
    function spedita(nome) {
      daSpedire.delete(nome);
      if (!daSpedire.size) { clearTimeout(timer); timer = null; }
      return avanza(nome);
    }

    function aggiornata(nome, biglietto) {
      return giro.get(nome) === biglietto && !daSpedire.has(nome);
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
    alleUscite.add(esci);
    accendi();

    return {
      registra: (nome, fn) => { spedizioni.set(nome, fn); },
      cambiato,
      spedita,
      aggiornata,
      inAttesa: (nome) => (nome ? daSpedire.has(nome) : daSpedire.size > 0),
      subito,
    };
  }

  // Un campo che si conferma quando il cursore lo lascia (una rinomina, la riga di un elenco): a metà non deve
  // partire, né al Ctrl né alla pausa, ma se la pagina sparisce prima la conferma parte lo stesso.
  function alVolo() {
    let conferma = null;
    const fine = () => { const f = conferma; conferma = null; if (f) f(); };
    return {
      scrivendo(fn) { conferma = fn; alleUscite.add(fine); accendi(); },
      confermato() { conferma = null; alleUscite.delete(fine); },
    };
  }

  global.SN_CASELLE = { crea, alVolo, BATTUTA, PAUSA_MS, PAUSA_LUNGA_MS };
})(typeof window !== 'undefined' ? window : globalThis);
