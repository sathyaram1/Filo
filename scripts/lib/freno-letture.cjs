// Il freno sulle scansioni: guarda la RICHIESTA che parte, non come è scritta, e ferma prima della rete una scansione
// di Firestore senza proiezione. Si installa da sé, anche da src/shared/feedback.js fuori da Electron (#1335).
// Regole: patterns/una-scansione-chiede-i-campi-che-usa-e-si-paga-una-volta.md
'use strict';

// Una lettura senza proiezione che porta via al massimo questi documenti, senza cursore, non è una scansione: è una
// lettura mirata (il massimo di `seq`, i pochi più recenti). Vale per tutto il giro, non per la singola richiesta:
// dieci pagine da dieci avanzate con un filtro invece del cursore sono cento documenti interi.
const DOCUMENTI_SENZA_CAMPI_MAX = 10;

const SEGNO = Symbol.for('filo.frenoLetture');
const ILLEGGIBILE = Symbol('corpo illeggibile');
const AZIONI_DI_LETTURA = new Set(['runQuery', 'batchGet']);

class ScansioneSenzaCampi extends Error {
  constructor(motivo) {
    super(`${motivo}. Nessun documento letto: chiedi solo i campi che usi — `
      + '`fields: [...]` nelle liste di SN_FEEDBACK, `select: { fields: [...] }` nella '
      + 'structuredQuery, `mask.fieldPaths=<campo>` nella lista REST e nel batchGet.');
    this.name = 'ScansioneSenzaCampi';
    this.code = 'FILO_SCANSIONE_SENZA_CAMPI';
  }
}

function urlDi(input) {
  if (typeof input === 'string') return input;
  if (input && typeof input.url === 'string') return input.url;
  return String(input || '');
}

const tipo = (v) => Object.prototype.toString.call(v);

// Il testo del corpo, se si legge senza aspettare. Un flusso, un modulo o un oggetto qualunque il freno non li sa aprire.
function testoDelCorpo(body) {
  if (body === undefined || body === null) return '';
  if (typeof body === 'string') return body;
  if (tipo(body) === '[object ArrayBuffer]' || tipo(body) === '[object SharedArrayBuffer]') return Buffer.from(body).toString('utf8');
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString('utf8');
  if (tipo(body) === '[object URLSearchParams]') return String(body);
  return ILLEGGIBILE;
}

function corpoJson(body) {
  const testo = testoDelCorpo(body);
  if (testo === ILLEGGIBILE) return ILLEGGIBILE;
  try { return JSON.parse(testo); } catch (_) { return null; }
}

function numeroDi(v) {
  if (v && typeof v === 'object' && 'value' in v) return Number(v.value);
  return v === undefined || v === null ? NaN : Number(v);
}

// Una scelta dei campi vuota per il database vuol dire «tutti»: vale come nessuna scelta.
const nonVuoto = (s) => typeof s === 'string' && s.trim() !== '';
const proiezioneVera = (select) => Boolean(select && Array.isArray(select.fields)
  && select.fields.some((f) => f && nonVuoto(f.fieldPath)));
const mascheraVera = (mask) => Boolean(mask && Array.isArray(mask.fieldPaths) && mask.fieldPaths.some(nonVuoto));

function collezioneDelNome(nome) {
  const m = String(nome || '').match(/\/documents\/((?:[^/]+\/[^/]+\/)*)([^/]+)\/[^/]+$/);
  return m ? m[2] : '?';
}

/** Dove va la richiesta, se va ai documenti di Firestore: { url, segmenti, azione, metodo }, altrimenti null. PURA. */
function richiestaFirestore(input, init) {
  let url;
  try { url = new URL(urlDi(input)); } catch (_) { return null; }
  let percorso;
  try { percorso = decodeURIComponent(url.pathname); } catch (_) { percorso = url.pathname; }
  const m = percorso.match(/\/databases\/[^/]+\/documents((?:\/[^/:]+)*)(?::([A-Za-z]+))?\/?$/);
  if (!m) return null;
  const metodo = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
  return { url, segmenti: (m[1] || '').split('/').filter(Boolean), azione: m[2] || '', metodo };
}

/**
 * Cosa porta via questa richiesta, se è una lettura di documenti interi: { motivo } quando è una scansione da sola,
 * { mirata: { collezione: quanti } } quando è piccola (conta nel giro), null quando non è una lettura senza campi. PURA.
 */
