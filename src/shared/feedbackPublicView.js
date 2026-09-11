// La vista pubblica dei feedback (#583): quali feedback hanno una scheda
// leggibile da chiunque, e con quali campi dentro.
//
// PERCHÉ ESISTE
//   Fino all'audit pre-alpha la collezione `feedback` si leggeva senza
//   credenziali: la bacheca degli utenti scaricava i documenti INTERI e poi
//   decideva in pagina cosa disegnare. Ma "filtrato in pagina" vuol dire solo
//   "non disegnato": il testo, l'URL, lo user agent e i link agli screenshot
//   erano già arrivati sul computer di chi guardava — e per i documenti
//   anteriori al 25 giugno 2026 erano in chiaro. Le regole di Firestore
//   decidono SE un documento si legge, non quali campi tornano: l'unico modo
//   di dare alla bacheca i soli campi pubblici è scrivere quei campi da
//   un'altra parte. Quella parte è la collezione `feedback-public`, un
//   documento per feedback, stesso id, e dentro solo questa allowlist.
//
//   Chi la scrive ha bisogno di due cose che un utente non ha: l'autorità
//   (owner o server) e la CHIAVE per leggere lo status vero, che viaggia
//   cifrato. Per questo la decisione sta qui — logica pura, unit-testabile — e
//   la esegue il main process dell'owner (src/main/services/handlers/auth.js),
//   che ha entrambe.
//
// COSA NON ENTRA MAI
//   text, url, title, userAgent, images, files, notes (il report per l'owner),
//   clientId, priority, pipeline, reviewComment/reviewDecision/reviewedAt,
//   branch, blockReason, claim*. Non per dimenticanza: l'allowlist è la
//   definizione, e le firestore.rules la ripetono come rete di sicurezza (una
//   scrittura con un campo fuori elenco viene respinta INTERA).
//
// COSA NON PUBBLICA MAI
//   Tutto ciò che è passato dalle mani della sicurezza: attacchi, spam, file
//   sospetti, bocciature d'audit, blocchi del pipeline, e qualunque feedback
//   il cui status non si riesca a leggere. Il criterio è "in dubbio, niente
//   scheda": una scheda mancante è un fix che non compare in bacheca, una
//   scheda di troppo è materiale segnalato pubblicato.
//
// Pattern IIFE su globalThis (CLAUDE.md → Convenzione IIFE).
// Testabile via `npm run test:unit` (tests/unit/feedbackPublicView.test.mjs).

