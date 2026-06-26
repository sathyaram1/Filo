// Applier runtime del groomer della coda feedback (P3).
//
// PERCHÉ ESISTE
//   `src/shared/feedbackGroomer.js` è logica PURA (niente I/O). Questo script
//   è il "residuo" che lo alimenta con dati reali e applica le decisioni:
//
//     1. Legge la coda feedback da Firestore (riusa il pattern runQuery di
//        `scripts/next-feedback.mjs`).
//     2. Decifra i feedback con `decryptFeedbackFields` (priority è cifrata,
//        vedi P1).
//     3. Chiama `groom()` per merge/dedup.
//     4. Chiama il giudice LLM (`makePriorityJudge`) per la priorità, usando
//        il conteggio duplicati da `groom()`. Se il giudice non è configurato
//        (chiave API assente), usa il `priorityBumps` deterministico del groomer
//        come fallback.
//     5. Applica i risultati tramite la coda git (queue-triage.mjs + queue-feedback
//        non sono qui: usiamo queueTriage direttamente per le note di merge;
//        la priority va scritta con cifratura come in queue-feedback.mjs).
//
// OVERRIDE OWNER
//   Il campo `priorityManual` (boolean `true`) sul doc Firestore è il segnale
//   che l'owner ha impostato la priority a mano. Se presente e true, il giudice
//   NON sovrascrive la priority. Se il campo non esiste nello schema attuale,
//   il giudice viene chiamato comunque (nessun feedback attuale ha questo campo).
//   *** PUNTO DA CONFERMARE CON L'OWNER ***:
//     Serve aggiungere il campo `priorityManual: boolean` al doc Firestore (e
//     aggiornare `firestore.rules` / `hasOnly`) quando l'owner imposta la priorità
//     manualmente dalla dashboard. Questo è il marcatore di override mancante;
//     finché non esiste, il giudice può sovrascrivere le priority impostate a mano.
//
// PRIORITY CIFRATA
//   Quando si scrive la priority aggiornata nella coda git, si usa lo stesso
//   pattern di `scripts/queue-feedback.mjs` (righe ~156-165): se `SN_FEEDBACK_CRYPTO`
//   è disponibile e `isEnabled()` è true, si cifra con `encryptForOwner`.
//   La funzione `encryptPriorityForQueue` qui sotto incapsula questo pattern.
//
// USO
//   node scripts/groom-apply.mjs [--dry-run] [--no-priority-judge]
//
//   --dry-run            stampa le decisioni senza scrivere nulla.
//   --no-priority-judge  usa solo il bump deterministico (niente LLM).
//
// VERIFICABILITÀ IN LOCALE
//   La parte testabile in locale è il giudice + wrapper + integrazione col groomer
//   (vedi tests/unit/priorityJudge.test.mjs). La parte NON testabile e2e in locale:
//   - Lettura/scrittura via Firestore reale.
//   - Chiamata al modello LLM vero.
//   Queste due parti sono thin per design (≤ ~100 righe incluse le validazioni).
//
// EXIT CODES
//   0 → elaborazione completata (anche se coda vuota).
//   1 → errore critico (Firestore non raggiungibile, decifratura fallita, ecc.).

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

import { makePriorityJudge, applyClamp } from './lib/priority-judge.mjs';
import { decryptFeedbackList } from './lib/decrypt-feedback-fields.mjs';
import { queueTriage, commitAndPush } from './queue-triage.mjs';

// ─── Costanti Firestore (specchio di next-feedback.mjs) ──────────────────────

const PROJECT_ID = 'filo-8b9cb';
const API_KEY    = 'AIzaSyDN_fpshLW_K78QLV0MMiX1gd-OfO7x-CY';
const COLLECTION = 'feedback';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ─── Helpers REST ────────────────────────────────────────────────────────────

function fromFsValue(val) {
  if (!val) return null;
  if ('stringValue'  in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue'  in val) return val.doubleValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('timestampValue' in val) return val.timestampValue;
  if ('nullValue'    in val) return null;
  if ('arrayValue'   in val) return (val.arrayValue.values || []).map(fromFsValue);
  if ('mapValue'     in val) {
    const out = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) out[k] = fromFsValue(v);
    return out;
  }
  return null;
}

function fsDocToObject(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = fromFsValue(v);
  out._id          = doc.name?.split('/').pop() || '';
  out._createTime  = doc.createTime || null;
  return out;
}

// ─── Fetch coda (thin, non testato e2e) ──────────────────────────────────────

/**
 * Legge i feedback todo (candidati al grooming) da Firestore.
 * Filtra server-side per statusPublic == 'open', poi client-side per status decifrato == 'todo'.
 * Limit generoso: il groomer è O(n²) ma la coda alpha è piccola.
 *
 * @returns {Promise<object[]>} Feedback in chiaro (già decifrati).
 */
