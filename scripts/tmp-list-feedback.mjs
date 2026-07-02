import { FIRESTORE_BASE, FIREBASE_API_KEY } from './lib/firestore-auth.mjs';

function strField(doc, name) {
  return doc?.fields?.[name]?.stringValue || '';
}
function intField(doc, name) {
  const v = doc?.fields?.[name];
  const n = v && 'integerValue' in v ? Number(v.integerValue) : NaN;
  return Number.isInteger(n) ? n : 0;
}

const res = await fetch(`${FIRESTORE_BASE}:runQuery?key=${FIREBASE_API_KEY}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    structuredQuery: {
      from: [{ collectionId: 'feedback' }],
      orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
      limit: 200,
    },
  }),
});
if (!res.ok) throw new Error(`query failed ${res.status}: ${(await res.text()).slice(0,300)}`);
const arr = await res.json();
const docs = arr.filter(r => r.document).map(r => r.document);
for (const d of docs) {
  const id = d.name.split('/').pop();
  const seq = intField(d, 'seq');
  const status = strField(d, 'status');
  const name = strField(d, 'name');
  const clientId = strField(d, 'clientId');
  console.log(`#${seq} [${status}] ${id} (${clientId}) — ${name}`);
}
console.log(`\nTotale: ${docs.length}`);
