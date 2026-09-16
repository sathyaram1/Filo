// Chiave PUBBLICA per cifrare i feedback (sealed box: feedbackCrypto.js, CLAUDE.md → S1). Committarla è sicuro, serve solo a CIFRARE; la privata sta fuori dal repo (owner, Functions secrets, env delle routine — S1.5).
// Per rigenerare la coppia: node scripts/gen-feedback-keys.mjs (riscrive la riga qui sotto e stampa la privata).
// Finché è `null`, encryptForOwner() lancia un errore esplicito: la cifratura è inattiva.

(function (global) {
  'use strict';
  // === FILO_FEEDBACK_PUBKEY (gestito da gen-feedback-keys.mjs) ===
  global.SN_FEEDBACK_PUBKEY = "BM44td2o-xZx_7Wvnx9LMeJLvdpgQU_DwidPKFFkIrHJ2abUMtBKVonlXdTRt3G3wWmtbZago2UCJfB9vnrqso8";
  // === /FILO_FEEDBACK_PUBKEY ===

  // INTERRUTTORE DI ATTIVAZIONE (S1): la chiave pubblica da sola non accende la cifratura, serve anche questo flag a true.
  // Serviva a tenere il codice di cifratura dormiente su main finché dashboard, routine e backend non decifravano e nessun campo cifrato finiva sotto gli occhi di un utente senza chiave.
  if (global.SN_FEEDBACK_ENC_ENABLED === undefined) {
    global.SN_FEEDBACK_ENC_ENABLED = true; // CUTOVER 2026-06-25: cifratura S1 ATTIVA.
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
