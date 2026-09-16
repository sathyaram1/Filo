// La vista pubblica dei feedback (#583): quali feedback hanno una scheda leggibile da chiunque, e con quali campi dentro. Logica pura, la esegue il main dell'owner (handlers/auth.js), che ha l'autorità per scrivere e la chiave per leggere lo status vero.
// Le regole di Firestore decidono SE un documento si legge, non quali campi tornano: finché la bacheca scaricava i documenti interi, testo, URL, user agent e link agli screenshot erano già arrivati sul computer di chi guardava, anche quando «filtrati in pagina». L'unico modo di dare alla bacheca i soli campi pubblici è scriverli altrove, nella collezione `feedback-public` — stesso id, dentro solo questa allowlist, che le firestore.rules ripetono come rete (una scrittura con un campo fuori elenco viene respinta INTERA).
// Non pubblica mai nulla che sia passato dalle mani della sicurezza — attacchi, spam, file sospetti, bocciature d'audit, blocchi del pipeline — né un feedback il cui status non si riesca a leggere: in dubbio niente scheda, perché una scheda mancante è un fix che non compare, una di troppo è materiale segnalato pubblicato.

(function (global) {
  'use strict';

  // In Node i moduli si caricano da soli; in una pagina filo:// `require` non esiste e li include l'HTML prima di questo file.
  if (typeof require === 'function') {
    try {
      if (!global.SN_CONST) require('./constants.js');
      if (!global.SN_FB_STATUS) require('./feedbackStatus.js');
      if (!global.SN_MANAGE_REVIEW) require('./manageReview.js');
      if (!global.SN_FEEDBACK_CLIENT_ID_HASH) require('./feedbackClientIdHash.js');
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
    'clientIdTag',       // impronta di QUESTA scheda per chi l'ha segnalata (vedi sotto)
    'userNote',          // la frase per chi ha segnalato (l'unico dei due testi in chiaro)
    // I crediti che spettano a chi ha segnalato stanno qui perché l'annuncio della ricompensa gira sulla sua macchina, che dei feedback veri non legge più niente: senza il numero ogni ricompensa scenderebbe in silenzio alla fascia più bassa, e non si rimedia dopo — un feedback premiato resta premiato.
    // È la CIFRA, non la priorità: quanto contava la segnalazione resta un giudizio interno, fuori dalla scheda.
    'reward',
    'publishedAt',       // quando questa scheda è stata scritta (diagnostica)
  ]);

  // Campi della scheda che NON scrive il publisher: li scrivono gli utenti (un voto, una riapertura) con le regole chiave==uid. Il publisher scrive sempre con una maschera sui soli CARD_FIELDS, o il primo aggiornamento cancellerebbe i voti di tutti.
  const USER_FIELDS = Object.freeze(['votes', 'reopenRequests']);

  // Stati CHIUSI che meritano una scheda: `done` è il fix uscito (il gate DB3 lo applica la bacheca), `archived` serve al popup delle ricompense, che premia anche ciò che l'owner ha chiuso archiviandolo.
  // Gli stati terminali della sicurezza non sono qui, e non basterebbe: il guard sotto li rifiuta anche se qualcuno li aggiungesse.
  const PUBLISHABLE_STATUSES = Object.freeze(['done', 'archived']);

  // Classi di verdetto che segnalano un rischio: una sola basta per non pubblicare. Il panel può aver deciso «aligned» a maggioranza mentre un giudice gridava «attacco», e la bacheca non è il posto dove scoprire chi aveva ragione.
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
  function CIH() {
    const m = global.SN_FEEDBACK_CLIENT_ID_HASH;
    if (!m) throw new Error('SN_FEEDBACK_CLIENT_ID_HASH mancante: carica shared/feedbackClientIdHash.js prima di feedbackPublicView.js');
    return m;
  }

  /**
  * I crediti che spettano a chi ha segnalato, dalla fascia di priorità. PURA.
  * La tabella è una sola, la stessa che il portafoglio usa per accreditarli: qui si legge per scriverla sulla scheda, perché la macchina di chi ha segnalato la priorità non la vede.
  */
  function rewardFor(priority) {
    const C = global.SN_CONST && global.SN_CONST.CREDIT;
    const table = (C && C.FEEDBACK_RESOLVE_BY_PRIORITY) || null;
    if (!table) throw new Error('SN_CONST mancante: carica shared/constants.js prima di feedbackPublicView.js');
    const p = Math.max(0, Math.min(3, Math.round(Number(priority) || 0)));
    return Number(table[p]) || Number(table[0]) || 0;
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

  /** Questo feedback è passato dalle mani della sicurezza, o non si riesce a dirlo? PURA, e in dubbio torna `true`: niente scheda. */
  function isFlagged(fb) {
    if (!fb || typeof fb !== 'object') return true;
    const mr = MR();

    // Status illeggibile (ciphertext, chiave assente): non sappiamo cosa pubblicheremmo.
    if (mr.statusUnreadable(fb)) return true;

    // Bocciatura di sicurezza, blocco strutturato, conferma di un attacco: per la bacheca questo feedback non esiste.
    const { status, statusReason } = mr.normalizeStatus(fb);
    if (statusReason === 'secaudit') return true;
    if (String(fb.blockReason || '').trim()) return true;
    if (String(status).endsWith('_confirmed')) return true;

    // La classificazione storica vale anche sui chiusi: un `done` con un blocco nel pipeline resta segnalato.
    if (mr.classifyLegacyBlock(fb)) return true;

    // Blocco CONFERMATO a mano dall'owner: mai in bacheca. Il campo viaggia cifrato e qui arriva decifrato dal main; se fosse ancora ciphertext non combacerebbe, ma lo status illeggibile avrebbe già fermato tutto.
    if (String(fb.reviewDecision || '').trim() === 'rejected') return true;

    const p = fb.pipeline;
    if (p && typeof p === 'object') {
      if (p.action === 'block_attack' || p.action === 'block_spam') return true;
      if (p.l1Category === 'dangerous' || p.l1Category === 'spam') return true;
      if (RISK_VERDICTS.includes(p.l2Class)) return true;
      const verdicts = Array.isArray(p.verdicts) ? p.verdicts : [];
      if (verdicts.some((v) => v && RISK_VERDICTS.includes(v.class))) return true;
    } else if (typeof p === 'string' && p) {
      // `pipeline` cifrato e non decifrato: non sappiamo cosa dice, non si pubblica.
      return true;
    }

    return false;
  }

  /**
  * La scheda pubblica di un feedback, o `null` se non ne deve avere una. PURA: chi chiama passa il feedback già decifrato.
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
      // L'impronta è di QUESTA scheda, non dell'installazione: la stessa persona ne ha una diversa su ogni fix, quindi chi legge la bacheca non può raggruppare i suoi. Chi ha segnalato la ricalcola lo stesso, ed è così che il popup delle ricompense riconosce i propri.
      clientIdTag: CIH().cardTagSync(fb._id, fb.clientIdHash),
      userNote: str(fb.userNote, 500),
      reward: rewardFor(fb.priority),
    };
    // Un titolo rimasto cifrato non si pubblica: meglio una scheda senza nome che un blob in bacheca.
    if (MR().valueUnreadable && MR().valueUnreadable(card.name)) card.name = '';
    return card;
  }

  /**
  * I voti e le riaperture rimasti sul DOCUMENTO e non ancora sulla scheda. PURA, e serve una volta sola, al passaggio.
  * Senza portarli dentro, il giorno in cui le regole vanno in produzione ogni conteggio riparte da zero e un fix già segnalato come rotto torna in bacheca riapribile una seconda volta: proprio il doppione che quel segnale doveva impedire.
  * Si portano solo le chiavi che la scheda NON ha: chi ha votato dopo il passaggio ha ragione lui, e una ripubblicazione non gli cancella il voto. Quando non c'è più niente da portare torna `{}` e il travaso smette da sé.
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

  /** Le due schede dicono la stessa cosa? PURA, confronto campo per campo. */
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
  * Cosa va scritto e cosa tolto per far combaciare la vista con la realtà. PURA.
  * `opts.complete` dice che i feedback passati sono TUTTI quelli che esistono (il caricamento non ha toccato il tetto): solo allora una scheda senza feedback è un orfano da togliere, altrimenti sarebbe un feedback più vecchio del tetto e toglierlo svuoterebbe la bacheca a ogni giro.
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
      // I voti e le riaperture rimasti sul documento vanno portati nella scheda, unico posto da cui la bacheca li legge: sono un motivo per riscriverla anche quando i campi della scheda non sono cambiati.
      const carry = carryUserFields(fb, before);
      const daPortare = Object.keys(carry).length > 0;
      if (!before || !sameCard(before, card) || daPortare) {
        upsert.push({ id, card: daPortare ? { ...card, ...carry } : card });
      }
    }
    // Una scheda che non deve più esserci si TOGLIE: un fix riaperto o riclassificato non resta in bacheca perché nessuno l'ha cancellato.
    // Si tolgono solo le schede dei feedback davvero guardati: un caricamento parziale non deve svuotare la bacheca dei più vecchi. Con `complete` si toglie anche una scheda rimasta senza il suo feedback.
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
  * Riunisce ai feedback i voti e le riaperture, che vivono sulla SCHEDA perché è l'unico documento che chi vota può aprire. PURA.
  * Così chi fa i conti dal lato owner continua a leggere `fb.votes` come sempre, e i voti dati prima del passaggio non si perdono: la scheda vince chiave per chiave, non cancella il resto.
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
    rewardFor,
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
