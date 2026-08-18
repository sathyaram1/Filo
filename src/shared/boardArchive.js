// Archiviazione automatica a punteggio (DC3).
//
// Logica pura: decide quando un fix "Risolti" (DB3, già in produzione) va
// archiviato in automatico in base al voto degli utenti (DB4 — works/broken
// pesati per credibilità, vedi SN_FEEDBACK.tallyVotes) e da quanto tempo è
// spedito. NON tocca Firestore: il chiamante (routine cloud / dashboard
// owner) applica la decisione con lo stesso percorso usato per l'archiviazione
// manuale (la consegna `archived` sul canale del server / feedback_update).
//
// Espone SN_BOARD_ARCHIVE = { shouldAutoArchive, usersSayBroken,
// hasOwnerOverride, applyAutoArchive, DEFAULTS } su globalThis.
//
// Testabile via `npm run test:unit` (niente Electron, niente rete).
// Pattern IIFE su globalThis: vedi CLAUDE.md → "Convenzione di porting".

(function (global) {
  'use strict';

  // ── "24h dalla produzione" ───────────────────────────────────────────────
  // Scelta di design (vedi report): la finestra dei 24h parte da quando il
  // fix è ENTRATO IN PRODUZIONE, non dal primo voto. È più deterministico
  // ("primo voto" dipende da quando un utente a caso ha votato, non da un
  // evento del sistema) e si aggancia al modello già costruito da DB3
  // (`resolvedInVersion` + gate `isShipped`).
  //
  // Lo schema attuale del feedback NON ha un campo "spedito il" dedicato:
  // l'unico timestamp vicino è `resolvedAt` (scritto al passaggio a `done`,
  // vedi apply-triage.mjs). Per i feedback "in produzione" (isShipped===true)
  // usiamo `resolvedAt` come proxy della data di produzione — è scritto nello
  // stesso istante in cui `resolvedInVersion` viene fissato, quindi per i fix
  // shippati nella stessa sessione coincide; per quelli rimasti in coda
  // (`resolvedInVersion` futura al momento del `done`) la differenza fra
  // "resolvedAt" e "release effettiva" è il tempo che la versione ci ha messo
  // a uscire — un errore per DIFETTO sulla data di produzione reale (il fix è
  // spedito anche più tardi di resolvedAt), quindi il gate è SOLO più
  // prudente, mai più permissivo: non accorcia mai la finestra reale.
  //
  // Se `resolvedAt` manca (storico pre-DB3) si usa il voto più vecchio come
  // fallback dichiarato — meglio una stima cauta che bloccare per sempre
  // l'archiviazione automatica dei feedback più vecchi.
  const DAY_MS = 24 * 60 * 60 * 1000;

  const DEFAULTS = {
    // Soglia minima di punteggio per l'auto-archiviazione. Bassa per l'alpha:
    // con pochi votanti un punteggio di 2 è già un segnale di "i pochi che
    // hanno votato dicono che funziona".
    AUTO_ARCHIVE_THRESHOLD: 2,
    // Soglia (negativa) sotto la quale il punteggio "emerge" all'owner come
    // segnale "gli utenti dicono che non va" — NON archivia, NON riapre.
    NEGATIVE_THRESHOLD: -2,
    // Età minima dalla produzione prima che l'auto-archiviazione possa scattare.
    MIN_AGE_MS: DAY_MS,
  };

  function toTime(v) {
    if (!v) return NaN;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : NaN;
  }

  // Stima la data di "produzione" del fix: resolvedAt se presente, altrimenti
  // il voto più vecchio (fallback per lo storico pre-DB3, vedi commento sopra).
  // Ritorna NaN se non c'è nessun ancoraggio temporale disponibile.
  function productionTime(fb) {
    const resolvedAt = toTime(fb && fb.resolvedAt);
    if (Number.isFinite(resolvedAt)) return resolvedAt;
    const votes = (global.SN_FEEDBACK && global.SN_FEEDBACK.normalizeVotes(fb && fb.votes)) || {};
    const times = Object.values(votes).map((v) => toTime(v.at)).filter(Number.isFinite);
    if (!times.length) return NaN;
    return Math.min(...times);
  }

  // ── Override owner ───────────────────────────────────────────────────────
  // Campo `archiveOverride` sul documento feedback (opzionale):
  //   'archived'  → l'owner ha archiviato a mano: vince SEMPRE, a prescindere
  //                 da punteggio/età (e la mutazione status='archived' è già
  //                 stata applicata dal percorso manuale — qui serve solo a
  //                 non farlo sembrare "riapribile" da una logica futura).
  //   'keep_open' → l'owner ha guardato il punteggio e ha deciso ESPLICITAMENTE
  //                 di NON archiviare (es. dalla dashboard, bottone "non
  //                 archiviare"): blocca l'auto-archiviazione anche se il
  //                 punteggio supera la soglia.
  // Assente/altro → nessun override, decide solo punteggio/età.
  function hasOwnerOverride(fb) {
    const o = fb && fb.archiveOverride;
    return o === 'archived' || o === 'keep_open' ? o : null;
  }

  // PURA: il punteggio (DB4, riusa SN_FEEDBACK.tallyVotes) è "fortemente
  // negativo" → segnale per l'owner ("gli utenti dicono che non va"). NON
  // archivia, NON riapre: è solo una proiezione booleana che una UI owner può
  // leggere per mostrare un badge.
  function usersSayBroken(fb, opts) {
    if (!fb) return false;
    const negativeThreshold = Number(
      (opts && opts.negativeThreshold) ?? DEFAULTS.NEGATIVE_THRESHOLD
    );
    if (!global.SN_FEEDBACK || !global.SN_FEEDBACK.tallyVotes) return false;
    const { score } = global.SN_FEEDBACK.tallyVotes(fb.votes);
    return score <= negativeThreshold;
  }

  // PURA: true SOLO se il fix va archiviato in automatico ora.
  // Condizioni (TUTTE necessarie):
  //   1. è "in produzione" — shipped (DB3: isShipped, richiede releasedVersion
  //      + manageReview caricato; senza releasedVersion isShipped è permissivo
  //      e tratterebbe qualunque done come spedito — qui invece, in assenza di
  //      releasedVersion, NON auto-archiviamo: scelta prudente, l'automazione
  //      non deve scattare "alla cieca" senza sapere se è davvero uscito).
  //   2. non è già `archived` (idempotenza: non rifare un lavoro già fatto).
  //   3. nessun override owner che blocchi ('archived' è già fatto a mano,
  //      'keep_open' lo impedisce esplicitamente).
  //   4. è trascorso almeno `minAgeMs` (default 24h) dalla produzione.
  //   5. il punteggio (tallyVotes) è ≥ `threshold`.
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

  // Applicatore sottile: dato un elenco di feedback "Risolti" + opts, ritorna
  // SOLO gli id da archiviare (decisione pura) — la mutazione vera (PATCH
  // Firestore / queue-triage) resta al chiamante, che segue il percorso
  // esistente: in routine cloud `node scripts/queue-triage.mjs <id> archived
  // "auto-archiviato: punteggio <score> dopo 24h+"`; in sessione locale/owner
  // lo stesso `feedback_update` usato da "Archivia" in dashboard.
  // PURA (non scrive nulla): { toArchive: [...id], toFlag: [...id] } dove
  // `toFlag` sono i feedback "fortemente negativi" da segnalare (badge owner),
  // SENZA toccarne lo stato.
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
    // Esposta per i test / debug: utile per ispezionare la stima usata.
    productionTime,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
