// Il registro dei feedback mandati DA QUESTA installazione (#678).
// Non decide niente sulle ricompense: dice solo quali id chiedere e quando.
// Regole e scadenze: tests/unit/feedbackMine.test.mjs.

(function (global) {
  'use strict';

  const KEY = 'sn_feedback_miei';

  // Ogni quanto si torna a chiedere al server se una delle proprie
  // segnalazioni è stata chiusa. La risposta cambia una volta ogni mai, e
  // finché non cambia ogni domanda è una lettura buttata: prima girava a ogni
  // apertura di scheda nuova. Un invio o una riapertura azzerano l'attesa
  // (`ricordaId`), quindi chi ha appena agito non aspetta comunque.
  const INTERVALLO_MS = 4 * 60 * 60 * 1000;

  // Quanto a lungo un'installazione che esisteva PRIMA del registro continua a
  // cercarsi le proprie schede leggendole tutte. Il registro conosce solo i
  // feedback mandati da quando esiste: quelli di prima, se erano ancora aperti,
  // non li può conoscere. La scansione completa resta accesa per questo tempo
  // (una volta al giorno, non a ogni apertura di pagina) e poi si spegne da
  // sola: una segnalazione aperta oggi o si chiude entro un mese o non si
  // chiude più. Le installazioni NUOVE non la fanno mai.
  const EREDITA_MS = 30 * 24 * 60 * 60 * 1000;
  const EREDITA_GIRO_MS = 24 * 60 * 60 * 1000;

  // Quanti id si tengono. Un id sta in venti byte e chi manda mille
  // segnalazioni non esiste: il tetto è una difesa contro un file che cresce
  // per sempre, non una scelta di prodotto. Al tetto si buttano i PIÙ VECCHI,
  // che sono anche i più probabilmente già premiati.
  const MAX_ID = 2000;

  function vuoto() {
    return { ids: [], checkedAt: 0, ereditaFinoA: 0, ereditaUltimoGiro: 0 };
  }

  /** Lo stato normalizzato, qualunque cosa ci fosse su disco. PURA. */
  function normalizza(raw) {
    const s = vuoto();
    if (!raw || typeof raw !== 'object') return s;
    const ids = Array.isArray(raw.ids) ? raw.ids : [];
    const visti = new Set();
    for (const v of ids) {
      const id = String(v || '');
      if (!id || visti.has(id)) continue;
      visti.add(id);
      s.ids.push(id);
    }
    if (s.ids.length > MAX_ID) s.ids = s.ids.slice(s.ids.length - MAX_ID);
    s.checkedAt = Number(raw.checkedAt) || 0;
    s.ereditaFinoA = Number(raw.ereditaFinoA) || 0;
    s.ereditaUltimoGiro = Number(raw.ereditaUltimoGiro) || 0;
    return s;
  }

  /** Lo stato con `id` dentro, e l'attesa azzerata se l'id è nuovo. PURA. */
  function conId(stato, id) {
    const s = normalizza(stato);
    const key = String(id || '');
    if (!key || s.ids.includes(key)) return s;
    s.ids.push(key);
    if (s.ids.length > MAX_ID) s.ids = s.ids.slice(s.ids.length - MAX_ID);
    // Roba nuova da guardare: la prossima domanda non aspetta il proprio turno.
    s.checkedAt = 0;
    return s;
  }

  /** È ora di richiedere le proprie schede? PURA. */
  function scaduto(stato, now, intervalloMs) {
    const s = normalizza(stato);
    const gap = Number(intervalloMs) > 0 ? Number(intervalloMs) : INTERVALLO_MS;
    return (Number(now) || 0) - s.checkedAt >= gap;
  }

  /**
   * Questa installazione deve ancora cercarsi le schede leggendole tutte?
   * PURA. Vero solo dentro la finestra dell'eredità e non più di una volta al
   * giro: una scansione completa è la cosa che questo registro esiste per non
   * fare più.
   */
  function toccaScansione(stato, now) {
    const s = normalizza(stato);
    const t = Number(now) || 0;
    if (!s.ereditaFinoA || t >= s.ereditaFinoA) return false;
    return t - s.ereditaUltimoGiro >= EREDITA_GIRO_MS;
  }

  async function leggi() {
    const S = global.SN_STORAGE;
    if (!S || !S.getRaw) return vuoto();
    try { return normalizza(await S.getRaw(KEY, null)); }
    catch (_) { return vuoto(); }
  }

  async function scrivi(stato) {
    const S = global.SN_STORAGE;
    if (!S || !S.setRaw) return;
    try { await S.setRaw(KEY, normalizza(stato)); } catch (_) {}
  }

  /** Segna un feedback come mandato da qui. Best-effort: non blocca l'invio. */
  async function ricordaId(id) {
    const key = String(id || '');
    if (!key) return;
    await scrivi(conId(await leggi(), key));
  }

  /**
   * Timbra il controllo appena fatto, e impara gli identificativi trovati
   * strada facendo. RILEGGE il registro invece di sovrascriverlo con la copia
   * di prima: nel frattempo l'utente può aver mandato una segnalazione, e
   * quell'identificativo non si può perdere (sarebbe una ricompensa che non
   * arriva mai). Se ne è arrivato uno che questo controllo NON ha guardato,
   * l'attesa resta azzerata e la prossima apertura ci torna sopra.
   *
   * @param {number} at quando è stato fatto il controllo
   * @param {{visti?: string[], impara?: string[], scansione?: boolean}} opts
   */
  async function segnaControllo(at, { visti = [], impara = [], scansione = false } = {}) {
    let s = await leggi();
    for (const id of Array.isArray(impara) ? impara : []) s = conId(s, id);
    const guardati = new Set((Array.isArray(visti) ? visti : []).map(String));
    const tuttoGuardato = s.ids.every((id) => guardati.has(id));
    s.checkedAt = tuttoGuardato ? (Number(at) || 0) : 0;
    if (scansione) s.ereditaUltimoGiro = Number(at) || 0;
    await scrivi(s);
    return s;
  }

  /**
   * Il registro non esisteva e questa installazione aveva già mandato
   * feedback: accende la finestra dell'eredità. Su un'installazione nuova
   * (nessun identificativo di segnalazione) non si accende, e la scansione
   * completa non parte mai.
   */
  async function inauguraSeServe(now, avevaSegnalato) {
    const S = global.SN_STORAGE;
    if (!S || !S.getRaw) return;
    // Su un'installazione che non ha mai segnalato niente non si scrive
    // NIENTE: il registro nasce al primo invio (`ricordaId`), e un registro
    // vuoto scritto qui potrebbe sovrascrivere proprio quell'invio.
    if (!avevaSegnalato) return;
    let raw = null;
    try { raw = await S.getRaw(KEY, null); } catch (_) { return; }
    if (raw && typeof raw === 'object') return; // già inaugurato
    const s = vuoto();
    s.ereditaFinoA = (Number(now) || 0) + EREDITA_MS;
    await scrivi(s);
  }

  global.SN_FEEDBACK_MINE = {
    KEY,
    INTERVALLO_MS,
    EREDITA_MS,
    EREDITA_GIRO_MS,
    MAX_ID,
    vuoto,
    normalizza,
    conId,
    scaduto,
    toccaScansione,
    leggi,
    scrivi,
    ricordaId,
    segnaControllo,
    inauguraSeServe,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.SN_FEEDBACK_MINE;
}
