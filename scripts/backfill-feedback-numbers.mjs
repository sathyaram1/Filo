// Assegna il numero progressivo (#1, #2, …) ai feedback ESISTENTI che non ne
// hanno ancora uno. Da eseguire UNA VOLTA, in locale dall'owner, dopo
// l'introduzione della numerazione: i feedback nuovi si numerano da soli
// all'invio.
//
// Ordina per createdAt crescente, così i numeri rispecchiano l'ordine storico
// di arrivo. I documenti che hanno già `seq` restano intatti; la numerazione
// dei nuovi parte dal max esistente + 1.
//
// USO:
//   node scripts/backfill-feedback-numbers.mjs            applica
//   node scripts/backfill-feedback-numbers.mjs --dry-run  mostra cosa farebbe
//   npm run feedback:backfill                             lo stesso, dal manifesto
//
// Serve il token admin dell'owner (vedi scripts/admin-login.mjs), ed è l'unica
// strada rimasta: non c'è più modo di farlo eseguire da un'automazione.

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { acquireBearer, FIRESTORE_BASE, FIREBASE_API_KEY } from './lib/firestore-auth.mjs';

function intField(doc, name) {
  const v = doc?.fields?.[name];
  const n = v && 'integerValue' in v ? Number(v.integerValue) : NaN;
  return Number.isInteger(n) ? n : 0;
}

function strField(doc, name) {
  return doc?.fields?.[name]?.stringValue || '';
}

async function listAll(bearer) {
  // runQuery ordinato per createdAt ASC: i feedback più vecchi prendono i
  // numeri più bassi. 1000 è ben oltre il volume attuale dell'alpha.
  // La lettura della collezione è pubblica: il bearer serve solo se presente
  // (in dry-run non si autentica affatto).
  const headers = { 'Content-Type': 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(`${FIRESTORE_BASE}:runQuery?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'feedback' }],
        orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }],
        limit: 1000,
      },
    }),
  });
  if (!res.ok) throw new Error(`firestore query fallita (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const arr = await res.json();
  return arr.filter((r) => r.document).map((r) => r.document);
}

async function patchSeq(id, seq, bearer) {
  const qs = 'updateMask.fieldPaths=seq&updateMask.fieldPaths=subSeq';
  const res = await fetch(`${FIRESTORE_BASE}/feedback/${encodeURIComponent(id)}?${qs}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ fields: { seq: { integerValue: String(seq) }, subSeq: { integerValue: '0' } } }),
  });
  return { ok: res.ok, status: res.status, body: res.ok ? '' : (await res.text()).slice(0, 200) };
}

// Esegue il backfill. `bearer` null = dry-run (solo lettura, che è pubblica).
export async function backfillNumbers(bearer) {
  const dry = !bearer;
  const docs = await listAll(bearer || '');
  const withSeq = docs.filter((d) => intField(d, 'seq') > 0);
  const missing = docs.filter((d) => intField(d, 'seq') === 0);
  let next = withSeq.reduce((m, d) => Math.max(m, intField(d, 'seq')), 0) + 1;

  console.log(`${docs.length} feedback totali: ${withSeq.length} già numerati, ${missing.length} da numerare (si parte da #${next}).`);
  let failures = 0;
  for (const d of missing) {
    const id = d.name.split('/').pop();
    const label = strField(d, 'name') || strField(d, 'text').slice(0, 50).replace(/\s+/g, ' ');
    if (dry) {
      console.log(`  • #${next++} → ${id}  «${label}»`);
      continue;
    }
    const r = await patchSeq(id, next, bearer);
    if (r.ok) console.log(`  ✓ #${next++} → ${id}  «${label}»`);
    else { console.error(`  ✗ ${id}: HTTP ${r.status} ${r.body}`); failures++; }
  }
  return { total: docs.length, numbered: missing.length - failures, failures, dry };
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const DRY = process.argv.includes('--dry-run');
  try {
    const bearer = DRY ? null : await acquireBearer();
    const r = await backfillNumbers(bearer);
    console.log(DRY ? '\nDry-run: nessuna scrittura.' : `\nFatto${r.failures ? ` (${r.failures} falliti)` : ''}.`);
    if (r.failures) process.exit(1);
  } catch (e) {
    console.error('Errore:', e.message);
    process.exit(1);
  }
}
