// Dashboard di gestione unificata di Filo (filo://manage/, owner-only).
// Tab-lista (Ricevuti / In coda / Risolti / Archiviati) che condividono un
// layout a 3 colonne (lista filtrata per tab / dettaglio / pannello laterale):
// la lista a sinistra mostra il sottoinsieme di feedback della tab corrente,
// il dettaglio al centro ne mostra la conversazione + azioni contestuali
// (sblocco per i bloccati, risposta per i chiarimenti). "Automazioni" tiene
// anche i Modelli di supporto (#1110); la traccia delle fusioni sta nel Log.

(function () {
  'use strict';

  // Elementi DOM
  const mgTabs       = document.getElementById('mgTabs');
  const mgBanner     = document.getElementById('mgBanner');
  const mgSignInBtn  = document.getElementById('mgSignIn');

  const mgAutoSwitch = document.getElementById('mgAutoSwitch');
  const mgAutoToggle = document.getElementById('mgAutoToggle');
  const mgAutoState  = document.getElementById('mgAutoState');
  const mgAutoMsg    = document.getElementById('mgAutoMsg');
  // Un interruttore per livello di fiducia (SPEC-DOMANDE.md §10: il mittente non dà permessi): la chiave è il gruppo
  // di SN_FEEDBACK_THREAD.AUTO_APPROVE_GROUPS.
  const mgAutoApprove = {
    fidato:     document.getElementById('mgAutoApproveFidato'),
    non_fidato: document.getElementById('mgAutoApproveNonFidato'),
  };
  const mgRoutinesSwitch = document.getElementById('mgRoutinesSwitch');
  const mgRoutinesToggle = document.getElementById('mgRoutinesToggle');
  const mgRoutinesState  = document.getElementById('mgRoutinesState');
  const mgRoutinesMsg    = document.getElementById('mgRoutinesMsg');
  const mgLavoriServer       = document.getElementById('mgLavoriServer');
  const mgLavoriServerSwitch = document.getElementById('mgLavoriServerSwitch');
  const mgLavoriServerMsg    = document.getElementById('mgLavoriServerMsg');
  // I bilanci dei giri di correzione, uno per livello (feedback #561): cap3 =
  // giri per i rilievi di livello 3, cap2 = per i 2, cap1 = per gli 1, cap0 =
  // per i soli 0; più il testo in coda alla risposta (fixInstructions).
  const mgCap3     = document.getElementById('mgCap3');
  const mgCap3Save = document.getElementById('mgCap3Save');
  const mgCap3Msg  = document.getElementById('mgCap3Msg');
  const mgCap2     = document.getElementById('mgCap2');
  const mgCap2Save = document.getElementById('mgCap2Save');
  const mgCap2Msg  = document.getElementById('mgCap2Msg');
  const mgCap1     = document.getElementById('mgCap1');
  const mgCap1Save = document.getElementById('mgCap1Save');
  const mgCap1Msg  = document.getElementById('mgCap1Msg');
  const mgCap0     = document.getElementById('mgCap0');
  const mgCap0Save = document.getElementById('mgCap0Save');
  const mgCap0Msg  = document.getElementById('mgCap0Msg');
  const mgFixInstructions     = document.getElementById('mgFixInstructions');
  const mgFixInstructionsSave = document.getElementById('mgFixInstructionsSave');
  const mgFixInstructionsMsg  = document.getElementById('mgFixInstructionsMsg');
  const mgGiroStretto       = document.getElementById('mgGiroStretto');
  const mgGiroStrettoSwitch = document.getElementById('mgGiroStrettoSwitch');
  const mgGiroStrettoMsg    = document.getElementById('mgGiroStrettoMsg');
  // Come partono le sessioni delle routine: quante insieme, da quale account
  // per prima, quali account sono esclusi.
  const mgMaxSessions     = document.getElementById('mgMaxSessions');
  const mgMaxSessionsSave = document.getElementById('mgMaxSessionsSave');
  const mgMaxSessionsMsg  = document.getElementById('mgMaxSessionsMsg');
  const mgPriorityAccountMsg = document.getElementById('mgPriorityAccountMsg');
  const mgPriorityRadios  = Array.from(document.querySelectorAll('input[name="mgPriorityAccount"]'));
  const mgAccountA        = document.getElementById('mgAccountA');
  const mgAccountB        = document.getElementById('mgAccountB');
  const mgAccountsMsg     = document.getElementById('mgAccountsMsg');
  const mgAccountsWarn    = document.getElementById('mgAccountsWarn');
  const mgPriorityWarn    = document.getElementById('mgPriorityWarn');
  // Modello e sforzo per fase: le tendine le crea buildRoleModels, una per `${ruolo}.${campo}`.
  const mgRoleModels      = document.getElementById('mgRoleModels');
  const mgRoleModelsMsg   = document.getElementById('mgRoleModelsMsg');
  const roleSelects       = new Map();
  const mgJudgeTimeout     = document.getElementById('mgJudgeTimeout');
  const mgJudgeTimeoutSave = document.getElementById('mgJudgeTimeoutSave');
  const mgJudgeTimeoutMsg  = document.getElementById('mgJudgeTimeoutMsg');
  // Tetto di spesa e lunghezza dei giudici per i non fidati (#1515): un campo per chiave della risposta del main.
  const mgJudgeCampi = {
    tettoUsd: ['mgJudgeBudget', 'mgJudgeBudgetSave', 'mgJudgeBudgetRimetti', 'mgJudgeBudgetMsg'],
    maxCaratteri: ['mgJudgeChars', 'mgJudgeCharsSave', 'mgJudgeCharsRimetti', 'mgJudgeCharsMsg'],
  };
  for (const k of Object.keys(mgJudgeCampi)) mgJudgeCampi[k] = mgJudgeCampi[k].map((id) => document.getElementById(id));

  const mgLogLoading = document.getElementById('mgLogLoading');
  const mgLogDenied  = document.getElementById('mgLogDenied');
  const mgLogEmpty   = document.getElementById('mgLogEmpty');
  const mgLogList    = document.getElementById('mgLogList');
  const mgChannelSection = document.getElementById('mgChannelSection');
  const mgChannelEmpty   = document.getElementById('mgChannelEmpty');
  const mgChannelList    = document.getElementById('mgChannelList');

  const mgNoSections   = document.getElementById('mgNoSections');
  const mgListHead     = document.getElementById('mgListHead');
  const mgListLoading  = document.getElementById('mgListLoading');
  const mgList         = document.getElementById('mgList');
  const mgListEmpty    = document.getElementById('mgListEmpty');
  const mgArchiveFilter = document.getElementById('mgArchiveFilter');
  const mgStarFilter    = document.getElementById('mgStarFilter');
  const mgReevalBar     = document.getElementById('mgReevalBar');
  const mgReevalBtn     = document.getElementById('mgReevalBtn');
  const mgReevalMsg     = document.getElementById('mgReevalMsg');
  const mgConfirmedFilter = document.getElementById('mgConfirmedFilter');
  const mgAlignedBar    = document.getElementById('mgAlignedBar');
  const mgAlignedBtn    = document.getElementById('mgAlignedBtn');
  const mgAlignedMsg    = document.getElementById('mgAlignedMsg');

  const mgDetailEmpty = document.getElementById('mgDetailEmpty');
  const mgDetail      = document.getElementById('mgDetail');
  const mgDetailHead  = document.getElementById('mgDetailHead');
  const mgLivelliRow  = document.getElementById('mgLivelliRow');
  const mgForme       = document.getElementById('mgForme');
  const mgWorkState   = document.getElementById('mgWorkState');
  const mgThread      = document.getElementById('mgThread');

  const mgSideEmpty  = document.getElementById('mgSideEmpty');
  const mgSide       = document.getElementById('mgSide');
  const mgSideTitle  = document.getElementById('mgSideTitle');
  const mgSideClose  = document.getElementById('mgSideClose');
  const mgSideBody   = document.getElementById('mgSideBody');

  // La barra dell'owner: tutti i tasti su una riga sola e, sotto, i moduli che aprono.
  const mgOwnerBar      = document.getElementById('mgOwnerBar');

  // I pulsanti li genera renderActions() da MR.ownerActions, la tabella della gemella.
  const mgActions       = document.getElementById('mgActions');
  const mgAcceptComment = document.getElementById('mgAcceptComment');
  const mgActionsRow    = document.getElementById('mgActionsRow');
  const mgActionMsg     = document.getElementById('mgActionMsg');
  const mgOwnerMsgs     = document.getElementById('mgOwnerMsgs');
  const mgReopen        = document.getElementById('mgReopen');
  const mgReopenText    = document.getElementById('mgReopenText');
  const mgReopenCancel  = document.getElementById('mgReopenCancelBtn');
  const mgReopenConfirm = document.getElementById('mgReopenConfirmBtn');
  const mgSegnoConferma = document.getElementById('mgSegnoConferma');

  // Risposta alle domande di Claude (owner-only), nel pannello del rombo verde:
  // bozza ed esito stanno fuori dai nodi che i ridisegni ricostruiscono, un
  // solo invio per volta per pratica.
  const bozzeRisposta = new Map();
  const rispostaInVolo = new Set();
  let esitoRisposta = { text: '', kind: '' };
  // La pratica che aveva già le domande al disegno prima: il pannello si apre
  // da sé quando arrivano, non a ogni ridisegno dopo che l'owner l'ha chiuso.
  let attesaDisegnata = null;
  // Frase per chi ha segnalato: il modulo (`mgUserNote`) sta chiuso finché non
  // lo si apre col tasto della barra (`mgUserNoteToggle`).
  const mgUserNote       = document.getElementById('mgUserNote');
  const mgUserNoteToggle = document.getElementById('mgUserNoteToggle');
  const mgUserNoteText   = document.getElementById('mgUserNoteText');
  const mgUserNoteBtn    = document.getElementById('mgUserNoteBtn');
  const mgUserNoteMsg    = document.getElementById('mgUserNoteMsg');

  // I disegni delle forme vivono nel modulo condiviso: la pagina dei feedback disegna lo stesso segno.
  const FORME_SVG = window.SN_MANAGE_REVIEW.FORME_SVG;

  // Preferito ⭐ (owner-only): flag in chiaro, indipendente dallo stato.
  const mgManage     = document.getElementById('mgManage');
  const mgFiduciaBtn = document.getElementById('mgFiduciaBtn');
  const mgAtteseToggle = document.getElementById('mgAtteseToggle');
  const mgAttese       = document.getElementById('mgAttese');
  const mgAtteseLista  = document.getElementById('mgAtteseLista');
  const mgAtteseScrivi = document.getElementById('mgAtteseScrivi');
  const mgAtteseInput  = document.getElementById('mgAtteseInput');
  const mgAtteseAggiungi = document.getElementById('mgAtteseAggiungi');
  const mgAtteseTogliTutte = document.getElementById('mgAtteseTogliTutte');
  const mgStarBtn    = document.getElementById('mgStarBtn');
  const mgManageMsg  = document.getElementById('mgManageMsg');

  const mgSearchToggle = document.getElementById('mgSearchToggle');
  const mgSearchBar    = document.getElementById('mgSearchBar');
  const mgSearchIco    = document.getElementById('mgSearchIco');
  const mgSearchInput  = document.getElementById('mgSearchInput');
  const mgSearchMsg    = document.getElementById('mgSearchMsg');
  const mgSearchClose  = document.getElementById('mgSearchClose');

  const mgLightbox    = document.getElementById('mgLightbox');
  const mgLightboxImg = document.getElementById('mgLightboxImg');

  let isAdmin       = false;
  let allFeedbacks  = [];
  let dataLoaded    = false;    // i feedback sono arrivati davvero (vs. in corso/fallito)
  let loadFailed    = false;    // l'ultimo caricamento è fallito (≠ non ancora finito)
  let currentTab    = 'inbox';  // tab lista attiva (inbox/queue/resolved/archived)
  let currentList   = [];       // feedback della tab corrente, ordinati
  let selectedId    = null;     // ID del feedback selezionato nel pannello centrale
  // Segno di mittente pericoloso (#922): copia letta per mittente, i segni in corso di togliersi, e il
  // mittente aperto nel pannello di destra col feedback con cui chiederne il segno.
  const segniMittente = new Map();
  const segniInVolo = new Set();
  let mittenteAperto = null;
  let allByClient   = {};       // clientId → array di feedback (per il pannello mittente)
  let starredOnly   = false;    // filtro ⭐ della tab Archiviati (DB2)
  let confirmedOnly = false;    // filtro "Bloccati confermati" (attack/spam confermati)
  let releasedVersion = '';     // versione dell'app in esecuzione = ultima rilasciata (DB3)
  let firstListPromise = null;  // prima lettura della lista, avviata da init PRIMA del resto
  let testDataInjected = false; // uno spec ha iniettato la lista: il caricamento vero non la tocca più
  let searchMode    = false;      // true = la lista mostra i risultati di ricerca
  let searchSeq     = 0;          // guardia anti-race tra ricerche concorrenti
  // #903: gli aspettati che l'elenco non ha caricato, letti a parte una volta (id → riga, o { missing: true }).
  const attesiFuori = new Map();
  const attesiChiesti = new Set();
  let atteseApertePer = '';     // la pratica su cui l'owner ha aperto la casella delle attese

  // Etichette/testi vuoto per le tab-lista (DB1).
  const TAB_LABELS = {
    inbox: 'Ricevuti', queue: 'In coda', waiting: 'Aspettano', resolved: 'Risolti', archived: 'Archiviati',
  };
  const TAB_EMPTY = {
    inbox:    'Nessun feedback ricevuto.',
    queue:    'Nessun feedback in coda.',
    waiting:  'Nessun feedback aspetta un altro.',
    resolved: 'Nessun feedback risolto.',
    archived: 'Nessun feedback archiviato.',
  };
  const LIST_TABS = ['inbox', 'queue', 'waiting', 'resolved', 'archived'];
  // Come si chiama la lista quando le sezioni non ci sono: nessun nome di
  // sezione, perché nessuna sezione è stata scelta.
  const SENZA_SEZIONI_LABEL = 'Segnalazioni';
  const SENZA_SEZIONI_AVVISO = 'Questo computer non può leggere lo stato delle segnalazioni. '
    + 'Le trovi tutte qui sotto, in un elenco solo.';

  const FB  = window.SN_FEEDBACK;
  const MR  = window.SN_MANAGE_REVIEW;
  const ATT = window.SN_FB_ATTESE;
  const TH  = window.SN_FEEDBACK_THREAD;
  const SRCH = window.SN_MANAGE_SEARCH;
  const DOMANDE = window.SN_MG_DOMANDE;

  // ── Sezioni (SPEC-DOMANDE §2.1) ───────────────────────────────────────────
  const mgSezioni = document.getElementById('mgSezioni');
  const mgLivelliFiltro = document.getElementById('mgLivelliFiltro');
  const SEZIONE_KEY = 'filo_manage_sezione';
  let sezioneAttiva = 'feedback';
  const schedaPerSezione = {};
  for (const s of MR.SEZIONI) schedaPerSezione[s.id] = s.schede[0];
  // Dopo un gesto vero dell'owner la sezione d'apertura non scatta più: una pratica aperta, un filtro o una ricerca
  // cominciati mentre le domande arrivano non si portano via. Vale ogni gesto, non le sole schede.
  let utenteHaScelto = false;
  let aperturaFatta = false;
  for (const ev of ['pointerdown', 'keydown', 'wheel']) {
    document.addEventListener(ev, (e) => { if (e.isTrusted) utenteHaScelto = true; }, { capture: true, passive: true });
  }
  // Il filtro per livello non si ricorda: un L4 lasciato acceso nasconderebbe un L1 arrivato dopo.
  let livelliScelti = [];
  // «Solo non fidate» (#1575) vale per le schede dei feedback e per le Domande; non si ricorda, per lo stesso motivo.
  let soloNonFidate = false;
  const mgFiduciaFiltro = document.getElementById('mgFiduciaFiltro');
  const mgDomandeFiduciaFiltro = document.getElementById('mgDomandeFiduciaFiltro');
  const DOMANDE_TABS = (MR.SEZIONI.find((s) => s.id === 'domande') || { schede: [] }).schede;
  const AUTO_MODE_KEY = (window.SN_CONST?.STORAGE_KEYS?.AUTO_MODE) || 'filo_auto_mode';
  const SORT_MODE_KEY = 'filo_manage_sort';
  const AUTOMATION_GET = (window.SN_MSG?.MSG?.AUTOMATION_GET) || 'automation_get';
  const AUTOMATION_SET = (window.SN_MSG?.MSG?.AUTOMATION_SET) || 'automation_set';

  // Icona d'autore: qui solo la resa visiva, la classificazione sta in TH.authorKind. Le tre
  // automazioni restano separate: conta se un ritrovamento nasce esplorando o verificando.
  const AUTHOR_META = {
    owner:    { icon: '👑', label: 'Owner' },
    user:     { icon: '👤', label: 'Utente' },
    filo:     { icon: '🧵', label: 'Filo (per conto di un utente)' },
    prober:   { icon: '🔍', label: 'Claude (esplorazione)' },
    worker:   { icon: '🔧', label: 'Claude (sviluppo)' },
    verifier: { icon: '🧪', label: 'Claude (verifica)' },
    // I rilievi rimasti fuori dal giro di correzione (feedback #561:
    // esterni al lavoro, o interni messi da parte dal bilancio), aperti dal
    // server uno per rilievo, figli #N.k, priorità = livello: categoria
    // propria, così leggendo la coda si vede che nasce da una verifica, non da
    // un'esplorazione.
    residuo:  { icon: '🧹', label: 'Claude (rilievi derivati da una verifica)' },
    // Sessione locale: Claude in chat con l'owner, sulla sua macchina. Icona
    // "computer" perché è l'unica delle istanze che lavora DAVANTI a lui: le
    // altre girano da sole, questa nasce da una conversazione.
    local:    { icon: '💻', label: 'Claude (sessione locale)' },
    // Lo apre il server quando una versione non si costruisce (#1002): non è Claude, ed è lavoro che ferma le uscite.
    costruzione: { icon: '🏗️', label: 'Allarme della pubblicazione' },
    claude:   { icon: '🤖', label: 'Claude (ruolo non indicato)' },
  };
  // Dal feedback, non dal clientId: un nome riservato senza prova è un utente come gli altri (#912).
  function authorKindOf(fb) {
    return (TH && TH.authorKind) ? TH.authorKind(fb || {}) : 'user';
  }
  // Quello che Filo manda dalla copia dell'owner porta la sua prova (#953): l'etichetta lo dice, la categoria no.
  const PER_CONTO_OWNER = {
    owner: { icon: AUTHOR_META.owner.icon, label: 'Owner (scritto da Filo)' },
    filo:  { icon: AUTHOR_META.filo.icon, label: 'Filo (per conto dell\'owner)' },
  };
  function authorMetaOf(fb) {
    const kind = authorKindOf(fb);
    if (PER_CONTO_OWNER[kind] && TH && TH.filoPerConto && TH.filoPerConto(fb || {}) === 'owner') return PER_CONTO_OWNER[kind];
    return AUTHOR_META[kind] || AUTHOR_META.user;
  }
  function authorIconHtml(fb) {
    const m = authorMetaOf(fb);
    return `<span class="mg-item-author" title="Scritto da: ${esc(m.label)}" aria-label="Scritto da ${esc(m.label)}">${m.icon}</span>`;
  }
  // Etichetta del mittente. Solo per gli utenti si mostra un pezzo di identificativo: è l'unica
  // cosa che li distingue; altrove sarebbe rumore.
  function senderLabel(fb) {
    const kind = authorKindOf(fb);
    const m = authorMetaOf(fb);
    if (kind !== 'user') return `${m.icon} ${m.label}`;
    // Senza il nome riservato che si era dato: ne mostrerebbe la firma.
    const id = String((fb && fb.clientId) || '').trim().replace(/^(non-provato:)?(owner|routine|agent|local):/i, '');
    const short = id.slice(0, 8);
    return short ? `${m.icon} ${m.label} · ${short}…` : `${m.icon} ${m.label}`;
  }

  // 'smart' = ordine predefinito per-tab; gli altri sono override globali dal tasto destro.
  const SORT_MODES = {
    smart:    'Ordine predefinito',
    num:      'Per numero (recenti prima)',
    priority: 'Per priorità',
    creator:  'Per creatore',
  };
  let sortMode = 'smart';

  // Chiave per l'ordinamento per numero: seq.subSeq (#12.3 → 12003). Senza numero → in fondo.
  function seqKey(fb) {
    const s = Number(fb && fb.seq);
    if (!Number.isFinite(s)) return -Infinity;
    const sub = Number(fb && fb.subSeq) || 0;
    return s * 1000 + Math.min(999, Math.max(0, sub));
  }
  // Rango di categoria per l'ordinamento "per creatore" (raggruppa gli autori
  // dello stesso tipo, poi per clientId così lo stesso mittente resta unito).
  // Le automazioni restano raggruppate fra loro (e fra owner/utente e Filo, come
  // prima); dentro il gruppo l'ordine va dal lavoro sul codice all'esplorazione.
  // Ordine "per creatore": prima le persone (owner, utenti), poi le istanze di
  // Claude — la sessione locale in testa, perché è quella che lavora insieme
  // all'owner — e in fondo Filo che scrive per conto di un utente.
  const AUTHOR_RANK = { owner: 0, user: 1, local: 2, worker: 3, verifier: 4, residuo: 5, prober: 6, costruzione: 7, claude: 8, filo: 9 };
  // Applica l'override di ordinamento scelto dall'owner. `list` arriva GIÀ
  // ordinata col criterio predefinito della tab: in 'smart' la lasciamo intatta.
  // `sort` è stabile → a parità di chiave si conserva l'ordine predefinito.
  function applySortMode(list) {
    if (sortMode === 'smart') return list;
    const arr = list.slice();
    if (sortMode === 'num') {
      arr.sort((a, b) => seqKey(b) - seqKey(a));
    } else if (sortMode === 'priority') {
      arr.sort((a, b) => MR.priorityOf(b) - MR.priorityOf(a));
    } else if (sortMode === 'creator') {
      arr.sort((a, b) => {
        const ra = AUTHOR_RANK[authorKindOf(a)] ?? 99;
        const rb = AUTHOR_RANK[authorKindOf(b)] ?? 99;
        if (ra !== rb) return ra - rb;
        return senderKeyOf(a).localeCompare(senderKeyOf(b));
      });
    }
    return arr;
  }
  const CAP3_KEY = (window.SN_CONST?.STORAGE_KEYS?.AUTOMATION_CAP3) || 'filo_automation_cap3';
  const CAP2_KEY = (window.SN_CONST?.STORAGE_KEYS?.AUTOMATION_CAP2) || 'filo_automation_cap2';
  const CAP1_KEY = (window.SN_CONST?.STORAGE_KEYS?.AUTOMATION_CAP1) || 'filo_automation_cap1';
  const CAP0_KEY = (window.SN_CONST?.STORAGE_KEYS?.AUTOMATION_CAP0) || 'filo_automation_cap0';
  const AUTOMATION = window.SN_CONST?.AUTOMATION || { CAP_MIN: 0, CAP_MAX: 10 };
  // Nessun default dei bilanci nel codice: i numeri stanno solo nel documento del server; un
  // campo che lì non c'è si mostra vuoto, e lo si dice.

  // Canale main process
  function sendToMain(msg) {
    if (window.filo?.message)               return window.filo.message(msg);
    if (window.chrome?.runtime?.sendMessage) return window.chrome.runtime.sendMessage(msg);
    return Promise.reject(new Error('canale main non disponibile'));
  }

  // Auth — chi guarda cambia: unica porta, e unico posto dove si svuotano le risposte tenute
  // da parte. Un «no» su un allegato dipende da CHI guarda, o restano segnaposti.
  function setIsAdmin(v) {
    const nuovo = !!v;
    if (nuovo === isAdmin) return;
    isAdmin = nuovo;
    imgCache.clear();
    segniMittente.clear();
    // Anche le risposte sulle pillole dei documenti: dipendono da chi guarda
    // esattamente come quelle delle immagini, e tenerne una sola delle due
    // avrebbe lasciato metà del difetto in piedi.
    fileWhyCache.clear();
    // Le statistiche dicono «riservata all'owner» finché non lo sei. Se
    // l'accesso arriva mentre quella scheda è aperta, deve accorgersene da
    // aperta: senza, restava il rifiuto finché non si cambiava scheda e si
    // tornava indietro (patterns/vai-a-guardare-in-quellaltro-posto-quel-posto.md).
    const panFs = document.getElementById('panel-fbstats');
    if (nuovo && panFs && panFs.classList.contains('mg-panel--active')) loadFsData();
  }

  // Vero da quando l'avvio ha chiesto le impostazioni: un accesso arrivato dopo le richiede di nuovo.
  let impostazioniAvviate = false;
  function caricaImpostazioni() {
    // Le pause non trattengono gli altri controlli «in lettura»: sono una riga in più, non un valore da scegliere.
    loadPause();
    return Promise.allSettled([loadAutoMode(), loadCaps(), loadSessions(), loadRoleModels(), loadJudgeTimeout(), loadJudgeBudget(), loadMergeApprovals()])
      .finally(fineLetturaAutomazioni);
  }

  // Finché la prima lettura non risponde i controlli non mostrano un valore (regola nel CSS di manage.html).
  function fineLetturaAutomazioni() {
    const pan = document.getElementById('panel-automation');
    if (!pan) return;
    pan.classList.remove('mg-in-lettura');
    pan.removeAttribute('aria-busy');
  }

  async function refreshAuth() {
    const eraAdmin = isAdmin;
    try {
      const r = await sendToMain({ type: 'auth_status' });
      setIsAdmin(!!(r && r.isAdmin));
    } catch (_) {
      setIsAdmin(false);
    }
    mgBanner.hidden = isAdmin;
    // Un accesso fatto dal banner deve sbloccare i controlli senza riaprire la pagina.
    applyAutoModeGate();
    // Sbloccati, i campi mostrerebbero ciò che si è letto da non owner (cioè niente): si rilegge dal server.
    if (isAdmin && !eraAdmin && impostazioniAvviate) await caricaImpostazioni();
    // Stessa pagina, stessa regola: i Modelli di supporto rifiutati da non owner si rileggono anche loro.
    if (isAdmin && !eraAdmin) rileggiModelliRifiutati();
    if (isAdmin && !eraAdmin && DOMANDE && DOMANDE.stato().soloOwner) DOMANDE.carica();
  }

  mgSignInBtn.addEventListener('click', () => {
    // Finito l'accesso si richiede lo stato: toglie l'avviso di sola lettura e svuota le risposte
    // di quando non eravamo nessuno.
    sendToMain({ type: 'auth_signin' }).then(() => refreshAuth()).catch(() => {});
  });

  // Una fila per impostazione: due scelte sulla stessa arrivano al server
  // nell'ordine in cui sono state fatte, senza trattenere le altre (#675).
  const fileSalvataggi = new Map();
  function inFila(chiave, fn) {
    const giro = (fileSalvataggi.get(chiave) || Promise.resolve()).then(fn, fn);
    fileSalvataggi.set(chiave, giro.catch(() => {}));
    return giro;
  }

  // Interruttori dell'automazione: una lettura vale per un interruttore solo se
  // nessun suo salvataggio era per strada né è partito o arrivato nel frattempo.
  const mosseAuto = { enabled: 0, routinesEnabled: 0, autoApprove: 0, lavoriServer: 0 };
  const inVoloAuto = { enabled: 0, routinesEnabled: 0, autoApprove: 0, lavoriServer: 0 };
  function salvaAuto(chiave, fn) {
    mosseAuto[chiave] += 1;
    inVoloAuto[chiave] += 1;
    return inFila(chiave, fn).finally(() => {
      mosseAuto[chiave] += 1;
      inVoloAuto[chiave] -= 1;
    });
  }
  const fotoAuto = () => Object.fromEntries(Object.keys(mosseAuto).map((k) => [k, inVoloAuto[k] ? -1 : mosseAuto[k]]));
  const ancoraVera = (foto, k) => foto[k] !== -1 && foto[k] === mosseAuto[k];

  // ── Switch "Routine autonome" (interruttore master) ───────────────────────
  // Vive nel doc Firestore config/routines, che le routine leggono SENZA
  // credenziali: è l'unico modo perché "spento" arrivi davvero alle loro
  // macchine (le altre impostazioni stavano in un documento che loro non
  // possono leggere, e infatti non le hanno mai viste — vedi #451).
  //
  // Spento non è "meno lavoro": è nessun lavoro. Le impostazioni che valgono
  // solo per le routine restano modificabili: si preparano prima di riaccendere.
  function reflectRoutines(on) {
    if (mgRoutinesToggle) mgRoutinesToggle.checked = !!on;
    if (mgRoutinesState)  mgRoutinesState.textContent = on ? 'On' : 'Off';
  }

  function setRoutinesMsg(text, kind) {
    if (!mgRoutinesMsg) return;
    mgRoutinesMsg.textContent = text || '';
    mgRoutinesMsg.classList.toggle('mg-ok', kind === 'ok');
    mgRoutinesMsg.classList.toggle('mg-err', kind === 'err');
  }

  let routinesScelte = 0;
  if (mgRoutinesToggle) {
    mgRoutinesToggle.addEventListener('change', () => {
      const on = mgRoutinesToggle.checked;
      const mia = ++routinesScelte;
      reflectRoutines(on);
      setRoutinesMsg('', null);
      return salvaAuto('routinesEnabled', async () => {
        try {
          const r = await sendToMain({ type: AUTOMATION_SET, routinesEnabled: on });
          if (!r || r.ok === false) throw new Error(r?.error || 'errore sconosciuto');
          // Un clic più nuovo è in fila: lo schermo lo dice già, e parlerà lui.
          if (mia !== routinesScelte) return;
          reflectRoutines(r.routinesEnabled !== false);
          // Spegnere vale dal prossimo giro: chi sta già lavorando finisce il suo
          // compito. Senza dirlo, sembrerebbe non aver fatto niente.
          setRoutinesMsg(on ? 'Salvato.' : 'Salvato. Un lavoro già in corso arriva in fondo, poi non ne parte nessun altro.', 'ok');
        } catch (err) {
          console.error('[manage] salvataggio interruttore routine fallito:', err);
          if (mia !== routinesScelte) return;
          // Non scritto = non cambiato: lo switch non deve dire il contrario.
          reflectRoutines(!on);
          setRoutinesMsg('Salvataggio fallito: le routine NON sono cambiate.', 'err');
        }
      });
    });
  }

  // Switch «Modalità automatica». Fonte di verità: config/automation (`enabled`), letto dal
  // backend dei giudici; chrome.storage.local è solo cache e ripiego se l'IPC tace.
  function reflectAutoMode(on) {
    mgAutoToggle.checked = !!on;
    mgAutoState.textContent = on ? 'On' : 'Off';
  }

  function setAutoModeMsg(text, kind) {
    if (!mgAutoMsg) return;
    mgAutoMsg.textContent = text || '';
    mgAutoMsg.classList.toggle('mg-ok', kind === 'ok');
    mgAutoMsg.classList.toggle('mg-err', kind === 'err');
  }

  async function loadAutoMode() {
    try {
      const data = await chrome.storage.local.get(AUTO_MODE_KEY);
      reflectAutoMode(!!data[AUTO_MODE_KEY]);
    } catch (_) {
      reflectAutoMode(false);
    }
    try {
      const foto = fotoAuto();
      const r = await sendToMain({ type: AUTOMATION_GET });
      if (r && r.ok) {
        if (ancoraVera(foto, 'enabled')) {
          reflectAutoMode(Boolean(r.enabled));
          chrome.storage.local.set({ [AUTO_MODE_KEY]: Boolean(r.enabled) }).catch(() => {});
        }
        if (ancoraVera(foto, 'autoApprove')) reflectAutoApprove(r.autoApprove);
        if (ancoraVera(foto, 'routinesEnabled')) reflectRoutines(r.routinesEnabled !== false);
        if (mgLavoriServer && ancoraVera(foto, 'lavoriServer') && mgLavoriServer.checked !== (r.lavoriServer === true)) {
          mgLavoriServer.checked = r.lavoriServer === true;
          renderList();
        }
      }
    } catch (_) { /* resta la cache */ }
  }

  let autoScelte = 0;
  mgAutoToggle.addEventListener('change', () => {
    const on = mgAutoToggle.checked;
    const mia = ++autoScelte;
    reflectAutoMode(on);
    setAutoModeMsg('', null);
    return salvaAuto('enabled', async () => {
      try {
        const foto = fotoAuto();
        const r = await sendToMain({ type: AUTOMATION_SET, enabled: on });
        if (!r || r.ok === false) throw new Error(r?.error || 'errore sconosciuto');
        if (ancoraVera(foto, 'autoApprove')) reflectAutoApprove(r.autoApprove);
        if (mia !== autoScelte) return;
        reflectAutoMode(Boolean(r.enabled));
        chrome.storage.local.set({ [AUTO_MODE_KEY]: Boolean(r.enabled) }).catch(() => {});
        // Accendere l'automatica vale da ORA in avanti: agisce al momento del
        // giudizio, quindi i feedback già in attesa restano dove sono. Senza
        // dirlo, accendere lo switch sembra di nuovo non fare niente — e i già in
        // attesa hanno il loro pulsante, due righe più in là.
        const pending = r.enabled ? alignedFeedbacks(true).length : 0;
        setAutoModeMsg(
          pending
            ? `Salvato. I ${pending} già in attesa restano nei Ricevuti: usa «Approva tutti gli allineati».`
            : 'Salvato.',
          'ok',
        );
      } catch (err) {
        console.error('[manage] salvataggio modalità automatica fallito:', err);
        if (mia !== autoScelte) return;
        // Ripristina lo stato precedente: se non è stato scritto su Firestore, non
        // è attivo — e lo switch non deve dire il contrario.
        reflectAutoMode(!on);
        setAutoModeMsg('Salvataggio fallito: la modalità automatica NON è cambiata.', 'err');
      }
    });
  });

  // ── Auto-approvazione per fiducia (#446, §10) ─────────────────────────────
  // Con l'automatica accesa, questi decidono quale fiducia basta per entrare in
  // coda senza passare dall'owner. Spenta non contano, ma si possono preparare:
  // valgono solo al giudizio, scriverli non muove niente.
  // Il main rilegge e riscrive la mappa intera: i salvataggi stanno in una fila
  // sola, e le scelte ancora in fila stanno sopra ogni mappa che arriva prima.
  let autoApproveServer = null;
  const autoApproveInAttesa = [];
  function reflectAutoApprove(map) {
    if (map !== undefined) autoApproveServer = map;
    // Il ripiego sulla mappa per mittente vive nel modulo condiviso: una mappa
    // salvata prima non deve mostrare acceso ciò che l'owner aveva spento.
    const base = autoApproveServer;
    const resolved = (TH && TH.resolveAutoApprove) ? TH.resolveAutoApprove(base) : null;
    const m = Object.assign({}, resolved || ((base && typeof base === 'object') ? base : {}));
    for (const s of autoApproveInAttesa) m[s.group] = s.want;
    for (const [group, el] of Object.entries(mgAutoApprove)) {
      if (el) el.checked = m[group] !== false;
    }
  }

  for (const [group, el] of Object.entries(mgAutoApprove)) {
    if (!el) continue;
    el.addEventListener('change', () => {
      const scelta = { group, want: el.checked };
      autoApproveInAttesa.push(scelta);
      setAutoModeMsg('', null);
      return salvaAuto('autoApprove', async () => {
        let r = null;
        let errore = null;
        try { r = await sendToMain({ type: AUTOMATION_SET, autoApprove: { [group]: scelta.want } }); } catch (err) { errore = err; }
        autoApproveInAttesa.splice(autoApproveInAttesa.indexOf(scelta), 1);
        if (r && r.ok !== false) return reflectAutoApprove(r.autoApprove);
        // Non scritto = non cambiato. Mai letta la mappa: l'unico stato noto è quello di prima del clic.
        if (autoApproveServer !== null) reflectAutoApprove();
        else if (!autoApproveInAttesa.some((s) => s.group === group)) el.checked = !scelta.want;
        setAutoModeMsg('Salvataggio fallito: l\'impostazione NON è cambiata.', 'err');
        console.error('[manage] salvataggio auto-approvazione fallito:', errore || r?.error);
      });
    });
  }

  // ── Lavori server alle routine (#1159) ─────────────────────────────────────
  // Spento (o mai scritto): i lavori server restano alle sessioni locali, come prima.
  let lavoriServerScelte = 0;
  if (mgLavoriServer) {
    mgLavoriServer.addEventListener('change', () => {
      const want = mgLavoriServer.checked;
      const mia = ++lavoriServerScelte;
      if (mgLavoriServerMsg) { mgLavoriServerMsg.textContent = ''; mgLavoriServerMsg.classList.remove('mg-err'); }
      return salvaAuto('lavoriServer', async () => {
        try {
          const r = await sendToMain({ type: AUTOMATION_SET, lavoriServer: want });
          if (!r || r.ok === false) throw new Error(r?.error || 'errore sconosciuto');
          if (mia !== lavoriServerScelte) return;
          mgLavoriServer.checked = r.lavoriServer === true;
          // Le schede dei lavori server dicono chi li porta avanti: le routine o una sessione.
          renderList();
        } catch (err) {
          console.error('[manage] salvataggio lavori server fallito:', err);
          if (mia !== lavoriServerScelte) return;
          mgLavoriServer.checked = !want;
          if (mgLavoriServerMsg) {
            mgLavoriServerMsg.textContent = 'Salvataggio fallito: l\'impostazione NON è cambiata.';
            mgLavoriServerMsg.classList.add('mg-err');
          }
        }
      });
    });
  }

  function applyAutoModeGate() {
    mgAutoToggle.disabled = !isAdmin;
    mgAutoSwitch.classList.toggle('mg-switch--disabled', !isAdmin);
    if (mgRoutinesToggle) mgRoutinesToggle.disabled = !isAdmin;
    if (mgRoutinesSwitch) mgRoutinesSwitch.classList.toggle('mg-switch--disabled', !isAdmin);
    // Solo l'essere owner decide: nessuna impostazione dipende da un'altra
    // accesa, perché si preparano prima di riaccendere (richiesta owner).
    if (mgGiroStrettoSwitch) mgGiroStrettoSwitch.classList.toggle('mg-switch--disabled', !isAdmin);
    if (mgLavoriServerSwitch) mgLavoriServerSwitch.classList.toggle('mg-switch--disabled', !isAdmin);
    for (const el of [mgCap3, mgCap3Save, mgCap2, mgCap2Save, mgCap1, mgCap1Save, mgCap0, mgCap0Save,
      mgFixInstructions, mgFixInstructionsSave, mgLavoriServer, mgGiroStretto, mgMaxSessions, mgMaxSessionsSave,
      mgAccountA, mgAccountB, ...mgPriorityRadios, ...roleSelects.values(), mgJudgeTimeout, mgJudgeTimeoutSave, ...Object.values(mgAutoApprove),
      ...Object.values(mgJudgeCampi).flatMap(([input, salva, rimetti]) => [input, salva, rimetti])]) {
      if (el) el.disabled = !isAdmin;
    }
  }

  // ── I bilanci dei giri di correzione, uno per livello (tab Automazioni) ──
  // Cinque campi sul doc Firestore config/routines (feedback #561, §4):
  //   cap3  giri di correzione per i rilievi di livello 3 (a bilancio finito
  //         un 3 ferma la pratica e chiama l'owner);
  //   cap2  giri per i rilievi di livello 2 (a bilancio finito escono come
  //         feedback a priorità 2, il lavoro non si ferma);
  //   cap1  giri per i rilievi di livello 1 (a bilancio finito vanno nel
  //         feedback derivato);
  //   cap0  giri per i soli rilievi di livello 0 (0 = mai da soli);
  //   fixInstructions  il testo che il server aggiunge in coda alla risposta
  //         a una critica (vuoto = il testo del server).
  // Li applica il SERVER quando registra la critica; chrome.storage.local è
  // solo una CACHE per mostrare subito un valore (e un ripiego offline).
  // Nel range, o null se non è un numero (un campo vuoto non è uno zero).
  function clampCap(n, min = AUTOMATION.CAP_MIN) {
    if (n === '' || n === null || n === undefined) return null;
    n = Math.round(Number(n));
    if (!Number.isFinite(n)) return null;
    return Math.min(AUTOMATION.CAP_MAX, Math.max(min, n));
  }

  const CAPS_GET = (window.SN_MSG?.MSG?.AUTOMATION_CAPS_GET) || 'automation_caps_get';
  const CAPS_SET = (window.SN_MSG?.MSG?.AUTOMATION_CAPS_SET) || 'automation_caps_set';

  // I bilanci condividono il meccanismo: descrizione una volta sola. L'ordine
  // e i nomi sono quelli di VERIFIER_CAP_KEYS (una sentinella li confronta).
  const CAP_FIELDS = {
    cap3: { input: mgCap3, save: mgCap3Save, msg: mgCap3Msg, cacheKey: CAP3_KEY, min: AUTOMATION.CAP_MIN },
    cap2: { input: mgCap2, save: mgCap2Save, msg: mgCap2Msg, cacheKey: CAP2_KEY, min: AUTOMATION.CAP_MIN },
    cap1: { input: mgCap1, save: mgCap1Save, msg: mgCap1Msg, cacheKey: CAP1_KEY, min: AUTOMATION.CAP_MIN },
    cap0: { input: mgCap0, save: mgCap0Save, msg: mgCap0Msg, cacheKey: CAP0_KEY, min: AUTOMATION.CAP_MIN },
  };

  function setCapMsg(field, text, kind) {
    const el = field === 'fixInstructions' ? mgFixInstructionsMsg : CAP_FIELDS[field]?.msg;
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('mg-ok', kind === 'ok');
    el.classList.toggle('mg-err', kind === 'err');
  }

  async function loadCaps() {
    const remote = {};
    // Sorgente autorevole: Firestore via main. Se la lettura riesce vale quello che dice il
    // server anche quando un campo MANCA; la cache serve solo a chi non ha potuto leggere.
    let lettoDalServer = false;
    let giroStrettoRemoto = false;
    try {
      const r = await sendToMain({ type: CAPS_GET });
      if (r && r.ok) {
        lettoDalServer = true;
        for (const k of Object.keys(CAP_FIELDS)) if (r[k] != null) remote[k] = r[k];
        if (typeof r.fixInstructions === 'string') remote.fixInstructions = r.fixInstructions;
        giroStrettoRemoto = r.giroStretto === true;
      }
    } catch (_) {}
    for (const [field, f] of Object.entries(CAP_FIELDS)) {
      if (!f.input) continue;
      let val = null;
      if (remote[field] != null) {
        val = clampCap(remote[field], f.min);
        if (val !== null) chrome.storage.local.set({ [f.cacheKey]: val }).catch(() => {});
      } else if (!lettoDalServer) {
        // Ripiego sulla cache locale (non admin / offline).
        try {
          const data = await chrome.storage.local.get(f.cacheKey);
          if (data[f.cacheKey] != null) val = clampCap(data[f.cacheKey], f.min);
        } catch (_) {}
      }
      // Sul server manca: si mostra vuoto e si dice. Senza questo numero la
      // verifica (server e locale) si ferma con un errore, non usa un default.
      f.input.value = val === null ? '' : String(val);
      if (val === null && lettoDalServer) setCapMsg(field, 'Non impostato sul server: scrivi un numero (0 compreso) e salva.', 'err');
      else if (val !== null) setCapMsg(field, '', null);
    }
    if (mgFixInstructions && typeof remote.fixInstructions === 'string') mgFixInstructions.value = remote.fixInstructions;
    if (mgGiroStretto && lettoDalServer) mgGiroStretto.checked = giroStrettoRemoto;
    // Non letto: l'interruttore resta com'era, e l'owner deve sapere che non è la parola del server.
    if (mgGiroStrettoMsg && isAdmin) {
      mgGiroStrettoMsg.textContent = lettoDalServer ? '' : 'Non letto dal server: lo stato vero può essere diverso.';
      mgGiroStrettoMsg.classList.toggle('mg-err', !lettoDalServer);
      mgGiroStrettoMsg.classList.remove('mg-ok');
    }
  }

  async function saveCap(field) {
    const f = CAP_FIELDS[field];
    if (!f.input) return;
    // Un campo vuoto non è uno zero (per il livello 3 lo 0 ferma il lavoro
    // al primo rilievo) e non è nemmeno «torno al default»: un default non
    // c'è più (2026-09-16). Vuoto = non si salva, e la scritta lo dice.
    const val = clampCap(f.input.value, f.min);
    if (val === null) {
      setCapMsg(field, 'Vuoto o non numerico: non salvato. Scrivi un numero, 0 compreso.', 'err');
      return;
    }
    f.input.value = String(val); // normalizza eventuali fuori-range
    try {
      // Scrive su Firestore (la config che il server della critica legge); il main applica il gate
      // admin e ri-clampa, quindi si usa il valore confermato.
      const r = await sendToMain({ type: CAPS_SET, [field]: val });
      if (!r || !r.ok) {
        setCapMsg(field, 'Salvataggio fallito.', 'err');
        if (r?.error) console.error(`[manage] salvataggio ${field}:`, r.error);
        return;
      }
      const confermato = clampCap(r[field] != null ? r[field] : val, f.min);
      const saved = confermato === null ? val : confermato;
      f.input.value = String(saved);
      chrome.storage.local.set({ [f.cacheKey]: saved }).catch(() => {});
      setCapMsg(field, 'Salvato.', 'ok');
    } catch (err) {
      setCapMsg(field, 'Salvataggio fallito.', 'err');
      console.error(`[manage] salvataggio ${field} fallito:`, err);
    }
  }

  async function saveFixInstructions() {
    if (!mgFixInstructions) return;
    const text = String(mgFixInstructions.value || '');
    // Oltre il tetto il server taglia: meglio dirlo che salvare un testo mozzato con un
    // «Salvato.».
    const max = Number(AUTOMATION.FIX_INSTRUCTIONS_MAX) || 8000;
    if (text.length > max) {
      setCapMsg('fixInstructions', `Troppo lungo: ${text.length.toLocaleString('it-IT', { useGrouping: true })} caratteri, il massimo è ${max.toLocaleString('it-IT', { useGrouping: true })}. Non salvato.`, 'err');
      return;
    }
    try {
      const r = await sendToMain({ type: CAPS_SET, fixInstructions: text });
      if (!r || !r.ok) {
        setCapMsg('fixInstructions', 'Salvataggio fallito.', 'err');
        if (r?.error) console.error('[manage] salvataggio fixInstructions:', r.error);
        return;
      }
      if (typeof r.fixInstructions === 'string') mgFixInstructions.value = r.fixInstructions;
      setCapMsg('fixInstructions', text.trim() ? 'Salvato.' : 'Salvato: vale il testo del server.', 'ok');
    } catch (err) {
      setCapMsg('fixInstructions', 'Salvataggio fallito.', 'err');
      console.error('[manage] salvataggio fixInstructions fallito:', err);
    }
  }

  for (const [field, f] of Object.entries(CAP_FIELDS)) {
    if (f.save) f.save.addEventListener('click', () => saveCap(field));
    // Digitando si azzera l'esito precedente; Invio salva come il pulsante.
    if (f.input) {
      f.input.addEventListener('input', () => setCapMsg(field, '', null));
      f.input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || f.input.disabled) return;
        e.preventDefault();
        saveCap(field);
      });
    }
  }
  // Il giro stretto: stessa strada dei bilanci (config/routines via main). Un
  // salvataggio fallito rimette l'interruttore dov'era, e lo dice.
  if (mgGiroStretto) {
    mgGiroStretto.addEventListener('change', async () => {
      const want = mgGiroStretto.checked;
      const esito = (text, kind) => {
        if (!mgGiroStrettoMsg) return;
        mgGiroStrettoMsg.textContent = text;
        mgGiroStrettoMsg.classList.toggle('mg-ok', kind === 'ok');
        mgGiroStrettoMsg.classList.toggle('mg-err', kind === 'err');
      };
      esito('', null);
      try {
        const r = await sendToMain({ type: CAPS_SET, giroStretto: want });
        if (!r || !r.ok) throw new Error(r?.error || 'errore sconosciuto');
        mgGiroStretto.checked = r.giroStretto === true;
        esito('Salvato.', 'ok');
      } catch (err) {
        mgGiroStretto.checked = !want;
        esito('Salvataggio fallito: l\'impostazione NON è cambiata.', 'err');
        console.error('[manage] salvataggio giro stretto fallito:', err);
      }
    });
  }
  if (mgFixInstructionsSave) mgFixInstructionsSave.addEventListener('click', saveFixInstructions);
  if (mgFixInstructions) mgFixInstructions.addEventListener('input', () => setCapMsg('fixInstructions', '', null));

  // ── Come partono le sessioni delle routine ────────────────────────────────
  // Quattro campi su config/routines che legge il server quando accende le
  // sessioni. Restano manovrabili a routine spente: escludere un account è una
  // cosa che si decide PRIMA di riaccendere.
  const SESSIONS_GET = (window.SN_MSG?.MSG?.AUTOMATION_SESSIONS_GET) || 'automation_sessions_get';
  const SESSIONS_SET = (window.SN_MSG?.MSG?.AUTOMATION_SESSIONS_SET) || 'automation_sessions_set';
  const RS = window.SN_ROUTINE_SESSIONI;
  // I limiti del campo vengono dal registro, non dall'HTML: scritti in due
  // posti divergono e vince quello sbagliato.
  if (mgMaxSessions && RS) {
    const { min, max } = RS.limiti();
    mgMaxSessions.min = String(min);
    mgMaxSessions.max = String(max);
  }

  let sessionsState = RS ? RS.leggiDoc({}) : null;
  // Campi che vengono dal server: gli altri sono valori di partenza e non si
  // mostrano per veri (campo vuoto, nessuna pillola, nessun avviso).
  const sessionsNoti = new Set();
  const SESSIONS_NON_LETTO = 'Non ho potuto leggere dal server: quello che vedi qui non viene da lì.';
  // Orologio delle richieste: un documento intero vale solo se è partito dopo
  // l'ultimo accolto, e mai sopra un campo confermato da una scrittura arrivata
  // dopo la sua partenza (può averlo letto prima di quella scrittura).
  let sessionsTick = 0;
  let sessionsAccolto = 0;
  const sessionsFermo = {};
  // Scelte partite e non ancora confermate: stanno sopra ogni risposta che le precede.
  const sessionsInAttesa = [];
  // Numero scritto e non ancora salvato: una risposta su un altro campo non lo cancella.
  let maxInScrittura = false;

  // Righe che dicono di non aver riletto il resto, col testo che resta quando
  // un documento intero arriva: da lì in poi l'avviso sarebbe falso (#675).
  const avvisiLettura = new Map();
  const righeSessions = [[mgMaxSessionsMsg, ['maxSessions']], [mgPriorityAccountMsg, ['priorityAccount']], [mgAccountsMsg, ['accountAOff', 'accountBOff']]];
  // Ultimo esito di ogni riga; l'avviso «non letto» non è un esito: lo decide mostraSessionsMsg.
  const esitiSessions = new Map();
  const sceltePendenti = () => Object.assign({}, ...sessionsInAttesa.map((s) => s.valori));
  const notoSessions = (...chiavi) => {
    const scelte = sceltePendenti();
    return chiavi.every((k) => sessionsNoti.has(k) || k in scelte);
  };

  // Regola unica (#675): una riga con un campo mai letto dal server lo dice
  // sempre, anche accanto a un fallimento; tace solo davanti a un esito riuscito o in corso.
  function mostraSessionsMsg(el) {
    const riga = righeSessions.find(([e]) => e === el);
    const esito = esitiSessions.get(el) || { testo: '', kind: null };
    const avvisa = Boolean(riga) && !notoSessions(...riga[1]) && (!esito.testo || esito.kind === 'err');
    el.textContent = avvisa ? [esito.testo, SESSIONS_NON_LETTO].filter(Boolean).join(' ') : esito.testo;
    el.classList.toggle('mg-ok', !avvisa && esito.kind === 'ok');
    el.classList.toggle('mg-err', avvisa || esito.kind === 'err');
  }

  function setSessionsMsg(el, text, kind, dopoLettura) {
    if (!el) return;
    if (dopoLettura === undefined) avvisiLettura.delete(el);
    else avvisiLettura.set(el, dopoLettura);
    esitiSessions.set(el, { testo: text || '', kind: kind || null });
    mostraSessionsMsg(el);
  }

  /** Solo i campi scritti da una richiesta: sono veri anche se il resto della risposta non lo è più. */
  function accogliCampiSessions(valori, scritti) {
    for (const k of scritti) {
      sessionsState[k] = valori[k];
      sessionsNoti.add(k);
      sessionsFermo[k] = ++sessionsTick;
    }
  }

  // Campi confermati da una scrittura arrivata dopo la partenza della richiesta `nato`.
  const fermiDopo = (nato) => RS.CHIAVI.filter((k) => (sessionsFermo[k] || 0) > nato);

  /** Un documento intero dal server: da qui in poi niente sullo schermo è «non letto». */
  function accogliSessions(raw, nato, scritti = []) {
    const doc = RS.leggiDoc(raw);
    if (nato < sessionsAccolto) return accogliCampiSessions(doc, scritti);
    sessionsAccolto = nato;
    for (const k of fermiDopo(nato)) doc[k] = sessionsState[k];
    sessionsState = doc;
    for (const k of RS.CHIAVI) sessionsNoti.add(k);
    accogliCampiSessions(doc, scritti);
    for (const [el, resta] of [...avvisiLettura]) setSessionsMsg(el, resta, 'ok');
  }

  function reflectSessions() {
    if (!RS) return;
    const vista = RS.leggiDoc(Object.assign({}, sessionsState, sceltePendenti()));
    const noto = notoSessions;
    if (mgMaxSessions && !maxInScrittura) mgMaxSessions.value = noto('maxSessions') ? String(vista.maxSessions) : '';
    for (const r of mgPriorityRadios) r.checked = noto('priorityAccount') && r.value === vista.priorityAccount;
    if (mgAccountA) mgAccountA.checked = !vista.accountAOff;
    if (mgAccountB) mgAccountB.checked = !vista.accountBOff;
    // Esclusi tutti e due non parte niente; escluso il solo prioritario si
    // lavora sull'altro. Due stati che a guardare gli interruttori non si
    // capiscono, quindi si scrivono.
    const resta = RS.prioritarioIgnorato(vista);
    if (mgAccountsWarn) mgAccountsWarn.hidden = !noto('accountAOff', 'accountBOff') || !RS.nessunAccount(vista);
    if (mgPriorityWarn) {
      mgPriorityWarn.hidden = !noto(...RS.CHIAVI) || !resta;
      if (resta) mgPriorityWarn.textContent = `L'account ${vista.priorityAccount} è escluso: le sessioni partono da ${resta}.`;
    }
    for (const [el] of righeSessions) if (el) mostraSessionsMsg(el);
  }

  function sessionsNonLette(nato) {
    const fermi = fermiDopo(nato);
    const tenuti = {};
    for (const k of fermi) tenuti[k] = sessionsState[k];
    sessionsState = RS.leggiDoc(tenuti);
    sessionsNoti.clear();
    for (const k of fermi) sessionsNoti.add(k);
    // L'esito di prima parlava di valori che adesso non sono più letti.
    for (const [el, chiavi] of righeSessions) if (el && !notoSessions(...chiavi)) setSessionsMsg(el, '', null);
    reflectSessions();
  }

  function loadSessions() {
    if (!RS) return Promise.resolve();
    const nato = ++sessionsTick;
    return (async () => {
      let r = null;
      try { r = await sendToMain({ type: SESSIONS_GET }); } catch (_) { /* come una lettura fallita */ }
      // Un documento più nuovo è già sullo schermo: questa lettura non ha niente da aggiungere.
      if (nato < sessionsAccolto) return;
      if (!r || !r.ok) return sessionsNonLette(nato);
      accogliSessions(r, nato);
      reflectSessions();
    })();
  }

  function saveSessions(patch, msgEl) {
    const esito = RS.valida(patch);
    if (!esito.ok) {
      setSessionsMsg(msgEl, esito.testo, 'err');
      return Promise.resolve(false);
    }
    if ('maxSessions' in esito.valori) maxInScrittura = false;
    const scelta = { valori: esito.valori, msgEl };
    sessionsInAttesa.push(scelta);
    // In coda dietro un'altra richiesta può aspettare: si vede che è partita.
    setSessionsMsg(msgEl, 'Salvo…', null);
    // «Salvato.» parla del valore che si vede: non se una scelta più nuova sulla
    // stessa riga è ancora per strada, né accanto a un numero riscritto dopo Salva.
    const confermaSessions = (testo, dopoLettura) => {
      if (sessionsInAttesa.some((s) => s.msgEl === msgEl)) return;
      if ('maxSessions' in esito.valori && mgMaxSessions && mgMaxSessions.value !== String(esito.valori.maxSessions)) return;
      setSessionsMsg(msgEl, testo, 'ok', dopoLettura);
    };
    const scritti = Object.keys(esito.valori);
    return inFila(`sessioni:${scritti.join(',')}`, async () => {
      const nato = ++sessionsTick;
      let r = null;
      let errore = null;
      try { r = await sendToMain(Object.assign({ type: SESSIONS_SET }, esito.valori)); } catch (err) { errore = err; }
      sessionsInAttesa.splice(sessionsInAttesa.indexOf(scelta), 1);
      if (!r || !r.ok) {
        // Non scritto = non cambiato: la pagina rimette quello che c'è sul
        // server invece di mostrare una scelta che non è mai arrivata.
        reflectSessions();
        setSessionsMsg(msgEl, 'Salvataggio fallito: l\'impostazione NON è cambiata.', 'err');
        const motivo = errore || r?.error;
        if (motivo) console.error('[manage] salvataggio sessioni:', motivo);
        return false;
      }
      if (r.letto === false) {
        // Scritto sì, riletto no: quello che è appena partito ora è noto, il
        // resto no. Rimettere i valori di partenza spegnerebbe una scelta salvata.
        accogliCampiSessions(esito.valori, scritti);
        reflectSessions();
        // Un documento partito dopo questa richiesta è già sullo schermo: il resto è letto.
        if (nato < sessionsAccolto) confermaSessions('Salvato.');
        else confermaSessions('Salvato. Il resto non l\'ho potuto rileggere dal server.', 'Salvato.');
        return true;
      }
      accogliSessions(r, nato, scritti);
      reflectSessions();
      confermaSessions('Salvato.');
      return true;
    });
  }

  if (mgMaxSessions) {
    // Un campo numerico che contiene qualcosa che numero non è risponde
    // `value === ''`: senza `badInput` si direbbe «vuoto» a chi ha scritto «tre».
    const letto = () => (mgMaxSessions.validity && mgMaxSessions.validity.badInput ? 'NaN' : mgMaxSessions.value);
    const salva = () => saveSessions({ maxSessions: letto() }, mgMaxSessionsMsg);
    if (mgMaxSessionsSave) mgMaxSessionsSave.addEventListener('click', salva);
    mgMaxSessions.addEventListener('input', () => {
      maxInScrittura = true;
      setSessionsMsg(mgMaxSessionsMsg, '', null);
    });
    mgMaxSessions.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || mgMaxSessions.disabled) return;
      e.preventDefault();
      salva();
    });
  }

  for (const radio of mgPriorityRadios) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      saveSessions({ priorityAccount: radio.value }, mgPriorityAccountMsg);
    });
  }

  for (const [el, campo] of [[mgAccountA, 'accountAOff'], [mgAccountB, 'accountBOff']]) {
    if (!el) continue;
    el.addEventListener('change', () => {
      // Acceso = in uso, quindi l'interruttore e il campo dicono l'opposto.
      saveSessions({ [campo]: !el.checked }, mgAccountsMsg);
    });
  }

  // ── Le pause in corso (#996) ───────────────────────────────────────────────
  // Sola lettura dal server: A, B o la routine server fermi dopo un'accensione rifiutata, col motivo. Nessun tetto
  // giornaliero: è la pausa a fermare un account, quindi si vede qui, accanto a chi la subisce.
  const PAUSE_GET = (window.SN_MSG?.MSG?.AUTOMATION_PAUSE_GET) || 'automation_pause_get';
  const mgAccountsPausa = document.getElementById('mgAccountsPausa');
  const mgServerPausa = document.getElementById('mgServerPausa');
  // null = non chiesto o non per te; { errore } = non letto; { pause, scartoMs } = letto (scarto: orologio locale − server).
  let pauseLette = null;
  let pauseTick = 0;
  let pauseTimer = null;

  function rigaPausa(classe, testo, dettaglio) {
    const p = document.createElement('p');
    p.className = classe;
    p.textContent = testo;
    if (dettaglio) p.title = dettaglio;
    return p;
  }

  function reflectPause() {
    if (!RS) return;
    clearTimeout(pauseTimer);
    const ora = Date.now();
    const righe = [];
    const righeServer = [];
    let prossima = Infinity;
    const leggi = (chi, voce) => {
      if (!voce || typeof voce !== 'object') return null;
      const v = Object.assign({}, voce, { finoMs: Number(voce.finoMs) + pauseLette.scartoMs });
      const p = RS.pausaInParole(chi, v, ora);
      if (p) prossima = Math.min(prossima, v.finoMs);
      return p;
    };
    if (pauseLette && pauseLette.errore) {
      righe.push(rigaPausa('mg-auto-block-desc', 'Non ho potuto leggere dal server se un account è in pausa.'));
    } else if (pauseLette) {
      for (const k of ['A', 'B']) {
        const p = leggi(`Account ${k}`, pauseLette.pause[k]);
        if (p) righe.push(rigaPausa('mg-auto-warn', p.testo, p.dettaglio));
      }
      // Una routine server per account (#1426): ognuna ha la sua pausa.
      for (const k of ['A', 'B']) {
        const p = leggi(`La routine server dell'account ${k}`, pauseLette.pause[`server${k}`]);
        if (p) righeServer.push(rigaPausa('mg-auto-warn', p.testo, p.dettaglio));
      }
    }
    if (mgAccountsPausa) {
      mgAccountsPausa.replaceChildren(...righe);
      mgAccountsPausa.hidden = righe.length === 0;
    }
    if (mgServerPausa) {
      mgServerPausa.replaceChildren(...righeServer);
      mgServerPausa.hidden = righeServer.length === 0;
    }
    // Una pausa che scade sparisce da sola, senza ricaricare la pagina.
    if (prossima < Infinity) pauseTimer = setTimeout(reflectPause, Math.min(Math.max(0, prossima - ora) + 1000, 2 ** 31 - 1));
  }

  function loadPause() {
    const nato = ++pauseTick;
    return (async () => {
      let r = null;
      try { r = await sendToMain({ type: PAUSE_GET }); } catch (_) { /* come una lettura fallita */ }
      if (nato !== pauseTick) return;
      if (r && (r.code === 'forbidden' || r.code === 'not_admin')) pauseLette = null;
      else if (!r || !r.ok) {
        pauseLette = { errore: true };
        if (r && r.error) console.error('[manage] pause delle routine:', r.error);
      } else {
        const oraServer = Number(r.oraMs);
        pauseLette = {
          pause: r.pause && typeof r.pause === 'object' ? r.pause : {},
          scartoMs: Number.isFinite(oraServer) && oraServer > 0 ? Date.now() - oraServer : 0,
        };
      }
      reflectPause();
    })();
  }

  // A ogni apertura di Automazioni: una pausa nasce e scade mentre la pagina resta aperta.
  document.addEventListener('mg-scheda', (e) => {
    if (e.detail.tab === 'automation') loadPause();
  });

  // ── Modello e sforzo per fase (config/routines.roleModels, #1193) ──────────
  // Ogni tendina salva la sua sola foglia appena cambia. Stesse regole delle sessioni qui sopra: mai un valore
  // non letto sullo schermo, e una risposta partita prima non riscrive una scelta confermata dopo (#675).
  const ROLE_GET = (window.SN_MSG?.MSG?.AUTOMATION_ROLE_MODELS_GET) || 'automation_role_models_get';
  const ROLE_SET = (window.SN_MSG?.MSG?.AUTOMATION_ROLE_MODELS_SET) || 'automation_role_models_set';
  const RM = window.SN_ROUTINE_MODELLI;
  const roleState = {};
  const roleNoti = new Set();
  const roleFermo = {};
  const roleInAttesa = [];
  let roleTick = 0;
  let roleAccolto = 0;
  // Prima della prima risposta la pagina non sa ancora niente, e non è il caso di dire «non letto».
  let roleTentato = false;
  let roleEsito = { testo: '', kind: null };

  function buildRoleModels() {
    if (!mgRoleModels || !RM) return;
    const cella = (cls, testo) => {
      const s = document.createElement('span');
      s.className = cls;
      s.textContent = testo;
      return s;
    };
    mgRoleModels.append(...RM.CAMPI.map((c) => cella('mg-role-head', RM.NOME_CAMPO[c])));
    for (const r of RM.RUOLI) {
      mgRoleModels.append(cella('mg-role-name', r.nome));
      for (const campo of RM.CAMPI) {
        const sel = document.createElement('select');
        sel.dataset.ruolo = r.id;
        sel.dataset.campo = campo;
        sel.setAttribute('aria-label', `${RM.NOME_CAMPO[campo]}: ${r.nome}`);
        sel.append(new Option(RM.VUOTO, ''));
        for (const s of RM.SCELTE[campo]) sel.append(new Option(s.nome, s.id));
        sel.disabled = !isAdmin;
        sel.addEventListener('change', () => saveRoleModel(r.id, campo, sel.value));
        mgRoleModels.append(sel);
        // Non letto finché il server non risponde: la prima voce sarebbe già una risposta.
        sel.selectedIndex = -1;
        roleSelects.set(`${r.id}.${campo}`, sel);
      }
    }
  }

  const roleScelta = (chiave) => {
    for (let i = roleInAttesa.length - 1; i >= 0; i--) if (roleInAttesa[i].chiave === chiave) return roleInAttesa[i].valore;
    return roleNoti.has(chiave) ? roleState[chiave] : null;
  };

  function mostraRoleMsg() {
    if (!mgRoleModelsMsg) return;
    const ignoti = roleTentato && [...roleSelects.keys()].some((k) => roleScelta(k) === null);
    const avvisa = ignoti && (!roleEsito.testo || roleEsito.kind === 'err');
    mgRoleModelsMsg.textContent = avvisa ? [roleEsito.testo, SESSIONS_NON_LETTO].filter(Boolean).join(' ') : roleEsito.testo;
    mgRoleModelsMsg.classList.toggle('mg-ok', !avvisa && roleEsito.kind === 'ok');
    mgRoleModelsMsg.classList.toggle('mg-err', avvisa || roleEsito.kind === 'err');
  }

  function setRoleMsg(testo, kind) {
    roleEsito = { testo: testo || '', kind: kind || null };
    mostraRoleMsg();
  }

  function reflectRoleModels() {
    for (const [chiave, sel] of roleSelects) {
      const v = roleScelta(chiave);
      for (const o of [...sel.options]) if (o.dataset.fuori && o.value !== v) o.remove();
      // Non letto: nessuna voce scelta, nemmeno «definizione dell'agente», che sarebbe già una risposta.
      if (v === null) { sel.selectedIndex = -1; continue; }
      if (![...sel.options].some((o) => o.value === v)) {
        // Scritto a mano nel documento: si mostra com'è, e non si può riscegliere.
        const o = new Option(`${v} (fuori elenco)`, v);
        o.dataset.fuori = '1';
        o.disabled = true;
        sel.append(o);
      }
      sel.value = v;
    }
    mostraRoleMsg();
  }

  /** Una tabella intera dal server: vale se nessuna lettura partita dopo è già sullo schermo. */
  function accogliRuoli(tabella, nato) {
    if (nato < roleAccolto) return;
    roleAccolto = nato;
    const doc = RM.leggiDoc({ [RM.CAMPO]: tabella });
    for (const r of RM.RUOLI) {
      for (const campo of RM.CAMPI) {
        const k = `${r.id}.${campo}`;
        // Confermato da una scrittura arrivata dopo la partenza di questa lettura, che può averlo letto prima.
        if ((roleFermo[k] || 0) > nato) continue;
        roleState[k] = doc[r.id][campo];
        roleNoti.add(k);
      }
    }
  }

  function loadRoleModels() {
    if (!RM) return Promise.resolve();
    const nato = ++roleTick;
    return (async () => {
      let r = null;
      try { r = await sendToMain({ type: ROLE_GET }); } catch (_) { /* come una lettura fallita */ }
      if (nato < roleAccolto) return;
      roleTentato = true;
      if (r && r.ok) {
        accogliRuoli(r.roleModels, nato);
      } else {
        // Restano note solo le foglie confermate da una scrittura arrivata dopo la partenza di questa lettura.
        for (const k of [...roleNoti]) if ((roleFermo[k] || 0) <= nato) roleNoti.delete(k);
        if (roleEsito.kind === 'ok') roleEsito = { testo: '', kind: null };
      }
      reflectRoleModels();
    })();
  }

  function saveRoleModel(ruolo, campo, valore) {
    const esito = RM.valida({ ruolo, campo, valore });
    if (!esito.ok) {
      reflectRoleModels();
      setRoleMsg(esito.testo, 'err');
      return Promise.resolve(false);
    }
    const chiave = `${ruolo}.${campo}`;
    const scelta = { chiave, valore };
    roleInAttesa.push(scelta);
    setRoleMsg('Salvo…', null);
    const nome = RM.nomeRuolo(ruolo);
    // Una fila sola per tutte le tendine: le risposte arrivano nell'ordine delle scelte.
    return inFila('roleModels', async () => {
      const nato = ++roleTick;
      let r = null;
      let errore = null;
      try { r = await sendToMain({ type: ROLE_SET, ruolo, campo, valore }); } catch (err) { errore = err; }
      roleInAttesa.splice(roleInAttesa.indexOf(scelta), 1);
      if (!r || !r.ok) {
        reflectRoleModels();
        setRoleMsg(`${nome}: salvataggio fallito, la scelta NON è cambiata.`, 'err');
        const motivo = errore || r?.error;
        if (motivo) console.error('[manage] salvataggio modello per fase:', motivo);
        return false;
      }
      roleState[chiave] = valore;
      roleNoti.add(chiave);
      roleFermo[chiave] = ++roleTick;
      if (r.letto && r.roleModels) accogliRuoli(r.roleModels, nato);
      reflectRoleModels();
      // «Salvato» parla di quello che si vede: non mentre un'altra scelta è ancora per strada.
      if (!roleInAttesa.length) {
        setRoleMsg(r.letto ? `${nome}: salvato.` : `${nome}: salvato. Il resto non l'ho potuto rileggere dal server.`, 'ok');
      }
      return true;
    });
  }

  buildRoleModels();


  // Timeout dei giudici. Fonte: config/supportModels (`judgeTimeoutMs`, in MS), letto dal
  // backend a ogni chiamata; la UI lavora in SECONDI (PATCH per-campo: non tocca i modelli).
  const JT_DEF = AUTOMATION.JUDGE_TIMEOUT_DEFAULT_S || 60;
  const JT_MIN = AUTOMATION.JUDGE_TIMEOUT_MIN_S || 10;
  const JT_MAX = AUTOMATION.JUDGE_TIMEOUT_MAX_S || 300;
  // I limiti del campo vengono dal registro, non dall'HTML: scritti in due posti, alzare il tetto
  // in uno solo lascia il campo a rifiutare il valore nuovo.
  if (mgJudgeTimeout) {
    mgJudgeTimeout.min = String(JT_MIN);
    mgJudgeTimeout.max = String(JT_MAX);
  }
  for (const f of Object.values(CAP_FIELDS)) {
    if (!f.input) continue;
    f.input.min = String(Number.isFinite(f.min) ? f.min : AUTOMATION.CAP_MIN);
    f.input.max = String(AUTOMATION.CAP_MAX);
  }
  function clampJudgeTimeoutS(n) {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v)) return JT_DEF;
    return Math.min(JT_MAX, Math.max(JT_MIN, v));
  }
  function setJudgeTimeoutMsg(text, kind) {
    if (!mgJudgeTimeoutMsg) return;
    mgJudgeTimeoutMsg.textContent = text || '';
    mgJudgeTimeoutMsg.classList.toggle('mg-ok', kind === 'ok');
    mgJudgeTimeoutMsg.classList.toggle('mg-err', kind === 'err');
  }
  async function loadJudgeTimeout() {
    if (!mgJudgeTimeout) return;
    let seconds = JT_DEF;
    try {
      const r = await sendToMain({ type: 'support_models_get' });
      const ms = r && r.ok !== false && r.models ? r.models.judgeTimeoutMs : null;
      if (ms != null && Number.isFinite(Number(ms))) seconds = clampJudgeTimeoutS(Number(ms) / 1000);
    } catch (_) { /* offline → resta il default */ }
    mgJudgeTimeout.value = String(seconds);
  }
  async function saveJudgeTimeout() {
    if (!mgJudgeTimeout) return;
    const seconds = clampJudgeTimeoutS(mgJudgeTimeout.value);
    mgJudgeTimeout.value = String(seconds); // normalizza i fuori-range
    try {
      const r = await sendToMain({ type: 'support_models_update', judgeTimeoutMs: seconds * 1000 });
      if (!r || r.ok === false) { setJudgeTimeoutMsg('Salvataggio fallito.', 'err'); return; }
      const savedMs = r.models && r.models.judgeTimeoutMs;
      if (savedMs != null && Number.isFinite(Number(savedMs))) {
        mgJudgeTimeout.value = String(clampJudgeTimeoutS(Number(savedMs) / 1000));
      }
      setJudgeTimeoutMsg('Salvato.', 'ok');
    } catch (err) {
      setJudgeTimeoutMsg('Salvataggio fallito.', 'err');
      console.error('[manage] salvataggio timeout giudici fallito:', err);
    }
  }
  if (mgJudgeTimeoutSave) mgJudgeTimeoutSave.addEventListener('click', saveJudgeTimeout);
  if (mgJudgeTimeout) mgJudgeTimeout.addEventListener('input', () => setJudgeTimeoutMsg('', null));

  // Tetto di spesa e lunghezza dei giudici per i non fidati (#1515). Regole in SN_SPESA_GIUDICI, comportamento del
  // campo (Invio, uscita dal campo, «Rimetti com'era») in SN_CAMPO_NUMERO; la spesa di oggi la scrive solo il server.
  const JUDGE_BUDGET_GET = (window.SN_MSG?.MSG?.AUTOMATION_JUDGE_BUDGET_GET) || 'automation_judge_budget_get';
  const JUDGE_BUDGET_SET = (window.SN_MSG?.MSG?.AUTOMATION_JUDGE_BUDGET_SET) || 'automation_judge_budget_set';
  const SG = window.SN_SPESA_GIUDICI;
  const giudiciCampi = new Map();
  let giudiciLetto = null; // l'ultima risposta del main: { tettoUsd, maxCaratteri, spesa, oraMs }

  function mostraSpesaGiudici() {
    const box = document.getElementById('mgJudgeSpesa');
    if (!box || !SG) return;
    const r = giudiciLetto;
    const riga = SG.rigaSpesa(r ? r.spesa : null, r ? r.tettoUsd : null, (r && r.oraMs) || Date.now());
    const nota = document.getElementById('mgJudgeSpesaNota');
    const barra = document.getElementById('mgJudgeSpesaBarra');
    document.getElementById('mgJudgeSpesaTesto').textContent = riga.testo;
    box.title = riga.dettaglio;
    box.classList.toggle('is-pieno', riga.pieno);
    // Il motivo si legge senza hover quando cambia qualcosa per l'owner: tetto pieno o spesa ignota.
    nota.textContent = riga.pieno || riga.quota === null ? riga.dettaglio : '';
    nota.hidden = !nota.textContent;
    barra.hidden = riga.quota === null;
    document.getElementById('mgJudgeSpesaQuota').style.width = `${Math.round((riga.quota || 0) * 100)}%`;
  }

  async function salvaGiudici(chiave, valore) {
    const r = await sendToMain({ type: JUDGE_BUDGET_SET, [chiave]: valore });
    if (!r || r.ok === false) return { ok: false, errore: String((r && r.error) || 'il server non ha risposto').replace(/\.\s*$/, '') };
    giudiciLetto = r.letto === false ? Object.assign({}, giudiciLetto, r) : r;
    mostraSpesaGiudici();
    return { ok: true, valore: r[chiave] };
  }

  if (SG && window.SN_CAMPO_NUMERO) {
    for (const [chiave, [input, salvaBtn, rimetti, msg]] of Object.entries(mgJudgeCampi)) {
      if (!input) continue;
      const regole = chiave === 'tettoUsd' ? SG.REGOLE_CAMPO.tetto : SG.REGOLE_CAMPO.caratteri;
      giudiciCampi.set(chiave, window.SN_CAMPO_NUMERO.collega({
        input, salvaBtn, rimetti, msg, regole, salva: (valore) => salvaGiudici(chiave, valore),
      }));
    }
  }

  async function loadJudgeBudget() {
    let r = null;
    try { r = await sendToMain({ type: JUDGE_BUDGET_GET }); } catch (_) { r = null; }
    giudiciLetto = r && r.ok !== false ? r : null;
    mostraSpesaGiudici();
    for (const [chiave, campo] of giudiciCampi) {
      // Un numero scritto e non ancora partito resta sotto le dita di chi lo scrive.
      if (!campo.stato().pulito) continue;
      if (giudiciLetto) campo.mostra(giudiciLetto[chiave], { daCapo: true });
      else campo.dillo(`Non letto: ${String((r && r.error) || 'il server non ha risposto').replace(/\.\s*$/, '')}.`, 'is-error');
    }
  }

  // Tab «Log»: gli ultimi worker spawnati. Fonte config/automation.workerLog, scritto dal
  // server al rilascio di ogni biglietto; sola lettura via main (owner-gated).
  const WORKER_LOG_GET = (window.SN_MSG?.MSG?.WORKER_LOG_GET) || 'worker_log_get';
  // Etichette amichevoli per i ruoli del dispatcher (mai l'id grezzo).
  const ROLE_LABELS = {
    'new-work': 'Nuovo lavoro',
    verifier:   'Verifica',
    fixer:      'Correzione',
    secaudit:   'Audit sicurezza',
    risposta:   'Gestisci la risposta',
    prober:     'Esplorazione',
    idle:       'Fermo',
    off:        'Routine spente',
  };
  function roleLabel(role) {
    const r = String(role || '').trim();
    return ROLE_LABELS[r] || (r || 'Sconosciuto');
  }
  let logLoaded  = false;   // true dopo il primo caricamento riuscito
  let logLoading = false;

  // Tempo trascorso «umano»: uno spawn recente si misura in minuti, non in «oggi».
  function timeAgo(iso) {
    if (!iso) return '—';
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '—';
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 45) return 'adesso';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min fa`;
    const h = Math.round(m / 60);
    if (h < 24) return h === 1 ? '1 ora fa' : `${h} ore fa`;
    const d = Math.round(h / 24);
    return d === 1 ? 'ieri' : `${d} giorni fa`;
  }
  function formatDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function setLogView(which) {
    // which ∈ 'loading' | 'denied' | 'empty' | 'list'
    if (mgLogLoading) mgLogLoading.hidden = which !== 'loading';
    if (mgLogDenied)  mgLogDenied.hidden  = which !== 'denied';
    if (mgLogEmpty)   mgLogEmpty.hidden   = which !== 'empty';
    if (mgLogList)    mgLogList.hidden     = which !== 'list';
  }

  function renderWorkerLog(entries) {
    if (!mgLogList) return;
    const list = Array.isArray(entries) ? entries : [];
    if (!list.length) { setLogView('empty'); mgLogList.innerHTML = ''; return; }
    mgLogList.innerHTML = list.map((e) => {
      const role = roleLabel(e && e.role);
      const num  = e && e.num ? ` · #${esc(String(e.num))}` : '';
      const rel  = timeAgo(e && e.startedAt);
      const abs  = formatDateTime(e && e.startedAt);
      return `<li class="mg-log-row" title="${esc(abs)}">`
        + `<span class="mg-log-role">${esc(role)}</span>`
        + `<span class="mg-log-when">${esc(rel)}${num}</span>`
        + (abs ? `<span class="mg-log-abs">${esc(abs)}</span>` : '')
        + `</li>`;
    }).join('');
    setLogView('list');
  }

  async function loadWorkerLog() {
    if (logLoading) return;
    logLoading = true;
    if (!isAdmin) { setLogView('denied'); logLoading = false; return; }
    setLogView('loading');
    try {
      const r = await sendToMain({ type: WORKER_LOG_GET });
      if (!r || r.ok === false) {
        // Non-admin o sessione scaduta lato main → sezione riservata.
        setLogView('denied');
        logLoading = false;
        return;
      }
      renderWorkerLog(r.entries || []);
      logLoaded = true;
    } catch (err) {
      console.error('[manage] caricamento log worker fallito:', err);
      setLogView('empty');
    }
    loadChannelLog();
    logLoading = false;
  }

  // Canale autenticato delle routine: rifiuti e confronti vivono in collezioni che nessun
  // client legge, si passa dalla callable owner-only. Registri vuoti → blocco nascosto.
  const ROUTINE_LOG_GET = (window.SN_MSG?.MSG?.ROUTINE_LOG_GET) || 'routine_log_get';
  const MERGE_APPROVALS_GET = (window.SN_MSG?.MSG?.MERGE_APPROVALS_GET) || 'merge_approvals_get';
  const FIDUCIA_SEGNA = (window.SN_MSG?.MSG?.FIDUCIA_SEGNA) || 'fiducia_segna';
  const MERGE_APPROVAL_APPROVE = (window.SN_MSG?.MSG?.MERGE_APPROVAL_APPROVE) || 'merge_approval_approve';
  const MERGE_APPROVAL_DISCARD = (window.SN_MSG?.MSG?.MERGE_APPROVAL_DISCARD) || 'merge_approval_discard';
  const MERGE_APPROVALS_CHANGED = (window.SN_MSG?.MSG?.MERGE_APPROVALS_CHANGED) || 'merge_approvals_changed';
  const LIVELLO4_SALTA = (window.SN_MSG?.MSG?.LIVELLO4_SALTA) || 'livello4_salta';
  const FEEDBACK_SENDER_FLAG = (window.SN_MSG?.MSG?.FEEDBACK_SENDER_FLAG) || 'feedback_sender_flag';

  // Perché una richiesta è stata respinta, detto all'owner e non al codice.
  const DENY_LABELS = {
    bad_passphrase: 'parola d’ordine non valida o revocata',
    bad_ticket: 'biglietto inesistente',
    dead_ticket: 'biglietto scaduto o già rilasciato',
    role_forbids: 'azione fuori dal ruolo',
    branch_mismatch: 'ramo diverso da quello assegnato',
    illegal_transition: 'passaggio di stato non permesso',
    rate_limited: 'troppe richieste',
    malformed: 'richiesta non interpretabile',
    routines_off: 'routine spente',
    l5_blocked: 'fusione fermata dai controlli di sicurezza',
  };
  // Il numero del feedback viene subito dopo il motivo: da qui si deve leggere chi è fermo (#1653).
  const numDiRifiuto = (r) => { const n = String((r && r.num) || '').trim().replace(/^#+/, ''); return n ? ` · #${n}` : ''; };

  // Le richieste di fusione senza gli unit sul risultato (#958): una per una, e in cima un avviso quando il server
  // le giudica frequenti. Una prova che manca sempre non protegge niente, e nessuno se ne accorgerebbe.
  function righeSenzaProva(prove) {
    const righe = Array.isArray(prove && prove.righe) ? prove.righe : [];
    return righe.filter((p) => p && (p.esito === 'non_provata' || p.esito === 'assente')).map((p) => {
      const s = p.storia || {};
      const clone = s.superficiale ? (s.intera ? ' · clone poco profondo, storia scaricata tutta' : ' · clone poco profondo') : '';
      return {
        at: p.at,
        kind: 'noprova',
        label: 'Senza prova',
        text: `${p.via === 'locale' ? 'fusione locale' : 'routine'}${p.slug ? ` ${p.slug}` : ''}${p.branch ? ` · ${p.branch}` : ''}`
          + ` · ${p.esito === 'assente' ? 'strumenti senza la prova degli unit' : (p.motivo || 'prova non riuscita')}${clone}`,
      };
    });
  }

  function avvisoSenzaProva(prove) {
    const r = prove && prove.riepilogo;
    if (!r || !r.frequente) return '';
    return `<li class="mg-log-row mg-log-row--avviso">`
      + `<span class="mg-log-role mg-log-role--deny">Senza prova</span>`
      + `<span class="mg-log-when">${esc(`${r.senzaProva} delle ultime ${r.ultime} richieste di fusione sono partite senza gli unit sul risultato`)}</span>`
      + `</li>`;
  }

  function renderChannelLog(rejections, comparisons, prove = null) {
    if (!mgChannelSection || !mgChannelList) return;
    const rows = righeSenzaProva(prove);
    for (const r of (Array.isArray(rejections) ? rejections : [])) {
      rows.push({
        at: r && r.at,
        kind: 'deny',
        label: 'Respinto',
        text: `${DENY_LABELS[String(r && r.reason)] || String((r && r.reason) || '—')}`
          + `${r && r.slug ? ` · ${r.slug}` : ''}${r && r.action ? ` · ${r.action}` : ''}`,
      });
    }
    for (const c of (Array.isArray(comparisons) ? comparisons : [])) {
      const git = (c && c.git) || {};
      const srv = (c && c.server) || {};
      rows.push({
        at: c && c.at,
        kind: 'cmp',
        label: c && c.same ? 'Accordo' : 'Scelte diverse',
        text: c && c.same
          ? `${roleLabel(git.role)}${git.num ? ` · ${git.num}` : ''}`
          : `routine: ${roleLabel(git.role)}${git.num ? ` ${git.num}` : ''}`
            + ` — server: ${roleLabel(srv.role)}${srv.num ? ` ${srv.num}` : ''}`
            + (c && c.serverBlindToBranchState ? ' (il server non vede ancora lo stato dei rami)' : ''),
      });
    }
    if (!rows.length) {
      mgChannelSection.hidden = false;
      if (mgChannelEmpty) mgChannelEmpty.hidden = false;
      mgChannelList.hidden = true;
      mgChannelList.innerHTML = '';
      return;
    }
    rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    mgChannelList.innerHTML = avvisoSenzaProva(prove) + rows.slice(0, 60).map((row) => {
      const abs = formatDateTime(row.at);
      const cls = row.kind === 'deny' ? ' mg-log-role--deny' : '';
      return `<li class="mg-log-row" title="${esc(abs)}">`
        + `<span class="mg-log-role${cls}">${esc(row.label)}</span>`
        + `<span class="mg-log-when">${esc(row.text)}</span>`
        + (abs ? `<span class="mg-log-abs">${esc(timeAgo(row.at))}</span>` : '')
        + `</li>`;
    }).join('');
    if (mgChannelEmpty) mgChannelEmpty.hidden = true;
    mgChannelList.hidden = false;
    mgChannelSection.hidden = false;
  }

  // ── Fusioni in attesa del via libera (SPEC-RIDISEGNO-MAX.md §10) ─────────
  //
  // UNA FUSIONE FERMA È UNA SEGNALAZIONE COL QUADRATO ROSSO (contratto
  // 2026-09-13). Prima viveva in un riquadro suo, in cima ai Ricevuti: due
  // posti per la stessa pratica — la scheda del feedback da una parte, il ramo
  // che ne è uscito dall'altra — e nessuno dei due diceva dell'altro. Adesso
  // la richiesta si apre dal quadrato della scheda, coi tasti Approva/Scarta
  // di sempre (il disegno resta del modulo condiviso, src/shared/mergeApprovals.js).
  //
  // Restano fuori le richieste che non nascono da una segnalazione — un ramo
  // locale chiuso con `npm run finish`, che un numero non ce l'ha: non hanno
  // una scheda dove vivere, e finiscono in Automazioni con gli stessi tasti.
  // Nasconderle sarebbe un ramo fermo per sempre senza dirlo.
  //
  // Le decisioni già prese restano elencate nel Log: un'eccezione ai controlli
  // di sicurezza deve lasciare una traccia che si può guardare. In Automazioni
  // costringevano a scorrere prima delle impostazioni (#1110).
  const mgMergeApprovalsOrphans = document.getElementById('mgMergeApprovalsOrphans');
  const mgMergeApprovalsRecent = document.getElementById('mgMergeApprovalsRecent');
  const mgMergeApprovalsPreapproved = document.getElementById('mgMergeApprovalsPreapproved');
  const mgFusioniSection = document.getElementById('mgFusioniSection');
  const mgFusioniEmpty = document.getElementById('mgFusioniEmpty');

  // La colonna delle fusioni decise si mostra solo con un elenco letto davvero:
  // prima, o a lettura fallita, un «nessuna» sarebbe un dato inventato.
  function aggiornaSezioneFusioni(letto) {
    if (!mgFusioniSection) return;
    mgFusioniSection.hidden = !letto;
    if (!mgFusioniEmpty) return;
    const vuota = [mgMergeApprovalsRecent, mgMergeApprovalsPreapproved].every((el) => !el || el.hidden);
    mgFusioniEmpty.hidden = !vuota;
  }

  // Gli elenchi del server come sono arrivati: quadrati e bordi li leggono da qui, così una
  // scheda aperta ridisegna senza rileggere.
  let fusioni = { pending: [], failed: [], recent: [], preapproved: [] };
  let fusioniLette = false;
  let fusioniOk = false;      // l'ultima lettura delle fusioni è riuscita: senza, Routine non dice numeri
  // L'esito di quel tentativo, per richiesta: il riquadro in basso e la riga
  // del dettaglio sono un posto solo, e chi arriva dopo cancella chi c'era.
  const esitiTentati = new Map();
  // Al più un'approvazione in volo per richiesta: tasto, segno e segno da fuori aspettano la
  // stessa, e una card disegnata nel frattempo la mostra coi tasti spenti (#702).
  const approvazioniInVolo = new Map();
  const IN_VOLO = { kind: 'wait', text: 'Fusione già in corso: il server ci sta lavorando…' };
  function approvaUnaVolta(req, attesa) {
    const gia = approvazioniInVolo.get(req.id);
    if (gia) return gia.risposta;
    const UI = window.SN_MERGE_APPROVALS;
    const risposta = Promise.resolve()
      .then(() => sendToMain({ type: MERGE_APPROVAL_APPROVE, id: req.id }))
      .catch((e) => ({ ok: false, error: e?.message || String(e) }));
    approvazioniInVolo.set(req.id, { risposta, attesa });
    // Registrata per prima: chi aspetta la stessa risposta trova già l'esito al suo posto.
    risposta.then((reply) => {
      approvazioniInVolo.delete(req.id);
      if (UI) esitiTentati.set(req.id, UI.outcomeMessage(reply, req));
      statoFusioniCambiato();
    });
    if (UI) UI.seguiSulPosto(document, req.id, { risposta, attesa });
    statoFusioniCambiato();
    return risposta;
  }

  // Dove sta una richiesta ferma, per le frasi che dicono se aspetta l'owner: in volo, già
  // decisa (fusa, scartata, sostituita) in attesa della rilettura, o ferma davvero (null).
  function statoRichiesta(req) {
    if (!req) return null;
    if (approvazioniInVolo.has(req.id)) return 'volo';
    const esito = esitiTentati.get(req.id);
    return esito && (esito.kind === 'ok' || esito.reload) ? 'decisa' : null;
  }
  function opzioniLivelli(fb) {
    return { fusioni, fusioniLette: fusioniOk, dettaglioLetto: !FB.soloLista(fb), statoRichiesta };
  }
  // Una richiesta che parte, arriva o viene decisa cambia le frasi della lista e del quadrato.
  function statoFusioniCambiato() {
    if (dataLoaded) ridisegnaListaAlSuoPosto();
    aggiornaTestoQuadrato();
  }

  // Dal numero sull'etichetta al feedback vero: la scheda è già in questa dashboard, quindi
  // «guarda cosa era stato chiesto» è un click, non una ricerca. Se non è in lista, nulla.
  function openFeedbackByNum(num) {
    const cerca = String(num || '').trim();
    if (!cerca || !FB || typeof FB.formatNum !== 'function') return;
    apriFeedback(allFeedbacks.find((f) => FB.formatNum(f.seq, f.subSeq) === cerca));
  }

  // Un feedback nominato da un'altra scheda (Domande, Compiti) si apre nella sua.
  function apriFeedback(fb) {
    if (!fb) return false;
    // Aprire una pratica precisa spegne il filtro dei livelli se la nasconderebbe.
    mostraNelFiltro(fb);
    // Senza sezioni non c'è una sezione in cui saltare: la lista è una sola e
    // la segnalazione è già lì.
    if (sezioniAttendibili()) selectTab(MR.manageTabFor(fb, opzSezioni()));
    // Dal Log o da Automazioni il dettaglio sta in un pannello che non è a schermo.
    else if (!LIST_TABS.includes(schedaAttiva())) selectTab(currentTab);
    openDetail(fb._id);
    return true;
  }

  // `already` è l'elenco già pronto quando ad avvisare è il main: una pagina aperta deve
  // accorgersi di una richiesta nuova. Le opzioni sono del modulo condiviso: stesso esito.
  function opzioniFusioni(extra) {
    const UI = window.SN_MERGE_APPROVALS;
    return Object.assign({
      onDone: () => { setTimeout(loadMergeApprovals, 1200); },
      esitoIniziale: (req) => esitiTentati.get(req.id) || null,
      inVolo: (req) => approvazioniInVolo.get(req.id) || null,
      // L'esito resta scritto anche se la card si ridisegna appena la conferma è finita.
      onApprove: (req) => approvaUnaVolta(req, null),
      onDiscard: (req) => decidiFusione(MERGE_APPROVAL_DISCARD, req),
      onFeedback: (req) => openFeedbackByNum(UI ? UI.feedbackNum(req) : ''),
    }, extra || {});
  }

  // Uno scarto in volo è una decisione già presa: il segno arrivato intanto non la fonde.
  const scartiInVolo = new Set();
  async function decidiFusione(type, req) {
    const UI = window.SN_MERGE_APPROVALS;
    scartiInVolo.add(req.id);
    let reply;
    try { reply = await sendToMain({ type, id: req.id }); } finally { scartiInVolo.delete(req.id); }
    if (UI) esitiTentati.set(req.id, UI.outcomeMessage(reply, req));
    statoFusioniCambiato();
    return reply;
  }

  // Il segno manda a fondere solo ciò che aspetta davvero: in volo o già decisa da qui, il
  // server la rifiuterebbe e la pagina direbbe un esito falso (#702).
  function daDecidere(req) {
    return !scartiInVolo.has(req.id) && statoRichiesta(req) !== 'decisa';
  }

  // I ridisegni automatici del pannello aspettano che una conferma a metà finisca (#550).
  function quandoPannelloLibero(fn) {
    const UI = window.SN_MERGE_APPROVALS;
    if (UI && mgSideBody) UI.quandoLibera(mgSideBody, fn);
    else fn();
  }

  // Le richieste ferme che NON hanno una scheda in questa lista. Finché i
  // feedback non sono arrivati la lista è vuota e ci finiscono tutte: meglio
  // mostrarle due volte per un istante che perderne una.
  function fusioniOrfane() {
    const ferme = (fusioni.pending || []).concat(fusioni.failed || []);
    return MR.fusioniSenzaFeedback(ferme, allFeedbacks);
  }

  function renderFusioniOrfane() {
    const UI = window.SN_MERGE_APPROVALS;
    if (!mgMergeApprovalsOrphans || !UI) return 0;
    const orfane = fusioniOrfane();
    const inAttesa = orfane.filter((r) => !r.used);
    const fallite = orfane.filter((r) => r.used);
    return UI.render(mgMergeApprovalsOrphans, opzioniFusioni({
      requests: inAttesa, failed: fallite,
    }));
  }

  async function loadMergeApprovals(already) {
    const UI = window.SN_MERGE_APPROVALS;
    if (!UI) return 0;
    const spegni = () => {
      fusioni = { pending: [], failed: [], recent: [], preapproved: [] };
      fusioniOk = false;
      if (mgMergeApprovalsOrphans) {
        mgMergeApprovalsOrphans.replaceChildren();
        mgMergeApprovalsOrphans.hidden = true;
      }
      if (mgMergeApprovalsRecent) {
        mgMergeApprovalsRecent.replaceChildren();
        mgMergeApprovalsRecent.hidden = true;
      }
      if (mgMergeApprovalsPreapproved) {
        mgMergeApprovalsPreapproved.replaceChildren();
        mgMergeApprovalsPreapproved.hidden = true;
      }
      aggiornaSezioneFusioni(false);
      riflettiFusioni();
      return 0;
    };
    if (!isAdmin) return spegni();
    let r = already || null;
    try {
      if (!r) r = await sendToMain({ type: MERGE_APPROVALS_GET });
    } catch (err) {
      console.error('[manage] fusioni in attesa:', err);
      return spegni();
    }
    if (!r || r.ok === false) return spegni();
    // Una richiesta nuova sposta la pratica nei Ricevuti: quello è un arrivo come un cambio di stato.
    // Non alla prima lettura, dove niente è «arrivato» mentre la pagina era aperta.
    const primaDelleFusioni = fusioniLette ? live.fotoSezioni() : null;
    fusioni = LIVE.fusioniDa(r, fusioni);
    fusioniLette = true;
    fusioniOk = true;
    if (primaDelleFusioni && dataLoaded) segnaArrivi(primaDelleFusioni, allFeedbacks);
    // Una richiesta che non c'è più non ha un esito da raccontare.
    const vive = new Set(fusioni.pending.concat(fusioni.failed).map((req) => req.id));
    for (const id of Array.from(esitiTentati.keys())) if (!vive.has(id)) esitiTentati.delete(id);
    const n = renderFusioniOrfane();
    // Una richiesta nuova deve vedersi subito, senza riaprire la pagina.
    riflettiFusioni();
    updateSezioniCounts();
    UI.renderRecent(mgMergeApprovalsRecent, { recent: r.recent || [] });
    // Le fuse senza chiedere: il controllo a posteriori del lavoro fidato e dei rami di prima. Quando il main avvisa
    // di un cambiamento manda solo l'elenco in attesa: quello che c'era resta finché non si rilegge.
    if (mgMergeApprovalsPreapproved && (Array.isArray(r.preapproved) || !already)) {
      UI.renderPreapproved(mgMergeApprovalsPreapproved, {
        preapproved: r.preapproved || [],
        preapprovedTotal: r.preapprovedTotal,
        onFeedback: (req) => openFeedbackByNum(UI.feedbackNum(req)),
      });
    }
    aggiornaSezioneFusioni(true);
    return n;
  }

  // Un cambiamento nelle fusioni si vede in due posti insieme: il quadrato della scheda aperta e
  // le card della lista (una fusione ferma le colora come un blocco).
  function riflettiFusioni() {
    if (selectedId && allFeedbacks.some((f) => f._id === selectedId)) {
      const fb = allFeedbacks.find((f) => f._id === selectedId);
      renderLivelliRow(fb);
      ridisegnaPannelloAperto();
    }
    if (dataLoaded) ridisegnaListaAlSuoPosto();
  }

  // Il pannello aperto su un livello si riempie di nuovo: se era il quadrato,
  // dentro c'è una richiesta che potrebbe non esistere più, o che sta fondendo.
  function ridisegnaPannelloAperto() {
    if (!livelloAperto) return;
    quandoPannelloLibero(() => {
      const ora = selectedId && allFeedbacks.find((f) => f._id === selectedId);
      if (ora && livelloAperto) openSidebarLivello(ora, livelloAperto);
    });
  }

  async function loadChannelLog() {
    if (!mgChannelSection || !isAdmin) return;
    try {
      const r = await sendToMain({ type: ROUTINE_LOG_GET });
      if (!r || r.ok === false) { mgChannelSection.hidden = true; return; }
      renderChannelLog(r.rejections, r.comparisons, r.proveFusione);
    } catch (err) {
      console.error('[manage] caricamento registri canale fallito:', err);
      mgChannelSection.hidden = true;
    }
  }

  // ── Tab bar ───────────────────────────────────────────────────────────────
  // Le tab-lista (inbox/queue/resolved/archived) condividono il pannello
  // `panel-list`: cambia solo quale sottoinsieme di feedback popola la lista a
  // sinistra. Le altre (fbstats/stats/models/automation/log) hanno il loro
  // pannello, `panel-<nome>`.
  // `opts.apertura`: la scelta automatica d'apertura, che non conta come scelta dell'utente e non si ricorda.
  function selectTab(tab, opts) {
    const sezione = MR.sezioneDiScheda(tab);
    if (!sezione) return;
    const apertura = !!(opts && opts.apertura);
    if (!apertura) utenteHaScelto = true;
    sezioneAttiva = sezione;
    schedaPerSezione[sezione] = tab;
    if (!apertura) salvaSezione();
    // Cambiando scheda la ricerca si chiude da sola: vedi la scheda scelta.
    if (searchMode) closeSearch({ keepList: true });
    document.querySelectorAll('.mg-tab').forEach((t) => {
      t.classList.toggle('mg-tab--active', t.dataset.tab === tab);
    });
    aggiornaSezioniAttive();
    const isList = LIST_TABS.includes(tab);
    const panelId = isList ? 'panel-list' : (DOMANDE_TABS.includes(tab) ? 'panel-domande' : `panel-${tab}`);
    document.querySelectorAll('.mg-panel').forEach((p) => {
      p.classList.toggle('mg-panel--active', p.id === panelId);
    });
    if (isList) {
      currentTab = tab;
      // La frase scritta e non ancora partita se ne va con la selezione: si salva finché
      // `selectedId` dice a chi appartiene.
      salvaFraseAutomatico();
      // Cambiando tab si azzera la selezione: il feedback aperto può non essere nella nuova lista.
      selectedId = null;
      mgDetail.hidden = true;
      mgDetailEmpty.hidden = false;
      mgActions.hidden = true;
      collassaFrase();
      mgManage.hidden = true;
      if (mgOwnerBar) mgOwnerBar.hidden = true;
      closeSidebar();
      renderList();
    }
    if (DOMANDE && DOMANDE_TABS.includes(tab)) DOMANDE.mostra(tab);
    // I caricamenti pigri ascoltano questo, non il clic: una scheda si mostra anche da una sezione o all'apertura.
    document.dispatchEvent(new CustomEvent('mg-scheda', { detail: { tab, apertura } }));
  }

  // Le domande si rileggono a ogni apertura di una loro scheda; all'avvio le ha già chieste init.
  document.addEventListener('mg-scheda', (e) => {
    if (DOMANDE && DOMANDE_TABS.includes(e.detail.tab) && !e.detail.apertura) DOMANDE.carica();
  });
  if (DOMANDE) {
    DOMANDE.alCambio(() => updateSezioniCounts());
    // Un feedback nominato da una domanda si apre nella sua scheda, come dall'avviso di una fusione.
    DOMANDE.collega({
      apriFeedback: (num) => openFeedbackByNum(String(num || '').replace(/^#/, '')),
      apriScheda: (tab) => selectTab(tab),
      soloNonFidate: () => soloNonFidate,
      impostaSoloNonFidate: (v) => impostaSoloNonFidate(v),
    });
  }

  function schedaAttiva() {
    const btn = mgTabs.querySelector('.mg-tab.mg-tab--active');
    return btn ? btn.dataset.tab : '';
  }

  mgTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.mg-tab');
    if (!btn) return;
    selectTab(btn.dataset.tab);
  });

  if (mgSezioni) {
    mgSezioni.addEventListener('click', (e) => {
      const btn = e.target.closest('.mg-sezione');
      if (!btn) return;
      selectTab(schedaPerSezione[btn.dataset.sezione]);
    });
  }

  function aggiornaSezioniAttive() {
    if (mgSezioni) {
      mgSezioni.querySelectorAll('.mg-sezione').forEach((b) => {
        const on = b.dataset.sezione === sezioneAttiva;
        b.classList.toggle('mg-sezione--active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }
    aggiornaSchedeVisibili();
    updateSezioniCounts();
  }

  // Una scheda si vede se è della sezione accesa; le schede-lista anche solo se lo stato si legge (mostraSezioni).
  function aggiornaSchedeVisibili() {
    const ok = sezioniAttendibili();
    mgTabs.querySelectorAll('.mg-tab').forEach((btn) => {
      const tab = btn.dataset.tab;
      btn.hidden = MR.sezioneDiScheda(tab) !== sezioneAttiva || (LIST_TABS.includes(tab) && !ok);
    });
    if (mgNoSections) mgNoSections.hidden = ok || sezioneAttiva !== 'feedback';
  }

  function salvaSezione() {
    try { localStorage.setItem(SEZIONE_KEY, JSON.stringify({ sezione: sezioneAttiva, schede: schedaPerSezione })); } catch (_) {}
  }
  function leggiSezione() {
    try { return MR.leggiSceltaSezione(localStorage.getItem(SEZIONE_KEY)); } catch (_) { return null; }
  }

  // Gira una volta, quando feedback e domande sono arrivati (o falliti), e mai dopo un clic dell'utente.
  function sceltaApertura(opts) {
    const forza = !!(opts && opts.forza);
    if (!forza && (aperturaFatta || utenteHaScelto)) return null;
    aperturaFatta = true;
    const d = DOMANDE ? DOMANDE.stato() : null;
    const ricevuti = dataLoaded && sezioniAttendibili()
      ? MR.listForManageTab(allFeedbacks, 'inbox', { releasedVersion, fusioni }).length
      : null;
    const scelta = MR.sezioneDiApertura({ domande: d && d.lette ? d.domande : null, ricevuti, ultima: leggiSezione() });
    // Si apre sui Ricevuti per quello che c'è dentro: a filtri spenti, o un blocco nuovo resterebbe nascosto.
    if (scelta.scheda === 'inbox' && livelliScelti.length) { livelliScelti = []; renderList(); }
    const giaQui = scelta.sezione === sezioneAttiva && schedaPerSezione[sezioneAttiva] === scelta.scheda
      && document.querySelector(`.mg-tab--active[data-tab="${scelta.scheda}"]`);
    if (!giaQui) selectTab(scelta.scheda, { apertura: true });
    return scelta;
  }

  // ── Filtro dei Ricevuti per livello ──────────────────────────────────────
  if (mgLivelliFiltro) {
    mgLivelliFiltro.querySelectorAll('.mg-livello-btn').forEach((b) => {
      const forma = MR.FORME_SVG[MR.FORMA_DI_LIVELLO[b.dataset.livello]];
      if (forma) b.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${forma}"/></svg>`);
    });
    mgLivelliFiltro.addEventListener('click', (e) => {
      const btn = e.target.closest('.mg-livello-btn');
      if (!btn) return;
      const l = btn.dataset.livello;
      livelliScelti = livelliScelti.includes(l) ? livelliScelti.filter((x) => x !== l) : livelliScelti.concat(l);
      renderList();
    });
  }

  // Aprire una pratica precisa (avviso, statistiche, ricerca, una domanda) la deve far vedere anche coi filtri accesi.
  function mostraNelFiltro(fb) {
    if (!fb) return;
    if (soloNonFidate && MR.isFidato(fb)) impostaSoloNonFidate(false);
    if (!livelliScelti.length || MR.manageTabFor(fb, { releasedVersion, fusioni }) !== 'inbox') return;
    if (!MR.filtraLivelli([fb], livelliScelti, { releasedVersion, fusioni }).length) livelliScelti = [];
  }

  // ── «Solo non fidate» (#1575): un tasto nella testa della lista e uno in quella delle Domande, uno stato ─────
  function impostaSoloNonFidate(valore) {
    const v = !!valore;
    if (v === soloNonFidate) return;
    soloNonFidate = v;
    renderList();
    if (DOMANDE && typeof DOMANDE.ridisegna === 'function') DOMANDE.ridisegna();
  }
  for (const b of [mgFiduciaFiltro, mgDomandeFiduciaFiltro]) {
    if (!b) continue;
    b.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${MR.FORME_SVG.scudo}"/></svg>`);
    b.addEventListener('click', () => impostaSoloNonFidate(!soloNonFidate));
  }
  // `base` è la lista che la scheda mostrerebbe a filtro spento: il numero dice quante ne resterebbero accendendolo.
  function aggiornaFiltroFiducia(base) {
    if (!mgFiduciaFiltro) return;
    const show = !searchMode && sezioniAttendibili() && LIST_TABS.includes(currentTab);
    mgFiduciaFiltro.hidden = !show;
    if (!show) return;
    mgFiduciaFiltro.setAttribute('aria-pressed', soloNonFidate ? 'true' : 'false');
    mgFiduciaFiltro.title = soloNonFidate ? 'Mostra anche le pratiche fidate' : 'Mostra solo le pratiche non fidate';
    const c = mgFiduciaFiltro.querySelector('.mg-livello-count');
    if (c) c.textContent = dataLoaded && Array.isArray(base) ? ` ${countText(MR.contaNonFidate(base))}` : '';
  }

  function updateLivelliFiltro() {
    if (!mgLivelliFiltro) return;
    const show = currentTab === 'inbox' && !searchMode && sezioniAttendibili();
    mgLivelliFiltro.hidden = !show;
    if (!show) return;
    const n = dataLoaded ? MR.contaLivelliRicevuti(allFeedbacks, { releasedVersion, fusioni, soloNonFidate }) : null;
    mgLivelliFiltro.querySelectorAll('.mg-livello-btn').forEach((b) => {
      const l = b.dataset.livello;
      b.setAttribute('aria-pressed', livelliScelti.includes(l) ? 'true' : 'false');
      const c = b.querySelector('.mg-livello-count');
      if (c) c.textContent = n ? ` ${countText(n[l])}` : '';
    });
  }

  // Filtro ⭐ della tab Archiviati: ricalcola la lista (la selezione resta).
  if (mgStarFilter) {
    mgStarFilter.addEventListener('change', () => {
      starredOnly = mgStarFilter.checked;
      renderList();
    });
  }

  // Filtro «Bloccati confermati»: attacchi e spam confermati, fuori dai Ricevuti ma ispezionabili
  // come storico.
  if (mgConfirmedFilter) {
    mgConfirmedFilter.addEventListener('change', () => {
      confirmedOnly = mgConfirmedFilter.checked;
      renderList();
    });
  }

  // Allegati immagine cifrati: byte opachi, un <img src=URL> diretto è un allegato rotto; il
  // main decifra. `error` porta il MOTIVO, `soloDestinatario` = è di un altro, non è rotto.
  const imgCache = new Map();
  async function resolveImageSrc(url) {
    if (!url) return { dataUrl: null, error: '', soloDestinatario: false };
    if (imgCache.has(url)) return imgCache.get(url);
    let dataUrl = null;
    let error = '';
    let soloDestinatario = false;
    try {
      const r = await sendToMain({ type: 'feedback_decrypt_image', url });
      if (r && r.ok && r.dataUrl) dataUrl = r.dataUrl;
      else if (r && r.error) { error = String(r.error); soloDestinatario = !!r.soloDestinatario; }
      else error = 'immagine non disponibile';
    } catch (_) {
      // rete/canale: trattala come non disponibile
      error = 'immagine non raggiungibile';
    }
    const res = { dataUrl, error, soloDestinatario };
    imgCache.set(url, res);
    return res;
  }

  // Il click apre il lightbox su `data-full`, mai sull'URL cifrato. Il motivo del fallimento
  // va nel `title`: un'immagine muta non dice se manca la chiave o se il file è corrotto.
  function resolveBubbleImages(bubble) {
    bubble.querySelectorAll('.mg-bubble-imgs img').forEach((img) => {
      const url = img.dataset.url || '';
      img.addEventListener('click', () => {
        const full = img.dataset.full;
        if (full) openLightbox(full);
      });
      resolveImageSrc(url).then(({ dataUrl, error, soloDestinatario }) => {
        img.classList.remove('mg-img-loading');
        if (dataUrl) {
          img.src = dataUrl;
          img.dataset.full = dataUrl;
        } else {
          img.classList.add('mg-img-failed');
          // «Non disponibile» fa sembrare un guasto quello che è roba di qualcun altro. E non
          // «consegnato»: da qui non sappiamo se sia mai arrivato. Resta vero solo chi lo può aprire.
          img.alt = soloDestinatario ? '(allegato riservato)' : 'immagine non disponibile';
          if (error) img.title = error;
        }
      });
    });
  }

  // Perché una pillola non si apre, DETTO PRIMA del clic: senza, quella di un allegato altrui
  // arriva identica a una che si apre. Cache url → { error, soloDestinatario } | null.
  const fileWhyCache = new Map();
  async function fileClosedReason(url) {
    if (!url) return null;
    if (fileWhyCache.has(url)) return fileWhyCache.get(url);
    let res = null;
    try {
      const r = await sendToMain({ type: 'feedback_decrypt_image', url });
      if (!r || !r.ok) {
        res = { error: String((r && r.error) || 'allegato non disponibile'), soloDestinatario: !!(r && r.soloDestinatario) };
      }
    } catch (_) {
      res = { error: 'allegato non raggiungibile', soloDestinatario: false };
    }
    fileWhyCache.set(url, res);
    return res;
  }

  function markFileClosed(a, motivo, soloDestinatario) {
    a.title = motivo || '';
    a.classList.add('mg-img-failed');
    let nota = a.querySelector('.mg-file-note');
    if (!nota) {
      nota = document.createElement('span');
      nota.className = 'mg-file-note';
      a.appendChild(nota);
    }
    nota.textContent = soloDestinatario ? ' (riservato)' : ' (non disponibile)';
  }

  // I documenti allegati si scaricano decifrati (stesso canale delle immagini) e si salvano
  // col nome originale; il motivo di un fallimento va nel `title`.
  function resolveBubbleFiles(bubble) {
    bubble.querySelectorAll('.mg-file-link').forEach((a) => {
      if (!isAdmin) {
        fileClosedReason(a.dataset.url || '').then((r) => { if (r) markFileClosed(a, r.error, r.soloDestinatario); });
      }
      a.addEventListener('click', async (ev) => {
        ev.preventDefault();
        const url = a.dataset.url || '';
        const name = a.dataset.name || 'allegato';
        const mime = a.dataset.type || 'application/octet-stream';
        a.classList.add('mg-img-loading');
        try {
          const r = await sendToMain({ type: 'feedback_decrypt_image', url, mime });
          if (r && r.ok && r.dataUrl) {
            const dl = document.createElement('a');
            dl.href = r.dataUrl;
            dl.download = name;
            document.body.appendChild(dl);
            dl.click();
            dl.remove();
          } else {
            markFileClosed(a, (r && r.error) ? String(r.error) : 'allegato non disponibile', !!(r && r.soloDestinatario));
          }
        } catch (_) {
          a.title = 'allegato non raggiungibile';
        } finally {
          a.classList.remove('mg-img-loading');
        }
      });
    });
  }

  // Esc chiude l'immagine a tutta pagina, e a schermo intero serve anche a uscire: chi dei
  // due lo prende lo decide src/content/content.js, qui si DICHIARA di averlo preso.
  function openLightbox(src) {
    mgLightboxImg.src = src;
    mgLightbox.classList.add('open');
  }
  function closeLightbox() {
    if (!mgLightbox.classList.contains('open')) return false;
    mgLightbox.classList.remove('open');
    mgLightboxImg.removeAttribute('src');
    return true;
  }
  mgLightbox.addEventListener('click', closeLightbox);
  // Esc chiude l'immagine, come ovunque in Filo. In capture: il visore è l'ultima cosa aperta
  // e sta sopra tutto, quindi l'Esc è suo prima della ricerca o di un menu aperto.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!closeLightbox()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  // Utilità date
  function formatDate(isoOrTs) {
    if (!isoOrTs) return '—';
    const d = new Date(isoOrTs);
    if (isNaN(d.getTime())) return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  function daysAgo(isoOrTs) {
    if (!isoOrTs) return '—';
    const d = new Date(isoOrTs);
    if (isNaN(d.getTime())) return '—';
    const diff = Math.round((Date.now() - d.getTime()) / 86_400_000);
    if (diff <= 0) return 'oggi';
    if (diff === 1) return 'ieri';
    return `${diff} giorni fa`;
  }

  // Priorità (1-3 pallini), solo per l'owner e solo dove serve agire: più pallini pieni = le
  // routine la affrontano prima.
  function priorityHasDots() {
    return currentTab === 'queue' || currentTab === 'waiting' || currentTab === 'inbox';
  }
  function priorityDotsHtml(fb) {
    if (!priorityHasDots()) return '';
    const p = MR.priorityOf(fb);
    const dots = [1, 2, 3].map((n) => {
      const on = n <= p ? ' mg-dot--on' : '';
      if (!isAdmin) return `<span class="mg-dot mg-dot--readonly${on}" aria-label="Priorità ${n}"></span>`;
      const reset = p === n ? ' (clic per azzerare)' : '';
      return `<button type="button" class="mg-dot${on}" data-prio-id="${esc(fb._id)}" data-prio-n="${n}" title="Priorità ${n}${reset}" aria-label="Priorità ${n}"></button>`;
    }).join('');
    return `<span class="mg-priority" title="Priorità: ${p || '—'}">${dots}</span>`;
  }

  // Ri-clic sul pallino già attivo azzera la priorità. `priorityManual:true` dice al
  // backend che è una scelta dell'owner → il giudice automatico non la sovrascrive.
  async function setPriorityFromDot(id, n) {
    const fb = allFeedbacks.find((f) => f._id === id);
    if (!fb) return;
    const cur = MR.priorityOf(fb);
    const next = cur === n ? 0 : n;
    if (next === cur) return;
    const prev = fb.priority;
    fb.priority = next; // ottimistico: aggiorna subito i pallini e l'ordine
    renderList();
    try {
      const r = await sendToMain({ type: 'feedback_update', id, priority: next, priorityManual: true });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'aggiornamento rifiutato');
    } catch (e) {
      fb.priority = prev; // rollback in caso di errore
      renderList();
    }
  }

  // Un solo listener per tutta la lista; il click sul pallino non deve aprire il dettaglio.
  mgList.addEventListener('click', (e) => {
    const dot = e.target.closest('.mg-dot[data-prio-id]');
    if (!dot) return;
    e.stopPropagation();
    setPriorityFromDot(dot.dataset.prioId, Number(dot.dataset.prioN));
  });

  // Tasto destro sull'intestazione, col glifo ⇅ come scorciatoia GUI allo stesso menu:
  // l'azione resta scopribile senza indovinare il tasto destro. Classi in PATTERNS.md.
  const mgSortBtn = document.getElementById('mgSortBtn');
  const mgListHeadRow = document.getElementById('mgListHeadRow');
  let sortMenu = null;
  function closeSortMenu() {
    if (!sortMenu) return;
    sortMenu.remove();
    sortMenu = null;
    document.removeEventListener('mousedown', onSortOutside, true);
    document.removeEventListener('keydown', onSortKeydown, true);
    window.removeEventListener('scroll', onSortScroll, true);
    window.removeEventListener('resize', closeSortMenu);
  }
  function onSortOutside(e) {
    if (sortMenu && !sortMenu.contains(e.target)) closeSortMenu();
  }
  function onSortKeydown(e) {
    if (e.key === 'Escape') closeSortMenu();
  }
  // Il menu si chiude quando scorre l'owner, non quando la lista si riallinea
  // da sola sotto di lui.
  let scrollDelGiroAt = 0;
  function onSortScroll() {
    if (Date.now() - scrollDelGiroAt < 300) return;
    closeSortMenu();
  }
  function chooseSort(mode) {
    closeSortMenu();
    if (!SORT_MODES[mode] || mode === sortMode) return;
    sortMode = mode;
    reflectSortBtn();
    renderList();
    chrome.storage.local.set({ [SORT_MODE_KEY]: mode }).catch(() => {});
  }
  // Il glifo riflette l'ordinamento attivo (tooltip + stato «non predefinito»): a colpo d'occhio
  // si vede se la lista è riordinata.
  function reflectSortBtn() {
    if (!mgSortBtn) return;
    const active = sortMode !== 'smart';
    mgSortBtn.classList.toggle('mg-sort-btn--active', active);
    mgSortBtn.title = active
      ? `Ordinamento: ${SORT_MODES[sortMode]} — clic o tasto destro per cambiare`
      : 'Riordina i feedback — clic o tasto destro';
  }
  function openSortMenu(x, y) {
    apriMenu(x, y, ['num', 'priority', 'creator', 'smart'].map((mode) => ({
      testo: SORT_MODES[mode], acceso: mode === sortMode, radio: true, azione: () => chooseSort(mode),
    })));
  }
  // Un menu di voci nello stile dei select (PATTERNS.md); uno solo aperto per volta.
  function apriMenu(x, y, voci) {
    closeSortMenu();
    const menu = document.createElement('div');
    menu.className = 'sn-select-pop mg-ctxmenu';
    menu.setAttribute('role', 'menu');
    for (const v of voci) {
      const opt = document.createElement('div');
      opt.className = 'sn-select-option';
      opt.setAttribute('role', v.radio ? 'menuitemradio' : 'menuitem');
      if (v.radio) opt.setAttribute('aria-checked', v.acceso ? 'true' : 'false');
      if (v.acceso) opt.classList.add('sn-selected');
      if (v.titolo) opt.title = v.titolo;
      // ✓ sulla voce attiva; spazio allineato sulle altre.
      opt.textContent = v.radio ? `${v.acceso ? '✓ ' : ' '}${v.testo}` : v.testo;
      opt.addEventListener('click', () => { closeSortMenu(); v.azione(); });
      menu.appendChild(opt);
    }
    document.body.appendChild(menu);
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = `${Math.max(4, Math.min(x, vw - w - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, vh - h - 4))}px`;
    sortMenu = menu;
    document.addEventListener('keydown', onSortKeydown, true);
    setTimeout(() => {
      if (sortMenu !== menu) return;
      document.addEventListener('mousedown', onSortOutside, true);
      window.addEventListener('scroll', onSortScroll, true);
      window.addEventListener('resize', closeSortMenu);
    }, 0);
  }
  // Lo stesso menu per le schede che vivono in un file loro (manageRedteam.js).
  window.SN_MANAGE_MENU = { apri: apriMenu };
  window.SN_MANAGE_FEEDBACK = { apri: (id) => apriFeedback(allFeedbacks.find((f) => f._id === String(id || ''))) };
  // Lo stesso cammino del tasto nel dettaglio (applyAction), che scrive solo la pratica aperta: l'esito si legge lì.
  function approvaDalMenu(fb, azione) {
    if (selectedId !== fb._id) openDetail(fb._id);
    applyAction(azione, null);
  }

  // Tasto destro su una scheda: quello che si fa su una pratica senza aprirla (#908).
  mgList.addEventListener('contextmenu', (e) => {
    const item = e.target.closest('.mg-item[data-id]');
    const fb = item && allFeedbacks.find((f) => f._id === item.dataset.id);
    if (!fb) return;
    e.preventDefault();
    const num = FB.formatNum(fb.seq, fb.subSeq);
    const voci = [{ testo: 'Apri', azione: () => openDetail(fb._id) }];
    const domandaId = MR.aspettaDomanda(fb);
    if (domandaId) {
      voci.push({ testo: `Rispondi alla domanda ${domandaId}`, titolo: 'Si risponde in un posto solo: la domanda, con le sue opzioni.', azione: () => apriDomandaDelFeedback(domandaId, fb._id) });
    }
    if (isAdmin && ATT) {
      if (!MR.praticaChiusa(fb, opzSezioni())) {
        voci.push({ testo: '⏳ Aspetta un altro feedback…', titolo: 'Nessuna routine lo prende finché quello non è fuso.', azione: () => apriCasellaAttese(fb._id) });
      }
      if (ATT.atteseDi(fb).length) {
        voci.push({
          testo: '⏳ Non aspettare più', titolo: testoStatiAttese(ATT.statiDelleAttese(fb, trovaAtteso)),
          azione: () => { if (selectedId !== fb._id) openDetail(fb._id); accodaAttese(fb._id, () => []); },
        });
      }
    }
    // Solo sul rombo azzurro, come nel dettaglio: lì è l'unica uscita (#1575).
    const lavoroLocale = isAdmin ? MR.ownerActionFor(fb, 'accept_local', { releasedVersion }) : null;
    if (lavoroLocale) {
      voci.push({ testo: lavoroLocale.label, titolo: titoloLavoroLocale(fb), azione: () => approvaDalMenu(fb, lavoroLocale) });
    }
    if (isAdmin && MR.fiduciaCheck(fb).ok) {
      voci.push({ testo: '🤝 Segna fidato', titolo: titoloFiducia(fb), azione: () => { if (selectedId !== fb._id) openDetail(fb._id); impostaFiducia(fb._id, true); } });
    } else if (isAdmin && MR.fiduciaTogliCheck(fb).ok) {
      voci.push({ testo: '🤝 Togli fiducia', titolo: titoloTogliFiducia(fb), azione: () => { if (selectedId !== fb._id) openDetail(fb._id); impostaFiducia(fb._id, false); } });
    }
    if (num) {
      voci.push({
        testo: `Copia #${num}`,
        // Solo le pratiche fidate o approvate da te si legano a un lavoro locale: per le altre il numero serve a parlarne.
        titolo: (MR.isFidato(fb) || MR.isLocalApproved(fb)) ? 'Il numero con cui parlarne, anche a npm run finish -- --feedback' : 'Il numero con cui parlarne',
        azione: () => { navigator.clipboard.writeText(`#${num}`).then(() => setManageMsg(`#${num} copiato.`, 'ok'), () => {}); },
      });
    }
    apriMenu(e.clientX, e.clientY, voci);
  });

  // Tasto destro ovunque sull'intestazione della lista → menu di ordinamento.
  if (mgListHeadRow) {
    mgListHeadRow.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openSortMenu(e.clientX, e.clientY);
    });
  }
  if (mgSortBtn) {
    mgSortBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = mgSortBtn.getBoundingClientRect();
      openSortMenu(r.left, r.bottom + 4);
    });
    mgSortBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const r = mgSortBtn.getBoundingClientRect();
        openSortMenu(r.left, r.bottom + 4);
      }
    });
  }
  async function loadSortMode() {
    try {
      const data = await chrome.storage.local.get(SORT_MODE_KEY);
      const v = data && data[SORT_MODE_KEY];
      if (v && SORT_MODES[v]) sortMode = v;
    } catch (_) { /* ripiego sull'ordine predefinito */ }
    reflectSortBtn();
  }

  // Solo le quattro schede che ELENCANO: altrove un numero non direbbe nulla. Dato non
  // arrivato → nessun numero; al tetto diventano «(24+)», minimi e non totali.
  function loadHitCap() {
    return caricoIncompleto;
  }

  // Quando lo stato non si legge, le sezioni non si disegnano: la regola sta in
  // MR.sectionsReliable, condivisa con la gemella — due copie divergono.
  function sezioniAttendibili() {
    return MR.sectionsReliable(allFeedbacks);
  }

  // Due domande separate: sezioniAttendibili() riguarda la LISTA (un documento storto non
  // toglie la barra a tutti), statoLeggibile(fb) UNA segnalazione (bordo, iter, pulsanti).
  function statoLeggibile(fb) {
    return !MR.statusUnreadable(fb);
  }

  // Mostra o nasconde le quattro schede-lista e l'avviso che ne spiega l'assenza; le altre
  // quattro non dipendono dallo stato e restano raggiungibili. True se si possono disegnare.
  function mostraSezioni() {
    const ok = sezioniAttendibili();
    if (mgNoSections && !ok) mgNoSections.textContent = SENZA_SEZIONI_AVVISO;
    aggiornaSchedeVisibili();
    return ok;
  }
  // «(24)» o «(24+)» secondo il tetto: una sola regola per barra, intestazione e ricerca.
  function countText(n) {
    return FB.countLabel(n, loadHitCap());
  }

  // `n === null` (dato non ancora arrivato, o ricerca non ancora fatta) → solo il nome.
  function setListHead(label, n) {
    if (!mgListHead) return;
    mgListHead.textContent = (n === null || n === undefined)
      ? label
      : `${label} ${countText(n)}`;
    testaIncompleta = n !== null && n !== undefined && loadHitCap();
    aggiornaSegnoFerma();
  }

  // Il suggerimento dell'intestazione lo scrive solo questa: ridisegnando il conteggio si perdeva l'avviso del giro
  // appena messo (#676).
  let testaIncompleta = false;
  let avvisoGiro = '';
  function scriviTitoloTesta(ferma) {
    if (!mgListHead) return;
    const parti = [ferma || (testaIncompleta ? FB.COUNT_INCOMPLETE_HINT : ''), avvisoGiro ? `Aggiornamento: ${avvisoGiro}` : ''].filter(Boolean);
    if (parti.length) mgListHead.title = parti.join('\n');
    else mgListHead.removeAttribute('title');
  }

  function updateTabCounts() {
    // Sezioni non disegnabili: non c'è niente da numerare. Uscire QUI evita di
    // lasciare "(3) (0) (0) (0)" appiccicato ai bottoni nascosti, pronto a
    // ricomparire al primo dato leggibile che non passa da renderList.
    updateSezioniCounts();
    updateLivelliFiltro();
    if (!sezioniAttendibili()) return;
    const counts = dataLoaded
      ? MR.manageTabCounts(allFeedbacks, opzSezioni({ starredOnly, confirmedOnly, livelli: livelliScelti, soloNonFidate }))
      : null;
    const capped = counts ? loadHitCap() : false;
    // Una sezione che ha ricevuto schede mentre si guardava altro lo dice.
    const conArrivi = new Set();
    for (const fb of allFeedbacks) {
      if (arrivate.has(String(fb._id))) conArrivi.add(sezioneDi(fb));
    }
    for (const tab of LIST_TABS) {
      const btn = mgTabs.querySelector(`.mg-tab[data-tab="${tab}"]`);
      if (!btn) continue;
      btn.classList.toggle('mg-tab--arrivi', conArrivi.has(tab));
      btn.textContent = counts ? `${TAB_LABELS[tab] || tab} ` : (TAB_LABELS[tab] || tab);
      if (capped) btn.title = FB.COUNT_INCOMPLETE_HINT;
      else btn.removeAttribute('title');
      if (!counts) continue;
      const badge = document.createElement('span');
      badge.className = 'mg-tab-count';
      badge.textContent = countText(counts[tab]);
      btn.appendChild(badge);
    }
  }

  // Domande e le tre schede: un numero solo con le domande lette davvero (patterns/una-barra-di-sezioni-dice-quante-cose-contiene-ogni-sezione.md).
  const DOMANDE_LABELS = { domande: 'Da rispondere', 'domande-lavoro': 'In lavorazione', 'domande-archivio': 'Archivio' };
  function updateSezioniCounts() {
    if (!mgSezioni) return;
    const scrivi = (sez, testo, titolo) => {
      const b = mgSezioni.querySelector(`.mg-sezione[data-sezione="${sez}"]`);
      const c = b && b.querySelector('.mg-sezione-count');
      if (!c) return null;
      c.textContent = testo;
      if (titolo) b.title = titolo; else b.removeAttribute('title');
      return b;
    };
    const d = DOMANDE ? DOMANDE.stato() : null;
    const nd = d && d.lette ? MR.contaDomande(d.domande) : null;
    const bd = scrivi('domande', nd ? `(${nd.domande})` : '',
      nd ? `${nd.domande} da rispondere${d.aggiornamento ? ' · l’ultimo aggiornamento non è riuscito' : ''}` : '');
    if (bd) bd.classList.toggle('mg-sezione--urgente', !!(nd && MR.bloccanteAperta(d.domande)));
    // Le schede contano quello che mostrano, col filtro della fiducia; la sezione, come Feedback, a filtro spento.
    const nt = nd && soloNonFidate ? MR.contaDomande(MR.filtraFiducia(d.domande, true)) : nd;
    for (const tab of DOMANDE_TABS) {
      const btn = mgTabs.querySelector(`.mg-tab[data-tab="${tab}"]`);
      if (!btn) continue;
      btn.textContent = nd ? `${DOMANDE_LABELS[tab]} ` : DOMANDE_LABELS[tab];
      if (!nd) continue;
      const badge = document.createElement('span');
      badge.className = 'mg-tab-count';
      // Oltre il tetto dell'elenco l'archivio ha solo le più recenti: il numero è un minimo.
      badge.textContent = `(${nt[tab]}${d.altre && tab === 'domande-archivio' ? '+' : ''})`;
      btn.appendChild(badge);
    }

    // Feedback = i Ricevuti a filtro spento: il filtro è una vista della scheda, non della sezione.
    const leggibili = dataLoaded && sezioniAttendibili();
    const ricevuti = leggibili ? MR.listForManageTab(allFeedbacks, 'inbox', { releasedVersion, fusioni }).length : null;
    const bf = scrivi('feedback', ricevuti === null ? '' : countText(ricevuti),
      ricevuti === null ? '' : `${ricevuti} nei Ricevuti${loadHitCap() ? ` · ${FB.COUNT_INCOMPLETE_HINT}` : ''}`);
    if (bf) bf.classList.toggle('mg-sezione--arrivi', sezioneAttiva !== 'feedback'
      && allFeedbacks.some((fb) => arrivate.has(String(fb._id))));

    // Routine: le fusioni senza segnalazione che aspettano il via libera in Automazioni. Zero non si scrive:
    // la sezione non è vuota, contiene le automazioni.
    const orfane = fusioniOk && dataLoaded ? fusioniOrfane().filter((r) => !r.used).length : 0;
    scrivi('routine', orfane ? `(${orfane})` : '', orfane ? `${orfane} fusioni aspettano il tuo via libera in Automazioni` : '');
  }

  // ── Rendering colonna sinistra ────────────────────────────────────────────
  function renderList() {
    mgListLoading.hidden = true;
    mgListEmpty.textContent = TAB_EMPTY[currentTab] || 'Nessun feedback.';

    // Stato illeggibile → niente sezioni: un elenco solo, i più recenti in cima, come la gemella.
    // Nome e filtri di sezione qui non si possono applicare.
    const sezioni = mostraSezioni();
    if (!sezioni) {
      if (mgArchiveFilter) mgArchiveFilter.hidden = true;
      aggiornaFiltroFiducia(null);
      currentList = applySortMode(allFeedbacks.slice().sort((a, b) =>
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
      mgListEmpty.textContent = TAB_EMPTY.inbox;
      setListHead(SENZA_SEZIONI_LABEL, dataLoaded ? currentList.length : null);
      updateTabCounts();
      renderListBody();
      renderFusioniOrfane();
      return;
    }

    // Il filtro ⭐ esiste solo nella tab Archiviati (DB2).
    const isArchived = currentTab === 'archived';
    if (mgArchiveFilter) mgArchiveFilter.hidden = !isArchived;

    // Sottoinsieme della tab corrente, ordinato (logica pura condivisa). La fiducia si filtra dopo con la stessa
    // funzione che conta le schede: la lista di prima serve al numero sul suo tasto.
    let base;
    if (isArchived) {
      // OFF = solo i feedback `archived`; ON = tutti i preferiti ⭐ (ogni stato).
      // Il filtro "Bloccati confermati" (solo attacchi/spam confermati) è dentro
      // listArchiveTab: la stessa funzione conta la scheda, così il numero non
      // può discostarsi dalla lista.
      base = MR.listArchiveTab(allFeedbacks, { starredOnly, confirmedOnly });
      mgListEmpty.textContent = confirmedOnly
        ? 'Nessun attacco o spam confermato.'
        : starredOnly
          ? 'Nessun feedback preferito.'
          : (TAB_EMPTY.archived || 'Nessun feedback archiviato.');
    } else {
      // DB3: passa la versione rilasciata così "Risolti" contiene solo i fix
      // davvero in produzione; i done-ma-non-ancora-spediti restano in "In coda".
      // Macchina a stati: la tab deriva SOLO dallo status (la modalità
      // automatica non è più una lente sulle liste).
      base = MR.listForManageTab(allFeedbacks, currentTab, opzSezioni({ livelli: livelliScelti }));
      if (currentTab === 'inbox' && livelliScelti.length) {
        mgListEmpty.textContent = `Nessun feedback fermo a ${livelliScelti.slice().sort().map((l) => l.toUpperCase()).join(' o ')}.`;
      }
    }
    currentList = MR.filtraFiducia(base, soloNonFidate);
    if (soloNonFidate && base.length && !currentList.length) mgListEmpty.textContent = 'Qui sono tutte fidate.';
    aggiornaFiltroFiducia(base);

    // Override di ordinamento scelto dall'owner dal menu contestuale (tasto
    // destro sull'intestazione). In 'smart' resta l'ordine predefinito sopra.
    currentList = applySortMode(currentList);

    // Una fusione ferma È una decisione dell'owner: sale in cima con QUALSIASI
    // ordinamento. Fatto prima dell'ordinamento, «per numero» la rimandava a
    // metà lista e una pratica appena fermata non si vedeva arrivare.
    currentList = pinFusioniFerme(currentList);

    // #495: quante ne contiene ogni scheda, senza doverle aprire. L'ordinamento
    // non cambia il numero, quindi si può contare qui.
    updateTabCounts();
    setListHead(TAB_LABELS[currentTab] || '', dataLoaded ? currentList.length : null);
    renderListBody();
    // Chi è «senza feedback» dipende da quali feedback ci sono: quando la lista cambia,
    // l'elenco in Automazioni si rifà, o una richiesta si leggerebbe due volte.
    renderFusioniOrfane();
    caricaAttesiFuori();
  }

  // Questa segnalazione ha una fusione ferma che aspetta l'owner?
  // Etichetta e suggerimento della pratica in lista: «aspetta il tuo via libera» solo se aspetta davvero (#702).
  const TESTI_FUSIONE_LISTA = {
    ferma: { etichetta: 'fusione ferma', titolo: 'Una fusione aspetta il tuo via libera', tooltip: 'una fusione aspetta il tuo via libera' },
    volo: { etichetta: 'in fusione', titolo: 'Approvata: il server sta fondendo il ramo', tooltip: 'il server sta fondendo il ramo' },
    decisa: { etichetta: 'fusione decisa', titolo: 'Hai già deciso: esce da qui alla prossima rilettura', tooltip: 'fusione già decisa' },
    senza: { etichetta: 'fusione ferma', titolo: 'Ferma al cancello senza una richiesta aperta. Decidi tu se rifarla o archiviarla', tooltip: 'ferma al cancello, nessuna richiesta aperta' },
  };
  function fusioneFerma(fb) {
    return MR.fusioneInAttesa(fb, { fusioni });
  }

  // Le segnalazioni con una fusione ferma davanti a tutte, conservando fra loro l'ordine
  // (`sort` è stabile).
  function pinFusioniFerme(lista) {
    return MR.fusioniFermeInCima(lista, { fusioni });
  }

  // La parte che NON dipende da quale sezione si guarda: la condivide anche l'elenco unico di
  // quando le sezioni non ci sono.
  function renderListBody() {
    // Il vuoto lo dice invece di negarli: come in src/pages/feedback/feedback.js.
    if (loadHitCap() && dataLoaded) {
      mgListEmpty.textContent = `${mgListEmpty.textContent} ${FB.COUNT_INCOMPLETE_HINT}`;
    }

    // Solo nei Ricevuti, quando c'è almeno un feedback bianco (panel parziale) da ri-valutare.
    updateReevalBar();
    // È QUI che l'owner mette in coda in blocco i blu (scrive `todo` su ciascuno).
    updateAlignedBar();

    // Svuota SEMPRE: se la lista torna vuota non deve restare la card vecchia in un contenitore
    // nascosto.
    mgList.innerHTML = '';

    // Dato non arrivato: il riquadro vuoto non può dire «qui non c'è niente», perché non lo
    // sappiamo. È la cautela dei numeri (#495) applicata alle parole.
    if (!dataLoaded) {
      mgListEmpty.textContent = loadFailed
        ? 'Errore nel caricamento dei feedback.'
        : 'Caricamento dei feedback…';
    }

    if (currentList.length === 0) {
      mgList.hidden = true;
      mgListEmpty.hidden = false;
      return;
    }
    mgListEmpty.hidden = true;
    mgList.hidden = false;

    // Bordo, riga dell'iter e motivo sono AFFERMAZIONI sullo stato: su una cifrata la macchina
    // le ricava da un `unlabeled` finto, e ogni scheda si direbbe «Non filtrato».
    const sezioni = sezioniAttendibili();

    for (const fb of currentList) {
      // La domanda è di QUESTA scheda, non della lista: in una coda mista basta un documento
      // cifrato fra mille leggibili perché le sezioni restino, ed è lì che tornava il difetto.
      const leggibile = sezioni && statoLeggibile(fb);
      const cl = leggibile ? MR.classifyBlock(fb) : null;
      const num = FB.formatNum(fb.seq, fb.subSeq);
      const title = fb.name || FB.fallbackName(fb.text) || '(senza titolo)';

      const item = document.createElement('div');
      const unfilteredCls = cl && cl.reason === 'unfiltered' ? ' mg-item--unfiltered' : '';
      // Allineato (tutti i giudici d'accordo, nessun blocco) → bordo BLU.
      const aligned = leggibile && !cl && MR.isAligned(fb);
      const alignedCls = aligned ? ' mg-item--aligned' : '';
      // In lavorazione (working/revision_*): la card mostra una seconda riga con
      // il passaggio corrente dell'iter e se un'istanza ci lavora ORA. Solo
      // nella tab "In coda" (dove queste card sono pinnate in cima).
      const progress = (leggibile && (currentTab === 'queue' || currentTab === 'waiting')) ? MR.workProgress(fb) : null;
      item.className = 'mg-item'
        + (fb._id === selectedId ? ' mg-item--selected' : '')
        + unfilteredCls
        + alignedCls
        + (progress ? ' mg-item--staged' : '')
        + (progress && progress.active ? ' mg-item--active-work' : '')
        + ` mg-fiducia--${MR.segnoFiducia(fb).classe}`;
      item.dataset.id = fb._id;
      // Una fusione ferma aspetta l'owner quanto un blocco: stessa tinta rossa, così si riconosce
      // scorrendo la lista.
      const ferma = fusioneFerma(fb);
      if (ferma) item.classList.add('mg-item--fusione');
      const fusioneTesti = TESTI_FUSIONE_LISTA[(ferma && MR.livelloL5(fb, opzioniLivelli(fb)).fusione) || 'ferma'];
      const arrivata = arrivate.has(String(fb._id));
      if (arrivata) item.classList.add('mg-item--arrivata');
      item.style.borderLeftColor = ferma
        ? MR.REASONS.secaudit.color
        : (cl ? cl.color : (aligned ? MR.ALIGNED_COLOR : 'transparent'));
      // Una riga sola: #N · segno · titolo (ellissi). Il bordo è la famiglia del motivo, il segno chi l'ha fermata.
      const norm = leggibile ? MR.normalizeStatus(fb) : { status: null, statusReason: null };
      // Quante volte questo lavoro si è arenato: si legge `stalls`, che non si azzera, e non
      // `workingResets`, che una consegna vera azzera — facendo sparire il numero quando serve.
      const ripartenze = Math.max(0, Math.round(
        Number(fb.stalls) || Number(fb.workingResets) || 0
      ));
      item.title = (num ? `#${num} · ` : '') + title
        + (norm.statusReason ? ` — ${MR.reasonText(norm.statusReason)}` : '')
        + (ferma ? ` — ${fusioneTesti.tooltip}` : '')
        + (arrivata ? ' — arrivata qui mentre la pagina era aperta' : '')
        + (ripartenze ? ` · rientrato in coda ${ripartenze} volt${ripartenze === 1 ? 'a' : 'e'}` : '');
      const rowHtml = `
        ${authorIconHtml(fb)}
        ${num ? `<span class="mg-item-num">#${esc(num)}</span>` : ''}
        ${leggibile ? segnoFermataHtml(fb) : ''}
        <span class="mg-item-title">${esc(title)}</span>
        ${ferma ? `<span class="mg-fusione-badge" title="${esc(fusioneTesti.titolo)}">${esc(fusioneTesti.etichetta)}</span>` : ''}
        ${leggibile ? '' : statePublicHtml(fb)}
        ${localBadgeHtml(fb)}
        ${attesaBadgeHtml(fb)}
        ${leggibile ? domandaBadgeHtml(fb) : ''}
        ${priorityDotsHtml(fb)}
        ${fiduciaSegnoHtml(fb)}
      `;
      item.innerHTML = progress
        ? `<div class="mg-item-row">${rowHtml}</div>${workStateHtml(progress, fb)}`
        : rowHtml;
      item.addEventListener('click', (e) => {
        // Il click su un pallino priorità non apre il dettaglio (lo gestisce il listener delegato).
        if (e.target.closest('.mg-dot')) return;
        const dom = e.target.closest('.mg-domanda-badge[data-domanda]');
        if (dom) { apriDomandaDelFeedback(dom.dataset.domanda, fb._id); return; }
        openDetail(fb._id);
      });
      mgList.appendChild(item);
    }
  }

  // «Aspetta una domanda» (SPEC-DOMANDE §3.8): il lavoro fermo sta In coda, e il segno porta dove si risponde.
  function domandaBadgeHtml(fb) {
    const id = MR.aspettaDomanda(fb);
    if (!id) return '';
    // Fermo in coda su una domanda (#1577): il motivo è lei, non lo stato.
    const ferme = MR.domandeBloccantiDi(fb);
    const motivo = ferme.includes(id) ? '' : MR.reasonText(MR.normalizeStatus(fb).statusReason);
    const titolo = ferme.includes(id)
      ? `Nessuna routine lo prende finché non rispondi ${ferme.length > 1 ? `alle domande ${ferme.join(', ')}` : `alla domanda ${id}`}: apri ${id}`
      : `Aspetta la tua risposta alla domanda ${id}${motivo ? ` (${motivo})` : ''}: aprila`;
    return `<button type="button" class="mg-domanda-badge" data-domanda="${esc(id)}" title="${esc(titolo)}" aria-label="${esc(titolo)}">aspetta ${esc(id)}</button>`;
  }

  // La domanda si apre nella sua sezione; se non si trova si apre il feedback, che lo dice, invece di non fare niente.
  async function apriDomandaDelFeedback(id, feedbackId) {
    const ok = !!DOMANDE && typeof DOMANDE.apriDomanda === 'function' && await DOMANDE.apriDomanda(id);
    if (ok) return;
    if (feedbackId && selectedId !== feedbackId) openDetail(feedbackId);
    setManageMsg(`La domanda ${id} non si apre adesso: riprova fra poco, o cercala nella sezione Domande.`, 'err');
  }

  // Il segno dei Ricevuti (D93): la forma del livello che ha fermato la pratica, il motivo sotto il puntatore.
  function segnoFermataHtml(fb) {
    const s = MR.segnoFermata(fb, { fusioni, fusioniLette: fusioniOk });
    if (!s || !FORME_SVG[s.forma]) return '';
    const cls = 'mg-segno-fermata' + (s.classe ? ` mg-forma--${s.classe}` : ' mg-segno-fermata--vuoto');
    return `<span class="${cls}" data-forma="${esc(s.forma)}" data-livello="${esc(s.livello)}" title="${esc(s.testo)}" aria-label="${esc(s.testo)}" role="img">`
      + `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${FORME_SVG[s.forma]}"/></svg></span>`;
  }

  // Aperta/Chiusa: quello che si sa di una segnalazione il cui stato fine è
  // cifrato. Viene dall'enum grossolano in chiaro (`statusPublic`), lo stesso
  // che guarda la ricompensa; le parole le sceglie il modulo condiviso, così la
  // gemella non ne usa altre. Se manca anche quello non si scrive niente: una
  // riga vuota è meglio di un'etichetta inventata.
  function statePublicHtml(fb) {
    const label = MR.publicStateLabel(fb);
    if (!label) return '';
    return `<span class="mg-state" title="${esc(`Stato: ${label} — ${MR.PUBLIC_STATE_HINT}`)}">${esc(label)}</span>`;
  }

  // Il segno non sposta di scheda (#1575): l'etichetta lo dice in ogni scheda, o sembrerebbe un lavoro delle routine.
  function localBadgeHtml(fb) {
    if (!MR.isLocalOnly(fb)) return '';
    return `<span class="mg-local-badge" title="${esc(localSignText(fb))}">server</span>`;
  }
  // Lo scudo della fiducia (#1575): pieno se fidata, vuoto e tratteggiato se no; il colore lo ripete il bordo destro.
  function fiduciaSegnoHtml(x) {
    const s = MR.segnoFiducia(x);
    return `<span class="mg-fiducia-segno mg-fiducia-segno--${s.classe}" title="${esc(s.testo)}" aria-label="${esc(s.parola)}" role="img">`
      + `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${FORME_SVG.scudo}"/></svg></span>`;
  }
  // Le attese che segue il server: gli unit sulla fusione (#1207); per un lavoro server la suite di filo-security, il PC (#1159).
  const ATTESE_SERVER = Object.freeze({
    unit: ['Unit sulla fusione', 'Verifica e controllo di sicurezza sono passati: il server fa girare in GitHub gli unit test sul ramo fuso con main di adesso, e con l’esito verde lo porta al cancello e su main. Ricontrolla da solo ogni cinque minuti.'],
    pc: ['Pronto: aspetta il PC', 'Il cancello non può portare il ramo su main di filo-security: il lavoro aspetta il tuo PC. Lo porta su main npm run orchestra -- fusioni-server, che parte anche con avvia, prima la parte dell’app e poi quella del server.'],
    suite: ['Aspetta le prove del server', 'Il cancello porta su main la parte dell’app e poi il ramo di filo-security quando la suite di GitHub è verde su quel commit. Riprova da solo ogni dieci minuti.'],
  });
  function localSignText(fb) {
    const m = fb && fb.localOnly;
    if (!m) return '';
    const quando = Number(m.at) > 0 ? ` il ${formatDateTime(new Date(Number(m.at)).toISOString())}` : '';
    const cosa = !MR.praticaChiusa(fb, { releasedVersion, fusioni }) ? 'Lavoro server. Lo prendono le routine se in Automazioni i lavori server sono accesi, altrimenti una sessione locale.'
      : MR.isPrivateLocalWork(fb) ? 'Era un lavoro server: per questo non sta nella bacheca pubblica.'
        : 'Era un lavoro server: la sua scheda resta nella bacheca pubblica, per chi l’ha mandato.';
    const a = MR.isLocalApproved(fb) ? fb.localApproval : null;
    const si = a ? ` Approvato come lavoro server da ${chiHaMessoIlSegno(a.by)}${Number(a.at) > 0 ? ` il ${formatDateTime(new Date(Number(a.at)).toISOString())}` : ''}.` : '';
    return `${cosa} Segno messo da ${chiHaMessoIlSegno(m.by)}${quando}.${si}`;
  }
  // Una sessione firma il segno col suo mittente (`local:claude`), l'owner con l'email: il mittente si legge come in testata.
  function chiHaMessoIlSegno(by) {
    const s = String(by || '').trim();
    if (s === 'owner') return AUTHOR_META.owner.label;
    if (/^[a-z]+:/i.test(s) && TH && TH.authorKind) {
      const m = AUTHOR_META[TH.authorKind(s)];
      if (m) return m.label;
    }
    return s;
  }

  // ── Riga di stato della lavorazione (card pinnate + dettaglio) ────────────
  // Traduce l'avanzamento (MR.workProgress) in una riga leggibile: i tre
  // passaggi dell'iter come spunte (✓ fatto · ● in corso · ○ da fare) e se
  // un'istanza ci sta lavorando in questo momento.
  function workStateHtml(progress, fb) {
    // Un lavoro server passato aspetta il cancello, GitHub o il PC (#1159); coi lavori server alle routine, un fidato
    // segue il loro iter.
    const attesa = fb ? ATTESE_SERVER[MR.attesaServer(fb)] : null;
    if (attesa) {
      return `<div class="mg-item-state"><span class="mg-work-idle mg-attesa-server" title="${esc(attesa[1])}">${esc(attesa[0])}</span></div>`;
    }
    // Un lavoro locale non ha l'iter delle routine né il loro rientro in coda: lo porta avanti una sessione.
    if (fb && MR.isLocalOnly(fb) && !(mgLavoriServer && mgLavoriServer.checked && MR.isFidato(fb))) {
      const dove = progress.status === 'working' ? 'In lavorazione' : 'In verifica';
      return `<div class="mg-item-state"><span class="mg-work-idle">${dove} in una sessione locale</span></div>`;
    }
    const marks = { done: '✓', current: '●', pending: '○' };
    const steps = progress.steps.map((s) =>
      `<span class="mg-step mg-step--${s.state}" title="${esc(s.label)}: ${
        s.state === 'done' ? 'fatto' : s.state === 'current' ? 'in corso' : 'da fare'
      }">${marks[s.state]} ${esc(s.label)}</span>`
    ).join('<span class="mg-step-sep">·</span>');
    // Quando nessuno sta lavorando, la riga deve dire una cosa VERA. Scriveva
    // "in attesa di ripresa" per una ripresa che il sistema non sapeva fare: i
    // feedback fermi in implementazione non li raccoglieva più nessuno, e due
    // sono rimasti lì per giorni. Adesso il server li rimette in coda da solo, e
    // "sta lavorando ora" si legge dal battito, non dall'ora trascorsa dalla
    // presa in carico — con quella, ogni lavorazione più lunga di un'ora veniva
    // dichiarata morta mentre era viva.
    //
    // Nessun tempo promesso: il momento del rientro dipende da quando il ramo si
    // è fermato, e una riga che dice "fra un'ora" sarebbe di nuovo una cosa non
    // vera.
    // Chi aspetta altri feedback non lo prende nessuno finché non sono fusi: né un verificatore né il rientro in coda.
    const aspetta = !!(ATT && fb && ATT.aspettaAncora(fb, trovaAtteso));
    // Così chi è fermo su una domanda bloccante (#1577): riparte alla risposta.
    const ferme = fb && MR.domandeBloccantiDi(fb).includes(MR.aspettaDomanda(fb)) ? MR.domandeBloccantiDi(fb) : [];
    const who = progress.active
      ? `<span class="mg-work-live"><i></i>Un'istanza ci sta lavorando ora</span>`
      : `<span class="mg-work-idle">${
          ferme.length
            ? esc(`Nessuna istanza al lavoro: riparte quando rispondi a ${ferme.join(', ')}`)
            : aspetta
            ? 'Nessuna istanza al lavoro: riparte quando quelli che aspetta sono fusi'
            : progress.current.key === 'impl'
            ? 'Nessuna istanza al lavoro: rientra in coda da solo'
            : 'Nessuna istanza al lavoro: in attesa di un verificatore'
        }</span>`;
    return `<div class="mg-item-state">${steps}${who}</div>`;
  }

  // Un feedback è «non filtrato» (bianco) quando il panel dei giudici è rimasto parziale; il
  // bottone ne ri-prova solo i giudici mancanti.
  function isUnfiltered(fb) {
    // Su una cifrata «non filtrato» la macchina se lo inventa: la segnalazione finirebbe fra
    // quelle da rimandare ai giudici, crediti spesi su una pratica forse già chiusa.
    if (!statoLeggibile(fb)) return false;
    const cl = MR.classifyBlock(fb);
    return !!(cl && cl.reason === 'unfiltered');
  }
  // Le due barre agiscono solo su quello che si vede: col filtro della fiducia acceso, sulle non fidate.
  function unfilteredFeedbacks() {
    return MR.filtraFiducia(allFeedbacks, soloNonFidate).filter(isUnfiltered);
  }
  function setReevalMsg(text, kind) {
    if (!mgReevalMsg) return;
    mgReevalMsg.textContent = text || '';
    mgReevalMsg.className = 'mg-reeval-msg' + (kind ? ` mg-${kind}` : '');
  }
  // Le due barre agiscono su pratiche ferme ai giudici (L2): col filtro che le nasconde agirebbero su ciò che non si vede.
  function l2Visibili() {
    return !livelliScelti.length || livelliScelti.includes('l2');
  }

  function updateReevalBar() {
    if (!mgReevalBar) return;
    // Senza il criterio ogni segnalazione cifrata ricadrebbe fra i bianchi, e la barra offrirebbe
    // di ri-giudicare anche i chiusi.
    const whites = sezioniAttendibili() ? unfilteredFeedbacks() : [];
    // Solo l'owner, solo nei Ricevuti (dove vivono i bianchi), solo se ce n'è.
    const show = isAdmin && currentTab === 'inbox' && l2Visibili() && whites.length > 0;
    mgReevalBar.hidden = !show;
    if (show && mgReevalBtn) mgReevalBtn.textContent = `Ri-valuta i non filtrati (${whites.length})`;
  }

  // ── Approvazione in blocco degli allineati (macchina a stati) ─────────────
  // L'approvazione È scrivere `todo`: la modalità automatica di oggi non sposta
  // più nulla nelle liste, quindi i blu si mettono in coda da qui (o uno a uno
  // dal dettaglio).
  // `tutti`: anche quelli che il filtro della fiducia nasconde, per chi li conta fuori dalla lista (Automazioni).
  function alignedFeedbacks(tutti) {
    // Stesso motivo dei bianchi: "allineato" è una lettura dello status, e
    // approvare in blocco quello che non si è potuto leggere è la scrittura
    // più pesante della pagina.
    if (!sezioniAttendibili()) return [];
    return MR.filtraFiducia(allFeedbacks, soloNonFidate && !tutti).filter((f) => statoLeggibile(f) && MR.isAligned(f));
  }
  function updateAlignedBar() {
    if (!mgAlignedBar) return;
    const blues = alignedFeedbacks();
    const show = isAdmin && currentTab === 'inbox' && l2Visibili() && blues.length > 0;
    mgAlignedBar.hidden = !show;
    if (!show || !mgAlignedBtn) return;
    mgAlignedBtn.textContent = `Approva tutti gli allineati (${blues.length}) → In coda`;
  }
  async function approveAllAligned() {
    const blues = alignedFeedbacks();
    if (!blues.length || !mgAlignedBtn) return;
    mgAlignedBtn.disabled = true;
    let ok = 0, errs = 0;
    for (const fb of blues) {
      try {
        const r = await sendToMain({
          type: 'feedback_update', id: fb._id,
          reviewDecision: 'accepted', reviewedAt: new Date().toISOString(),
          status: 'todo',
        });
        if (!r || r.ok === false) throw new Error((r && r.error) || 'rifiutato');
        fb.reviewDecision = 'accepted'; fb.status = 'todo'; ok++;
        if (mgAlignedMsg) mgAlignedMsg.textContent = `Approvati ${ok}/${blues.length}…`;
      } catch (_) { errs++; }
    }
    if (mgAlignedMsg) mgAlignedMsg.textContent = errs ? `${ok} approvati, ${errs} falliti.` : `${ok} approvati e messi in coda.`;
    mgAlignedBtn.disabled = false;
    renderList();
  }
  if (mgAlignedBtn) mgAlignedBtn.addEventListener('click', approveAllAligned);
  function startCardEvaluating(id) {
    const card = mgList.querySelector(`.mg-item[data-id="${cssSel(id)}"]`);
    if (!card) return null;
    card.classList.add('mg-item--evaluating');
    if (!card.querySelector('.mg-eval-dots')) {
      const dots = document.createElement('span');
      dots.className = 'mg-eval-dots';
      dots.setAttribute('aria-label', 'Valutazione dei giudici in corso');
      dots.innerHTML = '<i></i><i></i><i></i>';
      card.appendChild(dots);
    }
    try { card.scrollIntoView({ block: 'nearest' }); } catch (_) {}
    return card;
  }
  function stopCardEvaluating(card) {
    if (!card) return;
    card.classList.remove('mg-item--evaluating');
    const dots = card.querySelector('.mg-eval-dots');
    if (dots) dots.remove();
  }

  // Ri-valuta i bianchi UNO ALLA VOLTA: animazione sulla card di turno, un solo id ai giudici,
  // attesa dell'esito, poi il successivo. Così si vede quale stanno valutando ora.
  async function reevaluateUnfiltered() {
    const ids = unfilteredFeedbacks().map((f) => f._id).filter(Boolean);
    if (!ids.length) return;
    mgReevalBtn.disabled = true;

    const total = ids.length;
    let valued = 0;            // quanti feedback hanno recuperato almeno un giudice
    let wasteStreak = 0;       // ri-valutazioni di fila che hanno speso crediti a vuoto
    let stopped = null;        // 'budget' | 'error' | 'nofix' se ci fermiamo prima
    let lastErrorKind = null;  // causa dell'ultimo "a vuoto" (credit/auth/…)

    for (let i = 0; i < total; i++) {
      const id = ids[i];
      setReevalMsg(`Valutazione ${i + 1} di ${total}…`, '');
      const card = startCardEvaluating(id);
      let r;
      try {
        r = await sendToMain({ type: 'feedback_reevaluate', feedbackIds: [id] });
      } catch (e) {
        stopped = 'error';
        stopCardEvaluating(card);
        break;
      }
      stopCardEvaluating(card);
      const { outcome, recovered, errorKind } = MR.classifyReevalResult(r);
      if (outcome === 'error') { stopped = 'error'; break; }
      // "remaining" lato server = budget/tempo esaurito: fermati e riprova dopo.
      if (outcome === 'budget') { stopped = 'budget'; break; }
      if (outcome === 'recovered') {
        valued += recovered ? 1 : 0;
        wasteStreak = 0;
      } else if (outcome === 'wasted') {
        // Giudici rieseguiti ma nessuno recuperato: crediti spesi a vuoto. Più volte di fila è un
        // problema strutturale: fermarsi per non bruciare crediti sul resto della lista.
        if (errorKind) lastErrorKind = errorKind;
        wasteStreak += 1;
        if (wasteStreak >= MR.REEVAL_WASTE_LIMIT) { stopped = 'nofix'; break; }
      }
      // 'noop' (niente da fare): non spende crediti, prosegui.
    }

    // Causa specifica (credito/chiave/modelli/timeout): vince sul generico, così l'owner sa cosa
    // sistemare.
    const hint = MR.reevalErrorHint(lastErrorKind);
    if (stopped === 'budget') {
      setReevalMsg(`Recuperati ${valued} feedback. Limite raggiunto: riprova più tardi.`, 'ok');
    } else if (stopped === 'error') {
      setReevalMsg(`Recuperati ${valued} feedback prima di un errore. Riprova per continuare.`, 'err');
    } else if (stopped === 'nofix') {
      setReevalMsg(
        (hint || 'I giudici hanno continuato a non rispondere e i feedback sono rimasti non filtrati.')
          + ` Mi sono fermato. Recuperati ${valued} feedback.`,
        'err'
      );
    } else {
      setReevalMsg(
        valued
          ? `Recuperati ${valued} feedback.`
          : ((hint || 'Nessun giudice recuperato: i feedback sono rimasti non filtrati (controlla modelli e credito dei giudici).')),
        valued ? 'ok' : 'err'
      );
    }

    // Ricarica: i feedback giudicati escono dai bianchi e si spostano di tab.
    await loadData();
    mgReevalBtn.disabled = false;
  }
  if (mgReevalBtn) mgReevalBtn.addEventListener('click', reevaluateUnfiltered);

  // Ricerca «a senso»: un modello ordina i feedback per pertinenza; se manca o risponde male
  // si ripiega sulle parole, la ricerca non si rompe mai. Logica pura in SN_MANAGE_SEARCH.
  function toggleSearchIcon(on) {
    if (!mgSearchToggle) return;
    mgSearchToggle.classList.toggle('mg-search-toggle--active', on);
    mgSearchToggle.setAttribute('aria-expanded', on ? 'true' : 'false');
  }

  function setSearchMsg(text, kind) {
    if (!mgSearchMsg) return;
    mgSearchMsg.textContent = text || '';
    mgSearchMsg.classList.toggle('mg-err', kind === 'err');
    mgSearchMsg.classList.toggle('mg-count', kind === 'count');
  }

  // Durante la ricerca la lista è trasversale alle schede: le barre della scheda spariscono.
  function hideTabBars() {
    if (mgArchiveFilter) mgArchiveFilter.hidden = true;
    if (mgLivelliFiltro) mgLivelliFiltro.hidden = true;
    // La ricerca cerca fra tutte: il filtro della fiducia non la tocca, quindi non si offre.
    if (mgFiduciaFiltro) mgFiduciaFiltro.hidden = true;
    if (mgReevalBar)     mgReevalBar.hidden = true;
    if (mgAlignedBar)    mgAlignedBar.hidden = true;
  }

  function openSearch() {
    searchMode = true;
    if (mgSearchBar) mgSearchBar.hidden = false;
    toggleSearchIcon(true);
    setSearchMsg('', null);
    // Un invito finché non si cerca davvero: nessun numero, non c'è niente da contare (#495).
    setListHead('Ricerca', null);
    hideTabBars();
    mgListLoading.hidden = true;
    mgList.hidden = true;
    mgList.innerHTML = '';
    mgListEmpty.hidden = false;
    mgListEmpty.textContent = 'Scrivi cosa cerchi e premi Invio.';
    if (mgSearchInput) { try { mgSearchInput.focus(); } catch (_) {} }
  }

  // keepList=true quando è il chiamante a ridisegnare subito: evita un doppio renderList.
  function closeSearch(opts) {
    const keepList = !!(opts && opts.keepList);
    searchSeq++;               // invalida ricerche eventualmente in volo
    stopClassify();
    searchMode = false;
    if (mgSearchBar) mgSearchBar.hidden = true;
    if (mgSearchInput) mgSearchInput.value = '';
    toggleSearchIcon(false);
    setSearchMsg('', null);
    showClassifyProgress(null);
    if (!keepList) renderList();
  }

  // ── Il classificatore della ricerca (#1118) ──────────────────────────────
  // Se in Modelli di supporto c'è un classificatore, legge TUTTI i feedback in parallelo e dice quali sono quelli
  // cercati, con una probabilità; il giro gira nel main e la pagina chiede a che punto è, mostrando i risultati
  // mentre arrivano. Se manca o non risponde, la ricerca resta quella di prima: li ordina il modello, poi le parole.
  const CLASSIFY_MSG = (window.SN_MSG && window.SN_MSG.MSG && window.SN_MSG.MSG.MANAGE_SEARCH_CLASSIFY) || 'manage_search_classify';
  const CLASSIFY_POLL_MS = 200;
  const mgSearchProgress = document.getElementById('mgSearchProgress');
  const mgSearchProgressFill = document.getElementById('mgSearchProgressFill');
  let classifyJob = null;
  const CLASSIFY_ASSENTE = ['NO_MODEL_FOR_ACTION', 'not_admin', 'forbidden'];

  function stopClassify() {
    if (!classifyJob) return;
    const jobId = classifyJob;
    classifyJob = null;
    Promise.resolve().then(() => sendToMain({ type: CLASSIFY_MSG, op: 'stop', jobId })).catch(() => {});
  }

  const numIt = (n) => Number(n || 0).toLocaleString('it-IT', { useGrouping: true });

  // null nasconde la barra; altrimenti quanti feedback ha già letto il classificatore, su quanti.
  function showClassifyProgress(state) {
    if (!mgSearchProgress) return;
    if (!state) { mgSearchProgress.hidden = true; return; }
    const total = Math.max(0, Number(state.total) || 0);
    const done = Math.min(total, Math.max(0, Number(state.done) || 0));
    mgSearchProgress.hidden = false;
    mgSearchProgress.setAttribute('aria-valuemax', String(total));
    mgSearchProgress.setAttribute('aria-valuenow', String(done));
    if (mgSearchProgressFill) mgSearchProgressFill.style.width = `${total ? (done / total) * 100 : 0}%`;
    setSearchMsg(`Letti ${numIt(done)} di ${numIt(total)}`, 'count');
  }

  const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));

  // Torna null se la ricerca è stata superata o il classificatore non è impostato; { used:false, motivo } se c'è ma
  // non ha risposto; { used:true, hits, nota } se ha letto i feedback (anche solo una parte: la nota dice quale).
  async function classifySearch(query, my) {
    if (!SRCH || typeof SRCH.classifierOrder !== 'function') return null;
    const max = SRCH.CLASSIFIER && SRCH.CLASSIFIER.MAX_TEXT;
    const candidates = SRCH.classifierOrder(SRCH.buildCandidates(allFeedbacks, max), query);
    let r = null;
    try { r = await sendToMain({ type: CLASSIFY_MSG, op: 'start', query, candidates }); } catch (_) { r = null; }
    const superata = () => my !== searchSeq || !searchMode;
    if (superata()) {
      if (r && r.ok && r.jobId) sendToMain({ type: CLASSIFY_MSG, op: 'stop', jobId: r.jobId }).catch(() => {});
      return null;
    }
    if (!r) return null;
    // Nessun classificatore impostato, o chi guarda non gestisce Filo: la ricerca di sempre, senza note.
    if (!r.ok) return CLASSIFY_ASSENTE.includes(r.code) ? null : { used: false, motivo: String(r.error || '').trim() };
    classifyJob = r.jobId;
    showClassifyProgress({ done: 0, total: r.total });
    for (;;) {
      await pausa(CLASSIFY_POLL_MS);
      if (superata() || classifyJob !== r.jobId) return null;
      let st = null;
      try { st = await sendToMain({ type: CLASSIFY_MSG, op: 'status', jobId: r.jobId }); } catch (_) { st = null; }
      if (superata() || classifyJob !== r.jobId) return null;
      if (!st || !st.ok) {
        classifyJob = null;
        showClassifyProgress(null);
        return { used: false, motivo: 'Il classificatore si è interrotto.' };
      }
      const hits = Array.isArray(st.hits) ? st.hits : [];
      showClassifyProgress(st);
      if (hits.length) renderSearchResults(hits, { running: true });
      if (!st.finished) continue;
      classifyJob = null;
      showClassifyProgress(null);
      const skipped = Math.max(0, Number(st.skipped) || 0);
      const letti = Math.max(0, (Number(st.done) || 0) - skipped);
      const errore = String(st.error || '').trim();
      if (!letti) return { used: false, motivo: errore };
      let nota = '';
      if (errore) nota = `Il classificatore si è fermato dopo ${numIt(letti)} feedback su ${numIt(st.total)}: ${errore}`;
      else if (skipped) nota = `${numIt(skipped)} feedback non letti dal classificatore.`;
      return { used: true, hits, nota };
    }
  }

  // Le card dei risultati restano le stesse finché la ricerca è la stessa: i risultati del classificatore arrivano
  // mentre la lista è già lì, e una card rifatta a ogni giro perderebbe il clic che ci stava cadendo sopra.
  let resultCards = new Map();

  function resultCard(fb, res) {
    let item = resultCards.get(fb._id);
    if (!item) {
      const num = FB.formatNum(fb.seq, fb.subSeq);
      const title = fb.name || FB.fallbackName(fb.text) || '(senza titolo)';
      item = document.createElement('div');
      item.className = 'mg-item mg-item--result';
      item.dataset.id = fb._id;
      item.innerHTML = `
        ${authorIconHtml(fb)}
        ${num ? `<span class="mg-item-num">#${esc(num)}</span>` : ''}
        <span class="mg-item-title">${esc(title)}</span>
        ${fiduciaSegnoHtml(fb)}
      `;
      item.addEventListener('click', () => openDetail(fb._id));
      resultCards.set(fb._id, item);
    }
    const num = FB.formatNum(fb.seq, fb.subSeq);
    const title = fb.name || FB.fallbackName(fb.text) || '(senza titolo)';
    const p = Number(res.p);
    const reason = String(res.reason || '').trim()
      || (Number.isFinite(p) ? `pertinenza ${Math.round(p * 100)}%` : '');
    item.title = (num ? `#${num} · ` : '') + title + (reason ? ` — ${reason}` : '');
    item.classList.toggle('mg-item--selected', fb._id === selectedId);
    // La card resta, la fiducia può cambiare mentre la si guarda: il segno si riscrive al suo posto.
    const classe = MR.segnoFiducia(fb).classe;
    item.classList.toggle('mg-fiducia--fidata', classe === 'fidata');
    item.classList.toggle('mg-fiducia--nonfidata', classe !== 'fidata');
    const scudo = item.querySelector('.mg-fiducia-segno');
    if (scudo && !scudo.classList.contains(`mg-fiducia-segno--${classe}`)) scudo.outerHTML = fiduciaSegnoHtml(fb);
    return item;
  }

  // Disegna i risultati (ordinati per pertinenza) al posto della lista. `reason`
  // (il perché è pertinente) vive nel tooltip, non nel colore del bordo.
  // `running`: il classificatore sta ancora leggendo, e i risultati sono quelli trovati finora.
  function renderSearchResults(results, opts) {
    const fallback = !!(opts && opts.fallback);
    const running = !!(opts && opts.running);
    hideTabBars();
    mgListLoading.hidden = true;
    // Il motivo del main dice anche dove si imposta il modello: senza, l'owner lo cercava dove non c'è più (#465).
    const motivo = opts && opts.motivo ? String(opts.motivo).trim() : '';
    if (!running) {
      setSearchMsg(fallback
        ? (motivo ? `${motivo} Intanto mostro i risultati per testo.` : 'Modello non disponibile: mostro i risultati per testo.')
        : motivo, null);
    }

    // "Nessun risultato" al tetto del caricamento significa "nessuno fra quelli
    // caricati": la ricerca legge solo i feedback che stanno in pagina.
    const nessuno = () => {
      mgList.hidden = true;
      mgListEmpty.hidden = false;
      mgListEmpty.textContent = running ? 'Cerco…' : 'Nessun feedback pertinente.'
        + (loadHitCap() ? ` ${FB.COUNT_INCOMPLETE_HINT}` : '');
    };

    const cards = [];
    for (const res of results || []) {
      const fb = allFeedbacks.find((f) => f._id === res.id);
      if (fb) cards.push(resultCard(fb, res));
    }
    const keep = new Set(cards);
    for (const child of Array.from(mgList.children)) if (!keep.has(child)) child.remove();
    for (const [id, el] of resultCards) if (!keep.has(el)) resultCards.delete(id);
    // Si sposta solo la card fuori posto: quella già al suo posto non esce dal documento.
    cards.forEach((el, i) => { if (mgList.children[i] !== el) mgList.insertBefore(el, mgList.children[i] || null); });

    // Quanti ne ha trovati è esattamente la domanda della ricerca: zero è una
    // risposta, e si scrive come le altre (#495). Il numero è quello delle card
    // DAVVERO disegnate: un risultato il cui feedback non è più fra i caricati
    // non viene mostrato, e non va contato.
    setListHead('Ricerca', running && !cards.length ? null : cards.length);
    if (!cards.length) { nessuno(); return; }
    mgListEmpty.hidden = true;
    mgList.hidden = false;
  }

  async function runSearch(rawQuery) {
    if (!searchMode || !SRCH) return;
    const query = String(rawQuery || '').trim();
    if (!query) {
      // Campo svuotato: torna all'invito — e il numero se ne va con i risultati.
      searchSeq++;
      stopClassify();
      showClassifyProgress(null);
      setListHead('Ricerca', null);
      mgList.hidden = true; mgList.innerHTML = '';
      resultCards = new Map();
      mgListEmpty.hidden = false; mgListEmpty.textContent = 'Scrivi cosa cerchi e premi Invio.';
      setSearchMsg('', null);
      return;
    }
    const my = ++searchSeq;
    stopClassify();
    showClassifyProgress(null);
    const candidates = SRCH.buildCandidates(allFeedbacks);
    if (!candidates.length) {
      renderSearchResults([], { fallback: false });
      setSearchMsg('Nessun feedback da cercare.', null);
      return;
    }

    // Via il numero della ricerca precedente, che qui sarebbe già falso.
    setListHead('Ricerca', null);
    hideTabBars();
    mgListLoading.hidden = true;
    mgList.hidden = true; mgList.innerHTML = '';
    resultCards = new Map();
    mgListEmpty.hidden = false; mgListEmpty.textContent = 'Cerco…';
    setSearchMsg('', null);

    const cls = await classifySearch(query, my);
    if (my !== searchSeq || !searchMode) return;
    if (cls && cls.used) {
      renderSearchResults(cls.hits, { motivo: cls.nota });
      return;
    }
    // Il classificatore c'è ma non ha risposto: lo si dice accanto ai risultati del modello.
    const motivoCls = cls ? String(cls.motivo || '').replace(/[.\s]+$/, '') : '';
    const notaClassificatore = cls
      ? `Classificatore: ${motivoCls ? motivoCls.replace(/^([A-Z])(?=[a-zà-ù])/, (m) => m.toLowerCase()) : 'nessuna risposta'}. `
      : '';
    if (cls) setSearchMsg('', null);

    const validIds = new Set(candidates.map((c) => c.id));
    let ranked = null;
    let motivo = '';
    try {
      const r = await sendToMain({
        type: (window.SN_MSG && window.SN_MSG.MSG && window.SN_MSG.MSG.AI_REQUEST) || 'ai_request',
        // Funzione propria e non quella di «Categorizza»: in prestito, cambiarne uno cambiava
        // l'altra. Non style-aware (il prompt JSON non va inquinato) e fuori dalla cronologia.
        action: (window.SN_CONST && window.SN_CONST.ACTIONS && window.SN_CONST.ACTIONS.MANAGE_SEARCH) || 'manage_search',
        payload: { messages: SRCH.buildMessages(query, candidates) },
      });
      if (r && r.ok && typeof r.text === 'string') {
        const parsed = SRCH.parseRanking(r.text, validIds);
        if (parsed.length) ranked = parsed;
      } else if (r && r.ok === false && typeof r.error === 'string') {
        motivo = r.error;
      }
    } catch (_) { /* ripiego per parole qui sotto */ }

    // Superata da una ricerca più recente o chiusa nel frattempo: non toccare la UI.
    if (my !== searchSeq || !searchMode) return;

    if (ranked) {
      renderSearchResults(ranked, {
        fallback: false,
        motivo: notaClassificatore ? `${notaClassificatore}Li ha ordinati il modello della ricerca.` : '',
      });
    } else {
      // Ripiego per parole: la ricerca trova comunque qualcosa.
      renderSearchResults(SRCH.keywordSearch(allFeedbacks, query), {
        fallback: true, motivo: `${notaClassificatore}${motivo}`.trim(),
      });
    }
  }

  if (mgSearchToggle) {
    mgSearchToggle.addEventListener('click', () => {
      if (searchMode) { closeSearch(); return; }
      // I risultati prendono il posto della lista dei feedback: da un'altra scheda si torna lì prima di cercare.
      if (!LIST_TABS.includes(schedaPerSezione[sezioneAttiva])) {
        const lista = LIST_TABS.includes(schedaPerSezione.feedback) ? schedaPerSezione.feedback : 'inbox';
        selectTab(lista);
      }
      openSearch();
    });
  }
  if (mgSearchClose) mgSearchClose.addEventListener('click', () => closeSearch());
  if (mgSearchInput) {
    mgSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); runSearch(mgSearchInput.value); }
      else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
    });
  }
  // Esc chiude la ricerca anche col focus fuori dal campo. Idempotente.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchMode && (!mgSearchInput || document.activeElement !== mgSearchInput)) {
      closeSearch();
    }
  });

  // ── Il resto del feedback, quando serve davvero ──────────────────────────
  //
  // L'elenco scarica una proiezione: niente conversazione, livelli, allegati.
  // Sono i campi che pesano, e una riga non ne mostra nessuno — ma il pannello
  // sì. Qui si completa il feedback aperto, una lettura sola, e si ridisegna.
  // La richiesta in corso si ricorda per id: passare due volte sulla stessa
  // riga non la chiede due volte.
  const dettagliInCorso = new Map();

  // Una riga la cui lettura NON è tornata (guasto, tempo scaduto, documento
  // sparito) non è uguale a una mai chiesta: senza il segno il pannello resta
  // su «Caricamento…», chi scrive crede che la conversazione sia vuota, e ogni
  // clic ricompra la stessa lettura mancata.
  function segnaDettaglioMancato(key, motivo) {
    // Sul posto: la stessa riga sta anche nell'indice per mittente e nella
    // lista disegnata, e sostituirla lascerebbe quelle copie senza il segno.
    const riga = allFeedbacks.find((f) => f._id === key);
    if (riga) riga._dettaglioMancato = motivo || 'rete';
  }

  function completaDettaglio(id) {
    const key = String(id || '');
    if (!key) return Promise.resolve(null);
    if (dettagliInCorso.has(key)) return dettagliInCorso.get(key);
    const p = (async () => {
      let rows;
      try {
        rows = await liveSources.getDettagli([key]);
      } catch (e) {
        segnaDettaglioMancato(key, 'rete');
        throw e;
      }
      if (isAdmin && rows.length > 0) {
        try {
          const r = await sendToMain({ type: 'feedback_decrypt_fields', list: rows });
          if (r && r.ok && Array.isArray(r.list)) rows = r.list;
        } catch (_) { /* come al caricamento: valori cifrati piuttosto che niente */ }
      }
      const pieno = rows[0];
      if (!pieno) { segnaDettaglioMancato(key, 'sparito'); return null; }
      // La riga può essere cambiata nel frattempo (giro dal vivo): si tiene
      // quella, completata — non si riporta indietro lo stato appena letto.
      const i = allFeedbacks.findIndex((f) => f._id === key);
      if (i < 0) return null;
      const { _proiezione, _dettaglioMancato, _dettaglioVecchio, ...resto } = allFeedbacks[i];
      // Della riga si tiene quello che un ELENCO sa: lo stato appena riletto
      // vince su quello di prima. I campi del dettaglio no: quelli qui sono la
      // copia vecchia, e rimetterli sopra il documento appena arrivato
      // cancellerebbe proprio il turno nuovo che si stava aspettando.
      for (const campo of (FB.CAMPI_DETTAGLIO || [])) delete resto[campo];
      allFeedbacks[i] = { ...pieno, ...resto };
      reindexByClient();
      return allFeedbacks[i];
    })().finally(() => { dettagliInCorso.delete(key); });
    dettagliInCorso.set(key, p);
    return p;
  }

  // Riprova a leggere il resto, su richiesta dell'owner.
  function riprovaDettaglio(id, btn) {
    const key = String(id || '');
    const riga = allFeedbacks.find((f) => f._id === key);
    if (!riga) return;
    delete riga._dettaglioMancato;
    // Risponde il tasto, non un ridisegno: ridisegnare adesso cancellerebbe
    // una bozza in corso, che è il danno già visto su questo pannello.
    if (btn) { btn.disabled = true; btn.textContent = 'Riprovo…'; }
    completaDettaglio(key)
      .catch((e) => console.warn('[manage] dettaglio non completato:', e?.message || e))
      .finally(() => { if (selectedId === key) ridisegnaRispettandoLaBozza(key); });
  }

  // La conversazione in mano non è quella di adesso: o non è mai arrivata
  // (riga d'elenco), o il documento è cambiato sul server dopo che l'avevamo
  // letta. In tutti e due i casi va riletta prima di scriverci sopra.
  function dettaglioDaRileggere(fb) {
    return !!fb && (FB.soloLista(fb) || !!fb._dettaglioVecchio);
  }

  // Il feedback COMPLETO E AGGIORNATO, aspettando la lettura se serve. Chi
  // APPENDE alla conversazione deve passare di qui: una riga d'elenco non ha
  // le note, e una copia vecchia non ha i turni arrivati dopo — scriverci
  // sopra la risposta cancellerebbe il report invece di aggiungersi in coda.
  // Torna null se nel frattempo la riga non c'è più.
  async function feedbackCompleto(id) {
    const key = String(id || '');
    const riga = allFeedbacks.find((f) => f._id === key);
    if (!riga || !dettaglioDaRileggere(riga)) return riga || null;
    try { await completaDettaglio(key); } catch (_) { /* sotto: una riga non riletta è un no */ }
    const dopo = allFeedbacks.find((f) => f._id === key) || null;
    // La lettura non è riuscita. Tornare la riga com'è la farebbe passare per
    // «questo feedback non ha altro», e chi appende la risposta o il motivo
    // della riapertura scriverebbe il suo testo AL POSTO del report. Meglio
    // niente: chi chiama lo dice.
    return dettaglioDaRileggere(dopo) ? null : dopo;
  }

  // ── Rendering pannello centrale ───────────────────────────────────────────
  // `opts.ridisegno` = questo non è l'owner che apre una segnalazione, è il
  // pannello che si ridipinge da solo (un aggiornamento arrivato da remoto).
  // La differenza conta per la frase: una sezione che l'owner ha aperto non
  // deve richiudersi da sé mentre lui la sta guardando.
  function openDetail(id, opts) {
    const ridisegno = !!(opts && opts.ridisegno && id === selectedId);
    // La frase nella casella e non ancora partita parte ADESSO, finché `selectedId` è quello di
    // prima: un istante dopo finirebbe sul feedback sbagliato.
    if (!ridisegno) salvaFraseAutomatico();
    // Cambiando segnalazione il pannello di destra riparte da zero: la forma scelta era di un'altra
    // pratica. Su un ridisegno resta dov'era.
    if (!ridisegno) livelloAperto = null;
    selectedId = id;
    // Aperta dall'owner: l'arrivo l'ha visto.
    const eraArrivata = !ridisegno && arrivate.delete(String(id));

    document.querySelectorAll('.mg-item').forEach((el) => {
      el.classList.toggle('mg-item--selected', el.dataset.id === id);
      if (el.dataset.id === id) el.classList.remove('mg-item--arrivata');
    });
    if (eraArrivata) updateTabCounts();

    const fb = allFeedbacks.find((f) => f._id === id);
    if (!fb) return;

    // Aperto da un elenco proiettato: il resto arriva adesso e il pannello si
    // ridisegna da sé. Nel frattempo quello che c'è si vede già, e la parte
    // che manca lo dice invece di sembrare vuota.
    // Una lettura già fallita riparte solo dal «Riprova»: altrimenti tornare
    // sulla stessa segnalazione la ricomprava a ogni clic, senza fine.
    if (dettaglioDaRileggere(fb) && !fb._dettaglioMancato) {
      completaDettaglio(id)
        .catch((e) => console.warn('[manage] dettaglio non completato:', e?.message || e))
        // Anche quando non è arrivato: è il ridisegno che lo fa dire.
        .finally(() => { if (selectedId === id) ridisegnaRispettandoLaBozza(id); });
    }

    mgDetailEmpty.hidden = true;
    mgDetail.hidden = false;

    // Tutto ciò che il pannello dice partendo dallo stato passa da qui: la regola della barra delle
    // sezioni, un gradino più in dentro.
    const leggibile = statoLeggibile(fb);

    const clientId = fb.clientId || 'anonimo';
    const dateStr  = formatDate(fb.createdAt);
    // Chi ha scritto, in chiaro (#443): l'identificativo grezzo diceva
    // "filo:chat" dove serviva leggere "Filo, per conto di un utente". Resta
    // ispezionabile passandoci sopra e nel pannello del mittente.
    mgDetailHead.innerHTML = `Da <a class="mg-sender-link" id="senderLink" href="#" data-client="${esc(clientId)}" title="${esc(clientId)}">${esc(senderLabel(fb))}</a> il ${dateStr}<div class="mg-segno" id="mgSegnoTestata" hidden></div>`;
    document.getElementById('senderLink').addEventListener('click', (e) => {
      e.preventDefault();
      openSidebarSender(senderKeyOf(fb));
    });
    leggiSegno(fb);

    renderLivelliRow(fb);

    // Solo per i feedback nell'iter; stessi contenuti della card pinnata in lista.
    if (mgWorkState) {
      const progress = leggibile ? MR.workProgress(fb) : null;
      mgWorkState.hidden = !progress;
      mgWorkState.innerHTML = progress ? workStateHtml(progress, fb) : '';
    }

    renderThread(fb);

    // Azioni di stato (owner-only). QUALI sono NON lo decide più questa pagina:
    // le legge da MR.ownerActions, la stessa tabella che disegna i pulsanti
    // della pagina dei feedback. Prima erano due insiemi costruiti a mano, e
    // sulla stessa segnalazione offrivano cose diverse (#509, terzo giro).
    //
    // Stato illeggibile: la tabella non offre niente e il blocco sparisce. I
    // pulsanti nascono dallo stato, e su una segnalazione cifrata la macchina
    // lo inventa (`unlabeled`): offrire "→ In coda" o "Conferma attacco" su una
    // pratica che potrebbe essere già chiusa è peggio che non offrire niente.
    renderActions(fb);
    disegnaSegnoTestata(fb);
    if (!ridisegno) setClarifyMsg('', '');

    // La barra dell'owner sta in piedi per lui e per nessun altro. La frase per chi ha segnalato
    // è in chiaro: si legge e si scrive anche senza la chiave privata.
    if (mgOwnerBar) mgOwnerBar.hidden = !isAdmin;

    // La frase parte CHIUSA su ogni segnalazione: si scrive una volta sola, e da aperta mangia
    // una fetta di dettaglio. Su un ridisegno resta com'era.
    if (mgUserNote) {
      const restaAperta = ridisegno && !mgUserNote.hidden;
      if (!restaAperta) collassaFrase();
      mgUserNoteText.value = String(fb.userNote || '');
      riflettiFrase(mgUserNoteText.value);
      // Il valore con cui la riga è stata riempita: una bozza è ciò che differisce.
      mgUserNoteText.dataset.saved = mgUserNoteText.value;
      userNoteToccata = false;
      // Il salvataggio di un ALTRO feedback può essere in volo: il bottone è uno solo, e spegnerlo
      // qui bloccherebbe una scrittura che non c'entra.
      mgUserNoteBtn.disabled = false;
      setUserNoteMsg('', '');
    }

    mgManage.hidden = !isAdmin;
    reflectManage(fb);
    setManageMsg('', '');

    // Pannello laterale: su un ridisegno (aggiornamento continuo della stessa
    // pratica) la forma che l'owner stava leggendo resta aperta e si riempie
    // di nuovo, come già fa quando cambia l'elenco delle fusioni; a chiuderlo
    // era ogni ridisegno, e con una segnalazione lunga si perdeva il punto.
    // Cambiando pratica si chiude, come sempre. Su una pratica che aspetta la
    // risposta dell'owner si apre invece il rombo verde: lì si risponde (#1061).
    const domandeGiaDisegnate = ridisegno && attesaDisegnata === fb._id;
    attesaDisegnata = rispostaOfferta(fb) ? fb._id : null;
    if (ridisegno && livelloAperto) {
      quandoPannelloLibero(() => {
        if (selectedId !== fb._id || !livelloAperto) return;
        riapriPannelloLivello(allFeedbacks.find((f) => f._id === fb._id) || fb);
      });
    } else if (attesaDisegnata && !domandeGiaDisegnate) openSidebarLivello(fb, 'l3');
    else closeSidebar();
  }

  function riapriPannelloLivello(fb) {
    const scrolls = [mgSideBody, mgSide].map((el) => (el ? el.scrollTop : 0));
    if (livelloAperto === 'l2' && giudiceAperto != null) openSidebarJudge(fb, giudiceAperto);
    else openSidebarLivello(fb, livelloAperto);
    [mgSideBody, mgSide].forEach((el, i) => { if (el) el.scrollTop = scrolls[i]; });
  }

  // Il preferito è un flag in chiaro, indipendente dallo stato: resta anche su una
  // segnalazione illeggibile. Archivia/Ripristina invece è un'azione di stato.
  function reflectManage(fb) {
    mgStarBtn.disabled = false;
    const starred = MR.isStarred(fb);
    mgStarBtn.setAttribute('aria-pressed', starred ? 'true' : 'false');
    mgStarBtn.textContent = starred ? '★ Preferito' : '☆ Preferito';
    mgStarBtn.title = starred ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti';
    reflectAttese(fb);
    reflectFiducia(fb);
  }

  // ── «💻 Lavoro server» sul rombo azzurro (#913, #1575) ────────────────────
  // Il segno a mano non c'è più: lo mette il server quando chi lavora lo chiede (#1358). Resta l'uscita dei rombi
  // azzurri nati prima, dove il sì dell'owner vale anche alla fusione: un segnalato si guarda prima.
  const TITOLO_LAVORO_LOCALE = 'Diventa un lavoro server e torna In coda. Lo lavorano le routine se in Automazioni i lavori server sono accesi, altrimenti una sessione. La fusione non aspetta il tuo sì.';
  function titoloLavoroLocale(fb) {
    const c = MR.localApprovalCheck(fb, { releasedVersion, fusioni });
    return c.segnalato ? `${TITOLO_LAVORO_LOCALE} Attenzione: ${c.segnalato}, guardalo prima.` : TITOLO_LAVORO_LOCALE;
  }

  // ── «Segna fidato» (#1148) ────────────────────────────────────────────────
  // Al posto di «Fondi senza chiedermelo» e di «È mio»: vale PRIMA del lavoro. Lo scrive il server, mai la pagina;
  // non pulisce un ramo né le note già scritte da una sessione sporca (SPEC-DOMANDE.md §1.5).
  const TITOLO_FIDUCIA = 'L’hai letto e ti fidi: i giudici non servono più, il lavoro passa davanti a pari priorità, e un lavoro scritto solo da sessioni pulite si fonde senza chiederti il via libera.';
  function titoloFiducia(fb) {
    const c = MR.fiduciaCheck(fb);
    return c.segnalato ? `${TITOLO_FIDUCIA} Attenzione: ${c.segnalato}, guardalo prima.` : TITOLO_FIDUCIA;
  }
  // Premuto: da dove viene la fiducia, e che un clic la toglie (se si può mettere si può togliere).
  const TITOLO_TOGLI_FIDUCIA = 'Un clic la toglie: quello che nasce da qui torna a passare dai giudici, e la fusione a chiederti il via libera.';
  function titoloTogliFiducia(fb) {
    return `${MR.fiduciaText(fb)} ${TITOLO_TOGLI_FIDUCIA}`;
  }
  function reflectFiducia(fb) {
    if (!mgFiduciaBtn) return;
    const on = MR.isFidato(fb);
    const c = on ? MR.fiduciaTogliCheck(fb) : MR.fiduciaCheck(fb);
    mgFiduciaBtn.hidden = !isAdmin || !c.ok;
    mgFiduciaBtn.disabled = false;
    mgFiduciaBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    mgFiduciaBtn.textContent = on ? '🤝 Fidato' : '🤝 Segna fidato';
    mgFiduciaBtn.title = on ? titoloTogliFiducia(fb) : titoloFiducia(fb);
  }
  async function impostaFiducia(id, valore) {
    const fb = allFeedbacks.find((f) => f._id === id);
    if (!fb || !(valore ? MR.fiduciaCheck(fb) : MR.fiduciaTogliCheck(fb)).ok) return;
    const num = FB.formatNum(fb.seq, fb.subSeq);
    const chi = num ? ` (#${num})` : '';
    if (selectedId === id && mgFiduciaBtn) mgFiduciaBtn.disabled = true;
    setManageMsg(valore ? 'Lo segno fidato…' : 'Tolgo la fiducia…', '');
    try {
      const r = await sendToMain(valore ? { type: FIDUCIA_SEGNA, feedbackId: id } : { type: FIDUCIA_SEGNA, feedbackId: id, fidato: false });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'il server non ha risposto');
      // Il server l'ha scritto: la rilettura porterà lo stesso valore, intanto la pagina lo dice subito.
      const ora = allFeedbacks.find((f) => f._id === id) || fb;
      ora.fiducia = valore ? 'fidato' : 'non_fidato';
      ora.fiduciaDa = { by: 'owner', at: Date.now() };
      // Chi aspettava la fiducia per il server è ripartito nello stesso gesto, come lavoro server (#1358).
      if (r.rimessoInCoda) Object.assign(ora, { status: 'todo', statusReason: '', localOnly: { by: 'owner', at: Date.now() } });
      if (selectedId === id) { if (r.rimessoInCoda) openDetail(id, { ridisegno: true }); else reflectManage(ora); }
      renderList();
      updateTabCounts();
      setManageMsg(valore
        ? (r.rimessoInCoda ? `Da ora${chi} è fidato, ed è ripartito In coda come lavoro server.` : `Da ora${chi} è fidato.`)
        : `Da ora${chi} non è più fidato: quello che nasce da qui passa dai giudici, e la fusione chiede il tuo sì.`, 'ok');
    } catch (e) {
      setManageMsg(`${valore ? 'Non segnato fidato' : 'Fiducia non tolta'}${chi}: ${e.message || 'Errore'}`, 'err');
    } finally {
      if (mgFiduciaBtn) mgFiduciaBtn.disabled = false;
    }
  }
  if (mgFiduciaBtn) {
    mgFiduciaBtn.addEventListener('click', () => {
      if (selectedId) impostaFiducia(selectedId, mgFiduciaBtn.getAttribute('aria-pressed') !== 'true');
    });
  }

  // ── «Aspetta #N» (#903) ───────────────────────────────────────────────────
  // I feedback da fondere prima: finché uno non lo è nessuna routine lo prende, e qui sta fra quelli che aspettano.
  // Numeri, esistenza e giri li controlla il main (MSG.FEEDBACK_UPDATE); la regola sta in SN_FB_ATTESE.
  function trovaAtteso(id) {
    return allFeedbacks.find((f) => f._id === id) || attesiFuori.get(id);
  }
  function opzSezioni(extra) {
    return Object.assign({ releasedVersion, fusioni, trovaAtteso }, extra);
  }
  // Gli aspettati più vecchi della finestra caricata: una lettura, poi la lista si ridisegna con il loro stato.
  function caricaAttesiFuori() {
    if (!ATT || !isAdmin || !dataLoaded) return;
    const mancano = [];
    for (const fb of allFeedbacks) {
      for (const w of ATT.atteseDi(fb)) {
        if (attesiChiesti.has(w.id) || allFeedbacks.some((f) => f._id === w.id)) continue;
        attesiChiesti.add(w.id);
        mancano.push(w.id);
      }
    }
    if (!mancano.length) return;
    (async () => {
      let righe = await FB.getMany(mancano, { fields: FB.CAMPI_LISTA, timeoutMs: 20000 });
      if (righe.length) {
        const r = await sendToMain({ type: 'feedback_decrypt_fields', list: righe });
        if (r && r.ok && Array.isArray(r.list)) righe = r.list;
      }
      for (const r of righe) attesiFuori.set(r._id, r);
      for (const id of mancano) if (!attesiFuori.has(id)) attesiFuori.set(id, { _id: id, missing: true });
      renderList();
      const aperto = selectedId && allFeedbacks.find((f) => f._id === selectedId);
      if (aperto) reflectAttese(aperto);
    })().catch(() => { /* restano «stato non letto»: chi li aspetta resta fra quelli che aspettano, come per la coda */ });
  }

  function numeroDi(doc) {
    return doc ? FB.formatNum(doc.seq, doc.subSeq) : '';
  }
  function statoAttesaTesto(w) {
    if (w.stato !== ATT.STATO.APERTO) return ATT.ETICHETTA[w.stato] || w.stato;
    const doc = trovaAtteso(w.id);
    const info = doc && window.SN_FB_STATUS && window.SN_FB_STATUS.STATUSES[MR.normalizeStatus(doc).status];
    if (!info) return ATT.ETICHETTA.aperto;
    return info.tab === 'inbox' ? 'nei Ricevuti' : info.label.toLowerCase();
  }
  function testoStatiAttese(stati) {
    return `Aspetta ${stati.map((w) => `${ATT.etichetta(w)} (${statoAttesaTesto(w)})`).join(', ')}. `
      + 'Finché non sono tutti fusi nessuna routine lo prende.';
  }
  function attesaBadgeHtml(fb) {
    if (!ATT) return '';
    const stati = ATT.statiDelleAttese(fb, trovaAtteso);
    const aperte = stati.filter((w) => w.stato !== ATT.STATO.FUSO);
    if (!aperte.length) return '';
    return `<span class="mg-attesa-badge" title="${esc(testoStatiAttese(stati))}">⏳ ${esc(aperte.map(ATT.etichetta).join(' '))}</span>`;
  }

  function reflectAttese(fb) {
    if (!mgAtteseToggle || !mgAttese || !ATT) return;
    const stati = ATT.statiDelleAttese(fb, trovaAtteso);
    const chiusa = MR.praticaChiusa(fb, opzSezioni());
    mgAtteseToggle.hidden = !isAdmin || (chiusa && !stati.length);
    mgAtteseToggle.disabled = false;
    mgAtteseToggle.textContent = !stati.length ? '⏳ Aspetta'
      : stati.length <= 3 ? `⏳ Aspetta ${ATT.testoAttese(stati)}` : `⏳ Aspetta ${stati.length} feedback`;
    mgAtteseToggle.classList.toggle('mg-attese-piena', stati.some((w) => w.stato !== ATT.STATO.FUSO));
    mgAtteseToggle.title = stati.length ? testoStatiAttese(stati)
      : 'Fallo aspettare un altro feedback: nessuna routine lo prende finché quello non è fuso.';
    const mostra = isAdmin && (stati.length > 0 || atteseApertePer === fb._id);
    mgAttese.hidden = !mostra;
    mgAtteseToggle.setAttribute('aria-expanded', mostra ? 'true' : 'false');
    if (mgAtteseScrivi) mgAtteseScrivi.hidden = chiusa;
    if (mgAtteseTogliTutte) mgAtteseTogliTutte.hidden = stati.length < 2;
    mgAtteseLista.innerHTML = stati.map((w) => {
      const nota = statoAttesaTesto(w);
      const apribile = allFeedbacks.some((f) => f._id === w.id);
      return `<li class="mg-attesa mg-attesa--${esc(w.stato)}" data-id="${esc(w.id)}">`
        + `<button type="button" class="mg-attesa-num" data-azione="apri" ${apribile ? `title="Apri ${esc(ATT.etichetta(w))}"` : 'disabled'}>${esc(ATT.etichetta(w))}</button>`
        + `<span class="mg-attesa-stato">${esc(nota)}</span>`
        + (chiusa ? '' : `<button type="button" class="mg-attesa-togli" data-azione="togli" title="Non aspettare più ${esc(ATT.etichetta(w))}" aria-label="Non aspettare più ${esc(ATT.etichetta(w))}">×</button>`)
        + '</li>';
    }).join('');
  }

  // Le attese da riscrivere, tranne `salvo`: per numero quelle di un aspettato che la pagina vede, per id le altre
  // (cancellato, non letto, senza numero), che il main tiene come sono invece di rifiutarle cercandone il numero.
  function atteseDaTenere(fb, salvo = '') {
    return ATT.atteseDi(fb).filter((w) => w.id !== salvo).map((w) => {
      const doc = trovaAtteso(w.id);
      const n = doc && !doc.missing ? (w.num || numeroDi(doc)) : '';
      return n || { id: w.id };
    });
  }

  async function scriviAttese(id, voci) {
    const fb = allFeedbacks.find((f) => f._id === id);
    if (!fb || !ATT) return false;
    const num = numeroDi(fb);
    const chi = num ? `#${num}` : 'Il feedback';
    const tieni = voci.filter((v) => v && typeof v === 'object').map((v) => v.id);
    const lette = ATT.leggiNumeri(voci.filter((v) => typeof v === 'string'));
    if (!lette.ok) { setManageMsg(`Attese non scritte: ${lette.motivo}.`, 'err'); return false; }
    const vuoto = !lette.numeri.length && !tieni.length;
    for (const b of [mgAtteseToggle, mgAtteseAggiungi, mgAtteseTogliTutte]) if (b) b.disabled = true;
    setManageMsg(vuoto ? 'Tolgo le attese…' : 'Scrivo le attese…', '');
    try {
      const r = await sendToMain(Object.assign({ type: 'feedback_update', id, waitsFor: lette.numeri.join(', ') }, tieni.length ? { waitsTieni: tieni } : {}));
      if (!r || r.ok === false) throw new Error((r && r.error) || 'aggiornamento rifiutato');
      fb.waitsFor = Array.isArray(r.waitsFor) && r.waitsFor.length ? r.waitsFor : undefined;
      // Si chiude col gesto che toglie l'ultima, non con la risposta: un'attesa tenuta per id resta da guardare.
      if (vuoto && atteseApertePer === id) atteseApertePer = '';
      else if (!vuoto) atteseApertePer = id;
      renderList();
      if (selectedId === id) reflectAttese(fb);
      const dove = MR.manageTabFor(fb, opzSezioni());
      setManageMsg(fb.waitsFor
        ? `Da ora ${chi} aspetta ${ATT.testoAttese(fb.waitsFor)}${dove === 'waiting' ? ': nessuna routine lo prende finché non sono tutti fusi.' : '.'}`
        : `${chi} non aspetta più niente.`, 'ok');
      return true;
    } catch (e) {
      setManageMsg(`Attese non scritte: ${e.message || 'Errore'}`, 'err');
      return false;
    } finally {
      for (const b of [mgAtteseToggle, mgAtteseAggiungi, mgAtteseTogliTutte]) if (b) b.disabled = false;
    }
  }

  // Una scrittura alla volta, e ciascuna calcola l'elenco solo quando tocca a lei: calcolato prima, un gesto fatto
  // mentre la precedente è in volo riscriverebbe l'elenco vecchio e la cancellerebbe.
  let codaAttese = Promise.resolve();
  function accodaAttese(id, calcola) {
    const giro = codaAttese.then(() => {
      const fb = allFeedbacks.find((f) => f._id === id);
      return fb ? scriviAttese(id, calcola(fb)) : false;
    });
    codaAttese = giro.catch(() => false);
    return giro;
  }

  function apriCasellaAttese(id) {
    if (selectedId !== id) openDetail(id);
    atteseApertePer = id;
    const fb = allFeedbacks.find((f) => f._id === id);
    if (fb) reflectAttese(fb);
    if (mgAtteseInput && mgAttese && !mgAttese.hidden) mgAtteseInput.focus();
  }
  async function aggiungiAttese() {
    const fb = selectedId && allFeedbacks.find((f) => f._id === selectedId);
    if (!fb || !mgAtteseInput) return;
    const nuovi = ATT.leggiNumeri(mgAtteseInput.value);
    if (!nuovi.ok) { setManageMsg(`Attese non scritte: ${nuovi.motivo}.`, 'err'); return; }
    if (!nuovi.numeri.length) { mgAtteseInput.focus(); return; }
    // Il campo si libera subito per il numero dopo; a un rifiuto torna il testo, se nel frattempo non se n'è scritto altro.
    const testo = mgAtteseInput.value;
    mgAtteseInput.value = '';
    const ok = await accodaAttese(fb._id, (f) => [...atteseDaTenere(f), ...nuovi.numeri]);
    if (!ok && !mgAtteseInput.value) mgAtteseInput.value = testo;
  }
  if (mgAtteseToggle) {
    mgAtteseToggle.addEventListener('click', () => {
      const fb = selectedId && allFeedbacks.find((f) => f._id === selectedId);
      if (!fb) return;
      // Con le attese la casella resta aperta (lo stato di ciascuna è quello che si viene a guardare): il tasto porta lì.
      if (mgAttese.hidden || ATT.atteseDi(fb).length) { apriCasellaAttese(fb._id); return; }
      atteseApertePer = '';
      reflectAttese(fb);
    });
  }
  if (mgAtteseAggiungi) mgAtteseAggiungi.addEventListener('click', () => { aggiungiAttese(); });
  if (mgAtteseInput) {
    mgAtteseInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); aggiungiAttese(); }
      if (e.key === 'Escape' && !mgAtteseInput.value) {
        const fb = selectedId && allFeedbacks.find((f) => f._id === selectedId);
        atteseApertePer = '';
        if (fb) reflectAttese(fb);
      }
    });
  }
  if (mgAtteseTogliTutte) {
    mgAtteseTogliTutte.addEventListener('click', () => { if (selectedId) accodaAttese(selectedId, () => []); });
  }
  if (mgAtteseLista) {
    mgAtteseLista.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-azione]');
      const li = btn && btn.closest('.mg-attesa[data-id]');
      const fb = li && selectedId && allFeedbacks.find((f) => f._id === selectedId);
      if (!fb) return;
      if (btn.dataset.azione === 'apri') { openFromAttesa(li.dataset.id); return; }
      const via = li.dataset.id;
      accodaAttese(fb._id, (f) => atteseDaTenere(f, via));
    });
  }
  // Dall'attesa alla pratica aspettata, nella sua sezione.
  function openFromAttesa(id) {
    const altro = allFeedbacks.find((f) => f._id === id);
    if (!altro) return;
    const tab = sezioneDi(altro);
    if (tab && tab !== currentTab) selectTab(tab);
    openDetail(id);
  }

  // La riga dei tasti, quando non entra, scorre di lato (#1034): la rotella normale deve bastare a raggiungerli.
  const mgOwnerTasti = mgOwnerBar && mgOwnerBar.querySelector('.mg-owner-tasti');
  if (mgOwnerTasti) {
    mgOwnerTasti.addEventListener('wheel', (e) => {
      if (mgOwnerTasti.scrollWidth <= mgOwnerTasti.clientWidth || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      e.preventDefault();
      mgOwnerTasti.scrollLeft += e.deltaY;
    }, { passive: false });
  }

  // L'etichetta di stato non si scrive nel dettaglio (scelta dell'owner): lo dicono il colore
  // della scheda e le forme, e la decisione presa si legge nel pannello del triangolo.

  // Ogni azione ha un id stabile, così resta indirizzabile da fuori. Archivia e Ripristina
  // condividono l'id: sono i due versi della stessa azione e non compaiono mai insieme.
  const ACTION_BTN_ID = {
    accept: 'mgAcceptBtn',
    accept_local: 'mgAcceptLocalBtn',
    confirm_attack: 'mgConfirmBtn',
    confirm_spam: 'mgConfirmSpamBtn',
    archive: 'mgArchiveBtn',
    restore: 'mgArchiveBtn',
    resolve: 'mgResolveBtn',
    reopen: 'mgReopenBtn',
  };
  const ACTION_TITLE = {
    accept: 'Approva la segnalazione e mettila in coda di lavorazione',
    accept_local: TITOLO_LAVORO_LOCALE,
    confirm_attack: 'Conferma che è un attacco: esce dai Ricevuti e resta consultabile negli Archiviati',
    confirm_spam: 'Conferma che è spam: esce dai Ricevuti e resta consultabile negli Archiviati',
    archive: 'Sposta la segnalazione negli archiviati',
    restore: 'Riporta la segnalazione in coda',
    resolve: 'Chiudi la segnalazione a mano',
    reopen: 'Riapri spiegando cosa manca ancora',
  };
  const ACTION_PROGRESS = {
    accept: 'Metto in coda…',
    accept_local: 'Lo passo ai lavori server…',
    confirm_attack: 'Conferma in corso…',
    confirm_spam: 'Conferma in corso…',
    archive: 'Archivio…',
    restore: 'Ripristino…',
    resolve: 'Chiudo…',
    reopen: 'Riapro…',
  };

  function renderActions(fb) {
    if (!mgActions || !mgActionsRow) return;
    chiudiRiapertura();
    chiudiConfermaSegno();
    setActionMsg('', '');
    mgActionsRow.querySelectorAll('button').forEach((b) => b.remove());
    const azioni = (isAdmin && fb) ? MR.ownerActions(fb, { releasedVersion }) : [];
    // Chi aspetta una domanda si sblocca rispondendo lì: è la prima azione, e la sola strada per farlo ripartire.
    const domandaId = (isAdmin && fb) ? MR.aspettaDomanda(fb) : '';
    mgActions.hidden = !azioni.length && !domandaId;
    if (domandaId) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sn-btn';
      b.id = 'mgDomandaBtn';
      b.dataset.domanda = domandaId;
      b.textContent = `Rispondi alla domanda ${domandaId}`;
      b.title = 'Si risponde in un posto solo: la domanda, con le sue opzioni. La risposta fa ripartire il lavoro.';
      b.addEventListener('click', () => apriDomandaDelFeedback(domandaId));
      mgActionsRow.appendChild(b);
    }
    if (!azioni.length) {
      if (mgAcceptComment) mgAcceptComment.hidden = true;
      return;
    }
    // Il commento di revisione accompagna le decisioni sui Ricevuti; altrove non c'è niente da
    // commentare e la casella sarebbe rumore.
    if (mgAcceptComment) {
      const conCommento = azioni.some((a) => a.kind === 'accept' || a.kind === 'reject');
      mgAcceptComment.hidden = !conCommento;
      mgAcceptComment.value = '';
      mgAcceptComment.placeholder = MR.classifyBlock(fb)
        ? 'Commento (opzionale): perché lo sblocchi…'
        : 'Commento (opzionale): perché lo approvi…';
    }
    for (const a of azioni) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sn-btn' + (a.primary ? '' : ' sn-btn-secondary');
      const id = ACTION_BTN_ID[a.key];
      if (id) b.id = id;
      b.dataset.actionKey = a.key;
      b.textContent = a.label;
      b.title = a.key === 'accept_local' ? titoloLavoroLocale(fb) : (ACTION_TITLE[a.key] || a.label);
      b.addEventListener('click', () => {
        if (a.kind === 'reopen') { apriRiapertura(); return; }
        applyAction(a, null);
      });
      mgActionsRow.appendChild(b);
    }
    aggiornaBottoneSegno(fb);
  }

  // Una scrittura in volo spegne TUTTA la riga, non solo il bottone premuto:
  // «Archivia» premuto mentre «→ In coda» è ancora in volo scriverebbe due
  // decisioni sulla stessa segnalazione.
  let azioniInVolo = false;
  function setActionsBusy(busy) {
    azioniInVolo = !!busy;
    if (mgActionsRow) mgActionsRow.querySelectorAll('button').forEach((b) => { b.disabled = !!busy; });
    if (mgSideBody) mgSideBody.querySelectorAll('[data-strada]').forEach((b) => { b.disabled = !!busy; });
    if (mgReopenConfirm) mgReopenConfirm.disabled = !!busy;
    if (mgReopenCancel) mgReopenCancel.disabled = !!busy;
  }

  // Il cammino UNICO di ogni azione di stato del pannello.
  async function applyAction(action, extra) {
    if (!selectedId || !action) return;
    const id = selectedId;
    const fb = allFeedbacks.find((f) => f._id === id);
    if (!fb) return;
    // Il guardiano sta SOTTO ai pulsanti: si scrive solo uno stato che la segnalazione offre
    // adesso, o un pannello rimasto aperto riscrive un attacco confermato ad «archiviato».
    if (!MR.ownerActionAllowsStatus(fb, action.to, { releasedVersion })) {
      renderActions(fb);
      setActionMsg('Lo stato di questa segnalazione è cambiato: questa azione non è più disponibile.', 'err');
      return;
    }
    // La riga per chi ha segnalato parte PRIMA del cambio di stato, e il
    // cambio di stato non parte se lei non è arrivata: chiudere una
    // segnalazione buttando via l'unica frase che il mittente leggerà è il
    // modo più facile di perderla, e succedeva in silenzio.
    // Il commento della revisione si legge PRIMA dell'attesa qui sotto: nel
    // frattempo la casella può svuotarsi, e il "perché" andrebbe perso senza
    // che niente lo dica.
    const comment = (mgAcceptComment && !mgAcceptComment.hidden) ? (mgAcceptComment.value || '').trim() : '';
    setActionsBusy(true);
    const fraseOk = await fraseAlSicuro();
    if (!fraseOk) {
      setActionsBusy(false);
      setActionMsg('La frase per chi ha segnalato non si è salvata: riprova prima di cambiare stato.', 'err');
      mostraFrase(true);
      return;
    }
    // Nell'attesa l'owner può essere passato a un'altra segnalazione: l'azione era per questa.
    if (selectedId !== id) { setActionsBusy(false); return; }
    const payload = { type: 'feedback_update', id, status: action.to };
    const locale = { status: action.to };
    if (action.kind === 'accept' || action.kind === 'reject') {
      const decision = action.kind === 'accept' ? 'accepted' : 'rejected';
      payload.reviewDecision = decision;
      payload.reviewComment = comment;
      payload.reviewedAt = new Date().toISOString();
      locale.reviewDecision = decision;
      locale.reviewComment = comment;
      locale.reviewedAt = payload.reviewedAt;
    }
    // Archiviazione a mano = scelta esplicita: vince per sempre sull'auto-archiviazione a punteggio
    // (DC3), in un verso e nell'altro.
    if (action.kind === 'archive') { payload.archiveOverride = 'archived'; locale.archiveOverride = 'archived'; }
    if (action.kind === 'restore') { payload.archiveOverride = 'keep_open'; locale.archiveOverride = 'keep_open'; }
    if (extra && typeof extra.notes === 'string') { payload.notes = extra.notes; locale.notes = extra.notes; }
    // #913: il segno, e il sì dell'owner a chi ne ha bisogno, nella stessa scrittura dell'approvazione. Il CHI lo
    // mette il main.
    if (action.locale) { payload.localOnly = true; if (action.approva) payload.localApproval = true; }

    setActionsBusy(true);
    setActionMsg(ACTION_PROGRESS[action.key] || 'Salvo…', '');
    try {
      const r = await sendToMain(payload);
      if (!r || r.ok === false) throw new Error((r && r.error) || 'aggiornamento rifiutato');
      if (action.locale) {
        const segno = { by: (r && r.by) || 'te', at: Number(r && r.at) || Date.now() };
        locale.localOnly = segno;
        if (action.approva) locale.localApproval = { ...segno };
      }
      Object.assign(fb, locale);
      updateTabCounts();
      if (action.locale) {
        const num = FB.formatNum(fb.seq, fb.subSeq);
        // Il sì dato leggendo il testo nei Ricevuti è anche fiducia (SPEC-DOMANDE.md §1.1): senza, la fusione
        // del lavoro locale tornerebbe a chiederlo. La scrive il server.
        let fiducia = '';
        if (!MR.isFidato(fb)) {
          const f = await sendToMain({ type: FIDUCIA_SEGNA, feedbackId: id }).catch((err) => ({ ok: false, error: err.message }));
          if (f && f.ok) { fb.fiducia = 'fidato'; fb.fiduciaDa = { by: 'owner', at: Date.now() }; } else fiducia = ` Non segnato fidato: ${(f && f.error) || 'il server non ha risposto'}.`;
        }
        toast(`${num ? `#${num}` : 'Il feedback'} è In coda come lavoro server.${fiducia}`, fiducia ? 'err' : 'ok');
      }
      // Nell'attesa l'owner può aver aperto un ALTRO feedback. Il dato è
      // salvato lo stesso e la lista si ridisegna, ma il pannello NON si tocca:
      // chiuderlo adesso chiuderebbe il dettaglio dell'altro feedback, che
      // sparirebbe sotto le mani senza motivo apparente.
      if (selectedId !== id) { renderList(); return; }
      // La segnalazione cambia sezione: chiudi il dettaglio e ricalcola la lista.
      selectedId = null;
      mgDetail.hidden = true;
      mgDetailEmpty.hidden = false;
      mgActions.hidden = true;
      collassaFrase();
      mgManage.hidden = true;
      if (mgOwnerBar) mgOwnerBar.hidden = true;
      chiudiRiapertura();
      chiudiConfermaSegno();
      closeSidebar();
      renderList();
    } catch (e) {
      setActionsBusy(false);
      if (selectedId !== id) return;
      setActionMsg(e.message || 'Errore', 'err');
    }
  }

  // Riapertura di un fix già uscito. Come la gemella: chiede COSA manca e lo appende alla
  // conversazione come turno dell'utente, così il report di chi ci ha lavorato resta leggibile.
  function chiudiRiapertura() {
    if (!mgReopen) return;
    mgReopen.hidden = true;
    if (mgReopenText) mgReopenText.value = '';
    // I due bottoni del modulo vivono nell'HTML: senza riaccenderli qui, una riapertura riuscita li
    // lascerebbe spenti per sempre.
    if (mgReopenConfirm) mgReopenConfirm.disabled = false;
    if (mgReopenCancel) mgReopenCancel.disabled = false;
  }

  function conversazioneIlleggibile(fb) {
    const T = window.SN_FEEDBACK_THREAD;
    const notes = String((fb && fb.notes) || '');
    return !!(T && T.reportUnreadable && T.reportUnreadable(notes));
  }

  const RIAPERTURA_ILLEGGIBILE = 'La conversazione di questo feedback non è leggibile su questo computer '
    + '(manca la chiave privata): riaprirlo adesso sostituirebbe il report. Configura la chiave e riprova.';

  // Il resto della segnalazione non è arrivato: scrivere adesso metterebbe
  // questo testo al posto del report. Vale per tutti i tasti che appendono
  // alla conversazione, quindi la frase sta in un posto solo.
  const CONVERSAZIONE_NON_ARRIVATA = 'La conversazione di questa segnalazione non è arrivata: '
    + 'scrivere adesso la sostituirebbe. Riprova dal pannello qui sopra.';

  function apriRiapertura() {
    if (!mgReopen) return;
    const fb = allFeedbacks.find((f) => f._id === selectedId);
    if (!fb) return;
    // Come per la risposta ai chiarimenti: non si riscrive una conversazione che non si è letta.
    if (conversazioneIlleggibile(fb)) { setActionMsg(RIAPERTURA_ILLEGGIBILE, 'err'); return; }
    setActionMsg('', '');
    mgReopen.hidden = false;
    if (mgReopenText) mgReopenText.focus();
  }

  async function confermaRiapertura() {
    // Quello che l'owner ha scritto si legge PRIMA di ogni attesa, come nella
    // gemella che risponde a un chiarimento: durante l'attesa la casella può
    // svuotarsi, e allora si riaprirebbe la segnalazione senza il motivo.
    const reason = mgReopenText ? (mgReopenText.value || '').trim() : '';
    // La conversazione su cui si appende va letta PRIMA: dall'elenco arriva
    // senza note, e appenderci sopra il motivo le cancellerebbe.
    const fb = await feedbackCompleto(selectedId);
    if (!fb) { setActionMsg(CONVERSAZIONE_NON_ARRIVATA, 'err'); return; }
    const azione = MR.ownerActionFor(fb, 'reopen', { releasedVersion });
    if (!azione) {
      chiudiRiapertura();
      renderActions(fb);
      setActionMsg('Questa segnalazione non è più riapribile: lo stato è cambiato.', 'err');
      return;
    }
    const oldNotes = String(fb.notes || '');
    if (conversazioneIlleggibile(fb)) { setActionMsg(RIAPERTURA_ILLEGGIBILE, 'err'); return; }
    let extra = null;
    if (reason) {
      const T = window.SN_FEEDBACK_THREAD;
      const ts = new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
      const newNotes = T
        ? T.appendUserTurn(oldNotes, reason, { ts, label: 'Riaperto il' })
        : (oldNotes ? `${oldNotes}\n\n--- Riaperto il ${ts} ---\n${reason}` : `--- Riaperto il ${ts} ---\n${reason}`);
      extra = { notes: newNotes };
    }
    applyAction(azione, extra);
  }

  if (mgReopenCancel) mgReopenCancel.addEventListener('click', () => { chiudiRiapertura(); });
  if (mgReopenConfirm) mgReopenConfirm.addEventListener('click', confermaRiapertura);
  if (mgReopenText) {
    mgReopenText.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); chiudiRiapertura(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); confermaRiapertura(); }
    });
  }

  // ── Segno di mittente pericoloso (#922) ───────────────────────────────────
  // Lo tiene il server: qui c'è la copia letta, per mittente. Toglierlo è un gesto suo, con una conferma che
  // dice cosa cambia; approvare non lo tocca (il perché sta accanto a MR.FRASE_SEGNO_ERRATO).
  // Un segno può arrivare mentre la pagina è aperta (un attacco nuovo): la copia si rilegge dopo due minuti.
  const SEGNO_VALIDO_MS = 2 * 60 * 1000;

  // Senza un mittente leggibile due feedback non si possono dire dello stesso: la copia resta del feedback.
  function chiaveSegno(fb) {
    const c = String((fb && fb.clientId) || '').trim();
    if (!c || MR.valueUnreadable(c)) return 'fb:' + String((fb && fb._id) || '');
    return 'm:' + chiaveServerMittente(fb);
  }
  function segnoDi(fb) { return fb ? segniMittente.get(chiaveSegno(fb)) || null : null; }
  function segnoAttivo(fb) { const s = segnoDi(fb); return !!(s && s.flagged); }

  function leggiSegno(fb, opts) {
    if (!isAdmin || !fb || !fb._id) return;
    const k = chiaveSegno(fb);
    const prima = segniMittente.get(k);
    if (prima && prima.leggo) return;
    if (prima && prima.letto && !(opts && opts.forza) && Date.now() - prima.letto < SEGNO_VALIDO_MS) return;
    const inizio = Date.now();
    segniMittente.set(k, Object.assign({}, prima, { leggo: true }));
    sendToMain({ type: FEEDBACK_SENDER_FLAG, feedbackId: fb._id, action: 'read' })
      .catch((e) => ({ ok: false, error: e?.message || String(e) }))
      .then((r) => {
        const ora = segniMittente.get(k) || {};
        // Un segno tolto mentre questa lettura era in volo vale più di lei.
        if (ora.scritto && ora.scritto > inizio) { segniMittente.set(k, Object.assign({}, ora, { leggo: false })); return; }
        if (r && r.ok !== false) {
          segniMittente.set(k, { flagged: !!r.flagged, reason: r.reason || '', flaggedAt: r.flaggedAt || '',
            clearedAt: r.clearedAt || '', letto: Date.now() });
        } else if (r && (r.code === 'not_admin' || r.code === 'forbidden')) {
          // Il main non ci riconosce come owner: non c'è niente da dire, e niente da ritentare a ogni apertura.
          segniMittente.set(k, { letto: Date.now() });
        } else {
          // Una lettura fallita non cancella quella buona di prima: la tiene, e alla prossima apertura riprova.
          const vecchio = ora.letto ? ora : {};
          segniMittente.set(k, Object.assign({}, vecchio, { leggo: false, letto: 0, errore: (r && r.error) || 'Lettura non riuscita.' }));
        }
        disegnaSegno();
      });
  }

  // La riga che dice il segno, in dati: la usano la testata e il pannello del mittente.
  function rigaSegno(s) {
    if (!s) return null;
    if (s.flagged) {
      const motivo = MR.motivoSegnoText(s.reason);
      const quando = s.flaggedAt ? formatDate(s.flaggedAt) : '';
      const testo = `⚑ Mittente segnato come pericoloso${motivo ? `: ${motivo}` : ''}${quando && quando !== '—' ? ` · dal ${quando}` : ''}`;
      // In testata il motivo lungo si accorcia a due righe: qui sopra resta intero.
      return { tipo: 'segnato', testo, titolo: `${testo}\nFinché il segno resta, ogni suo feedback si ferma al filtro d’ingresso.` };
    }
    if (s.clearedAt) {
      const motivo = MR.motivoSegnoText(s.reason);
      return { tipo: 'tolto', testo: `Segno tolto il ${formatDate(s.clearedAt)}`, titolo: motivo ? `Era: ${motivo}` : '' };
    }
    if (s.errore) return { tipo: 'errore', testo: 'Segno del mittente non letto', titolo: s.errore };
    return null;
  }

  function nodoRigaSegno(riga, fb) {
    const el = document.createElement('span');
    el.className = `mg-segno-testo mg-segno--${riga.tipo}`;
    el.textContent = riga.testo;
    if (riga.titolo) el.title = riga.titolo;
    if (riga.tipo !== 'errore') return el;
    const wrap = document.createElement('span');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mg-segno-riprova';
    btn.textContent = 'Riprova';
    btn.addEventListener('click', () => { btn.disabled = true; leggiSegno(fb, { forza: true }); });
    wrap.append(el, btn);
    return wrap;
  }

  function disegnaSegnoTestata(fb) {
    const el = document.getElementById('mgSegnoTestata');
    if (!el) return;
    const riga = (isAdmin && fb) ? rigaSegno(segnoDi(fb)) : null;
    el.replaceChildren(...(riga ? [nodoRigaSegno(riga, fb)] : []));
    el.hidden = !riga;
  }

  // Accanto all'approvazione, e solo su un feedback fermato proprio dal segno che c'è ancora.
  function aggiornaBottoneSegno(fb) {
    if (!mgActionsRow) return;
    const esiste = mgActionsRow.querySelector('#mgSegnoBtn');
    const serve = !!(isAdmin && fb && !mgActions.hidden && MR.fermatoDalSegno(fb) && segnoAttivo(fb));
    if (!serve) {
      if (esiste) esiste.remove();
      chiudiConfermaSegno();
      return;
    }
    if (esiste) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sn-btn sn-btn-secondary';
    b.id = 'mgSegnoBtn';
    b.textContent = 'Il segno era un errore';
    b.title = 'Toglie il segno a chi l’ha mandato. Approvare da solo non lo toglie.';
    b.addEventListener('click', apriConfermaSegno);
    const accept = mgActionsRow.querySelector('[data-action-key="accept"]');
    if (accept) accept.after(b); else mgActionsRow.appendChild(b);
  }

  function disegnaSegno() {
    const fb = selectedId ? allFeedbacks.find((f) => f._id === selectedId) : null;
    disegnaSegnoTestata(fb);
    aggiornaBottoneSegno(fb);
    disegnaSegnoMittente();
  }

  async function togliSegno(fbId) {
    const fb = allFeedbacks.find((f) => f._id === fbId);
    if (!fb) return { ok: false, error: 'Questo feedback non è più in pagina.' };
    const k = chiaveSegno(fb);
    if (segniInVolo.has(k)) return { ok: false, error: 'Sto già togliendo questo segno.' };
    segniInVolo.add(k);
    let r;
    try {
      r = await sendToMain({ type: FEEDBACK_SENDER_FLAG, feedbackId: fb._id, action: 'clear', conferma: MR.FRASE_SEGNO_ERRATO });
    } catch (e) {
      r = { ok: false, error: e?.message || String(e) };
    } finally {
      segniInVolo.delete(k);
    }
    if (!r || r.ok === false) return { ok: false, error: (r && r.error) || 'Il server non ha tolto il segno.' };
    const prima = segniMittente.get(k) || {};
    segniMittente.set(k, {
      flagged: !!r.flagged, reason: r.reason || prima.reason || '', flaggedAt: r.flaggedAt || prima.flaggedAt || '',
      clearedAt: r.clearedAt || '', letto: Date.now(), scritto: Date.now(),
    });
    disegnaSegno();
    return { ok: true };
  }

  const DOMANDA_SEGNO = 'Togli il segno a questo mittente? Da adesso i suoi feedback passano dai giudici come quelli di '
    + 'tutti. Quelli già arrivati restano dove sono.';

  // La conferma, una sola per le due strade (dettaglio e pannello del mittente).
  function boxConfermaSegno(fbId, { onNo, onEsito }) {
    const frag = document.createDocumentFragment();
    const domanda = document.createElement('div');
    domanda.className = 'mg-segno-domanda';
    domanda.textContent = DOMANDA_SEGNO;
    const riga = document.createElement('div');
    riga.className = 'mg-actions-row';
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'sn-btn sn-btn-secondary mg-segno-no';
    no.textContent = 'Annulla';
    const si = document.createElement('button');
    si.type = 'button';
    si.className = 'sn-btn mg-segno-si';
    si.textContent = 'Togli il segno';
    no.addEventListener('click', onNo);
    si.addEventListener('click', async () => {
      si.disabled = true; no.disabled = true;
      si.textContent = 'Tolgo il segno…';
      const r = await togliSegno(fbId);
      si.disabled = false; no.disabled = false;
      si.textContent = 'Togli il segno';
      onEsito(r);
    });
    riga.append(no, si);
    frag.append(domanda, riga);
    return frag;
  }

  function chiudiConfermaSegno() {
    if (!mgSegnoConferma) return;
    mgSegnoConferma.hidden = true;
    mgSegnoConferma.replaceChildren();
  }

  function apriConfermaSegno() {
    if (!mgSegnoConferma || !selectedId) return;
    const id = selectedId;
    setActionMsg('', '');
    mgSegnoConferma.replaceChildren(boxConfermaSegno(id, {
      onNo: chiudiConfermaSegno,
      onEsito: (r) => {
        if (selectedId !== id) {
          toast(r.ok ? 'Segno tolto.' : `Il segno resta: ${r.error}`, r.ok ? 'ok' : 'err');
          return;
        }
        chiudiConfermaSegno();
        if (r.ok) setActionMsg('Segno tolto: i prossimi feedback di questo mittente passano dai giudici.', 'ok');
        else setActionMsg(`Il segno resta: ${r.error}`, 'err');
      },
    }));
    mgSegnoConferma.hidden = false;
    const no = mgSegnoConferma.querySelector('.mg-segno-no');
    if (no) no.focus();
  }
  if (mgSegnoConferma) {
    mgSegnoConferma.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); chiudiConfermaSegno(); }
    });
  }

  // Il pannello del mittente: stessa riga della testata, stesso gesto, stessa conferma.
  function disegnaSegnoMittente() {
    const el = document.getElementById('mgSideSegno');
    if (!el || !mittenteAperto) return;
    // Una conferma aperta non si ridisegna sotto le mani: il suo esito ridisegna da sé.
    if (el.querySelector('.mg-segno-conferma:not([hidden])')) return;
    const fb = allFeedbacks.find((f) => f._id === mittenteAperto.fbId) || null;
    const riga = (isAdmin && fb) ? rigaSegno(segnoDi(fb)) : null;
    el.replaceChildren();
    el.hidden = !riga;
    if (!riga) return;
    el.appendChild(nodoRigaSegno(riga, fb));
    if (!segnoAttivo(fb)) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sn-btn sn-btn-secondary mg-segno-btn';
    btn.id = 'mgSideSegnoBtn';
    btn.textContent = 'Il segno era un errore';
    btn.title = 'Toglie il segno a questo mittente.';
    const conferma = document.createElement('div');
    conferma.className = 'mg-segno-conferma';
    conferma.hidden = true;
    const esito = document.createElement('span');
    esito.className = 'mg-action-msg';
    esito.setAttribute('role', 'status');
    const chiudi = () => { conferma.hidden = true; conferma.replaceChildren(); btn.hidden = false; };
    btn.addEventListener('click', () => {
      esito.textContent = '';
      conferma.replaceChildren(boxConfermaSegno(fb._id, {
        onNo: chiudi,
        onEsito: (r) => {
          chiudi();
          if (r.ok) { disegnaSegnoMittente(); toast('Segno tolto: i prossimi feedback di questo mittente passano dai giudici.', 'ok'); return; }
          esito.className = 'mg-action-msg mg-err';
          esito.textContent = `Il segno resta: ${r.error}`;
        },
      }));
      conferma.hidden = false;
      btn.hidden = true;
      const no = conferma.querySelector('.mg-segno-no');
      if (no) no.focus();
    });
    conferma.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); chiudi(); } });
    el.append(btn, conferma, esito);
  }

  function setManageMsg(text, kind) {
    mgManageMsg.textContent = text || '';
    mgManageMsg.className = 'mg-action-msg' + (kind ? ` mg-${kind}` : '');
    riflettiMessaggiOwner();
  }

  // `starred` è indipendente dallo stato: l'owner può parcheggiare qualunque feedback. Compare
  // nel filtro ⭐ degli Archiviati.
  async function toggleStarred() {
    if (!selectedId) return;
    const id = selectedId;
    const fb = allFeedbacks.find((f) => f._id === id);
    if (!fb) return;
    const next = !MR.isStarred(fb);

    mgStarBtn.disabled = true;
    setManageMsg(next ? 'Aggiungo ai preferiti…' : 'Rimuovo dai preferiti…', '');
    try {
      const r = await sendToMain({ type: 'feedback_update', id, starred: next });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'aggiornamento rifiutato');
      fb.starred = next;
      // Col filtro ⭐ acceso gli Archiviati elencano i preferiti: cambiarne uno cambia quel numero
      // anche da un'altra scheda, dove la lista non si ridisegna.
      updateTabCounts();
      // Nell'attesa il pannello può essere passato a un altro feedback: ridipingerlo direbbe il
      // falso su quello aperto.
      if (selectedId !== id) { if (currentTab === 'archived' && starredOnly) renderList(); return; }
      reflectManage(fb);
      setManageMsg(next ? 'Aggiunto ai preferiti.' : 'Rimosso dai preferiti.', 'ok');
      // Se il filtro ⭐ è attivo, un feedback de-preferito deve sparire dalla lista.
      if (currentTab === 'archived' && starredOnly) renderList();
    } catch (e) {
      // Come il ramo di successo: se il pannello è passato a un altro feedback, l'errore di questo
      // non ci va scritto sopra.
      if (selectedId !== id) return;
      setManageMsg(e.message || 'Errore', 'err');
    } finally {
      mgStarBtn.disabled = false;
    }
  }

  mgStarBtn.addEventListener('click', toggleStarred);

  // La casella della risposta e il rombo verde della fila nascono dalla stessa domanda.
  function rispostaOfferta(fb) {
    return !!(isAdmin && fb && statoLeggibile(fb) && MR.aspettaRisposta(fb));
  }
  function scriviBozzaRisposta(casella) {
    if (!selectedId) return;
    const v = casella.value || '';
    if (v) bozzeRisposta.set(selectedId, v); else bozzeRisposta.delete(selectedId);
  }
  function tastiRisposta(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendClarifyReply(e.currentTarget); }
  }

  function riflettiEsitoRisposta(el) {
    el.textContent = esitoRisposta.text;
    el.className = 'mg-action-msg' + (esitoRisposta.kind ? ` mg-${esitoRisposta.kind}` : '');
  }
  function setClarifyMsg(text, kind) {
    esitoRisposta = { text: text || '', kind: kind || '' };
    const el = document.getElementById('mgSideRispostaMsg');
    if (el) riflettiEsitoRisposta(el);
  }

  // Risposta dell'owner a un feedback in `clarify`: la risposta si appende alle
  // note (come turno utente, preservando lo storico) e il feedback rientra in
  // coda (todo) per la prossima passata.
  async function sendClarifyReply(origine) {
    if (!selectedId) return;
    const id = selectedId;
    if (rispostaInVolo.has(id)) return;
    const reply = (bozzeRisposta.get(id) || '').trim();
    if (!reply) { const c = document.getElementById('mgSideRispostaText') || origine; if (c) c.focus(); return; }
    // Come la riapertura: la conversazione si legge intera prima di
    // appenderci la risposta, o al suo posto resterebbe la sola risposta.
    const fb = await feedbackCompleto(id);
    if (!fb) { setClarifyMsg(CONVERSAZIONE_NON_ARRIVATA, 'err'); return; }
    const oldNotes = fb.notes || '';
    // Da quando il report viaggia cifrato, la conversazione può arrivare qui
    // illeggibile (chiave assente, o decifratura fallita e al suo posto un
    // segnaposto). Appenderci sopra la risposta e risalvare cancellerebbe il
    // report vero: si scrive solo su ciò che si è potuto leggere.
    const T = window.SN_FEEDBACK_THREAD;
    if (T && T.reportUnreadable && T.reportUnreadable(oldNotes)) {
      setClarifyMsg('La conversazione di questo feedback non è leggibile su questo computer (manca la chiave privata): '
        + 'rispondere adesso la sostituirebbe. Configura la chiave e riprova.', 'err');
      return;
    }
    // Lo stesso guardiano delle azioni di stato: in coda ci si rimette solo da dove la tabella
    // condivisa lo prevede.
    if (fb && !MR.ownerActionAllowsStatus(fb, 'todo', { releasedVersion })) {
      setClarifyMsg('Lo stato di questa segnalazione è cambiato: aggiorna e riprova.', 'err');
      return;
    }
    const newNotes = T
      ? T.appendUserTurn(oldNotes, reply, {})
      : (oldNotes ? `${oldNotes}\n\n${reply}` : reply);

    rispostaInVolo.add(id);
    bottoneRisposta();
    setClarifyMsg('Invio in corso…', '');
    try {
      const r = await sendToMain({ type: 'feedback_update', id, status: 'todo', notes: newNotes });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'aggiornamento rifiutato');
      if (fb) { fb.status = 'todo'; fb.notes = newNotes; }
      bozzeRisposta.delete(id);
      // Nell'attesa l'owner può aver aperto un ALTRO feedback. Il dato è
      // salvato lo stesso e la lista si ridisegna, ma il pannello NON si tocca:
      // chiuderlo adesso chiuderebbe il dettaglio dell'altro feedback, che
      // sparirebbe sotto le mani senza motivo apparente.
      if (selectedId !== id) { renderList(); return; }
      // Il feedback non è più in chiarimento: esce dalla tab Ricevuti.
      selectedId = null;
      mgDetail.hidden = true;
      mgDetailEmpty.hidden = false;
      collassaFrase();
      if (mgOwnerBar) mgOwnerBar.hidden = true;
      closeSidebar();
      renderList();
    } catch (e) {
      if (selectedId !== id) return;
      setClarifyMsg(e.message || 'Errore nell\'invio', 'err');
    } finally {
      rispostaInVolo.delete(id);
      bottoneRisposta();
    }
  }

  // Il tasto è uno solo e segue la pratica che il pannello mostra ADESSO.
  function bottoneRisposta() {
    const b = document.getElementById('mgSideRispostaBtn');
    if (b) b.disabled = rispostaInVolo.has(selectedId);
  }

  // Nel pannello del rombo verde, sotto le domande: l'unico posto dove si risponde (#1061).
  function pannelloRisposta(fb) {
    const box = document.createElement('div');
    box.className = 'mg-liv-risposta';
    const t = document.createElement('textarea');
    t.id = 'mgSideRispostaText';
    t.className = 'mg-accept-comment';
    t.rows = 3;
    t.placeholder = 'Rispondi a Claude…';
    t.value = bozzeRisposta.get(fb._id) || '';
    t.addEventListener('input', () => scriviBozzaRisposta(t));
    t.addEventListener('keydown', tastiRisposta);
    const riga = document.createElement('div');
    riga.className = 'mg-actions-row';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sn-btn';
    btn.id = 'mgSideRispostaBtn';
    btn.textContent = 'Invia risposta';
    btn.title = 'La risposta entra nella conversazione e la segnalazione torna in coda.';
    btn.disabled = rispostaInVolo.has(fb._id);
    btn.addEventListener('click', () => sendClarifyReply(t));
    const msg = document.createElement('span');
    msg.id = 'mgSideRispostaMsg';
    msg.setAttribute('role', 'status');
    riflettiEsitoRisposta(msg);
    riga.appendChild(btn); riga.appendChild(msg);
    box.appendChild(t); box.appendChild(riga);
    return box;
  }

  // La casella ricorda se l'owner ci ha messo mano dopo l'ultimo invio (allora comanda lui) e
  // quale invio è l'ultimo partito: le risposte tornano in ordine diverso.
  let userNoteToccata = false;
  // Uno per feedback: due salvataggi su feedback diversi sono indipendenti, due sullo stesso
  // si scavalcano e comanda il più recente SPEDITO, non quello che risponde per ultimo.
  const userNoteInvii = new Map();
  // L'ultimo testo SPEDITO, per feedback: «è cambiato qualcosa?» fatta sul valore memorizzato
  // risponde «Nessuna modifica» a chi rimette la riga di prima, che resta ritirata.
  const userNoteSpedito = new Map();
  // Dopo una scrittura fallita non si sa cosa ci sia a destinazione: si marca IGNOTO, che non
  // combacia con niente, così il salvataggio dopo riparte.
  const FRASE_IGNOTA = Symbol('frase ignota');

  // Il modulo della frase sta chiuso finché non lo si chiede: è un testo che si scrive una
  // volta sola. Aprendolo il cursore ci finisce dentro: chi preme quel tasto vuole scrivere.
  function mostraFrase(aperta) {
    if (!mgUserNote) return;
    mgUserNote.hidden = !aperta;
    if (mgUserNoteToggle) mgUserNoteToggle.setAttribute('aria-expanded', aperta ? 'true' : 'false');
    if (aperta && mgUserNoteText) mgUserNoteText.focus();
  }
  function collassaFrase() { mostraFrase(false); }

  // Da chiusa, la sezione non direbbe che una frase c'è già: il tasto se lo tiene addosso
  // (pallino + bordo) e la mostra intera nell'hover.
  function riflettiFrase(frase) {
    if (!mgUserNoteToggle) return;
    const t = MR.tastoFrase(frase);
    mgUserNoteToggle.classList.toggle('mg-usernote-piena', t.piena);
    mgUserNoteToggle.title = t.titolo;
  }

  if (mgUserNoteToggle) {
    mgUserNoteToggle.addEventListener('click', () => {
      mostraFrase(!!(mgUserNote && mgUserNote.hidden));
    });
  }

  function setUserNoteMsg(text, kind) {
    if (!mgUserNoteMsg) return;
    mgUserNoteMsg.textContent = text || '';
    mgUserNoteMsg.className = 'mg-action-msg' + (kind ? ` mg-${kind}` : '');
    // Il salvataggio può fallire a sezione già richiusa, e un errore lì non lo legge nessuno.
    if (kind === 'err') mostraFrase(true);
  }

  // Salva SOLO la frase: non tocca la conversazione, quindi si scrive anche col report
  // illeggibile. True = a destinazione c'è quello che l'owner ha scritto; false = fallita.
  async function saveUserNote(opts) {
    const muto = !!(opts && opts.muto);
    if (!selectedId) return true;
    const id = selectedId;
    const fb = allFeedbacks.find((f) => f._id === id);
    const frase = (mgUserNoteText.value || '').trim().slice(0, 500);
    const gia = userNoteSpedito.has(id) ? userNoteSpedito.get(id) : String((fb && fb.userNote) || '');
    if (gia === frase) { if (!muto) setUserNoteMsg('Nessuna modifica', ''); return true; }

    // Da qui la casella è «partita»: se l'owner ci rimette mano, quello che scrive vince sulla
    // risposta che arriverà.
    userNoteToccata = false;
    const mio = (userNoteInvii.get(id) || 0) + 1;
    userNoteInvii.set(id, mio);
    userNoteSpedito.set(id, frase);

    mgUserNoteBtn.disabled = true;
    setUserNoteMsg('Salvataggio…', '');
    try {
      const r = await sendToMain({ type: 'feedback_update', id, userNote: frase });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'aggiornamento rifiutato');
      // L'ORDINE DI QUESTE TRE GUARDIE È IL PUNTO. 1) Una risposta superata da un salvataggio più
      // recente non tocca niente, o farebbe ricomparire parole già sostituite.
      if (mio !== userNoteInvii.get(id)) return true;
      // 2) Il dato si aggiorna SEMPRE, anche se intanto l'owner è passato a un altro feedback:
      // la scrittura è riuscita davvero, e rientrando deve trovare quello che ha salvato.
      if (fb) fb.userNote = frase;
      userNoteSpedito.delete(id);
      // 3) La SCHERMATA si tocca solo se è ancora quella di questo feedback, o il salvataggio
      // dopo manderebbe il messaggio di uno al mittente dell'altro.
      if (selectedId !== id) return true;
      // La casella si riallinea solo se l'owner non ci ha messo mano dopo l'invio, o gli cancella
      // la correzione sotto le dita. Confrontare col testo inviato non basta: è già ridipinta.
      if (!userNoteToccata) {
        mgUserNoteText.value = frase;
        // Quello che c'è a destinazione È quello che si vede: senza, la casella resta «in bozza»
        // per sempre e ogni aggiornamento su questa segnalazione viene trattenuto.
        mgUserNoteText.dataset.saved = frase;
      }
      // Il tasto porta il segno di quello che c'è a destinazione: da chiuso è l'unico posto dove si
      // vede che una frase esiste.
      riflettiFrase(frase);
      setUserNoteMsg(frase ? 'Salvata' : 'Frase rimossa', 'ok');
      renderThread(fb);
      return true;
    } catch (e) {
      // Superata da un invio più recente: comanda quello, ed è quello a dire se è arrivata.
      if (mio !== userNoteInvii.get(id)) return true;
      // Non è arrivato, e una precedente potrebbe esserci: da qui non sappiamo cosa ci sia. Va
      // marcato SEMPRE, anche guardando un altro feedback, o il salvataggio dopo si perde.
      userNoteSpedito.set(id, FRASE_IGNOTA);
      if (selectedId === id) setUserNoteMsg(e.message || 'Errore nel salvataggio', 'err');
      return false;
    } finally {
      mgUserNoteBtn.disabled = false;
    }
  }

  // La frase si salva da sola: mentre si scrive, dopo una pausa, e al blur. Col solo tasto,
  // ridipingere il pannello buttava via senza dirlo l'unica riga che il mittente leggerà.
  const FRASE_PAUSA_MS = 1500;
  // L'ultimo salvataggio partito, e COSA portava: chi deve sapere se la frase è
  // a destinazione (un'azione di stato, il tasto premuto un istante dopo che la
  // casella ha perso il fuoco) aspetta questo invece di spedirlo una seconda
  // volta.
  let userNoteInVolo = null;
  let userNoteInVoloTesto = null;

  function fraseInCasella() {
    return mgUserNoteText ? (mgUserNoteText.value || '').trim().slice(0, 500) : '';
  }
  // C'è qualcosa da spedire? La domanda si fa su quello che è PARTITO, non su quello che la
  // pagina ricorda: finché la risposta non torna, un ripensamento verrebbe inghiottito.
  function bozzaFrase() {
    if (!mgUserNoteText || !selectedId) return false;
    const fb = allFeedbacks.find((f) => f._id === selectedId);
    const gia = userNoteSpedito.has(selectedId)
      ? userNoteSpedito.get(selectedId)
      : String((fb && fb.userNote) || '');
    return gia !== fraseInCasella();
  }
  // Pausa, Ctrl da solo, cambio e chiusura della scheda: le uscite le ascolta la regola condivisa delle caselle.
  const caselleFrase = window.SN_CASELLE.crea();
  caselleFrase.registra('frase', () => { salvaFraseAutomatico(); });
  function annullaSalvataggioProgrammato() {
    caselleFrase.spedita('frase');
  }
  // Salva ORA, se non è già a destinazione. Ritorna la promessa dell'esito, così chi deve
  // proseguire può aspettarla.
  function salvaFraseSubito(opts) {
    annullaSalvataggioProgrammato();
    const testo = fraseInCasella();
    // Già partito con ESATTAMENTE questo testo: si aspetta quello, non se ne manda un altro.
    if (userNoteInVolo && userNoteInVoloTesto === testo) return userNoteInVolo;
    if (!bozzaFrase()) return userNoteInVolo || Promise.resolve(true);
    const mia = saveUserNote(opts);
    userNoteInVolo = mia;
    userNoteInVoloTesto = testo;
    // Solo se è ancora la mia: un salvataggio più recente ha già preso il posto.
    mia.finally(() => {
      if (userNoteInVolo === mia) { userNoteInVolo = null; userNoteInVoloTesto = null; }
    });
    return mia;
  }
  // Il salvataggio automatico tocca solo quello che l'owner ha scritto lui: senza la guardia,
  // aprire due segnalazioni di fila riscriverebbe una frase che nessuno ha toccato.
  function salvaFraseAutomatico() {
    // Una scrittura fallita lascia la frase IGNOTA: lì si riprova comunque, o «la frase è al
    // sicuro?» risponderebbe di sì su una riga mai arrivata.
    const ignota = !!selectedId && userNoteSpedito.get(selectedId) === FRASE_IGNOTA;
    if (!userNoteToccata && !ignota) return userNoteInVolo || Promise.resolve(true);
    return salvaFraseSubito({ muto: true });
  }
  // Aspetta sia il salvataggio già partito sia quello che parte adesso.
  async function fraseAlSicuro() {
    const giaPartito = userNoteInVolo;                 // preso PRIMA: salvaFraseSubito lo sostituisce
    const nuovo = salvaFraseAutomatico();
    const esiti = await Promise.all([giaPartito || true, nuovo]);
    return esiti.every(Boolean);
  }

  // Il tasto e Invio restano la strada esplicita, e rispondono sempre.
  function salvaFraseAMano() {
    annullaSalvataggioProgrammato();
    // Premuto un istante dopo la perdita di fuoco: quel salvataggio è già in volo con lo stesso
    // testo, e l'esito lo scrive lui.
    if (userNoteInVolo && userNoteInVoloTesto === fraseInCasella()) return;
    if (!bozzaFrase()) {
      // Niente da spedire perché a destinazione c'è già questa riga: è quello che l'owner vuole
      // sapere premendo il tasto.
      const testo = fraseInCasella();
      setUserNoteMsg(testo ? 'Salvata' : 'Nessuna frase', 'ok');
      return;
    }
    salvaFraseSubito();
  }
  if (mgUserNoteBtn) mgUserNoteBtn.addEventListener('click', salvaFraseAMano);
  if (mgUserNoteText) {
    mgUserNoteText.addEventListener('input', (e) => {
      userNoteToccata = true;
      caselleFrase.cambiato('frase', e, { pausa: FRASE_PAUSA_MS });
    });
    mgUserNoteText.addEventListener('blur', () => { salvaFraseAutomatico(); });
    mgUserNoteText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); salvaFraseAMano(); }
      // Un Esc chiude una cosa sola: senza fermarlo, chiuderebbe anche la ricerca aperta. Il blur salva.
      else if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        collassaFrase();
        if (mgUserNoteToggle) mgUserNoteToggle.focus();
      }
    });
  }

  function setActionMsg(text, kind) {
    mgActionMsg.textContent = text || '';
    mgActionMsg.className = 'mg-action-msg' + (kind ? ` mg-${kind}` : '');
    // Chi ha premuto nel quadrato guarda il pannello, non la riga in fondo.
    const specchio = document.getElementById('mgL5StradeEsito');
    if (specchio) {
      specchio.textContent = text || '';
      specchio.dataset.kind = kind === 'err' || kind === 'ok' ? kind : (text ? 'wait' : '');
    }
    riflettiMessaggiOwner();
  }

  // La riga degli esiti esiste solo quando ha qualcosa da dire: vuota lascerebbe uno spazio che
  // non significa niente.
  function riflettiMessaggiOwner() {
    if (!mgOwnerMsgs) return;
    const vuoto = !(mgActionMsg && mgActionMsg.textContent.trim())
      && !(mgManageMsg && mgManageMsg.textContent.trim());
    mgOwnerMsgs.hidden = vuoto;
  }

  // ── La fila dei cinque livelli ────────────────────────────────────────────

  // Quale forma guarda il pannello: serve a ridisegnarlo a ogni aggiornamento e a segnarla.
  let livelloAperto = null;
  // Quale cerchio dei giudici è aperto, quando livelloAperto è 'l2': serve a riaprire lo stesso
  // giudice su un ridisegno.
  let giudiceAperto = null;

  function formaEl(liv, fb) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mg-forma'
      + (liv.vuoto ? ' mg-forma--vuota' : ` mg-forma--${liv.classe}`)
      + (livelloAperto === liv.key ? ' mg-forma--scelta' : '');
    b.dataset.livello = liv.key;
    b.dataset.esito = liv.esito;
    b.title = liv.titolo;
    b.setAttribute('aria-label', liv.titolo);
    b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${FORME_SVG[liv.forma]}"/></svg>`;
    b.addEventListener('click', () => openSidebarLivello(fb, liv.key));
    return b;
  }

  function renderLivelliRow(fb) {
    if (!mgLivelliRow || !mgForme) return;
    mgForme.replaceChildren();

    // Stato illeggibile: le forme nascerebbero da un `unlabeled` inventato e direbbero «in
    // attesa del giudizio» su una chiusa. Al loro posto si dice solo: aperta o chiusa.
    if (!statoLeggibile(fb)) {
      const pubblico = MR.publicStateLabel(fb);
      if (!pubblico) { mgLivelliRow.hidden = true; return; }
      mgLivelliRow.hidden = false;
      const span = document.createElement('span');
      span.className = 'mg-state';
      span.textContent = pubblico;
      span.title = `Stato: ${pubblico} — ${MR.PUBLIC_STATE_HINT}`;
      mgForme.appendChild(span);
      return;
    }

    mgLivelliRow.hidden = false;
    for (const liv of MR.livelli(fb, opzioniLivelli(fb))) {
      if (liv.key !== 'l2') { mgForme.appendChild(formaEl(liv, fb)); continue; }
      // Un cerchio per giudice ATTESO, non per verdetto: un panel parziale mostra i mancanti
      // tratteggiati, e anche un tratteggiato si clicca perché dice PERCHÉ è vuoto.
      const gruppo = document.createElement('span');
      gruppo.className = 'mg-forme-gruppo';
      gruppo.title = liv.titolo;
      for (const g of liv.giudici) {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'mg-dot mg-dot--clickable'
          + (g.classe ? ` mg-dot--${g.classe}` : ' mg-dot--empty');
        dot.dataset.livello = 'l2';
        dot.title = `${g.etichetta}: ${g.classe || 'nessun verdetto'}`;
        dot.setAttribute('aria-label', dot.title);
        dot.addEventListener('click', () => openSidebarJudge(fb, g.indice));
        gruppo.appendChild(dot);
      }
      mgForme.appendChild(gruppo);
    }
  }

  // Verdetto di un dato giudice (per nome) su un feedback, o null se mancante.
  function verdictByName(fb, name) {
    const v = (fb && fb.pipeline && Array.isArray(fb.pipeline.verdicts)) ? fb.pipeline.verdicts : [];
    return v.find((x) => x && x.judge === name) || null;
  }

  // `side` decide il lato, `who` è l'etichetta sopra il testo, `bodyHtml` è GIÀ escapato dal
  // chiamante.
  function appendBubble(side, who, bodyHtml, attachments) {
    const b = document.createElement('div');
    b.className = `mg-bubble mg-bubble--${side}`;
    let html = `<div class="mg-bubble-who">${esc(who)}</div>`;
    html += `<div class="mg-bubble-body">${bodyHtml}</div>`;
    const atts = Array.isArray(attachments) ? attachments : [];
    const imgs = atts.filter((a) => a && a.kind !== 'file' && a.url);
    const files = atts.filter((a) => a && a.kind === 'file' && a.url);
    if (imgs.length) {
      html += `<div class="mg-bubble-imgs">`;
      for (const a of imgs) {
        // Nessun src iniziale: l'URL punta a byte CIFRATI. Il main lo decifra e resolveBubbleImages
        // riempie src col data URL.
        html += `<img class="mg-img-loading" alt="allegato" data-url="${esc(a.url)}" loading="lazy">`;
      }
      html += `</div>`;
    }
    for (const f of files) {
      // Niente href diretto: l'URL punta a byte CIFRATI. Il click chiede al main di scaricare e
      // decifrare, e salva col nome vero.
      html += `<div class="mg-bubble-file"><a href="#" class="mg-file-link" data-url="${esc(f.url)}" data-name="${esc(f.name || 'allegato')}" data-type="${esc(f.type || '')}">📎 ${esc(f.name || 'allegato')}</a></div>`;
    }
    b.innerHTML = html;
    resolveBubbleImages(b);
    resolveBubbleFiles(b);
    mgThread.appendChild(b);
    return b;
  }

  // Un riassunto è «completo» se finisce con una punteggiatura di chiusura: il backend tronca
  // filoSummary a metà frase, e lì si ripiega sul parere ricostruito dai verdetti.
  function isCompleteSummary(s) {
    const t = String(s || '').trim();
    if (!t) return false;
    return /[.!?…»)\]"'’”:]$/.test(t);
  }

  // Ricostruito dai verdetti completi: ogni giudice porta classe + ragionamento. '' se non c'è
  // nessun verdetto con ragionamento.
  function filoOpinionFromVerdicts(fb) {
    const p = (fb && fb.pipeline) || {};
    const verdicts = Array.isArray(p.verdicts) ? p.verdicts : [];
    const withReason = verdicts.filter((v) => v && String(v.reasoning || '').trim());
    if (!withReason.length) return '';
    const letters = ['A', 'B', 'C', 'D', 'E'];
    // All'owner il modello reale, ai non-owner l'etichetta posizionale anonima: la pagina è
    // owner-only, ma la regola di anonimizzazione dei pallini resta la stessa.
    return withReason.map((v, i) => {
      const model = v.model || v.judgeModel;
      const who = (isAdmin && model) ? String(model) : `Giudice ${letters[i] || i + 1}`;
      const cls = v.class ? ` — ${v.class}` : '';
      return `<strong>${esc(who)}${esc(cls)}</strong>\n${esc(String(v.reasoning).trim())}`;
    }).join('\n\n');
  }

  // Le note lunghe della lavorazione si mostrano ripiegate, l'inizio visibile e un tocco per aprirle (#559):
  // una critica di duecento righe non deve nascondere il turno dopo. Aperte e chiuse sopravvivono ai ridisegni.
  const NOTA_RIGHE_MAX = 24;
  let noteAperte = { id: null, chiavi: new Set() };

  function righeStimate(testo) {
    return String(testo || '').split('\n').reduce((n, riga) => n + Math.max(1, Math.ceil(riga.length / 100)), 0);
  }

  function ripiegaNota(bolla, chiave) {
    const corpo = bolla.querySelector('.mg-bubble-body');
    const tasto = document.createElement('button');
    tasto.type = 'button';
    tasto.className = 'mg-bubble-apri';
    corpo.after(tasto);
    const mostra = (aperta) => {
      bolla.classList.toggle('mg-bubble--ripiegata', !aperta);
      tasto.setAttribute('aria-expanded', String(aperta));
      tasto.textContent = aperta ? 'Riduci' : 'Mostra tutto';
      if (aperta) noteAperte.chiavi.add(chiave);
      else noteAperte.chiavi.delete(chiave);
    };
    tasto.addEventListener('click', () => {
      const apri = bolla.classList.contains('mg-bubble--ripiegata');
      mostra(apri);
      // Richiusa dal fondo di una nota lunga, la bolla tornerebbe fuori vista: la si riporta sotto gli occhi.
      if (!apri) bolla.scrollIntoView({ block: 'nearest' });
    });
    corpo.addEventListener('click', (e) => {
      if (!bolla.classList.contains('mg-bubble--ripiegata')) return;
      if (e.target.closest('a') || String(window.getSelection() || '')) return;
      mostra(true);
    });
    mostra(noteAperte.chiavi.has(chiave));
  }

  // La conversazione COMPLETA del feedback, un turno per bolla: segnalazione
  // originale → parere di Filo (giudici) → commento dell'owner alla revisione →
  // tutti i turni della lavorazione (report delle istanze, esiti del verifier,
  // risposte dell'owner) parsati dalle note col modulo condiviso dei thread.
  function renderThread(fb) {
    mgThread.innerHTML = '';
    const TH = window.SN_FEEDBACK_THREAD;

    // Bolla 1: la segnalazione originale (+ allegati piatti images[] e files[]).
    // I file non-immagine (log, pdf, txt caricati dal tester col box feedback)
    // vivono nel campo piatto files[] ({ name, url, type }): senza mapparli qui
    // l'allegato del tester era invisibile nella dashboard unificata (la vecchia
    // pagina feedback li mostra — parità tra superfici equivalenti).
    const fromModel = TH ? TH.isFromModel(fb) : false;
    const imgs = (Array.isArray(fb.images) ? fb.images : []).map((url) => ({ kind: 'img', url }));
    const files = (Array.isArray(fb.files) ? fb.files : [])
      .filter((f) => f && typeof f.url === 'string' && f.url)
      .map((f) => ({ kind: 'file', url: f.url, name: f.name, type: f.type }));
    // L'autore dalla stessa regola della testata, o le due righe dello stesso dettaglio si contraddicono.
    appendBubble(fromModel ? 'model' : 'user', authorMetaOf(fb).label, esc(fb.text || ''), imgs.concat(files));

    // filoSummary può arrivare troncato: si ripiega sul parere dai verdetti (vedi
    // isCompleteSummary), per non mostrare né una frase spezzata né un falso «nessun parere».
    const summary = (fb.pipeline && fb.pipeline.filoSummary)
      ? String(fb.pipeline.filoSummary).trim() : '';
    let opinionHtml;
    if (summary && isCompleteSummary(summary)) {
      opinionHtml = esc(summary);
    } else {
      const fromVerdicts = filoOpinionFromVerdicts(fb);
      if (fromVerdicts) opinionHtml = fromVerdicts;         // parere completo dai giudici
      else if (summary) opinionHtml = esc(summary);          // troncato ma è l'unica cosa che c'è
      // #908, #914: lavoro locale, sessione per le routine e routine, col mittente provato, i giudici li saltano.
      else if (MR.judgesSkippedText(fb)) opinionHtml = `<em>${esc(MR.judgesSkippedText(fb))}</em>`;
      // "non ha ANCORA un parere" si legge come "sta arrivando": vero solo
      // finché la segnalazione aspetta una decisione. Su una già decisa (un
      // attacco confermato, un fix chiuso) quella parola diceva il falso — e su
      // una cifrata è la macchina a inventarsi che aspetta, perché la sezione
      // qui non si legge. Senza il criterio si dice solo il fatto: nessun
      // verdetto è mai arrivato, punto. La gemella quella frase non la scrive.
      else if (statoLeggibile(fb) && MR.manageTabFor(fb, { releasedVersion }) === 'inbox') {
        opinionHtml = '<em>Filo non ha ancora un parere su questo feedback (giudici non attivi).</em>';
      } else {
        opinionHtml = '<em>I giudici non hanno mai valutato questo feedback.</em>';
      }
    }
    appendBubble('model', 'Filo', opinionHtml);

    // LA DECISIONE dell'owner in revisione, col commento se c'è: senza, una conferma non
    // commentata non lascia traccia. I campi viaggiano cifrati: senza chiave si tace.
    const decisione = MR.valueUnreadable(fb.reviewDecision) ? '' : String(fb.reviewDecision || '').trim();
    const commento = MR.valueUnreadable(fb.reviewComment) ? '' : String(fb.reviewComment || '').trim();
    const DECISION_TEXT = {
      accepted: 'Approvata: rimessa in coda di lavorazione.',
      rejected: 'Blocco confermato.',
    };
    if (DECISION_TEXT[decisione] || commento) {
      const when = (fb.reviewedAt && !MR.valueUnreadable(fb.reviewedAt)) ? ` — ${formatDate(fb.reviewedAt)}` : '';
      const corpo = [DECISION_TEXT[decisione] || '', commento].filter(Boolean).map(esc).join('\n');
      appendBubble('user', `Tu (revisione${when})`, corpo);
    }

    // Il resto del documento sta arrivando (l'elenco è una proiezione): finché
    // non c'è, la conversazione non si dichiara vuota — direbbe il falso
    // proprio su un feedback lavorato.
    // La lettura del resto non è tornata. Lo si dice e si offre di riprovare,
    // che sia una conversazione mai arrivata o una copia rimasta indietro: in
    // tutti e due i casi quello che si vede non è quello che c'è sul server.
    function appendRiprovaDettaglio() {
      const vecchia = !FB.soloLista(fb);
      appendBubble('model', 'Filo', `<em>${fb._dettaglioMancato === 'sparito'
        ? 'Il resto di questa segnalazione non è arrivato: sul server non c&#39;è più.'
        : (vecchia
          ? 'Questa conversazione è quella di prima: l&#39;aggiornamento non è arrivato, controlla la connessione.'
          : 'Il resto di questa segnalazione non è arrivato: controlla la connessione.')}</em>`);
      const riga = document.createElement('div');
      riga.className = 'mg-actions-row';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sn-btn sn-btn-secondary';
      btn.id = 'mgRiprovaDettaglio';
      btn.textContent = '↻ Riprova';
      btn.addEventListener('click', () => riprovaDettaglio(fb._id, btn));
      riga.appendChild(btn);
      mgThread.appendChild(riga);
    }

    if (FB.soloLista(fb)) {
      // Senza questo il pannello restava su «Caricamento…» a tempo
      // indeterminato: è la stessa cura della gemella, che dice e offre Riprova.
      if (fb._dettaglioMancato) appendRiprovaDettaglio();
      else appendBubble('model', 'Filo', '<em>Caricamento della conversazione…</em>');
      appendFraseBubble(fb);
      return;
    }

    // Turni della lavorazione: le note contengono i report delle istanze che
    // hanno implementato, gli esiti del controllo funzionalità e le risposte
    // dell'owner ai chiarimenti, in ordine. Il parser condiviso li separa.
    const notes = String(fb.notes || '');
    // Report illeggibile su questo computer: al posto del blob si dice perché.
    if (TH && TH.reportUnreadable && TH.reportUnreadable(notes)) {
      appendBubble('model', 'Filo', esc('Il report della lavorazione è cifrato e questo computer non ha la chiave privata per leggerlo.'));
      appendFraseBubble(fb);
      if (fb._dettaglioMancato) appendRiprovaDettaglio();
      return;
    }
    if (!TH) {
      // Fallback senza parser: mostra il blob intero come un turno unico.
      if (notes.trim()) appendBubble('model', 'Filo (lavorazione)', esc(notes));
      appendFraseBubble(fb);
      if (fb._dettaglioMancato) appendRiprovaDettaglio();
      return;
    }
    if (noteAperte.id !== fb._id) noteAperte = { id: fb._id, chiavi: new Set() };
    const turni = TH.splitNotes(notes);
    turni.forEach((seg, i) => {
      const when = seg.ts ? ` — ${seg.ts}` : '';
      const who = seg.role === 'user' ? `Tu${when}` : `Filo (lavorazione${when})`;
      const corpo = seg.role === 'user' ? esc(seg.body) : markdownHtml(seg.body);
      const b = appendBubble(seg.role === 'user' ? 'user' : 'model', who, corpo, seg.attachments);
      const chiave = `${i}:${seg.body.length}`;
      // L'ultima nota è quella che si legge: resta aperta, e resta aperta anche quando un turno nuovo
      // arriva mentre la si legge (niente che si richiude da solo).
      if (i === turni.length - 1) noteAperte.chiavi.add(chiave);
      else if (righeStimate(seg.body) > NOTA_RIGHE_MAX) ripiegaNota(b, chiave);
    });
    appendFraseBubble(fb);
    // La copia che si sta leggendo è rimasta indietro e il tentativo di
    // rileggerla non è tornato: si dice in coda alla conversazione, dove
    // l'owner sta già guardando.
    if (fb._dettaglioMancato) appendRiprovaDettaglio();
  }

  // La riga che leggerà chi ha segnalato è l'ULTIMO turno: l'unica cosa che il mittente vede
  // alla chiusura, in chiaro anche quando il resto non si legge.
  function appendFraseBubble(fb) {
    const frase = String((fb && fb.userNote) || '').trim();
    if (!frase) return;
    appendBubble('model', 'Filo (per chi ha segnalato)', esc(frase));
  }

  // Pannello laterale
  function openSidebar(title, html) {
    mittenteAperto = null;
    mgSideEmpty.hidden = true;
    mgSide.hidden = false;
    mgSideTitle.textContent = title;
    mgSideBody.innerHTML = html;
  }

  function closeSidebar() {
    mittenteAperto = null;
    mgSide.hidden = true;
    mgSideEmpty.hidden = false;
    mgSideTitle.textContent = '';
    mgSideBody.innerHTML = '';
    livelloAperto = null;
    giudiceAperto = null;
    if (mgForme) mgForme.querySelectorAll('.mg-forma--scelta')
      .forEach((el) => el.classList.remove('mg-forma--scelta'));
  }

  // Segna quale forma guarda il pannello: con cinque forme in fila non si saprebbe più quale si
  // era premuta.
  function segnaForma(key) {
    livelloAperto = key || null;
    if (!mgForme) return;
    mgForme.querySelectorAll('.mg-forma').forEach((el) => {
      el.classList.toggle('mg-forma--scelta', el.dataset.livello === livelloAperto);
    });
  }

  // Toast discreto in basso a destra: l'esito di un'azione deve arrivare anche
  // se nel frattempo l'owner ha chiuso il pannello o cambiato scheda.
  // Tempi in avvisiTempo.js: in scala con le Preferenze, fermi col puntatore sopra.
  const mgToastTempi = window.SN_AVVISI.orologio();
  let mgToastTempo = null;
  function nascondiToast(el) {
    if (mgToastTempo) mgToastTempo.annulla();
    mgToastTempo = null;
    el.classList.remove('show');
    mgToastTempi.lascia(el);
  }
  function toast(text, kind, ms) {
    let el = document.getElementById('mgToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mgToast';
      el.className = 'mg-toast';
      el.setAttribute('role', 'status');
      el.addEventListener('click', () => {
        const sel = document.getSelection();
        if (sel && !sel.isCollapsed && el.contains(sel.anchorNode)) return;
        nascondiToast(el);
      });
      mgToastTempi.segui(el);
      window.SN_AVVISI.chiudibile(el, () => nascondiToast(el));
      document.body.appendChild(el);
    }
    el.textContent = String(text || '');
    el.dataset.kind = kind || '';
    void el.offsetWidth;
    el.classList.add('show');
    if (mgToastTempo) mgToastTempo.annulla();
    // Le frasi degli esiti sono lunghe: quattro secondi e mezzo per leggerle,
    // di più quando chi chiama ne mette insieme più d'una.
    mgToastTempo = mgToastTempi.avvia(window.SN_AVVISI.durata(Math.max(4500, Number(ms) || 0)), () => nascondiToast(el));
  }

  // ── Il pannello di un livello ─────────────────────────────────────────────
  //
  // Il contenuto (titolo, righe, testo, azioni) arriva già pronto dal modulo
  // condiviso: qui c'è solo il markup, e i pezzi che il markup non può avere —
  // i tasti Approva/Scarta della fusione (li costruisce il modulo delle fusioni),
  // le strade di una fusione ferma senza richiesta e «Salta il controllo» dell'audit.
  function openSidebarLivello(fb, key) {
    if (!fb) return;
    const liv = MR.livelloPer(fb, key, opzioniLivelli(fb));
    if (!liv) return;
    segnaForma(key);
    giudiceAperto = null;

    // I giudici non hanno un pannello loro: la fila di cerchi apre il singolo giudice, e cliccare
    // il gruppo quando nessuno ha votato dice perché.
    const p = liv.pannello;
    const body = document.createElement('div');

    if (p.righe && p.righe.length) {
      const righe = document.createElement('div');
      righe.className = 'mg-liv-righe';
      for (const r of p.righe) {
        const el = document.createElement('div');
        el.className = 'mg-liv-riga';
        const et = document.createElement('strong');
        et.textContent = `${r.etichetta}:`;
        const va = document.createElement('span');
        // Le date arrivano in ISO: qui si scrivono come le scrive il resto della
        // pagina. Una che non si legge resta com'è, mai una riga vuota.
        va.textContent = (/^Quando$/i.test(r.etichetta) && formatDateTime(r.valore)) || r.valore;
        el.appendChild(et); el.appendChild(va);
        righe.appendChild(el);
      }
      body.appendChild(righe);
    }

    if (p.testo) {
      const t = document.createElement('div');
      t.className = 'mg-liv-testo';
      riempiTestoLivello(t, p);
      body.appendChild(t);
    }

    if (Array.isArray(p.parti) && p.parti.length) body.appendChild(partiLeggibili(p.parti));
    if (liv.key === 'l1' && isAdmin && p.azioni.includes('rigiudica')) body.appendChild(pannelloRigiudica(fb));
    if (liv.key === 'l5') body.appendChild(pannelloFusione(fb, liv));
    const strade = liv.key === 'l5' ? pannelloStradeFusione(fb, liv) : null;
    if (strade) body.appendChild(strade);
    if (mostraSaltaAudit(fb, liv)) body.appendChild(pannelloSaltaAudit(fb));
    if (liv.key === 'l3' && rispostaOfferta(fb)) body.appendChild(pannelloRisposta(fb));

    // Un ridisegno a metà risposta non porta via il cursore a chi sta scrivendo.
    const prima = document.getElementById('mgSideRispostaText');
    const cursore = (prima && document.activeElement === prima)
      ? [prima.selectionStart, prima.selectionEnd] : null;
    openSidebar(p.titolo, '');
    mgSideBody.replaceChildren(body);
    const dopo = cursore && document.getElementById('mgSideRispostaText');
    if (dopo) { dopo.focus(); dopo.setSelectionRange(cursore[0], cursore[1]); }
  }

  // La segnalazione e i report sono il markdown di un modello: lo stesso formattatore delle risposte di Filo in
  // chat, che toglie l'HTML prima di formattare. Senza il modulo resta testo.
  function markdownHtml(testo) {
    return window.SN_MARKDOWN ? `<div class="filo-md">${window.SN_MARKDOWN.render(testo)}</div>` : esc(testo);
  }

  function riempiTestoLivello(t, p) {
    // Testo cifrato che questo computer non sa leggere: si dice, non si
    // mostra il blob.
    if (p.illeggibile) {
      t.textContent = MR.TESTO_CIFRATO;
      return;
    }
    t.innerHTML = markdownHtml(p.testo);
  }

  // La frase del quadrato aperto segue le fusioni in volo e decise anche quando il pannello
  // non si può ridisegnare (conferma a metà, richiesta in volo): è un testo, non tocca le card.
  function aggiornaTestoQuadrato() {
    if (livelloAperto !== 'l5' || !mgSideBody) return;
    const fb = selectedId && allFeedbacks.find((f) => f._id === selectedId);
    const t = mgSideBody.querySelector('.mg-liv-testo');
    if (!fb || !t) return;
    const liv = MR.livelloPer(fb, 'l5', opzioniLivelli(fb));
    if (liv && liv.pannello && liv.pannello.testo) riempiTestoLivello(t, liv.pannello);
  }

  // Stesso disegno e stessi tasti dell'elenco in Automazioni, perché è la stessa cosa.
  function pannelloFusione(fb, liv) {
    const UI = window.SN_MERGE_APPROVALS;
    const host = document.createElement('div');
    const ferme = Array.isArray(liv.richieste) ? liv.richieste : [];
    if (!UI || !ferme.length || !isAdmin) return host;
    UI.render(host, opzioniFusioni({
      requests: ferme.filter((r) => !r.used),
      failed: ferme.filter((r) => r.used),
    }));
    host.hidden = false;
    return host;
  }

  // Ferma al cancello senza richiesta (#1556): le due strade sono le azioni di stato della riga dell'owner, per lo
  // stesso cammino, così guardiano, commento di revisione ed esiti sono quelli di là.
  const STRADE_FUSIONE = {
    rimanda: { key: 'accept', id: 'mgL5RimandaBtn', label: 'Rimanda in lavorazione', primary: true },
    archivia: { key: 'archive', id: 'mgL5ArchiviaBtn', label: 'Archivia', primary: false },
  };
  function titoloStrada(fb, key) {
    if (key !== 'accept') return ACTION_TITLE[key] || '';
    return MR.isLocalOnly(fb) ? 'Torna In coda come lavoro server e il lavoro si rifà' : 'Torna in coda e le routine rifanno il lavoro';
  }
  function pannelloStradeFusione(fb, liv) {
    if (!isAdmin) return null;
    const strade = (liv.pannello.azioni || []).map((k) => STRADE_FUSIONE[k]).filter(Boolean)
      .map((s) => ({ ...s, azione: MR.ownerActionFor(fb, s.key, { releasedVersion }) }))
      .filter((s) => s.azione);
    if (!strade.length) return null;
    const box = document.createElement('div');
    box.className = 'mg-liv-azioni';
    const fila = document.createElement('div');
    fila.className = 'mg-liv-strade';
    for (const s of strade) fila.appendChild(tastoStrada(fb, s));
    const esito = document.createElement('span');
    esito.className = 'mg-liv-esito';
    esito.id = 'mgL5StradeEsito';
    esito.setAttribute('role', 'status');
    box.append(fila, esito);
    return box;
  }
  function tastoStrada(fb, s) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sn-btn' + (s.primary ? '' : ' sn-btn-secondary');
    b.id = s.id;
    b.dataset.strada = s.key;
    b.textContent = s.label;
    b.title = titoloStrada(fb, s.key);
    b.disabled = azioniInVolo;
    b.addEventListener('click', () => applyAction(s.azione, null));
    return b;
  }

  // «Salta il controllo» si offre su una bocciatura dell'audit — e anche sulle
  // pratiche vecchie, ferme prima che l'audit lasciasse traccia: lì il segno è
  // lo stato (`design` con motivo `secaudit`). Senza questo secondo caso quelle
  // pratiche non avrebbero nessuna via d'uscita.
  function mostraSaltaAudit(fb, liv) {
    if (!isAdmin || !liv || liv.key !== 'l4') return false;
    if (liv.pannello.azioni.includes('salta_l4')) return true;
    if (liv.esito !== 'nonfatto') return false;
    const n = MR.normalizeStatus(fb);
    return n.status === 'design' && n.statusReason === 'secaudit';
  }

  // Ogni esito del server detto in italiano. Uno che questo client non conosce si scrive
  // grezzo: meglio grezzo che muto, e mai un «fatto» al posto di un guasto.
  const SALTA_ESITI = {
    fuso: { kind: 'ok', text: 'Saltato: il lavoro è entrato in main.' },
    bloccato: { kind: 'ok', text: 'Saltato. Il cancello di fusione ha fermato il ramo: ora aspetta il tuo via libera sul quadrato.' },
    conflitto: { kind: 'err', text: 'Saltato, ma il ramo è in conflitto con main: torna in lavorazione per riallinearlo.' },
    ramo_assente: { kind: 'err', text: 'Il ramo di questa pratica non c’è più: non c’è niente da fondere.' },
    feedback_assente: { kind: 'err', text: 'Il server non trova questa segnalazione.' },
    non_saltabile: { kind: 'err', text: 'Qui non c’è un controllo da saltare: l’audit non ha bocciato niente.' },
    non_owner: { kind: 'err', text: 'Questo lo può fare solo il proprietario.' },
    guasto: { kind: 'err', text: 'GitHub non risponde. Il salto è registrato: ripremi quando torna su.' },
    // Un lavoro anche sul server passa dal cancello del server: prima l'app, poi il server.
    attesa_server: { kind: 'ok', text: 'Saltato. Il lavoro tocca anche il server: entra in main quando la suite di filo-security è verde, prima l’app e poi il server.' },
    server_al_pc: { kind: 'ok', text: 'Saltato. La parte del server la porta su main il tuo PC: npm run orchestra -- fusioni-server.' },
    rimandato: { kind: 'err', text: 'Saltato, ma il lavoro torna alle routine per un altro giro prima di entrare in main.' },
    all_owner: { kind: 'err', text: 'Saltato, ma il cancello del server non lo fonde: la pratica torna a te, col motivo nella conversazione.' },
    // Il salto vale per la versione che verifica e audit hanno letto (#1040.1): niente fusione e niente richiesta.
    mosso: { kind: 'err', text: 'Dopo i controlli il ramo ha preso commit che nessuno ha letto, quindi non entra in main e non chiede il tuo via libera. Rimandala in lavorazione e un giro nuovo li leggerà.', giroNuovo: true },
    senza_controllo: { kind: 'err', text: 'Non trovo quale versione del ramo hanno letto i controlli, e senza quella il ramo non entra in main. Rimandala in lavorazione per un giro nuovo.', giroNuovo: true },
  };

  // Un esito che chiede un giro nuovo resta per pratica: la rilettura dopo l'esito ridisegna il pannello e
  // riproporrebbe il salto. Vale finché stato e audit sono quelli su cui il server ha risposto.
  const esitiSalta = new Map();
  function firmaSalta(fb) {
    const n = MR.normalizeStatus(fb);
    const l4 = (fb && fb.livelli && fb.livelli.l4) || {};
    return JSON.stringify([n.status, n.statusReason || '', l4.esito || '', l4.at || '']);
  }

  function pannelloSaltaAudit(fb) {
    const fermo = esitiSalta.get(fb._id);
    const azione = fermo && fermo.firma === firmaSalta(fb) && MR.ownerActionFor(fb, 'accept', { releasedVersion });
    if (azione) return pannelloSaltoFermo(fb, fermo.m, azione);
    if (fermo) esitiSalta.delete(fb._id);
    const box = document.createElement('div');
    box.className = 'mg-liv-azioni';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sn-btn sn-btn-secondary';
    btn.id = 'mgSaltaL4Btn';
    btn.textContent = 'Salta il controllo';
    btn.title = 'Hai letto cosa ha trovato l’audit e vai avanti lo stesso. Il cancello di fusione resta: può fermare il ramo comunque.';
    const esito = document.createElement('span');
    esito.className = 'mg-liv-esito';
    esito.setAttribute('role', 'status');

    // Un secondo clic per confermare: scavalcare un controllo di sicurezza non è da un click solo.
    let armato = false;
    let timer = null;
    const disarma = () => {
      armato = false;
      btn.textContent = 'Salta il controllo';
      btn.style.minWidth = '';
      btn.style.minHeight = '';
      if (timer) { clearTimeout(timer); timer = null; }
    };
    btn.addEventListener('click', async (e) => {
      // La coda di un doppio clic non è la conferma: salterebbe l'audit in un gesto solo.
      if (armato && e && e.detail > 1) return;
      if (!armato) {
        armato = true;
        // «Confermi?» è più corto: senza la scatola ferma il secondo clic sul lato destro cadeva fuori dal tasto.
        const scatola = btn.getBoundingClientRect();
        btn.style.minWidth = scatola.width + 'px';
        btn.style.minHeight = scatola.height + 'px';
        btn.textContent = 'Confermi?';
        timer = setTimeout(disarma, 5000);
        return;
      }
      disarma();
      btn.disabled = true;
      esito.dataset.kind = 'wait';
      esito.textContent = 'Chiedo al server…';
      try {
        const r = await sendToMain({ type: LIVELLO4_SALTA, feedbackId: fb._id });
        if (!r || r.ok === false) throw new Error((r && r.error) || 'Non riuscito.');
        const m = SALTA_ESITI[r.esito] || { kind: 'err', text: `Il server ha risposto: ${r.esito || 'niente'}.` };
        esito.dataset.kind = m.kind;
        esito.textContent = m.text;
        toast(m.text, m.kind === 'ok' ? 'ok' : 'err');
        if (m.giroNuovo) {
          esitiSalta.set(fb._id, { m, firma: firmaSalta(fb) });
          ridisegnaPannelloAperto();
        }
        // L'esito cambia il pentagono e (se si è aperta una richiesta) il
        // quadrato: si rilegge tutto invece di indovinare.
        setTimeout(() => { loadMergeApprovals(); refreshFromRemote({ force: true }).catch(() => {}); }, 800);
      } catch (e) {
        esito.dataset.kind = 'err';
        esito.textContent = e.message || 'Non riuscito.';
        toast(e.message || 'Non riuscito.', 'err');
      } finally {
        btn.disabled = false;
      }
    });
    box.appendChild(btn);
    box.appendChild(esito);
    return box;
  }

  // Il testo che il server ha reso leggibile, coi punti che ha segnato evidenziati: il perché di ognuno sta sotto
  // il puntatore. Testo e note arrivano da fuori: solo nodi di testo, mai markup.
  function partiLeggibili(parti) {
    const box = document.createElement('div');
    box.className = 'mg-liv-leggibile';
    for (const parte of parti) {
      const sez = document.createElement('section');
      const h = document.createElement('h4');
      h.textContent = parte.titolo;
      const testo = document.createElement('div');
      testo.className = 'mg-liv-leggibile-testo';
      for (const s of parte.segmenti) {
        if (!s.nota) { testo.appendChild(document.createTextNode(s.t)); continue; }
        const m = document.createElement('mark');
        m.textContent = s.t;
        m.title = s.nota;
        testo.appendChild(m);
      }
      sez.append(h, testo);
      box.appendChild(sez);
    }
    return box;
  }

  // Ri-giudica dal triangolo: la pratica che il filtro d'ingresso ha fermato torna dai giudici, come i non
  // filtrati della barra in cima ma una sola.
  function pannelloRigiudica(fb) {
    const box = document.createElement('div');
    box.className = 'mg-liv-azioni';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sn-btn sn-btn-secondary';
    btn.id = 'mgRigiudicaBtn';
    btn.textContent = 'Ri-giudica';
    btn.title = 'Rimanda la segnalazione ai giudici';
    const esito = document.createElement('span');
    esito.className = 'mg-liv-esito';
    esito.setAttribute('role', 'status');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      esito.dataset.kind = 'wait';
      esito.textContent = 'I giudici stanno leggendo…';
      const card = startCardEvaluating(fb._id);
      let r;
      try {
        r = await sendToMain({ type: 'feedback_reevaluate', feedbackIds: [fb._id] });
      } catch (e) {
        r = { ok: false, error: (e && e.message) || String(e) };
      }
      stopCardEvaluating(card);
      const { outcome, errorKind } = MR.classifyReevalResult(r);
      const hint = MR.reevalErrorHint(errorKind);
      const fatto = outcome === 'recovered';
      const testo = fatto ? 'Giudicata: il verdetto è nei cerchi.'
        : outcome === 'budget' ? 'Il server ha finito il tempo: riprova tra poco.'
          : hint || (outcome === 'error' ? `Non riuscito: ${(r && r.error) || 'riprova'}.` : 'Niente da rifare: il server l’ha lasciata com’era.');
      esito.dataset.kind = fatto ? 'ok' : 'err';
      esito.textContent = testo;
      toast(testo, fatto ? 'ok' : 'err');
      btn.disabled = false;
      if (fatto) refreshFromRemote({ force: true }).catch(() => {});
    });
    box.append(btn, esito);
    return box;
  }

  // Il salto non c'è più da proporre: prima cosa è successo, poi la strada, sotto e non dove stava il salto, così
  // un clic in più sul punto di prima non rimanda la pratica.
  function pannelloSaltoFermo(fb, m, azione) {
    const box = document.createElement('div');
    box.className = 'mg-liv-azioni';
    const esito = document.createElement('span');
    esito.className = 'mg-liv-esito';
    esito.id = 'mgL4StradeEsito';
    esito.setAttribute('role', 'status');
    esito.dataset.kind = m.kind;
    esito.textContent = m.text;
    box.append(esito, tastoStrada(fb, { ...STRADE_FUSIONE.rimanda, id: 'mgL4RimandaBtn', azione }));
    return box;
  }

  mgSideClose.addEventListener('click', closeSidebar);

  // Titolo: per l'OWNER il MODELLO reale che ha emesso il verdetto; per i non-owner
  // un'etichetta posizionale anonima («Giudice A/B/C/D»), mai l'id interno né il modello.
  function openSidebarJudge(fb, i) {
    // `i` è la posizione del pallino: con expectedJudges mappa per nome alla posizione del
    // panel, con lo storico è l'indice nei verdetti presenti. I tratteggiati non aprono nulla.
    const p = (fb && fb.pipeline) || {};
    const expected = (Array.isArray(p.expectedJudges) && p.expectedJudges.length) ? p.expectedJudges : null;
    const verdicts = Array.isArray(p.verdicts) ? p.verdicts : [];
    const v = expected ? verdictByName(fb, expected[i]) : (verdicts[i] || null);

    const letters = ['A', 'B', 'C', 'D', 'E'];
    const anonLabel = `Giudice ${letters[i] || String(i + 1)}`;
    segnaForma('l2');
    giudiceAperto = i;

    // Giudice che non ha votato in quella run: il cerchio è tratteggiato e
    // cliccarlo dice PERCHÉ, invece di non fare niente. È la stessa regola dei
    // livelli grigi: un buco si spiega, non si tace.
    const nonVisteRow = MR.immaginiNonViste(fb).map((t) => `<div class="mg-judge-model mg-judge-nonviste">${esc(t)}</div>`).join('');
    if (!v) {
      const nota = MR.judgesNote ? MR.judgesNote(fb) : null;
      const saltati = MR.judgesSkippedText(fb);
      openSidebar(anonLabel, `
        <div class="mg-judge-detail">
          <div class="mg-liv-testo">${saltati ? esc(saltati) : 'Nessun verdetto in questa valutazione: il giudice non ha risposto — scaduto il tempo, credito esaurito o modello non configurato.'}</div>
          ${nota && nota.text && !saltati ? `<div class="mg-judge-model">${esc(nota.text)}</div>` : ''}
          ${nonVisteRow}
        </div>
      `);
      return;
    }
    const cls     = v.class || '';
    const badgeClass = cls ? `mg-class-badge--${cls}` : '';

    // Modello reale del verdetto. Se non è registrato (pipeline vecchie) si ripiega sull'etichetta
    // anonima e lo si dichiara nel corpo.
    const model = v && (v.model || v.judgeModel);
    const title = (isAdmin && model) ? String(model) : anonLabel;

    // La riga «Modello» serve solo quando non è nel titolo: lo dichiara invece di sparire.
    const modelRow = (isAdmin && !model)
      ? `<div class="mg-judge-model"><em>Modello non registrato</em></div>`
      : '';

    const html = `
      <div class="mg-judge-detail">
        <span class="mg-class-badge ${badgeClass}">${esc(cls || '—')}</span>
        ${modelRow}
        ${nonVisteRow}
        <div class="mg-reasoning">${
          v.reasoning ? esc(v.reasoning) : '<em>Nessun ragionamento disponibile.</em>'
        }</div>
      </div>
    `;
    openSidebar(title, html);
  }

  function openSidebarSender(clientId) {
    const group = allByClient[clientId] || [];
    const total = group.length;
    const mittente = group[0] ? chiaveServerMittente(group[0]) : mittenteDaChiave(clientId);

    // Età account: createdAt più vecchio
    let oldest = null;
    for (const fb of group) {
      if (!fb.createdAt) continue;
      const t = new Date(fb.createdAt).getTime();
      if (!oldest || t < oldest.time) oldest = { time: t, iso: fb.createdAt };
    }

    const oldestStr = oldest
      ? `Primo feedback il ${formatDate(oldest.iso)} · ${daysAgo(oldest.iso)}`
      : '—';

    let listHtml = '';
    for (const fb of group) {
      // Stesso criterio della lista: un bordo colorato è un'affermazione sullo stato, che su una
      // cifrata la macchina inventa.
      const cl  = statoLeggibile(fb) ? MR.classifyBlock(fb) : null;
      const num = FB.formatNum(fb.seq, fb.subSeq);
      const title = fb.name || FB.fallbackName(fb.text) || '(senza titolo)';
      const color = cl ? cl.color : 'var(--sn-border)';
      listHtml += `
        <div class="mg-sender-item mg-fiducia--${MR.segnoFiducia(fb).classe}" data-id="${esc(fb._id)}" style="border-left-color:${color}">
          ${num ? `<span class="mg-sender-item-num">#${esc(num)}</span>` : ''}
          ${statoLeggibile(fb) ? segnoFermataHtml(fb) : ''}
          <span class="mg-sender-item-title">${esc(title)}</span>
          ${fiduciaSegnoHtml(fb)}
        </div>
      `;
    }

    const html = `
      <div class="mg-sender-info">
        <div class="mg-sender-stat"><strong>${esc(senderLabel(group[0] || { clientId: mittente }))}</strong></div>
        <div class="mg-sender-stat">${esc(mittente === '__anon__' ? 'anonimo' : mittente)}</div>
        <div class="mg-sender-stat">${esc(oldestStr)}</div>
        <div class="mg-sender-stat">Feedback totali: <strong>${total}</strong></div>
        <div class="mg-sender-segno" id="mgSideSegno" hidden></div>
        <div class="mg-sender-list" id="senderFbList">${listHtml || '<em>Nessun feedback.</em>'}</div>
      </div>
    `;
    segnaForma(null);
    openSidebar('Mittente', html);
    // Il segno si chiede col feedback che l'owner sta guardando, se è di questo mittente.
    const rif = group.find((f) => f._id === selectedId) || group[0] || null;
    if (rif) {
      mittenteAperto = { clientId, fbId: rif._id };
      leggiSegno(rif);
      disegnaSegnoMittente();
    }

    const listEl = document.getElementById('senderFbList');
    if (listEl) {
      listEl.querySelectorAll('.mg-sender-item[data-id]').forEach((el) => {
        el.addEventListener('click', () => openDetail(el.dataset.id));
      });
    }
  }

  // Gli id Firestore sono alfanumerici, ma CSS.escape copre ogni evenienza.
  function cssSel(s) {
    const str = String(s ?? '');
    return (window.CSS && CSS.escape) ? CSS.escape(str) : str.replace(/["\\]/g, '\\$&');
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Caricamento dati ──────────────────────────────────────────────────────
  // Se il freno sulle pagine scatta, la pagina lo dice (loadHitCap → «N+»).
  let caricoIncompleto = false;
  function leggiTutti() {
    return FB.listAllPaged({ fields: FB.CAMPI_LISTA, lista: true });
  }

  async function loadData() {
    mgListLoading.hidden = false;
    mgList.hidden = true;
    mgListEmpty.hidden = true;

    // DB3: la versione in esecuzione è per definizione l'ultima rilasciata (l'owner gira una
    // build pubblicata). Si legge dal recap aggiornamento, che il main calcola.
    if (!releasedVersion) {
      try {
        const r = await sendToMain({ type: 'get_update_recap' });
        if (r && r.current) releasedVersion = r.current;
      } catch (_) { /* gate inattivo: senza versione, done→Risolti come prima */ }
    }
    if (testDataInjected) return;

    try {
      // TUTTI i feedback, a pagine, solo i campi della lista (#676): un
      // feedback vecchio che torna nei Ricevuti deve esserci. La prima lettura
      // parte all'apertura (init) e qui la si aspetta soltanto.
      const pending = firstListPromise;
      firstListPromise = null;
      const letti = await (pending || leggiTutti());
      const fresh = letti.rows;
      if (!testDataInjected) caricoIncompleto = !letti.complete;
      // Nel frattempo uno spec ha iniettato dati finti? Quelli vincono: la
      // lista vera arrivata dopo non li sovrascrive (era una gara persa a caso,
      // e più il caricamento è veloce più spesso la si perdeva).
      if (testDataInjected) return;
      allFeedbacks = fresh;
      dataLoaded = true;
      loadFailed = false;
    } catch (err) {
      if (testDataInjected) return;
      // Il guasto va RICORDATO, non scritto una volta sola: il primo click su una scheda rirende
      // il riquadro, e senza il flag ci scriverebbe «Nessun feedback» al posto di un guasto.
      loadFailed = true;
      mgListLoading.hidden = true;
      mgListEmpty.hidden = false;
      // Un permesso che manca non è un guasto (#583): chiamarlo «errore» manda a controllare la
      // rete e a premere Aggiorna, e nessuna delle due cambia qualcosa.
      mgListEmpty.textContent = (err && err.code === 'FEEDBACK_READ_DENIED')
        ? 'I feedback li vede chi li gestisce: accedi con un account amministratore.'
        : 'Errore nel caricamento dei feedback.';
      console.error('[manage] errore caricamento:', err);
      return;
    }

    // S1.3: decifratura batch dei campi FENC1: — una sola IPC per tutta la lista. Non admin o
    // modulo assente → valori invariati: la dashboard non si rompe, mostra il ciphertext.
    if (isAdmin && allFeedbacks.length > 0) {
      try {
        const r = await sendToMain({ type: 'feedback_decrypt_fields', list: allFeedbacks });
        if (testDataInjected) return;
        if (r && r.ok && Array.isArray(r.list)) allFeedbacks = r.list;
      } catch (_) { /* fallback: render con valori cifrati */ }
    }
    if (testDataInjected) return;

    reindexByClient();
    renderList();
    aggiornaSeguiti();
    live.segnaRiuscito();
  }

  // Indice per mittente (il pannello laterale lo usa). Si rifà a ogni
  // caricamento e a ogni giro di aggiornamento.
  // Chiave del mittente = la stessa del server: chi copia il clientId dell'owner senza prova sta in un gruppo suo.
  function chiaveServerMittente(fb) {
    return (MR.effectiveClientId ? MR.effectiveClientId(fb) : String((fb && fb.clientId) || '')) || '__anon__';
  }
  // Il pannello tiene a parte anche ciò che Filo manda con la prova dell'owner, non con gli estranei dello stesso
  // nome (#953). Il prefisso è su ogni chiave: nessun clientId scelto apposta entra in quel gruppo.
  function senderKeyOf(fb) {
    const perOwner = authorKindOf(fb) === 'filo' && !!(TH && TH.filoPerConto) && TH.filoPerConto(fb || {}) === 'owner';
    return (perOwner ? 'owner|' : 'm|') + chiaveServerMittente(fb);
  }
  function mittenteDaChiave(key) {
    const s = String(key || '');
    return s.slice(s.indexOf('|') + 1);
  }
  function reindexByClient() {
    allByClient = {};
    for (const fb of allFeedbacks) {
      const c = senderKeyOf(fb);
      if (!allByClient[c]) allByClient[c] = [];
      allByClient[c].push(fb);
    }
  }

  // ── Aggiornamento continuo ────────────────────────────────────────────────
  // Solo mentre qualcuno guarda: patterns/dati-che-cambiano-altrove-cloud-si-chiede-la-versione.md. Il giro
  // della pagina è quello condiviso con la pagina Feedback (SN_FEEDBACK_LIVE_PAGINA); qui solo gli agganci.
  const LIVE = window.SN_FEEDBACK_LIVE;
  // Sorgenti sostituibili dagli spec (che non hanno Firestore); `giro` lo mette il modulo (il main).
  const liveSources = {
    // Il giro dal vivo rilegge le RIGHE: stessa proiezione del caricamento.
    getMany: (ids) => FB.getMany(ids, { fields: FB.CAMPI_LISTA, timeoutMs: 20000 }),
    // Il documento intero, per il feedback che l'owner ha aperto. Col tempo
    // massimo: una richiesta appesa terrebbe il pannello su «Caricamento…» e
    // dietro di sé tutti i tasti che scrivono sulla conversazione.
    getDettagli: (ids) => FB.getMany(ids, { timeoutMs: 20000 }),
  };
  const live = window.SN_FEEDBACK_LIVE_PAGINA.crea({
    nome: 'manage',
    invia: sendToMain,
    sorgenti: liveSources,
    pronta: () => dataLoaded,
    carica: () => loadData(),
    righe: () => allFeedbacks,
    sostituisci: (lista) => { allFeedbacks = lista; reindexByClient(); },
    decifra: () => isAdmin,
    sezioneDi: (fb) => sezioneDi(fb),
    ridisegna: ({ ids, righe, removed }) => {
      rerenderAfterLive(ids);
      fsSegueLive(righe, removed).catch(() => {});
    },
    senzaNovita: ({ giro }) => {
      // Niente di nuovo, ma una scheda sparita in un giro precedente (tenuta
      // aperta per una bozza) può chiudersi ora che la bozza non c'è più.
      closeDetailIfGone();
      // Il registro delle routine può essere cresciuto lo stesso: le
      // statistiche seguono anche questo giro (feedback #496).
      if (giro && live.inVista()) fsSegueLive([], []).catch(() => {});
    },
    rileggiFusioni: () => { if (isAdmin) loadMergeApprovals(); },
    avvisi: (testo) => segnaAvvisoGiro(testo),
    segno: () => { aggiornaSegnoFerma(); domandeDalVivo(); },
    quandoInVista: () => domandeDalVivo(),
  });

  // Anche le domande cambiano sul server: col ritmo del giro dal vivo, e solo in vista, se ne rileggono le cambiate.
  // Senza, contatore e segno di una bloccante restavano quelli dell'apertura.
  let domandePollMs = (window.SN_FEEDBACK_LIVE && window.SN_FEEDBACK_LIVE.POLL_MS) || 60000;
  let domandeChiesteAt = Date.now();
  function domandeDalVivo() {
    if (!DOMANDE || !live.acceso() || !live.inVista()) return;
    const s = DOMANDE.stato();
    if (s.nonDisponibile || s.soloOwner || Date.now() - domandeChiesteAt < domandePollMs) return;
    domandeChiesteAt = Date.now();
    DOMANDE.carica();
  }
  // Arrivate in una sezione mentre la pagina era aperta: con un ordinamento a
  // scelta possono finire a metà lista, e senza un segno l'arrivo non si vede.
  const arrivate = live.arrivate;
  const refreshFromRemote = (opts) => live.giro(opts);
  const startLive = () => live.start();
  const stopLive = () => live.stop();
  const aggiornaSeguiti = () => live.aggiornaSeguiti();

  function sezioneDi(fb) {
    if (!sezioniAttendibili() || !statoLeggibile(fb)) return null;
    return MR.manageTabFor(fb, opzSezioni());
  }

  function segnaArrivi(prima, fresh) {
    live.segnaArrivi(prima, fresh);
  }

  // «Ferma» si dice solo a chi guarda, e solo dopo più giri mancati.
  function aggiornaSegnoFerma() {
    if (!mgListHead) return;
    const ferma = live.ferma();
    mgListHead.classList.toggle('mg-list-head--ferma', ferma);
    scriviTitoloTesta(ferma
      ? `Lista ferma alle ${formatDateTime(new Date(live.okAt()).toISOString())}: il server non risponde, riprovo da solo.`
      : '');
  }

  // L'owner sta scrivendo nel pannello? Allora non si ridisegna sotto le sue dita: i dati si
  // fondono lo stesso e il pannello si aggiorna al giro dopo.
  function detailBeingEdited() {
    if (!mgDetail) return false;
    const el = document.activeElement;
    if (el && mgDetail.contains(el)) {
      const tag = String(el.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'input' || tag === 'select' || el.isContentEditable) return true;
    }
    // Una bozza lasciata in una casella vale quanto il cursore dentro: ridisegnare la butterebbe
    // via.
    for (const box of mgDetail.querySelectorAll('textarea')) {
      if (!box.hidden && box.offsetParent !== null && String(box.value || '').trim()) return true;
    }
    // La riga della frase parte già piena col valore salvato: è una bozza solo se differisce.
    // Vale anche a sezione CHIUSA, o un ridisegno cancellerebbe quello che l'owner ha scritto.
    if (mgUserNote && mgUserNoteText) {
      if (String(mgUserNoteText.value || '') !== String(mgUserNoteText.dataset.saved || '')) return true;
    }
    // La risposta scritta nel pannello del rombo (#1033) sta fuori dal dettaglio, ma è sua.
    const rispostaLaterale = document.getElementById('mgSideRispostaText');
    if (rispostaLaterale && (el === rispostaLaterale || String(rispostaLaterale.value || '').trim())) return true;
    // Una conferma del segno aperta (#922): ridisegnare la chiuderebbe mentre l'owner la legge.
    if (mgSegnoConferma && !mgSegnoConferma.hidden && mgSegnoConferma.offsetParent !== null) return true;
    if (document.querySelector('#mgSideSegno .mg-segno-conferma:not([hidden])')) return true;
    return false;
  }

  // ── Un ridisegno non porta via quello che l'owner sta scrivendo ──────────
  //
  // Ridisegnare il pannello RIEMPIE le sue caselle col feedback: motivo della
  // riapertura, risposta al chiarimento, commento della revisione, frase per
  // chi ha segnalato. Su una bozza in corso vuol dire cancellarla, e la
  // scrittura che parte dopo legge la casella ormai vuota: la segnalazione si
  // riapre senza il motivo, e nessun errore lo dice. Quindi un ridisegno
  // aspetta che la bozza non ci sia più, e allora riparte — senza il rinvio
  // resterebbe in eterno sulla riga «Caricamento della conversazione…».
  let ridisegnoRimandato = null;
  function ridisegnaRispettandoLaBozza(id) {
    if (selectedId !== id) { ridisegnoRimandato = null; return; }
    if (detailBeingEdited()) { ridisegnoRimandato = id; return; }
    ridisegnoRimandato = null;
    openDetail(id, { ridisegno: true });
  }
  function riprendiRidisegnoRimandato() {
    if (ridisegnoRimandato === null) return;
    ridisegnaRispettandoLaBozza(ridisegnoRimandato);
  }
  {
    // `focusout` arriva mentre il fuoco è ancora sul campo che lo perde: il
    // rinvio di un giro fa trovare a detailBeingEdited() la situazione vera.
    // Anche il pannello: la risposta alle domande si scrive lì.
    const piuTardi = () => setTimeout(riprendiRidisegnoRimandato, 0);
    for (const el of [mgDetail, mgSide]) {
      if (!el) continue;
      el.addEventListener('input', piuTardi);
      el.addEventListener('focusout', piuTardi);
    }
  }

  // La scheda aperta non è più in pagina: il pannello non può mostrare un
  // feedback che non c'è. Si chiude (senza toccare una bozza in corso: quella
  // resta finché l'owner non la svuota, e al giro dopo si chiude).
  function closeDetailIfGone() {
    if (!selectedId || allFeedbacks.some((f) => f._id === selectedId)) return false;
    if (detailBeingEdited()) return true;
    selectedId = null;
    mgDetail.hidden = true;
    mgDetailEmpty.hidden = false;
    return true;
  }

  const puntatoreLista = window.SN_FEEDBACK_LIVE_PAGINA.seguiPuntatore(mgList, { quandoLibera: () => riprendiLista() });
  function listaOccupata() {
    return puntatoreLista.occupata();
  }
  function rimandaLista() {
    puntatoreLista.rimanda();
  }
  function riprendiLista() {
    if (!dataLoaded || searchMode) return;
    if (listaOccupata()) { rimandaLista(); return; }
    puntatoreLista.annulla();
    ridisegnaListaAlSuoPosto();
  }
  function listaCheScorre() {
    return [mgList, mgList && mgList.parentElement]
      .find((el) => el && el.scrollHeight > el.clientHeight) || null;
  }
  function ridisegnaListaAlSuoPosto() {
    if (!mgList) { renderList(); return; }
    window.SN_FEEDBACK_LIVE_PAGINA.alSuoPosto({ lista: mgList, voci: '.mg-item', scorre: listaCheScorre }, () => {
      scrollDelGiroAt = Date.now();
      renderList();
    });
  }

  // Ridisegna la lista senza perdere lo scorrimento né la selezione. In
  // ricerca la lista mostra i risultati: quelli restano, i dati sotto sono
  // comunque aggiornati (il dettaglio li legge da lì).
  // Ritorna true se il DETTAGLIO è stato ridisegnato davvero: serve ai test per
  // distinguere "trattenuto da una bozza in corso" da "non c'era niente da
  // ridisegnare". I chiamanti veri il valore lo ignorano.
  function rerenderAfterLive(touched) {
    if (!dataLoaded) return false;
    if (!searchMode) {
      if (listaOccupata()) rimandaLista();
      else ridisegnaListaAlSuoPosto();
    }
    if (!selectedId || closeDetailIfGone()) return false;
    if (touched.has(selectedId) && !detailBeingEdited()) {
      // Ridisegno, non una nuova apertura: la sezione della frase resta come l'ha lasciata l'owner.
      openDetail(selectedId, { ridisegno: true });
      return true;
    }
    return false;
  }

  // ── Il giro dei cambiati (#676) ───────────────────────────────────────────
  // Vive nel main, uno per tutte le pagine iscritte: regola in
  // patterns/chi-guarda-in-continuo-chiede-cosa-e-cambiato.md.

  // Avvisi del giro (freno sulle pagine, tetto dei seguiti, registro
  // illeggibile): si dicono sull'intestazione della lista, non si tacciono.
  function segnaAvvisoGiro(testo) {
    avvisoGiro = testo || '';
    if (!mgListHead) return;
    mgListHead.classList.toggle('mg-list-head--avviso', !!avvisoGiro);
    aggiornaSegnoFerma();
  }

  // Chi la pagina chiede al giro di seguire con l'ora vera di Firestore (la regola sta nel modulo).
  function idsDaSeguire() {
    return live.seguiti();
  }

  // Hook di test: gli spec iniettano feedback e aprono il dettaglio esercitando il VERO codice di
  // rendering. Inerte in produzione.
  window.__mgTest = {
    setData(fbs, opts) {
      // Dati finti al posto di quelli veri: l'aggiornamento continuo si ferma,
      // o al primo giro li rimpiazzerebbe con Firestore. Gli spec che vogliono
      // provarlo sostituiscono le sorgenti (setLiveSources) e chiamano pollNow,
      // oppure passano `{ dalVivo: true }` DOPO averle sostituite: allora
      // l'orologio vero resta acceso sulle sorgenti finte.
      // Fermo E bloccato: se l'avvio vero finisce DOPO l'iniezione, startLive
      // non deve ripartire e rimpiazzare i dati finti con Firestore.
      stopLive();
      live.blocca(!(opts && opts.dalVivo));
      testDataInjected = true;
      arrivate.clear();
      allFeedbacks = Array.isArray(fbs) ? fbs : [];
      // `incompleto`: come se il freno sulle pagine avesse interrotto la lettura.
      caricoIncompleto = !!(opts && opts.incompleto);
      dataLoaded = true;
      loadFailed = false;
      reindexByClient();
      renderList();
      if (opts && opts.dalVivo) {
        live.segnaRiuscito();
        startLive();
      }
    },
    // Le soglie dell'orologio, accorciate: un giro vero ogni minuto farebbe
    // aspettare minuti a ogni spec.
    setLiveTiming(t) { live.tempi(t); if (t && t.pollMs) domandePollMs = t.pollMs; },
    liveArrivate() { return Array.from(arrivate); },
    // Caricamento FALLITO, su richiesta. Lo spec che verifica "niente numeri
    // inventati quando i dati non sono arrivati" si affidava al fatto che nel
    // sandbox dei test Firestore non è raggiungibile: sulla macchina di chi
    // sviluppa Filo lo è, il caricamento riesce, e quel rosso non parlava di un
    // difetto ma della rete di casa. Qui lo stato di guasto si CHIEDE, e vale
    // ovunque allo stesso modo.
    simulaCaricamentoFallito() {
      stopLive();
      live.blocca(true);
      testDataInjected = true;   // il caricamento vero, se atterra dopo, non lo annulla
      allFeedbacks = [];
      dataLoaded = false;
      loadFailed = true;
      reindexByClient();
      renderList();
    },
    // Chi la pagina chiede al giro di seguire con l'ora vera di Firestore.
    idsDaSeguire,
    // Una riga della lista com'è in mano alla pagina, qualunque sezione la mostri.
    riga(id) { const f = allFeedbacks.find((x) => x._id === id); return f ? { name: f.name, status: f.status } : null; },
    // Aggiornamento continuo: un giro subito (ritorna { changed }), e le
    // sorgenti finte { listVersions(opts), getMany(ids) } con cui farlo.
    pollNow() { return refreshFromRemote({ force: true }); },
    // L'avviso del giro del main, come se fosse arrivato dal canale: gli spec
    // provano le due forme senza dover fingere anche l'IPC.
    liveMessage(m) { return live.applicaEsito(m); },
    // Dopo `setData` il canale resta chiuso, o il giro vero rimpiazzerebbe i
    // dati finti. Uno spec che vuole provare il giro INTERO (main → pagina)
    // lo riapre da qui, coi dati finti già in pagina.
    resumeLive() { live.riprendi(); },
    avvisoGiro() { return avvisoGiro; },
    // Un giro di ridisegno da aggiornamento remoto, su richiesta: i test lo
    // usano per verificare che una bozza in corso lo trattenga (ritorna false).
    rerenderIfIdle(id) { return rerenderAfterLive(new Set([id])); },
    // Sorgenti finte. Chi passa solo `listVersions` ottiene un giro che fa il
    // riallineamento su quelle versioni (com'era prima del giro nel main).
    setLiveSources(src) {
      Object.assign(liveSources, src || {});
      if (src && typeof src.listVersions === 'function' && typeof src.giro !== 'function') {
        liveSources.giro = async () => ({
          ok: true,
          giro: { kind: 'reconcile', versions: await src.listVersions({ timeoutMs: 20000 }) },
        });
      }
    },
    isLiveOn() { return live.acceso(); },
    setAdmin(v) { setIsAdmin(!!v); applyAutoModeGate(); },
    // Ri-legge i contatori del verificatore dalla fonte (IPC) — per i test.
    loadCaps,
    // Ri-legge le scelte sulle sessioni delle routine (IPC) — per i test.
    loadSessions,
    // Ri-legge le pause in corso degli account e della routine server (IPC) — per i test.
    loadPause,
    // Ri-legge modello e sforzo per fase (IPC) — per i test.
    loadRoleModels,
    // Ri-legge il timeout dei giudici (IPC) — usato dai test dopo lo stub.
    loadJudgeTimeout,
    // Ri-legge la config dell'automatica (IPC): interruttore master, mappa dei
    // mittenti auto-approvati, lavori server — usato dai test.
    loadAutoMode,
    setTab(tab) { selectTab(tab); },
    setSezione(sezione) { if (schedaPerSezione[sezione]) selectTab(schedaPerSezione[sezione]); },
    sezioneAttiva() { return sezioneAttiva; },
    apriSegnalazione(id) { fsApriSegnalazione(id); },
    // Domande finte, o { errore } per un guasto finto: il main non le rimpiazza più.
    setDomande(lista, opts) { if (DOMANDE) DOMANDE.imposta(lista, opts); },
    domandeStato() { return DOMANDE ? DOMANDE.stato() : null; },
    // Rifà la scelta d'apertura coi dati finti già in pagina; `{ comeAvvio: true }` rispetta il clic dell'utente come all'avvio.
    sceltaApertura(opts) {
      if (opts && opts.comeAvvio) { aperturaFatta = false; return sceltaApertura(); }
      return sceltaApertura({ forza: true });
    },
    livelliFiltro(livelli) {
      if (Array.isArray(livelli)) { livelliScelti = livelli.filter((l) => MR.LIVELLI_RICEVUTI.includes(l)); renderList(); }
      return livelliScelti.slice();
    },
    // «Solo non fidate»: con un booleano lo imposta, sempre ritorna com'è.
    fiduciaFiltro(v) {
      if (typeof v === 'boolean') impostaSoloNonFidate(v);
      return soloNonFidate;
    },
    // Ordinamento della lista (menu tasto destro): impostalo e rirender.
    setSortMode(mode) { if (SORT_MODES[mode]) { sortMode = mode; reflectSortBtn(); renderList(); } },
    getSortMode() { return sortMode; },
    // Ordine corrente dei numeri (#N) mostrati in lista — per asserire il sort.
    currentOrder() { return currentList.map((f) => f._id); },
    // DB3: imposta la "versione rilasciata" usata dal gate "Risolti" e rirende.
    setReleasedVersion(v) { releasedVersion = v || ''; renderList(); },
    openDetail,
    // Ricerca «a senso»: stato e trigger per gli spec.
    isSearchMode() { return searchMode; },
    runSearch(q) { return runSearch(q); },
  };

  // ── Sezione "Modelli di supporto" (DD1) ──────────────────────────────────
  // Slot → editor a segmenti (buildChain del modelChainEditor).
  // Caricato pigro: viene inizializzato la prima volta che l'utente clicca la tab.
  const SM_SLOTS = ['sanitizer', 'judge1', 'judge2', 'judge3', 'judgeDynamic', 'judgeRedTeam', 'judgePriority', 'manageSearch', 'manageSearchClassifier'];
  // Etichette amichevoli per slot (i giudici del panel L2 sono "Giudice 1/2/3"
  // + "Giudice dinamico"; l'id grezzo non va mai mostrato all'utente). L'HTML
  // ha già le <label> statiche; questa mappa è la sorgente di verità se in
  // futuro le label venissero generate dal JS.
  const SM_SLOT_LABELS = {
    sanitizer:     'Sanitizer feedback',
    judge1:        'Giudice 1',
    judge2:        'Giudice 2',
    judge3:        'Giudice 3',
    judgeDynamic:  'Giudice dinamico',
    judgeRedTeam:  'Giudice red-team',
    judgePriority: 'Giudice priorità',
    manageSearch:  'Ricerca fra i feedback',
    manageSearchClassifier: 'Classificatore della ricerca',
  };
  let smChains = {};        // slot → { getValue }
  // Nickname del registro condiviso (Modelli predefiniti): il server dei giudici
  // lo unisce al loro, quindi valgono anche qui. Arrivano col GET.
  let smSharedNicknames = [];
  // Registro con cui l'app risolve gli slot spostati (#465): arriva col GET.
  let smAppRegistry = {};
  // Slot spostati mai impostati → catena mostrata: se al salvataggio è ancora quella non si scrive (#465).
  let smUnsetShown = {};
  let smLoaded  = false;    // true dopo il primo caricamento riuscito
  let smLoading = false;    // guard anti-doppio-caricamento

  const mgSmLoading = document.getElementById('mgSmLoading');
  const mgSmDenied  = document.getElementById('mgSmDenied');
  const mgSmEditor  = document.getElementById('mgSmEditor');
  const mgSmSaveBtn = document.getElementById('mgSmSaveBtn');
  const mgSmStatus  = document.getElementById('mgSmStatus');
  const mgSmKeyInput     = document.getElementById('mgSmKeyOpenrouter');
  const mgSmKeyState     = document.getElementById('mgSmKeyOpenrouterState');
  const mgSmRegistryList = document.getElementById('mgSmRegistryList');
  const mgSmRegistryAdd  = document.getElementById('mgSmRegistryAdd');

  // I nickname che i giudici possono usare: registro giudici + predefiniti condivisi. Va
  // richiamata dopo ogni modifica al registro.
  function populateSmNicknames() {
    const dl = document.getElementById('nicknames-list');
    if (!dl) return;
    dl.innerHTML = '';
    const seen = new Set();
    const addNick = (nick, label) => {
      const name = String(nick || '').trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      const opt = document.createElement('option');
      opt.value = name;
      if (label) opt.label = label;
      dl.appendChild(opt);
    };
    // Registro dedicato ai giudici: compaiono per primi.
    const judgeReg = collectJudgeRegistry();
    for (const nick of Object.keys(judgeReg)) addNick(nick, judgeReg[nick].label);
    // 2. Registro condiviso (Modelli predefiniti).
    for (const n of smSharedNicknames) addNick(n && n.nick, n && n.label);
    const shared = (window.SN_CONST && window.SN_CONST.DEFAULT_MODEL_REGISTRY) || {};
    for (const nick of Object.keys(shared)) addNick(nick, (shared[nick] || {}).label);
  }

  // Catalogo OpenRouter del campo «Modello OpenRouter», dal main come in Modelli predefiniti (#465):
  // finché non arriva la tendina propone i modelli già scritti; se non arriva, il campo resta libero.
  let smCatalog = null;
  let smCatalogPending = null;
  function ensureSmCatalog() {
    if (smCatalog || smCatalogPending) return smCatalogPending;
    const type = (window.SN_MSG && window.SN_MSG.MSG && window.SN_MSG.MSG.DEFAULT_MODELS_LIST) || 'default_models_list';
    smCatalogPending = Promise.resolve()
      .then(() => sendToMain({ type, provider: 'openrouter' }))
      .then((r) => {
        if (!(r && r.ok && Array.isArray(r.items) && r.items.length)) return;
        smCatalog = r.items;
        if (window.SN_COMBOBOX) window.SN_COMBOBOX.opzioniArrivate();
      })
      .catch(() => {})
      .finally(() => { smCatalogPending = null; });
    return smCatalogPending;
  }

  // `self`: il campo che chiede; senza catalogo il suo testo a metà non è un modello da proporre.
  function readSmModelOptions(self) {
    const out = [];
    const seen = new Set();
    const add = (id, label) => {
      const v = String(id || '').trim();
      if (!v || seen.has(v)) return;
      seen.add(v);
      out.push({ value: v, label: label && label !== v ? String(label) : '' });
    };
    if (smCatalog) for (const it of smCatalog) add(it && it.id, it && it.label);
    else if (mgSmRegistryList) for (const el of mgSmRegistryList.querySelectorAll('.sn-model-id')) { if (el !== self) add(el.value, ''); }
    return out;
  }

  // ── Registro modelli dei giudici (nickname → modello OpenRouter) ───────────
  // Una riga = nickname + stringa modello OpenRouter + rimuovi. Provider implicito
  // OpenRouter (il backend dei giudici è OpenRouter-only).
  function makeRegistryRow(nick, entry) {
    const e = entry || {};
    const row = document.createElement('div');
    row.className = 'sn-model-row mg-sm-reg-row';
    row.dataset.label = (e.label || '');

    const nickIn = document.createElement('input');
    nickIn.type = 'text';
    nickIn.className = 'sn-model-nick';
    nickIn.placeholder = 'nickname (es. giudice-veloce)';
    nickIn.value = nick || '';

    const modelIn = document.createElement('input');
    modelIn.type = 'text';
    modelIn.className = 'sn-model-id';
    modelIn.setAttribute('autocomplete', 'off');
    modelIn.placeholder = 'modello OpenRouter (es. deepseek/deepseek-v4-pro)';
    modelIn.value = e.model || '';
    const modelWrap = document.createElement('div');
    modelWrap.className = 'sn-model-id-wrap';
    modelWrap.appendChild(modelIn);
    modelIn.addEventListener('focus', () => { ensureSmCatalog(); });
    if (window.SN_COMBOBOX) {
      window.SN_COMBOBOX.attach(modelWrap, modelIn, {
        readOptions: () => readSmModelOptions(modelIn),
        onPick: () => populateSmNicknames(),
      });
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sn-btn sn-btn-secondary';
    del.textContent = 'Rimuovi';
    del.addEventListener('click', () => { row.remove(); populateSmNicknames(); });

    const warn = document.createElement('div');
    warn.className = 'sn-model-row-warn';
    warn.setAttribute('role', 'status');
    warn.hidden = true;

    // Aggiornare nickname o modello ridisegna i suggerimenti dei selettori
    // (un nickname compare tra i suggerimenti solo quando ha anche un modello).
    nickIn.addEventListener('input', () => populateSmNicknames());
    modelIn.addEventListener('input', () => { populateSmNicknames(); avvisaProduttoreGiudice(row); });

    row.appendChild(nickIn);
    row.appendChild(modelWrap);
    row.appendChild(del);
    row.appendChild(warn);
    avvisaProduttoreGiudice(row);
    return row;
  }

  // I giudici girano sul server con la lista di esclusione del codice, la stessa di build qui (un test del server le
  // confronta): un modello il cui produttore resta fra gli host lo si dice sulla riga (#1059).
  function avvisaProduttoreGiudice(row) {
    const warn = row.querySelector('.sn-model-row-warn');
    const C = window.SN_CONST;
    if (!warn || !C || typeof C.unexcludedProducer !== 'function') return;
    const nome = C.unexcludedProducer(row.querySelector('.sn-model-id').value.trim(), C.DEFAULT_EXCLUDED_PROVIDERS);
    warn.textContent = nome
      ? `${nome} produce questo modello e i giudici non lo escludono come fornitore: le richieste possono arrivare a lui.`
      : '';
    warn.hidden = !nome;
  }

  function renderJudgeRegistry(registry) {
    if (!mgSmRegistryList) return;
    mgSmRegistryList.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'sn-model-row sn-model-row-head mg-sm-reg-row';
    ['Nickname', 'Modello OpenRouter', ''].forEach((label) => {
      const c = document.createElement('div'); c.textContent = label; head.appendChild(c);
    });
    mgSmRegistryList.appendChild(head);

    const entries = Object.entries(registry || {});
    if (!entries.length) {
      mgSmRegistryList.appendChild(makeRegistryRow('', {}));
    } else {
      for (const [nick, e] of entries) mgSmRegistryList.appendChild(makeRegistryRow(nick, e));
    }
  }

  function collectJudgeRegistry() {
    const out = {};
    if (!mgSmRegistryList) return out;
    for (const row of mgSmRegistryList.querySelectorAll('.sn-model-row:not(.sn-model-row-head)')) {
      const nick = row.querySelector('.sn-model-nick').value.trim();
      const model = row.querySelector('.sn-model-id').value.trim();
      const label = (row.dataset.label || '').trim();
      if (!nick || !model) continue;
      if (out[nick]) continue;
      const entry = { provider: 'openrouter', model };
      if (label) entry.label = label;
      out[nick] = entry;
    }
    return out;
  }

  function appSlotAction(slot) {
    const pairs = (window.SN_MODEL_USAGE && window.SN_MODEL_USAGE.ownerActions && window.SN_MODEL_USAGE.ownerActions()) || [];
    const hit = pairs.find((p) => p.slot === slot);
    return hit ? hit.action : '';
  }

  // Lo stesso registro della risoluzione nell'app: quello in uso lì con sopra quello dei giudici.
  function appSlotRegistry() {
    return { ...smAppRegistry, ...collectJudgeRegistry() };
  }

  function appSlotCtx(action) {
    const MC = window.SN_MODEL_CHAIN;
    return {
      validate: MC.makeValidator ? MC.makeValidator(action, appSlotRegistry) : undefined,
      isKnown: MC.makeKnownCheck ? MC.makeKnownCheck(appSlotRegistry) : undefined,
      readOptions: () => {
        const out = [];
        const seen = new Set();
        for (const reg of [collectJudgeRegistry(), smAppRegistry]) {
          for (const [nick, e] of Object.entries(reg || {})) {
            if (seen.has(nick)) continue;
            seen.add(nick);
            const label = e && e.label && e.label !== nick ? String(e.label) : '';
            out.push({ value: nick, label });
          }
        }
        return out;
      },
    };
  }

  // Rende gli editor a segmenti per tutti gli slot, usando SN_MODEL_CHAIN.buildChain.
  // Ogni chain è attaccata al div #mgSmChain-<slot>.
  function renderSmSlots(models) {
    const ModelChain = window.SN_MODEL_CHAIN;
    if (!ModelChain) return;
    smChains = {};
    smUnsetShown = {};
    const unset = Array.isArray(models.movedUnset) ? models.movedUnset : [];
    for (const slot of SM_SLOTS) {
      const host = document.getElementById(`mgSmChain-${slot}`);
      if (!host) continue;
      const slotEl = host.closest('.mg-sm-slot');
      const labelEl = slotEl && slotEl.querySelector('label');
      if (labelEl && SM_SLOT_LABELS[slot]) labelEl.textContent = SM_SLOT_LABELS[slot];
      host.innerHTML = '';
      // Gli slot dei giudici non corrispondono a un'azione: accettano qualunque nickname.
      // Quelli spostati dall'app (#465) hanno i controlli e i suggerimenti che avevano nelle Opzioni.
      const action = appSlotAction(slot);
      const chain = ModelChain.buildChain(models[slot] || '', null, action ? appSlotCtx(action) : {});
      host.appendChild(chain.el);
      smChains[slot] = chain;
      if (unset.includes(slot)) smUnsetShown[slot] = chain.getValue();
    }
  }

  function setSmStatus(text, kind) {
    mgSmStatus.textContent = text || '';
    mgSmStatus.className = 'mg-sm-status' + (kind ? ` mg-${kind}` : '');
  }

  // La chiave vera non lascia mai il main: dal GET arriva solo il booleano.
  function applyJudgeKeyState(models) {
    if (!mgSmKeyState) return;
    const present = !!(models && models.openrouterKeyPresent);
    mgSmKeyState.textContent = present ? '(configurata)' : '(non configurata)';
  }

  async function loadSupportModels() {
    if (smLoading) return;
    smLoading = true;
    mgSmLoading.hidden = false;
    mgSmDenied.hidden  = true;
    mgSmEditor.hidden  = true;

    try {
      const r = await sendToMain({ type: 'support_models_get' });
      if (!r || r.ok === false) {
        mgSmLoading.hidden = true;
        mgSmDenied.hidden  = false;
        return;
      }
      renderSupportModelsEditor(r.models || {});
      smLoaded = true;
    } catch (e) {
      mgSmLoading.hidden = true;
      mgSmDenied.hidden  = false;
      console.error('[manage] errore caricamento modelli di supporto:', e);
    } finally {
      smLoading = false;
    }
  }

  function rileggiModelliRifiutati() {
    if (!smLoaded && !smLoading && mgSmDenied && !mgSmDenied.hidden) loadSupportModels();
  }

  // Render dell'editor (chiave + registro giudici + nickname + slot) e reveal.
  // Estratta da loadSupportModels così i test possono esercitarla senza il canale.
  function renderSupportModelsEditor(models) {
    if (models && Array.isArray(models.sharedNicknames)) smSharedNicknames = models.sharedNicknames;
    if (models && models.appRegistry && typeof models.appRegistry === 'object') smAppRegistry = models.appRegistry;
    ensureSmCatalog();
    applyJudgeKeyState(models || {});
    renderJudgeRegistry((models || {}).judgeRegistry || {});
    populateSmNicknames();
    renderSmSlots(models || {});
    mgSmLoading.hidden = true;
    mgSmDenied.hidden  = true;
    mgSmEditor.hidden  = false;
  }

  async function saveSupportModels() {
    if (!smLoaded) return;
    const models = {};
    for (const slot of SM_SLOTS) {
      const value = smChains[slot] ? smChains[slot].getValue() : '';
      if (slot in smUnsetShown && value === smUnsetShown[slot]) continue;
      models[slot] = value;
    }
    const judgeRegistry = collectJudgeRegistry();
    const openrouterKey = mgSmKeyInput ? mgSmKeyInput.value.trim() : '';
    mgSmSaveBtn.disabled = true;
    setSmStatus('Salvataggio…', '');
    try {
      const r = await sendToMain({ type: 'support_models_update', models, judgeRegistry, openrouterKey });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'aggiornamento rifiutato');
      // Ricarica i valori salvati (confirma round-trip Firestore).
      if (mgSmKeyInput) mgSmKeyInput.value = ''; // non riteniamo la chiave in pagina
      applyJudgeKeyState(r.models || {});
      if (r.models && Array.isArray(r.models.sharedNicknames)) smSharedNicknames = r.models.sharedNicknames;
      if (r.models && r.models.appRegistry && typeof r.models.appRegistry === 'object') smAppRegistry = r.models.appRegistry;
      renderJudgeRegistry((r.models || {}).judgeRegistry || judgeRegistry);
      populateSmNicknames();
      renderSmSlots(r.models || models);
      setSmStatus('Salvato.', 'ok');
    } catch (e) {
      setSmStatus(e.message || 'Errore nel salvataggio', 'err');
    } finally {
      mgSmSaveBtn.disabled = false;
      clearTimeout(saveSupportModels._t);
      saveSupportModels._t = setTimeout(() => setSmStatus('', ''), 4000);
    }
  }

  if (mgSmSaveBtn) mgSmSaveBtn.addEventListener('click', saveSupportModels);
  if (mgSmRegistryAdd) mgSmRegistryAdd.addEventListener('click', () => {
    if (mgSmRegistryList) mgSmRegistryList.appendChild(makeRegistryRow('', {}));
  });

  // Caricamento pigro: la prima volta che si mostra "Automazioni", che li ospita (#1110).
  document.addEventListener('mg-scheda', (e) => {
    if (e.detail.tab !== 'automation') return;
    if (!smLoaded && !smLoading) loadSupportModels();
  });

  // Tab "Log": ricarica il log dei worker a OGNI apertura (non solo la prima) —
  // vogliamo vedere gli spawn nuovi dall'ultima volta. È una singola lettura di
  // documento, quindi rileggerla a ogni click è a costo trascurabile.
  document.addEventListener('mg-scheda', (e) => {
    if (e.detail.tab === 'log') loadWorkerLog();
  });

  // "Ricevuti" e "Automazioni" (le richieste da decidere) e "Log" (la traccia
  // delle decisioni passate): le fusioni si rileggono a OGNI apertura — una
  // richiesta già decisa o appena arrivata renderebbe la sezione una
  // fotografia vecchia.
  document.addEventListener('mg-scheda', (e) => {
    if (['automation', 'inbox', 'log'].includes(e.detail.tab)) loadMergeApprovals();
  });

  // ══ Tab "Statistiche feedback" (#496) ═══════════════════════════════════
  //
  // DUE SORGENTI, DUE DATE, e non sono intercambiabili (il perché sta in
  // src/shared/feedbackStats.js, che fa i conti):
  //   · l'INSIEME dei feedback, letto per intero — non i 500 più recenti che
  //     riempiono la lista a sinistra. Qui le domande sono sul totale
  //     («quanti ne sono arrivati»), e a una domanda sul totale una finestra
  //     sui più recenti risponde sbagliato in silenzio
  //     (patterns/una-pagina-dei-piu-recenti-non-e-tutto.md);
  //   · il REGISTRO DEI WORKER, che porta la data di LAVORAZIONE.
  //
  // Tutto si ricalcola in pagina a ogni cambio di finestra o di filtro: i dati
  // si leggono una volta per apertura, i conti costano microsecondi.
  const FS = window.SN_FEEDBACK_STATS;
  // La scelta della scheda, tutta intera: la finestra, le due date scritte a
  // mano e il filtro per mittente. Prima si ricordava la sola finestra, e
  // «Scegli tu» tornava con i campi vuoti: una finestra senza estremi vuol
  // dire TUTTO, quindi i numeri sullo schermo erano quelli di sempre sotto una
  // pasticca che prometteva un periodo scelto da te. Metà di una scelta
  // ricordata è peggio di nessuna.
  const FS_SCELTA_KEY = 'filo_manage_fs_scelta';
  const FS_RANGE_KEY  = 'filo_manage_fs_range';   // la vecchia chiave, letta come ripiego
  // I colori delle fette: un gradino per quanto è costato il lavoro, dal verde
  // di «passato subito» al rosso di «fermato, decidi tu» — lo stesso rosso con
  // cui la coda segna quello che aspetta l'owner. Palette fissa e non token di
  // tema: servono cinque colori distinguibili su chiaro e su scuro
  // (patterns/grafici-chart-svg-generato-a-mano-niente-librerie-esterne.md).
  const FS_COLORI = {
    g0: '#3bbf7a', g1: '#c9a13b', g2: '#c45a3b', g3: '#8a4fc4', fermati: '#c0392b',
  };

  const mgFsBody     = document.getElementById('mgFsBody');
  const mgFsDenied   = document.getElementById('mgFsDenied');
  const mgFsLoading  = document.getElementById('mgFsLoading');
  const mgFsRangeBar = document.getElementById('mgFsRange');
  const mgFsCustom   = document.getElementById('mgFsCustom');
  const mgFsFinestra = document.getElementById('mgFsFinestra');
  const mgFsFrom     = document.getElementById('mgFsFrom');
  const mgFsTo       = document.getElementById('mgFsTo');
  const mgFsCreators = document.getElementById('mgFsCreators');
  const mgFsNota     = document.getElementById('mgFsNota');
  const mgFsTiles    = document.getElementById('mgFsTiles');
  const mgFsPie      = document.getElementById('mgFsPie');
  const mgFsPieMid   = document.getElementById('mgFsPieMid');
  const mgFsPieHint  = document.getElementById('mgFsPieHint');
  const mgFsPieVuoto = document.getElementById('mgFsPieVuoto');
  const mgFsLegend   = document.getElementById('mgFsLegend');
  const mgFsEsiti    = document.getElementById('mgFsEsiti');
  const mgFsTrend    = document.getElementById('mgFsTrend');
  const mgFsTrendAxis = document.getElementById('mgFsTrendAxis');
  const mgFsTrendHint = document.getElementById('mgFsTrendHint');
  const mgFsAltro    = document.getElementById('mgFsAltro');
  const mgFsDrill      = document.getElementById('mgFsDrill');
  const mgFsDrillTitle = document.getElementById('mgFsDrillTitle');
  const mgFsDrillList  = document.getElementById('mgFsDrillList');
  const mgFsDrillClose = document.getElementById('mgFsDrillClose');

  let fsRangeKey = '30g';
  let fsCustom   = { da: '', a: '' };
  let fsCreators = [];       // vuoto = tutti i mittenti
  let fsAperto   = '';       // quale riquadro è espanso
  let fsFeedbacks = null;    // l'insieme completo (null = non ancora letto)
  let fsCompleto  = true;    // il freno sulle pagine non è scattato
  let fsRipiego   = false;   // lettura completa fallita: si usa la lista in pagina
  let fsLog       = [];
  let fsLogOk     = false;
  let fsCaricato  = false;
  let fsCaricando = false;
  let fsErrore    = '';

  // Una data buona è quella che i due campi sanno scrivere: 'AAAA-MM-GG'.
  // Qualunque altra cosa trovata in memoria si butta invece di farla arrivare
  // ai conti.
  const FS_DATA_OK = /^\d{4}-\d{2}-\d{2}$/;

  function fsLeggiScelta() {
    let salvata = null;
    try { salvata = JSON.parse(localStorage.getItem(FS_SCELTA_KEY) || 'null'); } catch (_) { salvata = null; }
    if (!salvata || typeof salvata !== 'object') {
      // Chi aveva già scelto una finestra prima di oggi non la perde.
      try {
        const vecchia = localStorage.getItem(FS_RANGE_KEY);
        if (vecchia && FS && FS.presetOf(vecchia)) fsRangeKey = vecchia;
      } catch (_) { /* senza memoria si riparte da 30 giorni */ }
      return;
    }
    if (FS && FS.presetOf(salvata.range)) fsRangeKey = salvata.range;
    const da = FS_DATA_OK.test(String(salvata.da || '')) ? String(salvata.da) : '';
    const a  = FS_DATA_OK.test(String(salvata.a  || '')) ? String(salvata.a)  : '';
    fsCustom = { da, a };
    if (Array.isArray(salvata.creatori) && FS) {
      fsCreators = salvata.creatori.filter((k) => FS.CREATORI.indexOf(k) >= 0);
    }
  }

  function fsSalvaScelta() {
    try {
      localStorage.setItem(FS_SCELTA_KEY, JSON.stringify({
        range: fsRangeKey, da: fsCustom.da || '', a: fsCustom.a || '', creatori: fsCreators.slice(),
      }));
    } catch (_) { /* senza memoria la scelta vale per questa volta */ }
  }

  if (FS) fsLeggiScelta();

  function fsRange() {
    return FS.rangeOf(fsRangeKey, Date.now(), fsCustom);
  }

  // I dati della scheda: l'insieme dei feedback (dal main, col cursore) e il
  // registro dei worker. Si rileggono a ogni apertura della scheda — lavoro
  // nuovo può essere successo nel frattempo, e una fotografia vecchia qui vale
  // meno di niente.
  async function loadFsData() {
    if (fsCaricando) return;
    fsCaricando = true;
    fsErrore = '';
    if (!isAdmin) {
      fsCaricando = false;
      renderFs();
      return;
    }
    if (!fsCaricato) { mgFsLoading.hidden = false; mgFsBody.hidden = true; }
    // Le due letture non dipendono l'una dall'altra: partono insieme.
    const [lista, log] = await Promise.all([
      (async () => {
        try {
          const r = await FB.listAllPaged({});
          return { rows: r.rows, complete: r.complete !== false, ripiego: false };
        } catch (err) {
          // La lettura completa non è passata. Meglio i numeri della lista già
          // in pagina che una scheda muta — ma si DICE, perché quei numeri
          // sono minimi e non totali.
          console.error('[manage] statistiche: lettura completa non riuscita:', err);
          return { rows: allFeedbacks, complete: false, ripiego: true, err };
        }
      })(),
      (async () => {
        try {
          const r = await sendToMain({ type: WORKER_LOG_GET });
          if (!r || r.ok === false) return { entries: [], ok: false };
          return { entries: r.entries || [], ok: true };
        } catch (err) {
          console.error('[manage] statistiche: registro dei worker non letto:', err);
          return { entries: [], ok: false };
        }
      })(),
    ]);

    fsFeedbacks = Array.isArray(lista.rows) ? lista.rows : [];
    fsChiesteIntere = new Set();
    fsCompleto  = lista.complete;
    fsRipiego   = lista.ripiego;
    if (lista.ripiego && lista.err && lista.err.code === 'FEEDBACK_READ_DENIED') {
      fsErrore = 'I feedback li vede chi li gestisce: accedi con un account amministratore.';
    }
    fsLog   = log.entries;
    fsLogOk = log.ok;

    // Lo stato viaggia cifrato: senza decifrarlo ogni categoria sarebbe
    // «non leggibile». Una sola IPC per tutta la lista, come fa il caricamento
    // della dashboard.
    if (fsFeedbacks.length && !fsRipiego) {
      try {
        const r = await sendToMain({ type: 'feedback_decrypt_fields', list: fsFeedbacks });
        if (r && r.ok && Array.isArray(r.list)) fsFeedbacks = r.list;
      } catch (_) { /* senza chiave i conti restano, le categorie no: lo dice la voce «non leggibile» */ }
    }

    fsCaricato = true;
    fsCaricando = false;
    renderFs();
  }

  // La pagina si rimette in pari da sola ogni tot secondi. Finché questa
  // scheda non seguiva quel giro, chi la lasciava aperta guardava i numeri di
  // quando l'aveva aperta: proprio mentre le routine lavorano, che è quando li
  // si guarda. I documenti freschi li ha già letti il giro della pagina, quindi
  // si applicano; dalla rete si legge solo una segnalazione nuova, intera.
  async function fsSegueLive(fresh, removed) {
    if (!fsCaricato || !Array.isArray(fsFeedbacks)) return;
    const via = new Set(Array.isArray(removed) ? removed : []);
    const nuovi = Array.isArray(fresh) ? fresh : [];
    const aperto = fsPannelloAperto();
    if (!nuovi.length && !via.size && !aperto) return;
    if (nuovi.length || via.size) {
      // Il giro rilegge una PROIEZIONE: sostituita al documento intero si
      // portava via l'esito del controllo di sicurezza (#677.5). Si fonde come
      // fa la lista.
      fsFeedbacks = LIVE.applyChanges(fsFeedbacks, { fresh: nuovi, removed: Array.from(via) });
    }
    // Il registro delle esecuzioni è l'ALTRA sorgente, e cammina per conto
    // suo: un'esplorazione che non trova niente lo fa crescere senza toccare
    // nessuna segnalazione. Finché lo si rileggeva solo a rimorchio di una
    // segnalazione cambiata, tre numeri della stessa riga (esplorazioni,
    // lavorati, lanci) restavano fermi all'apertura della scheda mentre
    // quelli accanto camminavano, e niente lo diceva. Costa una lettura al
    // minuto, e solo mentre la scheda è davanti agli occhi.
    if (aperto) {
      try {
        const r = await sendToMain({ type: WORKER_LOG_GET });
        if (r && r.ok !== false) { fsLog = r.entries || []; fsLogOk = true; }
      } catch (_) { /* il registro resta quello di prima: la nota lo dice già */ }
    }
    renderFs();
    if (aperto && !fsRipiego) fsCompletaRighe().then((fatto) => { if (fatto) renderFs(); }).catch(() => {});
  }

  // Una segnalazione NUOVA arrivata col giro è una riga d'elenco: senza i campi
  // di dettaglio il suo controllo di sicurezza risulterebbe «non letto» (#997).
  // A scheda davanti la si legge intera, una volta per caricamento.
  let fsChiesteIntere = new Set();
  async function fsCompletaRighe() {
    const ids = (fsFeedbacks || [])
      .filter((f) => f && f._proiezione && f._id && !fsChiesteIntere.has(f._id))
      .map((f) => f._id);
    if (!ids.length) return false;
    for (const id of ids) fsChiesteIntere.add(id);
    let interi;
    try {
      interi = await liveSources.getDettagli(ids);
    } catch (_) {
      return false;   // resta la riga, e il riquadro dice che l'esito non è letto
    }
    interi = (Array.isArray(interi) ? interi : []).filter((f) => f && f._id && !f._proiezione);
    if (!interi.length) return false;
    try {
      const r = await sendToMain({ type: 'feedback_decrypt_fields', list: interi });
      if (r && r.ok && Array.isArray(r.list)) interi = r.list;
    } catch (_) { /* come al caricamento: senza chiave lo dice la voce «non leggibile» */ }
    fsFeedbacks = LIVE.applyChanges(fsFeedbacks, { fresh: interi });
    return true;
  }

  function fsPannelloAperto() {
    const p = document.getElementById('panel-fbstats');
    return !!(p && p.classList.contains('mg-panel--active'));
  }

  // ── La barra della finestra e quella dei mittenti ────────────────────────
  function renderFsBars(stat) {
    // Ogni pasticca dice, passandoci sopra, DA CHE GIORNO parte davvero: «30
    // giorni» conta anche oggi, e senza le date vere si resta a indovinare.
    mgFsRangeBar.innerHTML = '<span class="mg-fs-bar-label">Finestra</span>'
      + FS.PRESETS.map((p) => {
        const r = FS.rangeOf(p.key, Date.now(), fsCustom);
        // «Tutto» non ha nemmeno una fine: tiene dentro apposta anche le
        // segnalazioni con la data spostata in avanti dall'orologio storto di
        // chi le ha mandate. Scrivere «a oggi» prometteva un limite che quella
        // finestra non ha.
        const quando = r.da == null
          ? (r.a == null ? 'tutte le segnalazioni, senza limiti di data' : `da sempre al ${FS.dataBreve(r.a)}`)
          : `dal ${FS.dataBreve(r.da)} a oggi`;
        return `<button type="button" class="mg-chip${p.key === fsRangeKey ? ' mg-chip--on' : ''}"`
          + ` data-fs-range="${esc(p.key)}" aria-pressed="${p.key === fsRangeKey}"`
          + ` title="${esc(p.custom ? 'Scegli tu le due date' : quando)}">${esc(p.label)}</button>`;
      }).join('');
    mgFsCustom.hidden = fsRangeKey !== 'custom';
    // I due campi dicono la finestra che la scheda sta davvero usando, anche
    // quando quella finestra arriva dalla memoria e non da un clic di adesso.
    // Non si tocca il campo su cui sta scrivendo qualcuno: la data si legge a
    // pezzi mentre la si scrive, e riscriverla sotto le dita la cancella.
    for (const [campo, valore] of [[mgFsFrom, fsCustom.da], [mgFsTo, fsCustom.a]]) {
      if (campo && campo !== document.activeElement && campo.value !== (valore || '')) {
        campo.value = valore || '';
      }
    }
    // Quale finestra stai guardando DAVVERO, scritta come le altre date della
    // scheda. Serve a due cose: i due campi seguono la lingua del sistema (su
    // un computer non italiano scrivono mm/gg/aaaa), e due date messe al
    // contrario si raddrizzano da sole, cosa che prima non diceva nessuno.
    if (mgFsFinestra) {
      const r = stat ? stat.range : FS.rangeOf(fsRangeKey, Date.now(), fsCustom);
      const rovescio = !!(fsCustom.da && fsCustom.a && fsCustom.da > fsCustom.a);
      let testo = '';
      if (r.da == null && r.a == null) testo = 'Guardi tutto, senza limiti di data: nessuna delle due date è scelta.';
      else if (r.da == null) testo = `Guardi tutto fino al ${FS.dataBreve(r.a)}.`;
      else if (r.a == null) testo = `Guardi dal ${FS.dataBreve(r.da)} in poi.`;
      else testo = `Guardi dal ${FS.dataBreve(r.da)} al ${FS.dataBreve(r.a)}.`;
      mgFsFinestra.textContent = testo + (rovescio ? ' Le due date erano al contrario: le ho raddrizzate.' : '');
    }

    // Un mittente per pasticca, col conteggio dentro la finestra: la barra dei
    // filtri dice anche quanto contiene ogni voce, come la barra delle sezioni.
    // Il conteggio è quello SENZA filtro: è il numero che serve per decidere
    // quale pasticca accendere dopo, e calcolarlo col filtro attivo mandava a
    // zero tutte quelle spente.
    const conti = Object.create(null);
    for (const c of (stat ? stat.ricevuti.creatoriTutti : [])) conti[c.kind] = c.n;
    const tuttiOn = fsCreators.length === 0;
    // Le due pasticche di gruppo: «quanto è arrivato dalle persone» e «quanto
    // hanno prodotto le routine» sono le due domande che ci si fa qui, e con
    // una pasticca per mittente costavano sei clic e la conoscenza di quale
    // voce è una routine. La segnalazione chiedeva per esempio i feedback
    // «lanciati da prober o altre routine cloud».
    const gruppi = FS.GRUPPI_CREATORI.map((gr) => {
      const on = fsGruppoAcceso(gr);
      const n = gr.kinds.reduce((s, k) => s + (conti[k] || 0), 0);
      return `<button type="button" class="mg-chip${on ? ' mg-chip--on' : ''}" data-fs-creator="${esc(gr.key)}"`
        + ` aria-pressed="${on}" title="${esc(`${gr.label}: ${gr.kinds.map((k) => fsEtichettaCreatore(k)).join(', ')}`)}">`
        + `${esc(gr.label)}<span class="mg-chip-n">${esc(fsNum(n))}</span></button>`;
    }).join('');
    const voci = gruppi + FS.CREATORI.map((kind) => {
      const meta = FS.CLASSI_META[kind] || { icon: '', label: kind };
      const on = fsCreators.indexOf(kind) >= 0;
      const n = conti[kind] || 0;
      return `<button type="button" class="mg-chip${on ? ' mg-chip--on' : ''}" data-fs-creator="${esc(kind)}"`
        + ` aria-pressed="${on}" title="${esc(meta.label)}">${meta.icon} ${esc(meta.label)}`
        + `<span class="mg-chip-n">${esc(fsNum(n))}</span></button>`;
    }).join('');
    // Anche «Tutti» porta il suo numero, come ogni altra pasticca della barra:
    // era l'unica senza, e senza numero non aveva nemmeno niente da offrire col
    // tasto destro.
    const tuttiN = FS.CREATORI.reduce((s, k) => s + (conti[k] || 0), 0)
      + (conti[FS.CREATORE_ILLEGGIBILE] || 0);
    mgFsCreators.innerHTML = '<span class="mg-fs-bar-label">Creatore</span>'
      + `<button type="button" class="mg-chip${tuttiOn ? ' mg-chip--on' : ''}" data-fs-creator="__tutti"`
      + ` aria-pressed="${tuttiOn}" title="Tutti i mittenti, senza filtro">Tutti`
      + `<span class="mg-chip-n">${esc(fsNum(tuttiN))}</span></button>` + voci;
  }

  // Un conto scritto dentro una frase: resta parte della frase, ma si apre su
  // ciò che ha contato come ogni altro numero della scheda.
  function fsContoInFrase(chiave, n, testo) {
    return `<button type="button" class="mg-fs-quanti" data-fs-esito="${esc(chiave)}"`
      + ` title="${esc(`Mostra ${n === 1 ? 'la segnalazione contata' : 'le segnalazioni contate'}`)}">${esc(testo)}</button>`;
  }

  // ── Da dove partono davvero i numeri ─────────────────────────────────────
  // Un conteggio che afferma un totale che non conosce è peggio di nessun
  // conteggio (CLAUDE.md § Limiti). Qui si dice, in una riga, fin dove
  // arrivano le due sorgenti. `righe` porta HTML: il testo passa da `esc`.
  function renderFsNota(stat) {
    const righe = [];
    const testo = (t) => righe.push(esc(t));
    if (fsRipiego) {
      testo(fsErrore
        ? fsErrore
        : `Non è riuscita la lettura di tutte le segnalazioni: i numeri vengono dalla lista già in pagina${caricoIncompleto ? ", che è incompleta: sono minimi, non totali" : ", senza i campi di dettaglio"}.`);
    } else if (!fsCompleto) {
      testo('La lettura delle segnalazioni si è fermata prima della fine: i numeri sulle segnalazioni sono minimi, non totali.');
    }
    const cop = stat.copertura;
    if (!fsLogOk) {
      testo('Il registro delle esecuzioni delle routine non si è letto: esplorazioni, lavorati, lanci e giri di verifica non si sanno finché non torna, e al loro posto c\'è un trattino.');
    } else if (cop.logVuoto) {
      testo('Il registro delle esecuzioni delle routine è vuoto: esplorazioni, lavorati e giri di verifica non hanno ancora niente da contare.');
    } else if (cop.logCorto) {
      testo(`Il registro delle esecuzioni tiene le ultime: parte dal ${FS.dataBreve(cop.logDa)}. Esplorazioni, lavorati e giri di verifica contano da lì, non dall'inizio della finestra.`);
    }
    // Una segnalazione con la data d'arrivo mancante o illeggibile non cade in
    // nessuna finestra, «Tutto» compreso: qui si dice quante sono, e il numero
    // è l'unica strada per vederle.
    const sd = stat.ricevuti.senzaData;
    if (sd > 0) {
      righe.push(sd === 1
        ? `${fsContoInFrase('senzaData', 1, 'Una segnalazione')} ${esc('non ha una data d\'arrivo leggibile: resta fuori da ogni finestra, «Tutto» compreso.')}`
        : `${fsContoInFrase('senzaData', sd, fsNum(sd))} ${esc('segnalazioni non hanno una data d\'arrivo leggibile: restano fuori da ogni finestra, «Tutto» compreso.')}`);
    }
    // Il mittente viaggia cifrato come lo stato. Senza la chiave privata non si
    // legge, e la ripartizione per mittente (una delle cose chieste) non può
    // essere completa: si dice, invece di attribuirli tutti a una persona.
    const mi = stat.ricevuti.mittentiIgnoti;
    if (mi > 0) {
      righe.push(mi === 1
        ? `Di ${fsContoInFrase('mittentiIgnoti', 1, 'una segnalazione')} ${esc('non si è potuto leggere il mittente: serve la chiave dell\'owner su questo computer. Nel filtro per creatore non c\'è.')}`
        : `Di ${fsContoInFrase('mittentiIgnoti', mi, fsNum(mi))} ${esc('segnalazioni non si è potuto leggere il mittente: serve la chiave dell\'owner su questo computer. Nel filtro per creatore non ci sono.')}`);
    }
    mgFsNota.innerHTML = righe.join(' ');
    mgFsNota.hidden = righe.length === 0;
  }

  // ── I riquadri ───────────────────────────────────────────────────────────
  // Cosa conta ogni riquadro, e SU QUALE DATA. È la differenza che la scheda
  // non può mostrare coi numeri: i ricevuti vanno sulla data d'invio, i
  // lavorati e i lanci sulla data in cui le routine hanno girato. Passandoci
  // sopra si legge, invece di doverlo dedurre da due numeri che non tornano.
  const FS_SPIEGA = {
    ricevuti: 'Segnalazioni la cui DATA D\'INVIO cade nella finestra. Cliccalo per la divisione per categoria e per mittente.',
    lavorati: 'Segnalazioni su cui una routine ha lavorato nella finestra, contate sulla DATA DI LAVORAZIONE: una segnalazione vecchia lavorata ieri conta qui, non fra i ricevuti.',
    prober: 'Quante volte è partita l\'esplorazione dell\'app. Un lancio non ha un mittente, quindi il filtro per creatore non lo tocca.',
    lanci: 'Tutte le esecuzioni delle routine nella finestra, di qualunque mestiere. Un\'esecuzione non ha un mittente, quindi il filtro per creatore non la tocca. Cliccalo per la divisione per mestiere.',
    attesa: 'Quanto è rimasta in attesa una segnalazione prima che tu la prendessi in mano, al centro dell\'ordine.',
    durata: 'Dal primo all\'ultimo passaggio di lavorazione della stessa segnalazione, al centro dell\'ordine.',
    audit: 'Il controllo di sicurezza sul lavoro fatto, sulle segnalazioni lavorate in questa finestra.',
    arenati: 'Lavorazioni che si sono fermate e che il server ha rimesso in coda da solo.',
  };

  // Il nome del mittente di una riga della ripartizione. Un mittente che non
  // si è potuto leggere (chiave privata assente) NON è «Utente»: ha un nome
  // suo, lo stesso che la scheda usa già per la categoria illeggibile.
  function fsEtichettaCreatore(kind) {
    if (kind === FS.CREATORE_ILLEGGIBILE) return FS.ETICHETTA_ILLEGGIBILE;
    const gr = FS.GRUPPI_CREATORI.find((x) => x.key === kind);
    if (gr) return gr.label;
    return (FS.CLASSI_META[kind] || { label: kind }).label;
  }
  // Il ruolo di una routine che ha scritto il feedback (`mittenteRuolo`), coi nomi del registro dei lanci.
  const FS_RUOLI_MITTENTE = { residuo: 'Rilievi residui', ignoto: 'Ruolo non indicato' };
  function fsEtichettaRuolo(ruolo) {
    return FS_RUOLI_MITTENTE[ruolo] || roleLabel(ruolo);
  }

  // Un gruppo è acceso quando il filtro è ESATTAMENTE quel gruppo: se ci si
  // aggiunge o si toglie un mittente a mano, la pasticca si spegne invece di
  // dichiarare una selezione che non è più la sua.
  function fsGruppoAcceso(gr) {
    return gr.kinds.length === fsCreators.length && gr.kinds.every((k) => fsCreators.includes(k));
  }

  /**
   * Un riquadro. `modo`:
   *   'espandi' → si apre qui sotto sulla sua ripartizione;
   *   'apri'    → apre l'elenco delle segnalazioni che ha contato;
   *   false     → dietro non c'è niente da aprire, e non finge di esserci.
   */
  // Un numero che non si conosce si scrive col trattino, mai con uno zero: uno
  // zero grande si legge «non è successo niente», che è il contrario di «non lo
  // so». I conti tornano `null` quando la sorgente non ha risposto.
  // I numeri si scrivono all'italiana, come ovunque in Filo: il punto separa
  // le migliaia e la virgola i decimali (regola: tests/unit/numeriItaliani.test.mjs).
  const FS_FMT = (() => {
    try { return new Intl.NumberFormat('it-IT', { useGrouping: true }); } catch (_) { return null; }
  })();
  function fsCifra(v, decimali) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return String(v);
    try {
      return decimali
        ? v.toLocaleString('it-IT', { useGrouping: true, minimumFractionDigits: decimali, maximumFractionDigits: decimali })
        : (FS_FMT ? FS_FMT.format(v) : String(v));
    } catch (_) { return decimali ? v.toFixed(decimali) : String(v); }
  }
  function fsNum(v) { return v == null ? '—' : fsCifra(v); }
  // «Nome: conto», per ogni etichetta che porta un numero, compresi i
  // suggerimenti col mouse: lì il conto si leggeva «1200» e la legenda «1.200».
  function fsRigaConto(label, n) { return `${label}: ${fsNum(n)}`; }
  function fsRigaCritiche(n) { return n === 1 ? '1 critica' : `${fsNum(n)} critiche`; }

  /**
   * `sottoId`: il sottotitolo conta delle segnalazioni SUE, diverse da quelle
   * del numero grande, e si apre su quelle. Serve al riquadro delle
   * esplorazioni, dove il numero grande conta PARTENZE — che non sono
   * segnalazioni e non si aprono su niente — mentre la riga piccola conta i
   * ritrovamenti. Finché ad aprirsi era il riquadro intero, un numero che
   * diceva cinque apriva un elenco di uno, e il tasto destro sopra quel cinque
   * offriva «Mostra la segnalazione contata»
   * (patterns/un-numero-si-apre-su-cosa-ha-contato.md: un numero apre ciò che
   * HA contato, e dove non c'è niente da aprire la superficie non finge).
   */
  function fsTile(id, n, titolo, sotto, modo, sottoId) {
    const dettaglio = modo === 'espandi';
    const apribile = modo === 'apri';
    const aperto = dettaglio && fsAperto === id;
    // Un riquadro che si apre è un PULSANTE, tanto quando si espande qui sotto
    // quanto quando apre l'elenco delle segnalazioni. Finché il secondo era un
    // riquadro qualunque, il fuoco lo saltava: si apriva col mouse e col tasto
    // destro, e da tastiera quel numero non portava da nessuna parte, contro
    // la regola scritta in patterns/un-numero-si-apre-su-cosa-ha-contato.md
    // (clic, Invio o Spazio, tasto destro). Da pulsante, Invio e Spazio
    // diventano un clic da soli.
    const tag = (dettaglio || apribile) ? 'button' : 'div';
    const cls = 'mg-tile' + (dettaglio || apribile ? ' mg-tile--click' : '') + (aperto ? ' mg-tile--open' : '');
    // Se è un numero lo si decide sul valore crudo: dopo la formattazione
    // all'italiana «1.200» sarebbe ancora un numero per `Number()`, ma «12 ore»
    // no, ed è quello il caso che questa classe distingue.
    const testo = typeof n !== 'number' && !Number.isFinite(Number(n));
    n = fsNum(n);
    const spiega = FS_SPIEGA[id] ? ` title="${esc(FS_SPIEGA[id])}"` : '';
    // `data-fs-id` sta su TUTTI i riquadri (è il nome della cosa contata);
    // `data-fs-tile` solo su quelli che si aprono, perché è quello che
    // l'ascoltatore del clic cerca.
    return `<${tag} class="${cls}" data-fs-id="${esc(id)}"${spiega}`
      + `${tag === 'button' ? ' type="button"' : ''}`
      + `${dettaglio ? ` data-fs-tile="${esc(id)}" aria-expanded="${aperto}"` : ''}>`
      + `<span class="mg-tile-n${testo ? ' mg-tile-n--txt' : ''}">${esc(String(n))}</span>`
      + `<span class="mg-tile-t">${esc(titolo)}</span>`
      + (sotto
        ? (sottoId
          ? `<button type="button" class="mg-tile-sub mg-tile-sub--click" data-fs-id="${esc(sottoId)}"`
            + ` title="Mostra le segnalazioni contate">${esc(sotto)}</button>`
          : `<span class="mg-tile-sub">${esc(sotto)}</span>`)
        : '')
      + (dettaglio ? `<span class="mg-tile-more"><span class="mg-tile-caret">›</span>${aperto ? 'chiudi' : 'vedi il dettaglio'}</span>` : '')
      + (apribile ? '<span class="mg-tile-more"><span class="mg-tile-caret">›</span>vedi le segnalazioni</span>' : '')
      + `</${tag}>`;
  }

  // Un elenco a barre: etichetta, barra proporzionale, numero. Una riga che ha
  // delle segnalazioni dietro è un pulsante, e si apre su quelle: ogni numero
  // della scheda porta a cosa ha contato.
  function fsBars(voci, gruppo) {
    if (!voci.length) return '<p class="mg-fs-empty">Niente in questa finestra.</p>';
    const max = Math.max.apply(null, voci.map((v) => v.n)) || 1;
    return '<ul class="mg-bars">' + voci.map((v) => {
      const apribile = !!((v.ids && v.ids.length) || (v.mancanti && v.mancanti.length));
      const tag = apribile ? 'button' : 'div';
      return `<li><${tag} class="mg-bar-row${apribile ? ' mg-bar-row--click' : ''}"`
        + ` data-fs-bar="${esc(v.key)}"${gruppo ? ` data-fs-bargroup="${esc(gruppo)}"` : ''}`
        + (apribile ? ` type="button" title="${esc(`Mostra le ${v.n === 1 ? 'segnalazione contata' : 'segnalazioni contate'}`)}"` : '')
        + '>'
        + `<span class="mg-bar-label" title="${esc(v.label)}">${esc(v.label)}</span>`
        + `<span class="mg-bar-track"><span class="mg-bar-fill" style="width:${Math.round((v.n / max) * 100)}%"></span></span>`
        + `<span class="mg-bar-n">${esc(fsNum(v.n))}</span></${tag}></li>`;
    }).join('') + '</ul>';
  }

  function fsDettaglio(stat) {
    if (fsAperto === 'ricevuti') {
      return { titolo: 'Feedback ricevuti, divisi per categoria', html: fsBars(stat.ricevuti.categorie, 'categorie')
        + '<h4 style="margin-top:14px">…e per chi li ha mandati</h4>'
        + fsBars(stat.ricevuti.creatori.map((c) => ({
          key: c.kind, n: c.n, ids: c.ids, label: fsEtichettaCreatore(c.kind),
        })), 'creatori')
        + ((stat.ricevuti.ruoliRoutine || []).length
          ? '<h4 style="margin-top:14px">…e le routine, per ruolo</h4>'
            + fsBars(stat.ricevuti.ruoliRoutine.map((r) => ({ key: r.key, n: r.n, ids: r.ids, label: fsEtichettaRuolo(r.key) })), 'ruoliRoutine')
          : '') };
    }
    if (fsAperto === 'lavorati') {
      return { titolo: 'Dove sono arrivati, oggi', html: fsBars(stat.lavorati.stati, 'stati') };
    }
    if (fsAperto === 'audit') {
      // Tre numeri in un riquadro solo: aperto, diventano tre righe, e ognuna
      // porta alle segnalazioni che ha contato come tutte le altre.
      return { titolo: 'Il controllo di sicurezza sui lavori di questa finestra', html: fsBars([
        { key: 'pass',    n: stat.audit.pass,    ids: stat.auditIds.pass,    label: 'Passati' },
        { key: 'fail',    n: stat.audit.fail,    ids: stat.auditIds.fail,    label: 'Bocciati' },
        { key: 'saltato', n: stat.audit.saltato, ids: stat.auditIds.saltato, label: 'Saltati da te' },
      ].filter((v) => v.n > 0), 'audit') };
    }
    if (fsAperto === 'lanci') {
      // Un lancio non è una segnalazione: qui non c'è niente da aprire, e
      // infatti le righe non fanno finta di essere pulsanti.
      return { titolo: 'Lanci per mestiere', html: fsBars(stat.lanci.perRuolo.map((r) => ({
        key: r.role, n: r.n, label: roleLabel(r.role),
      })), 'ruoli') };
    }
    return null;
  }

  // Quali riquadri si aprono qui sotto: i tre in cima. Il quarto pannello
  // ('audit') vive sotto l'altra fila, e senza questa distinzione la sua
  // ripartizione compariva in mezzo ai riquadri sbagliati.
  const FS_DETTAGLI_TILES = ['ricevuti', 'lavorati', 'lanci'];

  // Quali riquadri si aprono qui sotto, sul conto di ADESSO. La leggono chi
  // disegna e chi tiene aperto il pannello: un riquadro che non si apre più
  // perde anche «chiudi», e il suo pannello restava lì senza uscita (#997).
  function fsEspandibili(stat) {
    const ko = stat.copertura.registroLetto === false;
    const a = stat.audit;
    return {
      ricevuti: stat.copertura.feedbackLetti !== false,
      lavorati: !ko,
      lanci: !ko,
      audit: ((a.pass || 0) + (a.fail || 0) + (a.saltato || 0)) > 0,
    };
  }

  function renderFsTiles(stat) {
    const det = FS_DETTAGLI_TILES.includes(fsAperto) ? fsDettaglio(stat) : null;
    const esp = fsEspandibili(stat);
    // Col registro non letto i tre riquadri che ne vivono non hanno un numero.
    // Il trattino da solo non basta: lo dicono anche sul riquadro, perché la
    // riga sopra sta in dodici pixel e il numero grande ne ha trenta.
    const ko = stat.copertura.registroLetto === false;
    const noto = ko ? 'registro delle routine non letto' : '';
    const fbKo = stat.copertura.feedbackLetti === false;
    mgFsTiles.innerHTML = [
      fsTile('ricevuti', stat.ricevuti.totale, 'Feedback ricevuti',
        fbKo ? 'segnalazioni non lette' : '', esp.ricevuti ? 'espandi' : false),
      // «in tutto» prometteva un totale che questo numero non ha: conta le
      // verifiche partite DENTRO la finestra, mentre la torta qui sotto conta
      // le critiche di un lavoro su tutto il registro. Con una finestra
      // stretta le due cose si contraddicevano a vista («1 verifica in tutto»
      // sopra, «2 critiche» sotto, stesso lavoro).
      fsTile('lavorati', stat.lavorati.totale, 'Feedback lavorati',
        ko ? noto : (stat.lavorati.verifiche
          ? `${fsNum(stat.lavorati.verifiche)} ${stat.lavorati.verifiche === 1 ? 'verifica partita' : 'verifiche partite'} in questa finestra`
          : ''), esp.lavorati ? 'espandi' : false),
      // Il numero grande conta PARTENZE dell'esplorazione: non sono
      // segnalazioni e non si aprono su niente, quindi il riquadro non promette
      // di aprirsi. A portare alle segnalazioni è la riga piccola, che è
      // l'unica delle due a contarle.
      fsTile('prober', stat.prober.lanciati, 'Esplorazioni lanciate',
        // I ritrovamenti vengono dalle segnalazioni: quelli si sanno lo stesso.
        (ko ? noto + ' · ' : '')
          + (fbKo
            ? 'segnalazioni dell\'esploratore non lette'
            : `${fsNum(stat.prober.ritrovamenti)} ${stat.prober.ritrovamenti === 1 ? 'segnalazione' : 'segnalazioni'} dall'esploratore`),
        false,
        stat.prober.ritrovamentiIds.length ? 'proberTrovate' : ''),
      fsTile('lanci', stat.lanci.totale, 'Lanci delle routine', ko ? noto : '', esp.lanci ? 'espandi' : false),
    ].join('') + (det
      ? `<div class="mg-fs-detail"><h4>${esc(det.titolo)}</h4>${det.html}</div>`
      : '');
  }

  // ── La torta dei giri ────────────────────────────────────────────────────
  // SVG a mano, una fetta per gruppo con `data-group` (così uno spec può
  // asserire QUALI fette ci sono e quanto valgono) e un buco al centro dove
  // sta la media — la risposta alla domanda che il grafico pone.
  function renderFsPie(stat) {
    const NS = 'http://www.w3.org/2000/svg';
    const fette = stat.giri.fette;
    const totale = fette.reduce((s, f) => s + f.n, 0);
    mgFsPie.innerHTML = '';
    mgFsLegend.innerHTML = '';

    // Chi entra nella torta e chi no, detto dove si guarda. I lavori ancora in
    // mezzo al giro restano fuori: le loro critiche possono ancora aumentare, e
    // contarli fra i «passati subito» faceva dire alla scheda che il lavoro più
    // aperto di tutti era il più economico.
    const aperti = stat.giri.aperti;
    const ignoti = stat.giri.ignoti;
    const senzaGiri = stat.giri.senzaGiri;
    const statoIgnoto = stat.giri.statoIgnoto || 0;
    // Ogni numero di questa frase è un conto come gli altri e si apre su ciò
    // che ha contato: erano gli ultimi rimasti muti, e il caso più comune —
    // il registro conserva solo le ultime esecuzioni — finisce proprio qui.
    const coda = [];
    const numeroApribile = (chiave, n) => fsContoInFrase(chiave, n, fsNum(n));
    if (aperti) coda.push(`${numeroApribile('aperti', aperti)} ${aperti === 1 ? 'lavoro è ancora in mezzo al giro e non entra' : 'lavori sono ancora in mezzo al giro e non entrano'} nel conto.`);
    // Senza la chiave dell'owner lo stato non si legge, e dove sia arrivato
    // quel lavoro è proprio la domanda a cui la torta risponde: si dichiara,
    // invece di darlo per ancora aperto (che su un lavoro già chiuso è il
    // contrario del vero).
    if (statoIgnoto) {
      coda.push(`${numeroApribile('statoIgnoto', statoIgnoto)} ${statoIgnoto === 1
        ? 'lavoro ha lo stato cifrato e non leggibile con questa chiave: dov\'è arrivato non si sa, quindi resta fuori dal conto.'
        : 'lavori hanno lo stato cifrato e non leggibile con questa chiave: dove sono arrivati non si sa, quindi restano fuori dal conto.'}`);
    }
    if (senzaGiri) coda.push(`${numeroApribile('senzaGiri', senzaGiri)} ${senzaGiri === 1 ? 'lavoro ha avuto il via libera ma le sue verifiche sono più vecchie del registro' : 'lavori hanno avuto il via libera ma le loro verifiche sono più vecchie del registro'}: quanto ${senzaGiri === 1 ? 'è costato' : 'sono costati'} non si sa.`);
    if (ignoti) coda.push(`${numeroApribile('ignoti', ignoti)} ${ignoti === 1 ? 'lavoro non è' : 'lavori non sono'} fra le segnalazioni caricate, quindi non se ne conosce l'esito.`);
    // La frase diceva «su tutta la storia del lavoro», e la riga in cima alla
    // scheda diceva il contrario: il registro tiene le ultime esecuzioni, e i
    // giri più vecchi di così non si contano. Due frasi opposte sulla stessa
    // schermata, con la media che passava per esatta.
    // Il registro non si è letto: questa sezione non ha guardato niente, e
    // dirlo è tutto quello che può fare. Scrivere «nessun lavoro verificato»
    // sarebbe un'affermazione su dati che non ha letto nessuno.
    const registroKo = stat.copertura.registroLetto === false;
    if (registroKo) {
      mgFsPieHint.textContent = 'Quanto è costato ogni lavoro si conta sul registro delle esecuzioni delle routine, '
        + 'e quel registro non si è letto: finché non torna, qui non c\'è niente da contare.';
      fsTortaVuota('Il registro delle esecuzioni non si è letto, quindi quanto è costato ogni lavoro non si sa.');
      return;
    }
    // La porta gemella: dove sia arrivato ogni lavoro sta sulla sua
    // segnalazione, e le segnalazioni non si sono lette.
    if (stat.copertura.feedbackLetti === false) {
      mgFsPieHint.textContent = 'Dove è arrivato ogni lavoro si legge sulla sua segnalazione, '
        + 'e le segnalazioni non si sono lette: finché non tornano, qui non c\'è niente da contare.';
      fsTortaVuota('Le segnalazioni non si sono lette, quindi quanto è costato ogni lavoro non si sa.');
      return;
    }
    const soloRegistro = stat.copertura.logCorto
      ? `Si contano i giri che il registro conserva, che parte dal ${FS.dataBreve(stat.copertura.logDa)}: un lavoro cominciato prima può risultare più economico di quanto è stato. `
      : 'Le critiche si contano su tutta la storia del lavoro che il registro conserva, anche i giri successi fuori dalla finestra. ';
    mgFsPieHint.innerHTML = esc('Un lavoro esce dal giro automatico quando la verifica non ha più niente da ridire. '
      + 'Ogni verifica in più è una critica che l\'ha rimandato indietro. '
      + soloRegistro
      + 'Quelli fermati aspettano una tua decisione e non entrano nella media. ')
      + coda.join(' ');

    if (!totale) {
      fsTortaVuota(aperti
        ? 'Nessun lavoro è ancora arrivato al via libera in questa finestra.'
        : (statoIgnoto
          ? 'Lo stato di questi lavori non si legge con questa chiave.'
          : 'Nessun lavoro verificato in questa finestra.'));
      return;
    }
    fsTortaVisibile(true);

    const cx = 100, cy = 100, r = 92, rInt = 58;
    if (fette.length === 1) {
      // Un gruppo solo: un anello pieno. L'arco da 0 a 2π collasserebbe.
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy);
      c.setAttribute('r', (r + rInt) / 2);
      c.setAttribute('fill', 'none');
      c.setAttribute('stroke', FS_COLORI[fette[0].key] || FS_COLORI.g0);
      c.setAttribute('stroke-width', r - rInt);
      c.dataset.group = fette[0].key;
      c.dataset.n = fette[0].n;
      const t0 = document.createElementNS(NS, 'title');
      t0.textContent = fsRigaConto(fette[0].label, fette[0].n);
      c.appendChild(t0);
      mgFsPie.appendChild(c);
    } else {
      let ang = -Math.PI / 2;   // si parte da ore 12
      for (const f of fette) {
        const next = ang + (f.n / totale) * Math.PI * 2;
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('d', fsAnello(cx, cy, r, rInt, ang, next));
        p.setAttribute('fill', FS_COLORI[f.key] || FS_COLORI.g0);
        p.dataset.group = f.key;
        p.dataset.n = f.n;
        const el = document.createElementNS(NS, 'title');
        el.textContent = fsRigaConto(f.label, f.n);
        p.appendChild(el);
        mgFsPie.appendChild(p);
        ang = next;
      }
    }

    const media = stat.giri.media;
    mgFsPieMid.innerHTML = media == null
      ? '<span>Nessun via libera in questa finestra</span>'
      : `<b>${esc(fsCifra(media, 1))}</b><span>critiche in media prima del via libera</span>`;

    mgFsLegend.innerHTML = fette.map((f) => `<li data-group="${esc(f.key)}" tabindex="0" role="button"`
      + ` title="${esc(`Mostra ${f.n === 1 ? 'la segnalazione contata' : 'le segnalazioni contate'}`)}">`
      + `<span class="mg-fs-sw" style="background:${FS_COLORI[f.key] || FS_COLORI.g0}"></span>`
      + `<span>${esc(f.label)}</span>`
      + `<span class="mg-fs-legend-n">${esc(fsNum(f.n))}</span></li>`).join('');
  }

  // Lo stato vuoto della sezione: la ciambella si TOGLIE invece di lasciare un
  // quadrato bianco di 200×200 con dentro, nel buco di un anello che non c'è,
  // la frase mandata a capo tre volte. La spiegazione va dove la si cerca,
  // sotto il titolo della sezione, e una volta sola.
  function fsTortaVisibile(on) {
    const box = mgFsPie && mgFsPie.closest('.mg-fs-pie');
    if (box) box.hidden = !on;
    if (mgFsPieVuoto) mgFsPieVuoto.hidden = on;
  }
  function fsTortaVuota(frase) {
    mgFsPieMid.innerHTML = '';
    mgFsLegend.innerHTML = '';
    if (mgFsPieVuoto) mgFsPieVuoto.textContent = frase;
    fsTortaVisibile(false);
  }

  // Una fetta di ANELLO: arco esterno in senso orario, arco interno indietro.
  function fsAnello(cx, cy, r, ri, start, end) {
    const grande = end - start > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end),   y2 = cy + r * Math.sin(end);
    const x3 = cx + ri * Math.cos(end),  y3 = cy + ri * Math.sin(end);
    const x4 = cx + ri * Math.cos(start), y4 = cy + ri * Math.sin(start);
    return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${grande} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} `
      + `L${x3.toFixed(2)} ${y3.toFixed(2)} A${ri} ${ri} 0 ${grande} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
  }

  // I due esiti che il grafico non racconta da solo: quanti sono stati fermati
  // e passati all'owner, e quanti sono passati lasciando indietro dei rilievi.
  function renderFsEsiti(stat) {
    const voce = (key, n, testo) => {
      const apribile = n > 0;
      return `<div class="mg-fs-esito${apribile ? ' mg-fs-esito--click' : ''}" data-fs-esito="${esc(key)}"`
        + (apribile ? ` tabindex="0" role="button" title="${esc(`Mostra ${n === 1 ? 'la segnalazione contata' : 'le segnalazioni contate'}`)}"` : '')
        + `><b>${esc(fsNum(n))}</b>${testo}</div>`;
    };
    mgFsEsiti.innerHTML = [
      voce('fermati', stat.giri.fermati, 'fermati: il giro automatico non ce l\'ha fatta e aspettano te'),
      voce('rimandati', stat.giri.rimandati, 'passati lasciando indietro dei rilievi, raccolti in una segnalazione derivata'),
      voce('aperti', stat.giri.aperti, 'ancora in mezzo al giro: quanto costeranno non si sa ancora'),
    ].join('');
  }

  // ── L'andamento nel tempo ────────────────────────────────────────────────
  // Il passo lo sceglie il conto sulla lunghezza della finestra, e va fino
  // all'anno: un elenco che si fermava al mese faceva scrivere «Una colonna
  // per undefined» su ogni finestra scritta a mano più lunga di dieci anni.
  // Il ripiego sul nome tecnico vale per il passo che verrà aggiunto dopo.
  const FS_PASSO_LABEL = { giorno: 'giorno', settimana: 'settimana', mese: 'mese', anno: 'anno' };
  function renderFsTrend(stat) {
    const serie = stat.ricevuti.serie;
    const punti = serie.punti;
    mgFsTrendHint.textContent = punti.length
      ? `Una colonna per ${FS_PASSO_LABEL[serie.passo] || serie.passo}: quante segnalazioni sono arrivate.`
      : '';
    if (!punti.length) {
      mgFsTrend.innerHTML = '';
      mgFsTrend.style.maxWidth = '';
      mgFsTrendAxis.style.maxWidth = '';
      mgFsTrendAxis.innerHTML = '<span class="mg-fs-empty">Nessuna segnalazione in questa finestra.</span>';
      return;
    }
    const max = Math.max.apply(null, punti.map((p) => p.n)) || 1;
    // Il tetto di larghezza delle colonne serve solo quando sono UNA o DUE:
    // lì senza tetto una colonna diventa un blocco a tutta pagina. Da tre in
    // su le colonne si allargano e riempiono il riquadro — sette colonne larghe
    // sono un grafico settimanale normale, mentre col tetto acceso fin sotto
    // le otto «7 giorni» disegnava in un angolo e lasciava bianco il 72% del
    // riquadro.
    //
    // E quando il tetto è acceso, il disegno e la SCALA devono stare sullo
    // stesso pezzo di riquadro: la riga delle date è giustificata agli estremi,
    // quindi con le colonne rimpicciolite la data di fine finiva a mezzo metro
    // di schermo dall'ultima colonna che nominava. Si stringono tutti e due
    // alla larghezza davvero disegnata.
    const poche = punti.length < 3;
    const disegnato = punti.length * 48 + (punti.length - 1) * 2;
    mgFsTrend.classList.toggle('mg-fs-trend--poche', poche);
    mgFsTrend.style.maxWidth = poche ? `${disegnato}px` : '';
    // La riga delle date non scende sotto una misura leggibile: con una colonna
    // sola, stretta a 48 pixel, la data e la punta si accavallavano.
    if (mgFsTrendAxis) mgFsTrendAxis.style.maxWidth = poche ? `${Math.max(disegnato, 240)}px` : '';
    // Una colonna per periodo della finestra, anche per i periodi vuoti: il
    // silenzio è metà di quello che un grafico degli arrivi deve far vedere.
    // Un periodo a zero non è un pulsante (dietro non c'è niente da aprire) e
    // resta una tacca sulla linea di base, non una colonnina che sembra un uno.
    mgFsTrend.innerHTML = punti.map((p) => {
      const titolo = esc(fsRigaConto(p.label, p.n));
      // Una colonna vuota non è un pulsante (dietro non c'è niente da aprire)
      // ma resta un periodo: il tasto destro le offre «Restringi la finestra a
      // questo periodo» come a quelle piene. Guardare da vicino un silenzio è
      // un modo legittimo di usare questo grafico, e due colonne identiche che
      // rispondevano in due modi erano l'asimmetria di sempre.
      if (!p.n) return `<span class="mg-fs-trend-col mg-fs-trend-col--zero" data-fs-punto="${esc(p.chiave)}" title="${titolo}"></span>`;
      return `<button type="button" class="mg-fs-trend-col" data-fs-punto="${esc(p.chiave)}"`
        + ` style="height:${Math.max(4, Math.round((p.n / max) * 100))}%"`
        + ` title="${titolo}"></button>`;
    }).join('');
    // Le date si scrivono come nel resto della scheda (25/8/2026), non nella
    // forma tecnica con cui le colonne sono raggruppate.
    // Con un solo punto i due estremi sono la stessa data: scriverla due volte
    // sembra un errore di conto, non una scala.
    const ultimo = punti[punti.length - 1];
    mgFsTrendAxis.innerHTML = `<span>${esc(punti[0].label)}</span>`
      + `<span>punta: ${esc(fsNum(max))}</span>`
      + (ultimo.chiave === punti[0].chiave ? '<span></span>' : `<span>${esc(ultimo.label)}</span>`);
  }

  // ── Tempi, controllo di sicurezza, arenamenti ────────────────────────────
  function renderFsAltro(stat) {
    const t = stat.tempi;
    // Anche qui ogni numero che ha contato delle segnalazioni si apre su
    // quelle: erano gli ultimi quattro rimasti muti.
    const ko = stat.copertura.registroLetto === false;
    const noto = 'registro delle routine non letto';
    // Senza segnalazioni lette, l'esito del controllo e gli arenamenti (che
    // stanno sui documenti dei lavori) non si sanno: trattino e motivo.
    const fbKo = stat.copertura.feedbackLetti === false;
    const nonLetti = stat.audit.nonLetti || 0;
    let auditSotto = `${fsNum(stat.audit.fail)} bocciati · ${fsNum(stat.audit.saltato)} saltati da te`;
    if (ko) auditSotto = noto;
    else if (fbKo) auditSotto = 'segnalazioni non lette';
    else if (nonLetti) auditSotto = `esito non letto su ${fsNum(nonLetti)} ${nonLetti === 1 ? 'lavoro' : 'lavori'}`;
    const det = fsAperto === 'audit' ? fsDettaglio(stat) : null;
    mgFsAltro.innerHTML = [
      fsTile('attesa', FS.durata(t.presaInCarico.mediana), 'Attesa prima che tu lo prendessi in mano',
        stat.copertura.feedbackLetti === false
          ? 'segnalazioni non lette'
          : (t.presaInCarico.n ? `mediana su ${fsNum(t.presaInCarico.n)}` : 'nessuno preso in mano qui'),
        t.presaInCarico.ids.length ? 'apri' : false),
      fsTile('durata', FS.durata(t.lavorazione.mediana), 'Durata di una lavorazione',
        ko ? noto : (t.lavorazione.n ? `mediana su ${fsNum(t.lavorazione.n)}` : 'nessuna lavorazione chiusa qui'),
        t.lavorazione.ids.length ? 'apri' : false),
      // Il controllo di sicurezza e gli arenamenti si leggono sulle lavorazioni
      // della finestra, e quali siano lo dice il registro: senza, non sono zero.
      // La riga piccola dei lavori senza esito letto si apre su quelli.
      fsTile('audit', stat.audit.pass, 'Controlli di sicurezza passati', auditSotto,
        fsEspandibili(stat).audit ? 'espandi' : false,
        !ko && !fbKo && nonLetti ? 'auditNonLetti' : ''),
      // Il numero grande conta ARENAMENTI: una segnalazione arenata due volte
      // ne vale due, quindi non è un conto di segnalazioni e non si apre.
      // Ad aprirle è la riga piccola, come nel riquadro delle esplorazioni.
      fsTile('arenati', stat.arenati.lavorazioni, 'Lavorazioni arenate e rimesse in coda',
        ko ? noto : fbKo ? 'segnalazioni non lette' : (stat.arenati.feedback
          ? `su ${fsNum(stat.arenati.feedback)} ${stat.arenati.feedback === 1 ? 'segnalazione' : 'segnalazioni'}`
          : 'nessuna'),
        false,
        stat.arenati.ids.length ? 'arenatiFeedback' : ''),
    ].join('') + (det
      ? `<div class="mg-fs-detail"><h4>${esc(det.titolo)}</h4>${det.html}</div>`
      : '');
  }

  // ── Da un numero alle segnalazioni che ci stanno dietro ──────────────────
  // Ogni conto della scheda dice QUANTE e apre su QUALI: col clic, da tastiera
  // e col tasto destro. Un numero che non porta da nessuna parte lascia l'owner
  // a cercarlo a mano nella lista, che è il lavoro che la scheda dovrebbe
  // togliergli.
  let fsStat  = null;   // l'ultimo conto fatto: da qui si risolvono gli id
  // Cosa è aperto sotto i riquadri: NON gli id, ma la riga che è stata
  // cliccata. Tenendo gli id, l'elenco restava quello dell'istante in cui lo
  // avevi aperto mentre la riga sopra camminava coi feedback nuovi: due numeri
  // della stessa cosa, sulla stessa schermata, che non erano d'accordo.
  // Tenendo la riga, si rilegge dal conto fresco a ogni ridisegno.
  let fsDrill = null;   // { tipo, chiave, gruppo } o null
  let fsDrillChiave = '';   // finestra e filtro con cui l'elenco è stato aperto
  // Da dove l'elenco è stato aperto: chiudendolo il fuoco ci torna, invece di
  // cadere sul corpo della pagina e far ripartire il Tab dall'inizio.
  let fsDrillDaDove = '';

  // Da un elemento cliccato alla RIGA che rappresenta. Solo DOM: non guarda i
  // conti, così la stessa riga si può risolvere di nuovo più tardi.
  function fsDescrizione(el) {
    if (!el) return null;
    const bar = el.closest('[data-fs-bar]');
    if (bar) return { tipo: 'bar', chiave: bar.dataset.fsBar, gruppo: bar.dataset.fsBargroup };
    const gruppo = el.closest('[data-group]');
    if (gruppo) return { tipo: 'fetta', chiave: gruppo.dataset.group };
    const punto = el.closest('[data-fs-punto]');
    if (punto) return { tipo: 'punto', chiave: punto.dataset.fsPunto };
    const esito = el.closest('[data-fs-esito]');
    if (esito) return { tipo: 'esito', chiave: esito.dataset.fsEsito };
    const tile = el.closest('[data-fs-id]');
    if (tile) return { tipo: 'tile', chiave: tile.dataset.fsId };
    // La pasticca del mittente porta un conteggio come tutto il resto: il clic
    // resta il filtro, ma quel numero si può aprire come gli altri.
    const chip = el.closest('[data-fs-creator]');
    if (chip) return { tipo: 'creatore', chiave: chip.dataset.fsCreator };
    return null;
  }

  // Dalla riga a «cosa ha contato», sul conto di ADESSO. Torna null se dietro
  // non c'è nessuna segnalazione (i lanci delle routine, per esempio: un lancio
  // non è una segnalazione).
  function fsRisolvi(desc) {
    if (!desc || !fsStat) return null;
    const trova = (voci, chiave) => (voci || []).find((v) => String(v.key ?? v.kind ?? v.role) === chiave);
    const chiave = desc.chiave;

    if (desc.tipo === 'bar') {
      let v = null;
      if (desc.gruppo === 'categorie') v = trova(fsStat.ricevuti.categorie, chiave);
      else if (desc.gruppo === 'creatori') v = trova(fsStat.ricevuti.creatori, chiave);
      else if (desc.gruppo === 'ruoliRoutine') {
        const r = trova(fsStat.ricevuti.ruoliRoutine, chiave);
        v = r ? { ...r, label: `Routine: ${fsEtichettaRuolo(chiave)}` } : null;
      }
      else if (desc.gruppo === 'stati') v = trova(fsStat.lavorati.stati, chiave);
      else if (desc.gruppo === 'audit') {
        const ids = (fsStat.auditIds && fsStat.auditIds[chiave]) || [];
        const nomi = { pass: 'Controllo di sicurezza passato', fail: 'Controllo di sicurezza bocciato', saltato: 'Controllo di sicurezza saltato da te' };
        v = ids.length ? { label: nomi[chiave] || chiave, ids } : null;
      }
      if (!v) return null;
      const idsBar = v.ids || [];
      const manBar = v.mancanti || [];
      if (!idsBar.length && !manBar.length) return null;
      const nome = v.label || fsEtichettaCreatore(chiave) || chiave;
      return { ...desc, titolo: nome, ids: idsBar, mancanti: manBar };
    }

    if (desc.tipo === 'fetta') {
      const f = trova(fsStat.giri.fette, chiave);
      if (!f || !f.ids || !f.ids.length) return null;
      // Le altre fette dicono già il loro numero di critiche nel nome.
      return { ...desc, titolo: f.label, ids: f.ids, critiche: f.key === 'g3' ? f.critiche : null };
    }

    if (desc.tipo === 'punto') {
      const p = (fsStat.ricevuti.serie.punti || []).find((x) => x.chiave === chiave);
      if (!p || !p.ids || !p.ids.length) return null;
      return { ...desc, titolo: `Arrivate il ${p.label}`, ids: p.ids, punto: p };
    }

    if (desc.tipo === 'esito') {
      // Anche i tre numeri scritti nella frase sotto il titolo: sono conti come
      // gli altri, e prima erano gli unici a non portare da nessuna parte.
      const mappa = {
        fermati:     { titolo: 'Fermati: aspettano una tua decisione', ids: fsStat.giri.fermatiIds },
        rimandati:   { titolo: 'Passati lasciando indietro dei rilievi', ids: fsStat.giri.rimandatiIds },
        aperti:      { titolo: 'Ancora in mezzo al giro', ids: fsStat.giri.apertiIds },
        statoIgnoto: { titolo: 'Stato cifrato: non leggibile con questa chiave', ids: fsStat.giri.statoIgnotoIds },
        senzaGiri:   { titolo: 'Passati, ma le loro verifiche sono più vecchie del registro', ids: fsStat.giri.senzaGiriIds },
        ignoti:      { titolo: 'Lavorati, ma non fra le segnalazioni caricate', ids: [], mancanti: fsStat.giri.ignotiNumeri },
        // I due conti della riga sotto i filtri.
        senzaData:      { titolo: 'Senza una data d\'arrivo leggibile', ids: fsStat.ricevuti.senzaDataIds || [] },
        mittentiIgnoti: { titolo: 'Mittente non leggibile con questa chiave', ids: fsStat.ricevuti.mittentiIgnotiIds || [] },
      };
      const v = mappa[chiave];
      if (!v) return null;
      const man = v.mancanti || [];
      if (!v.ids.length && !man.length) return null;
      return { ...desc, titolo: v.titolo, ids: v.ids, mancanti: man };
    }

    if (desc.tipo === 'creatore') {
      // Il numero della pasticca è quello SENZA filtro, e si apre su quelle.
      const tutti = (fsStat.ricevuti.creatoriTutti || []);
      const gr = FS.GRUPPI_CREATORI.find((x) => x.key === chiave);
      let ids = [];
      let titolo = '';
      if (chiave === '__tutti') { ids = tutti.reduce((a, c) => a.concat(c.ids || []), []); titolo = 'Tutti i mittenti'; }
      else if (gr) { ids = tutti.filter((c) => gr.kinds.indexOf(c.kind) >= 0).reduce((a, c) => a.concat(c.ids || []), []); titolo = gr.label; }
      else { const v = tutti.find((c) => c.kind === chiave); ids = (v && v.ids) || []; titolo = fsEtichettaCreatore(chiave); }
      if (!ids.length) return null;
      return { ...desc, titolo, ids };
    }

    if (desc.tipo === 'tile') {
      // Ogni riquadro che ha contato delle segnalazioni, compresi i quattro
      // della fila in fondo: un numero si apre su cosa ha contato, e i loro
      // sottotitoli contano segnalazioni esattamente come gli altri.
      // Il terzo posto sono i NUMERI che il conto ha contato senza una
      // segnalazione dietro: l'elenco li nomina, così numero ed elenco dicono
      // la stessa cifra invece di divergere in silenzio.
      const dietro = {
        ricevuti: ['Feedback ricevuti in questa finestra', fsStat.ricevuti.ids],
        lavorati: ['Feedback lavorati in questa finestra', fsStat.lavorati.ids, fsStat.lavorati.mancanti],
        // `prober` e `arenati` (i numeri grandi) contano partenze e
        // arenamenti, non segnalazioni: non stanno qui apposta. A contare
        // segnalazioni è la riga piccola sotto.
        proberTrovate: ['Segnalazioni trovate dall\'esploratore', fsStat.prober.ritrovamentiIds],
        attesa:   ['Segnalazioni che hai preso in mano', fsStat.tempi.presaInCarico.ids],
        durata:   ['Lavorazioni misurate in questa finestra', fsStat.tempi.lavorazione.ids, fsStat.tempi.lavorazione.mancanti],
        audit:    ['Controllo di sicurezza passato', (fsStat.auditIds || {}).pass],
        auditNonLetti: ['Lavori con l\'esito del controllo di sicurezza non letto', (fsStat.auditIds || {}).nonLetti],
        arenatiFeedback: ['Segnalazioni la cui lavorazione si è arenata', fsStat.arenati.ids],
      }[chiave];
      if (!dietro) return null;
      const ids = dietro[1] || [];
      const man = dietro[2] || [];
      if (ids.length || man.length) return { ...desc, titolo: dietro[0], ids, mancanti: man };
    }
    return null;
  }

  function fsSorgente(el) { return fsRisolvi(fsDescrizione(el)); }

  function fsApriDrill(src) {
    if (!src) return;
    fsDrillDaDove = fsFuocoOra();
    fsDrill = { tipo: src.tipo, chiave: src.chiave, gruppo: src.gruppo };
    renderFsDrill();
    if (mgFsDrill) mgFsDrill.scrollIntoView({ block: 'nearest', behavior: window.SN_THEME_TOKENS?.scrollBehavior(document) || 'smooth' });
  }

  /** L'unica via di chiusura dell'elenco: qualunque porta, stesso ritorno del fuoco. */
  function fsChiudiDrill() {
    const daDove = fsDrillDaDove;
    fsDrillDaDove = '';
    fsDrill = null;
    renderFsDrill();
    fsRiprendiFuoco(daDove);
  }

  function renderFsDrill() {
    if (!mgFsDrill) return;
    // Si rilegge dal conto di adesso: l'elenco e la riga che l'ha aperto dicono
    // sempre lo stesso numero, anche mentre arrivano segnalazioni nuove.
    const src = fsRisolvi(fsDrill);
    if (!src) { mgFsDrill.hidden = true; mgFsDrillList.innerHTML = ''; return; }
    mgFsDrill.hidden = false;
    const mancanti = src.mancanti || [];
    const n = src.ids.length + mancanti.length;
    mgFsDrillTitle.textContent = `${src.titolo} · ${fsNum(n)} ${n === 1 ? 'segnalazione' : 'segnalazioni'}`;
    const perId = new Map((fsFeedbacks || []).map((f) => [f._id, f]));
    // Prima quelle che si possono guardare, poi i numeri che il registro cita
    // e la lista non ha: restano contati e nominati, invece di sparire.
    const righeMancanti = mancanti.map((num) => '<li><button type="button" class="mg-fs-drill-row" disabled'
      + ' title="Il registro delle esecuzioni la cita, ma non è fra le segnalazioni caricate">'
      + `<span class="mg-fs-drill-num">#${esc(String(num))}</span>`
      + '<span class="mg-fs-drill-t">Lavorata, ma non è fra le segnalazioni caricate.</span></button></li>').join('');
    mgFsDrillList.innerHTML = src.ids.map((id) => {
      const fb = perId.get(id);
      if (!fb) {
        return '<li><button type="button" class="mg-fs-drill-row" disabled>'
          + '<span class="mg-fs-drill-num">—</span>'
          + '<span class="mg-fs-drill-t">Questa segnalazione non è più fra quelle caricate.</span></button></li>';
      }
      const num = FB.formatNum(fb.seq, fb.subSeq);
      // Un titolo fatto di soli spazi non è un titolo: lasciava la riga con un
      // vuoto fra il numero e la categoria, mentre il ripiego c'era già.
      const titolo = String(fb.name || '').trim() || FB.fallbackName(fb.text) || '(senza titolo)';
      const cat = FS.categoriaDi(fb);
      // Le segnalazioni caricate qui sono l'INSIEME, la lista a sinistra sono
      // le più recenti: una che sta qui e non lì non si può aprire, e la riga
      // lo dice invece di non fare niente al clic.
      const apribile = allFeedbacks.some((f) => f._id === id);
      const critiche = src.critiche ? src.critiche[id] : null;
      return `<li><button type="button" class="mg-fs-drill-row" data-fs-open="${esc(id)}"${apribile ? '' : ' disabled'}`
        + ` title="${esc(apribile ? 'Apri la segnalazione' : 'Non è fra le segnalazioni caricate nella lista: aprila dalla colonna di sinistra')}">`
        + `<span class="mg-fs-drill-num">${num ? '#' + esc(num) : '—'}</span>`
        + `<span class="mg-fs-drill-t">${esc(titolo)}</span>`
        + `<span class="mg-fs-drill-cat">${esc(cat.label)}</span>`
        + (typeof critiche === 'number'
          ? `<span class="mg-fs-drill-giri">${esc(fsRigaCritiche(critiche))}</span>`
          : '')
        + '</button></li>';
    }).join('') + righeMancanti;
  }

  // Il menu del tasto destro della scheda: le stesse azioni del clic, più la
  // copia del numero. Stessa forma del menu di ordinamento della lista.
  let fsMenu = null;
  function fsChiudiMenu() {
    if (!fsMenu) return;
    fsMenu.remove();
    fsMenu = null;
    document.removeEventListener('mousedown', fsFuoriMenu, true);
    document.removeEventListener('keydown', fsEscMenu, true);
    window.removeEventListener('resize', fsChiudiMenu);
  }
  function fsFuoriMenu(e) { if (fsMenu && !fsMenu.contains(e.target)) fsChiudiMenu(); }
  // Il menu si prende l'Esc: sotto c'è l'elenco, che con lo stesso tasto si
  // chiuderebbe anche lui. Un Esc chiude una cosa sola, quella più in alto.
  function fsEscMenu(e) {
    if (e.key !== 'Escape' || !fsMenu) return;
    fsChiudiMenu();
    e.stopPropagation();
  }
  function fsApriMenu(x, y, voci) {
    fsChiudiMenu();
    if (!voci.length) return;
    const menu = document.createElement('div');
    menu.className = 'sn-select-pop mg-ctxmenu';
    menu.setAttribute('role', 'menu');
    for (const v of voci) {
      const opt = document.createElement('div');
      opt.className = 'sn-select-option';
      opt.setAttribute('role', 'menuitem');
      opt.textContent = v.label;
      opt.addEventListener('click', () => { fsChiudiMenu(); v.run(); });
      menu.appendChild(opt);
    }
    document.body.appendChild(menu);
    const vw = window.innerWidth, vh = window.innerHeight;
    menu.style.left = `${Math.max(4, Math.min(x, vw - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, vh - menu.offsetHeight - 4))}px`;
    fsMenu = menu;
    document.addEventListener('keydown', fsEscMenu, true);
    setTimeout(() => {
      if (fsMenu !== menu) return;
      document.addEventListener('mousedown', fsFuoriMenu, true);
      window.addEventListener('resize', fsChiudiMenu);
    }, 0);
  }

  // «Mostra le N segnalazioni contate», dove dietro il numero ce n'è davvero
  // qualcuna. Una voce sola, uguale su ogni superficie che porta un conteggio.
  function vociMostra(el, voci) {
    const src = fsSorgente(el);
    if (!src) return null;
    const n = src.ids.length + ((src.mancanti || []).length);
    voci.push({
      label: `Mostra ${n === 1 ? 'la segnalazione contata' : `le ${fsNum(n)} segnalazioni contate`}`,
      run: () => fsApriDrill(src),
    });
    return src;
  }

  // Cosa può volere l'owner sopra questo pezzo di scheda.
  function fsVociMenu(el) {
    const voci = [];
    // Una riga dell'elenco: le stesse due cose che si vogliono fare a una
    // segnalazione ovunque nella dashboard.
    const riga = el.closest('[data-fs-open]');
    if (riga) {
      const fb = (fsFeedbacks || []).find((f) => f._id === riga.dataset.fsOpen);
      const num = fb ? FB.formatNum(fb.seq, fb.subSeq) : '';
      if (!riga.disabled) {
        voci.push({ label: 'Apri la segnalazione', run: () => fsApriSegnalazione(riga.dataset.fsOpen) });
      }
      if (num) voci.push({ label: 'Copia il numero', run: () => fsCopia('#' + num) });
      return voci;
    }
    // Le due barre in cima: portano una scelta e un numero, quindi il tasto
    // destro ha di che riempirsi. Prima rispondeva il menu generale della
    // pagina, quello che esce anche su uno spazio bianco.
    const chipR = el.closest('[data-fs-range]');
    if (chipR) {
      const key = chipR.dataset.fsRange;
      const p = FS.presetOf(key);
      const r = FS.rangeOf(key, Date.now(), fsCustom);
      const quando = r.da == null
        ? (r.a == null ? 'tutte le segnalazioni, senza limiti di data' : `da sempre al ${FS.dataBreve(r.a)}`)
        : `dal ${FS.dataBreve(r.da)} a oggi`;
      if (key !== fsRangeKey) voci.push({ label: 'Guarda questa finestra', run: () => fsScegliFinestra(key) });
      voci.push({ label: 'Copia la finestra', run: () => fsCopia(`${(p && p.label) || key}: ${quando}`) });
      return voci;
    }
    const chipC = el.closest('[data-fs-creator]');
    if (chipC) {
      const kind = chipC.dataset.fsCreator;
      if (kind === '__tutti') {
        // Era l'unica pasticca della barra a non offrire niente: col filtro già
        // tolto usciva il menu generale della pagina, quello di uno spazio
        // bianco, mentre le sue dieci vicine avevano le loro voci.
        if (fsCreators.length) voci.push({ label: 'Togli tutti i filtri', run: () => fsImpostaCreatori([]) });
        const n = chipC.querySelector('.mg-chip-n');
        vociMostra(chipC, voci);
        voci.push({ label: 'Copia riga e numero', run: () => fsCopia(`Tutti: ${n ? n.textContent.trim() : 0}`) });
        return voci;
      }
      const gr = FS.GRUPPI_CREATORI.find((x) => x.key === kind);
      if (gr) {
        const acceso = fsGruppoAcceso(gr);
        if (!acceso) voci.push({ label: `Solo ${gr.label.toLowerCase()}`, run: () => fsImpostaCreatori(gr.kinds.slice()) });
        else voci.push({ label: 'Togli il filtro', run: () => fsImpostaCreatori([]) });
        const tot = gr.kinds.reduce((s, k) => {
          const v = fsStat && (fsStat.ricevuti.creatoriTutti || []).find((c) => c.kind === k);
          return s + ((v && v.n) || 0);
        }, 0);
        vociMostra(chipC, voci);
        voci.push({ label: 'Copia riga e numero', run: () => fsCopia(`${gr.label}: ${fsNum(tot)}`) });
        return voci;
      }
      const nome = fsEtichettaCreatore(kind);
      const acceso = fsCreators.indexOf(kind) >= 0;
      voci.push({ label: `Solo ${nome}`, run: () => fsImpostaCreatori([kind]) });
      voci.push(acceso
        ? { label: 'Togli dal filtro', run: () => fsImpostaCreatori(fsCreators.filter((k) => k !== kind)) }
        : { label: 'Aggiungi al filtro', run: () => fsImpostaCreatori(fsCreators.concat([kind])) });
      const v = fsStat && (fsStat.ricevuti.creatoriTutti || []).find((c) => c.kind === kind);
      vociMostra(chipC, voci);
      voci.push({ label: 'Copia riga e numero', run: () => fsCopia(`${nome}: ${fsNum((v && v.n) || 0)}`) });
      return voci;
    }
    const src = vociMostra(el, voci);
    if (!src && el && el.querySelectorAll) {
      // Una FRASE che contiene dei numeri (quella sotto il titolo della torta):
      // il tasto destro sulla frase offre i conti che ci stanno dentro, uno per
      // voce, invece del menu generale della pagina. Sul numero da solo resta
      // il suo menu, più corto.
      for (const b of el.querySelectorAll('[data-fs-esito]')) {
        const s2 = fsSorgente(b);
        if (!s2) continue;
        const n2 = s2.ids.length + ((s2.mancanti || []).length);
        voci.push({ label: `Mostra ${s2.titolo.toLowerCase()} (${fsNum(n2)})`, run: () => fsApriDrill(s2) });
      }
    }
    // Nome e numero della cosa sotto il dito, pronti da incollare altrove.
    const testo = fsTestoRiga(el, src);
    if (testo) voci.push({ label: 'Copia riga e numero', run: () => fsCopia(testo) });
    const punto = el.closest('[data-fs-punto]');
    if (punto && fsStat) {
      const p = (fsStat.ricevuti.serie.punti || []).find((x) => x.chiave === punto.dataset.fsPunto);
      if (p) {
        voci.push({
          label: 'Restringi la finestra a questo periodo',
          run: () => fsRestringi(p),
        });
      }
    }
    return voci;
  }

  // «Nome: numero», costruito dai pezzi veri della riga invece che dal testo
  // grezzo del nodo, che verrebbe fuori senza spazi fra un pezzo e l'altro.
  function fsTestoRiga(el, src) {
    const bar = el.closest('[data-fs-bar]');
    if (bar) {
      const l = bar.querySelector('.mg-bar-label');
      const n = bar.querySelector('.mg-bar-n');
      if (l && n) return `${l.textContent.trim()}: ${n.textContent.trim()}`;
    }
    const leg = el.closest('.mg-fs-legend li[data-group]');
    if (leg) {
      const n = leg.querySelector('.mg-fs-legend-n');
      return `${leg.childNodes[1] ? leg.childNodes[1].textContent.trim() : ''}: ${n ? n.textContent.trim() : ''}`.trim();
    }
    const esito = el.closest('[data-fs-esito]');
    if (esito) {
      const b = esito.querySelector('b');
      // Senza il numero in grassetto è uno dei conti scritti dentro una frase:
      // lì il nome della cosa contata lo sa solo il conto, non il DOM attorno.
      if (b) {
        const resto = esito.textContent.slice(b.textContent.length).trim();
        return `${resto}: ${b.textContent.trim()}`;
      }
      if (src) return `${src.titolo}: ${fsNum(src.ids.length + ((src.mancanti || []).length))}`;
    }
    const punto = el.closest('[data-fs-punto]');
    if (punto) return punto.getAttribute('title') || '';
    const tile = el.closest('[data-fs-id]');
    if (tile) {
      const n = tile.querySelector('.mg-tile-n');
      const t = tile.querySelector('.mg-tile-t');
      if (n && t) return `${t.textContent.trim()}: ${n.textContent.trim()}`;
    }
    if (src) return `${src.titolo}: ${fsNum(src.ids.length + ((src.mancanti || []).length))}`;
    return '';
  }

  async function fsCopia(testo) {
    // La conferma parte DOPO che gli appunti hanno risposto: dire «copiato» a
    // un rifiuto è una bugia piccola e fastidiosa.
    try {
      await navigator.clipboard.writeText(testo);
      toast('Copiato');
    } catch (_) {
      toast('Gli appunti non hanno accettato la copia');
    }
  }

  // Le stesse due mosse del clic sulle pasticche, richiamabili dal menu.
  function fsScegliFinestra(key) {
    fsRangeKey = key;
    fsSalvaScelta();
    renderFs();
  }
  function fsImpostaCreatori(lista) {
    fsCreators = Array.from(new Set(lista));
    fsSalvaScelta();
    renderFs();
  }

  // Dal gruppo di una colonna alla finestra scritta a mano che lo contiene.
  function fsRestringi(p) {
    const passo = fsStat.ricevuti.serie.passo;
    const inizio = new Date(p.t);
    const fine = new Date(p.t);
    // Un passo per riga, e l'anno va scritto come gli altri: finché mancava,
    // restringere su una colonna che valeva un anno dava il primo gennaio e
    // basta, e le segnalazioni che la colonna aveva appena contato sparivano.
    if (passo === 'anno') fine.setMonth(11, 31);
    else if (passo === 'mese') fine.setMonth(fine.getMonth() + 1, 0);
    else if (passo === 'settimana') fine.setDate(fine.getDate() + 6);
    fsRangeKey = 'custom';
    fsCustom = { da: FS.giornoDi(inizio.getTime()), a: FS.giornoDi(fine.getTime()) };
    if (mgFsFrom) mgFsFrom.value = fsCustom.da;
    if (mgFsTo) mgFsTo.value = fsCustom.a;
    fsSalvaScelta();
    renderFs();
  }

  // ── Il fuoco della tastiera sopravvive al ridisegno ──────────────────────
  // Il giro di aggiornamento della pagina passa ogni minuto e ridisegna questa
  // scheda da capo, anche quando non è cambiato niente (il registro delle
  // routine cammina per conto suo). Riscrivere pasticche, riquadri, legenda ed
  // elenco butta il fuoco sul corpo della pagina: chi sta navigando senza
  // mouse ricominciava dall'inizio una volta al minuto, senza che niente lo
  // dicesse. Il resto della pagina già si guarda da questo — la lista tiene il
  // suo scorrimento, la conversazione non si ridisegna mentre la si scrive, e
  // qui i due campi delle date non vengono riscritti sotto le dita.
  //
  // Si ricorda la RIGA, non il nodo: il nodo dopo il ridisegno non esiste più.
  const FS_ANCORE = [
    'data-fs-open', 'data-fs-range', 'data-fs-creator', 'data-fs-tile',
    'data-fs-esito', 'data-fs-punto', 'data-group', 'data-fs-bar', 'data-fs-id',
  ];
  function fsFuocoOra() {
    const el = document.activeElement;
    const root = document.getElementById('mgFsRoot');
    if (!el || !root || el === root || !root.contains(el)) return '';
    const q = (v) => (window.CSS && CSS.escape ? CSS.escape(String(v)) : String(v).replace(/["\\]/g, '\\$&'));
    for (const attr of FS_ANCORE) {
      const host = el.closest(`[${attr}]`);
      if (!host) continue;
      let sel = `[${attr}="${q(host.getAttribute(attr))}"]`;
      // Due righe di ripartizione possono avere la stessa chiave in gruppi
      // diversi, e `data-group` sta sia sulla fetta sia sulla sua voce di
      // legenda: senza il secondo pezzo il fuoco tornerebbe sulla gemella.
      if (attr === 'data-fs-bar' && host.dataset.fsBargroup) {
        sel += `[data-fs-bargroup="${q(host.dataset.fsBargroup)}"]`;
      }
      if (attr === 'data-group' && host.closest('#mgFsLegend')) sel = `#mgFsLegend ${sel}`;
      return sel;
    }
    return el.id ? `#${q(el.id)}` : '';
  }
  function fsRiprendiFuoco(sel) {
    if (!sel) return;
    const root = document.getElementById('mgFsRoot');
    const n = sel.charAt(0) === '#' ? document.querySelector(sel) : (root && root.querySelector(sel));
    // Solo se il fuoco non se n'è già andato altrove per mano di chi guarda.
    if (n && typeof n.focus === 'function' && document.activeElement !== n) {
      if (document.activeElement === document.body || root.contains(document.activeElement)) {
        n.focus({ preventScroll: true });
      }
    }
  }

  function renderFs() {
    if (!FS || !mgFsBody) return;
    const admin = isAdmin;
    mgFsDenied.hidden = admin;
    mgFsLoading.hidden = !admin || fsCaricato || !fsCaricando;
    mgFsBody.hidden = !admin || !fsCaricato;
    if (!admin || !fsCaricato) return;

    let stat;
    try {
      stat = FS.compute({
        feedbacks: fsFeedbacks || [],
        workerLog: fsLog,
        range: fsRange(),
        creatori: fsCreators,
        feedbackParziali: !fsCompleto,
        // Registro non letto: i suoi numeri tornano `null`, non zero. Stessa
        // cosa dall'altra sorgente: se la lettura delle segnalazioni è fallita
        // e in pagina non c'è nemmeno un ripiego, quei numeri non si sanno.
        registroLetto: fsLogOk,
        feedbackLetti: !(fsRipiego && !(fsFeedbacks || []).length),
      });
    } catch (err) {
      // Un conto che non si può fare si dice, non si disegna a zero.
      console.error('[manage] statistiche: conti non riusciti:', err);
      mgFsNota.textContent = 'I conti non si sono potuti fare: ' + (err && err.message ? err.message : 'guasto sconosciuto');
      mgFsNota.hidden = false;
      return;
    }
    fsStat = stat;
    if (fsAperto && !fsEspandibili(stat)[fsAperto]) fsAperto = '';
    // L'elenco aperto su un conto vecchio non vale più: cambiata la finestra o
    // il filtro, quei numeri non sono più quelli. Si richiude da solo invece di
    // restare lì a dire una cosa che la scheda sopra non dice più.
    const chiave = `${fsRangeKey}|${fsCustom.da}|${fsCustom.a}|${fsCreators.join(',')}`;
    if (fsDrillChiave !== chiave) { fsDrill = null; fsDrillDaDove = ''; fsDrillChiave = chiave; }
    // Dov'era il fuoco e a che punto era sceso l'elenco: si rimettono dopo.
    const fuoco = fsFuocoOra();
    const scorrimento = mgFsDrillList ? mgFsDrillList.scrollTop : 0;
    renderFsBars(stat);
    renderFsNota(stat);
    renderFsTiles(stat);
    renderFsPie(stat);
    renderFsEsiti(stat);
    renderFsTrend(stat);
    renderFsAltro(stat);
    renderFsDrill();
    if (mgFsDrillList && scorrimento) mgFsDrillList.scrollTop = scorrimento;
    fsRiprendiFuoco(fuoco);
  }

  // Finestra, mittenti e riquadri: un solo ascoltatore per la scheda.
  if (mgFsBody) {
    document.getElementById('mgFsRoot').addEventListener('click', (e) => {
      const chipR = e.target.closest('[data-fs-range]');
      if (chipR) {
        fsRangeKey = chipR.dataset.fsRange;
        fsSalvaScelta();
        renderFs();
        return;
      }
      const chipC = e.target.closest('[data-fs-creator]');
      if (chipC) {
        const kind = chipC.dataset.fsCreator;
        const gruppo = FS.GRUPPI_CREATORI.find((x) => x.key === kind);
        if (kind === '__tutti') fsCreators = [];
        // Una pasticca di gruppo si comporta come le altre: cliccata accende
        // il gruppo, ricliccata da accesa torna a «Tutti».
        else if (gruppo) fsCreators = fsGruppoAcceso(gruppo) ? [] : gruppo.kinds.slice();
        else {
          const i = fsCreators.indexOf(kind);
          if (i >= 0) fsCreators.splice(i, 1); else fsCreators.push(kind);
        }
        fsSalvaScelta();
        renderFs();
        return;
      }
      // Una riga dell'elenco aperto: apre la segnalazione nella colonna di
      // sinistra, nella sua sezione.
      const apri = e.target.closest('[data-fs-open]');
      if (apri) {
        fsApriSegnalazione(apri.dataset.fsOpen);
        return;
      }
      if (e.target.closest('#mgFsDrillClose')) { fsChiudiDrill(); return; }

      const tile = e.target.closest('[data-fs-tile]');
      if (tile) {
        fsAperto = fsAperto === tile.dataset.fsTile ? '' : tile.dataset.fsTile;
        renderFs();
        return;
      }
      // Tutto il resto che porta un numero: fetta, voce di legenda, riga di
      // ripartizione, colonna del grafico, esito. Clic = «fammi vedere quali».
      const src = fsSorgente(e.target);
      if (src) fsApriDrill(src);
    });

    // Invio e spazio valgono il clic su ciò che non è già un pulsante (le voci
    // di legenda e gli esiti): stessa funzione, dalla tastiera.
    document.getElementById('mgFsRoot').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = e.target.closest('[data-group], [data-fs-esito]');
      if (!el || el.tagName === 'BUTTON') return;
      const src = fsSorgente(el);
      if (!src) return;
      e.preventDefault();
      fsApriDrill(src);
    });

    // Esc chiude l'elenco aperto sotto un numero. È un riquadro aperto come un
    // altro, e in Filo Esc chiude prima il riquadro aperto
    // (patterns/esc-chiude-prima-il-riquadro-aperto-poi-la-modalita.md): finché
    // non lo faceva, l'unica via d'uscita era la scritta «chiudi» in alto a
    // destra, mentre lo stesso tasto chiudeva il menu del tasto destro della
    // stessa scheda. Il tasto si ascolta sul documento e IN CAPTURE: il menu
    // del tasto destro si prende l'Esc fermandone la corsa, e un ascolto in
    // risalita non lo vedeva mai arrivare. In capture si arriva prima, e la
    // precedenza resta al menu — se è aperto, l'Esc è suo e qui non si tocca
    // niente.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || fsMenu) return;
      if (!mgFsDrill || mgFsDrill.hidden || !fsPannelloAperto()) return;
      fsChiudiDrill();
    }, true);

    // Tasto destro: «voglio fare qualcosa qui».
    document.getElementById('mgFsRoot').addEventListener('contextmenu', (e) => {
      const voci = fsVociMenu(e.target);
      if (!voci.length) return;
      e.preventDefault();
      fsApriMenu(e.clientX, e.clientY, voci);
    });

    const suDate = () => {
      fsCustom = { da: mgFsFrom.value || '', a: mgFsTo.value || '' };
      fsSalvaScelta();
      renderFs();
    };
    mgFsFrom.addEventListener('change', suDate);
    mgFsTo.addEventListener('change', suDate);
  }

  // Apre una segnalazione dell'elenco nella colonna di sinistra, nella sezione
  // che le compete: da un numero si arriva alla segnalazione vera, non a una
  // riga da cercare a mano.
  function fsApriSegnalazione(id) {
    const fb = allFeedbacks.find((f) => f._id === id);
    if (!fb) { toast('Questa segnalazione non è fra quelle caricate nella lista'); return; }
    // La stessa scheda della lista (manageTabFor): con tabFor un lavoro locale si apriva «In coda», dove non c'è.
    let tab = 'inbox';
    try { tab = MR.manageTabFor(fb, opzSezioni()) || 'inbox'; } catch (_) { /* senza stato leggibile si apre dai Ricevuti */ }
    mostraNelFiltro(fb);
    selectTab(tab);
    openDetail(id);
  }

  // La scheda si rilegge a OGNI apertura: nel frattempo le routine possono
  // aver lavorato, e una fotografia vecchia qui è peggio di nessuna.
  document.addEventListener('mg-scheda', (e) => {
    if (e.detail.tab === 'fbstats') loadFsData();
  });

  // …e a pagina ferma: il main avvisa quando l'elenco cambia (una fusione bloccata da
  // `npm run finish`, o decisa da un'altra finestra).
  if (window.filo?.onBroadcast) {
    window.filo.onBroadcast((m) => {
      if (m && m.type === MERGE_APPROVALS_CHANGED) loadMergeApprovals(m);
    });
  }

  window.__mgTest.loadSupportModels = loadSupportModels;
  window.__mgTest.getSmChains = () => smChains;
  window.__mgTest.getSmSlots = () => SM_SLOTS;
  // Render diretto con dati finti: i test non hanno né sessione admin né Firestore.
  window.__mgTest.renderSupportModelsEditor = (models) => { renderSupportModelsEditor(models); smLoaded = true; };
  window.__mgTest.collectJudgeRegistry = collectJudgeRegistry;
  // Gli spec aprono e chiudono l'immagine dalla porta dell'utente, così passano anche dall'avviso
  // al main (#514).
  window.__mgTest.openLightbox = openLightbox;
  window.__mgTest.closeLightbox = closeLightbox;
  // Render diretto con voci finte, e ri-lettura via IPC per gli spec che stubbano la risposta.
  window.__mgTest.renderWorkerLog = (entries) => { renderWorkerLog(entries); logLoaded = true; };
  window.__mgTest.loadWorkerLog = loadWorkerLog;
  // Tab "Statistiche feedback": dati finti al posto delle due letture vere
  // (negli spec non c'è né una sessione da proprietario né Firestore). Da qui
  // in poi la scheda esercita il codice VERO — conti, riquadri, torta.
  window.__mgTest.setFsData = (dati) => {
    const d = dati || {};
    fsFeedbacks = Array.isArray(d.feedbacks) ? d.feedbacks : [];
    fsChiesteIntere = new Set();
    fsLog       = Array.isArray(d.workerLog) ? d.workerLog : [];
    fsCompleto  = d.complete !== false;
    fsRipiego   = d.ripiego === true;
    fsLogOk     = d.logOk !== false;
    fsCaricato  = true;
    fsCaricando = false;
    renderFs();
  };
  window.__mgTest.setFsRange = (key, custom) => {
    fsRangeKey = key;
    if (custom) { fsCustom = custom; if (mgFsFrom) mgFsFrom.value = custom.da || ''; if (mgFsTo) mgFsTo.value = custom.a || ''; }
    renderFs();
  };
  window.__mgTest.getFsState = () => ({ rangeKey: fsRangeKey, creatori: fsCreators.slice(), aperto: fsAperto });
  window.__mgTest.loadFsData = loadFsData;
  window.__mgTest.renderChannelLog = renderChannelLog;
  // Rilettura via IPC dopo lo stub (in test non c'è né sessione proprietario né server).
  window.__mgTest.loadMergeApprovals = loadMergeApprovals;
  // Quale forma è aperta e quali richieste di fusione la pagina ha in mano (per gli spec).
  window.__mgTest.openSidebarLivello = openSidebarLivello;
  window.__mgTest.livelloAperto = () => livelloAperto;
  window.__mgTest.getFusioni = () => fusioni;

  // Icone iniettate da JS così restano nel tema di Filo (SVG outline, currentColor) invece di un
  // glifo emoji.
  function injectSearchIcons() {
    const ICONS = window.SN_ICONS;
    if (!ICONS || !ICONS.search) return;
    if (mgSearchToggle) mgSearchToggle.innerHTML = ICONS.search(18);
    if (mgSearchIco)    mgSearchIco.innerHTML = ICONS.search(16);
  }

  // Larghezza delle colonne: le due esterne fisse a scelta dell'utente, il dettaglio assorbe
  // il resto. Le muovono solo il trascinamento e la finestra che si stringe; le preferenze no.
  const mgReviewGrid   = document.getElementById('mgReviewGrid');
  const mgDividerLeft  = document.getElementById('mgDividerLeft');
  const mgDividerRight = document.getElementById('mgDividerRight');

  const LAYOUT_KEY = (window.SN_CONST?.STORAGE_KEYS?.MANAGE_UI) || 'manageUi';
  const LAYOUT_DEFAULT = { leftW: 220, rightW: 280 };
  const LAYOUT_MIN = { leftW: 150, rightW: 180 };
  const CENTER_MIN = 320;   // il dettaglio (la conversazione) non deve sparire
  const DIVIDER_W  = 12;    // deve combaciare con la .mg-review in manage.html
  const KEY_STEP   = 16;    // px per pressione delle frecce sul divisore
  let layout = { ...LAYOUT_DEFAULT };

  // Larghezze EFFETTIVE: dalle preferenze salvate, ristrette allo spazio disponibile (logica pura
  // condivisa col deck builder).
  function effectiveWidths() {
    const avail = (mgReviewGrid && mgReviewGrid.clientWidth) || 0;
    const PL = window.SN_PANE_LAYOUT;
    if (!PL) return { left: layout.leftW, right: layout.rightW };
    return PL.fitWidths({
      avail, gutters: DIVIDER_W * 2,
      left: layout.leftW, right: layout.rightW,
      minLeft: LAYOUT_MIN.leftW, minRight: LAYOUT_MIN.rightW, minCenter: CENTER_MIN,
    });
  }

  function applyLayout() {
    if (!mgReviewGrid) return;
    const { left, right } = effectiveWidths();
    mgReviewGrid.style.gridTemplateColumns =
      `${left}px ${DIVIDER_W}px minmax(0, 1fr) ${DIVIDER_W}px ${right}px`;
  }

  async function loadLayout() {
    try {
      const res = await chrome.storage.local.get(LAYOUT_KEY);
      const saved = res && res[LAYOUT_KEY];
      if (saved && typeof saved === 'object') {
        layout.leftW  = Math.max(LAYOUT_MIN.leftW,  Number(saved.leftW)  || LAYOUT_DEFAULT.leftW);
        layout.rightW = Math.max(LAYOUT_MIN.rightW, Number(saved.rightW) || LAYOUT_DEFAULT.rightW);
      }
    } catch (_) {}
    applyLayout();
  }

  function persistLayout() {
    try { chrome.storage.local.set({ [LAYOUT_KEY]: { ...layout } })?.catch?.(() => {}); } catch (_) {}
  }

  // Clampata al minimo della colonna e a quanto resta lasciando al dettaglio il suo minimo.
  function setColWidth(prop, w) {
    const rect = mgReviewGrid.getBoundingClientRect();
    const other = prop === 'leftW' ? layout.rightW : layout.leftW;
    const maxW = Math.max(LAYOUT_MIN[prop], rect.width - DIVIDER_W * 2 - other - CENTER_MIN);
    const next = Math.min(maxW, Math.max(LAYOUT_MIN[prop], Math.round(w)));
    if (next === layout[prop]) return false;
    layout[prop] = next;
    applyLayout();
    return true;
  }

  // Doppio clic: torna alla misura iniziale (se si può allargare, si deve poter tornare
  // indietro). Frecce ←/→ col divisore a fuoco: stessa cosa da tastiera.
  function wireDivider(el, prop, computeW) {
    if (!el || !mgReviewGrid) return;
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      el.classList.add('mg-divider--dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      const move = (ev) => setColWidth(prop, computeW(ev, mgReviewGrid.getBoundingClientRect()));
      const up = () => {
        el.classList.remove('mg-divider--dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        persistLayout();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    el.addEventListener('dblclick', () => {
      if (setColWidth(prop, LAYOUT_DEFAULT[prop])) persistLayout();
    });
    el.addEventListener('keydown', (e) => {
      let delta = 0;
      if (e.key === 'ArrowLeft')  delta = -KEY_STEP;
      else if (e.key === 'ArrowRight') delta = KEY_STEP;
      else if (e.key === 'Home') { e.preventDefault(); if (setColWidth(prop, LAYOUT_DEFAULT[prop])) persistLayout(); return; }
      else return;
      e.preventDefault();
      // Sulla colonna destra le frecce sono speculari: ← la allarga.
      const signed = prop === 'leftW' ? delta : -delta;
      if (setColWidth(prop, layout[prop] + signed)) persistLayout();
    });
  }

  wireDivider(mgDividerLeft, 'leftW', (ev, rect) => ev.clientX - rect.left - DIVIDER_W / 2);
  wireDivider(mgDividerRight, 'rightW', (ev, rect) => rect.right - ev.clientX - DIVIDER_W / 2);

  // La finestra che si rimpicciolisce ri-adatta le larghezze, o il dettaglio collasserebbe
  // sotto misure salvate più grandi dello spazio. Le preferenze NON si toccano.
  window.addEventListener('resize', applyLayout);

  async function init() {
    // La lista è la cosa più lenta (secondi di rete): parte SUBITO, e le altre
    // letture di avvio girano mentre viaggia, invece di metterlesi davanti in
    // fila. loadData la aspetta; un errore lo raccoglie lì, non qui.
    firstListPromise = leggiTutti();
    firstListPromise.catch(() => {});
    const domandePronte = DOMANDE ? DOMANDE.carica().catch(() => {}) : Promise.resolve();
    injectSearchIcons();
    await loadLayout();
    await refreshAuth();
    applyAutoModeGate();
    // In parallelo e senza che una fallita fermi le altre (ognuna gestisce già
    // il proprio errore; allSettled è la cintura).
    impostazioniAvviate = true;
    await Promise.allSettled([caricaImpostazioni(), loadSortMode()]);
    await loadData();
    await domandePronte;
    sceltaApertura();
    apriDomandaDallIndirizzo();
    startLive();
  }

  // `#domanda=D-12`: arriva dal segno «aspetta D-12» della pagina dei feedback, che porta dove si risponde.
  function apriDomandaDallIndirizzo() {
    const m = /^#domanda=(D-[1-9]\d{0,8})$/.exec(String(location.hash || ''));
    if (!m) return;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
    apriDomandaDelFeedback(m[1]);
  }
  window.addEventListener('hashchange', apriDomandaDallIndirizzo);

  // Un indirizzo che nomina una scheda o una sezione la apre, come un clic (#1414: è così che arrivano i vecchi indirizzi
  // delle pagine dell'owner). Poi torna pulito: riaprendo la scheda scavalcherebbe ogni volta la scelta d'apertura.
  function apriDaIndirizzo() {
    const tab = MR.schedaDaIndirizzo(location.hash);
    if (!tab) return;
    selectTab(tab);
    try { history.replaceState(history.state, '', location.pathname + location.search); } catch (_) {}
  }
  window.addEventListener('hashchange', apriDaIndirizzo);
  apriDaIndirizzo();

  // Un avvio rotto prima della lettura non deve lasciare le automazioni senza valori per sempre.
  const bootDone = init().catch((e) => { console.error('[manage] init:', e); }).finally(fineLetturaAutomazioni);
  // Gli spec devono poter aspettare la FINE del caricamento vero (Firestore)
  // prima di iniettare dati finti: se il caricamento atterra a metà test, li
  // sovrascrive e il test diventa rumore.
  window.__mgTest.whenReady = () => bootDone;

})();
