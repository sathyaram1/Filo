// Toglie la fiducia (#1148) a un feedback, col token dell'owner: la chiede chi scrive una nota senza un biglietto pulito
// (#1428). Darla da qui non si può: la dà solo l'owner, in Gestione (sentinella: tests/unit/lavoroLocaleApprovato.test.mjs).

import { chiamaOwnerFiducia } from './owner-fiducia.mjs';

export { URL_FIDUCIA, TEMPO_MASSIMO_MS } from './owner-fiducia.mjs';

/**
 * → { ok: true } | { ok: false, motivo }. Mai un'eccezione: chi chiama non scrive la nota se non è ok.
 * deps: quelli di chiamaOwnerFiducia.
 */
export async function togliFiducia(feedbackId, deps = {}) {
  const id = String(feedbackId || '').trim();
  if (!id) return { ok: false, motivo: 'manca il feedback' };
  const r = await chiamaOwnerFiducia({ op: 'togli', feedbackId: id }, deps);
  if (!r.ok) return r;
  if (r.result.ok === false) return { ok: false, motivo: r.result.detail || r.result.reason || 'il server non l’ha tolta' };
  return { ok: true };
}
