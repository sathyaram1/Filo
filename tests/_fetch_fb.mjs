// TEMP: legge i feedback da Firestore (solo lettura, API key pubblica) e stampa
// quelli in stato `todo`. Usato per capire il testo esatto di FB2.
const PROJECT_ID = 'filo-8b9cb';
const API_KEY = 'AIzaSyDN_fpshLW_K78QLV0MMiX1gd-OfO7x-CY';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function fromFs(val) {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return val.doubleValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('timestampValue' in val) return val.timestampValue;
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) return (val.arrayValue.values || []).map(fromFs);
  if ('mapValue' in val) {
    const o = {}; for (const [k, v] of Object.entries(val.mapValue.fields || {})) o[k] = fromFs(v); return o;
  }
  return null;
}

const res = await fetch(`${BASE}:runQuery?key=${API_KEY}`, {
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
if (!res.ok) { console.error('HTTP', res.status, await res.text()); process.exit(1); }
const rows = await res.json();
const all = [];
for (const r of rows) {
  if (!r.document) continue;
  const o = {}; for (const [k, v] of Object.entries(r.document.fields || {})) o[k] = fromFs(v);
  o._id = r.document.name.split('/').pop();
  all.push(o);
}
const byStatus = {};
for (const f of all) { const s = f.status || 'new'; byStatus[s] = (byStatus[s] || 0) + 1; }
console.log('TOTAL', all.length, 'byStatus', JSON.stringify(byStatus));
const todos = all.filter((f) => (f.status || 'new') === 'todo');
console.log('\n=== TODO feedbacks ===', todos.length);
for (const f of todos) {
  console.log('\n----------------------------------------');
  console.log('id:', f._id, '| priority:', f.priority ?? '(none)', '| url:', f.url || '');
  console.log('text:', JSON.stringify(f.text || ''));
  console.log('images:', (f.images || []).length, '| notes:', JSON.stringify(f.notes || ''));
}
