// Verifica locale «lavori locali», giro 2, rilievo 1: i feedback dell'owner e delle sessioni senza la prova del mittente
// devono poter essere riconosciuti. Legge Firestore VERO in sola lettura (nessuna scrittura, nessun testo stampato), col
// token dell'owner di questa macchina: senza token si salta. Non apre Filo.
import { test, expect } from '@playwright/test';
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