export async function fetchTodoFeedbacks() {
  const endpoint = `${FIRESTORE_BASE}:runQuery?key=${API_KEY}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: COLLECTION }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'statusPublic' },
          op: 'EQUAL',
          value: { stringValue: 'open' },
        },
      },
      limit: 500,
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Firestore runQuery fallito (${res.status}): ${errText.slice(0, 300)}`);
  }

  const arr = await res.json();
  const raw = [];
  for (const row of arr) {
    if (!row.document) continue;
    raw.push(fsDocToObject(row.document));
  }

  // Decifra tutti i campi sensibili (priority inclusa).
  const decrypted = await decryptFeedbackList(raw);

  // Normalizza _id da Firestore (stringa) a id (richiesto dal groomer).
  for (const fb of decrypted) {
    if (!fb.id) fb.id = fb._id;
  }

  // Filtra: solo status == 'todo'.
  return decrypted.filter((fb) => fb.status === 'todo');
}

// ─── Cifratura priority per la coda git ──────────────────────────────────────

/**
 * Cifra la priority per la scrittura nella coda git, usando lo stesso pattern
 * di queue-feedback.mjs (righe ~156-165).
 * Se la cifratura non è attiva (gate dormiente), ritorna il numero invariato.
 *
 * @param {number} priority - Intero 0..3.
 * @returns {Promise<number|string>} Priority cifrata (FENC1:...) oppure numero.
 */
export async function encryptPriorityForQueue(priority) {
  // Carica feedbackCrypto se non già presente (pattern di queue-feedback.mjs).
  try {
    if (globalThis.SN_FEEDBACK_PUBKEY === undefined) {
      require(resolve(ROOT, 'src', 'shared', 'feedbackPublicKey.js'));
    }
    if (!globalThis.SN_FEEDBACK_CRYPTO) {
      require(resolve(ROOT, 'src', 'shared', 'feedbackCrypto.js'));
    }
  } catch (_) {}

  const C = globalThis.SN_FEEDBACK_CRYPTO;
  if (C && C.isEnabled && C.isEnabled() && priority !== undefined && priority !== null) {
    try {
      return await C.encryptForOwner(String(priority));
    } catch (e) {
      console.warn('[groom-apply] cifratura priority fallita, scrivo in chiaro:', e?.message || e);
    }
  }
  return priority; // gate dormiente o errore → valore invariato
}

// ─── Applier principale (esportato per i test) ───────────────────────────────

/**
 * Esegue il grooming completo e applica le decisioni.
 *
 * @param {object} opts
 * @param {object[]}       opts.feedbacks       - Feedback già decifrati (priority = numero).
 * @param {boolean}        [opts.dryRun=false]  - Se true, stampa senza scrivere.
 * @param {Function|null}  [opts.llmJudge]      - Override giudice LLM (null = default).
 *   null = usa Gemini reale; false = disabilita il giudice (solo bump deterministico).
 *   Qualsiasi funzione = mock per test.
 * @param {boolean}        [opts.noPriorityJudge=false] - Disabilita il giudice LLM.
 * @param {Function}       [opts.writeTriage]   - Iniettabile nei test (default: queueTriage).
 * @returns {Promise<{ mergesApplied: number, prioritiesUpdated: number }>}
 */
