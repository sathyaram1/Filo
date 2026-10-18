// Chiave PUBBLICA dei feedback (sealed box di feedbackCrypto.js): serve solo a cifrare, quindi sta nel repo.
// La privata non sta nel repo: la tengono solo l'owner e il server. La riga fra i marcatori la riscrive
// scripts/gen-feedback-keys.mjs; finché è null, encryptForOwner() lancia un errore esplicito.

(function (global) {
  'use strict';
  // === FILO_FEEDBACK_PUBKEY (gestito da gen-feedback-keys.mjs) ===
  global.SN_FEEDBACK_PUBKEY = "BM44td2o-xZx_7Wvnx9LMeJLvdpgQU_DwidPKFFkIrHJ2abUMtBKVonlXdTRt3G3wWmtbZago2UCJfB9vnrqso8";
  // === /FILO_FEEDBACK_PUBKEY ===

  // Interruttore separato dalla chiave: a false la cifratura resta dormiente anche con la chiave presente,
  // per chi deve leggere i campi senza avere la privata. Chi lo imposta prima del caricamento vince.
  if (global.SN_FEEDBACK_ENC_ENABLED === undefined) {
    global.SN_FEEDBACK_ENC_ENABLED = true;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
