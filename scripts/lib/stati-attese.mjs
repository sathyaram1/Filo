// Le attese di un feedback lette in rete, ognuna col suo stato (fuso, non ancora fuso, chiuso, cancellato, non letto).
// Le usano feedback:leggi, per stamparle, e owner-feedback, per non togliere in silenzio quelle vive (#1756).
// «Fuso» lo decide SN_FB_ATTESE.statoAttesa. Test: tests/unit/feedbackAttese.test.mjs.

import { FIRESTORE_BASE } from './firestore-auth.mjs';
import '../../src/shared/feedbackStatus.js';
import '../../src/shared/feedbackAttese.js';

const MASCHERA = ['status', 'resolvedInVersion', 'seq', 'subSeq'].map((c) => `mask.fieldPaths=${c}`).join('&');

/** Il campo `waitsFor` letto dall'API REST: [{ id, num }]. PURA. */
export function atteseDaCampo(v) {
  return (v?.arrayValue?.values || []).map((x) => ({
    id: x?.mapValue?.fields?.id?.stringValue || '', num: x?.mapValue?.fields?.num?.stringValue || '',
  }));
}

/**
 * [{ id, num, stato }] per `attese` ({ id, num }), lette in parallelo. Una lettura fallita o uno stato che non si
 * decifra danno «ignoto», che come per la coda conta da non fuso: chi decide su queste righe non toglie un'attesa che non ha visto.
 * `decifra(grezzi)` → campi in chiaro; senza, la chiave dell'owner (lib/decrypt-feedback-fields.mjs).
 */
export async function statiInRete(attese, { bearer, base = FIRESTORE_BASE, fetchImpl = fetch, decifra } = {}) {
  const ATT = globalThis.SN_FB_ATTESE;
  const FS = globalThis.SN_FB_STATUS;
  const apri = decifra || (async (g) => (await import('./decrypt-feedback-fields.mjs')).decryptFeedbackFields(g));
  return Promise.all((Array.isArray(attese) ? attese : []).map(async (w) => {
    let doc;
    let num = ATT.normalizzaNumero(w.num);
    try {
      const res = await fetchImpl(`${base}/feedback/${encodeURIComponent(w.id)}?${MASCHERA}`, { headers: { Authorization: `Bearer ${bearer}` } });
      if (res.status === 404) doc = { missing: true };
      else if (res.ok) {
        const f = (await res.json()).fields || {};
        if (!num && f.seq?.integerValue) num = ATT.normalizzaNumero(`${f.seq.integerValue}.${f.subSeq?.integerValue || 0}`);
        const status = String((await apri({ _id: w.id, status: f.status?.stringValue || '' }))?.status || '').trim();
        if (FS.isCanonical(status)) doc = { status, resolvedInVersion: f.resolvedInVersion?.stringValue || '' };
      }
    } catch (_) { /* resta ignoto */ }
    return { id: w.id, num, stato: ATT.statoAttesa(doc) };
  }));
}

/** «#1741 (non ancora fuso)». PURA. */
export function rigaAttesa(w) {
  const ATT = globalThis.SN_FB_ATTESE;
  return `${ATT.etichetta(w)} (${ATT.ETICHETTA[w && w.stato] || ATT.ETICHETTA.ignoto})`;
}
