// Cifratura dei campi sensibili dei feedback per la coda git (S1.2).
//
// PERCHÉ ESISTE
//   queue-feedback.mjs e queue-triage.mjs scrivono text/name/notes nei file
//   `feedback-triage/*.json` che finiscono nella history del repo PUBBLICO.
//   Questo modulo cifra quei campi con la stessa chiave pubblica di Filo usata
//   in src/shared/feedbackCrypto.js, così la history git è sicura quanto Firestore.
//
// GUARD
//   Se la chiave pubblica non è disponibile (SN_FEEDBACK_PUBKEY = null, default
//   finché l'owner non gira gen-feedback-keys.mjs) i valori restano in chiaro e
//   la funzione ritorna false. Niente crash, comportamento identico a prima.
//
// USO ROUTINE (decifratura)
//   Per leggere i campi cifrati usare scripts/lib/decrypt-feedback-fields.mjs.

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, '..', '..');

// Carica feedbackCrypto.js (IIFE su globalThis) se non è già disponibile.
// NON ri-carica feedbackPublicKey.js se SN_FEEDBACK_PUBKEY è già definita:
// così i test (o chi inietta una pubkey di test) non vengono sovrascritti dalla
// chiave di produzione bakeata nel file.
function loadCrypto() {
  try {
    // Solo la pubkey se non ancora presente (evita sovrascrittura chiavi di test).
    if (globalThis.SN_FEEDBACK_PUBKEY === undefined) {
      require(resolve(ROOT, 'src', 'shared', 'feedbackPublicKey.js'));
    }
    if (!globalThis.SN_FEEDBACK_CRYPTO) {
      require(resolve(ROOT, 'src', 'shared', 'feedbackCrypto.js'));
    }
  } catch (e) {
    console.warn('[encrypt-feedback-fields] impossibile caricare crypto:', e?.message || e);
  }
}

/**
 * Cifra in-place i campi indicati dell'oggetto `entry` usando la chiave
 * pubblica bakeata in feedbackPublicKey.js (o quella passata esplicitamente).
 *
 * @param {object}  entry      - L'oggetto da cifrare (modificato in-place).
 * @param {string[]} fields    - Array di chiavi da cifrare (es. ['text','name','notes']).
 * @param {string}  [pubKeyOverride] - Chiave pubblica base64url esplicita (opzionale;
 *   se omessa usa SN_FEEDBACK_PUBKEY da globalThis). Usata nei test per passare
 *   una chiave di test senza toccare globalThis, evitando interferenze in suite parallela.
 * @returns {Promise<boolean>} true se almeno un campo è stato cifrato; false se
 *   la pubkey non è disponibile (guard senza crash).
 */
export async function encryptFieldsForQueue(entry, fields, pubKeyOverride) {
  loadCrypto();
  const C = globalThis.SN_FEEDBACK_CRYPTO;
  // Con pubKeyOverride (test del meccanismo) si cifra direttamente. In
  // produzione (nessun override) la cifratura è gated dall'interruttore di
  // attivazione: isEnabled() = chiave pubblica presente E SN_FEEDBACK_ENC_ENABLED.
  // Dormiente finché l'owner non fa il cutover (vedi feedbackPublicKey.js).
  if (!C) return false;
  if (!pubKeyOverride && !(C.isEnabled ? C.isEnabled() : C.hasPublicKey())) return false;

  let encrypted = false;
  for (const f of fields) {
    const v = entry[f];
    if (v == null || v === '') continue;
    try {
      // encryptForOwner accetta pubKeyOverride come secondo argomento opzionale.
      entry[f] = await C.encryptForOwner(String(v), pubKeyOverride || undefined);
      encrypted = true;
    } catch (e) {
      console.warn(`[encrypt-feedback-fields] cifratura campo "${f}" fallita:`, e?.message || e);
    }
  }
  return encrypted;
}
