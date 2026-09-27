// Il freno sulle scansioni: guarda la RICHIESTA che parte, non come è scritto il
// comando che la fa. Una scansione di Firestore senza proiezione si ferma prima
// della rete. Si installa da sé con firestore-auth; regole e casi nel pattern
// `una-scansione-chiede-i-campi-che-usa-e-si-paga-una-volta.md`.

// Una query senza proiezione che porta via al massimo questi documenti, senza
// cursore, non è una scansione: è una lettura mirata (il massimo di `seq`, i
// pochi più recenti). Con un cursore è una pagina di un giro intero, e si ferma.
export const DOCUMENTI_SENZA_CAMPI_MAX = 10;

const SEGNO = Symbol.for('filo.frenoLetture');

export class ScansioneSenzaCampi extends Error {
  constructor(motivo) {
    super(`${motivo}. Nessun documento letto: chiedi solo i campi che usi — `
      + '`fields: [...]` nelle liste di SN_FEEDBACK, `select: { fields: [...] }` nella '
      + 'structuredQuery, `mask.fieldPaths=<campo>` nella lista REST.');
    this.name = 'ScansioneSenzaCampi';
    this.code = 'FILO_SCANSIONE_SENZA_CAMPI';
  }
}

function urlDi(input) {
  if (typeof input === 'string') return input;
  if (input && typeof input.url === 'string') return input.url;
  return String(input || '');
}

function corpoJson(body) {
  let testo = body;
  if (body instanceof Uint8Array) testo = Buffer.from(body).toString('utf8');
  if (typeof testo !== 'string') return null;
  try { return JSON.parse(testo); } catch (_) { return null; }
}

function numeroDi(v) {
  if (v && typeof v === 'object' && 'value' in v) return Number(v.value);
  return v === undefined || v === null ? NaN : Number(v);
}

/**
 * Il motivo per cui questa richiesta è una scansione senza campi, o null.
 * PURA: stessa risposta qualunque sia la grafia del comando che l'ha composta.
 */
export function scansioneSenzaCampi(input, init = {}) {
  let url;
  try { url = new URL(urlDi(input)); } catch (_) { return null; }
  let percorso;
  try { percorso = decodeURIComponent(url.pathname); } catch (_) { percorso = url.pathname; }
  const m = percorso.match(/\/databases\/[^/]+\/documents((?:\/[^/:]+)*)(?::([A-Za-z]+))?\/?$/);
  if (!m) return null;
  const segmenti = (m[1] || '').split('/').filter(Boolean);
  const azione = m[2] || '';
  const metodo = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();

  if (!azione && metodo === 'GET') {
    // Un numero pari di segmenti nomina un documento: una lettura sola.
    if (segmenti.length % 2 === 0) return null;
    const collezione = segmenti[segmenti.length - 1];
    const q = url.searchParams;
    if (q.getAll('mask.fieldPaths').some(Boolean)) return null;
    const pagina = numeroDi(q.get('pageSize'));
    if (!q.get('pageToken') && pagina > 0 && pagina <= DOCUMENTI_SENZA_CAMPI_MAX) return null;
    return `Scansione della collezione «${collezione}» (lista REST) senza mask.fieldPaths`;
  }

  if (azione === 'runQuery' && metodo === 'POST') {
    const corpo = corpoJson(init && init.body);
    const sq = corpo && corpo.structuredQuery;
    if (!sq || typeof sq !== 'object') return null;
    if (sq.select) return null;
    const conCursore = Boolean(sq.startAt || sq.endAt || numeroDi(sq.offset) > 0);
    const quanti = numeroDi(sq.limit);
    if (!conCursore && quanti > 0 && quanti <= DOCUMENTI_SENZA_CAMPI_MAX) return null;
    const da = Array.isArray(sq.from) ? sq.from.map((f) => f && f.collectionId).filter(Boolean) : [];
    return `Scansione della collezione «${da.join(', ') || '?'}» (runQuery) senza select`;
  }
  return null;
}

/** Una fetch che rifiuta le scansioni senza campi e passa tutto il resto a `vera`. */
export function conFreno(vera) {
  if (typeof vera !== 'function') return vera;
  if (vera[SEGNO]) return vera;
  const frenata = async function fetchConFreno(input, init) {
    const motivo = scansioneSenzaCampi(input, init);
    if (motivo) throw new ScansioneSenzaCampi(motivo);
    return vera.call(this, input, init);
  };
  frenata[SEGNO] = true;
  return frenata;
}

export function frenoInstallato(f = globalThis.fetch) {
  return Boolean(f && f[SEGNO]);
}

export function installaFreno() {
  globalThis.fetch = conFreno(globalThis.fetch);
}

installaFreno();
