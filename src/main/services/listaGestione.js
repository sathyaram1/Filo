// La lista della Gestione e le schede pubbliche tenute dal main fra un'apertura e l'altra, anche su disco (#2470):
// all'apertura si chiedono i cambiati e il conto, non tutto. Non legge da sé: le letture le passa chi lo crea.
// Il conto fra cambiati, conto e lettura intera sta qui; i tempi in PIENO_MS e MARGINE_MS.

'use strict';

// Oltre questo tempo dall'ultima lettura intera si rilegge tutto: è il ritardo massimo con cui si vede chi
// scrive senza firmare `updatedAt`, come il riallineamento del giro (feedbackLive RECONCILE_MS).
const PIENO_MS = 6 * 60 * 60 * 1000;
// Margine sull'ora della lettura precedente del server, per chi firma con l'orologio un po' indietro.
const MARGINE_MS = 20 * 1000;
// Due domande alle schede a meno di così rispondono con quello che c'è: l'apertura le chiede due volte di fila.
const SCHEDE_FRESCHE_MS = 30 * 1000;
// Freno contro un ciclo sulle schede cambiate: oltre, si rilegge tutto.
const SCHEDE_PAGINE_MAX = 20;

const firma = (campi) => (Array.isArray(campi) && campi.length ? campi.map(String).join(',') : '');

function leggiJson(leggiFile) {
  try {
    const raw = leggiFile();
    if (!raw) return null;
    const v = JSON.parse(String(raw));
    return v && typeof v === 'object' ? v : null;
  } catch (_) { return null; }
}

/**
 * Le righe della Gestione. `carica` torna { rows, complete, readTime, pienoAt, daCopia }:
 * `pienoAt` è l'ora dell'ultima lettura intera, che il giro usa per contare il prossimo riallineamento.
 *   leggiTutti({ fields })                → { rows, complete, readTime }
 *   leggiCambiati({ since, fields })      → { rows, complete, readTime }
 *   conta()                               → intero | null
 *   leggiFile() / scriviFile(testo) / togliFile()
 */
function creaLista({
  leggiTutti, leggiCambiati, conta,
  leggiFile = () => null, scriviFile = () => {}, togliFile = () => {},
  adesso = () => Date.now(), pienoMs = PIENO_MS, margineMs = MARGINE_MS,
} = {}) {
  let copia;          // undefined = disco non ancora letto; null = niente
  let inVolo = null;

  function copiaPer(chi, campi) {
    if (copia === undefined) copia = leggiJson(leggiFile);
    const c = copia;
    if (!c || c.chi !== chi || c.campi !== firma(campi) || !Array.isArray(c.rows) || !c.readTime) return null;
    if (!(adesso() - Number(c.pienoAt) < pienoMs)) return null;
    return c;
  }

  function metti(c) {
    copia = c;
    Promise.resolve().then(() => scriviFile(JSON.stringify(c))).catch(() => {});
  }

  async function daCapo(chi, campi) {
    const inizio = adesso();
    const r = await leggiTutti({ fields: campi });
    const rows = Array.isArray(r && r.rows) ? r.rows : [];
    const complete = !!(r && r.complete !== false);
    const readTime = String((r && r.readTime) || '');
    if (complete && readTime) metti({ v: 1, chi, campi: firma(campi), readTime, pienoAt: inizio, rows });
    return { rows, complete, readTime, pienoAt: inizio, daCopia: false };
  }

  async function dallaCopia(c, campi) {
    const since = new Date(Math.max(0, Date.parse(c.readTime) - margineMs)).toISOString();
    const [cambiati, n] = await Promise.all([
      leggiCambiati({ since, fields: campi }),
      Promise.resolve().then(conta).catch(() => null),
    ]);
    if (!cambiati || cambiati.complete === false || !cambiati.readTime || !Number.isInteger(n)) return null;
    const perId = new Map(c.rows.filter((r) => r && r._id).map((r) => [String(r._id), r]));
    for (const r of Array.isArray(cambiati.rows) ? cambiati.rows : []) {
      if (!r || !r._id) continue;
      const mia = perId.get(String(r._id));
      if (mia && mia._updateTime && r._updateTime && r._updateTime < mia._updateTime) continue;
      perId.set(String(r._id), r);
    }
    // Un conto diverso è una cancellazione o un arrivo che i cambiati non dicono: si rilegge tutto.
    if (perId.size !== n) return null;
    const rows = Array.from(perId.values());
    const readTime = String(cambiati.readTime);
    metti({ ...c, readTime, rows });
    return { rows, complete: true, readTime, pienoAt: Number(c.pienoAt), daCopia: true };
  }

  async function carica({ chi = '', campi = null } = {}) {
    const c = copiaPer(String(chi || ''), campi);
    if (c) {
      let r = null;
      try { r = await dallaCopia(c, campi); } catch (_) { r = null; }
      if (r) return r;
    }
    return daCapo(String(chi || ''), campi);
  }

  return {
    /** Due aperture insieme pagano una lettura sola. */
    carica(opts) {
      if (inVolo) return inVolo;
      inVolo = carica(opts).finally(() => { inVolo = null; });
      return inVolo;
    },
    // All'uscita dall'account la copia non resta sul disco.
    dimentica() {
      copia = null;
      try { togliFile(); } catch (_) {}
    },
  };
}

