// I trascinamenti interni di Filo (#2300): il tipo `application/x-filo-<cosa>` porta solo un gettone casuale, e il
// contenuto lo tiene il main, che lo dà solo a una pagina di Filo. Un sito può scrivere il tipo ma non il gettone:
// lì il ricevitore mette a vista il testo, come per un testo qualunque. Il registro: src/main/services/trasciniInterni.js.

(function (global) {
  'use strict';

  const COSE = Object.freeze(['riferimento', 'file']);
  const tipoDi = (cosa) => `application/x-filo-${cosa}`;

  const MSG = () => (global.SN_MSG && global.SN_MSG.MSG) || {};
  function invia(m) {
    try { return Promise.resolve(global.chrome.runtime.sendMessage(m)).catch(() => null); } catch (_) { return Promise.resolve(null); }
  }

  function gettoneNuovo() {
    const c = global.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    const b = new Uint8Array(16);
    c.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  function tipi(dt) {
    try { return Array.from((dt && dt.types) || []); } catch (_) { return []; }
  }
  function leggi(dt, tipo) {
    try { return String(dt.getData(tipo) || ''); } catch (_) { return ''; }
  }

  // Al dragstart: il gettone nel tipo, il contenuto al main. Torna la consegna, che i test aspettano.
  function parte(dt, cosa, dati) {
    if (!dt || !COSE.includes(cosa)) return Promise.resolve(null);
    const gettone = gettoneNuovo();
    try { dt.setData(tipoDi(cosa), gettone); } catch (_) { return Promise.resolve(null); }
    return invia({ type: MSG().TRASCINO_INTERNO_PARTE, gettone, cosa, dati });
  }

  const porta = (dt, cosa) => tipi(dt).includes(tipoDi(cosa));

  // Al drop, dentro l'evento: dopo, il DataTransfer non si legge più. `aVista` è quello che entra nella casella se il
  // gettone non vale; `dati` dice cosa ha dato il main, null se il gettone non era suo.
  function arriva(dt, cosa) {
    const gettone = leggi(dt, tipoDi(cosa));
    const aVista = leggi(dt, 'text/plain') || gettone;
    const dati = /^[\w-]{16,64}$/.test(gettone)
      ? invia({ type: MSG().TRASCINO_INTERNO_ARRIVA, gettone, cosa }).then((r) => (r && r.ok ? r.dati : null))
      : Promise.resolve(null);
    return { aVista, dati };
  }

  // Il testo che non è stato riconosciuto entra nella casella dov'è il cursore, come lo scriverebbe il browser.
  function versa(campo, testo) {
    if (!campo || !testo) return false;
    try { campo.focus(); } catch (_) {}
    const doc = campo.ownerDocument;
    let scritto = false;
    try { scritto = doc.activeElement === campo && doc.execCommand('insertText', false, testo); } catch (_) { scritto = false; }
    if (!scritto) {
      const a = typeof campo.selectionStart === 'number' ? campo.selectionStart : campo.value.length;
      const b = typeof campo.selectionEnd === 'number' ? campo.selectionEnd : a;
      campo.value = campo.value.slice(0, a) + testo + campo.value.slice(b);
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return true;
  }

  global.SN_TRASCINO_INTERNO = { COSE, tipoDi, parte, porta, arriva, versa };
})(typeof globalThis !== 'undefined' ? globalThis : self);
