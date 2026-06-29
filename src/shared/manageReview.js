// Logica pura per la sezione "Revisione" della dashboard di gestione.
// Espone SN_MANAGE_REVIEW = { classifyBlock, sortReview } su globalThis.
//
// Testabile via `npm run test:unit` (niente Electron, niente rete).
// Pattern IIFE su globalThis: vedi CLAUDE.md → "Convenzione di porting".

(function (global) {
  'use strict';

  // Motivi di blocco, in ordine di severità discendente.
  // color: usato come --mg-item-color nei CSS (border-left + badge).
  // `loop` è il blocco "duro" introdotto dal redesign delle routine: un fix che
  // fallisce la verifica avversariale 3 volte di fila (verifier→fixer) viene
  // messo in `blocked` con `blockReason: 'loop'` perché decida l'owner. Bordo
  // NERO, severità massima: è l'unico blocco che non viene dal pipeline di
  // sicurezza (attacco/spam/design), ma dall'iter di lavorazione bloccato.
  const REASONS = {
    loop:       { label: 'Loop',         color: '#111111', severity: 5 },
    // "Non filtrato": il panel dei giudici non si è completato (almeno un giudice
    // non ha votato). BIANCO per distinguerlo — non è una classe di rischio, è
    // "filtraggio incompleto" — ma per coerenza è trattato come il caso più severo
    // ai fini dell'instradamento (mai in coda: resta nei Ricevuti finché l'owner
    // non lo risolve o ri-valuta i giudici mancanti).
    unfiltered: { label: 'Non filtrato', color: '#ffffff', severity: 4 },
    attack:     { label: 'Attacco',      color: '#c0392b', severity: 3 },
    spam:       { label: 'Spam',         color: '#e08e0b', severity: 2 },
    design:     { label: 'Design',       color: '#5b6ee0', severity: 1 },
  };

  // Dimensione attesa del panel dei giudici per i feedback: 3 fissi + 1 dinamico.
  // Per la pipeline NUOVA il numero esatto è in `pipeline.expectedJudges`; per lo
  // STORICO (senza quel campo) usiamo questo default per dedurre se un panel è
  // parziale (meno verdetti del previsto = un giudice è saltato).
  const DEFAULT_PANEL_SIZE = 4;
  function panelSize(p) {
    if (p && Array.isArray(p.expectedJudges) && p.expectedJudges.length) {
      return p.expectedJudges.length;
    }
    return DEFAULT_PANEL_SIZE;
  }

  // Stati "chiusi": non vanno (più) giudicati, restano nei loro flussi.
  const CLOSED_STATUSES = ['done', 'verified', 'archived', 'ignored'];

  // Mittenti FIDATI = automazione dell'owner (owner:/routine:/agent:). I loro
  // feedback non sono attacchi: se risultano bloccati a livello di identità è un
  // errore (identità flaggata) e vanno ri-giudicati, non mostrati come "attacco".
  // Speculare a isTrustedIdentity nel backend (filo-security/data/identities.js).
  function isTrustedClient(clientId) {
    return /^(owner|routine|agent):/i.test(String(clientId || ''));
  }

  /**
   * Classifica un feedback nel pipeline di sicurezza.
   * @param {object} fb – oggetto feedback (con campo `pipeline` opzionale)
   * @returns {{ reason: string, color: string, severity: number, label: string }|null}
   *   null se il feedback non ha motivo di blocco (aligned / no pipeline).
   */
  function classifyBlock(fb) {
    // Override dell'owner: un feedback "accettato" (sbloccato a mano dalla
    // dashboard di revisione) NON è più un blocco — esce dalla colonna Bloccati
    // e rientra nel flusso normale. Vince su qualsiasi verdetto del pipeline.
    if (fb && fb.reviewDecision === 'accepted') return null;

    // Loop (redesign routine): un fix bloccato dopo 3 verifiche fallite di fila.
    // NON viene dal pipeline di sicurezza — è uno stato `blocked` con
    // `blockReason: 'loop'` scritto da dispatch/triage. Vince su tutto (severità
    // massima) perché è il blocco che richiede una decisione manuale dell'owner.
    if (fb && fb.status === 'blocked' && fb.blockReason === 'loop') {
      return { reason: 'loop', ...REASONS.loop };
    }

    const p = fb && fb.pipeline;
    const verdicts = (p && Array.isArray(p.verdicts)) ? p.verdicts.filter((v) => v && v.class) : [];
    const trusted = isTrustedClient(fb && fb.clientId);
    const status = (fb && fb.status) || 'new';
    // "Da giudicare": feedback aperto e in attesa di giudizio. Esclude i chiusi
    // (done/verified/archived/ignored) e i `clarify` (sono un dialogo con l'owner,
    // non in attesa dei giudici).
    const judgeable = !CLOSED_STATUSES.includes(status) && status !== 'clarify';

    // Mittente FIDATO (automazione dell'owner: owner:/routine:/agent:) SENZA
    // verdetti = i giudici non sono (ancora) girati su un feedback del proprietario
    // — spesso perché l'identità era stata flaggata per errore. NON è un blocco:
    // è "da ri-giudicare" (bianco). Va prima dei controlli di blocco identità.
    if (p && trusted && verdicts.length === 0 && judgeable) {
      return { reason: 'unfiltered', ...REASONS.unfiltered };
    }

    // Nessun pipeline: un feedback APERTO non ancora giudicato → bianco ("non
    // filtrato", da giudicare). Chiusi e `clarify` → nessun colore.
    if (!p) {
      return judgeable ? { reason: 'unfiltered', ...REASONS.unfiltered } : null;
    }

    // Blocchi di IDENTITÀ (L1) o panel COMPLETO che ha deciso "attacco/spam":
    // NON sono "non filtrati", sono decisioni vere → tengono il loro colore.
    // (Con un panel parziale l'instradamento forza `human_review`, quindi
    // `action: block_attack/block_spam` implica panel completo.)
    if (p.action === 'block_attack' || p.l1Category === 'dangerous') {
      return { reason: 'attack', ...REASONS.attack };
    }
    if (p.action === 'block_spam' || p.l1Category === 'spam') {
      return { reason: 'spam', ...REASONS.spam };
    }

    // Panel parziale ("non filtrato"): vince su attacco/spam/design perché
    // segnala che il filtraggio NON è affidabile (un giudice è saltato). Bianco.
    // Tre modi di rilevarlo:
    //   - `l2Unfiltered` (pipeline nuova: lo dichiara esplicitamente);
    //   - `l2Degraded` (panel a zero verdetti: tutti i giudici mancanti);
    //   - DEDOTTO (storico): alcuni verdetti ma MENO del panel atteso. Avere
    //     almeno un verdetto implica che L2 è girato (L1 era pulito), quindi
    //     verdetti < panel = un giudice è saltato.
    if (
      p.l2Unfiltered === true ||
      p.l2Degraded === true ||
      (verdicts.length > 0 && verdicts.length < panelSize(p))
    ) {
      return { reason: 'unfiltered', ...REASONS.unfiltered };
    }

    // Classi L2 a panel COMPLETO.
    if (p.l2Class === 'attack') {
      return { reason: 'attack', ...REASONS.attack };
    }
    if (p.l2Class === 'spam') {
      return { reason: 'spam', ...REASONS.spam };
    }

    // Design.
    if (p.l2Class === 'design') {
      return { reason: 'design', ...REASONS.design };
    }

    // aligned / nessuna segnalazione → non appare in Revisione.
    return null;
  }

  /**
   * Ordina un array di feedback per la colonna Revisione:
   *   severità DESC (attack > spam > design), poi createdAt DESC.
   * I feedback senza blocco vengono esclusi automaticamente (restano nell'array
   * originale e non dovrebbero essere passati qui, ma per sicurezza vengono
   * trattati come severità 0).
   */
  function sortReview(feedbacks) {
    return feedbacks.slice().sort((a, b) => {
      const ca = classifyBlock(a);
      const cb = classifyBlock(b);
      const sa = ca ? ca.severity : 0;
      const sb = cb ? cb.severity : 0;
      if (sb !== sa) return sb - sa;
      // A parità di severità: più recenti prima.
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return tb - ta;
    });
  }

  // ── DB3: "In produzione" = fix uscito in una versione RILASCIATA ──────────
  // Confronto versioni stile semver leggero ('0.2.9' < '0.2.10'). Self-contained
  // così manageReview non dipende dal caricamento di patchNotes nei test.
  function cmpVersion(a, b) {
    const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d < 0 ? -1 : 1;
    }
    return 0;
  }

  // Un feedback chiuso (`done`/`verified`) è "in produzione" SOLO se il suo fix
  // è davvero uscito in una versione rilasciata.
  //
  // - `releasedVersion` = "ultima versione rilasciata". La sorgente è la versione
  //   dell'APP IN ESECUZIONE (`app.getVersion()`), che il chiamante passa: l'owner
  //   gira sempre una build rilasciata, quindi la sua versione è, per definizione,
  //   l'ultima che gli utenti hanno. Senza `releasedVersion` non possiamo gattare
  //   → trattiamo il feedback come spedito (preserva il comportamento storico
  //   done→Risolti per chi non passa la versione: nessuna regressione).
  // - `resolvedInVersion` viene stampato sul feedback al momento del `done`
  //   (apply-triage.mjs lo mette = versione corrente di `package.json`, cioè
  //   quella in cui il fix è confluito). Un `done` con `resolvedInVersion` futura
  //   (non ancora rilasciata) NON è in produzione: resta in "In coda" finché
  //   quella versione esce. Un `done` storico SENZA `resolvedInVersion` è
  //   considerato già spedito (i fix chiusi prima di DB3 sono quasi certamente
  //   già usciti).
  function isShipped(fb, releasedVersion) {
    if (!releasedVersion) return true;
    const v = fb && fb.resolvedInVersion;
    if (!v) return true;
    return cmpVersion(v, releasedVersion) <= 0;
  }

  // ── Approvazione: cosa può stare "In coda" ────────────────────────────────
  // Un feedback è APPROVATO (può andare in coda, in attesa che Claude lo risolva)
  // SOLO se:
  //   - l'owner l'ha sbloccato a mano dalla dashboard (`reviewDecision==='accepted'`), OPPURE
  //   - la pipeline l'ha auto-approvato: tutti i giudici "aligned" E modalità
  //     automatica ON ⇒ azione `candidate_change`.
  // Tutto il resto (panel parziale/non filtrato, blocchi attacco/spam/design,
  // aligned con automatica OFF, feedback non ancora giudicati) NON è approvato e
  // resta nei "Ricevuti" in attesa dell'approvazione manuale dell'owner.
  function isApproved(fb) {
    if (!fb) return false;
    if (fb.reviewDecision === 'accepted') return true;
    const p = fb.pipeline;
    if (p && p.action === 'candidate_change') return true;
    return false;
  }

  // ── Dashboard unificata (DB1): mappatura feedback → tab ───────────────────
  // Le tab di `manage` (owner-only) sono:
  //   inbox    "Ricevuti"   → tutto ciò che richiede la mia approvazione: feedback
  //                           non ancora approvati (non giudicati, panel parziale,
  //                           bloccati attacco/spam/design, aligned con automatica OFF)
  //   queue    "In coda"    → feedback APPROVATI (auto o a mano) in attesa che
  //                           Claude li risolva
  //   resolved "Risolti"    → `done` + `verified` MA solo se "in produzione"
  //                           (resolvedInVersion ≤ releasedVersion, DB3); i fix
  //                           chiusi ma non ancora spediti restano in "In coda"
  //   archived "Archiviati" → `archived` (DB2)
  //   ignored / altro       → null (non mostrato nelle tab principali)

  // `opts.releasedVersion` (DB3): versione dell'app in esecuzione = ultima
  // rilasciata. Se assente, il gate "in produzione" è disattivo (done→resolved).
  function manageTabFor(fb, opts) {
    const s = (fb && fb.status) || 'new';
    const releasedVersion = opts && opts.releasedVersion;

    switch (s) {
      // DB3: un fix chiuso è in "Risolti" solo se davvero spedito; altrimenti
      // resta visibile in "In coda" (done-ma-non-ancora-rilasciato).
      case 'done':
      case 'verified':  return isShipped(fb, releasedVersion) ? 'resolved' : 'queue';
      case 'archived':  return 'archived';
      case 'ignored':   return null;
      // new/clarify/todo/review/blocked: l'approvazione decide la tab. Approvato
      // ⇒ In coda; altrimenti ⇒ Ricevuti (richiede la mia approvazione).
      default:          return isApproved(fb) ? 'queue' : 'inbox';
    }
  }

  // Feedback di una singola tab, già ordinati: "In coda" per severità del blocco
  // poi recenza (come la Revisione); le altre per createdAt DESC.
  // `opts.releasedVersion` (DB3) è passato a manageTabFor per il gate "Risolti".
  function listForManageTab(feedbacks, tab, opts) {
    const items = (feedbacks || []).filter((f) => manageTabFor(f, opts) === tab);
    // "Ricevuti" e "In coda" ordinano per severità del blocco poi recenza: così
    // nei Ricevuti i non-filtrati (bianchi) e i bloccati gravi salgono in cima.
    if (tab === 'queue' || tab === 'inbox') return sortReview(items);
    return items.slice().sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return tb - ta;
    });
  }

  // ── Preferiti ⭐ (DB2) ─────────────────────────────────────────────────────
  // Il flag `starred` è un "parcheggio per il futuro": l'owner lo mette su un
  // feedback qualsiasi, a prescindere dallo status. La tab Archiviati ha un
  // filtro ⭐ che, quando attivo, mostra TUTTI i preferiti (di ogni status),
  // non solo gli `archived`.
  function isStarred(fb) {
    return !!(fb && fb.starred === true);
  }

  // Lista per la tab Archiviati:
  //   starredOnly=false → i feedback in stato `archived` (recenti prima);
  //   starredOnly=true  → tutti i preferiti ⭐, di qualunque status (recenti prima).
  function listArchiveTab(feedbacks, opts) {
    const starredOnly = !!(opts && opts.starredOnly);
    const items = (feedbacks || []).filter((f) =>
      starredOnly ? isStarred(f) : manageTabFor(f) === 'archived');
    return items.slice().sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return tb - ta;
    });
  }

  // ── DC1: la board utente (filo://board/) ─────────────────────────────────
  // Superficie POSITIVA a permessi ridotti: mostra SOLO i fix già in produzione
  // (done/verified + spediti in una versione rilasciata, DB3) e MAI nulla del
  // red-team. Riusa il gate "Risolti" (listForManageTab → 'resolved'), poi
  // esclude per sicurezza qualunque feedback con un blocco nel pipeline
  // (attacco/spam/design): la board non deve mai dare visibilità a materiale
  // segnalato dalla sicurezza, nemmeno se per qualche motivo è finito in `done`.
  // Un fix con una riapertura in sospeso (DC4) ESCE dalla board: l'utente l'ha
  // segnalato come ancora rotto e il fix è tornato nell'iter normale, quindi non
  // va più mostrato come "risolto, conferma se funziona" (criterio DC4
  // "l'originale esce da Risolti", lato vista — il flip di `status` lo applica
  // poi il percorso fidato/triage). `hasReopenRequest` è dichiarata sotto
  // (hoisting): riusarla qui tiene una sola definizione del guard.
  // PURA: niente rete, niente Electron — unit-testabile.
  function listBoardTab(feedbacks, opts) {
    const releasedVersion = opts && opts.releasedVersion;
    return listForManageTab(feedbacks, 'resolved', { releasedVersion })
      .filter((fb) => !classifyBlock(fb))
      .filter((fb) => !hasReopenRequest(fb));
  }

  // ── DC4: riapertura a pagamento dalla board ──────────────────────────────
  // PURA: un fix è riapribile solo se è OGGI visibile nella board (stessa
  // identica regola di "Risolti senza red-team" di listBoardTab, applicata al
  // singolo feedback) E nessuno l'ha già riaperto. Riusa `reopenRequests`
  // (map uid → { at }) scritta da SN_FEEDBACK.castReopenRequest — stesso
  // pattern non-admin di `votes` — per il guard anti-doppia-riapertura: NON è
  // "un utente riapre una volta sola", è "una volta riaperto da chiunque, il
  // fix è già nell'iter normale" (evita N feedback collegati duplicati per lo
  // stesso fix rotto). Se il fix esce da "Risolti" il guard si auto-risolve:
  // quando rientra eventualmente in produzione, riparte da `reopenRequests`
  // vuoto solo se chi applica il done successivo lo azzera (vedi notes nel
  // task) — finché non viene azzerato, resta bloccato: meglio prudente che
  // permettere riaperture a raffica sullo stesso fix.
  function hasReopenRequest(fb) {
    const r = fb && fb.reopenRequests;
    return !!(r && typeof r === 'object' && Object.keys(r).length > 0);
  }

  function canReopen(fb, opts) {
    if (!fb) return false;
    if (hasReopenRequest(fb)) return false;
    return listBoardTab([fb], opts).length > 0;
  }

  global.SN_MANAGE_REVIEW = {
    classifyBlock, sortReview, REASONS, manageTabFor, listForManageTab,
    isStarred, listArchiveTab, isShipped, cmpVersion, listBoardTab,
    hasReopenRequest, canReopen, isApproved,
    panelSize, EXPECTED_PANEL_SIZE: DEFAULT_PANEL_SIZE, isTrustedClient,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