/**
 * Le schede pubbliche in mano al main: tutte alla prima lettura e ogni `pienoMs`, nel mezzo le sole cambiate
 * dal segnalibro (`publishedAt`), come la bacheca. Le scritture del main le aggiorna chi le fa (`scritta`, `tolta`).
 *   leggiTutte()                          → [scheda]
 *   leggiCambiate({ since })              → { rows, complete }
 */
function creaSchede({
  leggiTutte, leggiCambiate,
  leggiFile = () => null, scriviFile = () => {},
  adesso = () => Date.now(), pienoMs = PIENO_MS, frescheMs = SCHEDE_FRESCHE_MS, pagineMax = SCHEDE_PAGINE_MAX,
} = {}) {
  let stato;          // { perId: Map, segnalibro, pienoAt, guardateAt }
  let inVolo = null;

  function segna(perId, righe, segnalibro) {
    let s = segnalibro;
    for (const r of righe) {
      if (!r || !r._id) continue;
      perId.set(String(r._id), r);
      const p = String(r.publishedAt || '');
      if (p > s) s = p;
    }
    return s;
  }

  function salva() {
    const c = { v: 1, segnalibro: stato.segnalibro, pienoAt: stato.pienoAt, rows: Array.from(stato.perId.values()) };
    Promise.resolve().then(() => scriviFile(JSON.stringify(c))).catch(() => {});
  }

  function dalDisco() {
    const c = leggiJson(leggiFile);
    if (!c || !Array.isArray(c.rows) || !(adesso() - Number(c.pienoAt) < pienoMs)) return null;
    const perId = new Map();
    const segnalibro = segna(perId, c.rows, String(c.segnalibro || ''));
    return { perId, segnalibro, pienoAt: Number(c.pienoAt), guardateAt: 0 };
  }

  async function tutte() {
    const inizio = adesso();
    const rows = await leggiTutte();
    const perId = new Map();
    const segnalibro = segna(perId, Array.isArray(rows) ? rows : [], '');
    stato = { perId, segnalibro, pienoAt: inizio, guardateAt: inizio };
    salva();
  }

  async function cambiate() {
    let since = stato.segnalibro;
    for (let p = 0; p < pagineMax; p += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await leggiCambiate({ since });
      const righe = Array.isArray(r && r.rows) ? r.rows : [];
      stato.segnalibro = segna(stato.perId, righe, stato.segnalibro);
      if (r && r.complete) { stato.guardateAt = adesso(); salva(); return true; }
      if (stato.segnalibro === since) break;
      since = stato.segnalibro;
    }
    return false;
  }

  async function leggi({ fresh = false } = {}) {
    if (stato === undefined) stato = dalDisco();
    const ora = adesso();
    if (!fresh && stato && ora - stato.guardateAt < frescheMs) return;
    if (fresh || !stato || ora - stato.pienoAt >= pienoMs || !stato.segnalibro) { await tutte(); return; }
    if (!(await cambiate())) await tutte();
  }

  return {
    async tutte(opts) {
      if (!inVolo) inVolo = leggi(opts).finally(() => { inVolo = null; });
      await inVolo;
      return stato ? Array.from(stato.perId.values()) : [];
    },
    scritta(id, scheda) {
      if (!stato || !id) return;
      stato.perId.set(String(id), { ...(stato.perId.get(String(id)) || {}), ...scheda, _id: String(id) });
      salva();
    },
    tolta(id) {
      if (!stato || !id) return;
      stato.perId.delete(String(id));
      salva();
    },
    // Una scrittura di cui non si sa l'esito: la prossima domanda rilegge tutto.
    dimentica() { if (stato) { stato.pienoAt = 0; stato.guardateAt = 0; } },
  };
}

module.exports = { creaLista, creaSchede, PIENO_MS, MARGINE_MS, SCHEDE_FRESCHE_MS };
