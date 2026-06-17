// Parser dello stato audio di una WebContents, robusto tra versioni di Electron.
//
// L'evento `audio-state-changed` ha cambiato firma tra le versioni:
//   • Electron 32+  → (event)            con `event.audible` (boolean)
//   • Electron <32  → (event, {audible}) oppure (event, audible:boolean)
// Leggendo solo il secondo argomento, su Electron 33 `audible` risultava
// SEMPRE false (non c'è secondo argomento): l'indicatore audio sulle tab non
// si attivava mai. Questo helper normalizza tutte le firme.

(function (global) {
  'use strict';

  function audibleFromEvent(eventArg, secondArg) {
    // Electron 32+: l'audible sta sull'oggetto evento.
    if (eventArg && typeof eventArg === 'object' && 'audible' in eventArg) {
      return !!eventArg.audible;
    }
    // Electron <32, forma a oggetto: (event, { audible }).
    if (secondArg && typeof secondArg === 'object' && 'audible' in secondArg) {
      return !!secondArg.audible;
    }
    // Electron più vecchio, forma booleana: (event, audible).
    if (typeof secondArg === 'boolean') return secondArg;
    return false;
  }

  global.SN_AUDIO_STATE = { audibleFromEvent };
})(typeof globalThis !== 'undefined' ? globalThis : self);
