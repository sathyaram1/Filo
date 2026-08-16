// Migrazione una-tantum (#476): ri-cifra lo `status` dei feedback esistenti a
// LUNGHEZZA FISSA, e corregge l'enum grossolano dei beccati confermati.
//
// PERCHÉ SERVE
//   La cifratura non imbottisce: il campo cifrato è lungo quanto il nome dello
//   stato. Gli stati hanno nomi di lunghezza diversa, quindi CONTARE i caratteri
//   di quel campo equivale a leggerlo — e le letture della collezione sono
//   pubbliche. Da oggi si scrive imbottito, ma i documenti già scritti restano
//   misurabili finché nessuno li tocca: un attacco confermato l'anno scorso si
//   riconosce ancora oggi. Questa è la passata che li mette a posto.
//
//   Nello stesso giro si sistema `statusPublic` dei confermati: prima valeva
//   'closed' (lo stesso di un feedback risolto), e da lì partivano la ricompensa
//   all'attaccante e la comparsa in bacheca.
//
// SICUREZZA DELLA MIGRAZIONE
//   · Idempotente: un documento già a posto viene saltato (nessuna scrittura).
//   · Tocca SOLO `status` e `statusPublic`. Nient'altro viene riscritto.
//   · Lo status non viene MAI cambiato: si ri-cifra lo stesso identico valore.
//   · Se un documento non è decifrabile, si salta e lo si conta: meglio lasciarlo
//     com'è che scriverci sopra un valore inventato.
//
// USO (owner, in locale — serve la chiave privata + il token admin):
//   node scripts/migrate-status-padding.mjs --dry-run   mostra cosa farebbe
//   node scripts/migrate-status-padding.mjs             applica

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireBearer, FIRESTORE_BASE } from './lib/firestore-auth.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(resolve(ROOT, 'x.js'));
require(resolve(ROOT, 'src', 'shared', 'feedbackPublicKey.js'));
require(resolve(ROOT, 'src', 'shared', 'feedbackCrypto.js'));
require(resolve(ROOT, 'src', 'shared', 'feedbackStatus.js'));

const C = globalThis.SN_FEEDBACK_CRYPTO;
const FS = globalThis.SN_FB_STATUS;
const DRY = process.argv.includes('--dry-run');

const { decryptFeedbackFields } = await import('./lib/decrypt-feedback-fields.mjs');

async function tuttiIFeedback(bearer) {
  const out = [];
  let pageToken = '';
  do {
    const url = `${FIRESTORE_BASE}/feedback?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } });
    if (!res.ok) throw new Error(`lettura feedback fallita: HTTP ${res.status}`);
    const json = await res.json();
    for (const d of (json.documents || [])) {
      out.push({ id: String(d.name).split('/').pop(), fields: d.fields || {} });
    }
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return out;
}

async function main() {
  const bearer = await acquireBearer();
  const docs = await tuttiIFeedback(bearer);
  console.log(`${docs.length} feedback da esaminare${DRY ? ' (dry-run)' : ''}.`);

  let riscritti = 0; let giaApposto = 0; let illeggibili = 0; let pubblicoCorretto = 0;

  for (const doc of docs) {
    const grezzo = doc.fields.status?.stringValue;
    if (!grezzo) { giaApposto++; continue; }

    // Status in chiaro (storico mai cifrato): niente da imbottire, ma l'enum
    // grossolano va comunque ricalcolato.
    let fine = grezzo;
    if (C.isEncrypted(grezzo)) {
      const dec = await decryptFeedbackFields({ _id: doc.id, status: grezzo });
      fine = dec.status;
      if (!FS.isCanonical(fine) && !FS.isLegacy(fine)) { illeggibili++; continue; }
    }

    const pubblicoAtteso = FS.PUBLIC_MAP[fine] || (FS.isLegacy(fine) ? 'open' : null);
    const pubblicoAttuale = doc.fields.statusPublic?.stringValue;
    const pubblicoDaCorreggere = pubblicoAtteso && pubblicoAttuale !== pubblicoAtteso;

    // Già imbottito? Si riconosce dalla lunghezza del cifrato: tutti gli stati
    // imbottiti producono la stessa. Ri-cifrare non farebbe danni (il valore è
    // lo stesso) ma sarebbe una scrittura inutile su ogni documento.
    const campione = await C.encryptForOwner(FS.padForCipher('todo'));
    const giaImbottito = C.isEncrypted(grezzo) && grezzo.length === campione.length;

    if (giaImbottito && !pubblicoDaCorreggere) { giaApposto++; continue; }

    const nuovoCifrato = await C.encryptForOwner(FS.padForCipher(fine));
    if (DRY) {
      console.log(`  • ${doc.id}: ${fine}${pubblicoDaCorreggere ? `  [pubblico ${pubblicoAttuale} → ${pubblicoAtteso}]` : ''}`);
      riscritti++; if (pubblicoDaCorreggere) pubblicoCorretto++;
      continue;
    }

    const campi = { status: { stringValue: nuovoCifrato } };
    const mask = ['status'];
    if (pubblicoDaCorreggere) { campi.statusPublic = { stringValue: pubblicoAtteso }; mask.push('statusPublic'); }
    const qs = mask.map((m) => `updateMask.fieldPaths=${m}`).join('&');
    const res = await fetch(`${FIRESTORE_BASE}/feedback/${doc.id}?${qs}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ fields: campi }),
    });
    if (!res.ok) {
      console.error(`  ✗ ${doc.id}: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
      continue;
    }
    riscritti++; if (pubblicoDaCorreggere) pubblicoCorretto++;
  }

  console.log(`\nFatto: ${riscritti} riscritti (${pubblicoCorretto} con l'enum grossolano corretto), ${giaApposto} già a posto, ${illeggibili} non decifrabili (lasciati intatti).`);
}

main().catch((e) => { console.error('Errore:', e.message); process.exit(1); });
