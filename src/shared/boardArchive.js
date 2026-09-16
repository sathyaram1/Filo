// Archiviazione automatica a punteggio (DC3), logica pura: decide quando un fix già in produzione va archiviato, in base al voto degli utenti (works/broken pesati per credibilità, SN_FEEDBACK.tallyVotes) e a quanto tempo è spedito.
// NON tocca Firestore: il chiamante applica la decisione con lo stesso percorso dell'archiviazione manuale (consegna `archived` sul canale del server, o feedback_update).

(function (global) {
  'use strict';

  // La finestra delle 24h parte da quando il fix è ENTRATO IN PRODUZIONE, non dal primo voto: è deterministica (il primo voto dipende da quando un utente a caso ha votato) e si aggancia al modello di DB3 (`resolvedInVersion` + gate `isShipped`).
  // Non esistendo un campo «spedito il», si usa `resolvedAt` come proxy. Per i fix spediti nella stessa sessione coincide; per quelli rimasti in coda la differenza è il tempo che la versione ci ha messo a uscire, cioè un errore per DIFETTO: il gate resta più prudente, mai più permissivo.
  // Senza `resolvedAt` (storico pre-DB3) si ripiega sul voto più vecchio: meglio una stima cauta che bloccare per sempre l'archiviazione dei feedback più vecchi.
  const DAY_MS = 24 * 60 * 60 * 1000;

  const DEFAULTS = {
    // Soglia bassa per l'alpha: con pochi votanti un punteggio di 2 dice già «i pochi che hanno votato dicono che funziona».
    AUTO_ARCHIVE_THRESHOLD: 2,
    // Sotto questa soglia negativa il punteggio emerge all'owner come «gli utenti dicono che non va»: NON archivia e NON riapre.
    NEGATIVE_THRESHOLD: -2,
    // Età minima dalla produzione prima che l'auto-archiviazione possa scattare.
    MIN_AGE_MS: DAY_MS,
  };

  function toTime(v) {
    if (!v) return NaN;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : NaN;
  }

  // Stima della data di produzione: `resolvedAt`, altrimenti il voto più vecchio. NaN se non c'è nessun ancoraggio temporale.
  function productionTime(fb) {
    const resolvedAt = toTime(fb && fb.resolvedAt);
    if (Number.isFinite(resolvedAt)) return resolvedAt;
    const votes = (global.SN_FEEDBACK && global.SN_FEEDBACK.normalizeVotes(fb && fb.votes)) || {};
    const times = Object.values(votes).map((v) => toTime(v.at)).filter(Number.isFinite);
    if (!times.length) return NaN;
    return Math.min(...times);
  }

  // Campo `archiveOverride` sul documento, opzionale. 'archived': l'owner ha archiviato a mano e vince sempre, a prescindere da punteggio ed età. 'keep_open': l'owner ha guardato il punteggio e ha deciso di NON archiviare, quindi blocca l'automatismo anche sopra soglia.
  // Assente o altro: decidono solo punteggio ed età.
  function hasOwnerOverride(fb) {
    const o = fb && fb.archiveOverride;
    return o === 'archived' || o === 'keep_open' ? o : null;
  }

  // Solo una proiezione booleana che una UI owner può leggere per un badge: NON archivia e NON riapre.
  function usersSayBroken(fb, opts) {
    if (!fb) return false;
    const negativeThreshold = Number(
      (opts && opts.negativeThreshold) ?? DEFAULTS.NEGATIVE_THRESHOLD
    );
    if (!global.SN_FEEDBACK || !global.SN_FEEDBACK.tallyVotes) return false;
    const { score } = global.SN_FEEDBACK.tallyVotes(fb.votes);
    return score <= negativeThreshold;
  }

  // True SOLO se il fix va archiviato ora, con tutte queste condizioni insieme: è spedito; non è già `archived` (idempotenza); nessun override owner che blocchi; è passato almeno `minAgeMs` dalla produzione; il punteggio è >= `threshold`.
  // Senza `releasedVersion` isShipped è permissivo e tratterebbe qualunque done come spedito: qui invece non si auto-archivia: l'automazione non deve scattare alla cieca senza sapere se è davvero uscito.
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

  // Decisione pura su un elenco di fix risolti: ritorna { toArchive: [...id], toFlag: [...id] } senza scrivere niente. `toFlag` sono i fortemente negativi da segnalare all'owner, di cui NON si tocca lo stato.
  // La mutazione resta al chiamante, sul percorso esistente: consegna `status archived` in routine, `feedback_update` in locale.
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
