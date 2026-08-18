// Migrazione ONE-SHOT degli status legacy alla macchina a stati canonica
// (spec: FEEDBACK-STATES.md §8). Per ogni feedback con status RITIRATO
// (new/draft/clarify/review/blocked/verified/ignored) calcola lo status
// canonico con la STESSA logica di normalizzazione della dashboard
// (SN_MANAGE_REVIEW.normalizeStatus) e lo riscrive su Firestore, insieme a
// statusPublic e (se presente) statusReason.
//
// I documenti già canonici NON vengono toccati. Idempotente: rilanciarla non
// cambia nulla dopo la prima passata.
//
// USO:
//   node scripts/migrate-status.mjs            # DRY-RUN: stampa cosa farebbe
//   node scripts/migrate-status.mjs --apply    # scrive davvero
//
// Serve il token admin dell'owner (vedi scripts/admin-login.mjs): acquireBearer.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { acquireBearer, FIRESTORE_BASE } from './lib/firestore-auth.mjs';
// IIFE su globalThis, nell'ordine giusto: crypto → feedback → vocabolario → normalize.
import '../src/shared/feedbackCrypto.js';
import '../src/shared/feedback.js';
import '../src/shared/feedbackStatus.js';
import '../src/shared/manageReview.js';

const FS = globalThis.SN_FB_STATUS;
const MR = globalThis.SN_MANAGE_REVIEW;
const CRYPTO = globalThis.SN_FEEDBACK_CRYPTO;
const APPLY = process.argv.includes('--apply');

function fromFsValue(val) {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return val.doubleValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('timestampValue' in val) return val.timestampValue;
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) return (val.arrayValue.values || []).map(fromFsValue);
  if ('mapValue' in val) {
    const out = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) out[k] = fromFsValue(v);
    return out;
  }
  return null;
}
function fsDocToObject(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = fromFsValue(v);
  out._id = doc.name?.split('/').pop() || '';
  return out;
}
function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  throw new Error('tipo non supportato');
}

// Scarica TUTTI i documenti della collezione (paging).
async function listAll(bearer) {
  const docs = [];
  let pageToken = '';
  do {
    const qs = `pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(`${FIRESTORE_BASE}/feedback?${qs}`, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    if (!res.ok) throw new Error(`firestore list fallito (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    for (const d of json.documents || []) docs.push(d);
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return docs;
}

async function main() {
  const bearer = await acquireBearer();
  const docs = await listAll(bearer);
  console.log(`${docs.length} feedback totali${APPLY ? '' : ' (DRY-RUN: niente scritture, usa --apply)'}.`);

  const counts = {};
  let migrated = 0, skipped = 0, failures = 0;

  const { decryptFeedbackFields } = await import('./lib/decrypt-feedback-fields.mjs');
  for (const d of docs) {
    let fb = fsDocToObject(d);

    // Decifra TUTTI i campi cifrati (status, ma soprattutto `pipeline`: senza i
    // verdetti in chiaro la normalizzazione classificherebbe tutto "unlabeled").
    try {
      fb = await decryptFeedbackFields(fb);
    } catch (e) {
      console.warn(`  ! ${fb._id}: decifratura fallita — salto (${e?.message || e})`);
      failures++;
      continue;
    }
    if (CRYPTO && CRYPTO.isEncrypted && CRYPTO.isEncrypted(fb.status)) {
      console.warn(`  ! ${fb._id}: status ancora cifrato (chiave privata assente?) — salto`);
      failures++;
      continue;
    }

    if (FS.isCanonical(fb.status)) { skipped++; continue; }

    // Stessa normalizzazione della dashboard: scioglie anche new/blocked dai
    // campi grezzi (pipeline/blockReason/reviewDecision).
    const { status, statusReason } = MR.normalizeStatus(fb);
    const key = `${fb.status || '(vuoto)'} → ${status}${statusReason ? ` (${statusReason})` : ''}`;
    counts[key] = (counts[key] || 0) + 1;

    if (!APPLY) { migrated++; continue; }

    // Scrittura: status (cifrato se il gate è on) + statusPublic + statusReason.
    let fine = status;
    if (CRYPTO && CRYPTO.isEnabled && CRYPTO.isEnabled()) {
      // #476: lunghezza FISSA prima di cifrare. Questa migrazione oggi non
      // trova più niente da fare, ma se qualcuno la rilanciasse su documenti
      // storici rimetterebbe in circolo esattamente la falla appena chiusa:
      // senza imbottitura il campo cifrato è lungo quanto il nome dello stato,
      // e contarne i caratteri equivale a leggerlo.
      const FS = globalThis.SN_FB_STATUS;
      const daCifrare = FS && FS.padForCipher ? FS.padForCipher(status) : status;
      try { fine = await CRYPTO.encryptForOwner(daCifrare); } catch (_) {}
    }
    const publicStatus = globalThis.SN_FEEDBACK?.statusToPublic ? globalThis.SN_FEEDBACK.statusToPublic(status) : 'open';
    const fields = { status: toFsValue(fine), statusPublic: toFsValue(publicStatus) };
    const mask = ['status', 'statusPublic'];
    if (statusReason) { fields.statusReason = toFsValue(statusReason); mask.push('statusReason'); }
    const qs = mask.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
    const res = await fetch(`${FIRESTORE_BASE}/feedback/${encodeURIComponent(fb._id)}?${qs}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ fields }),
    });
    if (res.ok) migrated++;
    else { console.error(`  ✗ ${fb._id}: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`); failures++; }
  }

  console.log('\nMappatura:');
  for (const [k, n] of Object.entries(counts).sort()) console.log(`  ${String(n).padStart(4)}  ${k}`);
  console.log(`\n${APPLY ? 'Migrati' : 'Da migrare'}: ${migrated} · già canonici: ${skipped} · errori: ${failures}`);
  if (failures) process.exit(1);
}

main().catch((e) => { console.error('Errore:', e.message); process.exit(1); });
