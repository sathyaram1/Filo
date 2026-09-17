// Archiviazione automatica a punteggio (DC3), logica pura: decide quando un fix in
// produzione va archiviato, in base al voto degli utenti e a quanto tempo è spedito.
// NON tocca Firestore: il chiamante applica la decisione come l'archiviazione manuale.

(function (global) {
  'use strict';

  // Le 24h partono da quando il fix è entrato in PRODUZIONE, non dal primo voto, che dipende
  // da chi ha votato. Proxy `resolvedAt`, o il voto più vecchio: sbaglia per difetto.
  const DAY_MS = 24 * 60 * 60 * 1000;

  const DEFAULTS = {
    // Soglia bassa per l'alpha: con pochi votanti un 2 dice già «i pochi che hanno votato
    // dicono che funziona».
    AUTO_ARCHIVE_THRESHOLD: 2,
    // Sotto questa soglia il punteggio emerge all'owner come «gli utenti dicono che non va»:
    // non archivia e non riapre.
    NEGATIVE_THRESHOLD: -2,
    // Età minima dalla produzione prima che l'auto-archiviazione possa scattare.
    MIN_AGE_MS: DAY_MS,
  };

  function toTime(v) {
    if (!v) return NaN;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : NaN;
  }

  // Stima della data di produzione: `resolvedAt`, altrimenti il voto più vecchio.
  // NaN se non c'è nessun ancoraggio temporale.
  function productionTime(fb) {
    const resolvedAt = toTime(fb && fb.resolvedAt);
    if (Number.isFinite(resolvedAt)) return resolvedAt;
    const votes = (global.SN_FEEDBACK && global.SN_FEEDBACK.normalizeVotes(fb && fb.votes)) || {};
    const times = Object.values(votes).map((v) => toTime(v.at)).filter(Number.isFinite);
    if (!times.length) return NaN;
    return Math.min(...times);
  }

  // `archiveOverride`: 'archived' è l'owner che ha archiviato a mano e vince sempre,
  // 'keep_open' è l'owner che ha deciso di no e blocca l'automatismo anche sopra soglia.
  function hasOwnerOverride(fb) {
    const o = fb && fb.archiveOverride;
    return o === 'archived' || o === 'keep_open' ? o : null;
  }

  // Solo una proiezione per un badge nella UI owner: non archivia e non riapre.
  function usersSayBroken(fb, opts) {
    if (!fb) return false;
    const negativeThreshold = Number(
      (opts && opts.negativeThreshold) ?? DEFAULTS.NEGATIVE_THRESHOLD
    );
    if (!global.SN_FEEDBACK || !global.SN_FEEDBACK.tallyVotes) return false;
    const { score } = global.SN_FEEDBACK.tallyVotes(fb.votes);
    return score <= negativeThreshold;
  }

  // True solo se il fix va archiviato ORA: spedito, non già archiviato, nessun override,
  // età ≥ minAgeMs, punteggio ≥ soglia. Senza `releasedVersion` non si archivia alla cieca.
  function shouldAutoArchive(fb, opts) {
    if (!fb) return false;
    const o = opts || {};
    const threshold = Number(o.threshold ?? DEFAULTS.AUTO_ARCHIVE_THRESHOLD);
    const minAgeMs = Number(o.minAgeMs ?? DEFAULTS.MIN_AGE_MS);
    const now = toTime(o.now) || Date.now();

    if ((fb.status || '') === 'archived') return false;

    const override = hasOwnerOverride(fb);
    if (override) return false; // 'archived' già fatto, 'keep_open' lo blocca

    const MR = global.SN_MANAGE_REVIEW;
    if (!MR || !MR.isShipped) return false; // manageReview non caricato: niente decisione
    if (!o.releasedVersion) return false; // senza versione rilasciata non sappiamo se è "in produzione"
    if (!MR.isShipped(fb, o.releasedVersion)) return false;

    const prodAt = productionTime(fb);
    if (!Number.isFinite(prodAt)) return false; // nessun ancoraggio temporale: non decidiamo
    if (now - prodAt < minAgeMs) return false;

    if (!global.SN_FEEDBACK || !global.SN_FEEDBACK.tallyVotes) return false;
    const { score } = global.SN_FEEDBACK.tallyVotes(fb.votes);
    return score >= threshold;
  }

  // Decisione pura: { toArchive, toFlag } senza scrivere niente. `toFlag` sono i fortemente
  // negativi da segnalare all'owner, di cui NON si tocca lo stato; muta il chiamante.
  function applyAutoArchive(feedbacks, opts) {
    const list = Array.isArray(feedbacks) ? feedbacks : [];
    const toArchive = [];
    const toFlag = [];
    for (const fb of list) {
      if (!fb || !fb._id) continue;
      if (shouldAutoArchive(fb, opts)) { toArchive.push(fb._id); continue; }
      if (usersSayBroken(fb, opts)) toFlag.push(fb._id);
    }
    return { toArchive, toFlag };
  }

  global.SN_BOARD_ARCHIVE = {
    DEFAULTS,
    shouldAutoArchive,
    usersSayBroken,
    hasOwnerOverride,
    applyAutoArchive,
    productionTime,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
