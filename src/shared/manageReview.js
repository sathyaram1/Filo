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
    // Bocciatura di SICUREZZA sul fix (statusReason `secaudit`): il feedback era
    // approvato e lavorato, ma l'audit di sicurezza (o il cancello di fusione)
    // ha detto no e la pratica è tornata all'owner. ROSSO come l'attacco: il
    // verde di `design` faceva sembrare "questione di gusto" un allarme di
    // sicurezza — scelta dell'owner, 2026-08-29.
    secaudit:   { label: 'Bloccato dalla sicurezza', color: '#c0392b', severity: 3 },
    attack:     { label: 'Attacco',      color: '#c0392b', severity: 3 },
    spam:       { label: 'Spam',         color: '#e08e0b', severity: 2 },
    design:     { label: 'Design',       color: '#2e9e5b', severity: 1 },
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

  // Vocabolario unico della macchina a stati (src/shared/feedbackStatus.js).
  // Letto pigramente: nelle pagine filo:// va incluso PRIMA di questo file,
  // nei test unit va require-ato prima. Se manca, errore chiaro subito.
  function FS() {
    const m = global.SN_FB_STATUS;
    if (!m) throw new Error('SN_FB_STATUS mancante: carica shared/feedbackStatus.js prima di manageReview.js');
    return m;
  }

  /**
   * Classificazione LEGACY dai campi grezzi (`pipeline.*`, `blockReason`,
   * `reviewDecision`). Serve SOLO a normalizeStatus per sciogliere gli stati
   * ritirati (`new`, `blocked`) dello storico: i feedback nuovi arrivano già
   * con uno status canonico scritto dalla pipeline (filo-security). NON è più
   * il criterio delle tab: nessun consumer deve ricalcolare lo stato dai grezzi.
   */
  function classifyLegacyBlock(fb) {
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
  //   (chi consegna il `done` lo timbra = versione corrente di `package.json`,
  //   cioè quella in cui il fix è confluito). Un `done` con `resolvedInVersion` futura
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

  // ── "Allineato" LEGACY: panel completo con tutti i giudici d'accordo ──────
  // Usata SOLO da normalizeStatus per lo storico. Colore BLU (--mg-dot--aligned).
  const ALIGNED = { color: '#5b6ee0', label: 'Allineato' };
  function isAlignedLegacy(fb) {
    if (!fb) return false;
    if (classifyLegacyBlock(fb)) return false; // blocco/non-filtrato/loop → non allineato
    const p = fb.pipeline;
    if (!p) return false;
    // Decisione esplicita del pipeline: auto-approvato o classe L2 aligned.
    if (p.action === 'candidate_change') return true;
    if (p.l2Class === 'aligned') return true;
    // Storico senza l2Class: panel COMPLETO (classifyLegacyBlock già escluderebbe
    // i parziali) i cui verdetti presenti sono tutti 'aligned'.
    const verdicts = Array.isArray(p.verdicts) ? p.verdicts.filter((v) => v && v.class) : [];
    return verdicts.length > 0 && verdicts.every((v) => v.class === 'aligned');
  }

  // ── normalizeStatus: la SOLA porta d'ingresso allo stato di un feedback ───
  // Ritorna sempre uno status CANONICO (spec FEEDBACK-STATES.md §2) + il
  // sottotesto statusReason. Tre casi:
  //   1. status già canonico → passa invariato (la fonte di verità è lui);
  //   2. legacy "semplice" (clarify/review/verified/ignored/draft) → mappa fissa;
  //   3. legacy new/blocked/assente → deriva UNA VOLTA dai campi grezzi con la
  //      stessa logica storica (reviewDecision, blockReason, pipeline). È il
  //      ponte per lo storico non ancora migrato: quando la migrazione (F5)
  //      riscrive i documenti, il ramo 3 non scatta più.
  function normalizeStatus(fb) {
    const fs = FS();
    const s = fb && fb.status;
    if (fs.isCanonical(s)) return { status: s, statusReason: (fb && fb.statusReason) || null };

    const simple = fs.LEGACY_SIMPLE[s];
    if (simple) return { status: simple.status, statusReason: (fb && fb.statusReason) || simple.statusReason };

    // new / blocked / status assente: scioglimento dai campi grezzi.
    if (fb && fb.reviewDecision === 'accepted') return { status: 'todo', statusReason: null };
    const cl = classifyLegacyBlock(fb);
    if (cl) {
      if (cl.reason === 'loop')       return { status: 'design', statusReason: 'loop' };
      if (cl.reason === 'attack')     return { status: 'attack', statusReason: null };
      if (cl.reason === 'spam')       return { status: 'spam', statusReason: null };
      if (cl.reason === 'design')     return { status: 'design', statusReason: 'judges' };
      return { status: 'unlabeled', statusReason: null }; // unfiltered
    }
    if (isAlignedLegacy(fb)) {
      // Auto-approvazione incisa al giudizio (automatica ON allora) → in coda;
      // altrimenti aspetta l'approvazione manuale. La modalità automatica di
      // OGGI non c'entra: agisce una volta sola, al momento del giudizio.
      const p = fb.pipeline;
      if (p && p.action === 'candidate_change') return { status: 'todo', statusReason: null };
      return { status: 'aligned', statusReason: null };
    }
    return { status: 'unlabeled', statusReason: null };
  }

  // ── Quando lo stato non si LEGGE, il criterio delle sezioni non esiste ─────
  // Lo `status` fine viaggia CIFRATO (#476): senza la chiave privata dell'owner
  // resta un blob, e `normalizeStatus` non ha niente da sciogliere — ogni
  // feedback ricade in `unlabeled`, cioè nei Ricevuti. Le pagine disegnavano lo
  // stesso le quattro sezioni, "In coda (0) · Risolti (0) · Archiviati (0)",
  // con dentro anche i feedback già chiusi: tre numeri che DICHIARANO IL VUOTO
  // dove la verità è che non lo sappiamo.
  //
  // La regola vive QUI, non dentro una pagina. Quando stava dentro la pagina
  // dei feedback, la dashboard di gestione ha continuato a mentire e nessuno se
  // n'è accorto finché non si sono guardate affiancate (#509, secondo giro):
  // due copie della stessa regola divergono, una sola no.
  const CIPHER_PREFIXES = ['FENC', '[cifrato'];
  function looksEncrypted(value) {
    const raw = String(value == null ? '' : value).trim();
    return CIPHER_PREFIXES.some((p) => raw.startsWith(p));
  }

  /**
   * Lo status di QUESTO feedback è illeggibile (ciphertext)? Riconoscimento
   * STRETTO apposta: solo il testo cifrato. Uno status assente, vuoto o
   * inventato la macchina lo scioglie davvero (→ `unlabeled`), e lì le pagine
   * restano allineate come devono.
   */
  function statusUnreadable(fb) {
    return looksEncrypted(fb && fb.status);
  }

  /**
   * Si possono disegnare le sezioni per QUESTA lista? No solo quando la pagina
   * non legge NESSUNO stato: è il caso vero (o hai la chiave e li leggi tutti,
   * o non ce l'hai e non ne leggi uno). Un documento storto in mezzo a mille
   * leggibili lascia la barra al suo posto: toglierla a tutti sarebbe
   * sproporzionato, e farebbe divergere le due superfici.
   * Lista vuota → non c'è niente che dica il contrario: sezioni sì (e "(0)"
   * lì è la verità).
   */
  function sectionsReliable(feedbacks) {
    const list = feedbacks || [];
    return !list.length || !list.every(statusUnreadable);
  }

  /**
   * L'unica cosa vera che resta in mano a chi non ha la chiave: l'enum
   * grossolano in chiaro (`statusPublic`), lo stesso che guarda la ricompensa.
   * 'Aperta' | 'Chiusa' | '' (non si sa nemmeno quello). Le due pagine lo
   * scrivono con QUESTE parole, non con due sinonimi.
   */
  function publicStateLabel(fb) {
    const pub = String((fb && fb.statusPublic) || '');
    if (pub === 'closed') return 'Chiusa';
    if (pub === 'open') return 'Aperta';
    return '';
  }
  const PUBLIC_STATE_HINT = 'il dettaglio si legge solo con la chiave dell’owner';

  // Come si presenta lo status in "Ricevuti": reason per lo storico dei consumer
  // (unfiltered/attack/spam/design/loop) + colore/label/severity dal vocabolario.
  function reasonOf(status, statusReason) {
    if (status === 'unlabeled') return 'unfiltered';
    if (status === 'design' && statusReason === 'loop') return 'loop';
    return status; // attack | spam | design | suspicious_file
  }

  // ── Sicurezza-conservativa: la categoria PIÙ ALTA, non la maggioritaria ────
  // I giudici possono dissentire: alcuni vedono un attacco, la maggioranza no.
  // La dashboard NON deve seguire la maggioranza — deve far emergere la categoria
  // di sicurezza più alta segnalata anche da UN SOLO giudice, perché un falso
  // negativo (attacco mostrato come allineato/design) è molto più costoso di un
  // falso positivo (che finisce comunque in revisione umana, non blocca nessuno).
  // Stesso spirito del guard red-team di listBoardTab, che legge APPOSTA i
  // verdetti grezzi (non lo status) per non dare mai visibilità a materiale
  // segnalato. Solo attack/spam/design sono categorie di verdetto di rischio:
  // `unfiltered`/`loop`/`suspicious_file` vengono dallo status/gate-file, non da
  // un singolo giudice, e restano più severi (severità 4-5 > attack 3).
  const VERDICT_RISK = { attack: 'attack', spam: 'spam', design: 'design' };
  function worstVerdictBlock(fb) {
    const p = fb && fb.pipeline;
    const verdicts = (p && Array.isArray(p.verdicts)) ? p.verdicts : [];
    let worst = null;
    for (const v of verdicts) {
      const reason = v && VERDICT_RISK[v.class];
      if (!reason) continue;
      const info = REASONS[reason];
      if (!worst || info.severity > worst.severity) worst = { reason, ...info };
    }
    return worst;
  }

  /**
   * Classifica un feedback per la colonna Revisione/Ricevuti. Deriva dallo status
   * normalizzato (lookup sul vocabolario), poi applica l'escalation
   * sicurezza-conservativa: se un singolo giudice ha votato una categoria di
   * rischio PIÙ ALTA dell'aggregato, la dashboard mostra QUELLA. Torna
   * { reason, color, severity, label } per gli stati di revisione umana, null per
   * tutto il resto. `aligned` di per sé non è una segnalazione (badge blu), MA se
   * un giudice ha segnalato un rischio va mostrato con quella categoria: un
   * "allineato" con un voto di attacco resta da guardare, non è approvabile in blocco.
   *
   * L'escalation vale SOLO per gli stati "Ricevuti" (in revisione umana): un
   * feedback già accettato dall'owner (todo/…) o chiuso non si ri-segnala — la
   * decisione umana/di lavorazione ha superato i verdetti dei giudici.
   */
  function classifyBlock(fb) {
    const fs = FS();
    const { status, statusReason } = normalizeStatus(fb);
    if (status === 'aligned') return worstVerdictBlock(fb);
    const info = fs.STATUSES[status];
    if (!info || info.tab !== 'inbox') return null;
    // Bocciatura di sicurezza sul fix: lo stato è `design` (torna all'owner),
    // ma NON è una questione di design — è un blocco di sicurezza. Rosso.
    if (status === 'design' && statusReason === 'secaudit') {
      return { reason: 'secaudit', ...REASONS.secaudit };
    }
    // Panel COMPLETO su un feedback rimasto `unlabeled`: succede ai mittenti
    // fidati che i giudici hanno segnalato (la pipeline non li marchia mai
    // attack/spam, li lascia "da ri-giudicare"). Ma un panel completo non ha
    // niente da ri-giudicare: mostrarlo bianco ("non filtrato") era falso, e il
    // bottone "Ri-valuta" lo ritentava per sempre rispondendo "nessun giudice
    // recuperato". La card prende la categoria più alta segnalata; decide l'owner.
    if (status === 'unlabeled' && panelComplete(fb)) {
      const worst = worstVerdictBlock(fb);
      if (worst) return worst;
    }
    const base = { reason: reasonOf(status, statusReason), color: info.color, severity: info.severity, label: info.label };
    const worst = worstVerdictBlock(fb);
    if (worst && worst.severity > base.severity) return worst;
    return base;
  }

  // Panel dei giudici COMPLETO: tutti i verdetti attesi ci sono e la pipeline
  // non lo dichiara parziale/degradato. È il discrimine fra "non filtrato" vero
  // (manca un giudice: ha senso ri-valutare) e "giudicato per intero".
  function panelComplete(fb) {
    const p = fb && fb.pipeline;
    if (!p || typeof p !== 'object') return false;
    if (p.l2Unfiltered === true || p.l2Degraded === true) return false;
    const verdicts = Array.isArray(p.verdicts) ? p.verdicts.filter((v) => v && v.class) : [];
    return verdicts.length > 0 && verdicts.length >= panelSize(p);
  }

  // ── Frase accanto ai pallini dei giudici (dettaglio dashboard) ────────────
  // I pallini dicono COSA hanno votato i giudici; la frase dice PERCHÉ il
  // feedback è nello stato in cui è — che non sempre coincide (#462: giudici
  // tutti allineati, ma il fix è stato poi bocciato dalla sicurezza). Ritorna
  // { text, color } (color null = colore neutro), o null se non c'è niente da
  // spiegare (feedback in coda/chiusi: i pallini sono solo storia).
  function judgesNote(fb) {
    const fs = FS();
    const S = fs.STATUSES;
    // Stato illeggibile: qui non c'è niente da spiegare. La macchina lo
    // ridurrebbe a `unlabeled` e la frase direbbe "In attesa del giudizio."
    // anche su una segnalazione già chiusa — la stessa bugia delle sezioni, in
    // piccolo. Chi disegna mette al suo posto l'enum grossolano in chiaro.
    if (statusUnreadable(fb)) return null;
    const { status, statusReason } = normalizeStatus(fb);
    if (status === 'design') {
      if (statusReason === 'secaudit') {
        return { text: 'Il controllo di sicurezza ha bocciato il fix: decidi tu.', color: REASONS.secaudit.color };
      }
      if (statusReason === 'clarify') {
        return { text: 'La routine ha domande: rispondi qui sotto.', color: S.design.color };
      }
      if (statusReason === 'loop') {
        return { text: 'La verifica ha bocciato il fix troppe volte: decidi tu.', color: S.design.color };
      }
      if (statusReason === 'arenato') {
        return { text: 'La lavorazione si è arenata troppe volte: decidi tu.', color: S.design.color };
      }
      return { text: 'Per i giudici è una questione di design: decidi tu.', color: S.design.color };
    }
    if (status === 'aligned') {
      const worst = worstVerdictBlock(fb);
      if (worst) {
        return { text: `Un giudice ha segnalato: ${worst.label.toLowerCase()}. Da esaminare prima di approvare.`, color: worst.color };
      }
      return { text: 'Tutti d’accordo: aspetta la tua approvazione.', color: S.aligned.color };
    }
    if (status === 'attack') return { text: 'Segnalato come attacco.', color: S.attack.color };
    if (status === 'spam') return { text: 'Segnalato come spam.', color: S.spam.color };
    if (status === 'unlabeled') {
      if (panelComplete(fb)) {
        const worst = worstVerdictBlock(fb);
        if (worst) {
          return { text: `Mittente fidato segnalato come ${worst.label.toLowerCase()}: decidi tu.`, color: worst.color };
        }
        return null;
      }
      const p = fb && fb.pipeline;
      const verdicts = (p && Array.isArray(p.verdicts)) ? p.verdicts.filter((v) => v && v.class) : [];
      if (!verdicts.length) return { text: 'In attesa del giudizio.', color: null };
      const missing = Math.max(0, panelSize(p) - verdicts.length);
      return { text: `Panel incompleto: ${missing} giudic${missing === 1 ? 'e' : 'i'} senza verdetto.`, color: null };
    }
    return null;
  }

  // Motivo dello stato (statusReason) in parole: per tooltip e sottotesti. I
  // codici grezzi ('secaudit', 'clarify'…) non dicono niente a chi legge la
  // lista; un motivo sconosciuto passa invariato (meglio grezzo che muto).
  const REASON_TEXTS = {
    secaudit: 'bloccato dalla sicurezza',
    clarify: 'domande per te',
    loop: 'fix bocciato troppe volte',
    arenato: 'lavorazione arenata',
    judges: 'verdetto dei giudici',
    duplicate: 'duplicato',
  };
  function reasonText(statusReason) {
    const k = String(statusReason || '');
    return REASON_TEXTS[k] || k;
  }

  // "Allineato" = status normalizzato `aligned` (badge blu, aspetta approvazione).
  // Ma se anche un solo giudice ha segnalato un rischio (attack/spam/design), NON
  // è allineato: non deve finire nell'approvazione in blocco degli allineati —
  // resta da esaminare (classifyBlock lo mostra con la sua categoria di rischio).
  function isAligned(fb) {
    if (normalizeStatus(fb).status !== 'aligned') return false;
    return !worstVerdictBlock(fb);
  }

  // ── Approvazione: cosa può stare "In coda" ────────────────────────────────
  // APPROVATO = lo status è già nell'iter di lavorazione (todo e successivi).
  // Non si ricalcola più da reviewDecision/pipeline/autoMode: chi approva SCRIVE
  // `todo` (owner dalla dashboard, o la pipeline al giudizio con automatica ON).
  function isApproved(fb) {
    const { status } = normalizeStatus(fb);
    return ['todo', 'working', 'revision_capability', 'revision_security', 'done'].includes(status);
  }

  // ── Dashboard unificata (DB1): mappatura feedback → tab ───────────────────
  // Lookup PURA sul vocabolario (spec §4): niente pipeline, niente isApproved,
  // niente modalità automatica. L'unico ingrediente extra è il gate DB3
  // (`opts.releasedVersion`): un `done` è "Risolti" solo se davvero spedito,
  // altrimenti resta visibile "In coda".
  function manageTabFor(fb, opts) {
    const { status } = normalizeStatus(fb);
    const shipped = status === 'done' ? isShipped(fb, opts && opts.releasedVersion) : false;
    return FS().tabFor(status, { shipped });
  }

  // Priorità di un feedback, normalizzata: 1-3 (più alta = affrontata prima dalle
  // routine di Claude), 0 = nessuna. Robusta a valori cifrati/non numerici (NaN→0).
  function priorityOf(fb) {
    const p = Math.round(Number(fb && fb.priority) || 0);
    return p >= 1 && p <= 3 ? p : 0;
  }

  // ── Avanzamento della lavorazione (card pinnata in "In coda") ─────────────
  // L'iter di un fix ha tre passaggi, nell'ordine: implementazione (working),
  // controllo funzionalità (revision_capability = aspetta il verifier),
  // controllo sicurezza (revision_security = aspetta l'audit). Lo status dice
  // QUAL È il passaggio corrente; i campi claim* (specchiati su Firestore dalla
  // riconciliazione dei claim git) e workingSince dicono se un'istanza ci sta
  // lavorando ORA.
  const WORK_STAGES = ['working', 'revision_capability', 'revision_security'];
  const WORK_STEPS = [
    { key: 'impl',     label: 'Implementazione' },
    { key: 'verify',   label: 'Controllo funzionalità' },
    { key: 'security', label: 'Controllo sicurezza' },
  ];

  /**
   * Stato di avanzamento di un feedback nell'iter di lavorazione, o null se
   * non è in lavorazione. PURA (opts.now iniettabile nei test). Ritorna:
   *   { status, steps: [{key,label,state:'done'|'current'|'pending'}],
   *     current: <step corrente>, active: bool, by: string }
   * `active` = un'istanza ci sta lavorando in questo momento: claim vivo
   * (claimExpiresAt nel futuro) in qualunque fase, oppure — solo per `working`,
   * l'unica fase con un lock a TTL suo — un workingSince fresco.
   */
  function workProgress(fb, opts) {
    const { status } = normalizeStatus(fb);
    const idx = WORK_STAGES.indexOf(status);
    if (idx < 0) return null;
    const steps = WORK_STEPS.map((s, i) => ({
      key: s.key, label: s.label,
      state: i < idx ? 'done' : (i === idx ? 'current' : 'pending'),
    }));
    const now = (opts && opts.now) != null ? opts.now : Date.now();
    return {
      status,
      steps,
      current: steps[idx],
      active: FS().isBeating(fb, now),
      by: String((fb && fb.claimedBy) || ''),
    };
  }

  // Feedback di una singola tab, già ordinati:
  //   "Ricevuti" → severità del blocco poi recenza (come la Revisione): i
  //                non-filtrati (bianchi) e i bloccati gravi salgono in cima.
  //   "In coda"  → i feedback IN LAVORAZIONE (working/revision_*) pinnati in
  //                cima — prima quelli con un'istanza attiva ora, poi per fase
  //                più avanzata — così l'owner vede subito a che punto è l'iter;
  //                sotto, il resto per priorità DESC (Claude affronta prima le
  //                alte), poi severità del blocco, poi recenza.
  //   altre      → createdAt DESC.
  // `opts.releasedVersion` (DB3) è passato a manageTabFor per il gate "Risolti".
  function listForManageTab(feedbacks, tab, opts) {
    const items = (feedbacks || []).filter((f) => manageTabFor(f, opts) === tab);
    if (tab === 'inbox') return sortReview(items);
    // In coda: priorità DESC come criterio primario tra i non-in-lavorazione.
    // `sort` è stabile, quindi a parità di priorità si conserva l'ordine di
    // sortReview (severità poi recenza), e il pinning finale conserva a sua
    // volta l'ordine per priorità dentro ogni gruppo.
    if (tab === 'queue') {
      const now = (opts && opts.now) != null ? opts.now : Date.now();
      // Rango di pinning: istanza attiva ora > fase più avanzata > non in
      // lavorazione (-1). Il +10 separa nettamente gli attivi dagli inattivi.
      const rank = (f) => {
        const p = workProgress(f, { now });
        if (!p) return -1;
        return (p.active ? 10 : 0) + WORK_STAGES.indexOf(p.status);
      };
      return sortReview(items)
        .sort((a, b) => priorityOf(b) - priorityOf(a))
        .sort((a, b) => rank(b) - rank(a));
    }
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
  //   confirmedOnly=true → di quelli, solo gli attacchi/spam CONFERMATI.
  // I due filtri della colonna vivono qui, non nella pagina: il conteggio della
  // scheda deve poter contare esattamente ciò che la lista mostra (un contatore
  // che non segue i filtri sembra mentire).
  function listArchiveTab(feedbacks, opts) {
    const starredOnly = !!(opts && opts.starredOnly);
    const confirmedOnly = !!(opts && opts.confirmedOnly);
    let items = (feedbacks || []).filter((f) =>
      starredOnly ? isStarred(f) : manageTabFor(f) === 'archived');
    if (confirmedOnly) {
      items = items.filter((f) => String(normalizeStatus(f).status).endsWith('_confirmed'));
    }
    return items.slice().sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return tb - ta;
    });
  }

  // ── Quanti feedback ci sono in ogni scheda-lista (#495) ───────────────────
  // Conta ESATTAMENTE ciò che la scheda elencherebbe, riusando le stesse
  // funzioni che costruiscono le liste: un numero calcolato con una regola sua
  // prima o poi diverge da quello che si vede aprendo la scheda. Per Ricevuti /
  // In coda / Risolti l'ordinamento non cambia la lunghezza, quindi basta
  // l'appartenenza (manageTabFor, lo stesso filtro di listForManageTab);
  // Archiviati passa da listArchiveTab perché ha regole e filtri suoi.
  // `opts`: { releasedVersion, starredOnly, confirmedOnly }. PURA.
  function manageTabCounts(feedbacks, opts) {
    const list = feedbacks || [];
    const counts = { inbox: 0, queue: 0, resolved: 0, archived: 0 };
    for (const f of list) {
      const tab = manageTabFor(f, opts);
      if (tab === 'inbox' || tab === 'queue' || tab === 'resolved') counts[tab]++;
    }
    counts.archived = listArchiveTab(list, opts).length;
    return counts;
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
      // Guard red-team: qui si guardano APPOSTA i verdetti grezzi del pipeline
      // (non lo status): un feedback segnalato dalla sicurezza non va mai in
      // board nemmeno se per qualche motivo è arrivato a `done`.
      .filter((fb) => !classifyLegacyBlock(fb))
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

  // ── Ri-valutazione "non filtrati": esito onesto di UN feedback ────────────
  // La dashboard ri-valuta i bianchi uno alla volta (un id per chiamata). Il
  // backend, per ogni id, ri-esegue SOLO i giudici mancanti e torna un dettaglio
  // con `recovered` (quanti giudici prima assenti hanno finalmente votato) e
  // `attempted` (quanti ne ha ri-eseguiti = quanti hanno potenzialmente speso
  // crediti). Questa funzione PURA traduce quel dettaglio nell'esito che conta
  // per l'owner, così la UI dice la verità invece di contare come "valutato" un
  // feedback rimasto bianco:
  //   'recovered' almeno un giudice mancante ha votato → progresso reale;
  //   'wasted'    giudici ri-eseguiti (crediti spesi) ma NESSUNO recuperato →
  //               il feedback è ancora non filtrato e i crediti sono andati a
  //               vuoto (tipico di modelli mal configurati o credito esaurito);
  //   'budget'    il backend si è fermato per tempo/budget: riprovare più tardi;
  //   'noop'      niente da ri-valutare (già completo / non più non-filtrato) →
  //               nessun credito speso;
  //   'error'     la chiamata è fallita.
  // `r` è la risposta completa del canale (con `results[0]` = dettaglio del
  // singolo id, `remaining` = budget lato server). Ritorna { outcome, recovered }.
  function classifyReevalResult(r) {
    if (!r || r.ok === false) return { outcome: 'error', recovered: 0 };
    if (r.remaining) return { outcome: 'budget', recovered: 0 };
    const det = (Array.isArray(r.results) && r.results[0]) || r;
    if (det && det.ok === false) return { outcome: 'error', recovered: 0 };
    const recovered = Math.max(0, Number(det && det.recovered) || 0);
    const errorKind = (det && det.errorKind) || null;
    // Run completa (feedback mai giudicato / L1 sbloccato): produce un pipeline
    // nuovo, non ha il concetto di "recuperati" → è sempre progresso reale.
    if (det && det.fullRun) return { outcome: 'recovered', recovered: recovered || 1, errorKind };
    if (recovered > 0) return { outcome: 'recovered', recovered, errorKind };
    // Ha provato a ri-eseguire dei giudici ma non ne ha recuperato nessuno:
    // crediti spesi, feedback ancora bianco. `errorKind` dice PERCHÉ.
    if (Number(det && det.attempted) > 0) return { outcome: 'wasted', recovered: 0, errorKind };
    return { outcome: 'noop', recovered: 0, errorKind };
  }

  // Traduce la causa tecnica del fallimento dei giudici in una frase per l'owner.
  // null/'other' → null (nessun messaggio specifico, resta quello generico).
  function reevalErrorHint(errorKind) {
    switch (errorKind) {
      case 'credit':
        return 'Il credito OpenRouter della chiave dei giudici è esaurito: ricaricalo per far girare i giudici.';
      case 'auth':
        return 'La chiave OpenRouter dei giudici è assente o non valida: reimpostala nei Modelli di supporto.';
      case 'rate_limit':
        return 'Il provider dei giudici è sovraccarico (limite di richieste): riprova tra poco.';
      case 'bad_request':
        return 'Un modello dei giudici non è valido o non esiste più: controlla i modelli nei Modelli di supporto.';
      case 'timeout':
        return 'I giudici non hanno risposto in tempo: alza il "Timeout dei giudici" in Automazioni se usi modelli lenti.';
      default:
        return null;
    }
  }

  // Quanti esiti 'wasted' consecutivi tollerare prima di fermare l'intera
  // ri-valutazione: se i giudici falliscono a vuoto più volte di fila è quasi
  // certo un problema di configurazione/credito, inutile bruciare crediti sul
  // resto della lista. Basso di proposito (il segnale arriva subito).
  const REEVAL_WASTE_LIMIT = 3;

  global.SN_MANAGE_REVIEW = {
    normalizeStatus,
    classifyBlock, sortReview, REASONS, manageTabFor, listForManageTab, priorityOf,
    workProgress, WORK_STAGES,
    isStarred, listArchiveTab, manageTabCounts, isShipped, cmpVersion, listBoardTab,
    hasReopenRequest, canReopen, isApproved, isAligned, ALIGNED, ALIGNED_COLOR: ALIGNED.color,
    panelSize, EXPECTED_PANEL_SIZE: DEFAULT_PANEL_SIZE, isTrustedClient,
    panelComplete, judgesNote, reasonText,
    statusUnreadable, sectionsReliable, publicStateLabel, PUBLIC_STATE_HINT,
    priorityUnreadable,
    classifyReevalResult, reevalErrorHint, REEVAL_WASTE_LIMIT,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
