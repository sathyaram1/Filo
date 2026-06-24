// Chiave PUBBLICA di Filo per cifrare i feedback (sealed box, vedi
// feedbackCrypto.js e CLAUDE.md → S1). È sicuro committarla: serve solo a
// CIFRARE. La chiave PRIVATA corrispondente NON sta nel repo — la tiene
// l'owner (dashboard), il backend di sicurezza (Functions secrets) e le
// routine (passata via env). Vedi S1.5.
//
// Per (ri)generare la coppia:  node scripts/gen-feedback-keys.mjs
// Lo script sovrascrive la riga `SN_FEEDBACK_PUBKEY` qui sotto con la nuova
// chiave pubblica e stampa la privata (da salvare fuori dal repo).
//
// Finché è `null`, encryptForOwner() lancia un errore esplicito: la cifratura
// dei feedback è inattiva finché l'owner non genera la coppia.

(function (global) {
  'use strict';
  // === FILO_FEEDBACK_PUBKEY (gestito da gen-feedback-keys.mjs) ===
  global.SN_FEEDBACK_PUBKEY = "BM44td2o-xZx_7Wvnx9LMeJLvdpgQU_DwidPKFFkIrHJ2abUMtBKVonlXdTRt3G3wWmtbZago2UCJfB9vnrqso8";
  // === /FILO_FEEDBACK_PUBKEY ===
})(typeof globalThis !== 'undefined' ? globalThis : self);
