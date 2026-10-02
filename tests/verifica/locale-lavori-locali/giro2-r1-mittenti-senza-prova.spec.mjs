// Verifica locale «lavori locali», giro 2, rilievo 1: i feedback dell'owner e delle sessioni senza la prova del mittente
// devono poter essere riconosciuti. Legge Firestore VERO in sola lettura (nessuna scrittura, nessun testo stampato), col
// token dell'owner di questa macchina: senza token si salta. Non apre Filo.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

test('la pratica #908 (aperta da una sessione prima della prova) si può legare a un lavoro locale', async () => {
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

test('un feedback che l’owner manda oggi dal Filo installato (senza prova, come lo scrive main) viene riconosciuto', async () => {
  const { findAdminRefreshToken, acquireBearer, FIRESTORE_BASE } = await imp('scripts/lib/firestore-auth.mjs');
  test.skip(!findAdminRefreshToken(), 'serve il token dell’owner di questa macchina');
  // Finché main non scrive la prova, l'app installata e le sessioni che lavorano da main creano senza.
  const main = execFileSync('git', ['show', 'origin/main:src/shared/feedback.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  test.skip(/senderProof/.test(main), 'main scrive già la prova del mittente');
  const R = await imp('scripts/ripasso-mittenti.mjs');
  const bearer = await acquireBearer();
  const res = await fetch(`${FIRESTORE_BASE}/config/automation?mask.fieldPaths=senderProofSince`, { headers: { Authorization: `Bearer ${bearer}` } });
  expect(res.ok).toBe(true);
  const f = ((await res.json()).fields || {}).senderProofSince?.mapValue?.fields || {};
  const soglie = { local: Number(f.local?.integerValue), owner: Number(f.owner?.integerValue) };
  // Un pomeriggio di oggi: la versione installata non scriveva ancora la prova.
  const docs = [
    { id: 'o1', clientId: 'owner:caf22093-385f-4ff1-8517-6dacd98d1a6f', status: 'unlabeled', createTime: '2026-10-01T15:00:00Z', seq: 9001 },
    { id: 'l1', clientId: 'local:claude', status: 'todo', createTime: '2026-10-01T15:05:00Z', seq: 9002 },
  ];
  const esito = R.candidatiAlRipasso(docs, soglie);
  expect(esito.promossi.map((d) => d.id).sort(), R.resoconto(esito).join(' | ')).toEqual(['l1', 'o1']);
});
