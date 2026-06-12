// Assegna il numero progressivo (#1, #2, …) ai feedback ESISTENTI che non ne
// hanno ancora uno. Da eseguire UNA VOLTA (in locale dall'owner, o in CI col
// service account) dopo l'introduzione della numerazione: i feedback nuovi si
// numerano da soli all'invio.
//
// Ordina per createdAt crescente, così i numeri rispecchiano l'ordine storico
// di arrivo. I documenti che hanno già `seq` restano intatti; la numerazione
// dei nuovi parte dal max esistente + 1.
//
// USO:
//   node scripts/backfill-feedback-numbers.mjs            applica
//   node scripts/backfill-feedback-numbers.mjs --dry-run  mostra cosa farebbe

import { acquireBearer, FIRESTORE_BASE, FIREBASE_API_KEY } from './lib/firestore-auth.mjs';

const DRY = process.argv.includes('--dry-run');

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
  const res = await fetch(`${FIRESTORE_BASE}:runQuery`, {
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

async function main() {
  const bearer = DRY ? null : await acquireBearer();
  // Anche in dry-run serve leggere: la lettura è pubblica, niente bearer.
  const docs = await listAll(bearer || '');
  const withSeq = docs.filter((d) => intField(d, 'seq') > 0);
  const missing = docs.filter((d) => intField(d, 'seq') === 0);
  let next = withSeq.reduce((m, d) => Math.max(m, intField(d, 'seq')), 0) + 1;

  console.log(`${docs.length} feedback totali: ${withSeq.length} già numerati, ${missing.length} da numerare (si parte da #${next}).`);
  let failures = 0;
  for (const d of missing) {
    const id = d.name.split('/').pop();
    const label = strField(d, 'name') || strField(d, 'text').slice(0, 50).replace(/\s+/g, ' ');
    if (DRY) {
      console.log(`  • #${next++} → ${id}  «${label}»`);
      continue;
    }
    const r = await patchSeq(id, next, bearer);
    if (r.ok) console.log(`  ✓ #${next++} → ${id}  «${label}»`);
    else { console.error(`  ✗ ${id}: HTTP ${r.status} ${r.body}`); failures++; }
  }
  if (DRY) console.log('\nDry-run: nessuna scrittura.');
  else console.log(`\nFatto${failures ? ` (${failures} falliti)` : ''}.`);
  if (failures) process.exit(1);
}

main().catch((e) => { console.error('Errore:', e.message); process.exit(1); });
