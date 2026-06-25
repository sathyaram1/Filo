// Decifratura dei campi sensibili dei feedback (S1.3 — lettore routine).
//
// PERCHÉ ESISTE
//   Le routine cloud ricevono feedback con campi cifrati (FENC1:...) da Firestore
//   o dalla coda git. Questo helper è il passo deterministico NON-LLM che
//   decifra i campi PRIMA che il plaintext entri nel contesto di un worker LLM.
//   La chiave privata non deve mai essere passata direttamente a un LLM: viene
//   letta qui, usata per decriptare, e il worker riceve solo plaintext.
//
// DOVE METTERE LA CHIAVE PRIVATA (owner)
//   1. Env `FILO_FEEDBACK_PRIVKEY` — la chiave privata PKCS8 in base64 (quella
//      stampata da `node scripts/gen-feedback-keys.mjs`). Impostarla nella
//      configurazione della routine cloud (es. secrets del runner).
//   2. Oppure, in locale: file `tests/agent/.env` nella root del repo Filo,
//      come variabile `FILO_FEEDBACK_PRIVKEY=<base64>` (già gitignorato).
//      Viene caricato automaticamente se il file esiste.
//
// USO
//   import { decryptFeedbackFields } from './lib/decrypt-feedback-fields.mjs';
//
//   // Prima di passare il feedback a un worker LLM:
//   const plain = await decryptFeedbackFields(feedbackObject);
//   // plain.text, plain.name, plain.notes, plain.reviewComment sono in chiaro.
//
//   // Oppure decifra direttamente con una chiave esplicita:
//   const plain = await decryptFeedbackFields(feedbackObject, myPrivKeyB64);

import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, '..', '..');

// Campi di testo da decifrare. S1.F2.1: aggiunto 'status' (cifrato quando gate on).
// S1.F2.2: aggiunto 'clientId' (cifrato quando gate on; clientIdHash resta in chiaro).
// 'statusPublic' NON è nella lista: è sempre in chiaro e non va toccato.
const TEXT_FIELDS = ['text', 'url', 'name', 'title', 'notes', 'reviewComment', 'status', 'clientId'];

// Carica feedbackCrypto.js (IIFE su globalThis) se non è già disponibile.
// NON ri-carica feedbackPublicKey.js se SN_FEEDBACK_PUBKEY è già definita:
// così i test (o chiunque inietti una pubkey di test prima di chiamare questo
// modulo) non vengono sovrascritta dalla chiave di produzione bakeata nel file.
function loadCrypto() {
  try {
    // Solo la pubkey se non già configurata (evita di sovrascrivere chiavi di test).
    if (globalThis.SN_FEEDBACK_PUBKEY === undefined) {
      require(resolve(ROOT, 'src', 'shared', 'feedbackPublicKey.js'));
    }
    // feedbackCrypto.js: sicuro da re-eseguire, è idempotente.
    if (!globalThis.SN_FEEDBACK_CRYPTO) {
      require(resolve(ROOT, 'src', 'shared', 'feedbackCrypto.js'));
    }
  } catch (e) {
    console.warn('[decrypt-feedback-fields] impossibile caricare crypto:', e?.message || e);
  }
}

// Legge la chiave privata da FILO_FEEDBACK_PRIVKEY (env) oppure da
// `tests/agent/.env` nella root del repo (in locale). Ritorna null se assente.
function readPrivKey() {
  // 1. Variabile d'ambiente (impostata nel cloud / dalla routine).
  if (process.env.FILO_FEEDBACK_PRIVKEY) return process.env.FILO_FEEDBACK_PRIVKEY.trim();

  // 2. File .env locale (solo in locale, il file è gitignorato).
  const envFile = join(ROOT, 'tests', 'agent', '.env');
  if (existsSync(envFile)) {
    try {
      const lines = readFileSync(envFile, 'utf8').split('\n');
      for (const line of lines) {
        const m = line.match(/^FILO_FEEDBACK_PRIVKEY\s*=\s*(.+)$/);
        if (m) return m[1].trim().replace(/^["']|["']$/g, '');
      }
    } catch (_) {}
  }
  return null;
}

const PLACEHOLDER = '[cifrato — chiave privata non configurata]';

/**
 * Decifra i campi sensibili di un oggetto feedback.
 * Retrocompatibile: i valori non cifrati (vecchi feedback in chiaro) passano
 * invariati. Se la chiave privata non è disponibile, i campi FENC1: vengono
 * sostituiti con un placeholder leggibile invece di crashare.
 *
 * @param {object} fb        - L'oggetto feedback (non modificato in-place: ritorna copia).
 * @param {string} [privKey] - Chiave privata PKCS8 base64 (opzionale: di default
 *   usa FILO_FEEDBACK_PRIVKEY dall'env o dal file .env locale).
 * @returns {Promise<object>} Copia del feedback con i campi decifrati.
 */
export async function decryptFeedbackFields(fb, privKey) {
  if (!fb || typeof fb !== 'object') return fb;
  loadCrypto();
  const C = globalThis.SN_FEEDBACK_CRYPTO;

  // Recupera la chiave privata.
  const priv = privKey || readPrivKey();

  const out = { ...fb };
  for (const f of TEXT_FIELDS) {
    const v = out[f];
    if (!C || !C.isEncrypted(v)) continue; // chiaro o null: invariato
    if (!priv) {
      out[f] = PLACEHOLDER;
      continue;
    }
    try {
      out[f] = await C.decrypt(v, priv);
    } catch (e) {
      console.warn(`[decrypt-feedback-fields] decifratura campo "${f}" fallita:`, e?.message || e);
      out[f] = PLACEHOLDER;
    }
  }

  // S1.F2.4: il campo `pipeline` (scritto dal backend di sicurezza sul documento
  // PUBBLICO) è cifrato come un'unica stringa FENC1: che racchiude l'INTERO
  // oggetto pipeline serializzato in JSON. Decifralo e re-idratalo a oggetto, così
  // chi legge `fb.pipeline.action` ecc. lo trova invariato. Casi: assente o già
  // oggetto → invariato; FENC1: senza chiave → lascia la stringa (no crash);
  // errore di parse → lascia com'è.
  if (C && C.isEncrypted(out.pipeline) && priv) {
    try {
      out.pipeline = JSON.parse(await C.decrypt(out.pipeline, priv));
    } catch (e) {
      console.warn('[decrypt-feedback-fields] decifratura/parse del pipeline fallita:', e?.message || e);
    }
  }
  return out;
}

/**
 * Comodità: decifra un array di feedback in parallelo.
 * @param {object[]} feedbacks
 * @param {string}   [privKey]
 * @returns {Promise<object[]>}
 */
export async function decryptFeedbackList(feedbacks, privKey) {
  if (!Array.isArray(feedbacks)) return feedbacks;
  return Promise.all(feedbacks.map((fb) => decryptFeedbackFields(fb, privKey)));
}
