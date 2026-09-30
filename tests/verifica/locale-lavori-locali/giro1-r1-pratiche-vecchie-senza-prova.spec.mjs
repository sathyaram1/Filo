// Verifica locale «lavori locali», rilievo 1: i feedback già aperti dall'owner e dalle sessioni devono
// poter diventare lavoro locale. Legge Firestore VERO, in sola lettura (niente scritture, nessun testo
// stampato), col token dell'owner di questa macchina: senza token si salta. Non apre Filo.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

test('la pratica #908 (aperta da una sessione) si può legare a un lavoro locale', async () => {
  const { findAdminRefreshToken, acquireBearer, FIRESTORE_BASE } = await imp('scripts/lib/firestore-auth.mjs');
  test.skip(!findAdminRefreshToken(), 'serve il token dell’owner di questa macchina');
  const { risolviFeedback } = await imp('scripts/lib/pratica-locale.mjs');
  const of = await imp('scripts/owner-feedback.mjs');
  const bearer = await acquireBearer();
  const r = await risolviFeedback('908', { bearer, base: FIRESTORE_BASE });
  expect(r.ok, r.motivo).toBe(true);
  const p = await of.praticaPerLaSessione(r.id, { bearer });
  expect(p.ok, p.motivo).toBe(true);
});

test('nessun feedback aperto dell’owner o di una sessione resta «di un utente» per la prova mancante', async () => {
  const { findAdminRefreshToken, acquireBearer, FIRESTORE_BASE } = await imp('scripts/lib/firestore-auth.mjs');
  test.skip(!findAdminRefreshToken(), 'serve il token dell’owner di questa macchina');
  const { decryptFeedbackFields } = await imp('scripts/lib/decrypt-feedback-fields.mjs');
  const bearer = await acquireBearer();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` };
  const senzaProva = { local: 0, owner: 0 };
  for (const pub of ['open', 'pending-approval']) {
    const q = { structuredQuery: {
      from: [{ collectionId: 'feedback' }],
      where: { fieldFilter: { field: { fieldPath: 'statusPublic' }, op: 'EQUAL', value: { stringValue: pub } } },
      select: { fields: ['clientId', 'senderProof', 'status'].map((f) => ({ fieldPath: f })) },
      limit: 2000,
    } };
    const res = await fetch(`${FIRESTORE_BASE}:runQuery`, { method: 'POST', headers, body: JSON.stringify(q) });
    expect(res.ok).toBe(true);
    for (const x of await res.json()) {
      if (!x || !x.document) continue;
      const f = x.document.fields || {};
      const dec = await decryptFeedbackFields({ _id: x.document.name, clientId: f.clientId?.stringValue || '', status: f.status?.stringValue || '' });
      if (/^(attack|spam|suspicious)/.test(String(dec.status || ''))) continue;
      const cid = String(dec.clientId || '');
      if (f.senderProof?.stringValue) continue;
      if (/^local:/i.test(cid)) senzaProva.local += 1;
      else if (/^owner:/i.test(cid)) senzaProva.owner += 1;
    }
  }
  expect(senzaProva, 'feedback aperti di sessioni (local) e dell’owner senza la prova del mittente').toEqual({ local: 0, owner: 0 });
});
