// Logica PURA della sezione «Revisione» della dashboard di gestione (niente Electron,
// niente rete): tutto quello che sta qui si prova con `npm run test:unit`.

(function (global) {
  'use strict';

  // Motivi di blocco, in ordine di severità discendente; `color` diventa --mg-item-color nel
  // CSS. `loop` è il blocco duro delle routine — un fix che fallisce la verifica tre volte di
  // fila — e ha severità massima perché è l'unico che non viene dal pipeline di sicurezza ma
  // dall'iter di lavorazione fermo: decide l'owner.
  const REASONS = {
    loop:       { label: 'Loop',         color: '#111111', severity: 5 },
    // «Non filtrato»: il panel dei giudici non si è completato. BIANCO perché non è una classe
    // di rischio ma filtraggio incompleto, e per instradamento vale come il più severo: mai in
    // coda, resta nei Ricevuti finché l'owner non lo risolve o ri-valuta i giudici mancanti.
    unfiltered: { label: 'Non filtrato', color: '#ffffff', severity: 4 },
    // Bocciatura di SICUREZZA sul fix (`secaudit`): era approvato e lavorato, ma l'audit ha
    // detto no e la pratica è tornata all'owner. ROSSO come l'attacco: col verde di `design` un
    // allarme di sicurezza sembrava questione di gusto (scelta dell'owner).
    secaudit:   { label: 'Bloccato dalla sicurezza', color: '#c0392b', severity: 3 },
    // Fermata al CANCELLO DI FUSIONE (`l5`): il fix c'è e l'audit l'ha passato, ma i controlli
    // deterministici non fanno entrare il ramo in main senza il via libera dell'owner. Rosso
    // come la bocciatura di sicurezza: è un allarme che aspetta una persona.
    l5:         { label: 'Fusione ferma', color: '#c0392b', severity: 3 },
    attack:     { label: 'Attacco',      color: '#c0392b', severity: 3 },
    spam:       { label: 'Spam',         color: '#e08e0b', severity: 2 },
    design:     { label: 'Design',       color: '#2e9e5b', severity: 1 },
  };

  // Panel atteso: 3 giudici fissi + 1 dinamico. Per la pipeline nuova il numero esatto è in
  // `pipeline.expectedJudges`; per lo storico vale questo default, e meno verdetti del
  // previsto vuol dire che un giudice è saltato.
  const DEFAULT_PANEL_SIZE = 4;
  function panelSize(p) {
    if (p && Array.isArray(p.expectedJudges) && p.expectedJudges.length) {
      return p.expectedJudges.length;
    }
    return DEFAULT_PANEL_SIZE;
  }

  // Stati "chiusi": non vanno (più) giudicati, restano nei loro flussi.
  const CLOSED_STATUSES = ['done', 'verified', 'archived', 'ignored'];

  // Mittenti FIDATI = automazione dell'owner (owner:/routine:/agent:). I loro feedback non
  // sono attacchi: se risultano bloccati a livello di identità è un errore e vanno
  // ri-giudicati, non mostrati come «attacco». Speculare a isTrustedIdentity nel backend.
  function isTrustedClient(clientId) {
    return /^(owner|routine|agent):/i.test(String(clientId || ''));
  }

  // Vocabolario unico della macchina a stati (feedbackStatus.js), letto pigramente: va
  // incluso PRIMA di questo file. Se manca, errore chiaro subito.
  function FS() {
    const m = global.SN_FB_STATUS;
    if (!m) throw new Error('SN_FB_STATUS mancante: carica shared/feedbackStatus.js prima di manageReview.js');
    return m;
  }

  // Classificazione LEGACY dai campi grezzi (`pipeline.*`, `blockReason`, `reviewDecision`):
  // serve SOLO a normalizeStatus per sciogliere gli stati ritirati (`new`, `blocked`) dello
  // storico. Non è più il criterio delle tab: nessun consumer ricalcola lo stato dai grezzi.
  function classifyLegacyBlock(fb) {
    // Override dell'owner: un feedback sbloccato a mano non è più un blocco e rientra nel
    // flusso normale. Vince su qualsiasi verdetto del pipeline.
    if (fb && fb.reviewDecision === 'accepted') return null;

    // Loop: un fix bloccato dopo tre verifiche fallite di fila, scritto da dispatch/triage e
    // non dal pipeline di sicurezza. Vince su tutto: richiede una decisione dell'owner.
    if (fb && fb.status === 'blocked' && fb.blockReason === 'loop') {
      return { reason: 'loop', ...REASONS.loop };
    }

    const p = fb && fb.pipeline;
    const verdicts = (p && Array.isArray(p.verdicts)) ? p.verdicts.filter((v) => v && v.class) : [];
    const trusted = isTrustedClient(fb && fb.clientId);
    const status = (fb && fb.status) || 'new';
    // «Da giudicare»: aperto e in attesa. Esclude i chiusi e i `clarify`, che sono un dialogo
    // con l'owner, non un'attesa dei giudici.
    const judgeable = !CLOSED_STATUSES.includes(status) && status !== 'clarify';

    // Mittente FIDATO senza verdetti = i giudici non sono ancora girati su un feedback
    // dell'owner, spesso perché l'identità era stata flaggata per errore. Non è un blocco ma
    // «da ri-giudicare» (bianco), e va prima dei controlli di blocco identità.
    if (p && trusted && verdicts.length === 0 && judgeable) {
      return { reason: 'unfiltered', ...REASONS.unfiltered };
    }

    // Nessun pipeline: un feedback APERTO non ancora giudicato → bianco. Chiusi e `clarify` →
    // nessun colore.
    if (!p) {
      return judgeable ? { reason: 'unfiltered', ...REASONS.unfiltered } : null;
    }

    // Blocchi di IDENTITÀ (L1) o panel COMPLETO che ha deciso attacco/spam: non sono «non
    // filtrati», sono decisioni vere e tengono il loro colore.
    if (p.action === 'block_attack' || p.l1Category === 'dangerous') {
      return { reason: 'attack', ...REASONS.attack };
    }
    if (p.action === 'block_spam' || p.l1Category === 'spam') {
      return { reason: 'spam', ...REASONS.spam };
    }

    // Panel parziale («non filtrato») vince su attacco/spam/design, perché dice che il
    // filtraggio NON è affidabile. Tre modi di rilevarlo: `l2Unfiltered` (dichiarato),
    // `l2Degraded` (zero verdetti) e DEDOTTO per lo storico — avere almeno un verdetto implica
    // che L2 è girato, quindi verdetti sotto il panel atteso = un giudice è saltato.
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

  // Ordina per la colonna Revisione: severità DESC (attack > spam > design), poi createdAt
  // DESC. I feedback senza blocco non dovrebbero arrivare qui e valgono severità 0.
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

  // DB3: «In produzione» = fix uscito in una versione RILASCIATA. Confronto semver leggero,
  // self-contained così i test non devono caricare patchNotes.
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

  // Un feedback chiuso è «in produzione» solo se il fix è davvero uscito.
  // `releasedVersion` è la versione dell'APP IN ESECUZIONE, che il chiamante passa: l'owner
  // gira sempre una build rilasciata, quindi la sua versione è l'ultima che gli utenti hanno.
  // Senza, non si gatta e il feedback vale come spedito (nessuna regressione sullo storico).
  // `resolvedInVersion` la timbra chi consegna il `done`: se è futura il fix non è in
  // produzione e resta «In coda» finché quella versione esce; se manca (storico) è già uscito.
  function isShipped(fb, releasedVersion) {
    if (!releasedVersion) return true;
    const v = fb && fb.resolvedInVersion;
    if (!v) return true;
    return cmpVersion(v, releasedVersion) <= 0;
  }

  // «Allineato» LEGACY (panel completo, giudici d'accordo): usata SOLO da normalizeStatus
  // per lo storico.
  const ALIGNED = { color: '#5b6ee0', label: 'Allineato' };
  function isAlignedLegacy(fb) {
    if (!fb) return false;
    if (classifyLegacyBlock(fb)) return false; // blocco/non-filtrato/loop → non allineato
    const p = fb.pipeline;
    if (!p) return false;
    // Decisione esplicita del pipeline: auto-approvato o classe L2 aligned.
    if (p.action === 'candidate_change') return true;
    if (p.l2Class === 'aligned') return true;
    // Storico senza l2Class: panel COMPLETO i cui verdetti presenti sono tutti 'aligned'.
    const verdicts = Array.isArray(p.verdicts) ? p.verdicts.filter((v) => v && v.class) : [];
    return verdicts.length > 0 && verdicts.every((v) => v.class === 'aligned');
  }

  // normalizeStatus: la SOLA porta d'ingresso allo stato. Torna sempre uno status CANONICO
  // (FEEDBACK-STATES.md §2) più il sottotesto statusReason. Uno status già canonico passa
  // invariato, i legacy semplici hanno una mappa fissa, e new/blocked/assente si derivano UNA
  // volta dai campi grezzi: è il ponte per lo storico, e a migrazione fatta quel ramo non
  // scatta più.
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
      // Auto-approvazione incisa al giudizio (automatica accesa allora) → in coda; altrimenti
      // aspetta l'approvazione manuale. La modalità di OGGI non c'entra: agisce una volta sola.
      const p = fb.pipeline;
      if (p && p.action === 'candidate_change') return { status: 'todo', statusReason: null };
      return { status: 'aligned', statusReason: null };
    }
    return { status: 'unlabeled', statusReason: null };
  }

  // Quando lo stato non si LEGGE, il criterio delle sezioni non esiste. Lo status fine
  // viaggia CIFRATO (#476): senza chiave privata resta un blob e ogni feedback ricade in
  // `unlabeled`. Le pagine disegnavano lo stesso «In coda (0) · Risolti (0) · Archiviati (0)»,
  // cioè tre numeri che DICHIARANO IL VUOTO dove la verità è che non lo sappiamo.
  // La regola vive QUI, non dentro una pagina: quando stava nella pagina dei feedback, la
  // dashboard ha continuato a mentire finché non si sono guardate affiancate (#509).
  const CIPHER_PREFIXES = ['FENC', '[cifrato'];
  function looksEncrypted(value) {
    const raw = String(value == null ? '' : value).trim();
    return CIPHER_PREFIXES.some((p) => raw.startsWith(p));
  }

  // Lo status di QUESTO feedback è illeggibile (ciphertext)? Riconoscimento STRETTO apposta:
  // uno status assente, vuoto o inventato la macchina lo scioglie davvero (→ `unlabeled`) e lì
  // le pagine restano allineate.
  function statusUnreadable(fb) {
    return looksEncrypted(fb && fb.status);
  }

  // Questo VALORE è arrivato cifrato? Stesso riconoscimento stretto, per gli altri campi che
  // viaggiano cifrati (revisione dell'owner, conversazione): mostrare un blob al posto di un
  // testo è la stessa bugia delle sezioni, in piccolo.
  function valueUnreadable(value) {
    return looksEncrypted(value);
  }

  // Si possono disegnare le sezioni per QUESTA lista? No solo quando la pagina non legge
  // NESSUNO stato, che è il caso vero (o hai la chiave e li leggi tutti, o non ne leggi uno).
  // Un documento storto in mezzo a mille leggibili lascia la barra al suo posto: toglierla a
  // tutti sarebbe sproporzionato e farebbe divergere le due superfici. Lista vuota → sezioni
  // sì, e «(0)» lì è la verità.
  function sectionsReliable(feedbacks) {
    const list = feedbacks || [];
    return !list.length || !list.every(statusUnreadable);
  }

  // L'unica cosa vera in mano a chi non ha la chiave: l'enum grossolano in chiaro
  // (`statusPublic`), lo stesso che guarda la ricompensa. 'Aperta' | 'Chiusa' | '' (non si sa
  // nemmeno quello), e le due pagine lo scrivono con QUESTE parole.
  function publicStateLabel(fb) {
    const pub = String((fb && fb.statusPublic) || '');
    if (pub === 'closed') return 'Chiusa';
    if (pub === 'open') return 'Aperta';
    return '';
  }
  const PUBLIC_STATE_HINT = 'il dettaglio si legge solo con la chiave dell’owner';

  // Come si presenta lo status in «Ricevuti»: reason per lo storico dei consumer, più
  // colore/label/severity dal vocabolario.
  function reasonOf(status, statusReason) {
    if (status === 'unlabeled') return 'unfiltered';
    if (status === 'design' && statusReason === 'loop') return 'loop';
    return status; // attack | spam | design | suspicious_file
  }

  // Sicurezza-conservativa: la categoria PIÙ ALTA, non la maggioritaria. I giudici possono
  // dissentire, e la dashboard deve far emergere la categoria segnalata anche da UN SOLO
  // giudice: un falso negativo (attacco mostrato come allineato) costa molto più di un falso
  // positivo, che finisce comunque in revisione umana senza bloccare nessuno. Stesso spirito
  // del guard red-team di listBoardTab. Solo attack/spam/design sono categorie di verdetto:
  // `unfiltered`/`loop`/`suspicious_file` vengono dallo status o dal gate file e restano più
  // severi.
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

  // Classifica un feedback per Revisione/Ricevuti: deriva dallo status normalizzato e poi
  // applica l'escalation sicurezza-conservativa, cioè mostra la categoria di rischio più alta
  // votata da un singolo giudice. Torna { reason, color, severity, label } per gli stati di
  // revisione umana, null per il resto. Un `aligned` con un voto di attacco resta da guardare,
  // non è approvabile in blocco. L'escalation vale SOLO nei «Ricevuti»: su un feedback già
  // accettato o chiuso la decisione umana ha superato i verdetti dei giudici.
  function classifyBlock(fb) {
    const fs = FS();
    const { status, statusReason } = normalizeStatus(fb);
    if (status === 'aligned') return worstVerdictBlock(fb);
    const info = fs.STATUSES[status];
    if (!info || info.tab !== 'inbox') return null;
    // Bocciatura di sicurezza sul fix: lo stato è `design` (torna all'owner) ma non è una
    // questione di design. Rosso.
    if (status === 'design' && statusReason === 'secaudit') {
      return { reason: 'secaudit', ...REASONS.secaudit };
    }
    // Ferma al cancello di fusione: c'è una richiesta che aspetta l'owner.
    if (status === 'design' && statusReason === 'l5') {
      return { reason: 'l5', ...REASONS.l5 };
    }
    // Panel COMPLETO su un feedback rimasto `unlabeled`: capita ai mittenti fidati che i
    // giudici hanno segnalato (la pipeline non li marchia mai attack/spam). Ma un panel completo
    // non ha niente da ri-giudicare: mostrarlo bianco era falso, e «Ri-valuta» ritentava per
    // sempre rispondendo «nessun giudice recuperato». Prende la categoria più alta segnalata:
    // decide l'owner.
    if (status === 'unlabeled' && panelComplete(fb)) {
      const worst = worstVerdictBlock(fb);
      if (worst) return worst;
    }
    const base = { reason: reasonOf(status, statusReason), color: info.color, severity: info.severity, label: info.label };
    const worst = worstVerdictBlock(fb);
    if (worst && worst.severity > base.severity) return worst;
    return base;
  }

  // Panel COMPLETO: tutti i verdetti attesi ci sono e la pipeline non lo dichiara
  // parziale/degradato. È il discrimine fra «manca un giudice, ha senso ri-valutare» e
  // «giudicato per intero».
  function panelComplete(fb) {
    const p = fb && fb.pipeline;
    if (!p || typeof p !== 'object') return false;
    if (p.l2Unfiltered === true || p.l2Degraded === true) return false;
    const verdicts = Array.isArray(p.verdicts) ? p.verdicts.filter((v) => v && v.class) : [];
    return verdicts.length > 0 && verdicts.length >= panelSize(p);
  }

  // Frase accanto ai pallini dei giudici: i pallini dicono COSA hanno votato, la frase dice
  // PERCHÉ il feedback è in quello stato, che non sempre coincide (#462: giudici tutti
  // allineati, fix poi bocciato dalla sicurezza). { text, color } (color null = neutro), o
  // null quando non c'è niente da spiegare e i pallini sono solo storia.
  function judgesNote(fb) {
    const fs = FS();
    const S = fs.STATUSES;
    // Stato illeggibile: qui non c'è niente da spiegare. La macchina lo ridurrebbe a
    // `unlabeled` e la frase direbbe «In attesa del giudizio» anche su una segnalazione chiusa.
    // Chi disegna mette al suo posto l'enum grossolano in chiaro.
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
        return { text: 'La verifica ha trovato un difetto che chiede una tua decisione.', color: S.design.color };
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

  // Motivo dello stato in parole, per tooltip e sottotesti: i codici grezzi ('secaudit'…)
  // non dicono niente a chi legge. Un motivo sconosciuto passa invariato, meglio grezzo che
  // muto.
  const REASON_TEXTS = {
    secaudit: 'bloccato dalla sicurezza',
    l5: 'fermo al cancello di fusione',
    clarify: 'domande per te',
    loop: 'difetto non più correggibile da soli',
    decisione: 'la verifica chiede una tua decisione',
    arenato: 'lavorazione arenata',
    judges: 'verdetto dei giudici',
    duplicate: 'duplicato',
  };
  function reasonText(statusReason) {
    const k = String(statusReason || '');
    return REASON_TEXTS[k] || k;
  }

  // «Allineato» = status `aligned` (badge blu, aspetta approvazione). Ma se anche un solo
  // giudice ha segnalato un rischio NON lo è: non deve finire nell'approvazione in blocco.
  function isAligned(fb) {
    if (normalizeStatus(fb).status !== 'aligned') return false;
    return !worstVerdictBlock(fb);
  }

  // Approvazione: APPROVATO = lo status è già nell'iter di lavorazione (todo e successivi).
  // Non si ricalcola da reviewDecision/pipeline/autoMode: chi approva SCRIVE `todo`.
  function isApproved(fb) {
    const { status } = normalizeStatus(fb);
    return ['todo', 'working', 'revision_capability', 'revision_security', 'done'].includes(status);
  }

  // Dashboard unificata (DB1): lookup PURO sul vocabolario (§4), niente pipeline né modalità
  // automatica. L'unico ingrediente extra è il gate DB3 (`opts.releasedVersion`): un `done`
  // è «Risolti» solo se davvero spedito, altrimenti resta visibile «In coda».
  function manageTabFor(fb, opts) {
    const { status } = normalizeStatus(fb);
    const shipped = status === 'done' ? isShipped(fb, opts && opts.releasedVersion) : false;
    return FS().tabFor(status, { shipped });
  }

  // Le AZIONI dell'owner: UNA tabella per tutte le superfici. Le due pagine disegnavano le
  // stesse sezioni ma si costruivano i pulsanti per conto proprio, e sulla STESSA segnalazione
  // offrivano azioni diverse: su un archiviato «Ripristina» di là e «Archivia» di qua, e su un
  // attacco confermato quel bottone scriveva `archived` SOPRA la conferma, cioè cancellava in
  // silenzio una decisione di sicurezza (#509).
  // Da qui le azioni si LEGGONO: sezione (manageTabFor) e status canonico decidono quali sono,
  // con quale etichetta e verso quale stato scrivono; chi ne vuole una in più la aggiunge QUI.
  // Invariante: se puoi archiviare puoi togliere dall'archivio, e mai il contrario nello
  // stesso posto — «Archiviati» offre SOLO il ripristino, così nessun cammino riscrive uno
  // stato terminale con `archived`.
  // `kind` dice cosa scrive il pulsante oltre allo status: 'accept' (override di revisione),
  // 'reject' (conferma di un blocco), 'archive', 'restore', 'resolve' (chiusura a mano),
  // 'reopen' (chiede prima cosa manca, poi rimette in coda).
  // Stato ILLEGGIBILE → nessuna azione: i pulsanti nascono dalla sezione, e qui non si sa.
  function ownerActions(fb, opts) {
    if (statusUnreadable(fb)) return [];
    const { status } = normalizeStatus(fb);
    const tab = manageTabFor(fb, opts);
    if (tab === 'inbox') {
      // Aspetta una decisione: approvare È scrivere `todo`.
      const acts = [{ key: 'accept', kind: 'accept', to: 'todo', label: '→ In coda', primary: true }];
      // Un attacco/spam segnalato si può CONFERMARE: stato terminale, esce dai Ricevuti e resta
      // consultabile negli Archiviati. Il file sospetto non è ancora classificato: le conferme
      // possibili sono DUE.
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
      // Il ripristino rimette in coda (`todo`) anche un attacco/spam confermato: è la strada
      // dichiarata del «era legittimo».
      return [{ key: 'restore', kind: 'restore', to: 'todo', label: '↩ Ripristina', primary: false }];
    }
    return [];
  }

  /** L'azione con questa chiave, se la segnalazione la offre ORA. */
  function ownerActionFor(fb, key, opts) {
    return ownerActions(fb, opts).find((a) => a.key === String(key)) || null;
  }

  // Questa scrittura di stato è UNA DELLE AZIONI che la segnalazione offre adesso? È il
  // guardiano sotto ai pulsanti, non accanto: un pannello rimasto aperto mentre lo stato
  // cambiava, o una pagina non aggiornata, e la scrittura sarebbe di nuovo quella che cancella
  // una conferma.
  function ownerActionAllowsStatus(fb, to, opts) {
    const t = String(to == null ? '' : to);
    return ownerActions(fb, opts).some((a) => a.to === t);
  }

  // L'etichetta di stato in DATI: le due pagine la disegnano col loro markup ma dicono le
  // STESSE parole. Serve anche a non lasciare muta una superficie — la dashboard non scriveva
  // da nessuna parte che una segnalazione era un attacco confermato, e la conversazione
  // continuava a dire che Filo «non ha ancora un parere».
  // → { label, color, hint, reason, reasonText, showReason, encrypted }, o null quando non
  // c'è niente di vero da scrivere.
  function stateBadge(fb) {
    const fs = FS();
    // Stato cifrato: la macchina lo ridurrebbe a «Non filtrato» anche su una segnalazione
    // chiusa. L'unica cosa vera è l'enum grossolano in chiaro.
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
    // Il motivo si SCRIVE solo se ha una traduzione umana: un codice grezzo in mezzo alla riga
    // non dice niente, e resta nell'hover.
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

  // Priorità normalizzata: 1-3 (più alta = affrontata prima dalle routine), 0 = nessuna.
  // Robusta a valori cifrati o non numerici (NaN→0).
  function priorityOf(fb) {
    const p = Math.round(Number(fb && fb.priority) || 0);
    return p >= 1 && p <= 3 ? p : 0;
  }

  // Avanzamento della lavorazione: l'iter ha tre passaggi in ordine — implementazione
  // (working), controllo funzionalità (revision_capability), controllo sicurezza
  // (revision_security). Lo status dice QUAL è il passaggio corrente; i campi claim* e
  // workingSince dicono se un'istanza ci sta lavorando ORA.
  const WORK_STAGES = ['working', 'revision_capability', 'revision_security'];
  const WORK_STEPS = [
    { key: 'impl',     label: 'Implementazione' },
    { key: 'verify',   label: 'Controllo funzionalità' },
    { key: 'security', label: 'Controllo sicurezza' },
  ];

  // Stato di avanzamento nell'iter, o null se non è in lavorazione (opts.now iniettabile).
  // → { status, steps:[{key,label,state:'done'|'current'|'pending'}], current, active, by }.
  // `active` = un'istanza ci sta lavorando adesso: claim vivo in qualunque fase, oppure — solo
  // per `working`, l'unica fase con un lock a TTL suo — un workingSince fresco.
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

  // Feedback di una singola tab, già ordinati. «Ricevuti»: severità del blocco poi recenza,
  // così i non-filtrati e i bloccati gravi salgono. «In coda»: i feedback IN LAVORAZIONE
  // pinnati in cima (prima quelli con un'istanza attiva, poi per fase più avanzata), sotto il
  // resto per priorità DESC, severità e recenza. Altre: createdAt DESC.
  // `opts.releasedVersion` va a manageTabFor per il gate «Risolti».
  function listForManageTab(feedbacks, tab, opts) {
    const items = (feedbacks || []).filter((f) => manageTabFor(f, opts) === tab);
    if (tab === 'inbox') return sortReview(items);
    // In coda la priorità DESC è il criterio primario fra i non-in-lavorazione. `sort` è
    // stabile, quindi a parità resta l'ordine di sortReview e il pinning conserva l'ordine per
    // priorità dentro ogni gruppo.
    if (tab === 'queue') {
      const now = (opts && opts.now) != null ? opts.now : Date.now();
      // Rango di pinning: istanza attiva ora > fase più avanzata > non in lavorazione (-1).
      // Il +10 separa nettamente gli attivi dagli inattivi.
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

  // Preferiti ⭐ (DB2): `starred` è un parcheggio per il futuro, si mette su un feedback
  // qualsiasi a prescindere dallo status. Il filtro ⭐ degli Archiviati mostra TUTTI i
  // preferiti, non solo gli `archived`.
  function isStarred(fb) {
    return !!(fb && fb.starred === true);
  }

  // Lista della tab Archiviati: starredOnly=false → gli `archived`; starredOnly=true → tutti
  // i preferiti di qualunque status; confirmedOnly=true → di quelli, solo attacchi e spam
  // CONFERMATI. I filtri vivono qui e non nella pagina: il conteggio della scheda deve contare
  // esattamente ciò che la lista mostra, o sembra mentire.
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

  // Quanti feedback ci sono in ogni scheda-lista (#495): si conta ESATTAMENTE ciò che la
  // scheda elencherebbe, riusando le funzioni che costruiscono le liste — un numero calcolato
  // con una regola sua prima o poi diverge da quello che si vede aprendo la scheda. Per
  // Ricevuti/In coda/Risolti basta l'appartenenza; Archiviati passa da listArchiveTab, che ha
  // filtri suoi. `opts`: { releasedVersion, starredOnly, confirmedOnly }.
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

  // DC1: la board utente (filo://board/), superficie POSITIVA a permessi ridotti: solo i fix
  // già in produzione (gate «Risolti», DB3) e MAI niente del red-team — si esclude qualunque
  // feedback con un blocco nel pipeline, nemmeno se per qualche motivo è finito in `done`.
  // Un fix con una riapertura in sospeso (DC4) ESCE dalla board: l'utente l'ha segnalato come
  // ancora rotto e il fix è tornato nell'iter, quindi non va più mostrato come «risolto,
  // conferma se funziona» (il flip di `status` lo applica poi il percorso fidato).
  function listBoardTab(feedbacks, opts) {
    const releasedVersion = opts && opts.releasedVersion;
    return listForManageTab(feedbacks, 'resolved', { releasedVersion })
      // Guard red-team: qui si guardano APPOSTA i verdetti grezzi del pipeline e non lo status,
      // perché un feedback segnalato dalla sicurezza non vada mai in board nemmeno se è arrivato
      // a `done`.
      .filter((fb) => !classifyLegacyBlock(fb))
      .filter((fb) => !hasReopenRequest(fb));
  }

  // DC4: un fix è riapribile solo se è OGGI visibile nella board (stessa regola di
  // listBoardTab applicata al singolo feedback) e nessuno l'ha già riaperto. Il guard su
  // `reopenRequests` non è «un utente riapre una volta sola» ma «una volta riaperto da
  // chiunque, il fix è già nell'iter normale»: evita N feedback collegati per lo stesso fix.
  // Finché chi applica il done successivo non azzera la mappa il fix resta bloccato: meglio
  // prudente che riaperture a raffica.
  function hasReopenRequest(fb) {
    const r = fb && fb.reopenRequests;
    return !!(r && typeof r === 'object' && Object.keys(r).length > 0);
  }

  function canReopen(fb, opts) {
    if (!fb) return false;
    if (hasReopenRequest(fb)) return false;
    return listBoardTab([fb], opts).length > 0;
  }

  // Ri-valutazione dei «non filtrati», un id per chiamata: il backend riesegue SOLO i giudici
  // mancanti e torna `recovered` (quanti hanno finalmente votato) e `attempted` (quanti ne ha
  // ritentati, cioè quanti hanno potenzialmente speso crediti). Qui quel dettaglio diventa
  // l'esito che conta per l'owner, così la UI non conta come «valutato» un feedback rimasto
  // bianco:
  // 'recovered' almeno un giudice mancante ha votato → progresso reale;
  // 'wasted'    crediti spesi e nessuno recuperato (modelli mal configurati, credito finito);
  // 'budget'    il backend si è fermato per tempo/budget: riprovare più tardi;
  // 'noop'      niente da ri-valutare, nessun credito speso;  'error' chiamata fallita.
  // `r` è la risposta completa del canale. → { outcome, recovered }
  function classifyReevalResult(r) {
    if (!r || r.ok === false) return { outcome: 'error', recovered: 0 };
    if (r.remaining) return { outcome: 'budget', recovered: 0 };
    const det = (Array.isArray(r.results) && r.results[0]) || r;
    if (det && det.ok === false) return { outcome: 'error', recovered: 0 };
    const recovered = Math.max(0, Number(det && det.recovered) || 0);
    const errorKind = (det && det.errorKind) || null;
    // Run completa (mai giudicato / L1 sbloccato): produce un pipeline nuovo, non ha il
    // concetto di «recuperati» → è sempre progresso reale.
    if (det && det.fullRun) return { outcome: 'recovered', recovered: recovered || 1, errorKind };
    if (recovered > 0) return { outcome: 'recovered', recovered, errorKind };
    // Ha ritentato dei giudici senza recuperarne nessuno: crediti spesi, feedback ancora
    // bianco. `errorKind` dice PERCHÉ.
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

  // Quanti 'wasted' di fila tollerare prima di fermare l'intera ri-valutazione: se i giudici
  // falliscono a vuoto più volte è quasi certo un problema di configurazione o credito, e
  // bruciare crediti sul resto della lista non serve. Basso di proposito.
  const REEVAL_WASTE_LIMIT = 3;

  // I cinque livelli di sicurezza come una fila di forme. La dashboard ne mostrava due: il
  // filtro d'ingresso spariva dentro una parola, quello che Claude segnalava lavorando finiva
  // in mezzo alla conversazione, l'audit lasciava traccia solo quando bocciava e il cancello
  // di fusione viveva in un riquadro a parte. Qui sono cinque forme in fila, sempre le stesse
  // e sempre nello stesso posto — triangolo (filtro d'ingresso), cerchi (giudici), rombo
  // (segnalazione di Claude), pentagono (audit), quadrato (fusione) — e un livello senza
  // parere è GRIGIO ma resta al suo posto: la fila ha sempre la stessa lunghezza e un buco si
  // vede. Questa funzione non disegna niente: dice esito, colore, titolo sotto il puntatore e
  // cosa scrivere nel pannello, così l'intera tabella si prova senza aprire Filo.

  // I quattro colori sono quelli dei pallini dei giudici: stessa scala di severità in tutta
  // la pagina, così il rosso vuol dire la stessa cosa ovunque.
  const LIVELLO_COLORI = {
    attack:  REASONS.attack.color,   // rosso  — bloccato / bocciato
    spam:    REASONS.spam.color,     // giallo — in sospeso, o scavalcato dall'owner
    design:  REASONS.design.color,   // verde  — passato, o una domanda per l'owner
    aligned: ALIGNED.color,          // blu    — pulito
  };

  // Perché il filtro d'ingresso ha deciso così. I codici arrivano dal server; uno che questa
  // tabella non conosce si scrive lo stesso, coi trattini bassi sciolti in spazi: un motivo
  // grezzo dice più di un motivo nascosto.
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

  // Dove è arrivata la pratica e perché, in righe. La fila delle forme racconta i cinque
  // controlli; questo racconta la DECISIONE («attacco confermato», «aspetta la tua
  // approvazione»), che non viene da un controllo ma dall'owner o dalla macchina a stati.
  // Vive nel pannello del triangolo, il primo della fila e l'unico che c'è sempre.
  function righeStato(fb) {
    const righe = [];
    const b = stateBadge(fb);
    if (b) righe.push(riga('Stato', b.label + (b.showReason ? ` — ${b.reasonText}` : '')));
    const nota = judgesNote(fb);
    if (nota && nota.text) righe.push(riga('In breve', nota.text));
    return righe;
  }

  // Livello 1: il filtro d'ingresso (identità, forma, indizi).
  function livelloL1(fb) {
    const titolo = 'Filtro d’ingresso';
    const p = (fb && fb.pipeline && typeof fb.pipeline === 'object') ? fb.pipeline : null;
    const verdicts = (p && Array.isArray(p.verdicts)) ? p.verdicts.filter((v) => v && v.class) : [];
    // Senza categoria ma coi verdetti dei giudici: L2 gira solo se L1 ha fatto passare, quindi
    // «pulito» è un fatto dedotto, non un'ipotesi.
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

  // Livello 2: i giudici, un cerchio per giudice atteso.
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

  // Livello 3: quello che Claude ha segnalato lavorando.
  function livelloL3(fb) {
    const titolo = 'Segnalazione di Claude';
    const l = livelliOf(fb).l3;
    if (!l || !String(l.esito || '').trim()) {
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
    const testo = String(l.testo || '').trim();
    return forma('l3', 'rombo', titolo, 'design', 'segnalato', {
      titolo,
      righe,
      testo: testo || 'La segnalazione è arrivata senza testo.',
      illeggibile: valueUnreadable(l.testo),
      azioni: [],
    });
  }

  const L4_ESITI = {
    pass:    { classe: 'design', etichetta: 'Passato' },
    fail:    { classe: 'attack', etichetta: 'Bocciato' },
    saltato: { classe: 'spam',   etichetta: 'Saltato dall’owner' },
  };

  // Livello 4: l'audit di sicurezza sul lavoro fatto.
  function livelloL4(fb) {
    const titolo = 'Audit di sicurezza';
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
      // Bocciato: l'owner legge e può andare avanti lo stesso. Il cancello di fusione (L5) resta,
      // quindi non è un via libera cieco.
      azioni: esito === 'fail' ? ['salta_l4'] : [],
    });
  }

  // La mappa `livelli` del documento, sempre un oggetto.
  function livelliOf(fb) {
    const l = fb && fb.livelli;
    return (l && typeof l === 'object') ? l : {};
  }

  // Il numero della segnalazione, senza cancelletto.
  function numeroOf(fb) {
    const s = Number(fb && fb.seq);
    if (!Number.isInteger(s) || s <= 0) return '';
    const sub = Number(fb && fb.subSeq);
    return Number.isInteger(sub) && sub > 0 ? `${s}.${sub}` : String(s);
  }

  // Questa richiesta di fusione nasce da QUESTA segnalazione?
  function richiestaDiQuesto(req, fb) {
    if (!req || !fb) return false;
    const id = String(req.feedbackId || '').trim();
    if (id && id === String(fb._id || '')) return true;
    const num = String(req.num || '').trim().replace(/^#+/, '');
    return !!num && num === numeroOf(fb);
  }

  // Livello 5: il cancello di fusione. Le richieste arrivano dal server e si legano alla
  // segnalazione per id o per numero. `opts.fusioni` = { pending, failed, preapproved, recent }.
  function livelloL5(fb, opts) {
    const titolo = 'Fusione';
    const f = (opts && opts.fusioni && typeof opts.fusioni === 'object') ? opts.fusioni : {};
    const lista = (k) => (Array.isArray(f[k]) ? f[k] : []).filter((r) => richiestaDiQuesto(r, fb));
    const pending = lista('pending');
    const failed = lista('failed');
    const preapproved = lista('preapproved');
    const { status, statusReason } = normalizeStatus(fb);

    // Il server segna sul documento che la pratica è ferma al cancello (`design`/`l5`), e vale
    // da solo: gli elenchi delle richieste possono non essere ancora arrivati, o essere vuoti
    // perché questo non è il computer dell'owner — e un quadrato grigio direbbe il falso.
    const fermaDaStato = status === 'design' && statusReason === 'l5';

    // Una fusione approvata e mai avvenuta (conflitto) pesa quanto una richiesta ferma: è un sì
    // già dato che non ha prodotto niente.
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

  // La fila intera, sempre cinque voci nello stesso ordine. `opts.fusioni` = gli elenchi del
  // server.
  function livelli(fb, opts) {
    return [livelloL1(fb), livelloL2(fb), livelloL3(fb), livelloL4(fb), livelloL5(fb, opts)];
  }

  // La voce di un livello per chiave ('l1'…'l5'), o null.
  function livelloPer(fb, key, opts) {
    return livelli(fb, opts).find((l) => l.key === String(key)) || null;
  }

  // Questa segnalazione ha una fusione ferma che aspetta l'owner? È quello che fa diventare
  // rossa la scheda in lista e la porta in cima alle cose da decidere.
  function fusioneInAttesa(fb, opts) {
    const l5 = livelloL5(fb, opts);
    return l5.esito === 'bloccato' || l5.esito === 'conflitto';
  }

  // Le richieste di fusione che NON hanno una segnalazione in questa lista: non hanno una
  // scheda dove vivere e restano visibili in Automazioni. Senza, una fusione locale (un ramo
  // senza numero) sparirebbe.
  function fusioniSenzaFeedback(richieste, feedbacks) {
    const list = Array.isArray(feedbacks) ? feedbacks : [];
    return (Array.isArray(richieste) ? richieste : [])
      .filter((r) => !list.some((fb) => richiestaDiQuesto(r, fb)));
  }

  // Il testo di un livello spezzato in righe tipizzate, per disegnarlo senza HTML. I file di
  // `--segnala` e `--nota` sono markdown con tre titoli obbligatori e voci a trattino: mostrati
  // grezzi, cancelletti e trattini compaiono come caratteri e l'owner legge simboli invece di
  // tre sezioni. Si riconoscono SOLO titoli e voci d'elenco: niente HTML dal testo, che resta
  // testo. → { tipo:'titolo', livello:1..6, testo } | { tipo:'voce', testo } |
  // { tipo:'testo', testo } (le righe di seguito si uniscono in un paragrafo)
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
    // Il guard «questo è passato dalle mani della sicurezza», letto dai campi grezzi. Lo usano
    // listBoardTab qui dentro e feedbackPublicView.js (#583) per decidere se un feedback può
    // avere una scheda pubblica: stessa domanda, stessa funzione — una seconda copia sarebbe
    // quella che un giorno dice sì dove questa dice no.
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
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
