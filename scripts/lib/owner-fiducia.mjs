// La chiamata a ownerFiducia col token dell'owner, una per tutti gli strumenti che la usano: rete ritentata, tempo massimo,
// errori detti a parole. Quale op può chiedere ognuno lo tiene tests/unit/lavoroLocaleApprovato.test.mjs; qui nessuna op.

import { descriviErroreDiRete, fetchRitentato } from './rete.mjs';

const BASE = process.env.FILO_FUNCTIONS_BASE || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';
export const URL_FIDUCIA = `${BASE}/ownerFiducia`;
// Una funzione ferma parte a freddo in qualche secondo: aspettare un po' di più costa meno di una richiesta persa.
export const TEMPO_MASSIMO_MS = 30000;

async function tokenOwner() {
  const { findAdminRefreshToken, mintIdToken } = await import('./firestore-auth.mjs');
  const refresh = findAdminRefreshToken();
  return refresh ? mintIdToken(refresh) : '';
}

/**
 * → { ok: true, result } | { ok: false, motivo }. Mai un'eccezione. Un `result.ok === false` è il server che dice no:
 * arriva com'è, lo legge chi chiama. deps: { fetchImpl, idToken() → Promise<string>, url, tempoMs }.
 */
export async function chiamaOwnerFiducia(data, deps = {}) {
  // Dentro una prova il server vero non si tocca mai.
  if (!deps.fetchImpl && process.env.NODE_TEST_CONTEXT) return { ok: false, motivo: 'niente server vero dentro una prova' };
  try {
    const idToken = deps.idToken ? await deps.idToken() : await tokenOwner();
    if (!idToken) return { ok: false, motivo: 'nessuna credenziale dell’owner su questa macchina (node scripts/admin-login.mjs)' };
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(deps.tempoMs || TEMPO_MASSIMO_MS) : undefined;
    const res = await fetchRitentato(deps.url || URL_FIDUCIA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ data }),
      ...(signal ? { signal } : {}),
    }, { fetchImpl: deps.fetchImpl || fetch });
    let body = {};
    try { body = await res.json(); } catch (_) { body = {}; }
    const err = (body && body.error) || {};
    // Un 404 senza corpo d'errore è la funzione che manca; con il corpo è il server che non trova quello che si chiede.
    if (res.status === 404 && !err.message) return { ok: false, motivo: 'la funzione della fiducia non è pubblicata sul server' };
    if (res.status === 403 || err.status === 'PERMISSION_DENIED') return { ok: false, motivo: 'il server non riconosce questa credenziale come proprietario' };
    if (!res.ok) return { ok: false, motivo: err.message || `errore ${res.status}` };
    return { ok: true, result: (body && body.result) || {} };
  } catch (e) {
    return { ok: false, motivo: descriviErroreDiRete(e) };
  }
}
