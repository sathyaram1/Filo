// «Quanti sono?» chiesto al server invece che contandoli in casa.
// Un conteggio costa una lettura ogni mille documenti; scaricarli per contarli
// ne costa una a testa (#680).

/** Il corpo della domanda. PURA, così una sentinella può guardarla. */
export function corpoConteggio(collectionId, filtro = null) {
  const structuredQuery = { from: [{ collectionId: String(collectionId) }] };
  if (filtro && filtro.field && filtro.value) {
    structuredQuery.where = {
      fieldFilter: {
        field: { fieldPath: String(filtro.field) },
        op: String(filtro.op || 'EQUAL'),
        value: filtro.value,
      },
    };
  }
  return { structuredAggregationQuery: { structuredQuery, aggregations: [{ alias: 'quanti', count: {} }] } };
}

/** Il numero dentro la risposta di runAggregationQuery, o NaN se non c'è. */
export function numeroDaRisposta(json) {
  for (const riga of Array.isArray(json) ? json : []) {
    const v = riga && riga.result && riga.result.aggregateFields && riga.result.aggregateFields.quanti;
    const n = v ? Number(v.integerValue ?? v.doubleValue) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

/**
 * Quanti documenti ci sono (eventualmente col filtro).
 * Ritorna NaN se il server non risponde o non sa contare: chi chiama torna al
 * conto fatto in casa, dichiarandolo. Un conteggio è un risparmio, non una
 * fonte di verità nuova, e un guasto qui non deve fermare una manutenzione.
 */
export async function contaDocumenti(base, apiKey, collectionId, {
  filtro = null, bearer = '', fetchImpl = fetch,
} = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  try {
    const res = await fetchImpl(`${base}:runAggregationQuery?key=${apiKey}`, {
      method: 'POST', headers, body: JSON.stringify(corpoConteggio(collectionId, filtro)),
    });
    if (!res.ok) return NaN;
    return numeroDaRisposta(await res.json());
  } catch (_) {
    return NaN;
  }
}
