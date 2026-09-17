// Chiave PUBBLICA per cifrare i feedback (sealed box: feedbackCrypto.js).
// Committarla è sicuro, serve solo a CIFRARE: la privata sta fuori dal repo.
// Per rigenerare la coppia: node scripts/gen-feedback-keys.mjs.

(function (global) {
  'use strict';
  // === FILO_FEEDBACK_PUBKEY (gestito da gen-feedback-keys.mjs) ===
  global.SN_FEEDBACK_PUBKEY = "BM44td2o-xZx_7Wvnx9LMeJLvdpgQU_DwidPKFFkIrHJ2abUMtBKVonlXdTRt3G3wWmtbZago2UCJfB9vnrqso8";
  // === /FILO_FEEDBACK_PUBKEY ===

  // INTERRUTTORE: la chiave pubblica da sola non accende la cifratura, serve anche questo.
  if (global.SN_FEEDBACK_ENC_ENABLED === undefined) {
    global.SN_FEEDBACK_ENC_ENABLED = true;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
