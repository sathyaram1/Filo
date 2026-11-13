// Il testo di altri in una casella dove si scrive a Filo (#1840): incollato, trascinato, o riportato con Annulla o
// Ripeti dopo essere stato svuotato. Una regola sola per la chat della home e per l'Aiuto; il main lo conta come lettura.
// Sentinella: tests/unit/testoDiAltri.test.mjs.

(function (global) {
  'use strict';

  // Si tengono le impronte, non i testi; un'impronta uguale per caso chiede di più, mai di meno.
  function impronta(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return `${s.length}:${h >>> 0}`;
  }

  // Una casella: `dopoInput` dà il segno nuovo dopo un evento `input`, `ricorda` tiene un testo entrato da fuori per
  // altre strade (un trascinamento interno, un comando rimesso nella barra). Oltre il tetto si scordano i più vecchi.
  function crea({ tetto = 2000 } = {}) {
    const impronte = new Set();
    function ricorda(valore) {
      const s = String(valore || '');
      if (!s) return;
      impronte.add(impronta(s));
      if (impronte.size > tetto) impronte.delete(impronte.values().next().value);
    }
    function dopoInput(inputType, valore, prima) {
      const s = String(valore || '');
      let daFuori = !!prima;
      if (!s) daFuori = false;
      else if (inputType === 'insertFromPaste' || inputType === 'insertFromDrop') daFuori = true;
      else if ((inputType === 'historyUndo' || inputType === 'historyRedo') && impronte.has(impronta(s))) daFuori = true;
      if (daFuori && s) ricorda(s);
      return daFuori;
    }
    return { dopoInput, ricorda };
  }

  global.SN_TESTO_DI_ALTRI = Object.freeze({ crea, impronta });
})(typeof globalThis !== 'undefined' ? globalThis : self);
