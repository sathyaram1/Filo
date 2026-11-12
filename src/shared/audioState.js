// Parser dello stato audio di una WebContents, robusto tra versioni di Electron.
// `audio-state-changed` ha due firme: `audible` sull'evento o nel secondo argomento.
// Leggendo solo il secondo, l'indicatore audio delle schede non si accende mai.

(function (global) {
  'use strict';

  function audibleFromEvent(eventArg, secondArg) {
    if (eventArg && typeof eventArg === 'object' && 'audible' in eventArg) {
      return !!eventArg.audible;
    }
    if (secondArg && typeof secondArg === 'object' && 'audible' in secondArg) {
      return !!secondArg.audible;
    }
    if (typeof secondArg === 'boolean') return secondArg;
    return false;
  }

  global.SN_AUDIO_STATE = { audibleFromEvent };
})(typeof globalThis !== 'undefined' ? globalThis : self);
