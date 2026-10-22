// Logica PURA della sezione «Revisione» della dashboard di gestione (niente Electron,
// niente rete): tutto quello che sta qui si prova con `npm run test:unit`.

(function (global) {
  'use strict';

  // Motivi di blocco in ordine di severità; `color` diventa --mg-item-color nel CSS.
  // `loop` (fix che fallisce la verifica tre volte) è il più severo: lo decide l'owner.
  const REASONS = {
    loop:       { label: 'Loop',         color: '#111111', severity: 5 },
    // «Non filtrato»: il panel dei giudici non si è completato, non è una classe di rischio.
    // Per instradamento vale come il più severo: mai in coda, resta nei Ricevuti.
    unfiltered: { label: 'Non filtrato', color: '#ffffff', severity: 4 },
    // Bocciatura di SICUREZZA sul fix: torna all'owner, ma col rosso dell'attacco, non col
    // verde di `design`: un allarme di sicurezza non è una questione di gusto.
    secaudit:   { label: 'Bloccato dalla sicurezza', color: '#c0392b', severity: 3 },
    // Fermata al cancello di fusione: fix e audit ok, ma il ramo non entra in main senza
    // l'owner. Rosso: è un allarme che aspetta una persona.
    l5:         { label: 'Fusione ferma', color: '#c0392b', severity: 3 },
    // Il lavoro di una routine fermo perché il feedback d'utente da cui nasce è stato bloccato (#914): rosso come lui.
    origine_bloccata: { label: 'Bloccato con l’origine', color: '#c0392b', severity: 3 },
    attack:     { label: 'Attacco',      color: '#c0392b', severity: 3 },
    spam:       { label: 'Spam',         color: '#e08e0b', severity: 2 },
    design:     { label: 'Design',       color: '#2e9e5b', severity: 1 },
  };

  // Panel atteso: 3 fissi + 1 dinamico; il numero esatto sta in `pipeline.expectedJudges`.
  // Per lo storico vale questo default: meno verdetti del previsto = un giudice è saltato.
  const DEFAULT_PANEL_SIZE = 4;
  function panelSize(p) {
    if (p && Array.isArray(p.expectedJudges) && p.expectedJudges.length) {
      return p.expectedJudges.length;
    }
    return DEFAULT_PANEL_SIZE;
  }

  // Stati "chiusi": non vanno (più) giudicati, restano nei loro flussi.
  const CLOSED_STATUSES = ['done', 'verified', 'archived', 'ignored'];

  // La fiducia (SPEC-DOMANDE.md §1): `fiducia` la scrive solo il server; assente o ignota vale non fidato.
  // Gemello di fiduciaDi in filo-security/functions/src/fiducia.js.
  function isFidato(fb) {
    return !!fb && fb.fiducia === 'fidato';
  }

  // La classe del mittente (SPEC-DOMANDE.md §10): solo per leggere e contare, i permessi seguono `fiducia`. Nelle
  // pagine filo:// shared/mittenti.js va incluso prima di questo file; in Node si carica da sé.
  function MT() {
    if (!global.SN_MITTENTI && typeof require === 'function') require('./mittenti.js');
    const m = global.SN_MITTENTI;
    if (!m) throw new Error('SN_MITTENTI mancante: carica shared/mittenti.js prima di manageReview.js');
    return m;
  }
  function isUnprovenSender(fb) {
    return !!fb && MT().nomeRiservato(fb.clientId) && !MT().PROVE.includes(fb.senderProof);
  }
  // Il mittente con cui decidere autore e gruppo: senza prova il prefisso riservato non lo riconosce nessuno,
  // cioè vale come un utente. Stessa chiave di effectiveClientId sul server.
  function effectiveClientId(fb) {
    const c = String((fb && fb.clientId) || '');
    return isUnprovenSender(fb) ? 'non-provato:' + c : c;
  }

  // ── Lavori server (#908, #1358) ──────────────────────────────────────────
  // `localOnly { by, at }` toglie la pratica alla coda normale delle routine; in lista resta nella scheda del suo stato
  // con l'etichetta «server» (#1575). Lo mette il server quando chi lavora lo chiede, o «💻 Lavoro server» su un rombo
  // azzurro (`localApproval { by, at }`, #913: lo scrive solo l'admin). Saltare L5 lo decide il server (fiduciaRamo.js).
  function isLocalOnly(fb) {
    const m = fb && fb.localOnly;
    return !!m && typeof m === 'object' && String(m.by || '').trim() !== '';
  }
  // Le attese che segue il server, non le routine: gli unit sulla fusione lanciati da GitHub (#1207) e, per un lavoro
  // server (#1159), il PC dell'owner e la suite di filo-security. Gemello di select.ATTESA nel server; fuori dalla
  // revisione il segno vecchio non conta.
  const ATTESE_SERVER = Object.freeze({ fusione_server: 'pc', suite_server: 'suite', unit_fusione: 'unit' });
  function attesaServer(fb) {
    if (!fb || normalizeStatus(fb).status !== 'revision_security') return '';
    return Object.prototype.hasOwnProperty.call(ATTESE_SERVER, fb.attesa) ? ATTESE_SERVER[fb.attesa] : '';
  }
  function inAttesaFusioneServer(fb) {
    return attesaServer(fb) === 'pc';
  }
  // Owner o sessione locale con la prova dell'admin: conta solo per le pratiche nate prima della migrazione (§1.7).
  function isProvenLocalSender(fb) {
    const m = fb && fb.senderProof === 'admin' ? MT().classifica(fb) : null;
    return !!m && (m.classe === 'owner' || m.classe === 'sessione_locale');
  }
  function isLocalApproved(fb) {
    const m = fb && fb.localApproval;
    return !!m && typeof m === 'object' && String(m.by || '').trim() !== '';
  }
  // Senza scheda pubblica solo il lavoro dell'owner e delle sessioni: il feedback di un utente approvato come lavoro
  // locale (#913) la tiene, è da lì che chi l'ha mandato vede la risoluzione. Gemello: isPrivateLocalWork sul server.
  function isPrivateLocalWork(fb) {
    // Il segno messo da una routine (#1358, il lavoro passato ai lavori server) non toglie la scheda a chi l'aveva.
    return isLocalOnly(fb) && !isLocalApproved(fb) && String(fb.localOnly.by || '') !== 'routine';
  }
  // Un utente approvato (#913) vede la risoluzione con la sola frase per lui: la chiusura locale non la porta, la scrive la sessione.
  function fraseAttesa(fb) {
    return isLocalApproved(fb) && !MT().diProcesso(fb) && !String(fb.userNote || '').trim();
  }
  // Giudici saltati alla nascita: `pipeline.skipped` lo scrive solo il server, e solo per un feedback fidato
  // (functions/src/nascita.js). Senza fiducia non vale, e la pratica resta da giudicare.
  const GIUDICI_SALTATI = Object.freeze({
    fidato: 'Fidato: i giudici non servono.',
    local_proven: 'Lavoro locale fidato: i giudici non servono.',
    routine_proven: 'Aperto da un lavoro fidato: i giudici non servono.',
    // Documenti nati prima della fiducia: nessuno lo scrive più.
    session_proven: 'Aperto da una sessione con la prova del mittente: i giudici non servono.',
  });
  // Il feedback da cui nasce un lavoro di routine (#914): il numero lo scrive il server nel pipeline alla decisione.
  function origineText(fb) {
    const o = fb && fb.pipeline && fb.pipeline.origine;
    const num = o && typeof o === 'object' ? String(o.num || '').trim() : '';
    return num ? `il feedback da cui nasce (${num})` : 'il feedback da cui nasce';
  }
  // L'allarme della pubblicazione (#1002) non nasce da un lavoro: lo apre il server.
  const ALLARME_COSTRUZIONE = 'agent:costruzione';
  function judgesSkippedText(fb) {
    const p = fb && fb.pipeline;
    const k = p && typeof p === 'object' ? String(p.skipped || '') : '';
    if (!Object.prototype.hasOwnProperty.call(GIUDICI_SALTATI, k)) return '';
    if (!isFidato(fb)) return '';
    if (k === 'routine_proven' && effectiveClientId(fb).toLowerCase() === ALLARME_COSTRUZIONE) {
      return 'Allarme aperto dal server: i giudici non servono.';
    }
    return GIUDICI_SALTATI[k];
  }
  // Le immagini che i giudici non hanno visto, col motivo scritto dal server (#597): un buco si spiega, non si tace.
  function immaginiNonViste(fb) {
    const p = fb && fb.pipeline;
    const l = p && typeof p === 'object' && Array.isArray(p.immaginiNonAperte) ? p.immaginiNonAperte : [];
    return l.filter((x) => x && Number.isInteger(x.n) && x.n > 0)
      .map((x) => `Immagine ${x.n} non vista dai giudici: ${String(x.motivo || '').trim() || 'motivo non registrato'}.`);
  }
  // Un lavoro di routine che aspetta la fusione del feedback d'utente da cui nasce (#914): non è un «non filtrato»,
  // il server non lo ri-giudica; entra in coda da solo. Il motivo lo scrive solo il server, fidato o già giudicato.
  function inAttesaOrigine(fb) {
    const { status, statusReason } = normalizeStatus(fb);
    return status === 'unlabeled' && statusReason === 'attesa_origine';
  }

  // Vocabolario unico della macchina a stati (feedbackStatus.js), letto pigramente: va
  // incluso PRIMA di questo file. Se manca, errore chiaro subito.
  function FS() {
    const m = global.SN_FB_STATUS;
    if (!m) throw new Error('SN_FB_STATUS mancante: carica shared/feedbackStatus.js prima di manageReview.js');
    return m;
  }

  // Classificazione LEGACY dai campi grezzi: serve SOLO a normalizeStatus per sciogliere gli
  // stati ritirati (`new`, `blocked`) dello storico. Nessun consumer ricalcola lo stato.
  function classifyLegacyBlock(fb) {
    // Override dell'owner: un feedback sbloccato a mano non è più un blocco e rientra nel
    // flusso normale. Vince su qualsiasi verdetto del pipeline.
    if (fb && fb.reviewDecision === 'accepted') return null;

    // Vince su tutto: il blocco `loop` richiede una decisione dell'owner (vedi REASONS).
    if (fb && fb.status === 'blocked' && fb.blockReason === 'loop') {
      return { reason: 'loop', ...REASONS.loop };
    }

    const p = fb && fb.pipeline;
    const verdicts = (p && Array.isArray(p.verdicts)) ? p.verdicts.filter((v) => v && v.class) : [];
    // Lo stato lo decide statusForDecision sul server, che esenta da attacco/spam il feedback fidato (mai il mittente, §10).
    const trusted = isFidato(fb);
    const status = (fb && fb.status) || 'new';
    // «Da giudicare»: aperto e in attesa. Esclude i chiusi e i `clarify`, che sono un dialogo
    // con l'owner, non un'attesa dei giudici.
    const judgeable = !CLOSED_STATUSES.includes(status) && status !== 'clarify';

    // SENZA verdetti: fidato coi giudici saltati alla nascita → nessun colore; fidato flaggato per errore
    // → "da ri-giudicare" (bianco), non un blocco. Va prima dei controlli di blocco identità.
    if (p && verdicts.length === 0 && judgeable) {
      if (judgesSkippedText(fb)) return null;
      if (trusted) return { reason: 'unfiltered', ...REASONS.unfiltered };
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
    // Un segno di giudici saltati che non vale (senza fiducia): i giudici non hanno mai girato, si ri-giudica.
    if (verdicts.length === 0 && judgeable && p.skipped) {
      return { reason: 'unfiltered', ...REASONS.unfiltered };
    }

    // Panel parziale vince su attacco/spam/design: dice che il filtraggio NON è affidabile.
    // Per lo storico si DEDUCE: verdetti sotto il panel atteso = un giudice è saltato.
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

  // «In produzione» solo se il fix è uscito: `releasedVersion` è la versione in esecuzione
  // (l'owner gira una build rilasciata); `resolvedInVersion` futura = resta «In coda».
  function isShipped(fb, releasedVersion) {
    if (!releasedVersion) return true;
    const v = fb && fb.resolvedInVersion;
    if (!v) return true;
    return cmpVersion(v, releasedVersion) <= 0;
  }

  // «Allineato» LEGACY (panel completo, giudici d'accordo): usata SOLO da normalizeStatus
  // per lo storico.
  const ALIGNED = { color: '#5b6ee0', label: 'Allineato' };
  // Rimandato all'owner perché si finisce solo sulla sua macchina (#1060): l'azzurro dello schermo di 💻, l'icona
  // che nella pagina vuol già dire «sessione locale». Le regole CSS lo ripetono: tests/unit/segnoFermata.test.mjs.
  const LOCALE = { color: '#26c9fc', label: 'Lavoro locale' };
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

  // normalizeStatus: la SOLA porta d'ingresso allo stato, torna sempre uno status CANONICO
  // (FEEDBACK-STATES.md §2) più statusReason. new/blocked/assente si derivano dai grezzi.
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

  // Lo status fine viaggia CIFRATO: senza chiave ogni feedback ricade in `unlabeled`, e le
  // sezioni «(0)» dichiarerebbero il vuoto dove la verità è che non lo sappiamo.
  const CIPHER_PREFIXES = ['FENC', '[cifrato'];
  function looksEncrypted(value) {
    const raw = String(value == null ? '' : value).trim();
    return CIPHER_PREFIXES.some((p) => raw.startsWith(p));
  }

  // Lo status di QUESTO feedback è illeggibile? Riconoscimento STRETTO: uno status assente o
  // inventato la macchina lo scioglie davvero (→ `unlabeled`) e le pagine restano allineate.
  function statusUnreadable(fb) {
    return looksEncrypted(fb && fb.status);
  }

  // Questo VALORE è arrivato cifrato? Stesso riconoscimento stretto per gli altri campi
  // cifrati: mostrare un blob al posto di un testo è la stessa bugia, in piccolo.
  function valueUnreadable(value) {
    return looksEncrypted(value);
  }

  // Sezioni disegnabili solo se la pagina non legge NESSUNO stato: o hai la chiave e li leggi
  // tutti, o nessuno. Un documento storto fra mille leggibili lascia la barra al suo posto.
  function sectionsReliable(feedbacks) {
    const list = feedbacks || [];
    return !list.length || !list.every(statusUnreadable);
  }

  // Senza chiave l'unica cosa vera è l'enum grossolano in chiaro (`statusPublic`), e va
  // detto con QUESTE parole in ogni pagina.
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

  // Sicurezza-conservativa: vale la categoria PIÙ ALTA, non la maggioritaria — un falso
  // negativo costa più di un falso positivo, che finisce comunque in revisione umana.
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

  // Classifica per Revisione/Ricevuti: dallo status normalizzato più l'escalation più alta
  // votata da un giudice. Solo nei «Ricevuti»: dopo, la decisione umana vince sui verdetti.
  function classifyBlock(fb) {
    const fs = FS();
    const { status, statusReason } = normalizeStatus(fb);
    if (aspettaDomanda(fb)) return null;
    if (status === 'aligned') return worstVerdictBlock(fb);
    if (inAttesaOrigine(fb)) return null;
    const info = fs.STATUSES[status];
    if (!info || info.tab !== 'inbox') return null;
    // Lo stato è `design` ma la ragione è la sicurezza: il colore lo dice REASONS.secaudit.
    if (status === 'design' && statusReason === 'secaudit') {
      return { reason: 'secaudit', ...REASONS.secaudit };
    }
    // Ferma al cancello di fusione: c'è una richiesta che aspetta l'owner.
    if (status === 'design' && statusReason === 'l5') {
      return { reason: 'l5', ...REASONS.l5 };
    }
    if (status === 'design' && statusReason === 'origine_bloccata') {
      return { reason: 'origine_bloccata', ...REASONS.origine_bloccata };
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

  // Panel COMPLETO: ci sono tutti i verdetti attesi e la pipeline non lo dice parziale.
  // È il discrimine fra «manca un giudice, ri-valuta» e «giudicato per intero».
  function panelComplete(fb) {
    const p = fb && fb.pipeline;
    if (!p || typeof p !== 'object') return false;
    if (p.l2Unfiltered === true || p.l2Degraded === true) return false;
    const verdicts = Array.isArray(p.verdicts) ? p.verdicts.filter((v) => v && v.class) : [];
    return verdicts.length > 0 && verdicts.length >= panelSize(p);
  }

  // I pallini dicono COSA hanno votato i giudici, questa frase PERCHÉ il feedback è in quello
  // stato: non sempre coincidono. → { text, color } o null se non c'è niente da spiegare.
  function judgesNote(fb) {
    const fs = FS();
    const S = fs.STATUSES;
    // Stato illeggibile: niente da spiegare (vedi looksEncrypted e publicStateLabel).
    if (statusUnreadable(fb)) return null;
    const { status, statusReason } = normalizeStatus(fb);
    if (status === 'design') {
      if (statusReason === 'secaudit') {
        return { text: 'Il controllo di sicurezza ha bocciato il fix: decidi tu.', color: REASONS.secaudit.color };
      }
      if (statusReason === 'l5') {
        return { text: 'Il ramo è fermo al cancello di fusione. Decidi tu nel quadrato.', color: REASONS.l5.color };
      }
      if (statusReason === 'origine_bloccata') {
        return { text: `Fermo perché ${origineText(fb)} è stato bloccato: decidi tu.`, color: REASONS.origine_bloccata.color };
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
      // Un guasto dell'ambiente non è lavoro locale né un verdetto (#1241): cosa fare sta nella domanda della nota.
      if (statusReason === 'guasto') {
        return { text: 'Fermo per un guasto, non per una scelta: cosa è successo e cosa puoi fare stanno nella domanda.', color: S.design.color };
      }
      // Lo rimandano qui una sessione o una routine, su un feedback di chiunque (#914): la frase segue il mittente.
      if (statusReason === 'locale') {
        // Fidato o già approvato: basta il segno. Gli altri passano dal sì dell'owner (#913), che li segna anche fidati.
        const text = localSenderCheck(fb).ok
          ? 'Richiede lavoro locale: con «💻 Lavoro server» torna In coda come lavoro server.'
          : 'Richiede lavoro locale: decidi tu. Con «💻 Lavoro server» torna In coda come lavoro server.';
        return { text, color: LOCALE.color };
      }
      return { text: 'Per i giudici è una questione di design: decidi tu.', color: S.design.color };
    }
    if (status === 'aligned') {
      if (statusReason === 'origine_chiusa' || statusReason === 'origine_mancante') {
        const come = statusReason === 'origine_chiusa' ? 'si è chiuso senza fusione' : 'non c’è più';
        const t = `${origineText(fb)} ${come}: decidi tu.`;
        return { text: t.charAt(0).toUpperCase() + t.slice(1), color: S.aligned.color };
      }
      const saltati = judgesSkippedText(fb);
      if (saltati) return { text: `${saltati} Aspetta la tua approvazione.`, color: S.aligned.color };
      const worst = worstVerdictBlock(fb);
      if (worst) {
        return { text: `Un giudice ha segnalato: ${worst.label.toLowerCase()}. Da esaminare prima di approvare.`, color: worst.color };
      }
      return { text: 'Tutti d’accordo: aspetta la tua approvazione.', color: S.aligned.color };
    }
    if (status === 'attack') return { text: 'Segnalato come attacco.', color: S.attack.color };
    if (status === 'spam') return { text: 'Segnalato come spam.', color: S.spam.color };
    if (status === 'unlabeled') {
      // Un lavoro di routine nato da un feedback d'utente entra in coda quando quello si fonde (#914).
      if (inAttesaOrigine(fb)) {
        const o = fb.pipeline && fb.pipeline.origine;
        const num = o && typeof o === 'object' ? String(o.num || '').trim() : '';
        return { text: `Aspetta la fusione di ${num || 'il feedback da cui nasce'}, poi entra in coda da solo.`, color: null };
      }
      // Un non fidato che i giudici non hanno visto (#1515): è fermo per l'owner, non in attesa del giudizio.
      if (statusReason === 'budget_giudici' || statusReason === 'lunghezza_giudici') {
        const perche = statusReason === 'budget_giudici'
          ? 'Non giudicato, perché oggi i giudici dei non fidati hanno già speso il tetto.'
          : 'Non giudicato, perché è troppo lungo per i giudici.';
        return { text: `${perche} Leggilo e decidi tu, o mandalo ai giudici lo stesso con «Ri-valuta i non filtrati».`, color: null };
      }
      if (panelComplete(fb)) {
        const worst = worstVerdictBlock(fb);
        if (worst) {
          const chi = isFidato(fb) ? 'Fidato, ma segnalato'
            : MT().diProcesso(fb) ? 'Mittente provato, segnalato' : 'Segnalato';
          return { text: `${chi} come ${worst.label.toLowerCase()}: decidi tu.`, color: worst.color };
        }
        return null;
      }
      const p = fb && fb.pipeline;
      const verdicts = (p && Array.isArray(p.verdicts)) ? p.verdicts.filter((v) => v && v.class) : [];
      // Fermata prima dei giudici: il perché lo scrive il server nella scheda del filtro d'ingresso.
      const sch = verdicts.length ? null : schedaIngresso(fb);
      if (sch && sch.breve) return { text: `${sch.breve}.`, color: sch.classe ? LIVELLO_COLORI[sch.classe] : null };
      if (!verdicts.length) return { text: 'In attesa del giudizio.', color: null };
      const missing = Math.max(0, panelSize(p) - verdicts.length);
      return { text: `Panel incompleto: ${missing} giudic${missing === 1 ? 'e' : 'i'} senza verdetto.`, color: null };
    }
    return null;
  }

  // Motivo dello stato in parole, per tooltip e sottotesti: i codici grezzi non dicono niente.
  // Un motivo sconosciuto passa invariato: meglio grezzo che muto.
  const REASON_TEXTS = {
    secaudit: 'bloccato dalla sicurezza',
    l5: 'fermo al cancello di fusione',
    attesa_origine: 'aspetta la fusione del feedback da cui nasce',
    origine_bloccata: 'bloccato con il feedback da cui nasce',
    origine_chiusa: 'il feedback da cui nasce si è chiuso senza fusione',
    origine_mancante: 'il feedback da cui nasce non c’è più',
    clarify: 'domande per te',
    loop: 'difetto non più correggibile da soli',
    decisione: 'fermo: aspetta una tua scelta',
    locale: 'richiede lavoro locale',
    fidato: 'chiede di renderlo fidato: il lavoro tocca il server',
    worker: 'segnalato da chi ci lavorava',
    attesa_chiusa: 'un feedback che aspettava si è chiuso senza fusione',
    arenato: 'lavorazione arenata',
    guasto: 'fermo per un guasto',
    judges: 'verdetto dei giudici',
    duplicate: 'duplicato',
    // #1515: i due motivi con cui il server lascia un non fidato all'owner senza giudici.
    budget_giudici: 'tetto di spesa dei giudici raggiunto',
    lunghezza_giudici: 'troppo lungo per i giudici',
  };
  function reasonText(statusReason) {
    const k = String(statusReason || '');
    return REASON_TEXTS[k] || k;
  }

  // «Allineato» = status `aligned` (badge blu, aspetta approvazione). Ma se anche un solo
  // giudice ha segnalato un rischio NON lo è: non deve finire nell'approvazione in blocco.
  function isAligned(fb) {
    if (normalizeStatus(fb).status !== 'aligned') return false;
    // Con la domanda aperta non si approva in blocco: si risponde a lei (SPEC-DOMANDE §3.8).
    if (aspettaDomanda(fb)) return false;
    return !worstVerdictBlock(fb);
  }

  // Approvazione: APPROVATO = lo status è già nell'iter di lavorazione (todo e successivi).
  // Non si ricalcola da reviewDecision/pipeline/autoMode: chi approva SCRIVE `todo`.
  function isApproved(fb) {
    const { status } = normalizeStatus(fb);
    return ['todo', 'working', 'revision_capability', 'revision_security', 'done'].includes(status);
  }

  // ── Dashboard unificata (DB1): mappatura feedback → tab ───────────────────
  // Lookup PURA sul vocabolario (spec §4): niente pipeline, niente isApproved,
  // niente modalità automatica. Ingredienti extra: il gate DB3
  // (`opts.releasedVersion`): un `done` è "Risolti" solo se davvero spedito,
  // altrimenti resta visibile "In coda"; e `opts.fusioni` (vedi sotto).
  function manageTabFor(fb, opts) {
    const { status } = normalizeStatus(fb);
    const shipped = status === 'done' ? isShipped(fb, opts && opts.releasedVersion) : false;
    const tab = FS().tabFor(status, { shipped });
    // Una richiesta di fusione che aspetta l'owner è una sua decisione: Ricevuti anche se lo stato
    // non è arrivato al cancello. Solo `pending`: una fallita per conflitto la riallinea la routine.
    if (tab && tab !== 'archived' && richiestaInAttesa(fb, opts)) return 'inbox';
    // Un'attesa con la sua domanda (SPEC-DOMANDE §3.8): si risponde nella domanda, il lavoro sta in coda col segno.
    if (tab === 'inbox' && aspettaDomanda(fb)) return 'queue';
    // Il segno dei lavori server non sposta di scheda (#1575): lo dice l'etichetta «server» sulla riga.
    // Chi aspetta un feedback non ancora fuso (#903), o una domanda aperta che lo ferma (#1577), la coda non lo dà a
    // nessuno: sta fra quelli che aspettano.
    if (tab === 'queue' && STATI_CHE_ASPETTANO.includes(status) && (aspettaAncora(fb, opts) || fermoSuDomanda(fb))) return 'waiting';
    return tab;
  }

  // Le attese che aprono una domanda (functions/src/domande/attese.js): mai i blocchi di sicurezza né `fidato`.
  const ATTESE_CON_DOMANDA = {
    design: ['clarify', 'decisione', 'loop', 'arenato', 'locale', 'attesa_chiusa', 'guasto'],
    aligned: ['origine_chiusa', 'origine_mancante'],
  };
  const DOMANDA_ID_RE = /^D-[1-9]\d{0,8}$/;

  /** Le domande aperte che fermano questo feedback in coda (#1577): le scrive il server in `domandeBloccanti`. PURA. */
  function domandeBloccantiDi(fb) {
    const l = fb && fb.domandeBloccanti;
    return Array.isArray(l) ? l.map(String).filter((id) => DOMANDA_ID_RE.test(id)) : [];
  }
  function fermoSuDomanda(fb) {
    return !!fb && !statusUnreadable(fb) && STATI_CHE_ASPETTANO.includes(normalizeStatus(fb).status) && domandeBloccantiDi(fb).length > 0;
  }

  /** L'id della domanda che questo feedback aspetta (`D-12`), o '': quella della sua attesa, o la prima che lo ferma in coda. PURA. */
  function aspettaDomanda(fb) {
    if (!fb || statusUnreadable(fb)) return '';
    if (fermoSuDomanda(fb)) return domandeBloccantiDi(fb)[0];
    const id = String(fb.domandaId || '');
    if (!DOMANDA_ID_RE.test(id)) return '';
    const { status, statusReason } = normalizeStatus(fb);
    const motivi = ATTESE_CON_DOMANDA[status];
    return motivi && motivi.includes(String(statusReason || '')) ? id : '';
  }

  // Gli stati in cui la coda delle routine darebbe lavoro: lì le attese contano (functions/src/routine/waits.js).
  const STATI_CHE_ASPETTANO = ['todo', 'revision_capability', 'revision_security'];
  // `opts.trovaAtteso(id)` → il documento dell'aspettato, se la pagina lo conosce. Senza il modulo nessuna attesa.
  function aspettaAncora(fb, opts) {
    const A = global.SN_FB_ATTESE;
    return !!A && A.aspettaAncora(fb, opts && opts.trovaAtteso);
  }

  // Gli stati in cui una pratica aspetta l'owner: le sessioni locali non la spostano da lì (#908).
  function isRicevutiStatus(status) {
    const info = FS().STATUSES[String(status || '')];
    return !!info && info.tab === 'inbox';
  }

  /** Cosa hanno segnalato filtro e giudici (`pipeline` decifrato). PURA. Fonte unica: chi guarda i giudizi la chiede qui. */
  function segnaliDeiGiudici(pipeline) {
    const p = pipeline && typeof pipeline === 'object' ? pipeline : null;
    if (!p) return { attacco: false, spam: false };
    const verdetti = Array.isArray(p.verdicts) ? p.verdicts : [];
    const ha = (cls) => verdetti.some((v) => v && v.class === cls);
    return {
      attacco: p.action === 'block_attack' || p.l1Category === 'dangerous' || p.l2Class === 'attack' || ha('attack'),
      spam: p.action === 'block_spam' || p.l1Category === 'spam' || p.l2Class === 'spam' || ha('spam'),
    };
  }

  /**
   * '' se una sessione ne può leggere il testo, altrimenti il motivo (#908). PURA.
   * Per un mittente fidato il server lascia l'attacco nei Ricevuti come «Non filtrato»: lo stato da solo non basta.
   */
  function segnalatoComeAttacco(fb) {
    const s = String((fb && fb.status) || '').trim();
    if (s === 'suspicious_file') return 'è segnalato come file sospetto';
    if (s === 'attack' || s === 'attack_confirmed') return `è segnalato come attacco («${s}»)`;
    if (!isRicevutiStatus(s)) return '';
    const p = fb && fb.pipeline;
    if (p !== undefined && p !== null && p !== '' && typeof p !== 'object') return 'il giudizio non si decifra: non so se è segnalato come attacco';
    return segnaliDeiGiudici(p).attacco ? 'è nei Ricevuti col giudizio d’attacco del filtro o dei giudici' : '';
  }

  /**
   * Cosa dice il giudizio a chi sta per leggerne il testo (#1514). PURA. `leggibile`: panel completo, o giudici saltati
   * su un fidato; `mai_giudicato` è tutto il resto (filtro all'ingresso, panel parziale o degradato, nessun giudizio),
   * che dai segni d'attacco da solo non si distingue da un pulito. Un completo con attacco fuori dai Ricevuti l'ha
   * spostato l'owner: la decisione è sua.
   */
  function giudizioPerLettura(fb) {
    const segnalato = segnalatoComeAttacco(fb);
    if (segnalato) return { esito: 'segnalato', motivo: segnalato };
    if (judgesSkippedText(fb) || panelComplete(fb)) return { esito: 'leggibile', motivo: '' };
    const p = fb && fb.pipeline;
    const mai = (motivo) => ({ esito: 'mai_giudicato', motivo });
    if (p === undefined || p === null || p === '') return mai('nessun giudizio registrato');
    if (typeof p !== 'object') return mai('il giudizio non si decifra');
    const verdetti = Array.isArray(p.verdicts) ? p.verdicts.filter((v) => v && v.class).length : 0;
    if (p.skipped && !verdetti) return mai('giudici saltati su una pratica non fidata');
    if (!verdetti && (p.l1Category || p.action)) return mai('fermato dal filtro all’ingresso, nessun giudice');
    if (p.l2Unfiltered === true || p.l2Degraded === true) return mai('panel dei giudici degradato');
    if (verdetti) return mai(`panel parziale, ${verdetti} giudic${verdetti === 1 ? 'e' : 'i'} su ${panelSize(p)}`);
    return mai('nessun verdetto dei giudici');
  }

  /**
   * Il segno «solo in locale» si può mettere (`valore` true) o togliere su questa pratica? PURA.
   * Ritorna { ok: true } o { ok: false, motivo, utente } — `utente` vuol dire che il feedback
   * è di un utente: in locale si lavora solo col sì dell'owner (#913), e se servisse torna nei Ricevuti.
   * `opts.now` iniettabile nei test.
   */
  // Chiusa per lo stato o per il riflesso pubblico: lì il segno locale tiene la pratica fuori dalla bacheca, non dalle routine.
  function praticaChiusa(fb, opts) {
    const tab = manageTabFor(fb, opts);
    return tab === 'resolved' || tab === 'archived' || ['done', 'archived'].includes(normalizeStatus(fb).status)
      || String((fb && fb.statusPublic) || 'open') === 'closed';
  }

  function localSignCheck(fb, valore, opts) {
    if (!fb) return { ok: false, motivo: 'feedback non trovato' };
    if (!valore) {
      if (!isLocalOnly(fb)) return { ok: false, motivo: 'il segno «solo in locale» non c’è' };
      return praticaChiusa(fb, opts) ? { ok: true, chiusa: true } : { ok: true };
    }
    if (isLocalOnly(fb)) return { ok: false, motivo: 'il segno «solo in locale» c’è già' };
    const mittente = localSenderCheck(fb);
    if (!mittente.ok) return mittente;
    if (statusUnreadable(fb)) return { ok: false, motivo: 'lo stato non si legge: non so se la pratica è aperta' };
    if (/^(attack|spam|suspicious_file)/.test(normalizeStatus(fb).status)) {
      return { ok: false, motivo: 'è segnalata come attacco o spam: prima si decide nei Ricevuti' };
    }
    // La regola del lettore: col segno una Ri-valutazione la manderebbe in coda senza giudici.
    const segnalato = segnalatoComeAttacco({ status: normalizeStatus(fb).status, pipeline: fb.pipeline });
    if (segnalato) return { ok: false, motivo: `${segnalato}: prima si decide nei Ricevuti` };
    // Chiusa: il segno dice che era un lavoro locale e la toglie dalla bacheca pubblica; L5 il server lo salta solo a pratica aperta.
    if (praticaChiusa(fb, opts)) return { ok: true, chiusa: true };
    // La presa di una routine si vede dal battito che il server specchia sul feedback (beatAt/workingSince):
    // i biglietti vivono in una collezione che da qui non si legge.
    const wp = workProgress(fb, opts);
    if (wp && wp.active) {
      return { ok: false, motivo: 'una routine la sta lavorando adesso: il segno si mette quando consegna o quando il suo biglietto è revocato' };
    }
    return { ok: true };
  }

  /**
   * Una sessione locale può lavorare questa pratica? PURA. Se è fidata (#1148), o approvata dall'owner come lavoro
   * locale (#913); il mittente dice solo perché no. Una non fidata salta L5 solo dopo «Segna fidato».
   */
  function localSenderCheck(fb) {
    if (!fb) return { ok: false, motivo: 'feedback non trovato' };
    if (isFidato(fb)) return { ok: true };
    if (isLocalApproved(fb)) return { ok: true, approvato: true };
    if (isProvenLocalSender(fb)) {
      // Campo assente = pratica nata prima della migrazione (§1.7), che lo scrive dopo il deploy del server: fino ad allora
      // vale la regola di prima, mittente provato. Un non_fidato scritto resta un no.
      if (fb.fiducia === undefined || fb.fiducia === null) return { ok: true, primaDellaMigrazione: true };
      return { ok: false, nonFidato: true, motivo: 'è tuo o di una tua sessione, ma non è fidato: segnalo fidato, o approvalo come lavoro server' };
    }
    if (isUnprovenSender(fb)) {
      return { ok: false, utente: true, senzaProva: true, motivo: 'il mittente non porta la prova (#595): vale come un feedback di un utente, e in locale si lavora solo se l’owner lo approva come lavoro server' };
    }
    if (MT().diProcesso(fb)) {
      return { ok: false, routine: true, motivo: 'l’ha aperto una routine: in locale si lavora solo se l’owner lo approva come lavoro server' };
    }
    return { ok: false, utente: true, motivo: 'è il feedback di un utente: in locale si lavora solo se l’owner lo approva come lavoro server' };
  }

  /**
   * L'owner può approvare ADESSO questo feedback come lavoro locale (#913)? PURA. Solo nei Ricevuti, solo su chi
   * non è già owner o sessione con la prova (a quelli basta il segno). `segnalato`: il motivo per guardarlo prima;
   * da Gestione l'owner approva lo stesso, lo script no (come «È mio»).
   */
  function localApprovalCheck(fb, opts) {
    if (!fb) return { ok: false, motivo: 'feedback non trovato' };
    if (statusUnreadable(fb)) return { ok: false, motivo: 'lo stato non si legge: non so dove sta la pratica' };
    if (isLocalApproved(fb)) return { ok: false, motivo: 'l’hai già approvato come lavoro server' };
    if (isFidato(fb)) return { ok: false, motivo: 'è fidato: basta il segno «solo in locale»' };
    if (manageTabFor(fb, opts) !== 'inbox') return { ok: false, motivo: 'si approva come lavoro server dai Ricevuti' };
    const status = normalizeStatus(fb).status;
    const segnalato = /^(attack|spam|suspicious_file)$/.test(status)
      ? `è segnalato come ${status === 'spam' ? 'spam' : status === 'attack' ? 'attacco' : 'file sospetto'}`
      : segnalatoComeAttacco({ status, pipeline: fb.pipeline });
    return segnalato ? { ok: true, segnalato } : { ok: true };
  }

  /**
   * L'owner può segnare fidato questo feedback ADESSO (#1148)? PURA. Non su uno già fidato né su una pratica chiusa
   * (vale per il lavoro che verrà). `segnalato`: il motivo per guardarlo prima; da Gestione l'owner lo segna lo stesso.
   */
  function fiduciaCheck(fb) {
    if (!fb) return { ok: false, motivo: 'feedback non trovato' };
    if (isFidato(fb)) return { ok: false, motivo: 'è già fidato' };
    if (String(fb.statusPublic || 'open') === 'closed') return { ok: false, motivo: 'la pratica è chiusa: la fiducia vale per il lavoro che verrà' };
    const status = normalizeStatus(fb).status;
    const segnalato = /^(attack|spam|suspicious_file|attack_confirmed|spam_confirmed)$/.test(status)
      ? `è segnalato come ${/^spam/.test(status) ? 'spam' : /^attack/.test(status) ? 'attacco' : 'file sospetto'}`
      : segnalatoComeAttacco({ status, pipeline: fb.pipeline });
    return segnalato ? { ok: true, segnalato } : { ok: true };
  }

  // Il contrario: su un fidato e aperto. Toglierla non ripulisce né sporca niente di già scritto.
  function fiduciaTogliCheck(fb) {
    if (!fb) return { ok: false, motivo: 'feedback non trovato' };
    if (!isFidato(fb)) return { ok: false, motivo: 'non è fidato' };
    if (String(fb.statusPublic || 'open') === 'closed') return { ok: false, motivo: 'la pratica è chiusa: la fiducia vale per il lavoro che verrà' };
    return { ok: true };
  }

  // Da dove viene la fiducia, in una riga per il dettaglio. '' per un non fidato: lì parla il tasto.
  const FIDUCIA_DA = Object.freeze({
    owner: 'Fidato: l’hai segnato tu',
    nascita: 'Fidato: scritto da te o da una sessione pulita',
    migrazione: 'Fidato: mittente provato o già approvato da te',
    server: 'Fidato: aperto dal server o da un lavoro fidato',
  });
  function fiduciaText(fb) {
    if (!isFidato(fb)) return '';
    const da = fb.fiduciaDa && typeof fb.fiduciaDa === 'object' ? fb.fiduciaDa : {};
    const base = FIDUCIA_DA[da.by] || 'Fidato';
    const at = Number(da.at);
    if (da.by !== 'owner' || !Number.isFinite(at) || at <= 0) return `${base}.`;
    const d = new Date(at);
    return `${base} il ${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}.`;
  }

  function richiestaInAttesa(fb, opts) {
    const f = opts && opts.fusioni;
    const pending = f && Array.isArray(f.pending) ? f.pending : [];
    return pending.some((r) => richiestaDiQuesto(r, fb));
  }

  // UNA tabella delle azioni dell'owner per tutte le superfici: sezione e status decidono
  // quali sono. «Archiviati» offre SOLO il ripristino: nessun `archived` su stato terminale.
  function ownerActions(fb, opts) {
    if (statusUnreadable(fb)) return [];
    const { status, statusReason } = normalizeStatus(fb);
    const tab = manageTabFor(fb, opts);
    if (tab === 'inbox') {
      // Aspetta una decisione: approvare È scrivere `todo`.
      const acts = [{ key: 'accept', kind: 'accept', to: 'todo', label: '→ In coda', primary: true }];
      // Il rombo azzurro nato prima di #1358 (`design`/`locale` senza domanda) esce solo come lavoro server: il segno
      // lo mette ormai il server, e altrove il tasto non c'è (#1575). `approva`: il sì dell'owner (#913) a chi non è
      // fidato né già approvato.
      if (status === 'design' && statusReason === 'locale' && !isLocalOnly(fb)) {
        acts[0].primary = false;
        acts.push({ key: 'accept_local', kind: 'accept', to: 'todo', label: '💻 Lavoro server', primary: true, locale: true, approva: localApprovalCheck(fb, opts).ok });
      }
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
    if (tab === 'queue' || tab === 'waiting') {
      // Chi aspetta una domanda non è risolto: si risponde alla domanda, o si archivia.
      if (aspettaDomanda(fb)) return [{ key: 'archive', kind: 'archive', to: 'archived', label: 'Archivia', primary: false }];
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

  // Guardiano SOTTO ai pulsanti, non accanto: un pannello rimasto aperto mentre lo stato
  // cambiava riscriverebbe di nuovo sopra una conferma.
  function ownerActionAllowsStatus(fb, to, opts) {
    const t = String(to == null ? '' : to);
    return ownerActions(fb, opts).some((a) => a.to === t);
  }

  // L'etichetta di stato in DATI: ogni pagina col suo markup, ma le STESSE parole.
  // → { label, color, hint, reason, reasonText, showReason, encrypted } o null.
  function stateBadge(fb) {
    const fs = FS();
    // Stato cifrato: vedi publicStateLabel.
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
    if (inAttesaOrigine(fb)) {
      return { label: 'In attesa', color: null, hint: `Stato: In attesa (${reasonText(statusReason)})`, reason: statusReason, reasonText: reasonText(statusReason), showReason: true, encrypted: false };
    }
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

  // L'iter ha tre passaggi in ordine: implementazione, controllo funzionalità, controllo
  // sicurezza. Lo status dice quale; claim*/workingSince dicono se qualcuno ci lavora ORA.
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
   * `active` = un'istanza ci sta lavorando in questo momento: battito (`beatAt`)
   * o presa in carico (`workingSince`) freschi, FS.isBeating.
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
  // `opts.releasedVersion` (DB3) è passato a manageTabFor per il gate "Risolti"; `opts.soloNonFidate` è il filtro
  // della fiducia, `opts.livelli` quello dei Ricevuti.
  function listForManageTab(feedbacks, tab, opts) {
    const items = filtraFiducia((feedbacks || []).filter((f) => manageTabFor(f, opts) === tab), opts && opts.soloNonFidate);
    if (tab === 'inbox') return sortReview(filtraLivelli(items, opts && opts.livelli, opts));
    // In coda: priorità DESC come criterio primario tra i non-in-lavorazione.
    // `sort` è stabile, quindi a parità di priorità si conserva l'ordine di
    // sortReview (severità poi recenza), e il pinning finale conserva a sua
    // volta l'ordine per priorità dentro ogni gruppo. Chi aspetta (#903) è la stessa coda, più tardi.
    if (tab === 'queue' || tab === 'waiting') {
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

  // `starred` è un parcheggio, si mette su un feedback qualsiasi a prescindere dallo status:
  // il filtro ⭐ degli Archiviati mostra TUTTI i preferiti, non solo gli `archived`.
  function isStarred(fb) {
    return !!(fb && fb.starred === true);
  }

  // Filtri della tab Archiviati (starredOnly, confirmedOnly). Vivono qui e non nella pagina:
  // il conteggio della scheda deve contare esattamente ciò che la lista mostra.
  function listArchiveTab(feedbacks, opts) {
    const starredOnly = !!(opts && opts.starredOnly);
    const confirmedOnly = !!(opts && opts.confirmedOnly);
    let items = filtraFiducia((feedbacks || []).filter((f) =>
      starredOnly ? isStarred(f) : manageTabFor(f) === 'archived'), opts && opts.soloNonFidate);
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
  // `opts`: { releasedVersion, starredOnly, confirmedOnly, livelli, soloNonFidate }. PURA.
  function manageTabCounts(feedbacks, opts) {
    const list = feedbacks || [];
    const counts = { inbox: 0, queue: 0, waiting: 0, resolved: 0, archived: 0 };
    const inbox = [];
    for (const f of filtraFiducia(list, opts && opts.soloNonFidate)) {
      const tab = manageTabFor(f, opts);
      if (tab === 'inbox') inbox.push(f);
      else if (tab === 'queue' || tab === 'waiting' || tab === 'resolved') counts[tab]++;
    }
    counts.inbox = filtraLivelli(inbox, opts && opts.livelli, opts).length;
    counts.archived = listArchiveTab(list, opts).length;
    return counts;
  }

  // Board utente: superficie a permessi ridotti — solo fix già in produzione e MAI niente del
  // red-team. Un fix con una riapertura in sospeso esce dalla board: è tornato nell'iter.
  function listBoardTab(feedbacks, opts) {
    const releasedVersion = opts && opts.releasedVersion;
    return listForManageTab(feedbacks, 'resolved', { releasedVersion })
      // Guard red-team: si guardano APPOSTA i verdetti grezzi e non lo status, così un feedback
      // segnalato dalla sicurezza non va in board nemmeno se è arrivato a `done`.
      .filter((fb) => !classifyLegacyBlock(fb))
      .filter((fb) => !isLocalOnly(fb))
      .filter((fb) => !hasReopenRequest(fb));
  }

  // Riapribile solo se OGGI è visibile in board e nessuno l'ha già riaperto: una volta
  // riaperto da chiunque il fix è nell'iter normale, e N feedback collegati non servono.
  function hasReopenRequest(fb) {
    const r = fb && fb.reopenRequests;
    return !!(r && typeof r === 'object' && Object.keys(r).length > 0);
  }

  function canReopen(fb, opts) {
    if (!fb) return false;
    if (hasReopenRequest(fb)) return false;
    return listBoardTab([fb], opts).length > 0;
  }

  // Ri-valutazione dei «non filtrati», un id per chiamata: `recovered` (un giudice mancante ha
  // votato), `wasted` (crediti spesi a vuoto), `budget` (riprovare), `noop`, `error`.
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
        return 'La chiave OpenRouter dei giudici è assente o non valida: reimpostala in Automazioni, fra i Modelli di supporto.';
      case 'rate_limit':
        return 'Il provider dei giudici è sovraccarico (limite di richieste): riprova tra poco.';
      case 'bad_request':
        return 'Un modello dei giudici non è valido o non esiste più: controlla i modelli in Automazioni, fra i Modelli di supporto.';
      case 'timeout':
        return 'I giudici non hanno risposto in tempo: alza il "Timeout dei giudici" in Automazioni se usi modelli lenti.';
      case 'non_decifrabile':
        return 'Il server non riesce ancora a decifrare il feedback: l’allarme dice cosa riparare.';
      default:
        return null;
    }
  }

  // Quanti 'wasted' di fila tollerare prima di fermare tutto: se i giudici falliscono a vuoto
  // è quasi certo un problema di configurazione o di credito, e bruciare crediti non serve.
  const REEVAL_WASTE_LIMIT = 3;

  // I cinque livelli come una fila di forme sempre uguale e sempre nello stesso posto: un
  // livello senza parere è GRIGIO ma resta, così un buco si vede. Qui dati, niente disegno.

  // I quattro colori sono quelli dei pallini dei giudici: stessa scala di severità in tutta
  // la pagina, così il rosso vuol dire la stessa cosa ovunque.
  const LIVELLO_COLORI = {
    attack:  REASONS.attack.color,   // rosso  — bloccato / bocciato
    spam:    REASONS.spam.color,     // giallo — in sospeso, o scavalcato dall'owner
    design:  REASONS.design.color,   // verde  — passato, o una domanda per l'owner
    aligned: ALIGNED.color,          // blu    — pulito
    locale:  LOCALE.color,           // azzurro — chiede lavoro locale
  };

  // I motivi delle pratiche fermate prima che il server componesse lui le righe del triangolo
  // (pipeline.ingresso): solo codici che manda davvero. Uno che la tabella non conosce si scrive
  // lo stesso, coi trattini bassi sciolti: un motivo grezzo dice più di uno nascosto.
  const L1_MOTIVI = {
    linked_prior_attack: 'collegato a un attacco precedente',
    origine_bloccata: 'il feedback da cui nasce è stato bloccato',
  };
  function l1MotivoText(code) {
    const k = String(code == null ? '' : code).trim();
    if (!k) return '';
    return L1_MOTIVI[k] || k.replace(/_/g, ' ');
  }

  // Segno di mittente pericoloso (#922): lo tiene il server (ownerSenderFlag) e lo toglie solo il gesto
  // esplicito dell'owner, mai un'approvazione — o un attaccante si ripulisce con un feedback innocuo.
  const FRASE_SEGNO_ERRATO = 'il segno era un errore';

  /** Il filtro d'ingresso l'ha fermato perché il mittente era segnato? PURA. */
  function fermatoDalSegno(fb) {
    const p = fb && fb.pipeline;
    if (!p || typeof p !== 'object' || !Array.isArray(p.l1Reasons)) return false;
    return p.l1Reasons.some((r) => String(r == null ? '' : r).trim() === 'linked_prior_attack');
  }

  const MOTIVI_SEGNO = {
    attack: 'un suo feedback è stato giudicato un attacco',
    attack_confirmed: 'un suo attacco è stato confermato',
  };
  /** Il motivo del segno in parole: un codice si traduce, un testo del server passa com'è. PURA. */
  function motivoSegnoText(reason) {
    const k = String(reason == null ? '' : reason).trim();
    if (!k) return '';
    if (MOTIVI_SEGNO[k]) return MOTIVI_SEGNO[k];
    return /^[a-z0-9_]+$/i.test(k) ? l1MotivoText(k) : k;
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

  // Dove è arrivata la pratica e perché: non viene da un controllo ma dall'owner o dalla
  // macchina a stati. Vive nel pannello del triangolo, l'unico della fila che c'è sempre.
  function righeStato(fb) {
    const righe = [];
    const b = stateBadge(fb);
    if (b) righe.push(riga('Stato', b.label + (b.showReason ? ` — ${b.reasonText}` : '')));
    const nota = judgesNote(fb);
    if (nota && nota.text) righe.push(riga('In breve', nota.text));
    return righe;
  }

  /**
   * La scheda del filtro d'ingresso che compone il server (`pipeline.ingresso`): righe, testo reso leggibile coi
   * punti segnati, colore, se si può ri-giudicare e una frase breve per la lista. Qui si ripulisce e basta: cosa
   * vuol dire lo sa solo il server. null se manca o è storta. PURA.
   */
  function schedaIngresso(fb) {
    const p = fb && fb.pipeline;
    const s = p && typeof p === 'object' ? p.ingresso : null;
    if (!s || typeof s !== 'object' || !Array.isArray(s.righe)) return null;
    const str = (v) => String(v == null ? '' : v);
    const parti = (Array.isArray(s.parti) ? s.parti : [])
      .filter((x) => x && typeof x === 'object' && Array.isArray(x.segmenti))
      .map((x) => ({
        titolo: str(x.titolo),
        segmenti: x.segmenti
          .filter((g) => g && typeof g === 'object' && str(g.t))
          .map((g) => (str(g.nota).trim() ? { t: str(g.t), nota: str(g.nota) } : { t: str(g.t) })),
      }))
      .filter((x) => x.segmenti.length);
    return {
      classe: Object.hasOwn(LIVELLO_COLORI, s.classe) ? s.classe : null,
      esito: str(s.esito).trim(),
      breve: str(s.breve).trim(),
      rigiudica: s.rigiudica === true,
      righe: s.righe.filter((r) => r && typeof r === 'object').map((r) => riga(r.etichetta, r.valore)),
      parti,
    };
  }

  /**
   * Ri-giudica si offre su una pratica fermata prima dei giudici, ancora nelle mani della pipeline: per quelle con
   * la scheda lo dice il server, per le vecchie basta lo stadio L1 senza il segno (che ha il suo gesto). PURA.
   */
  function rigiudicabile(fb) {
    if (!fb || statusUnreadable(fb)) return false;
    if (!['unlabeled', 'attack', 'spam'].includes(normalizeStatus(fb).status)) return false;
    const sch = schedaIngresso(fb);
    if (sch) return sch.rigiudica;
    const p = fb.pipeline;
    return !!(p && typeof p === 'object' && p.stage === 'L1' && !fermatoDalSegno(fb));
  }

  /** Livello 1: il filtro d'ingresso. Con la scheda del server si mostrano le sue righe e il suo testo. PURA. */
  function livelloL1(fb) {
    const titolo = 'Filtro d’ingresso';
    const p = (fb && fb.pipeline && typeof fb.pipeline === 'object') ? fb.pipeline : null;
    const azioni = rigiudicabile(fb) ? ['rigiudica'] : [];
    const sch = schedaIngresso(fb);
    if (sch) {
      return forma('l1', 'triangolo', titolo, sch.classe, sch.esito || (sch.classe ? 'fatto' : 'assente'), {
        titolo, righe: sch.righe.concat(righeStato(fb)), testo: '', azioni, parti: sch.parti,
      });
    }
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
      titolo, righe: righe.concat(righeStato(fb)), testo: '', azioni,
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

  const L3_ATTESA = 'Claude aspetta una tua risposta: le domande sono nella conversazione.';

  // Al posto di un testo che questo computer non sa decifrare: il blob non va mai a schermo.
  const TESTO_CIFRATO = 'Il testo è cifrato e questo computer non ha la chiave privata per leggerlo.';

  // I motivi di `design` che aspettano una RISPOSTA scritta dell'owner: le
  // domande di chi risolve, e una segnalazione o un rilievo che chiedono una
  // sua scelta. La risposta va nella conversazione ed è quello che chi riprende
  // il lavoro riceve. Un bilancio esaurito (`loop`) si rimette in coda e basta.
  const MOTIVI_RISPOSTA = ['clarify', 'decisione'];

  /**
   * Questa pratica aspetta una risposta dell'owner? PURA.
   *
   * Porta unica: la casella della risposta e il rombo verde devono comparire
   * insieme, e chiedendolo in due punti divergevano (la casella usciva anche
   * sulla forma legacy `clarify`, il rombo no).
   */
  function aspettaRisposta(fb) {
    if (!fb || statusUnreadable(fb)) return false;
    // Con la domanda si risponde lì, in un posto solo.
    if (aspettaDomanda(fb)) return false;
    const norm = normalizeStatus(fb);
    if (norm.status !== 'design') return false;
    return MOTIVI_RISPOSTA.includes(String(norm.statusReason || '')) || String(fb.status || '') === 'clarify';
  }

  function istanteDelTurno(ts) {
    const FT = global.SN_FEEDBACK_THREAD;
    return (FT && FT.istanteDelMarcatore && FT.istanteDelMarcatore(ts)) || String(ts);
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

  /** Chi ci lavora l'ha rimandata all'owner perché si finisce solo in locale? PURA. */
  function chiedeLavoroLocale(fb) {
    if (!fb || statusUnreadable(fb)) return false;
    const norm = normalizeStatus(fb);
    return norm.status === 'design' && String(norm.statusReason || '') === 'locale';
  }

  const L3_LOCALE = 'Richiede lavoro locale';
  const L3_FIDATO = 'Chiede di renderlo fidato: il lavoro tocca il server';

  /** Un worker chiede di renderlo fidato perché il lavoro tocca il server (#1358, SPEC-DOMANDE §2.2). PURA. */
  function chiedeFiducia(fb) {
    if (!fb || statusUnreadable(fb)) return false;
    const norm = normalizeStatus(fb);
    return norm.status === 'design' && String(norm.statusReason || '') === 'fidato';
  }

  // Il rombo azzurro (#1060): lo stato basta a dirlo, quindi si colora anche prima che arrivi il documento intero.
  function livelloL3Locale(fb, l, letto, titoloL3 = L3_LOCALE) {
    const L3_LOCALE = titoloL3;
    const nota = judgesNote(fb);
    const righe = (nota && nota.text) ? [riga('In breve', nota.text)] : [];
    if (!letto) {
      return forma('l3', 'rombo', L3_LOCALE, 'locale', 'nonletto', {
        titolo: L3_LOCALE, righe,
        testo: 'Il resto di questa segnalazione non è ancora arrivato: il perché lo scrive chi ci ha lavorato.',
        azioni: [],
      });
    }
    const domanda = ultimaDomanda(fb);
    if (domanda && domanda.ts) righe.push(riga('Quando', istanteDelTurno(domanda.ts)));
    const conversazioneCifrata = valueUnreadable(fb && fb.notes);
    const perche = conversazioneCifrata ? TESTO_CIFRATO : ((domanda && domanda.body) || '');
    const testoL = l ? String(l.testo || '').trim() : '';
    const segnalazione = !testoL || perche.includes(testoL) ? ''
      : (valueUnreadable(l.testo) ? TESTO_CIFRATO : testoL);
    return forma('l3', 'rombo', L3_LOCALE, 'locale', 'locale', {
      titolo: L3_LOCALE,
      righe,
      testo: perche && segnalazione ? `## ${L3_LOCALE}\n${perche}\n\n## Segnalazione\n${segnalazione}`
        : (perche || segnalazione),
      illeggibile: conversazioneCifrata && !segnalazione,
      azioni: [],
    });
  }

  function livelloL3(fb, opts) {
    const attesa = aspettaRisposta(fb);
    const letto = !(opts && opts.dettaglioLetto === false);
    const l = livelliOf(fb).l3;
    const segnalato = !!(l && String(l.esito || '').trim());
    // Con la domanda (SPEC-DOMANDE §3.8) il rombo rimanda lì: è il posto dove si risponde.
    const dom = aspettaDomanda(fb);
    if (dom) {
      const t = `Aspetta la tua risposta alla domanda ${dom}`;
      if (!letto) return nonLetto('l3', 'rombo', t);
      const testoL = segnalato ? String(l.testo || '').trim() : '';
      return forma('l3', 'rombo', t, 'design', segnalato ? 'segnalato' : 'domande', {
        titolo: t,
        righe: [],
        testo: testoL || `Si risponde nella sezione Domande: la domanda ${dom} ha le opzioni, il consiglio e lo spazio per scrivere.`,
        illeggibile: !!testoL && valueUnreadable(l.testo),
        azioni: [],
      });
    }
    if (chiedeLavoroLocale(fb)) return livelloL3Locale(fb, segnalato ? l : null, letto);
    if (chiedeFiducia(fb)) return livelloL3Locale(fb, segnalato ? l : null, letto, L3_FIDATO);
    // Fermo al livello 3 senza una scelta da fare qui (guasto, arenato, loop): il rombo dice quello che dice il segno in
    // lista, con l'ultima nota; verde solo se una domanda aperta aspetta l'owner (il guasto), grigio per gli altri.
    const fermo = !attesa && !segnalato ? fermoAlLivello3(fb) : null;
    // Il verde vuol dire anche «Claude aspetta una tua risposta»: il nome lo dice, e copre tutte le parti del pannello.
    if (!letto) {
      return nonLetto('l3', 'rombo', fermo ? fermo.testo : attesa ? 'Domande di Claude' : 'Segnalazione di Claude');
    }
    if (fermo) {
      const nota = ultimaDomanda(fb);
      const cifrata = valueUnreadable(fb && fb.notes);
      return forma('l3', 'rombo', fermo.testo, fermo.domanda ? fermo.classe : null, 'fermo', {
        titolo: fermo.testo,
        righe: (nota && nota.ts) ? [riga('Quando', istanteDelTurno(nota.ts))] : [],
        testo: cifrata ? TESTO_CIFRATO : ((nota && nota.body) || fermo.testo),
        illeggibile: cifrata,
        azioni: [],
      });
    }
    const titolo = !attesa ? 'Segnalazione di Claude'
      : segnalato ? 'Domande e segnalazione di Claude' : 'Domande di Claude';
    const domanda = attesa ? ultimaDomanda(fb) : null;
    if (!segnalato) {
      // Le domande possono arrivare nelle sole note: chi aspetta una risposta ha comunque una segnalazione.
      if (attesa) {
        return forma('l3', 'rombo', titolo, 'design', 'domande', {
          titolo,
          // Il pannello vuole l'ISO; un marcatore che non si legge passa com'è scritto, piuttosto che sparire.
          righe: (domanda && domanda.ts) ? [riga('Quando', istanteDelTurno(domanda.ts))] : [],
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
      // Una parte che qui non si decifra si dice con la frase, come quando è sola: mai il blob, mai sparita.
      const cifrata = valueUnreadable(l.testo);
      const conversazioneCifrata = valueUnreadable(fb && fb.notes);
      const soloSegnalazione = !cifrata
        && (motivo === 'decisione' || (!corpo && !conversazioneCifrata) || corpo.includes(testo));
      const domande = conversazioneCifrata ? TESTO_CIFRATO : (corpo || L3_ATTESA);
      return forma('l3', 'rombo', titolo, 'design', 'domande', {
        titolo,
        righe,
        testo: soloSegnalazione ? testo
          : `## Domande in attesa di risposta\n${domande}\n\n## Segnalazione\n${cifrata ? TESTO_CIFRATO : testo}`,
        illeggibile: cifrata && conversazioneCifrata,
        azioni: [],
      });
    }
    // Il worker che l'ha giudicata attacco o spam: il rombo prende la tinta del blocco, il titolo dice il giudizio.
    const norm = normalizeStatus(fb);
    if ((norm.status === 'attack' || norm.status === 'spam') && String(norm.statusReason || '') === 'worker') {
      const t = `Segnalata come ${norm.status === 'attack' ? 'attacco' : 'spam'} da chi ci lavorava`;
      return forma('l3', 'rombo', t, norm.status, 'segnalato', { titolo: t, righe, testo, illeggibile: valueUnreadable(l.testo), azioni: [] });
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

  function richiestaDiQuesto(req, fb) {
    if (!req || !fb) return false;
    const id = String(req.feedbackId || '').trim();
    if (id && id === String(fb._id || '')) return true;
    const num = String(req.num || '').trim().replace(/^#+/, '');
    return !!num && num === numeroOf(fb);
  }

  // Fermata al cancello senza una richiesta da approvare (#1556): il motivo è la nota con cui il server l'ha fermata,
  // e le strade sono le due azioni di stato che la pratica offre. Mai «aspetta»: lì non arriva nessun via libera.
  const L5_SENZA_RICHIESTA = 'Nessuna richiesta di fusione è aperta, quindi non c’è un via libera da dare.';
  const L5_ELENCHI_ASSENTI = 'I controlli del server l’hanno fermata. Le richieste di fusione non sono ancora arrivate a questa pagina.';
  const L5_NOTA_CIFRATA = 'Il perché sta nella conversazione, che è cifrata e su questo computer non si legge.';
  // La nota è del cancello solo se è nata dopo l'audit, che viene subito prima: un report o una domanda di un giro
  // passato non passa per il motivo della fermata. Al minuto, perché i marcatori portano solo i minuti. Il marcatore
  // è nell'ora di chi scrive, senza fuso: il server scrive in UTC, gli strumenti dell'owner nella sua ora, e l'audit
  // ha il fuso. Vale quindi la lettura più tarda delle due, o in Italia la nota del server sembra nata prima.
  function notaDelCancello(fb) {
    const nota = ultimaDomanda(fb);
    const l4 = livelliOf(fb).l4;
    const audit = Date.parse(String((l4 && l4.at) || ''));
    const locale = nota && Date.parse(istanteDelTurno(nota.ts) || '');
    if (!nota || !Number.isFinite(audit) || !Number.isFinite(locale)) return null;
    const scritta = Math.max(locale, locale - new Date(locale).getTimezoneOffset() * 60000);
    const minuto = (t) => Math.floor(t / 60000);
    return minuto(scritta) >= minuto(audit) ? nota : null;
  }
  function l5SenzaRichiesta(fb, opts) {
    const letto = !(opts && opts.dettaglioLetto === false);
    const cifrata = letto && valueUnreadable(fb && fb.notes);
    const nota = letto && !cifrata ? notaDelCancello(fb) : null;
    // Senza gli elenchi letti «nessuna richiesta» sarebbe un'ipotesi: la frase lo dice, e la lista resta generica.
    const lette = !!(opts && opts.fusioniLette);
    const righe = nota && nota.ts ? [riga('Quando', istanteDelTurno(nota.ts))] : [];
    const generica = lette ? L5_SENZA_RICHIESTA : L5_ELENCHI_ASSENTI;
    return forma('l5', 'quadrato', 'Fusione', 'attack', 'bloccato', {
      titolo: 'Fusione',
      righe,
      testo: (nota && nota.body) || (cifrata ? `${generica} ${L5_NOTA_CIFRATA}` : generica),
      azioni: ['rimanda', 'archivia'],
    }, { richiesta: null, richieste: [], conflitto: false, fusione: lette ? 'senza' : null });
  }

  /**
   * Livello 5: il cancello di fusione. Le richieste arrivano dal server
   * (`MERGE_APPROVALS_GET`) e si legano alla segnalazione per id o per numero.
   * `opts.fusioni` = { pending, failed, preapproved, recent }; `opts.fusioniLette` = l'ultima lettura è riuscita. PURA.
   */
  function livelloL5(fb, opts) {
    const titolo = 'Fusione';
    const f = (opts && opts.fusioni && typeof opts.fusioni === 'object') ? opts.fusioni : {};
    const lista = (k) => (Array.isArray(f[k]) ? f[k] : []).filter((r) => richiestaDiQuesto(r, fb));
    const pending = lista('pending');
    const failed = lista('failed');
    const preapproved = lista('preapproved');
    const { status, statusReason } = normalizeStatus(fb);

    // Il documento dice da solo che la pratica è ferma al cancello: gli elenchi delle richieste
    // possono non essere arrivati, o essere vuoti su un altro computer, e il grigio mentirebbe.
    const fermaDaStato = status === 'design' && statusReason === 'l5';

    // Una fusione approvata e mai avvenuta pesa quanto una richiesta ferma (vedi mergeApprovals).
    const ferme = failed.concat(pending);
    if (!ferme.length && fermaDaStato) return l5SenzaRichiesta(fb, opts);
    if (ferme.length) {
      const req = ferme[0];
      const inConflitto = failed.length > 0;
      // Una richiesta già mandata a fondere (tasto o segno), o già decisa, non aspetta più il via libera (#702).
      const statoDi = (opts && typeof opts.statoRichiesta === 'function') ? opts.statoRichiesta : () => null;
      const stati = pending.map((r) => statoDi(r));
      const fusione = inConflitto || stati.some((s) => s !== 'volo' && s !== 'decisa') ? null
        : (stati.includes('volo') ? 'volo' : 'decisa');
      return forma('l5', 'quadrato', titolo, 'attack', inConflitto ? 'conflitto' : 'bloccato', {
        titolo,
        righe: [],
        testo: inConflitto
          ? 'Avevi detto sì, ma la fusione non è avvenuta: il ramo non entra in main finché non si sistema.'
          : fusione === 'volo' ? 'Approvata: il server sta fondendo il ramo.'
            : fusione === 'decisa' ? 'Hai già deciso: la richiesta esce da qui appena la pagina rilegge le fusioni.'
              : 'I controlli del server l’hanno fermata: entra in main solo col tuo via libera.',
        azioni: [],
      }, { richiesta: req, richieste: ferme, conflitto: inConflitto, fusione });
    }

    const versione = String((fb && fb.resolvedInVersion) || '').trim();
    if (status === 'done' || preapproved.length) {
      return forma('l5', 'quadrato', titolo, 'design', 'fuso', {
        titolo,
        righe: versione ? [riga('Uscito nella versione', versione)] : [],
        testo: !preapproved.length ? 'Il lavoro è entrato in main.'
          : preapproved[0].motivo === 'fiducia' ? 'Lavoro fidato: controllo registrato nel Log.'
            : preapproved[0].skippedL5 === true ? 'Fusa senza chiedere: lavoro locale, i blocchi sono registrati nel Log.'
              : 'Fusa senza chiedere: avevi messo il segno su questa pratica.',
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
    return [livelloL1(fb), livelloL2(fb), livelloL3(fb, opts), livelloL4(fb, opts), livelloL5(fb, opts)];
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

  /** Le pratiche con una fusione ferma davanti, le altre nell'ordine che avevano (`sort` è stabile). PURA. */
  function fusioniFermeInCima(lista, opts) {
    const ferma = (fb) => (fusioneInAttesa(fb, opts) ? 1 : 0);
    return (Array.isArray(lista) ? lista : []).slice().sort((a, b) => ferma(b) - ferma(a));
  }

  // Le forme dei livelli in una griglia di 16. Nel dettaglio i giudici restano `.mg-dot`: il cerchio serve al segno in lista.
  const FORME_SVG = {
    triangolo: 'M8 2 L14.5 13.6 L1.5 13.6 Z',
    rombo:     'M8 1.4 L14.6 8 L8 14.6 L1.4 8 Z',
    pentagono: 'M8 1.4 L14.6 6.3 L12.1 14.2 L3.9 14.2 L1.4 6.3 Z',
    quadrato:  'M2.6 2.6 H13.4 V13.4 H2.6 Z',
    cerchio:   'M8 2.2 A5.8 5.8 0 1 1 7.99 2.2 Z',
    // Non è un livello: è il segno della fiducia in lista (#1575), una forma che nessun livello usa.
    scudo:     'M8 1.6 L13.4 3.6 V7.6 C13.4 10.8 11.2 13.3 8 14.5 C4.8 13.3 2.6 10.8 2.6 7.6 V3.6 Z',
  };

  // Il motivo di design → il livello che ha fermato la pratica (D93). Il rombo è Claude che chiede.
  const SEGNO_DESIGN = {
    secaudit: { forma: 'pentagono', livello: 'l4', classe: 'attack', testo: 'Bloccato dalla sicurezza: l’audit ha bocciato il fix' },
    l5:       { forma: 'quadrato',  livello: 'l5', classe: 'attack', testo: 'Fermo al cancello di fusione: aspetta il tuo via libera' },
    clarify:  { forma: 'rombo', livello: 'l3', classe: 'design', testo: 'Claude ha domande: aspetta una tua risposta' },
    decisione:{ forma: 'rombo', livello: 'l3', classe: 'design', testo: 'Fermo su una scelta che spetta a te: aspetta una tua risposta' },
    loop:     { forma: 'rombo', livello: 'l3', classe: 'design', testo: 'La verifica ha trovato un difetto che non si corregge più da soli' },
    arenato:  { forma: 'rombo', livello: 'l3', classe: 'design', testo: 'La lavorazione si è arenata troppe volte' },
    guasto:   { forma: 'rombo', livello: 'l3', classe: 'design', testo: 'Fermo per un guasto: la domanda dice cosa fare', domanda: true },
    locale:   { forma: 'rombo', livello: 'l3', classe: 'locale', testo: L3_LOCALE },
    fidato:   { forma: 'rombo', livello: 'l3', classe: 'locale', testo: L3_FIDATO },
  };

  /** Il segno di un design fermo al livello 3 che non aspetta né una risposta né il lavoro locale, o null. PURA. */
  function fermoAlLivello3(fb) {
    if (!fb || statusUnreadable(fb)) return null;
    const { status, statusReason } = normalizeStatus(fb);
    const motivo = String(statusReason || '');
    const s = status === 'design' && Object.hasOwn(SEGNO_DESIGN, motivo) ? SEGNO_DESIGN[motivo] : null;
    return s && s.livello === 'l3' && s.classe === 'design' && !MOTIVI_RISPOSTA.includes(motivo) ? s : null;
  }

  /**
   * Il simbolo in lista che dice cosa ha fermato una pratica dei Ricevuti: la stessa forma del dettaglio
   * (triangolo L1, cerchio giudici, rombo L3, pentagono L4, quadrato L5), il motivo in parole. null fuori
   * dai Ricevuti o a stato illeggibile. PURA. Regola: patterns/il-colore-di-una-card-dice-che-decisione-serve-non-lo-stato.md
   */
  function segnoFermata(fb, opts) {
    if (!fb || statusUnreadable(fb)) return null;
    const out = (forma, livello, classe, testo) => ({ forma, livello, classe: classe || null, testo });
    if (fusioneInAttesa(fb, opts)) {
      const l5 = livelloL5(fb, opts);
      return out('quadrato', 'l5', 'attack', l5.esito === 'conflitto'
        ? 'Fusione non avvenuta: avevi detto sì, ma il ramo non è entrato in main'
        : l5.fusione === 'senza' ? 'Fermo al cancello senza una richiesta aperta. Decidi tu se rifarlo o archiviarlo'
          : 'Fermo al cancello di fusione: aspetta il tuo via libera');
    }
    // Chi aspetta una domanda sta In coda col suo segno: non è un fermo dei Ricevuti.
    if (aspettaDomanda(fb)) return null;
    const { status, statusReason } = normalizeStatus(fb);
    if (!isRicevutiStatus(status)) return null;
    if (status === 'design') {
      const s = SEGNO_DESIGN[String(statusReason || '')];
      if (s) return out(s.forma, s.livello, s.classe, s.testo);
      if (aspettaRisposta(fb)) return out('rombo', 'l3', 'design', SEGNO_DESIGN.clarify.testo);
      return out('cerchio', 'l2', 'design', 'Per i giudici è una questione di design');
    }
    const p = (fb.pipeline && typeof fb.pipeline === 'object') ? fb.pipeline : {};
    if (status === 'suspicious_file') return out('triangolo', 'l1', 'attack', 'Il filtro d’ingresso ha trovato un file sospetto');
    if (status === 'attack' || status === 'spam') {
      const parola = status === 'attack' ? 'attacco' : 'spam';
      // Il giudizio di chi ci lavorava (SPEC-DOMANDE §2.2): L3, accanto alle sue altre segnalazioni.
      if (String(statusReason || '') === 'worker') return out('rombo', 'l3', status, `Chi ci lavorava l’ha segnalata come ${parola}`);
      const dalFiltro = status === 'attack'
        ? (p.action === 'block_attack' || p.l1Category === 'dangerous')
        : (p.action === 'block_spam' || p.l1Category === 'spam');
      return dalFiltro
        ? out('triangolo', 'l1', status, `Il filtro d’ingresso l’ha fermata come ${parola}`)
        : out('cerchio', 'l2', status, `I giudici l’hanno segnalata come ${parola}`);
    }
    const worst = worstVerdictBlock(fb);
    if (status === 'unlabeled') {
      const sch = schedaIngresso(fb);
      if (sch && sch.breve && !(Array.isArray(p.verdicts) && p.verdicts.some((v) => v && v.class))) {
        return out('triangolo', 'l1', sch.classe, sch.breve);
      }
      if (panelComplete(fb) && worst) return out('cerchio', 'l2', worst.reason, `Un giudice l’ha segnalata come ${worst.label.toLowerCase()}`);
      const nota = judgesNote(fb);
      return out('cerchio', 'l2', null, (nota && nota.text) ? nota.text.replace(/\.$/, '') : 'Non filtrato: manca il verdetto di un giudice');
    }
    if (status === 'aligned') {
      return worst
        ? out('cerchio', 'l2', worst.reason, `Un giudice l’ha segnalata come ${worst.label.toLowerCase()}: da esaminare`)
        : out('cerchio', 'l2', 'aligned', 'Giudici d’accordo: aspetta la tua approvazione');
    }
    return null;
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

  // ── Sezioni di Gestione (SPEC-DOMANDE §2.1) ───────────────────────────────
  // Le sezioni raggruppano SCHEDE, non stati: lo stato → scheda resta in feedbackStatus.js.
  // Una scheda o sezione nuova (Risposte automatiche…) entra qui quando esiste la cosa che mostra: un pulsante che non
  // apre niente sembra rotto. I Modelli di supporto stanno in Automazioni (#1110). Utenti e Impostazioni predefinite sono
  // le pagine dell'owner che avevano un ingresso loro (#1414): i loro vecchi indirizzi li rigira il protocollo.
  const SEZIONI = Object.freeze([
    { id: 'domande', nome: 'Domande', schede: ['domande', 'domande-lavoro', 'domande-archivio'] },
    { id: 'feedback', nome: 'Feedback', schede: ['inbox', 'queue', 'waiting', 'resolved', 'archived', 'fbstats', 'stats'] },
    { id: 'routine', nome: 'Routine', schede: ['automation', 'crediti', 'log'] },
    { id: 'utenti', nome: 'Utenti', schede: ['utenti', 'contatori'] },
    { id: 'predefinite', nome: 'Impostazioni predefinite', schede: ['predefiniti'] },
  ]);

  function sezioneDiScheda(tab) {
    const s = SEZIONI.find((x) => x.schede.includes(String(tab || '')));
    return s ? s.id : null;
  }

  function schedaPredefinita(sezione) {
    const s = SEZIONI.find((x) => x.id === sezione);
    return s ? s.schede[0] : null;
  }

  /** La scheda che chiede un indirizzo di Gestione (`#utenti`, `#routine`…): una scheda, o la prima di una sezione. PURA. */
  function schedaDaIndirizzo(hash) {
    const chiave = String(hash || '').replace(/^#/, '').trim().toLowerCase();
    if (!chiave) return null;
    return sezioneDiScheda(chiave) ? chiave : schedaPredefinita(chiave);
  }

  /**
   * L'ultima sezione ricordata, con la scheda di ogni sezione, validata: una parte storta butta tutto,
   * perché una scelta ricordata a metà torna come un'altra (patterns/una-scelta-ricordata-si-ricorda-intera.md). PURA.
   */
  function leggiSceltaSezione(raw) {
    let v = raw;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { return null; } }
    if (!v || typeof v !== 'object' || !v.schede || typeof v.schede !== 'object') return null;
    const schede = {};
    for (const [sez, tab] of Object.entries(v.schede)) {
      if (sezioneDiScheda(tab) !== sez) return null;
      schede[sez] = tab;
    }
    if (!schede[v.sezione]) return null;
    return { sezione: v.sezione, schede };
  }

  // La regola stato → scheda è SN_DOMANDE.schedaDi (src/shared/domande.js); qui solo il nome della scheda di Gestione.
  // Le risposte automatiche stanno in Archivio finché la loro scheda non ha una fonte (#1154): mai fuori da ogni scheda.
  const SCHEDA_DOMANDA = Object.freeze({
    da_rispondere: 'domande', in_lavorazione: 'domande-lavoro', risposte_automatiche: 'domande-archivio', archivio: 'domande-archivio',
  });
  function schedaDomanda(d) {
    const D = global.SN_DOMANDE;
    if (!d || typeof d !== 'object' || !D || typeof D.schedaDi !== 'function') return null;
    return SCHEDA_DOMANDA[D.schedaDi(d)] || null;
  }
  function contaDomande(domande) {
    const n = { domande: 0, 'domande-lavoro': 0, 'domande-archivio': 0 };
    for (const d of (Array.isArray(domande) ? domande : [])) {
      const t = schedaDomanda(d);
      if (t) n[t]++;
    }
    return n;
  }
  function bloccanteAperta(domande) {
    return (Array.isArray(domande) ? domande : []).some((d) => d && d.stato === 'aperta' && d.priorita === 'bloccante');
  }

  /**
   * Dove si apre Gestione: Domande con una bloccante aperta, Ricevuti se non è vuoto, poi l'ultima sezione,
   * poi Feedback → Ricevuti. `domande` null = non lette; `ricevuti` null = non si sa. PURA.
   */
  function sezioneDiApertura(o) {
    const opts = o || {};
    if (bloccanteAperta(opts.domande)) return { sezione: 'domande', scheda: 'domande', motivo: 'bloccante' };
    if (typeof opts.ricevuti === 'number' && opts.ricevuti > 0) return { sezione: 'feedback', scheda: 'inbox', motivo: 'ricevuti' };
    const u = leggiSceltaSezione(opts.ultima);
    if (u) return { sezione: u.sezione, scheda: u.schede[u.sezione], motivo: 'ultima' };
    return { sezione: 'feedback', scheda: 'inbox', motivo: 'predefinita' };
  }

  // ── Filtro dei Ricevuti per livello (SPEC-DOMANDE §2.2) ───────────────────
  const LIVELLI_RICEVUTI = Object.freeze(['l1', 'l2', 'l3', 'l4', 'l5']);
  const FORMA_DI_LIVELLO = Object.freeze({ l1: 'triangolo', l2: 'cerchio', l3: 'rombo', l4: 'pentagono', l5: 'quadrato' });

  /** Il livello a cui è ferma una pratica dei Ricevuti ('l1'…'l5'), o null: lo stesso del segno in lista. PURA. */
  function livelloRicevuti(fb, opts) {
    const s = segnoFermata(fb, opts);
    return s && LIVELLI_RICEVUTI.includes(s.livello) ? s.livello : null;
  }

  /** Nessun livello scelto = tutto (anche le pratiche senza livello); più livelli = l'unione. PURA. */
  function filtraLivelli(lista, livelli, opts) {
    const items = Array.isArray(lista) ? lista : [];
    const scelti = (Array.isArray(livelli) ? livelli : []).filter((l) => LIVELLI_RICEVUTI.includes(l));
    if (!scelti.length) return items.slice();
    return items.filter((fb) => scelti.includes(livelloRicevuti(fb, opts)));
  }

  /** Quante pratiche dei Ricevuti sono ferme a ogni livello, coi livelli spenti e la fiducia di `opts`; `senza` = nessun livello. PURA. */
  function contaLivelliRicevuti(feedbacks, opts) {
    const n = { l1: 0, l2: 0, l3: 0, l4: 0, l5: 0, senza: 0 };
    for (const fb of filtraFiducia(feedbacks, opts && opts.soloNonFidate)) {
      if (manageTabFor(fb, opts) !== 'inbox') continue;
      const l = livelloRicevuti(fb, opts);
      n[l || 'senza']++;
    }
    return n;
  }

  // ── La fiducia in lista (#1575) ───────────────────────────────────────────
  // Un filtro solo per pratiche e domande (le due portano `fiducia`), così lista e numeri non divergono: quello che
  // nasconde non si conta (patterns/contenuto-nascosto-sezioni-chiuse-filtri-collassi-rivelalo.md).
  /** Con `soloNonFidate` le sole non fidate, altrimenti tutte. PURA. */
  function filtraFiducia(lista, soloNonFidate) {
    const items = Array.isArray(lista) ? lista : [];
    return soloNonFidate ? items.filter((x) => !isFidato(x)) : items.slice();
  }
  function contaNonFidate(lista) {
    return filtraFiducia(lista, true).length;
  }
  // Il cancello guarda anche il registro del ramo, che la pagina non legge (#1554, #1555): l'hover non promette di più.
  const SEGNI_FIDUCIA = Object.freeze({
    fidata: Object.freeze({ classe: 'fidata', parola: 'Fidata',
      testo: 'Fidata. È la fiducia del feedback. Il cancello guarda anche il registro del ramo, che questa pagina non legge, e se il registro è rotto ferma la fusione lo stesso.' }),
    nonfidata: Object.freeze({ classe: 'nonfidata', parola: 'Non fidata',
      testo: 'Non fidata. È la fiducia del feedback. Se il cancello ferma il lavoro, la fusione aspetta il tuo sì.' }),
  });
  /** Il segno della fiducia su una riga: la classe del colore, la parola e l'hover. Senza campo vale non fidata. PURA. */
  function segnoFiducia(x) {
    return isFidato(x) ? SEGNI_FIDUCIA.fidata : SEGNI_FIDUCIA.nonfidata;
  }

  /** Il tasto «Frase» da chiuso, uguale in Gestione e nella pagina Feedback (#857): acceso se una
   *  frase c'è già, che si legge intera nell'hover. Soli spazi = nessuna frase. PURA. */
  function tastoFrase(frase) {
    const testo = String(frase == null ? '' : frase).trim();
    return {
      piena: !!testo,
      titolo: testo ? `Frase già scritta: “${testo}”` : 'Scrivi la riga che leggerà chi ha segnalato',
    };
  }

  global.SN_MANAGE_REVIEW = {
    normalizeStatus,
    tastoFrase,
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
    panelSize, EXPECTED_PANEL_SIZE: DEFAULT_PANEL_SIZE, isFidato, fiduciaCheck, fiduciaTogliCheck, fiduciaText, isUnprovenSender, effectiveClientId,
    isLocalOnly, inAttesaFusioneServer, attesaServer, isLocalApproved, isPrivateLocalWork, fraseAttesa, isProvenLocalSender, judgesSkippedText, immaginiNonViste,
    isRicevutiStatus, localApprovalCheck, localSignCheck, localSenderCheck, praticaChiusa,
    segnaliDeiGiudici, segnalatoComeAttacco,
    panelComplete, judgesNote, reasonText,
    statusUnreadable, valueUnreadable, sectionsReliable, publicStateLabel, PUBLIC_STATE_HINT,
    ownerActions, ownerActionFor, ownerActionAllowsStatus, stateBadge,
    classifyReevalResult, reevalErrorHint, REEVAL_WASTE_LIMIT,
    livelli, livelloPer, livelloL1, livelloL2, livelloL3, livelloL4, livelloL5, righeStato,
    fusioneInAttesa, fusioniFermeInCima, segnoFermata, FORME_SVG, fusioniSenzaFeedback, richiestaDiQuesto, numeroOf,
    l1MotivoText, LIVELLO_COLORI, L1_MOTIVI, schedaIngresso, rigiudicabile,
    aspettaRisposta, aspettaDomanda, domandeBloccantiDi, chiedeFiducia, ultimaDomanda, TESTO_CIFRATO, chiedeLavoroLocale, LOCALE,
    FRASE_SEGNO_ERRATO, fermatoDalSegno, motivoSegnoText,
    SEZIONI, sezioneDiScheda, schedaPredefinita, schedaDaIndirizzo, leggiSceltaSezione, sezioneDiApertura,
    schedaDomanda, contaDomande, bloccanteAperta,
    LIVELLI_RICEVUTI, FORMA_DI_LIVELLO, livelloRicevuti, filtraLivelli, contaLivelliRicevuti,
    filtraFiducia, contaNonFidate, segnoFiducia,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
