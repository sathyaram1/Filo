// La pratica di un lavoro locale (#908): da «#908» o da un id all'id Firestore.
// Non decide niente sul lavoro: la condizione per saltare L5 la rilegge il server dal documento.
// Test: tests/unit/praticaLocale.test.mjs.

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * «#908», «908», «#22.1» o un id Firestore. PURA.
 * Il cancelletto è facoltativo perché in bash e in PowerShell, non quotato, apre un commento.
 * @returns {{ ok: true, id?: string, seq?: number, subSeq?: number } | { ok: false, motivo: string }}
 */
export function parseRiferimento(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { ok: false, motivo: 'manca il feedback (--feedback 908, oppure l’id)' };
  const num = /^#?(\d{1,7})(?:\.(\d{1,6}))?$/.exec(s);
  if (num) {
    const seq = Number(num[1]);
    if (seq < 1) return { ok: false, motivo: `numero di feedback non valido: ${s}` };
    return { ok: true, seq, subSeq: num[2] !== undefined ? Number(num[2]) : 0 };
  }
  if (s.startsWith('#')) return { ok: false, motivo: `numero di feedback non valido: ${s}` };
  if (!ID_RE.test(s)) return { ok: false, motivo: `non è né un numero di feedback né un id: ${s.slice(0, 60)}` };
  return { ok: true, id: s };
}

/**
 * `--feedback <v>` / `--feedback=<v>` tolto dalla riga. PURA.
 * @returns {{ valore: string|null, resto: string[], errore?: string }}
 */
export function estraiOpzioneFeedback(argv) {
  const resto = [];
  let valore = null;
  const lista = Array.isArray(argv) ? argv.map((a) => String(a ?? '')) : [];
  for (let i = 0; i < lista.length; i += 1) {
    const a = lista[i];
    if (a === '--feedback') {
      const dopo = lista[i + 1];
      if (dopo === undefined || /^--/.test(dopo) || !dopo.trim()) {
        return { valore: null, resto: lista, errore: '--feedback vuole il numero dopo di sé (--feedback 908): se l’hai scritto «#908» senza virgolette, la conchiglia l’ha preso per un commento' };
      }
      if (valore !== null) return { valore: null, resto: lista, errore: '--feedback una volta sola' };
      valore = dopo;
      i += 1;
      continue;
    }
    if (a.startsWith('--feedback=')) {
      if (valore !== null) return { valore: null, resto: lista, errore: '--feedback una volta sola' };
      valore = a.slice('--feedback='.length);
      if (!valore.trim()) return { valore: null, resto: lista, errore: '--feedback vuole il numero dopo di sé (--feedback=908)' };
      continue;
    }
    resto.push(a);
  }
  return { valore, resto };
}

/**
 * Il riferimento risolto all'id Firestore, in rete. Un numero con più documenti
 * (i vecchi #N.k) prende quello col subSeq chiesto, 0 se non detto.
 * @returns {Promise<{ ok: true, id: string, seq: number|null } | { ok: false, motivo: string }>}
 */
export async function risolviFeedback(raw, { bearer, base, fetchImpl = fetch } = {}) {
  const r = parseRiferimento(raw);
  if (!r.ok) return r;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` };
  if (r.id) {
    const res = await fetchImpl(`${base}/feedback/${encodeURIComponent(r.id)}?mask.fieldPaths=seq`, { headers });
    if (res.status === 404) return { ok: false, motivo: `nessun feedback con id ${r.id}` };
    if (!res.ok) return { ok: false, motivo: `lettura del feedback fallita (${res.status})` };
    const doc = await res.json();
    const seq = Number(doc?.fields?.seq?.integerValue) || null;
    return { ok: true, id: r.id, seq };
  }
  const q = {
    structuredQuery: {
      from: [{ collectionId: 'feedback' }],
      where: { fieldFilter: { field: { fieldPath: 'seq' }, op: 'EQUAL', value: { integerValue: String(r.seq) } } },
      select: { fields: [{ fieldPath: 'subSeq' }] },
      limit: 50,
    },
  };
  const res = await fetchImpl(`${base}:runQuery`, { method: 'POST', headers, body: JSON.stringify(q) });
  if (!res.ok) return { ok: false, motivo: `ricerca di #${r.seq} fallita (${res.status})` };
  const righe = (await res.json()).filter((x) => x && x.document);
  const giusto = righe.find((x) => (Number(x.document.fields?.subSeq?.integerValue) || 0) === r.subSeq);
  if (!giusto) return { ok: false, motivo: `nessun feedback #${r.seq}${r.subSeq ? `.${r.subSeq}` : ''}` };
  return { ok: true, id: giusto.document.name.split('/').pop(), seq: r.seq };
}