function letturaSenzaCampi(input, init = {}) {
  const r = richiestaFirestore(input, init);
  if (!r) return null;
  const { url, segmenti, azione, metodo } = r;

  if (!azione && metodo === 'GET') {
    if (!segmenti.length) return null;
    const q = url.searchParams;
    if (q.getAll('mask.fieldPaths').some(nonVuoto)) return null;
    // Un numero pari di segmenti nomina un documento: uno solo, ma intero, e conta nel giro come uno della lettura a
    // gruppi; presi i nomi, leggerli uno per uno è la stessa scansione.
    if (segmenti.length % 2 === 0) return { mirata: { [segmenti[segmenti.length - 2]]: 1 }, nomi: [segmenti.join('/')] };
    const collezione = segmenti[segmenti.length - 1];
    const pagina = numeroDi(q.get('pageSize'));
    if (!q.get('pageToken') && pagina > 0 && pagina <= DOCUMENTI_SENZA_CAMPI_MAX) return { mirata: { [collezione]: pagina } };
    return { motivo: `Scansione della collezione «${collezione}» (lista REST) senza mask.fieldPaths` };
  }

  if (metodo !== 'POST' || !AZIONI_DI_LETTURA.has(azione)) return null;
  const corpoDato = init && init.body !== undefined ? init.body : (input && typeof input === 'object' ? input.body : undefined);
  const corpo = corpoJson(corpoDato);
  if (corpo === ILLEGGIBILE) return { motivo: `Lettura (${azione}) con un corpo che il freno non sa leggere: non so se dice i campi` };

  if (azione === 'batchGet') {
    if (!corpo || !Array.isArray(corpo.documents) || mascheraVera(corpo.mask)) return null;
    const mirata = {};
    for (const nome of corpo.documents) {
      const c = collezioneDelNome(nome);
      mirata[c] = (mirata[c] || 0) + 1;
    }
    if (corpo.documents.length > DOCUMENTI_SENZA_CAMPI_MAX) {
      return { motivo: `Lettura a gruppi di ${corpo.documents.length} documenti interi («${Object.keys(mirata).join(', ')}», batchGet) senza mask` };
    }
    return { mirata };
  }

  const sq = corpo && corpo.structuredQuery;
  if (!sq || typeof sq !== 'object') return null;
  if (proiezioneVera(sq.select)) return null;
  const da = Array.isArray(sq.from) ? sq.from.map((f) => f && f.collectionId).filter(Boolean) : [];
  const nome = da.join(', ') || '?';
  const conCursore = Boolean(sq.startAt || sq.endAt || numeroDi(sq.offset) > 0);
  const quanti = numeroDi(sq.limit);
  if (!conCursore && quanti > 0 && quanti <= DOCUMENTI_SENZA_CAMPI_MAX) return { mirata: { [nome]: quanti } };
  return { motivo: `Scansione della collezione «${nome}» (runQuery) senza select` };
}

/** Il motivo per cui questa richiesta, da sola, è una scansione senza campi, o null. PURA. */
function scansioneSenzaCampi(input, init = {}) {
  const l = letturaSenzaCampi(input, init);
  return l && l.motivo ? l.motivo : null;
}

// Il corpo di una Request o di un Blob si legge solo aspettando: lo si legge da una copia, l'originale resta intatto.
async function corpoPerIlFreno(input, init) {
  const i = init || {};
  let body = i.body;
  try {
    if (body === undefined && input && typeof input === 'object' && typeof input.clone === 'function' && input.body) {
      body = await input.clone().text();
    } else if (body && typeof body === 'object' && tipo(body) !== '[object ArrayBuffer]' && !ArrayBuffer.isView(body)
      && typeof body.text === 'function' && typeof body.arrayBuffer === 'function') {
      body = await body.text();
    }
  } catch (_) { body = {}; }
  return body === i.body ? init : { ...i, body };
}

/** Una fetch che rifiuta le scansioni senza campi, contando nel giro le letture piccole, e passa il resto a `vera`. */
function conFreno(vera) {
  if (typeof vera !== 'function') return vera;
  if (vera[SEGNO]) return vera;
  const presi = new Map();
  const letti = new Set();
  const frenata = async function fetchConFreno(input, init) {
    // Il corpo si apre solo per le letture che lo portano: un caricamento qualunque non si rilegge.
    const r = richiestaFirestore(input, init);
    const conCorpo = r && r.metodo === 'POST' && AZIONI_DI_LETTURA.has(r.azione) ? await corpoPerIlFreno(input, init) : init;
    const l = letturaSenzaCampi(input, conCorpo);
    if (l && l.motivo) throw new ScansioneSenzaCampi(l.motivo);
    // Lo stesso documento riletto (il contatore, la configurazione) non è una scansione: conta una volta sola.
    if (l && l.nomi && l.nomi.every((n) => letti.has(n))) return vera.call(this, input, init);
    if (l && l.mirata) {
      for (const [collezione, quanti] of Object.entries(l.mirata)) {
        const gia = presi.get(collezione) || 0;
        if (gia + quanti > DOCUMENTI_SENZA_CAMPI_MAX) {
          throw new ScansioneSenzaCampi(`Scansione a pezzi della collezione «${collezione}» senza campi: questo giro ne ha già `
            + `chiesti ${gia} documenti interi, e con questa richiesta sarebbero ${gia + quanti} (più di ${DOCUMENTI_SENZA_CAMPI_MAX})`);
        }
      }
      for (const [collezione, quanti] of Object.entries(l.mirata)) presi.set(collezione, (presi.get(collezione) || 0) + quanti);
      for (const n of l.nomi || []) letti.add(n);
    }
    return vera.call(this, input, init);
  };
  frenata[SEGNO] = true;
  return frenata;
}

function frenoInstallato(f = globalThis.fetch) {
  return Boolean(f && f[SEGNO]);
}

function installaFreno() {
  globalThis.fetch = conFreno(globalThis.fetch);
}

installaFreno();

module.exports = {
  DOCUMENTI_SENZA_CAMPI_MAX, ScansioneSenzaCampi, scansioneSenzaCampi, conFreno, frenoInstallato, installaFreno,
};
