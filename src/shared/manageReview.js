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
    // Fermata al CANCELLO DI FUSIONE (statusReason `l5`): il fix è scritto e
    // l'audit l'ha passato, ma i controlli deterministici del server non
    // lasciano entrare il ramo in main senza il via libera dell'owner. Rosso
    // come la bocciatura di sicurezza, e per lo stesso motivo: è un allarme di
    // sicurezza che aspetta una persona, non una questione di gusto.
    l5:         { label: 'Fusione ferma', color: '#c0392b', severity: 3 },
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
   * Questo VALORE è arrivato cifrato (chiave assente)? Stesso riconoscimento
   * stretto di statusUnreadable, per gli altri campi che viaggiano cifrati
   * insieme allo status — la revisione dell'owner (decisione, commento, data)
   * e la conversazione. Mostrare un blob al posto di un testo è la stessa
   * bugia delle sezioni, in piccolo.
   */
  function valueUnreadable(value) {
    return looksEncrypted(value);
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
    // Ferma al cancello di fusione: c'è una richiesta che aspetta l'owner.
    if (status === 'design' && statusReason === 'l5') {
      return { reason: 'l5', ...REASONS.l5 };
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
      if (statusReason === 'l5') {
        return { text: 'Il ramo è fermo al cancello di fusione: aspetta il tuo via libera.', color: REASONS.l5.color };
      }
      if (statusReason === 'clarify') {
        return { text: 'La routine ha domande: rispondi qui sotto.', color: S.design.color };
      }
      if (statusReason === 'loop') {
        return { text: 'La verifica ha trovato un difetto che non si può più correggere da soli: decidi tu.', color: S.design.color };
      }
      if (statusReason === 'decisione') {
        return { text: 'Il lavoro è fermo su una scelta che spetta a te: leggila nel rombo e rispondi qui sotto.', color: S.design.color };
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
    l5: 'fermo al cancello di fusione',
    clarify: 'domande per te',
    loop: 'difetto non più correggibile da soli',
    decisione: 'fermo: aspetta una tua scelta',
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

  // ── Le AZIONI dell'owner: UNA tabella per tutte le superfici ──────────────
  //
  // Stessa storia delle sezioni (#509), un gradino più in dentro. Le due pagine
  // avevano finito per disegnare le stesse sezioni con la stessa regola, ma i
  // pulsanti sopra quelle sezioni se li costruiva ognuna per conto suo — e sulla
  // STESSA segnalazione offrivano azioni diverse:
  //   · un archiviato: «↩ Ripristina» sulla pagina dei feedback, «Archivia»
  //     sulla dashboard di gestione. Su un attacco confermato quel bottone non
  //     era un doppione innocuo: scriveva `archived` SOPRA la conferma, cioè
  //     cancellava in silenzio una decisione di sicurezza, e da lì l'attacco era
  //     indistinguibile da una segnalazione archiviata qualsiasi;
  //   · un file sospetto: due conferme di là (attacco e spam), una sola di qua;
  //   · un fix uscito: riapribile di là, non di qua.
  //
  // Da qui in avanti le azioni si LEGGONO, non si riscrivono in ogni pagina: la
  // sezione (manageTabFor) e lo status canonico (normalizeStatus) decidono
  // QUALI sono, con quale etichetta, e verso quale stato scrivono. Chi vuole
  // un'azione in più la aggiunge QUI, e la gemella ce l'ha nello stesso commit.
  //
  // Invariante che la tabella incarna: se puoi archiviare, puoi togliere
  // dall'archivio — e mai il contrario nello stesso posto. La sezione
  // "Archiviati" offre SOLO il ripristino, così non esiste più un cammino che
  // riscrive uno stato terminale (attack_confirmed / spam_confirmed) con
  // `archived`.
  //
  // `kind` dice cosa scrive il pulsante oltre allo status:
  //   'accept'  override di revisione dell'owner (reviewDecision 'accepted');
  //   'reject'  conferma di un blocco (reviewDecision 'rejected');
  //   'archive' archiviazione manuale (archiveOverride 'archived');
  //   'restore' uscita dall'archivio (archiveOverride 'keep_open');
  //   'resolve' chiusura a mano;
  //   'reopen'  chiede PRIMA cosa manca ancora, poi rimette in coda.
  //
  // Stato ILLEGGIBILE → nessuna azione: i pulsanti nascono dalla sezione, e la
  // sezione qui non si sa. È la stessa regola della barra delle sezioni, e vale
  // per tutt'e due le pagine perché vive qui.
  function ownerActions(fb, opts) {
    if (statusUnreadable(fb)) return [];
    const { status } = normalizeStatus(fb);
    const tab = manageTabFor(fb, opts);
    if (tab === 'inbox') {
      // Aspetta una decisione: approvare È scrivere `todo`.
      const acts = [{ key: 'accept', kind: 'accept', to: 'todo', label: '→ In coda', primary: true }];
      // Un attacco/spam segnalato si può CONFERMARE: stato terminale, esce dai
      // Ricevuti e resta consultabile negli Archiviati. Il file sospetto non è
      // ancora classificato: le conferme possibili sono DUE, non una.
      if (status === 'attack' || status === 'suspicious_file') {
        acts.push({ key: 'confirm_attack', kind: 'reject', to: 'attack_confirmed', label: 'Conferma attacco', primary: false });
      }
      if (status === 'spam' || status === 'suspicious_file') {
        acts.push({ key: 'confirm_spam', kind: 'reject', to: 'spam_confirmed', label: 'Conferma spam', primary: false });
      }
      acts.push({ key: 'archive', kind: 'archive', to: 'archived', label: 'Archivia', primary: false });
      return acts;
    }
    if (tab === 'queue') {
      // Nell'iter di lavorazione: l'owner può chiuderlo a mano o archiviarlo.
      const acts = [];
      if (status !== 'done') acts.push({ key: 'resolve', kind: 'resolve', to: 'done', label: '✓ Risolto', primary: true });
      acts.push({ key: 'archive', kind: 'archive', to: 'archived', label: 'Archivia', primary: false });
      return acts;
    }
    if (tab === 'resolved') {
      // Fix uscito: si archivia (verifica umana ok) o si riapre spiegando cosa
      // manca ancora.
      return [
        { key: 'archive', kind: 'archive', to: 'archived', label: 'Archivia', primary: true },
        { key: 'reopen', kind: 'reopen', to: 'todo', label: 'Riapri', primary: false },
      ];
    }
    if (tab === 'archived') {
      // Il ripristino rimette in coda (`todo`) — anche un attacco/spam
      // confermato, che è la strada dichiarata del "era legittimo".
      return [{ key: 'restore', kind: 'restore', to: 'todo', label: '↩ Ripristina', primary: false }];
    }
    return [];
  }

  /** L'azione con questa chiave, se la segnalazione la offre ORA. */
  function ownerActionFor(fb, key, opts) {
    return ownerActions(fb, opts).find((a) => a.key === String(key)) || null;
  }

  /**
   * Questa scrittura di stato è UNA DELLE AZIONI che la segnalazione offre in
   * questo momento? È il guardiano che sta sotto ai pulsanti, non accanto: un
   * pannello rimasto aperto mentre lo stato cambiava, un doppio cammino, una
   * pagina non aggiornata, e la scrittura sarebbe di nuovo quella che cancella
   * una conferma. Chiudere la porta nella tabella e lasciare libero il writer
   * significa richiuderla una volta per giro.
   */
  function ownerActionAllowsStatus(fb, to, opts) {
    const t = String(to == null ? '' : to);
    return ownerActions(fb, opts).some((a) => a.to === t);
  }

  /**
   * L'etichetta di stato di una segnalazione, in DATI: le due pagine la
   * disegnano col loro markup ma dicono le STESSE parole. Serve anche a non
   * lasciare muta una superficie — la dashboard di gestione non scriveva da
   * nessuna parte che una segnalazione era un attacco confermato, e nel
   * dettaglio la conversazione continuava a dire che Filo "non ha ancora un
   * parere".
   * Ritorna { label, color, hint, reason, reasonText, showReason, encrypted },
   * o null quando non c'è niente di vero da scrivere.
   */
  function stateBadge(fb) {
    const fs = FS();
    // Stato cifrato: la macchina lo ridurrebbe a "Non filtrato" anche su una
    // segnalazione già chiusa. L'unica cosa vera è l'enum grossolano in chiaro.
    if (statusUnreadable(fb)) {
      const label = publicStateLabel(fb);
      if (!label) return null;
      return {
        label, color: null, hint: `Stato: ${label} — ${PUBLIC_STATE_HINT}`,
        reason: null, reasonText: '', showReason: false, encrypted: true,
      };
    }
    const { status, statusReason } = normalizeStatus(fb);
    const info = fs.STATUSES[status];
    if (!info) return null;
    // Il motivo si SCRIVE solo se ha una traduzione umana: un codice grezzo
    // ('legacy-ignored') in mezzo alla riga non dice niente. Resta nell'hover.
    const txt = statusReason ? reasonText(statusReason) : '';
    return {
      label: info.label,
      color: info.color || null,
      hint: `Stato: ${info.label}${statusReason ? ` (${txt})` : ''}`,
      reason: statusReason || null,
      reasonText: txt,
      showReason: !!txt && txt !== String(statusReason),
      encrypted: false,
    };
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

  // ══ I cinque livelli di sicurezza, come una fila di forme ═════════════════
  //
  // Una segnalazione attraversa cinque controlli, e finora la dashboard ne
  // mostrava due: il filtro d'ingresso spariva dentro una parola ("Attacco"),
  // quello che Claude aveva segnalato lavorando finiva in mezzo alla
  // conversazione, l'audit di sicurezza lasciava traccia solo quando bocciava e
  // il cancello di fusione viveva in un riquadro a parte, sopra la lista.
  //
  // Qui i cinque livelli diventano cinque forme in fila, sempre le stesse e
  // sempre nello stesso posto: triangolo (filtro d'ingresso), cerchi (giudici),
  // rombo (segnalazione di Claude), pentagono (audit di sicurezza), quadrato
  // (fusione). Un livello che non ha dato un parere è GRIGIO e resta al suo
  // posto: la fila ha sempre la stessa lunghezza, e un buco si vede.
  //
  // Questa funzione è PURA e non disegna niente: dice, per ciascun livello,
  // l'esito, il colore, il titolo sotto il puntatore e cosa scrivere nel
  // pannello di destra. Chi disegna (src/pages/manage/manage.js) ci mette solo
  // il markup — così l'intera tabella si prova senza aprire Filo.

  // I quattro colori sono quelli che i pallini dei giudici usano già
  // (src/pages/manage/manage.html, .mg-dot--*): stessa scala di severità in
  // tutta la pagina, così il rosso vuol dire la stessa cosa ovunque.
  const LIVELLO_COLORI = {
    attack:  REASONS.attack.color,   // rosso  — bloccato / bocciato
    spam:    REASONS.spam.color,     // giallo — in sospeso, o scavalcato dall'owner
    design:  REASONS.design.color,   // verde  — passato, o una domanda per l'owner
    aligned: ALIGNED.color,          // blu    — pulito
  };

  // Perché il filtro d'ingresso ha deciso così. I codici arrivano dal server;
  // uno che questa tabella non conosce si scrive lo stesso, con i trattini
  // bassi sciolti in spazi: un motivo grezzo dice più di un motivo nascosto.
  const L1_MOTIVI = {
    linked_prior_attack: 'collegato a un attacco precedente',
    prior_attack: 'chi l’ha scritta aveva già tentato un attacco',
    flagged_identity: 'identità già segnalata',
    blocked_identity: 'identità bloccata',
    new_account: 'account nuovo',
    new_account_vpn: 'account nuovo da VPN',
    vpn: 'connessione da VPN',
    obfuscation: 'offuscamento',
    encoding: 'testo codificato per nascondere il contenuto',
    instruction_override: 'prova a scavalcare le istruzioni',
    prompt_injection: 'tentativo di iniezione di istruzioni',
    secrets: 'chiede chiavi o segreti',
    rate_limit: 'troppe segnalazioni in poco tempo',
    flood: 'troppe segnalazioni in poco tempo',
    duplicate: 'già inviata',
    too_long: 'testo fuori misura',
    empty: 'testo vuoto',
    link_spam: 'pieno di link',
    gibberish: 'testo senza senso',
    suspicious_file: 'allegato sospetto',
  };
  function l1MotivoText(code) {
    const k = String(code == null ? '' : code).trim();
    if (!k) return '';
    return L1_MOTIVI[k] || k.replace(/_/g, ' ');
  }

  // Cosa ha FATTO il filtro d'ingresso, non come si chiama il campo.
  const L1_AZIONI = {
    block_attack: 'ha fermato la segnalazione come attacco',
    block_spam: 'ha fermato la segnalazione come spam',
    human_review: 'l’ha mandata alla tua revisione',
    candidate_change: 'l’ha fatta passare in coda di lavorazione',
  };

  const L1_CATEGORIE = {
    clean:     { esito: 'pulito',     etichetta: 'Pulito',     classe: 'aligned' },
    spam:      { esito: 'spam',       etichetta: 'Spam',       classe: 'spam' },
    dangerous: { esito: 'pericoloso', etichetta: 'Pericoloso', classe: 'attack' },
  };

  function forma(key, tipo, titolo, classe, esito, pannello, extra) {
    const out = {
      key, forma: tipo, titolo,
      classe: classe || null,
      colore: classe ? LIVELLO_COLORI[classe] : null,
      esito,
      vuoto: !classe,
      pannello: pannello || { titolo: titolo, righe: [], testo: '', azioni: [] },
    };
    if (extra) Object.assign(out, extra);
    return out;
  }

  function riga(etichetta, valore) {
    return { etichetta: String(etichetta || ''), valore: String(valore == null ? '' : valore) };
  }

  /**
   * Dove è arrivata la pratica e perché, in righe. PURA.
   *
   * La fila delle forme racconta i cinque controlli; questo racconta la
   * DECISIONE — «attacco confermato», «bloccato dalla sicurezza», «aspetta la
   * tua approvazione» — che nessuna delle cinque forme esprime, perché non
   * viene da un controllo ma dall'owner o dalla macchina a stati. Vive nel
   * pannello del triangolo, il primo della fila e l'unico che c'è sempre.
   */
  function righeStato(fb) {
    const righe = [];
    const b = stateBadge(fb);
    if (b) righe.push(riga('Stato', b.label + (b.showReason ? ` — ${b.reasonText}` : '')));
    const nota = judgesNote(fb);
    if (nota && nota.text) righe.push(riga('In breve', nota.text));
    return righe;
  }

  /** Livello 1: il filtro d'ingresso (identità, forma, indizi). PURA. */
  function livelloL1(fb) {
    const titolo = 'Filtro d’ingresso';
    const p = (fb && fb.pipeline && typeof fb.pipeline === 'object') ? fb.pipeline : null;
    const verdicts = (p && Array.isArray(p.verdicts)) ? p.verdicts.filter((v) => v && v.class) : [];
    // Senza categoria ma coi verdetti dei giudici: L2 gira solo se L1 ha fatto
    // passare, quindi "pulito" è un fatto dedotto, non un'ipotesi.
    const raw = String((p && p.l1Category) || '').trim();
    const cat = L1_CATEGORIE[raw] || (p && verdicts.length ? L1_CATEGORIE.clean : null);
    if (!cat) {
      return forma('l1', 'triangolo', titolo, null, 'assente', {
        titolo,
        righe: righeStato(fb),
        testo: 'Il filtro d’ingresso non ha lasciato traccia su questa segnalazione.',
        azioni: [],
      });
    }
    const motivi = (p && Array.isArray(p.l1Reasons) ? p.l1Reasons : [])
      .map(l1MotivoText).filter(Boolean);
    const azione = String((p && p.action) || '').trim();
    const righe = [riga('Categoria', cat.etichetta)];
    if (motivi.length) righe.push(riga('Perché', motivi.join(' · ')));
    righe.push(riga('Chi ha deciso', 'il filtro automatico, prima dei giudici'));
    if (azione) righe.push(riga('Cosa ha fatto', L1_AZIONI[azione] || azione.replace(/_/g, ' ')));
    return forma('l1', 'triangolo', titolo, cat.classe, cat.esito, {
      titolo, righe: righe.concat(righeStato(fb)), testo: '', azioni: [],
    });
  }

  /** Livello 2: i giudici. Un cerchio per giudice atteso, come da sempre. PURA. */
  function livelloL2(fb) {
    const titolo = 'Giudici';
    const p = (fb && fb.pipeline && typeof fb.pipeline === 'object') ? fb.pipeline : {};
    const verdicts = Array.isArray(p.verdicts) ? p.verdicts : [];
    const expected = (Array.isArray(p.expectedJudges) && p.expectedJudges.length) ? p.expectedJudges : null;
    const size = expected ? expected.length : Math.max(verdicts.length, panelSize(p));
    const lettere = ['A', 'B', 'C', 'D', 'E', 'F'];
    const giudici = [];
    for (let i = 0; i < size; i++) {
      const v = expected
        ? verdicts.find((x) => x && x.judge === expected[i]) || null
        : (verdicts[i] || null);
      giudici.push({
        indice: i,
        etichetta: `Giudice ${lettere[i] || (i + 1)}`,
        classe: (v && v.class) || null,
        verdetto: v,
      });
    }
    const worst = worstVerdictBlock(fb);
    const nota = judgesNote(fb);
    const dati = verdicts.filter((v) => v && v.class).length;
    return forma('l2', 'cerchi', titolo, worst ? worst.reason : (dati ? 'aligned' : null),
      dati ? 'giudicato' : 'assente', {
        titolo,
        righe: [],
        testo: dati ? '' : 'Nessun giudice ha ancora votato su questa segnalazione.',
        azioni: [],
      }, { giudici, nota: (nota && nota.text) || '', notaColore: (nota && nota.color) || null });
  }

  const L3_RUOLI = {
    resolver: 'chi ha scritto il fix',
    verifier: 'chi ha verificato il fix',
    fixer: 'chi ha scritto il fix',
    secaudit: 'chi ha fatto l’audit di sicurezza',
  };

  const L3_ATTESA = 'Claude aspetta una tua risposta: le domande sono nella conversazione.';

  // I motivi di `design` che aspettano una RISPOSTA scritta dell'owner: le
  // domande di chi risolve, e una segnalazione o un rilievo che chiedono una
  // sua scelta. La risposta va nella conversazione ed è quello che chi riprende
  // il lavoro riceve. Un bilancio esaurito (`loop`) si rimette in coda e basta.
  const MOTIVI_RISPOSTA = ['clarify', 'decisione'];

  /**
   * Questa pratica aspetta una risposta dell'owner? PURA.
   *
   * Porta unica: la casella «Rispondi alle domande di Filo» e il rombo verde
   * devono comparire insieme, e chiedendolo in due punti divergevano (la
   * casella usciva anche sulla forma legacy `clarify`, il rombo no).
   */
  function aspettaRisposta(fb) {
    if (!fb || statusUnreadable(fb)) return false;
    const norm = normalizeStatus(fb);
    if (norm.status !== 'design') return false;
    return MOTIVI_RISPOSTA.includes(String(norm.statusReason || '')) || String(fb.status || '') === 'clarify';
  }

  /** L'ultimo turno di Filo nella conversazione, o null. PURA. */
  function ultimaDomanda(fb) {
    const note = fb && fb.notes;
    const FT = global.SN_FEEDBACK_THREAD;
    if (!FT || typeof note !== 'string' || valueUnreadable(note)) return null;
    const turni = FT.splitNotes(note).filter((s) => s.role === 'model' && s.body);
    return turni.length ? turni[turni.length - 1] : null;
  }

  /** Livello 3: quello che Claude ha segnalato lavorando. PURA. */
  // Il documento intero non è mai stato letto (l'elenco porta una proiezione):
  // `livelli` e `notes` non ci sono, e le due forme che li leggono direbbero
  // «non fatto» su una domanda che nessuno ha ancora posto al server.
  function nonLetto(key, tipo, titolo) {
    return forma(key, tipo, titolo, null, 'nonletto', {
      titolo,
      righe: [],
      testo: 'Il resto di questa segnalazione non è ancora arrivato: finché non arriva, questo non si sa.',
      azioni: [],
    });
  }

  function livelloL3(fb, opts) {
    const titolo = 'Segnalazione di Claude';
    if (opts && opts.dettaglioLetto === false) return nonLetto('l3', 'rombo', titolo);
    const l = livelliOf(fb).l3;
    const attesa = aspettaRisposta(fb);
    const domanda = attesa ? ultimaDomanda(fb) : null;
    if (!l || !String(l.esito || '').trim()) {
      // Le domande possono arrivare nelle sole note: chi aspetta una risposta ha comunque una segnalazione.
      if (attesa) {
        return forma('l3', 'rombo', titolo, 'design', 'domande', {
          titolo,
          righe: (domanda && domanda.ts) ? [riga('Quando', String(domanda.ts))] : [],
          testo: (domanda && domanda.body) || L3_ATTESA,
          illeggibile: valueUnreadable(fb && fb.notes),
          azioni: [],
        });
      }
      return forma('l3', 'rombo', titolo, null, 'nessuna', {
        titolo,
        righe: [],
        testo: 'Nessuna segnalazione: lavorando non è emersa nessuna scelta da farti fare.',
        azioni: [],
      });
    }
    const ruolo = String(l.ruolo || '').trim();
    const righe = [];
    if (ruolo) righe.push(riga('Chi ha segnalato', L3_RUOLI[ruolo] || ruolo));
    if (l.at) righe.push(riga('Quando', String(l.at)));
    const testo = String(l.testo || '').trim() || 'La segnalazione è arrivata senza testo.';
    // Segnalazione registrata E domande in attesa: chi clicca il verde cerca
    // la cosa a cui rispondere adesso, quindi va per prima. Fermo per una
    // scelta, la segnalazione È la domanda (il server la appende anche alla
    // conversazione): si legge una volta sola, non come domanda e poi di nuovo.
    if (attesa) {
      const corpo = (domanda && domanda.body) || '';
      const motivo = String(normalizeStatus(fb).statusReason || '');
      const soloSegnalazione = !valueUnreadable(l.testo) && (motivo === 'decisione' || !corpo || corpo.includes(testo));
      return forma('l3', 'rombo', titolo, 'design', 'domande', {
        titolo,
        righe,
        testo: soloSegnalazione ? testo : `## Domande in attesa di risposta\n${corpo || L3_ATTESA}\n\n## Segnalazione\n${testo}`,
        illeggibile: valueUnreadable(l.testo) && valueUnreadable(fb && fb.notes),
        azioni: [],
      });
    }
    return forma('l3', 'rombo', titolo, 'design', 'segnalato', {
      titolo,
      righe,
      testo,
      illeggibile: valueUnreadable(l.testo),
      azioni: [],
    });
  }

  const L4_ESITI = {
    pass:    { classe: 'design', etichetta: 'Passato' },
    fail:    { classe: 'attack', etichetta: 'Bocciato' },
    saltato: { classe: 'spam',   etichetta: 'Saltato dall’owner' },
  };

  /** Livello 4: l'audit di sicurezza sul lavoro fatto. PURA. */
  function livelloL4(fb, opts) {
    const titolo = 'Audit di sicurezza';
    if (opts && opts.dettaglioLetto === false) return nonLetto('l4', 'pentagono', titolo);
    const l = livelliOf(fb).l4;
    const esito = String((l && l.esito) || '').trim();
    const info = L4_ESITI[esito];
    if (!info) {
      return forma('l4', 'pentagono', titolo, null, 'nonfatto', {
        titolo,
        righe: [],
        testo: 'Audit non ancora fatto: si controlla il lavoro, non la segnalazione, quindi arriva quando c’è un fix da guardare.',
        azioni: [],
      });
    }
    const righe = [riga('Esito', info.etichetta)];
    if (l.by) righe.push(riga('Deciso da', l.by === 'owner' ? 'te' : String(l.by)));
    if (l.at) righe.push(riga('Quando', String(l.at)));
    const testo = String(l.testo || '').trim();
    return forma('l4', 'pentagono', titolo, info.classe, esito, {
      titolo,
      righe,
      testo: testo || 'L’audit non ha lasciato un resoconto.',
      illeggibile: valueUnreadable(l.testo),
      // Bocciato: l'owner legge e può decidere di andare avanti lo stesso.
      // Il cancello di fusione (L5) resta, quindi non è un via libera cieco.
      azioni: esito === 'fail' ? ['salta_l4'] : [],
    });
  }

  /** La mappa `livelli` del documento, sempre un oggetto. PURA. */
  function livelliOf(fb) {
    const l = fb && fb.livelli;
    return (l && typeof l === 'object') ? l : {};
  }

  /** Il numero della segnalazione, senza cancelletto. PURA. */
  function numeroOf(fb) {
    const s = Number(fb && fb.seq);
    if (!Number.isInteger(s) || s <= 0) return '';
    const sub = Number(fb && fb.subSeq);
    return Number.isInteger(sub) && sub > 0 ? `${s}.${sub}` : String(s);
  }

  /** Questa richiesta di fusione nasce da QUESTA segnalazione? PURA. */
  function richiestaDiQuesto(req, fb) {
    if (!req || !fb) return false;
    const id = String(req.feedbackId || '').trim();
    if (id && id === String(fb._id || '')) return true;
    const num = String(req.num || '').trim().replace(/^#+/, '');
    return !!num && num === numeroOf(fb);
  }

  /**
   * Livello 5: il cancello di fusione. Le richieste arrivano dal server
   * (`MERGE_APPROVALS_GET`) e si legano alla segnalazione per id o per numero.
   * `opts.fusioni` = { pending, failed, preapproved, recent }. PURA.
   */
  function livelloL5(fb, opts) {
    const titolo = 'Fusione';
    const f = (opts && opts.fusioni && typeof opts.fusioni === 'object') ? opts.fusioni : {};
    const lista = (k) => (Array.isArray(f[k]) ? f[k] : []).filter((r) => richiestaDiQuesto(r, fb));
    const pending = lista('pending');
    const failed = lista('failed');
    const preapproved = lista('preapproved');
    const { status, statusReason } = normalizeStatus(fb);

    // Il server segna sul documento che la pratica è ferma al cancello
    // (`design` / `l5`). Vale da solo: gli elenchi delle richieste possono non
    // essere ancora arrivati, o essere vuoti perché questo computer non è
    // quello dell'owner — e un quadrato grigio direbbe il falso.
    const fermaDaStato = status === 'design' && statusReason === 'l5';

    // Una fusione approvata che non è avvenuta (conflitto) pesa quanto una
    // richiesta ferma: è un sì già dato che non ha prodotto niente.
    const ferme = failed.concat(pending);
    if (!ferme.length && fermaDaStato) {
      return forma('l5', 'quadrato', titolo, 'attack', 'bloccato', {
        titolo,
        righe: [],
        testo: 'I controlli del server l’hanno fermata: entra in main solo col tuo via libera. La richiesta non è (ancora) arrivata a questa pagina.',
        azioni: [],
      }, { richiesta: null, richieste: [], conflitto: false });
    }
    if (ferme.length) {
      const req = ferme[0];
      const inConflitto = failed.length > 0;
      return forma('l5', 'quadrato', titolo, 'attack', inConflitto ? 'conflitto' : 'bloccato', {
        titolo,
        righe: [],
        testo: inConflitto
          ? 'Avevi detto sì, ma la fusione non è avvenuta: il ramo non entra in main finché non si sistema.'
          : 'I controlli del server l’hanno fermata: entra in main solo col tuo via libera.',
        azioni: [],
      }, { richiesta: req, richieste: ferme, conflitto: inConflitto });
    }

    const versione = String((fb && fb.resolvedInVersion) || '').trim();
    if (status === 'done' || preapproved.length) {
      return forma('l5', 'quadrato', titolo, 'design', 'fuso', {
        titolo,
        righe: versione ? [riga('Uscito nella versione', versione)] : [],
        testo: preapproved.length
          ? 'Fusa senza chiedere: avevi messo il segno su questa pratica.'
          : 'Il lavoro è entrato in main.',
        azioni: [],
      }, { richiesta: preapproved[0] || null, richieste: preapproved, conflitto: false });
    }

    if (WORK_STAGES.indexOf(status) >= 0) {
      return forma('l5', 'quadrato', titolo, 'spam', 'attesa', {
        titolo,
        righe: [],
        testo: 'Il lavoro è in corso: al cancello ci arriva quando c’è un ramo da fondere.',
        azioni: [],
      }, { richiesta: null, richieste: [], conflitto: false });
    }

    return forma('l5', 'quadrato', titolo, null, 'nonarrivato', {
      titolo,
      righe: [],
      testo: 'Niente da fondere: nessun ramo è ancora arrivato al cancello.',
      azioni: [],
    }, { richiesta: null, richieste: [], conflitto: false });
  }

  /**
   * La fila intera, sempre cinque voci nello stesso ordine. PURA.
   * `opts.fusioni` = gli elenchi del server (vedi livelloL5).
   */
  function livelli(fb, opts) {
    return [livelloL1(fb), livelloL2(fb), livelloL3(fb, opts), livelloL4(fb, opts), livelloL5(fb, opts)];
  }

  /** La voce di un livello per chiave ('l1'…'l5'), o null. PURA. */
  function livelloPer(fb, key, opts) {
    return livelli(fb, opts).find((l) => l.key === String(key)) || null;
  }

  /**
   * Questa segnalazione ha una fusione ferma che aspetta l'owner? PURA.
   * È quello che fa diventare rossa la scheda in lista e la porta in cima
   * alle cose da decidere: una fusione ferma È una decisione dell'owner.
   */
  function fusioneInAttesa(fb, opts) {
    const l5 = livelloL5(fb, opts);
    return l5.esito === 'bloccato' || l5.esito === 'conflitto';
  }

  /**
   * Le richieste di fusione che NON hanno una segnalazione in questa lista:
   * non hanno una scheda dove vivere, e restano visibili in Automazioni.
   * Senza questo, una fusione locale (un ramo senza numero) sparirebbe. PURA.
   */
  function fusioniSenzaFeedback(richieste, feedbacks) {
    const list = Array.isArray(feedbacks) ? feedbacks : [];
    return (Array.isArray(richieste) ? richieste : [])
      .filter((r) => !list.some((fb) => richiestaDiQuesto(r, fb)));
  }

  /**
   * Il testo di un livello (la segnalazione del rombo, la nota del pentagono)
   * spezzato in righe tipizzate, per disegnarlo senza HTML. I file di `--segnala`
   * e `--nota` sono markdown con tre titoli obbligatori («## Problema»,
   * «## Scelte», «## Cosa ho fatto nel frattempo») e voci a trattino: mostrati
   * grezzi, cancelletti e trattini compaiono come caratteri e l'owner legge un
   * blocco con simboli al posto di tre sezioni. Qui si riconoscono SOLO titoli
   * e voci d'elenco: niente HTML dal testo, che resta testo. PURA.
   *   { tipo:'titolo', livello:1..6, testo } | { tipo:'voce', testo } |
   *   { tipo:'testo', testo }  (le righe di seguito si uniscono in un paragrafo)
   */
  function righeTesto(testo) {
    const out = [];
    const righe = String(testo == null ? '' : testo).replace(/\r\n?/g, '\n').split('\n');
    let paragrafo = null;
    const chiudi = () => { paragrafo = null; };
    for (const raw of righe) {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) { chiudi(); continue; }
      const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*$/.exec(line);
      if (h && h[2].trim()) { chiudi(); out.push({ tipo: 'titolo', livello: h[1].length, testo: h[2].trim() }); continue; }
      const li = /^\s*(?:[-*+•]|\d{1,3}[.)])\s+(.*)$/.exec(line);
      if (li && li[1].trim()) { chiudi(); out.push({ tipo: 'voce', testo: li[1].trim() }); continue; }
      if (paragrafo) { paragrafo.testo += '\n' + line.trim(); continue; }
      paragrafo = { tipo: 'testo', testo: line.trim() };
      out.push(paragrafo);
    }
    return out;
  }

  global.SN_MANAGE_REVIEW = {
    normalizeStatus,
    // Il guard "questo è passato dalle mani della sicurezza" letto dai campi
    // grezzi. Lo usa listBoardTab qui dentro, e lo usa feedbackPublicView.js
    // (#583) per decidere se un feedback può avere una scheda pubblica: la
    // stessa domanda, quindi la stessa funzione — una seconda copia sarebbe la
    // copia che un giorno dice di sì dove questa dice di no.
    classifyLegacyBlock,
    classifyBlock, sortReview, REASONS, manageTabFor, listForManageTab, priorityOf,
    workProgress, WORK_STAGES,
    isStarred, listArchiveTab, manageTabCounts, isShipped, cmpVersion, listBoardTab,
    hasReopenRequest, canReopen, isApproved, isAligned, ALIGNED, ALIGNED_COLOR: ALIGNED.color,
    panelSize, EXPECTED_PANEL_SIZE: DEFAULT_PANEL_SIZE, isTrustedClient,
    panelComplete, judgesNote, reasonText,
    statusUnreadable, valueUnreadable, sectionsReliable, publicStateLabel, PUBLIC_STATE_HINT,
    ownerActions, ownerActionFor, ownerActionAllowsStatus, stateBadge,
    classifyReevalResult, reevalErrorHint, REEVAL_WASTE_LIMIT,
    livelli, livelloPer, livelloL1, livelloL2, livelloL3, livelloL4, livelloL5, righeStato,
    fusioneInAttesa, fusioniSenzaFeedback, richiestaDiQuesto, numeroOf,
    l1MotivoText, LIVELLO_COLORI, L1_MOTIVI, righeTesto,
    aspettaRisposta, ultimaDomanda,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