export async function applyGrooming({ feedbacks, dryRun = false, llmJudge = null, noPriorityJudge = false, writeTriage }) {
  // Carica il modulo groomer (IIFE su globalThis).
  if (!globalThis.SN_FEEDBACK_GROOMER) {
    require(resolve(ROOT, 'src', 'shared', 'feedbackGroomer.js'));
  }
  const GROOMER = globalThis.SN_FEEDBACK_GROOMER;
  if (!GROOMER) throw new Error('[groom-apply] SN_FEEDBACK_GROOMER non disponibile');

  const triage = typeof writeTriage === 'function' ? writeTriage : queueTriage;

  // ── Step 1: grooming puro (merge + bump deterministico) ──────────────────
  const { merges, priorityBumps } = GROOMER.groom(feedbacks);

  console.log(`[groom-apply] merge trovati: ${merges.length}, bump deterministici: ${priorityBumps.length}`);

  // ── Step 2: applica i merge (append notes sul keepId, archivia dropId) ───
  let mergesApplied = 0;
  for (const { keepId, dropId, mergedNotes } of merges) {
    const notes = `[GROOMER] Duplicato ${dropId} allegato.\n${mergedNotes}`;
    console.log(`[groom-apply] merge: keep=${keepId} drop=${dropId}`);
    if (!dryRun) {
      // Accoda note aggiornate sull'originale.
      const keptFile = triage(keepId, 'todo', notes);
      if (keptFile && typeof keptFile === 'string') commitAndPush(keptFile);
      // Archivia il duplicato.
      const dropFile = triage(dropId, 'archived', `[GROOMER] Accorpato a ${keepId}.`);
      if (dropFile && typeof dropFile === 'string') commitAndPush(dropFile);
    }
    mergesApplied++;
  }

  // ── Step 3: calcola le priority tramite il giudice LLM o bump ────────────
  //
  // Costruisci un Map: keepId → numero di duplicati (da merges).
  const dupeCountFor = new Map();
  for (const { keepId } of merges) {
    dupeCountFor.set(keepId, (dupeCountFor.get(keepId) || 0) + 1);
  }

  // Override owner: salta il giudice se fb.priorityManual === true.
  // (Il campo non esiste ancora nello schema Firestore; vedi nota "PUNTO DA CONFERMARE".)
  const needsPriorityUpdate = (fb) => fb.priorityManual !== true;

  let judge = null;
  if (!noPriorityJudge && llmJudge !== false) {
    try {
      judge = makePriorityJudge(typeof llmJudge === 'function' ? llmJudge : undefined);
    } catch (e) {
      console.warn('[groom-apply] giudice LLM non disponibile, uso bump deterministico:', e?.message || e);
    }
  }

  let prioritiesUpdated = 0;

  if (judge) {
    // Modalità LLM: classifica ogni feedback che ha avuto duplicati (o tutti se vuoi
    // un grooming completo). Per ora: classifica i keepId con almeno 1 duplicato,
    // perché il segnale "quanti duplicati" è il dato più utile per il giudice.
    for (const fb of feedbacks) {
      if (!needsPriorityUpdate(fb)) {
        console.log(`[groom-apply] skip priority ${fb.id} (priorityManual=true)`);
        continue;
      }
      const dupeCount = dupeCountFor.get(fb.id) || 0;
      if (dupeCount < 1) continue; // il giudice LLM si attiva solo su feedback con duplicati

      const text = String(fb.text || fb.name || '');
      if (!text.trim()) continue;

      let raw;
      try {
        raw = await judge(text, dupeCount);
      } catch (e) {
        console.warn(`[groom-apply] giudice LLM fallito su ${fb.id}, uso bump deterministico:`, e?.message || e);
        // Fallback al bump deterministico per questo specifico feedback.
        const bump = priorityBumps.find((b) => b.id === fb.id);
        if (bump && bump.to !== fb.priority) {
          await writePriorityUpdate({ id: fb.id, priority: bump.to, dryRun, triage });
          prioritiesUpdated++;
        }
        continue;
      }

      const { isSecurity, priority: finalPriority } = applyClamp(raw);
      const currentPriority = typeof fb.priority === 'number' ? fb.priority : 0;

      console.log(`[groom-apply] priority ${fb.id}: ${currentPriority} → ${finalPriority} (isSecurity=${isSecurity}, dupes=${dupeCount})`);

      if (finalPriority !== currentPriority) {
        await writePriorityUpdate({ id: fb.id, priority: finalPriority, dryRun, triage });
        prioritiesUpdated++;
      }
    }
  } else {
    // Fallback: bump deterministico dal groomer (nessun LLM).
    for (const { id, to, from } of priorityBumps) {
      const fb = feedbacks.find((f) => f.id === id);
      if (fb && !needsPriorityUpdate(fb)) {
        console.log(`[groom-apply] skip bump ${id} (priorityManual=true)`);
        continue;
      }
      if (to === from) continue;
      console.log(`[groom-apply] bump deterministico ${id}: ${from} → ${to}`);
      await writePriorityUpdate({ id, priority: to, dryRun, triage });
      prioritiesUpdated++;
    }
  }

  return { mergesApplied, prioritiesUpdated };
}

// ─── Helper: scrive la priority aggiornata nella coda git ─────────────────────

async function writePriorityUpdate({ id, priority, dryRun, triage }) {
  const encrypted = await encryptPriorityForQueue(priority);
  const notes = JSON.stringify({ priorityUpdate: encrypted });
  if (!dryRun) {
    // queueTriage accoda le note come stringa; l'apply-triage.mjs lato GitHub Action
    // dovrà estrarre `priorityUpdate` da notes e applicarlo al campo priority.
    // Per ora lo schema è: notes contiene un JSON con `{ priorityUpdate: <val cifrato> }`.
    // apply-triage.mjs sarà aggiornato per riconoscere questo pattern (vedi commento lì).
    const file = triage(id, 'todo', notes);
    if (file && typeof file === 'string') commitAndPush(file);
  }
}

// ─── Entry point CLI ─────────────────────────────────────────────────────────

const isMainModule = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const noPriorityJudge = args.includes('--no-priority-judge');

  if (dryRun) console.log('[groom-apply] DRY-RUN: nessuna scrittura.');
  if (noPriorityJudge) console.log('[groom-apply] giudice LLM disabilitato, uso bump deterministico.');

  try {
    const feedbacks = await fetchTodoFeedbacks();
    console.log(`[groom-apply] feedback todo recuperati: ${feedbacks.length}`);

    if (!feedbacks.length) {
      console.log('[groom-apply] coda vuota, niente da fare.');
      process.exit(0);
    }

    const { mergesApplied, prioritiesUpdated } = await applyGrooming({
      feedbacks,
      dryRun,
      noPriorityJudge,
    });

    console.log(`[groom-apply] fatto. merge applicati: ${mergesApplied}, priority aggiornate: ${prioritiesUpdated}`);
    process.exit(0);
  } catch (e) {
    console.error('[groom-apply] errore fatale:', e.message);
    process.exit(1);
  }
}
