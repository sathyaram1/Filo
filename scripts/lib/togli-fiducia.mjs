// Toglie la fiducia (#1148) a un feedback, col token dell'owner: la chiede chi scrive una nota senza un biglietto pulito
// (#1428). Darla da qui non si può: la dà solo l'owner, in Gestione (sentinella: tests/unit/lavoroLocaleApprovato.test.mjs).

import { descriviErroreDiRete, fetchRitentato } from './rete.mjs';

const BASE = process.env.FILO_FUNCTIONS_BASE || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';
export const URL_FIDUCIA = `${BASE}/ownerFiducia`;
// Una funzione ferma parte a freddo in qualche secondo: aspettare un po' di più costa meno di una nota rifiutata.
export const TEMPO_MASSIMO_MS = 30000;

async function tokenOwner() {
  const { findAdminRefreshToken, mintIdToken } = await import('./firestore-auth.mjs');
  const refresh = findAdminRefreshToken();
  return refresh ? mintIdToken(refresh) : '';
}

/**
 * → { ok: true } | { ok: false, motivo }. Mai un'eccezione: chi chiama non scrive la nota se non è ok.
 * deps: { fetchImpl, idToken() → Promise<string>, url, tempoMs }.
 */
export async function togliFiducia(feedbackId, deps = {}) {
  const id = String(feedbackId || '').trim();
  if (!id) return { ok: false, motivo: 'manca il feedback' };
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
      body: JSON.stringify({ data: { op: 'togli', feedbackId: id } }),
      ...(signal ? { signal } : {}),
    }, { fetchImpl: deps.fetchImpl || fetch });
    let body = {};
    try { body = await res.json(); } catch (_) { body = {}; }
    const err = (body && body.error) || {};
    // Un 404 senza corpo d'errore è la funzione che manca; con il corpo è il server che non trova il feedback.
    if (res.status === 404 && !err.message) return { ok: false, motivo: 'la funzione che toglie la fiducia non è pubblicata sul server' };
    if (res.status === 403 || err.status === 'PERMISSION_DENIED') return { ok: false, motivo: 'il server non riconosce questa credenziale come proprietario' };
    if (!res.ok) return { ok: false, motivo: err.message || `errore ${res.status}` };
    const r = (body && body.result) || {};
    if (r.ok === false) return { ok: false, motivo: r.detail || r.reason || 'il server non l’ha tolta' };
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: descriviErroreDiRete(e) };
  }
}