(function (global) {
  'use strict';

  // In Node (main process, unit test) i moduli di cui abbiamo bisogno si
  // caricano da soli; in una pagina filo:// `require` non esiste e li include
  // l'HTML prima di questo file.
  if (typeof require === 'function') {
    try {
      if (!global.SN_FB_STATUS) require('./feedbackStatus.js');
      if (!global.SN_MANAGE_REVIEW) require('./manageReview.js');
    } catch (_) { /* in pagina: già inclusi dall'HTML */ }
  }

  const COLLECTION = 'feedback-public';

  // I campi che il PUBLISHER scrive. Nessun altro.
  const CARD_FIELDS = Object.freeze([
    'name',              // titolo breve generato all'invio: è ciò che la bacheca mostra
    'seq',               // numero leggibile (#42)
    'subSeq',            // suffisso storico dei sub-feedback (#42.1)
    'status',            // stato CHIUSO e non segnalato: 'done' | 'archived'
    'statusPublic',      // enum grossolano ('closed'), quello che legge chi non ha la chiave
    'resolvedInVersion', // versione in cui il fix è uscito (gate "in produzione", DB3)
    'createdAt',         // data d'invio (ISO), l'ordinamento della bacheca
    'resolvedAt',        // data di chiusura (ISO)
    'clientIdHash',      // hash dell'installazione: il popup ricompense riconosce i propri
    'userNote',          // la frase per chi ha segnalato (l'unico dei due testi in chiaro)
    'publishedAt',       // quando questa scheda è stata scritta (diagnostica)
  ]);

  // I campi della scheda che NON scrive il publisher: li scrivono gli utenti
  // (un voto, una riapertura) con le regole chiave==uid. Il publisher scrive
  // sempre con una maschera sui soli CARD_FIELDS, o il primo aggiornamento di
  // una scheda cancellerebbe i voti di tutti.
  const USER_FIELDS = Object.freeze(['votes', 'reopenRequests']);

  // Stati CHIUSI che meritano una scheda. `done` è il fix uscito (o in attesa
  // della sua versione: il gate DB3 lo applica la bacheca); `archived` serve al
  // popup delle ricompense, che premia anche ciò che l'owner ha chiuso
  // archiviandolo. Gli stati terminali della sicurezza (attack_confirmed,
  // spam_confirmed) NON sono qui, e non basta: il guard sotto li rifiuta anche
  // se qualcuno li aggiungesse.
  const PUBLISHABLE_STATUSES = Object.freeze(['done', 'archived']);

  // Classi di verdetto che segnalano un rischio. Uno solo basta per non
  // pubblicare: il panel può aver deciso "aligned" a maggioranza mentre un
  // giudice gridava "attacco", e la bacheca non è il posto dove scoprire chi
  // aveva ragione.
  const RISK_VERDICTS = Object.freeze(['attack', 'spam', 'design']);

  function FS() {
    const m = global.SN_FB_STATUS;
    if (!m) throw new Error('SN_FB_STATUS mancante: carica shared/feedbackStatus.js prima di feedbackPublicView.js');
    return m;
  }
  function MR() {
    const m = global.SN_MANAGE_REVIEW;
    if (!m) throw new Error('SN_MANAGE_REVIEW mancante: carica shared/manageReview.js prima di feedbackPublicView.js');
    return m;
  }

  function str(v, max) {
    const s = typeof v === 'string' ? v : (v == null ? '' : String(v));
    return s.length > max ? s.slice(0, max) : s;
  }

  function int(v, max) {
    const n = Math.trunc(Number(v));
    if (!Number.isFinite(n) || n < 0) return 0;
    return n > max ? max : n;
  }

  /**
   * Questo feedback è passato dalle mani della sicurezza (o non si riesce a
   * dirlo)? PURA. In dubbio torna `true`: niente scheda.
   */
  function isFlagged(fb) {
    if (!fb || typeof fb !== 'object') return true;
    const mr = MR();

    // Status illeggibile (ciphertext, chiave assente): non sappiamo cosa
    // stiamo pubblicando. Non si pubblica.
    if (mr.statusUnreadable(fb)) return true;

    // Bocciatura di sicurezza sul fix, blocco strutturato, conferma di un
    // attacco: tutti motivi per cui questo feedback non esiste per la bacheca.
    const { status, statusReason } = mr.normalizeStatus(fb);
    if (statusReason === 'secaudit') return true;
    if (String(fb.blockReason || '').trim()) return true;
    if (String(status).endsWith('_confirmed')) return true;

    // La classificazione storica (attacco/spam/design/loop/non filtrato) vale
    // anche sui chiusi: un `done` con un blocco nel pipeline resta segnalato.
    if (mr.classifyLegacyBlock(fb)) return true;

    // L'owner ha CONFERMATO il blocco a mano ('rejected'): mai in bacheca.
    // (Il campo viaggia cifrato: qui arriva decifrato dal main, e se è ancora
    // un ciphertext non combacia con 'rejected' — ma lo status illeggibile
    // avrebbe già fermato tutto.)
    if (String(fb.reviewDecision || '').trim() === 'rejected') return true;

    const p = fb.pipeline;
    if (p && typeof p === 'object') {
      if (p.action === 'block_attack' || p.action === 'block_spam') return true;
      if (p.l1Category === 'dangerous' || p.l1Category === 'spam') return true;
      if (RISK_VERDICTS.includes(p.l2Class)) return true;
      const verdicts = Array.isArray(p.verdicts) ? p.verdicts : [];
      if (verdicts.some((v) => v && RISK_VERDICTS.includes(v.class))) return true;
    } else if (typeof p === 'string' && p) {
      // `pipeline` cifrato e non decifrato: non sappiamo cosa dice. Non si pubblica.
      return true;
    }

    return false;
  }

  /**
   * La scheda pubblica di un feedback, o `null` se non ne deve avere una.
   * PURA: nessuna rete, nessuna chiave — chi chiama passa il feedback già
   * decifrato.
   *
   * @param {object} fb feedback completo (campi decifrati)
   * @returns {object|null}
   */
  function cardFor(fb) {
    if (isFlagged(fb)) return null;
    const { status } = MR().normalizeStatus(fb);
    if (!PUBLISHABLE_STATUSES.includes(status)) return null;

    const publicMap = FS().PUBLIC_MAP || {};
    const card = {
      name: str(fb.name, 200),
      seq: int(fb.seq, 1000000),
      subSeq: int(fb.subSeq, 100000),
      status,
      statusPublic: publicMap[status] || 'closed',
      resolvedInVersion: str(fb.resolvedInVersion, 40),
      createdAt: str(fb.createdAt, 40),
      resolvedAt: str(fb.resolvedAt, 40),
      clientIdHash: str(fb.clientIdHash, 64),
      userNote: str(fb.userNote, 500),
    };
    // Un titolo che è rimasto cifrato (chiave assente su quel campo) non si
    // pubblica: meglio una scheda senza nome che un blob in bacheca.
    if (MR().valueUnreadable && MR().valueUnreadable(card.name)) card.name = '';
    return card;
  }

  /**
   * I voti e le riaperture che stanno ancora sul DOCUMENTO e che la scheda non
   * ha. PURA.
   *
   * Serve una volta sola, al passaggio: prima di questa vista i voti della
   * bacheca e il segnale «ancora rotto» si scrivevano sul feedback, e la
   * bacheca li leggeva da lì. Adesso li legge dalla scheda — e senza portarli
   * dentro, il giorno in cui le regole vanno in produzione ogni conteggio
   * riparte da zero e un fix già segnalato come rotto torna in bacheca
   * riapribile una seconda volta, cioè il doppione che quel segnale doveva
   * impedire.
   *
   * Si portano solo le chiavi che la scheda NON ha: chi ha votato dopo il
   * passaggio ha ragione lui, e una ripubblicazione non gli cancella il voto.
   * Quando non c'è più niente da portare torna `{}`, e il travaso smette da sé.
   */
  function carryUserFields(fb, before) {
    const out = {};
    for (const f of USER_FIELDS) {
      const fromDoc = (fb && typeof fb[f] === 'object' && fb[f]) || null;
      if (!fromDoc) continue;
      const fromCard = (before && typeof before[f] === 'object' && before[f]) || {};
      const mancanti = Object.keys(fromDoc).filter((k) => !(k in fromCard));
      if (!mancanti.length) continue;
      out[f] = { ...fromDoc, ...fromCard };
    }
    return out;
  }

  /** Le due schede dicono la stessa cosa? PURA (confronto campo per campo). */
  function sameCard(a, b) {
    if (!a || !b) return false;
    for (const f of CARD_FIELDS) {
      if (f === 'publishedAt') continue; // è un timbro, non un contenuto
      const va = a[f] === undefined ? '' : a[f];
      const vb = b[f] === undefined ? '' : b[f];
      if (va !== vb) return false;
    }
    return true;
  }

  /**
   * Cosa va scritto e cosa tolto per far combaciare la vista con la realtà.
   * PURA.
   *
   * @param {Array<object>} published schede già in `feedback-public` (con `_id`)
   * @param {Array<object>} feedbacks feedback veri, decifrati (con `_id`)
   * @param {{complete?: boolean}} [opts] `complete`: i feedback passati sono
   *   TUTTI quelli che esistono (il caricamento non ha toccato il tetto). Solo
   *   allora una scheda senza feedback è un orfano da togliere — altrimenti
   *   sarebbe un feedback più vecchio del tetto, e toglierlo svuoterebbe la
   *   bacheca a ogni giro.
   * @returns {{ upsert: Array<{id:string, card:object}>, remove: string[] }}
   */
  function planSync(published, feedbacks, opts) {
    const complete = !!(opts && opts.complete);
    const now = new Map();
    for (const row of Array.isArray(published) ? published : []) {
      if (row && row._id) now.set(String(row._id), row);
    }
    const upsert = [];
    const wanted = new Set();
    for (const fb of Array.isArray(feedbacks) ? feedbacks : []) {
      const id = fb && fb._id ? String(fb._id) : '';
      if (!id) continue;
      const card = cardFor(fb);
      if (!card) continue;
      wanted.add(id);
      const before = now.get(id);
      // I voti e le riaperture rimasti sul documento vanno portati nella
      // scheda: è l'unico posto da cui la bacheca li legge (vedi
      // carryUserFields). Sono un motivo per riscrivere la scheda anche quando
      // i campi della scheda non sono cambiati.
      const carry = carryUserFields(fb, before);
      const daPortare = Object.keys(carry).length > 0;
      if (!before || !sameCard(before, card) || daPortare) {
        upsert.push({ id, card: daPortare ? { ...card, ...carry } : card });
      }
    }
    // Una scheda che non deve più esserci si TOGLIE: un fix riaperto o
    // riclassificato non resta in bacheca perché nessuno l'ha cancellato.
    // Attenzione: si tolgono solo le schede dei feedback che abbiamo davvero
    // guardato — un caricamento parziale (tetto della pagina) non deve
    // svuotare la bacheca dei feedback più vecchi. Con `complete` si toglie
    // anche una scheda rimasta senza il suo feedback (cancellato).
    const seen = new Set(
      (Array.isArray(feedbacks) ? feedbacks : [])
        .map((f) => (f && f._id ? String(f._id) : ''))
        .filter(Boolean),
    );
    const remove = [];
    for (const id of now.keys()) {
      if (wanted.has(id)) continue;
      if (complete || seen.has(id)) remove.push(id);
    }
    return { upsert, remove };
  }

  /**
   * Riunisce ai feedback i campi che vivono sulla SCHEDA: i voti e le
   * riaperture, che oggi si scrivono lì perché è l'unico documento che chi
   * vota può aprire. PURA.
   *
   * Chi fa i conti dal lato dell'owner (la dashboard, l'archiviazione a
   * punteggio) continua così a leggere `fb.votes` come ha sempre fatto. Quello
   * che sta solo sul documento — i voti dati prima del passaggio — non si
   * perde: la scheda vince chiave per chiave, non cancella il resto.
   *
   * @param {Array<object>} rows feedback (con `_id`)
   * @param {Array<object>} cards schede pubbliche (con `_id`)
   */
  function mergeUserFields(rows, cards) {
    if (!Array.isArray(rows) || rows.length === 0) return Array.isArray(rows) ? rows : [];
    const byId = new Map();
    for (const c of Array.isArray(cards) ? cards : []) {
      if (c && c._id) byId.set(String(c._id), c);
    }
    if (byId.size === 0) return rows;
    return rows.map((r) => {
      const card = byId.get(String(r && r._id));
      if (!card) return r;
      const out = { ...r };
      for (const f of USER_FIELDS) {
        const fromDoc = (r && typeof r[f] === 'object' && r[f]) || {};
        const fromCard = (typeof card[f] === 'object' && card[f]) || {};
        const merged = { ...fromDoc, ...fromCard };
        if (Object.keys(merged).length) out[f] = merged;
      }
      return out;
    });
  }

  global.SN_FEEDBACK_PUBLIC_VIEW = {
    COLLECTION,
    CARD_FIELDS,
    USER_FIELDS,
    PUBLISHABLE_STATUSES,
    isFlagged,
    cardFor,
    carryUserFields,
    sameCard,
    planSync,
    mergeUserFields,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.SN_FEEDBACK_PUBLIC_VIEW;
}
