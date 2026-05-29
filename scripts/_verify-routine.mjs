// TEMP: collaudo end-to-end del ruolo `routines`. Da eliminare dopo l'uso.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const cfg = require(resolve(__dirname, '..', 'src', 'main', 'auth', 'config.js'));
const BASE = `https://firestore.googleapis.com/v1/projects/${cfg.firebaseProjectId}/databases/(default)/documents`;

function decode(jwt) {
  const p = jwt.split('.')[1];
  return JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

async function mint(rt) {
  const r = await fetch(`${cfg.secureTokenEndpoint}?key=${cfg.firebaseApiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt }),
  });
  if (!r.ok) throw new Error(`mint fallito ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()).id_token;
}

async function listOneFeedback() {
  // runQuery: prendi un feedback già in todo/done/clarify per un test non distruttivo.
  const r = await fetch(`${BASE}:runQuery?key=${cfg.firebaseApiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'feedback' }],
        where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'IN',
          value: { arrayValue: { values: [{ stringValue: 'todo' }, { stringValue: 'done' }, { stringValue: 'clarify' }] } } } },
        limit: 1,
      },
    }),
  });
  const j = await r.json();
  const doc = (j.find((x) => x.document) || {}).document;
  if (!doc) return null;
  const id = doc.name.split('/').pop();
  const status = doc.fields?.status?.stringValue || 'todo';
  const notes = doc.fields?.notes?.stringValue ?? null;
  return { id, status, notes };
}

async function patch(id, fields, mask, idToken) {
  const qs = mask.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const r = await fetch(`${BASE}/feedback/${encodeURIComponent(id)}?${qs}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fields }),
  });
  return { status: r.status, body: await r.text() };
}

const S = (v) => ({ stringValue: v });
const I = (v) => ({ integerValue: String(v) });

async function main() {
  const rt = process.env.FILO_ROUTINE_REFRESH_TOKEN;
  if (!rt) throw new Error('manca FILO_ROUTINE_REFRESH_TOKEN');

  const idToken = await mint(rt);
  const claims = decode(idToken);
  console.log('1) ID token coniato. email:', claims.email, '| email_verified:', claims.email_verified);

  const fb = await listOneFeedback();
  if (!fb) { console.log('Nessun feedback in todo/done/clarify per il test positivo: salto il punto 2.'); }
  else {
    console.log(`   feedback di test: ${fb.id} (status attuale: ${fb.status})`);
    // 2) POSITIVO: riscrive lo STESSO status + le STESSE notes (no-op logico). Deve dare 200.
    const fields = { status: S(fb.status) };
    const mask = ['status'];
    if (fb.notes !== null) { fields.notes = S(fb.notes); mask.push('notes'); }
    const pos = await patch(fb.id, fields, mask, idToken);
    console.log(`2) Scrittura CONSENTITA (status invariato): HTTP ${pos.status} ${pos.status === 200 ? 'OK ✓' : 'INATTESO ✗ ' + pos.body.slice(0, 200)}`);
  }

  // 3) NEGATIVO: tenta di cambiare priority (campo vietato al ruolo routine). Deve dare 403.
  const targetId = fb ? fb.id : 'qualunque-id';
  const neg = await patch(targetId, { priority: I(3) }, ['priority'], idToken);
  console.log(`3) Scrittura VIETATA (priority): HTTP ${neg.status} ${neg.status === 403 ? 'BLOCCATA ✓' : 'INATTESO ✗ ' + neg.body.slice(0, 200)}`);

  // 4) NEGATIVO: tenta status='verified' (non nel set consentito). Deve dare 403.
  const neg2 = await patch(targetId, { status: S('verified') }, ['status'], idToken);
  console.log(`4) Scrittura VIETATA (status=verified): HTTP ${neg2.status} ${neg2.status === 403 ? 'BLOCCATA ✓' : 'INATTESO ✗ ' + neg2.body.slice(0, 200)}`);
}

main().catch((e) => { console.error('ERRORE:', e.message); process.exit(1); });
