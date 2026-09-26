// Dashboard di gestione unificata di Filo (filo://manage/, owner-only).
// Tab-lista (Ricevuti / In coda / Risolti / Archiviati) che condividono un
// layout a 3 colonne (lista filtrata per tab / dettaglio / pannello laterale):
// la lista a sinistra mostra il sottoinsieme di feedback della tab corrente,
// il dettaglio al centro ne mostra la conversazione + azioni contestuali
// (sblocco per i bloccati, risposta per i chiarimenti). Le tab "Statistiche
// Red Team" e "Modelli di supporto" sono segnaposto per ora.

(function () {
  'use strict';

  // ── Elementi DOM ──────────────────────────────────────────────────────────
  const mgTabs       = document.getElementById('mgTabs');
  const mgBanner     = document.getElementById('mgBanner');
  const mgSignInBtn  = document.getElementById('mgSignIn');

  // Tab "Automazioni" (owner-only): switch modalità automatica + parametri.
  const mgAutoSwitch = document.getElementById('mgAutoSwitch');
  const mgAutoToggle = document.getElementById('mgAutoToggle');
  const mgAutoState  = document.getElementById('mgAutoState');
  const mgAutoMsg    = document.getElementById('mgAutoMsg');
  const mgAutoApproveBlock = document.getElementById('mgAutoApproveBlock');
  // Un interruttore per categoria di mittente (#446): la chiave è il gruppo
  // definito in SN_FEEDBACK_THREAD.AUTO_APPROVE_GROUPS.
  // Un interruttore per ogni categoria d'autore che la lista mostra come icona
  // (AUTHOR_META più sotto): chi si vede separato si regola separato.
  const mgAutoApprove = {
    owner:    document.getElementById('mgAutoApproveOwner'),
    user:     document.getElementById('mgAutoApproveUser'),
    local:    document.getElementById('mgAutoApproveLocal'),
    worker:   document.getElementById('mgAutoApproveWorker'),
    verifier: document.getElementById('mgAutoApproveVerifier'),
    residuo:  document.getElementById('mgAutoApproveResiduo'),
    prober:   document.getElementById('mgAutoApproveProber'),
    claude:   document.getElementById('mgAutoApproveClaude'),
    filo:     document.getElementById('mgAutoApproveFilo'),
  };
  // Interruttore master delle routine autonome (config/routines).
  const mgRoutinesSwitch = document.getElementById('mgRoutinesSwitch');
  const mgRoutinesToggle = document.getElementById('mgRoutinesToggle');
  const mgRoutinesState  = document.getElementById('mgRoutinesState');
  const mgRoutinesMsg    = document.getElementById('mgRoutinesMsg');
  const mgProberIdle      = document.getElementById('mgProberIdle');
  const mgProberIdleMsg   = document.getElementById('mgProberIdleMsg');
  const mgProberIdleBlock = document.getElementById('mgProberIdleBlock');
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
  const mgJudgeTimeout     = document.getElementById('mgJudgeTimeout');
  const mgJudgeTimeoutSave = document.getElementById('mgJudgeTimeoutSave');
  const mgJudgeTimeoutMsg  = document.getElementById('mgJudgeTimeoutMsg');

  // Tab "Log" (owner-only): elenco dei worker spawnati dalle routine.
  const mgLogLoading = document.getElementById('mgLogLoading');
  const mgLogDenied  = document.getElementById('mgLogDenied');
  const mgLogEmpty   = document.getElementById('mgLogEmpty');
  const mgLogList    = document.getElementById('mgLogList');
  const mgChannelSection = document.getElementById('mgChannelSection');
  const mgChannelEmpty   = document.getElementById('mgChannelEmpty');
  const mgChannelList    = document.getElementById('mgChannelList');

  // Lista (tab corrente)
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

  // Revisione — dettaglio
  const mgDetailEmpty = document.getElementById('mgDetailEmpty');
  const mgDetail      = document.getElementById('mgDetail');
  const mgDetailHead  = document.getElementById('mgDetailHead');
  const mgLivelliRow  = document.getElementById('mgLivelliRow');
  const mgForme       = document.getElementById('mgForme');
  const mgWorkState   = document.getElementById('mgWorkState');
  const mgThread      = document.getElementById('mgThread');

  // Revisione — pannello laterale
  const mgSideEmpty  = document.getElementById('mgSideEmpty');
  const mgSide       = document.getElementById('mgSide');
  const mgSideTitle  = document.getElementById('mgSideTitle');
  const mgSideClose  = document.getElementById('mgSideClose');
  const mgSideBody   = document.getElementById('mgSideBody');

  // La barra dell'owner: contiene TUTTI i tasti su una riga sola (azioni di
  // stato + preferito + frase per chi ha segnalato) e, sotto, i moduli che si
  // aprono da quei tasti (riapertura, frase).
  const mgOwnerBar      = document.getElementById('mgOwnerBar');

  // Azioni di stato (owner-only): i pulsanti li genera renderActions() leggendo
  // MR.ownerActions — la stessa tabella della pagina dei feedback.
  const mgActions       = document.getElementById('mgActions');
  const mgAcceptComment = document.getElementById('mgAcceptComment');
  const mgActionsRow    = document.getElementById('mgActionsRow');
  const mgActionMsg     = document.getElementById('mgActionMsg');
  // La riga degli esiti (azione di stato + preferito), sotto i tasti.
  const mgOwnerMsgs     = document.getElementById('mgOwnerMsgs');
  const mgReopen        = document.getElementById('mgReopen');
  const mgReopenText    = document.getElementById('mgReopenText');
  const mgReopenCancel  = document.getElementById('mgReopenCancelBtn');
  const mgReopenConfirm = document.getElementById('mgReopenConfirmBtn');

  // Risposta ai chiarimenti (owner-only)
  const mgClarify     = document.getElementById('mgClarify');
  const mgClarifyText = document.getElementById('mgClarifyText');
  const mgClarifyBtn  = document.getElementById('mgClarifyBtn');
  const mgClarifyMsg  = document.getElementById('mgClarifyMsg');
  // Frase per chi ha segnalato: il modulo (`mgUserNote`) sta chiuso finché non
  // lo si apre col tasto della barra (`mgUserNoteToggle`).
  const mgUserNote       = document.getElementById('mgUserNote');
  const mgUserNoteToggle = document.getElementById('mgUserNoteToggle');
  const mgUserNoteText   = document.getElementById('mgUserNoteText');
  const mgUserNoteBtn    = document.getElementById('mgUserNoteBtn');
  const mgUserNoteMsg    = document.getElementById('mgUserNoteMsg');

  // Preferito ⭐ (owner-only): flag in chiaro, indipendente dallo stato.
  const mgManage     = document.getElementById('mgManage');
  const mgPreapproveBtn = document.getElementById('mgPreapproveBtn');
  const mgPreapprovedInfo = document.getElementById('mgPreapprovedInfo');
  const mgPreapproveLine = document.getElementById('mgPreapproveLine');
  const mgStarBtn    = document.getElementById('mgStarBtn');
  const mgManageMsg  = document.getElementById('mgManageMsg');

  // Ricerca "a senso" (semantica)
  const mgSearchToggle = document.getElementById('mgSearchToggle');
  const mgSearchBar    = document.getElementById('mgSearchBar');
  const mgSearchIco    = document.getElementById('mgSearchIco');
  const mgSearchInput  = document.getElementById('mgSearchInput');
  const mgSearchMsg    = document.getElementById('mgSearchMsg');
  const mgSearchClose  = document.getElementById('mgSearchClose');

  // Lightbox
  const mgLightbox    = document.getElementById('mgLightbox');
  const mgLightboxImg = document.getElementById('mgLightboxImg');

  // ── Stato ─────────────────────────────────────────────────────────────────
  let isAdmin       = false;
  let allFeedbacks  = [];       // tutti i feedback caricati
  let dataLoaded    = false;    // i feedback sono arrivati davvero (vs. in corso/fallito)
  let loadFailed    = false;    // l'ultimo caricamento è fallito (≠ non ancora finito)
  let currentTab    = 'inbox';  // tab lista attiva (inbox/queue/resolved/archived)
  let currentList   = [];       // feedback della tab corrente, ordinati
  let selectedId    = null;     // ID del feedback selezionato nel pannello centrale
  let allByClient   = {};       // clientId → array di feedback (per il pannello mittente)
  let starredOnly   = false;    // filtro ⭐ della tab Archiviati (DB2)
  let confirmedOnly = false;    // filtro "Bloccati confermati" (attack/spam confermati)
  let releasedVersion = '';     // versione dell'app in esecuzione = ultima rilasciata (DB3)
  let firstListPromise = null;  // prima lettura della lista, avviata da init PRIMA del resto
  let testDataInjected = false; // uno spec ha iniettato la lista: il caricamento vero non la tocca più
  // Modalità automatica: agisce UNA volta al momento del giudizio (lato
  // pipeline: sicuro+ON → todo, sicuro+OFF → aligned). NON è più una lente
  // sulle liste: le tab derivano solo dallo status (macchina a stati).
  let autoModeOn    = false;
  let searchMode    = false;      // true = la lista mostra i risultati di ricerca
  let searchSeq     = 0;          // guardia anti-race tra ricerche concorrenti

  // Etichette/testi vuoto per le tab-lista (DB1).
  const TAB_LABELS = {
    inbox: 'Ricevuti', queue: 'In coda', resolved: 'Risolti', archived: 'Archiviati',
  };
  const TAB_EMPTY = {
    inbox:    'Nessun feedback ricevuto.',
    queue:    'Nessun feedback in coda.',
    resolved: 'Nessun feedback risolto.',
    archived: 'Nessun feedback archiviato.',
  };
  const LIST_TABS = ['inbox', 'queue', 'resolved', 'archived'];
  // Come si chiama la lista quando le sezioni non ci sono: nessun nome di
  // sezione, perché nessuna sezione è stata scelta.
  const SENZA_SEZIONI_LABEL = 'Segnalazioni';
  const SENZA_SEZIONI_AVVISO = 'Questo computer non può leggere lo stato delle segnalazioni. '
    + 'Le trovi tutte qui sotto, in un elenco solo.';

  const FB  = window.SN_FEEDBACK;
  const MR  = window.SN_MANAGE_REVIEW;
  const TH  = window.SN_FEEDBACK_THREAD;
  const SRCH = window.SN_MANAGE_SEARCH;
  const AUTO_MODE_KEY = (window.SN_CONST?.STORAGE_KEYS?.AUTO_MODE) || 'filo_auto_mode';
  const SORT_MODE_KEY = 'filo_manage_sort';
  const AUTOMATION_GET = (window.SN_MSG?.MSG?.AUTOMATION_GET) || 'automation_get';
  const AUTOMATION_SET = (window.SN_MSG?.MSG?.AUTOMATION_SET) || 'automation_set';

  // ── Icona d'autore su ogni card (chi ha scritto il feedback) ──────────────
  // La CLASSIFICAZIONE (prefissi → categoria) è pura e condivisa in
  // SN_FEEDBACK_THREAD.authorKind; qui vive solo la resa visiva (icona+etichetta).
  // Le tre automazioni sono separate (#443): quello che conta, leggendo la coda,
  // è se un ritrovamento nasce esplorando l'app, implementando una modifica o
  // verificando il lavoro di qualcun altro.
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
    claude:   { icon: '🤖', label: 'Claude (ruolo non indicato)' },
  };
  function authorKindOf(fb) {
    return (TH && TH.authorKind) ? TH.authorKind(fb && fb.clientId) : 'user';
  }
  function authorMetaOf(fb) {
    return AUTHOR_META[authorKindOf(fb)] || AUTHOR_META.user;
  }
  function authorIconHtml(fb) {
    const m = authorMetaOf(fb);
    return `<span class="mg-item-author" title="Scritto da: ${esc(m.label)}" aria-label="Scritto da ${esc(m.label)}">${m.icon}</span>`;
  }
  // Etichetta del mittente per l'intestazione del dettaglio. Fra utenti diversi
  // l'identificativo è l'unica cosa che li distingue, quindi per loro (e solo per
  // loro) se ne mostra un pezzo: per owner/Filo/automazioni sarebbe rumore.
  function senderLabel(fb) {
    const kind = authorKindOf(fb);
    const m = AUTHOR_META[kind] || AUTHOR_META.user;
    if (kind !== 'user') return `${m.icon} ${m.label}`;
    const id = String((fb && fb.clientId) || '').trim();
    const short = id.slice(0, 8);
    return short ? `${m.icon} ${m.label} · ${short}…` : `${m.icon} ${m.label}`;
  }

  // ── Ordinamento della lista (menu tasto destro sull'intestazione) ─────────
  // 'smart' = ordine predefinito per-tab (severità/priorità/recenza, come prima).
  // Gli altri sono override globali richiesti dall'owner dal menu contestuale.
  const SORT_MODES = {
    smart:    'Ordine predefinito',
    num:      'Per numero (recenti prima)',
    priority: 'Per priorità',
    creator:  'Per creatore',
  };
  let sortMode = 'smart';

  // Chiave numerica di un feedback per l'ordinamento "per numero": seq.subSeq
  // (#12.3 → 12003). Senza numero → in fondo (con l'ordine decrescente).
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
  const AUTHOR_RANK = { owner: 0, user: 1, local: 2, worker: 3, verifier: 4, residuo: 5, prober: 6, claude: 7, filo: 8 };
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
        const ra = AUTHOR_RANK[authorKindOf(a)] ?? 9;
        const rb = AUTHOR_RANK[authorKindOf(b)] ?? 9;
        if (ra !== rb) return ra - rb;
        return String(a.clientId || '').localeCompare(String(b.clientId || ''));
      });
    }
    return arr;
  }
  const CAP3_KEY = (window.SN_CONST?.STORAGE_KEYS?.AUTOMATION_CAP3) || 'filo_automation_cap3';
  const CAP2_KEY = (window.SN_CONST?.STORAGE_KEYS?.AUTOMATION_CAP2) || 'filo_automation_cap2';
  const CAP1_KEY = (window.SN_CONST?.STORAGE_KEYS?.AUTOMATION_CAP1) || 'filo_automation_cap1';
  const CAP0_KEY = (window.SN_CONST?.STORAGE_KEYS?.AUTOMATION_CAP0) || 'filo_automation_cap0';
  const AUTOMATION = window.SN_CONST?.AUTOMATION || { CAP_MIN: 0, CAP_MAX: 10 };
  // Nessun default dei bilanci nel codice (decisione dell'owner del
  // 2026-09-16): i numeri stanno solo nel documento del server. Un campo che
  // lì non c'è si mostra vuoto, e lo si dice.

  // ── Canale main process ───────────────────────────────────────────────────
  function sendToMain(msg) {
    if (window.filo?.message)               return window.filo.message(msg);
    if (window.chrome?.runtime?.sendMessage) return window.chrome.runtime.sendMessage(msg);
    return Promise.reject(new Error('canale main non disponibile'));
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  // Chi guarda cambia: unica porta, e unico posto dove si buttano via le
  // risposte tenute da parte. Un allegato si chiede una volta per indirizzo e
  // la risposta resta in memoria anche quando è un no — ma quel no dipende da
  // CHI sta guardando, e il pulsante per farsi riconoscere è in questa pagina.
  // Senza svuotare, chi lo premeva continuava a vedere segnaposti al posto
  // degli allegati finché non riapriva Gestione (#582, giro 3: stesso danno,
  // stessa cura, l'altra superficie).
  function setIsAdmin(v) {
    const nuovo = !!v;
    if (nuovo === isAdmin) return;
    isAdmin = nuovo;
    imgCache.clear();
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

  async function refreshAuth() {
    try {
      const r = await sendToMain({ type: 'auth_status' });
      setIsAdmin(!!(r && r.isAdmin));
    } catch (_) {
      setIsAdmin(false);
    }
    mgBanner.hidden = isAdmin;
  }

  mgSignInBtn.addEventListener('click', () => {
    // Finito l'accesso si richiede lo stato: è quello che toglie l'avviso di
    // sola lettura e svuota le risposte di quando non eravamo nessuno.
    sendToMain({ type: 'auth_signin' }).then(() => refreshAuth()).catch(() => {});
  });

  // ── Switch "Routine autonome" (interruttore master) ───────────────────────
  // Vive nel doc Firestore config/routines, che le routine leggono SENZA
  // credenziali: è l'unico modo perché "spento" arrivi davvero alle loro
  // macchine (le altre impostazioni stavano in un documento che loro non
  // possono leggere, e infatti non le hanno mai viste — vedi #451).
  //
  // Spento non è "meno lavoro": è nessun lavoro. Le due impostazioni che
  // riguardano solo le routine restano visibili ma inerti, e si vede.
  let routinesOn = true;

  function reflectRoutines(on) {
    routinesOn = !!on;
    if (mgRoutinesToggle) mgRoutinesToggle.checked = routinesOn;
    if (mgRoutinesState)  mgRoutinesState.textContent = routinesOn ? 'On' : 'Off';
    if (mgProberIdleBlock) mgProberIdleBlock.classList.toggle('mg-auto-block--off', !routinesOn);
    for (const id of ['mgCap3Block', 'mgCap2Block', 'mgCap1Block', 'mgCap0Block', 'mgFixInstructionsBlock']) {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('mg-auto-block--off', !routinesOn);
    }
    applyAutoModeGate();
  }

  function setRoutinesMsg(text, kind) {
    if (!mgRoutinesMsg) return;
    mgRoutinesMsg.textContent = text || '';
    mgRoutinesMsg.classList.toggle('mg-ok', kind === 'ok');
    mgRoutinesMsg.classList.toggle('mg-err', kind === 'err');
  }

  if (mgRoutinesToggle) {
    mgRoutinesToggle.addEventListener('change', async () => {
      const on = mgRoutinesToggle.checked;
      reflectRoutines(on);
      setRoutinesMsg('', null);
      try {
        const r = await sendToMain({ type: AUTOMATION_SET, routinesEnabled: on });
        if (!r || r.ok === false) throw new Error(r?.error || 'errore sconosciuto');
        reflectRoutines(r.routinesEnabled !== false);
        // Spegnere vale dal prossimo giro: chi sta già lavorando finisce il suo
        // compito. Senza dirlo, sembrerebbe non aver fatto niente.
        setRoutinesMsg(on ? 'Salvato.' : 'Salvato. Un lavoro già in corso arriva in fondo, poi non ne parte nessun altro.', 'ok');
      } catch (err) {
        // Non scritto = non cambiato: lo switch non deve dire il contrario.
        reflectRoutines(!on);
        setRoutinesMsg('Salvataggio fallito: le routine NON sono cambiate.', 'err');
        console.error('[manage] salvataggio interruttore routine fallito:', err);
      }
    });
  }

  // ── Switch "Modalità automatica" ──────────────────────────────────────────
  // La fonte di verità è il doc Firestore config/automation (campo `enabled`),
  // perché è QUELLO che il backend dei giudici legge per decidere se un feedback
  // sicuro entra in coda da solo. chrome.storage.local resta solo una cache
  // locale: mostra subito un valore all'apertura e regge se l'IPC non risponde.
  //
  // Fino al 2026-08-12 lo switch scriveva SOLO la cache locale: nessuno la
  // leggeva, quindi accenderlo non produceva alcun effetto (feedback #446).
  function reflectAutoMode(on) {
    autoModeOn = !!on;
    mgAutoToggle.checked = !!on;
    mgAutoState.textContent = on ? 'On' : 'Off';
    applyAutoApproveGate();
  }

  function setAutoModeMsg(text, kind) {
    if (!mgAutoMsg) return;
    mgAutoMsg.textContent = text || '';
    mgAutoMsg.classList.toggle('mg-ok', kind === 'ok');
    mgAutoMsg.classList.toggle('mg-err', kind === 'err');
  }

  async function loadAutoMode() {
    // 1. Cache locale: valore immediato, niente attesa davanti allo switch.
    try {
      const data = await chrome.storage.local.get(AUTO_MODE_KEY);
      reflectAutoMode(!!data[AUTO_MODE_KEY]);
    } catch (_) {
      reflectAutoMode(false);
    }
    // 2. Valore vero da Firestore (owner-gated). Se non siamo admin o siamo
    //    offline resta quello della cache.
    try {
      const r = await sendToMain({ type: AUTOMATION_GET });
      if (r && r.ok) {
        reflectAutoMode(Boolean(r.enabled));
        reflectAutoApprove(r.autoApprove);
        reflectRoutines(r.routinesEnabled !== false);
        if (mgProberIdle) mgProberIdle.checked = r.proberWhenIdle !== false;
        chrome.storage.local.set({ [AUTO_MODE_KEY]: Boolean(r.enabled) }).catch(() => {});
      }
    } catch (_) { /* resta la cache */ }
  }

  mgAutoToggle.addEventListener('change', async () => {
    const on = mgAutoToggle.checked;
    reflectAutoMode(on);
    setAutoModeMsg('', null);
    try {
      const r = await sendToMain({ type: AUTOMATION_SET, enabled: on });
      if (!r || r.ok === false) throw new Error(r?.error || 'errore sconosciuto');
      reflectAutoMode(Boolean(r.enabled));
      reflectAutoApprove(r.autoApprove);
      chrome.storage.local.set({ [AUTO_MODE_KEY]: Boolean(r.enabled) }).catch(() => {});
      // Accendere l'automatica vale da ORA in avanti: agisce al momento del
      // giudizio, quindi i feedback già in attesa restano dove sono. Senza
      // dirlo, accendere lo switch sembra di nuovo non fare niente — e i già in
      // attesa hanno il loro pulsante, due righe più in là.
      const pending = r.enabled ? alignedFeedbacks().length : 0;
      setAutoModeMsg(
        pending
          ? `Salvato. I ${pending} già in attesa restano nei Ricevuti: usa «Approva tutti gli allineati».`
          : 'Salvato.',
        'ok',
      );
    } catch (err) {
      // Ripristina lo stato precedente: se non è stato scritto su Firestore, non
      // è attivo — e lo switch non deve dire il contrario.
      reflectAutoMode(!on);
      setAutoModeMsg('Salvataggio fallito: la modalità automatica NON è cambiata.', 'err');
      console.error('[manage] salvataggio modalità automatica fallito:', err);
    }
  });

  // ── Auto-approvazione per mittente (#446) ─────────────────────────────────
  // Con l'automatica accesa, questi decidono DI CHI ci si fida abbastanza da
  // farlo entrare in coda senza passare dall'owner. Spenta l'automatica non
  // contano: restano visibili ma inerti (e lo si vede).
  function reflectAutoApprove(map) {
    // Il ripiego sul vecchio interruttore unico di Claude vive nel modulo
    // condiviso: una mappa salvata prima che si sdoppiassero non deve mostrare
    // acceso ciò che l'owner aveva spento.
    const resolved = (TH && TH.resolveAutoApprove) ? TH.resolveAutoApprove(map) : null;
    const m = resolved || ((map && typeof map === 'object') ? map : {});
    for (const [group, el] of Object.entries(mgAutoApprove)) {
      if (el) el.checked = m[group] !== false;
    }
  }

  function applyAutoApproveGate() {
    for (const el of Object.values(mgAutoApprove)) {
      if (el) el.disabled = !isAdmin || !autoModeOn;
    }
    if (mgAutoApproveBlock) mgAutoApproveBlock.classList.toggle('mg-auto-sub--off', !autoModeOn);
  }

  for (const [group, el] of Object.entries(mgAutoApprove)) {
    if (!el) continue;
    el.addEventListener('change', async () => {
      const want = el.checked;
      setAutoModeMsg('', null);
      try {
        const r = await sendToMain({ type: AUTOMATION_SET, autoApprove: { [group]: want } });
        if (!r || r.ok === false) throw new Error(r?.error || 'errore sconosciuto');
        reflectAutoApprove(r.autoApprove);
      } catch (err) {
        el.checked = !want;
        setAutoModeMsg('Salvataggio fallito: l\'impostazione NON è cambiata.', 'err');
        console.error('[manage] salvataggio auto-approvazione fallito:', err);
      }
    });
  }

  // ── Esplorazione automatica a coda vuota (#448) ───────────────────────────
  // Indipendente dall'automatica: riguarda cosa fanno le routine quando NON c'è
  // più niente in coda, non chi entra in coda.
  if (mgProberIdle) {
    mgProberIdle.addEventListener('change', async () => {
      const want = mgProberIdle.checked;
      if (mgProberIdleMsg) mgProberIdleMsg.textContent = '';
      try {
        const r = await sendToMain({ type: AUTOMATION_SET, proberWhenIdle: want });
        if (!r || r.ok === false) throw new Error(r?.error || 'errore sconosciuto');
        mgProberIdle.checked = r.proberWhenIdle !== false;
      } catch (err) {
        mgProberIdle.checked = !want;
        if (mgProberIdleMsg) {
          mgProberIdleMsg.textContent = 'Salvataggio fallito: l\'impostazione NON è cambiata.';
          mgProberIdleMsg.classList.add('mg-err');
        }
        console.error('[manage] salvataggio esplorazione automatica fallito:', err);
      }
    });
  }

  function applyAutoModeGate() {
    mgAutoToggle.disabled = !isAdmin;
    mgAutoSwitch.classList.toggle('mg-switch--disabled', !isAdmin);
    if (mgRoutinesToggle) mgRoutinesToggle.disabled = !isAdmin;
    if (mgRoutinesSwitch) mgRoutinesSwitch.classList.toggle('mg-switch--disabled', !isAdmin);
    // Le due impostazioni che valgono solo per le routine: senza routine non
    // decidono niente, quindi non si toccano (come i mittenti con l'automatica
    // spenta). Restano visibili: sono una scelta dell'owner, non un segreto.
    for (const el of [mgCap3, mgCap3Save, mgCap2, mgCap2Save, mgCap1, mgCap1Save, mgCap0, mgCap0Save, mgFixInstructions, mgFixInstructionsSave]) {
      if (el) el.disabled = !isAdmin || !routinesOn;
    }
    if (mgProberIdle)  mgProberIdle.disabled = !isAdmin || !routinesOn;
    // Vale anche per la verifica locale, che gira a routine spente.
    if (mgGiroStretto) mgGiroStretto.disabled = !isAdmin;
    if (mgGiroStrettoSwitch) mgGiroStrettoSwitch.classList.toggle('mg-switch--disabled', !isAdmin);
    // Le sessioni NON dipendono dalle routine accese: escludere un account, o
    // ridurre il parallelismo, si decide prima di riaccendere.
    for (const el of [mgMaxSessions, mgMaxSessionsSave, mgAccountA, mgAccountB, ...mgPriorityRadios]) {
      if (el) el.disabled = !isAdmin;
    }
    if (mgJudgeTimeout)     mgJudgeTimeout.disabled = !isAdmin;
    if (mgJudgeTimeoutSave) mgJudgeTimeoutSave.disabled = !isAdmin;
    applyAutoApproveGate();
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
    // Sorgente autorevole: Firestore via main (owner-gated). Se la lettura
    // riesce, quello che dice il server vale anche quando un campo MANCA: la
    // cache locale serve solo a chi non ha potuto leggere.
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
      // Scrive su Firestore (la config che il server della critica legge); il
      // main applica il gate admin e ri-clampa. Usa il valore confermato.
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
    // Oltre il tetto il server taglia: meglio dirlo che salvare un testo
    // mozzato con un «Salvato.» sopra.
    const max = Number(AUTOMATION.FIX_INSTRUCTIONS_MAX) || 8000;
    if (text.length > max) {
      setCapMsg('fixInstructions', `Troppo lungo: ${text.length} caratteri, il massimo è ${max}. Non salvato.`, 'err');
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
    // Digitando si azzera il messaggio di esito precedente; Invio salva, come
    // il pulsante (due strade, una cosa sola).
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
  // Finché non si è letto dal server, quello che si vede non è quello che c'è:
  // la pagina lo dice invece di far passare i valori di partenza per veri.
  let sessionsLetto = false;
  const SESSIONS_NON_LETTO = 'Non ho potuto leggere dal server: quello che vedi qui non viene da lì.';

  function setSessionsMsg(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('mg-ok', kind === 'ok');
    el.classList.toggle('mg-err', kind === 'err');
  }

  function reflectSessions(raw, letto) {
    if (!RS) return;
    sessionsState = RS.leggiDoc(raw);
    sessionsLetto = letto !== false;
    // Non letto = campo vuoto, come i bilanci qui sotto: un numero scritto lì
    // dentro verrebbe preso per quello del server.
    if (mgMaxSessions) mgMaxSessions.value = sessionsLetto ? String(sessionsState.maxSessions) : '';
    for (const r of mgPriorityRadios) r.checked = sessionsLetto && r.value === sessionsState.priorityAccount;
    if (mgAccountA) mgAccountA.checked = !sessionsState.accountAOff;
    if (mgAccountB) mgAccountB.checked = !sessionsState.accountBOff;
    // Esclusi tutti e due non parte niente; escluso il solo prioritario si
    // lavora sull'altro. Due stati che a guardare gli interruttori non si
    // capiscono, quindi si scrivono.
    const resta = RS.prioritarioIgnorato(sessionsState);
    if (mgAccountsWarn) mgAccountsWarn.hidden = !sessionsLetto || !RS.nessunAccount(sessionsState);
    if (mgPriorityWarn) {
      mgPriorityWarn.hidden = !sessionsLetto || !resta;
      if (resta) mgPriorityWarn.textContent = `L'account ${sessionsState.priorityAccount} è escluso: le sessioni partono da ${resta}.`;
    }
  }

  function sessionsNonLette() {
    reflectSessions({}, false);
    for (const el of [mgMaxSessionsMsg, mgPriorityAccountMsg, mgAccountsMsg]) {
      setSessionsMsg(el, SESSIONS_NON_LETTO, 'err');
    }
  }

  async function loadSessions() {
    if (!RS) return;
    try {
      const r = await sendToMain({ type: SESSIONS_GET });
      if (r && r.ok) reflectSessions(r);
      else sessionsNonLette();
    } catch (_) {
      sessionsNonLette();
    }
  }

  async function saveSessions(patch, msgEl) {
    const esito = RS.valida(patch);
    if (!esito.ok) {
      setSessionsMsg(msgEl, esito.testo, 'err');
      return false;
    }
    try {
      const r = await sendToMain(Object.assign({ type: SESSIONS_SET }, esito.valori));
      if (!r || !r.ok) {
        // Non scritto = non cambiato: la pagina rimette quello che c'è sul
        // server invece di mostrare una scelta che non è mai arrivata.
        reflectSessions(sessionsState, sessionsLetto);
        setSessionsMsg(msgEl, 'Salvataggio fallito: l\'impostazione NON è cambiata.', 'err');
        if (r?.error) console.error('[manage] salvataggio sessioni:', r.error);
        return false;
      }
      if (r.letto === false) {
        // Scritto sì, riletto no: si tiene quello che è appena partito e si
        // dice che il resto non si è potuto ricontrollare. Rimettere i valori
        // di partenza qui spegnerebbe sullo schermo una scelta già salvata.
        reflectSessions(Object.assign({}, sessionsState, esito.valori), sessionsLetto);
        setSessionsMsg(msgEl, 'Salvato. Il resto non l\'ho potuto rileggere dal server.', 'ok');
        return true;
      }
      reflectSessions(r);
      setSessionsMsg(msgEl, 'Salvato.', 'ok');
      return true;
    } catch (err) {
      reflectSessions(sessionsState, sessionsLetto);
      setSessionsMsg(msgEl, 'Salvataggio fallito: l\'impostazione NON è cambiata.', 'err');
      console.error('[manage] salvataggio sessioni fallito:', err);
      return false;
    }
  }

  if (mgMaxSessions) {
    // Un campo numerico che contiene qualcosa che numero non è risponde
    // `value === ''`: senza `badInput` si direbbe «vuoto» a chi ha scritto «tre».
    const letto = () => (mgMaxSessions.validity && mgMaxSessions.validity.badInput ? 'NaN' : mgMaxSessions.value);
    const salva = () => saveSessions({ maxSessions: letto() }, mgMaxSessionsMsg);
    if (mgMaxSessionsSave) mgMaxSessionsSave.addEventListener('click', salva);
    mgMaxSessions.addEventListener('input', () => setSessionsMsg(mgMaxSessionsMsg, '', null));
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


  // ── Timeout dei giudici ────────────────────────────────────────────────────
  // Fonte di verità: config/supportModels (campo `judgeTimeoutMs`, in MS), che il
  // backend dei giudici legge per ogni chiamata. La UI lavora in SECONDI; salva e
  // legge via i messaggi support_models_* (PATCH per-campo: non tocca i modelli).
  const JT_DEF = AUTOMATION.JUDGE_TIMEOUT_DEFAULT_S || 60;
  const JT_MIN = AUTOMATION.JUDGE_TIMEOUT_MIN_S || 10;
  const JT_MAX = AUTOMATION.JUDGE_TIMEOUT_MAX_S || 300;
  // I limiti del campo vengono dal registro, non dall'HTML: erano scritti in due
  // posti e alzare il tetto in uno solo lasciava il campo a rifiutare il valore
  // nuovo (o ad accettarne uno che il backend non rispetta).
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

  // ── Tab "Log" (worker delle routine) ──────────────────────────────────────
  // Elenco degli ultimi worker spawnati (ruolo + istante d'avvio). Fonte:
  // config/automation.workerLog, scritto dal server al rilascio di ogni
  // biglietto; qui è di sola lettura via il canale main (owner-gated).
  const WORKER_LOG_GET = (window.SN_MSG?.MSG?.WORKER_LOG_GET) || 'worker_log_get';
  // Etichette amichevoli per i ruoli del dispatcher (mai l'id grezzo).
  const ROLE_LABELS = {
    'new-work': 'Nuovo lavoro',
    verifier:   'Verifica',
    fixer:      'Correzione',
    secaudit:   'Audit sicurezza',
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

  // Tempo trascorso "umano" (adesso / N min / N ore / N giorni fa). Più fine di
  // daysAgo: uno spawn recente si misura in minuti, non in "oggi".
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
  // Data+ora assolute (per il sottotono a destra e il title di ogni riga).
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

  // ── Canale autenticato delle routine (stessa scheda, secondo blocco) ──────
  // Rifiuti e confronti vivono in collezioni che nessun client può leggere: il
  // main passa dalla callable owner-only del backend di sicurezza. Se il canale
  // non è ancora in uso i due registri sono vuoti e il blocco resta nascosto —
  // una sezione vuota che non spiega perché è peggio di nessuna sezione.
  const ROUTINE_LOG_GET = (window.SN_MSG?.MSG?.ROUTINE_LOG_GET) || 'routine_log_get';
  const MERGE_APPROVALS_GET = (window.SN_MSG?.MSG?.MERGE_APPROVALS_GET) || 'merge_approvals_get';
  const MERGE_APPROVAL_APPROVE = (window.SN_MSG?.MSG?.MERGE_APPROVAL_APPROVE) || 'merge_approval_approve';
  const MERGE_APPROVAL_DISCARD = (window.SN_MSG?.MSG?.MERGE_APPROVAL_DISCARD) || 'merge_approval_discard';
  const MERGE_APPROVALS_CHANGED = (window.SN_MSG?.MSG?.MERGE_APPROVALS_CHANGED) || 'merge_approvals_changed';
  const TAB_IN_VISTA = (window.SN_MSG?.MSG?.TAB_IN_VISTA) || 'tab_in_vista';
  const TAB_IN_VISTA_GET = (window.SN_MSG?.MSG?.TAB_IN_VISTA_GET) || 'tab_in_vista_get';
  const LIVELLO4_SALTA = (window.SN_MSG?.MSG?.LIVELLO4_SALTA) || 'livello4_salta';

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
  };

  function renderChannelLog(rejections, comparisons) {
    if (!mgChannelSection || !mgChannelList) return;
    const rows = [];
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
    mgChannelList.innerHTML = rows.slice(0, 60).map((row) => {
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
  // Le decisioni già prese restano elencate in Automazioni: un'eccezione ai
  // controlli di sicurezza deve lasciare una traccia che si può guardare.
  const mgMergeApprovalsOrphans = document.getElementById('mgMergeApprovalsOrphans');
  const mgMergeApprovalsRecent = document.getElementById('mgMergeApprovalsRecent');
  const mgMergeApprovalsPreapproved = document.getElementById('mgMergeApprovalsPreapproved');

  // Gli elenchi del server, così come sono arrivati: il quadrato di ogni scheda
  // e il bordo delle card in lista li leggono da qui. Restano in memoria fra un
  // avviso e l'altro — una scheda aperta deve poter ridisegnare il suo quadrato
  // senza rileggere niente.
  let fusioni = { pending: [], failed: [], recent: [], preapproved: [] };
  let fusioniLette = false;
  // Una richiesta si manda a fondere per il segno UNA volta per pagina: un
  // rifiuto o un conflitto non si ritentano da soli a ogni rilettura.
  const fusioniTentate = new Set();
  // L'esito di quel tentativo, per richiesta: il riquadro in basso e la riga
  // del dettaglio sono un posto solo, e chi arriva dopo cancella chi c'era.
  const esitiTentati = new Map();

  // Dal numero della segnalazione (l'etichetta "automazione · feedback #N"
  // sulla scheda) al feedback vero: la scheda sta già dentro la dashboard dei
  // feedback, quindi "guarda cosa era stato chiesto" deve essere un click, non
  // una ricerca a mano. Se il feedback non è (più) nella lista non si fa nulla.
  function openFeedbackByNum(num) {
    const cerca = String(num || '').trim();
    if (!cerca || !FB || typeof FB.formatNum !== 'function') return;
    const fb = allFeedbacks.find((f) => FB.formatNum(f.seq, f.subSeq) === cerca);
    if (!fb) return;
    // Senza sezioni non c'è una sezione in cui saltare: la lista è una sola e
    // la segnalazione è già lì.
    if (sezioniAttendibili()) selectTab(MR.manageTabFor(fb, { releasedVersion, fusioni }));
    openDetail(fb._id);
  }

  // `already` è l'elenco già pronto, quando ad avvisare è stato il main
  // (MERGE_APPROVALS_CHANGED): una pagina già aperta deve accorgersi di una
  // richiesta nuova, altrimenti l'avviso lo vede solo chi riapre la pagina.
  // Le opzioni che il modulo condiviso vuole per disegnare le card: gli stessi
  // tasti, lo stesso "chiedi conferma", lo stesso esito, ovunque le card
  // compaiano — nel pannello del quadrato e in Automazioni.
  function opzioniFusioni(extra) {
    const UI = window.SN_MERGE_APPROVALS;
    return Object.assign({
      onDone: () => { setTimeout(loadMergeApprovals, 1200); },
      esitoIniziale: (req) => esitiTentati.get(req.id) || null,
      onApprove: (req) => sendToMain({ type: MERGE_APPROVAL_APPROVE, id: req.id }),
      onDiscard: (req) => sendToMain({ type: MERGE_APPROVAL_DISCARD, id: req.id }),
      onFeedback: (req) => openFeedbackByNum(UI ? UI.feedbackNum(req) : ''),
    }, extra || {});
  }

  // Il segno «fondi senza chiedermelo» messo DOPO il blocco: il server la
  // richiesta l'ha già aperta e non la riguarda, quindi la fonde questa pagina,
  // con lo stesso gesto e lo stesso esito del tasto «Approva e fondi».
  async function fondiCoperte(fb, opts) {
    const UI = window.SN_MERGE_APPROVALS;
    if (!UI || !fb || !isAdmin) return [];
    const daFondere = UI.richiesteCoperte(fusioni.pending, {
      feedbackId: fb._id,
      numero: FB && typeof FB.formatNum === 'function' ? FB.formatNum(fb.seq, fb.subSeq) : '',
      ancheNuovi: !!(opts && opts.ancheNuovi),
    }).filter((req) => !fusioniTentate.has(req.id));
    if (daFondere.length && opts && typeof opts.avvia === 'function') opts.avvia(daFondere.length);
    const esiti = [];
    for (const req of daFondere) {
      fusioniTentate.add(req.id);
      let reply;
      try { reply = await sendToMain({ type: MERGE_APPROVAL_APPROVE, id: req.id }); }
      catch (e) { reply = { ok: false, error: e?.message || String(e) }; }
      const msg = UI.outcomeMessage(reply, req);
      esitiTentati.set(req.id, msg);
      esiti.push({ req, msg });
    }
    if (esiti.length) setTimeout(loadMergeApprovals, 1200);
    return esiti;
  }

  // Il segno rimesso a mano è una decisione nuova, non una rilettura: quello che
  // non era riuscito si ritenta. Senza, dopo un server irraggiungibile il ramo
  // restava fermo e la pagina rispondeva lo stesso «da ora si fonde senza chiedere».
  function dimenticaTentativi(fb) {
    const UI = window.SN_MERGE_APPROVALS;
    if (!UI || !fb) return;
    for (const req of UI.richiesteCoperte(fusioni.pending, {
      feedbackId: fb._id,
      numero: FB && typeof FB.formatNum === 'function' ? FB.formatNum(fb.seq, fb.subSeq) : '',
      ancheNuovi: true,
    })) { fusioniTentate.delete(req.id); esitiTentati.delete(req.id); }
  }

  // Le richieste ferme sulle pratiche già segnate si fondono appena la pagina
  // vede le due cose insieme: segno e richiesta arrivano da due letture
  // diverse, in un ordine qualunque.
  let fusioniInCorso = false;
  async function fondiPreapprovateInAttesa() {
    if (fusioniInCorso || !isAdmin || !dataLoaded) return;
    fusioniInCorso = true;
    const righe = [];
    try {
      for (const fb of allFeedbacks.slice()) {
        // Il segno da approvazione non basta: una richiesta ferma lì è nata da
        // blocchi nuovi, che l'owner deve guardare.
        if (!preapprovatoPieno(fb) || !isOpenPublic(fb)) continue;
        for (const { req, msg } of await fondiCoperte(fb)) {
          const num = window.SN_MERGE_APPROVALS.feedbackNum(req);
          const dove = num ? ` su #${num}` : '';
          righe.push({ testo: `Fusione ferma${dove}, pratica segnata «fondi senza chiedermelo»: ${msg.text}`, kind: msg.kind });
        }
      }
    } finally {
      fusioniInCorso = false;
    }
    if (!righe.length) return;
    // Gli esiti del giro si dicono TUTTI INSIEME: il riquadro è uno solo, e uno
    // alla volta il secondo cancella il primo prima che si possa leggere.
    // Questa parte da sola, di solito senza nessuna pratica aperta: la riga del
    // dettaglio lì non è sullo schermo, e un ramo fermo resterebbe fermo senza
    // che nessuno sappia perché.
    const testo = righe.map((r) => r.testo).join('\n');
    const kind = righe.every((r) => r.kind === 'ok') ? 'ok' : 'err';
    setManageMsg(testo, kind);
    toast(testo, kind, 4500 + (righe.length - 1) * 2500);
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
    const primaDelleFusioni = fusioniLette && LIVE
      ? new Map(allFeedbacks.map((f) => [String(f._id), sezioneDi(f)]))
      : null;
    fusioni = {
      pending: r.pending || [],
      failed: r.failed || [],
      recent: r.recent || [],
      // Il campanello del main manda solo ciò che è cambiato: quello che c'era
      // resta finché non si rilegge.
      preapproved: Array.isArray(r.preapproved) ? r.preapproved : (fusioni.preapproved || []),
    };
    fusioniLette = true;
    if (primaDelleFusioni && dataLoaded) segnaArrivi(primaDelleFusioni, allFeedbacks);
    // Una richiesta che non c'è più non ha un esito da raccontare.
    const vive = new Set(fusioni.pending.concat(fusioni.failed).map((req) => req.id));
    for (const id of Array.from(esitiTentati.keys())) if (!vive.has(id)) esitiTentati.delete(id);
    const n = renderFusioniOrfane();
    // Il quadrato della scheda aperta e il bordo delle card in lista vengono da
    // questi elenchi: una richiesta nuova deve vedersi subito, senza riaprire.
    riflettiFusioni();
    fondiPreapprovateInAttesa();
    UI.renderRecent(mgMergeApprovalsRecent, { recent: r.recent || [] });
    // Le fuse senza chiedere: il controllo a posteriori del segno messo sulla
    // pratica. Quando il main avvisa di un cambiamento manda solo l'elenco in
    // attesa: quello che c'era resta finché non si rilegge.
    if (mgMergeApprovalsPreapproved && (Array.isArray(r.preapproved) || !already)) {
      UI.renderPreapproved(mgMergeApprovalsPreapproved, {
        preapproved: r.preapproved || [],
        preapprovedTotal: r.preapprovedTotal,
        onFeedback: (req) => openFeedbackByNum(UI.feedbackNum(req)),
      });
    }
    return n;
  }

  // Un cambiamento nelle fusioni si vede in due posti: il quadrato della scheda
  // aperta e le card della lista (una fusione ferma le colora come un blocco e
  // le porta fra le cose da decidere). Tutti e due, sempre insieme.
  function riflettiFusioni() {
    if (selectedId && allFeedbacks.some((f) => f._id === selectedId)) {
      const fb = allFeedbacks.find((f) => f._id === selectedId);
      renderLivelliRow(fb);
      // Il pannello aperto su un livello si riempie di nuovo: se era il
      // quadrato, dentro c'è una richiesta che potrebbe non esistere più.
      if (livelloAperto) openSidebarLivello(fb, livelloAperto);
    }
    if (dataLoaded) ridisegnaListaAlSuoPosto();
  }

  async function loadChannelLog() {
    if (!mgChannelSection || !isAdmin) return;
    try {
      const r = await sendToMain({ type: ROUTINE_LOG_GET });
      if (!r || r.ok === false) { mgChannelSection.hidden = true; return; }
      renderChannelLog(r.rejections, r.comparisons);
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
  function selectTab(tab) {
    // Cambiando scheda la ricerca si chiude da sola: vedi la scheda scelta.
    if (searchMode) closeSearch({ keepList: true });
    document.querySelectorAll('.mg-tab').forEach((t) => {
      t.classList.toggle('mg-tab--active', t.dataset.tab === tab);
    });
    const isList = LIST_TABS.includes(tab);
    const panelId = isList ? 'panel-list' : `panel-${tab}`;
    document.querySelectorAll('.mg-panel').forEach((p) => {
      p.classList.toggle('mg-panel--active', p.id === panelId);
    });
    if (isList) {
      currentTab = tab;
      // La frase scritta e non ancora partita se ne va con la selezione: si
      // salva finché `selectedId` dice ancora a chi appartiene.
      salvaFraseAutomatico();
      // Cambiando tab si azzera la selezione: il feedback aperto potrebbe non
      // appartenere alla nuova lista.
      selectedId = null;
      mgDetail.hidden = true;
      mgDetailEmpty.hidden = false;
      mgActions.hidden = true;
      mgClarify.hidden = true;
      collassaFrase();
      mgManage.hidden = true;
      if (mgOwnerBar) mgOwnerBar.hidden = true;
      closeSidebar();
      renderList();
    }
  }

  mgTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.mg-tab');
    if (!btn) return;
    selectTab(btn.dataset.tab);
  });

  // Filtro ⭐ della tab Archiviati: ricalcola la lista (la selezione resta).
  if (mgStarFilter) {
    mgStarFilter.addEventListener('change', () => {
      starredOnly = mgStarFilter.checked;
      renderList();
    });
  }

  // Filtro "Bloccati confermati" (Archiviati): mostra solo gli attacchi/spam
  // confermati dall'owner — fuori dai Ricevuti, ispezionabili qui come storico.
  if (mgConfirmedFilter) {
    mgConfirmedFilter.addEventListener('change', () => {
      confirmedOnly = mgConfirmedFilter.checked;
      renderList();
    });
  }

  // ── Allegati immagine cifrati (S1.2) ──────────────────────────────────────
  // Le immagini dei feedback sono cifrate come byte opachi su Storage: un
  // <img src=URL> diretto mostra un allegato rotto. Il main le scarica, decifra
  // (la chiave privata non esce da lì) e torna un data URL mostrabile. Cache
  // per non ri-decifrare la stessa immagine riaprendo il feedback (mappa
  // url → dataUrl | null; null = fallita, non si ritenta).
  // Cache url → { dataUrl, error }: `dataUrl` valorizzato = immagine mostrabile;
  // altrimenti `error` porta il MOTIVO preciso del fallimento (dal main) così il
  // segnaposto può spiegare all'owner perché non la vede (chiave non
  // configurata, decifratura fallita, download non riuscito…) invece di un muto
  // "non disponibile". null = fallita, non si ritenta.
  //
  // `soloDestinatario` viene dal main e NON si butta via: è la differenza fra
  // «qualcosa si è rotto» e «questo allegato è di qualcun altro». Gestione sta
  // nell'elenco delle app accanto a Editor e Feedback, senza nessun filtro,
  // quindi ci arriva qualunque tester e vede le segnalazioni di tutti. Il
  // riquadro dei feedback questa risposta la usa già; qui la si buttava, e la
  // stessa segnalazione, con lo stesso allegato e lo stesso utente, diceva due
  // cose diverse a seconda della pagina da cui la si guardava (#582, giro 6).
  // Il canale è uno solo apposta: la frase la decide lui.
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

  // Sostituisce il segnaposto di ogni <img> di una bolla con l'immagine
  // decifrata (o lo stato "non disponibile"). Il click apre il lightbox con
  // l'immagine GIÀ decifrata (`data-full`), mai con l'URL cifrato. Se la
  // decifratura fallisce, il MOTIVO preciso finisce nel `title` (hover) del
  // segnaposto: un'immagine muta che non si apre non dice all'owner se manca
  // la chiave privata o se il file è corrotto.
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
          // «Non disponibile» fa sembrare un guasto quello che è solo roba di
          // qualcun altro: la stessa frase che il riquadro ha smesso di dire.
          // E non «consegnato»: se quell'allegato sia mai arrivato, da qui Filo
          // non l'ha guardato. Resta l'unica cosa vera in ogni caso, cioè chi
          // lo apre.
          img.alt = soloDestinatario ? '(allegato riservato)' : 'immagine non disponibile';
          if (error) img.title = error;
        }
      });
    });
  }

  // Perché una pillola non si apre, DETTO PRIMA del clic e non dopo.
  // Lo stesso canale che serve le immagini risponde anche qui, e a chi non
  // riceve le segnalazioni risponde subito, senza toccare la rete: chiederglielo
  // costa una domanda già scritta. Senza, la pillola di un allegato che non è
  // suo arriva identica a una che si apre, e il tester lo scopre cliccando.
  // Cache url → { error, soloDestinatario } | null (null = si apre).
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

  // I documenti allegati: al click si scaricano decifrati (stesso canale delle
  // immagini, col tipo dichiarato) e si salvano col nome originale. Se la
  // decifratura fallisce, il motivo finisce nel `title` del link.
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

  // ── Lightbox ──────────────────────────────────────────────────────────────
  // L'immagine a tutta pagina si chiude con Esc, e a schermo intero quel tasto
  // serve anche a uscire. Chi dei due lo prende lo decide una regola sola, in
  // src/content/content.js: qui basta DICHIARARE che il tasto ce lo siamo preso
  // noi (preventDefault + stop), come fa qualunque riquadro sulle pagine di
  // Filo (#514).
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
  // Esc chiude l'immagine aperta a tutta pagina, come ovunque altro in Filo
  // (la home, la pagina dei feedback, il riquadro di segnalazione nei siti).
  // In capture: il visore è l'ultima cosa aperta e sta sopra tutto, quindi
  // l'Esc è suo prima che lo prendano la ricerca o un menu rimasto aperto.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!closeLightbox()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  // ── Utilità date ──────────────────────────────────────────────────────────
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

  // ── Priorità (1-3 pallini) sulle card ─────────────────────────────────────
  // Visibile a colpo d'occhio in "In coda" e "Ricevuti"; modificabile solo
  // dall'owner. Più pallini pieni = priorità più alta → le routine di Claude la
  // affrontano prima. Non mostrata su Risolti/Archiviati (lì non serve agire).
  function priorityHasDots() {
    return currentTab === 'queue' || currentTab === 'inbox';
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

  // Click su un pallino: imposta la priorità = N; ri-clic sul pallino già attivo
  // (== priorità corrente) la azzera. `priorityManual:true` dice al backend che è
  // una scelta dell'owner → il giudice di priorità automatico non la sovrascrive.
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

  // Delegazione: un solo listener per tutta la lista. Il click sul pallino NON
  // deve aprire il dettaglio della card → stopPropagation.
  mgList.addEventListener('click', (e) => {
    const dot = e.target.closest('.mg-dot[data-prio-id]');
    if (!dot) return;
    e.stopPropagation();
    setPriorityFromDot(dot.dataset.prioId, Number(dot.dataset.prioN));
  });

  // ── Menu di ordinamento della lista (tasto destro sull'intestazione) ──────
  // "il tasto destro è centrale" (filo_filosofia): il tasto destro sull'header
  // della colonna apre un box per riordinare i feedback (numero/priorità/
  // creatore). Il glifo ⇅ accanto al titolo è la scorciatoia GUI (click) allo
  // stesso menu, così l'azione è scopribile senza dover indovinare il tasto
  // destro. Riusa le classi .sn-select-pop/.sn-select-option (PATTERNS.md).
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
  // Riflette l'ordinamento attivo sul glifo dell'intestazione (tooltip + stato
  // "non predefinito" evidenziato), così l'owner vede a colpo d'occhio se la
  // lista è riordinata.
  function reflectSortBtn() {
    if (!mgSortBtn) return;
    const active = sortMode !== 'smart';
    mgSortBtn.classList.toggle('mg-sort-btn--active', active);
    mgSortBtn.title = active
      ? `Ordinamento: ${SORT_MODES[sortMode]} — clic o tasto destro per cambiare`
      : 'Riordina i feedback — clic o tasto destro';
  }
  function openSortMenu(x, y) {
    closeSortMenu();
    const menu = document.createElement('div');
    menu.className = 'sn-select-pop mg-ctxmenu';
    menu.setAttribute('role', 'menu');
    for (const mode of ['num', 'priority', 'creator', 'smart']) {
      const opt = document.createElement('div');
      opt.className = 'sn-select-option';
      opt.setAttribute('role', 'menuitemradio');
      const on = mode === sortMode;
      opt.setAttribute('aria-checked', on ? 'true' : 'false');
      if (on) opt.classList.add('sn-selected');
      // ✓ sull'ordinamento attivo; spazio allineato sugli altri.
      opt.textContent = `${on ? '✓ ' : ' '}${SORT_MODES[mode]}`;
      opt.addEventListener('click', () => chooseSort(mode));
      menu.appendChild(opt);
    }
    document.body.appendChild(menu);
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = `${Math.max(4, Math.min(x, vw - w - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, vh - h - 4))}px`;
    sortMenu = menu;
    setTimeout(() => {
      document.addEventListener('mousedown', onSortOutside, true);
      document.addEventListener('keydown', onSortKeydown, true);
      window.addEventListener('scroll', onSortScroll, true);
      window.addEventListener('resize', closeSortMenu);
    }, 0);
  }
  // Tasto destro ovunque sull'intestazione della lista → menu di ordinamento.
  if (mgListHeadRow) {
    mgListHeadRow.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openSortMenu(e.clientX, e.clientY);
    });
  }
  // Click (o Invio/Spazio) sul glifo ⇅ → stesso menu, ancorato al glifo.
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

  // ── Quanti feedback ci sono in ogni scheda (#495) ─────────────────────────
  // Le quattro schede che ELENCANO feedback (Ricevuti, In coda, Risolti,
  // Archiviati) portano il loro numero accanto al nome, come la pagina gemella
  // dei feedback. Le altre quattro (Statistiche, Modelli, Automazioni, Log) non
  // elencano niente: lì un numero non vorrebbe dire nulla e non si scrive.
  // Il conteggio degli Archiviati segue i filtri della colonna (⭐ e "Bloccati
  // confermati"), altrimenti direbbe un numero diverso da quello che si vede.
  // Finché i feedback non sono arrivati (caricamento in corso, o fallito) non
  // si scrive nessun numero: uno "(0)" là dove il dato manca è un numero falso.
  // Il caricamento si ferma ai 500 più recenti: quando li tocca tutti, i numeri
  // diventano "(24+)" — sono minimi, non totali — e l'hover dice perché.
  function loadHitCap() {
    return FB.listHitCap(allFeedbacks, FB.LIST_PAGE_SIZE);
  }

  // ── Quando lo stato non si legge, le sezioni non si disegnano ─────────────
  // La regola sta nel modulo condiviso (MR.sectionsReliable), la stessa che usa
  // la pagina dei feedback: due copie della stessa regola divergono, ed è
  // proprio così che questa pagina è rimasta indietro (#509).
  //
  // Qui non si chiude "la barra" e basta: tutto ciò che questa pagina afferma
  // partendo dallo status — i numeri delle sezioni, il nome della sezione in
  // cima alla colonna, il colore del bordo della scheda ("Non filtrato" è
  // un'affermazione), le barre "Ri-valuta i non filtrati" / "Approva tutti gli
  // allineati", i pulsanti di decisione del dettaglio, la frase accanto ai
  // giudici, la bolla del parere di Filo — passa da una delle due funzioni qui
  // sotto, a seconda che l'affermazione riguardi la lista o una segnalazione.
  function sezioniAttendibili() {
    return MR.sectionsReliable(allFeedbacks);
  }

  // Le due domande sono DIVERSE e vanno tenute separate, altrimenti il difetto
  // rientra dalla porta della coda MISTA:
  //   · sezioniAttendibili() è una domanda sulla LISTA — si può disegnare la
  //     barra delle sezioni? Un solo documento storto non la toglie a tutti.
  //   · statoLeggibile(fb) è una domanda su QUESTA segnalazione — posso
  //     affermare qualcosa sul suo stato? Vale ovunque si parli di UNA
  //     segnalazione: bordo e classe della scheda, riga dell'iter, sottotesto
  //     del motivo, pallini dei giudici, pulsanti del dettaglio, la bolla del
  //     parere di Filo, e i mucchi su cui agiscono le barre in cima ai Ricevuti.
  // È la stessa regola della gemella, che se la fa per ogni segnalazione: farla
  // una volta sola per l'intera lista è ciò che ha fatto divergere le due
  // pagine appena una cifrata capitava in mezzo a tante leggibili (#509).
  function statoLeggibile(fb) {
    return !MR.statusUnreadable(fb);
  }

  // Mostra o nasconde le SEZIONI (le quattro schede-lista) e l'avviso che ne
  // spiega l'assenza. Le altre schede della barra non sono sezioni — Statistiche,
  // Modelli, Automazioni, Log non dipendono dallo stato delle segnalazioni e
  // restano raggiungibili. Ritorna true se le sezioni si possono disegnare.
  function mostraSezioni() {
    const ok = sezioniAttendibili();
    for (const tab of LIST_TABS) {
      const btn = mgTabs.querySelector(`.mg-tab[data-tab="${tab}"]`);
      if (btn) btn.hidden = !ok;
    }
    if (mgNoSections) {
      mgNoSections.hidden = ok;
      if (!ok) mgNoSections.textContent = SENZA_SEZIONI_AVVISO;
    }
    return ok;
  }
  // "(24)" o "(24+)" secondo il tetto: una sola regola per la barra, per
  // l'intestazione della colonna e per la ricerca.
  function countText(n) {
    return FB.countLabel(n, loadHitCap());
  }

  // Intestazione della colonna: nome + quante ne sta mostrando. `n === null`
  // (dato non ancora arrivato, o ricerca non ancora fatta) → solo il nome.
  function setListHead(label, n) {
    if (!mgListHead) return;
    mgListHead.textContent = (n === null || n === undefined)
      ? label
      : `${label} ${countText(n)}`;
    if (n !== null && n !== undefined && loadHitCap()) mgListHead.title = FB.COUNT_CAP_HINT;
    else mgListHead.removeAttribute('title');
    aggiornaSegnoFerma();
  }

  function updateTabCounts() {
    // Sezioni non disegnabili: non c'è niente da numerare. Uscire QUI evita di
    // lasciare "(3) (0) (0) (0)" appiccicato ai bottoni nascosti, pronto a
    // ricomparire al primo dato leggibile che non passa da renderList.
    if (!sezioniAttendibili()) return;
    const counts = dataLoaded
      ? MR.manageTabCounts(allFeedbacks, { releasedVersion, starredOnly, confirmedOnly, fusioni })
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
      if (capped) btn.title = FB.COUNT_CAP_HINT;
      else btn.removeAttribute('title');
      if (!counts) continue;
      const badge = document.createElement('span');
      badge.className = 'mg-tab-count';
      badge.textContent = countText(counts[tab]);
      btn.appendChild(badge);
    }
  }

  // ── Rendering colonna sinistra ────────────────────────────────────────────
  function renderList() {
    mgListLoading.hidden = true;
    mgListEmpty.textContent = TAB_EMPTY[currentTab] || 'Nessun feedback.';

    // Stato illeggibile → niente sezioni: un elenco solo, i più recenti in cima,
    // come la gemella. Nessun nome di sezione in cima alla colonna e nessun
    // filtro di sezione: sono tutti criteri che qui non si possono applicare.
    const sezioni = mostraSezioni();
    if (!sezioni) {
      if (mgArchiveFilter) mgArchiveFilter.hidden = true;
      currentList = applySortMode(allFeedbacks.slice().sort((a, b) =>
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
      mgListEmpty.textContent = TAB_EMPTY.inbox;
      setListHead(SENZA_SEZIONI_LABEL, dataLoaded ? currentList.length : null);
      renderListBody();
      renderFusioniOrfane();
      return;
    }

    // Il filtro ⭐ esiste solo nella tab Archiviati (DB2).
    const isArchived = currentTab === 'archived';
    if (mgArchiveFilter) mgArchiveFilter.hidden = !isArchived;

    // Sottoinsieme della tab corrente, ordinato (logica pura condivisa).
    if (isArchived) {
      // OFF = solo i feedback `archived`; ON = tutti i preferiti ⭐ (ogni stato).
      // Il filtro "Bloccati confermati" (solo attacchi/spam confermati) è dentro
      // listArchiveTab: la stessa funzione conta la scheda, così il numero non
      // può discostarsi dalla lista.
      currentList = MR.listArchiveTab(allFeedbacks, { starredOnly, confirmedOnly });
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
      currentList = MR.listForManageTab(allFeedbacks, currentTab, { releasedVersion, fusioni });
    }

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
    // Chi è "senza feedback" dipende da quali feedback ci sono: quando la lista
    // cambia, l'elenco in Automazioni si rifà — altrimenti una richiesta
    // resterebbe lì anche dopo che la sua scheda è arrivata, e si leggerebbe
    // due volte.
    renderFusioniOrfane();
  }

  // Questa segnalazione ha una fusione ferma che aspetta l'owner?
  function fusioneFerma(fb) {
    return MR.fusioneInAttesa(fb, { fusioni });
  }

  // Le segnalazioni con una fusione ferma davanti a tutte, conservando fra loro
  // l'ordine che avevano (`sort` è stabile).
  function pinFusioniFerme(lista) {
    return lista.slice().sort((a, b) => (fusioneFerma(b) ? 1 : 0) - (fusioneFerma(a) ? 1 : 0));
  }

  // Disegna la colonna a partire da `currentList`: è la parte che NON dipende
  // da quale sezione si sta guardando, e la condivide anche l'elenco unico di
  // quando le sezioni non ci sono.
  function renderListBody() {
    // Col caricamento al tetto una sezione "vuota" può non esserlo davvero: i
    // feedback più vecchi non sono qui. Il vuoto lo dice, invece di negarli.
    if (loadHitCap() && dataLoaded) {
      mgListEmpty.textContent = `${mgListEmpty.textContent} ${FB.COUNT_CAP_HINT}`;
    }

    // Barra "Ri-valuta i non filtrati": compare solo nei Ricevuti quando c'è
    // almeno un feedback bianco (panel parziale) da ri-valutare.
    updateReevalBar();
    // Barra "Approva tutti gli allineati": è QUI che l'owner mette in coda in
    // blocco i blu (scrive `todo` su ciascuno).
    updateAlignedBar();

    // Svuota SEMPRE: se la lista torna vuota (es. dopo uno sblocco) non deve
    // restare la card vecchia in un contenitore nascosto.
    mgList.innerHTML = '';

    // Dato non arrivato (caricamento in corso, o fallito): il riquadro vuoto non
    // può dire "qui non c'è niente", perché non lo sappiamo. È la stessa cautela
    // dei numeri sulle schede (#495), applicata alle parole.
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

    // Stato illeggibile: il bordo colorato, la riga dell'iter e il sottotesto
    // del motivo sono tutte AFFERMAZIONI sullo stato. Su una segnalazione
    // cifrata la macchina le ricava da un `unlabeled` finto: ogni scheda
    // diventerebbe bianca ("Non filtrato") anche se è già chiusa.
    const sezioni = sezioniAttendibili();

    for (const fb of currentList) {
      // La domanda "questo stato si legge?" è di QUESTA scheda, non della lista
      // (vedi statoLeggibile): in una coda mista basta un documento cifrato in
      // mezzo a mille leggibili perché le sezioni restino — ed è proprio lì che
      // la scheda cifrata tornava a dirsi "Non filtrato".
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
      const progress = (leggibile && currentTab === 'queue') ? MR.workProgress(fb) : null;
      item.className = 'mg-item'
        + (fb._id === selectedId ? ' mg-item--selected' : '')
        + unfilteredCls
        + alignedCls
        + (progress ? ' mg-item--staged' : '')
        + (progress && progress.active ? ' mg-item--active-work' : '');
      item.dataset.id = fb._id;
      // Una fusione ferma aspetta l'owner quanto un blocco: stessa tinta rossa
      // e stesso peso, così si riconosce scorrendo la lista.
      const ferma = fusioneFerma(fb);
      if (ferma) item.classList.add('mg-item--fusione');
      const arrivata = arrivate.has(String(fb._id));
      if (arrivata) item.classList.add('mg-item--arrivata');
      item.style.borderLeftColor = ferma
        ? MR.REASONS.secaudit.color
        : (cl ? cl.color : (aligned ? MR.ALIGNED_COLOR : 'transparent'));
      // Una riga sola: #N · titolo (ellissi). Il motivo (attacco/spam/…) resta
      // implicito nel colore del border-left; il titolo completo nel tooltip,
      // col sottotesto dello stato (statusReason: loop, clarify, …) se presente.
      const norm = leggibile ? MR.normalizeStatus(fb) : { status: null, statusReason: null };
      // Quante volte questo lavoro si è arenato ed è rientrato in coda da solo.
      // Senza scriverlo da qualche parte, un feedback che si impianta sempre
      // sullo stesso scoglio sembra semplicemente lento.
      // `stalls` è il totale che non si azzera mai; `workingResets` è il
      // contatore operativo del freno, che una consegna vera riporta a zero —
      // leggere quello faceva sparire il numero proprio quando la pratica esce
      // dal giro automatico, cioè quando all'owner serve.
      const ripartenze = Math.max(0, Math.round(
        Number(fb.stalls) || Number(fb.workingResets) || 0
      ));
      item.title = (num ? `#${num} · ` : '') + title
        + (norm.statusReason ? ` — ${MR.reasonText(norm.statusReason)}` : '')
        + (ferma ? ' — una fusione aspetta il tuo via libera' : '')
        + (arrivata ? ' — arrivata qui mentre la pagina era aperta' : '')
        + (ripartenze ? ` · rientrato in coda ${ripartenze} volt${ripartenze === 1 ? 'a' : 'e'}` : '');
      const rowHtml = `
        ${authorIconHtml(fb)}
        ${num ? `<span class="mg-item-num">#${esc(num)}</span>` : ''}
        <span class="mg-item-title">${esc(title)}</span>
        ${ferma ? '<span class="mg-fusione-badge" title="Una fusione aspetta il tuo via libera">fusione ferma</span>' : ''}
        ${leggibile ? '' : statePublicHtml(fb)}
        ${preapprovedHtml(fb)}
        ${priorityDotsHtml(fb)}
      `;
      item.innerHTML = progress
        ? `<div class="mg-item-row">${rowHtml}</div>${workStateHtml(progress)}`
        : rowHtml;
      item.addEventListener('click', (e) => {
        // Il click su un pallino priorità non apre il dettaglio (lo gestisce il
        // listener delegato di mgList).
        if (e.target.closest('.mg-dot')) return;
        openDetail(fb._id);
      });
      mgList.appendChild(item);
    }
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

  // ── «Fondi senza chiedermelo» ─────────────────────────────────────────────
  // Il segno sulla pratica: `mergePreapproved { by, at }`, in chiaro. Conta
  // solo finché la pratica è aperta (a pratica chiusa il server non lo guarda,
  // e qui non si mostra: sarebbe un'informazione su niente).
  // Due specie di segno (SN_MERGE_APPROVALS.segnoPreapprovazione): quello a mano
  // copre tutto, quello nato da un sì a una richiesta solo i blocchi già approvati.
  function preapprovedOf(fb) {
    const m = fb && fb.mergePreapproved;
    if (!m || typeof m !== 'object' || !String(m.by || '').trim()) return null;
    const UI = window.SN_MERGE_APPROVALS;
    if (UI && UI.segnoPreapprovazione) return UI.segnoPreapprovazione(m);
    return { tipo: 'pieno', by: String(m.by || ''), at: String(m.at || '') };
  }
  function preapprovatoPieno(fb) {
    const m = preapprovedOf(fb);
    return !!(m && m.tipo === 'pieno');
  }
  function isOpenPublic(fb) {
    return String((fb && fb.statusPublic) || 'open') !== 'closed';
  }
  function preapprovedHtml(fb) {
    const m = preapprovedOf(fb);
    if (!m || !isOpenPublic(fb)) return '';
    const UI = window.SN_MERGE_APPROVALS;
    const t = (UI && UI.segnoTesti) ? UI.segnoTesti(m)
      : { etichetta: 'senza chiedere', titolo: `Si fonde senza chiedere: segno messo da ${m.by}` };
    const cls = m.tipo === 'approvazione' ? 'mg-preapproved mg-preapproved--blocchi' : 'mg-preapproved';
    return `<span class="${cls}" title="${esc(t.titolo)}">${esc(t.etichetta)}</span>`;
  }

  // ── Riga di stato della lavorazione (card pinnate + dettaglio) ────────────
  // Traduce l'avanzamento (MR.workProgress) in una riga leggibile: i tre
  // passaggi dell'iter come spunte (✓ fatto · ● in corso · ○ da fare) e se
  // un'istanza ci sta lavorando in questo momento.
  function workStateHtml(progress) {
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
    const who = progress.active
      ? `<span class="mg-work-live"><i></i>Un'istanza ci sta lavorando ora</span>`
      : `<span class="mg-work-idle">${
          progress.current.key === 'impl'
            ? 'Nessuna istanza al lavoro: rientra in coda da solo'
            : 'Nessuna istanza al lavoro: in attesa di un verificatore'
        }</span>`;
    return `<div class="mg-item-state">${steps}${who}</div>`;
  }

  // ── Ri-valutazione dei feedback "non filtrati" (panel parziale) ───────────
  // Un feedback è "non filtrato" (bianco) quando il panel dei giudici è rimasto
  // parziale. Il bottone ne ri-prova SOLO i giudici mancanti (lato backend).
  function isUnfiltered(fb) {
    // "Non filtrato" è una lettura dello status: su una cifrata la macchina la
    // inventa (unlabeled finto) e la segnalazione finiva nel mucchio da
    // rimandare ai giudici — crediti spesi per ri-giudicare una pratica che
    // potrebbe essere già chiusa.
    if (!statoLeggibile(fb)) return false;
    const cl = MR.classifyBlock(fb);
    return !!(cl && cl.reason === 'unfiltered');
  }
  function unfilteredFeedbacks() {
    return allFeedbacks.filter(isUnfiltered);
  }
  function setReevalMsg(text, kind) {
    if (!mgReevalMsg) return;
    mgReevalMsg.textContent = text || '';
    mgReevalMsg.className = 'mg-reeval-msg' + (kind ? ` mg-${kind}` : '');
  }
  function updateReevalBar() {
    if (!mgReevalBar) return;
    // Senza il criterio non c'è nessun "bianco": ogni segnalazione cifrata
    // ricadrebbe lì, e la barra offrirebbe di ri-giudicare anche i chiusi.
    const whites = sezioniAttendibili() ? unfilteredFeedbacks() : [];
    // Solo l'owner, solo nei Ricevuti (dove vivono i bianchi), solo se ce n'è.
    const show = isAdmin && currentTab === 'inbox' && whites.length > 0;
    mgReevalBar.hidden = !show;
    if (show && mgReevalBtn) mgReevalBtn.textContent = `Ri-valuta i non filtrati (${whites.length})`;
  }

  // ── Approvazione in blocco degli allineati (macchina a stati) ─────────────
  // L'approvazione È scrivere `todo`: la modalità automatica di oggi non sposta
  // più nulla nelle liste, quindi i blu si mettono in coda da qui (o uno a uno
  // dal dettaglio).
  function alignedFeedbacks() {
    // Stesso motivo dei bianchi: "allineato" è una lettura dello status, e
    // approvare in blocco quello che non si è potuto leggere è la scrittura
    // più pesante della pagina.
    if (!sezioniAttendibili()) return [];
    return allFeedbacks.filter((f) => statoLeggibile(f) && MR.isAligned(f));
  }
  function updateAlignedBar() {
    if (!mgAlignedBar) return;
    const blues = alignedFeedbacks();
    const show = isAdmin && currentTab === 'inbox' && blues.length > 0;
    mgAlignedBar.hidden = !show;
    if (show && mgAlignedBtn) mgAlignedBtn.textContent = `Approva tutti gli allineati (${blues.length}) → In coda`;
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
  // Evidenzia la card di un feedback come "in valutazione" (animazione giudici)
  // e la porta in vista; ritorna l'elemento card (o null se non è nella lista).
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

  // Ri-valuta i "non filtrati" UNO ALLA VOLTA: scorre i bianchi in sequenza,
  // accende l'animazione sulla card di turno, invia il singolo id ai giudici,
  // attende l'esito e passa al successivo. Così l'owner vede esattamente quale
  // feedback i giudici stanno valutando in questo momento.
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
        // Giudici ri-eseguiti ma nessuno recuperato: crediti spesi, feedback
        // ancora bianco. `errorKind` dice PERCHÉ (es. credito esaurito). Se càpita
        // più volte di fila è quasi certo un problema strutturale: fermati per non
        // bruciare crediti/tempo sul resto della lista.
        if (errorKind) lastErrorKind = errorKind;
        wasteStreak += 1;
        if (wasteStreak >= MR.REEVAL_WASTE_LIMIT) { stopped = 'nofix'; break; }
      }
      // 'noop' (niente da fare): non spende crediti, prosegui.
    }

    // Causa specifica (credito/chiave/modelli/timeout) se i giudici non hanno
    // recuperato nulla: vince sul generico, così l'owner sa cosa sistemare.
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

  // ── Ricerca "a senso" (semantica) ─────────────────────────────────────────
  // La lente in fondo alla barra delle schede apre un campo dove descrivere, con
  // parole proprie (anche un ricordo vago), il feedback da ritrovare. Un modello
  // legge titolo+testo di TUTTI i feedback (qualunque scheda) e li ordina per
  // pertinenza al significato della richiesta. I risultati rimpiazzano la lista a
  // sinistra; il dettaglio al centro si apre come al solito. Se il modello non è
  // disponibile o risponde male, si RIPIEGA su una ricerca per parole (la ricerca
  // non si rompe mai). La logica pura (candidati, prompt, parsing, ripiego) vive
  // in SN_MANAGE_SEARCH per essere testabile senza aprire Electron.
  function toggleSearchIcon(on) {
    if (!mgSearchToggle) return;
    mgSearchToggle.classList.toggle('mg-search-toggle--active', on);
    mgSearchToggle.setAttribute('aria-expanded', on ? 'true' : 'false');
  }

  function setSearchMsg(text, kind) {
    if (!mgSearchMsg) return;
    mgSearchMsg.textContent = text || '';
    mgSearchMsg.classList.toggle('mg-err', kind === 'err');
  }

  // Nasconde le barre specifiche della scheda (filtro archivio, ri-valuta,
  // approva allineati): durante la ricerca la lista è "trasversale" alle schede.
  function hideTabBars() {
    if (mgArchiveFilter) mgArchiveFilter.hidden = true;
    if (mgReevalBar)     mgReevalBar.hidden = true;
    if (mgAlignedBar)    mgAlignedBar.hidden = true;
  }

  function openSearch() {
    searchMode = true;
    if (mgSearchBar) mgSearchBar.hidden = false;
    toggleSearchIcon(true);
    setSearchMsg('', null);
    // La lista mostra un invito finché non si cerca davvero: nessun numero,
    // perché non c'è ancora niente da contare (#495).
    setListHead('Ricerca', null);
    hideTabBars();
    mgListLoading.hidden = true;
    mgList.hidden = true;
    mgList.innerHTML = '';
    mgListEmpty.hidden = false;
    mgListEmpty.textContent = 'Scrivi cosa cerchi e premi Invio.';
    if (mgSearchInput) { try { mgSearchInput.focus(); } catch (_) {} }
  }

  // keepList=true quando è il chiamante a ridisegnare subito la lista (es. il
  // cambio scheda): evita un doppio renderList.
  function closeSearch(opts) {
    const keepList = !!(opts && opts.keepList);
    searchSeq++;               // invalida ricerche eventualmente in volo
    searchMode = false;
    if (mgSearchBar) mgSearchBar.hidden = true;
    if (mgSearchInput) mgSearchInput.value = '';
    toggleSearchIcon(false);
    setSearchMsg('', null);
    if (!keepList) renderList();
  }

  // Disegna i risultati (ordinati per pertinenza) al posto della lista. `reason`
  // (il perché è pertinente) vive nel tooltip, non nel colore del bordo.
  function renderSearchResults(results, opts) {
    const fallback = !!(opts && opts.fallback);
    hideTabBars();
    mgListLoading.hidden = true;
    mgList.innerHTML = '';
    setSearchMsg(fallback ? 'Modello non disponibile: mostro i risultati per testo.' : '', null);

    // "Nessun risultato" al tetto del caricamento significa "nessuno fra quelli
    // caricati": la ricerca legge solo i feedback che stanno in pagina.
    const nessuno = () => {
      mgList.hidden = true;
      mgListEmpty.hidden = false;
      mgListEmpty.textContent = 'Nessun feedback pertinente.'
        + (loadHitCap() ? ` ${FB.COUNT_CAP_HINT}` : '');
    };

    if (!results.length) {
      // Quanti ne ha trovati è esattamente la domanda della ricerca: zero è una
      // risposta, e si scrive come le altre (#495).
      setListHead('Ricerca', 0);
      nessuno();
      return;
    }
    mgListEmpty.hidden = true;
    mgList.hidden = false;
    let shown = 0;
    for (const res of results) {
      const fb = allFeedbacks.find((f) => f._id === res.id);
      if (!fb) continue;
      shown++;
      const num = FB.formatNum(fb.seq, fb.subSeq);
      const title = fb.name || FB.fallbackName(fb.text) || '(senza titolo)';
      const item = document.createElement('div');
      item.className = 'mg-item mg-item--result' + (fb._id === selectedId ? ' mg-item--selected' : '');
      item.dataset.id = fb._id;
      const reason = String(res.reason || '').trim();
      item.title = (num ? `#${num} · ` : '') + title + (reason ? ` — ${reason}` : '');
      item.innerHTML = `
        ${authorIconHtml(fb)}
        ${num ? `<span class="mg-item-num">#${esc(num)}</span>` : ''}
        <span class="mg-item-title">${esc(title)}</span>
      `;
      item.addEventListener('click', () => openDetail(fb._id));
      mgList.appendChild(item);
    }
    // Il numero è quello delle card DAVVERO disegnate: un risultato il cui
    // feedback non è più fra i caricati non viene mostrato, e non va contato.
    setListHead('Ricerca', shown);
    if (!shown) nessuno();
  }

  async function runSearch(rawQuery) {
    if (!searchMode || !SRCH) return;
    const query = String(rawQuery || '').trim();
    if (!query) {
      // Campo svuotato: torna all'invito — e il numero se ne va con i risultati.
      setListHead('Ricerca', null);
      mgList.hidden = true; mgList.innerHTML = '';
      mgListEmpty.hidden = false; mgListEmpty.textContent = 'Scrivi cosa cerchi e premi Invio.';
      setSearchMsg('', null);
      return;
    }
    const my = ++searchSeq;
    const candidates = SRCH.buildCandidates(allFeedbacks);
    if (!candidates.length) {
      renderSearchResults([], { fallback: false });
      setSearchMsg('Nessun feedback da cercare.', null);
      return;
    }

    // Stato "sto cercando": via il numero della ricerca precedente, che qui
    // sarebbe già falso.
    setListHead('Ricerca', null);
    hideTabBars();
    mgListLoading.hidden = true;
    mgList.hidden = true; mgList.innerHTML = '';
    mgListEmpty.hidden = false; mgListEmpty.textContent = 'Cerco…';
    setSearchMsg('', null);

    const validIds = new Set(candidates.map((c) => c.id));
    let ranked = null;
    try {
      const r = await sendToMain({
        type: (window.SN_MSG && window.SN_MSG.MSG && window.SN_MSG.MSG.AI_REQUEST) || 'ai_request',
        // Funzione propria: prima questa ricerca prendeva in prestito il modello
        // di «Categorizza», quindi cambiarne uno cambiava anche l'altra senza
        // che si vedesse. Come quella, non è "style-aware" (il prompt JSON non
        // viene inquinato dallo stile di scrittura) e resta fuori dalla
        // cronologia.
        action: (window.SN_CONST && window.SN_CONST.ACTIONS && window.SN_CONST.ACTIONS.MANAGE_SEARCH) || 'manage_search',
        payload: { messages: SRCH.buildMessages(query, candidates) },
      });
      if (r && r.ok && typeof r.text === 'string') {
        const parsed = SRCH.parseRanking(r.text, validIds);
        if (parsed.length) ranked = parsed;
      }
    } catch (_) { /* ripiego per parole qui sotto */ }

    // Superata da una ricerca più recente o chiusa nel frattempo: non toccare la UI.
    if (my !== searchSeq || !searchMode) return;

    if (ranked) {
      renderSearchResults(ranked, { fallback: false });
    } else {
      // Ripiego per parole: la ricerca trova comunque qualcosa.
      renderSearchResults(SRCH.keywordSearch(allFeedbacks, query), { fallback: true });
    }
  }

  if (mgSearchToggle) {
    mgSearchToggle.addEventListener('click', () => {
      if (searchMode) closeSearch();
      else openSearch();
    });
  }
  if (mgSearchClose) mgSearchClose.addEventListener('click', () => closeSearch());
  if (mgSearchInput) {
    mgSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); runSearch(mgSearchInput.value); }
      else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
    });
  }
  // Esc chiude la ricerca anche quando il focus non è nel campo (es. dopo aver
  // cliccato un risultato). Idempotente: se la ricerca è già chiusa non fa nulla.
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
    // Quello che c'è nella casella della frase e non è ancora partito parte
    // ADESSO, finché `selectedId` è ancora quello di prima: un istante dopo
    // andrebbe a finire sul feedback sbagliato, o in nessun posto.
    if (!ridisegno) salvaFraseAutomatico();
    // Cambiando segnalazione il pannello di destra riparte da zero: la forma
    // scelta era di un'altra pratica. Su un ridisegno resta dov'era.
    if (!ridisegno) livelloAperto = null;
    selectedId = id;
    // Aperta dall'owner: l'arrivo l'ha visto.
    const eraArrivata = !ridisegno && arrivate.delete(String(id));

    // Aggiorna selezione visiva nella lista
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

    // Lo stato di QUESTA segnalazione si legge? Tutto ciò che il pannello dice
    // e offre a partire dallo stato passa da qui — la stessa regola della barra
    // delle sezioni, un gradino più in dentro.
    const leggibile = statoLeggibile(fb);

    // Intestazione
    const clientId = fb.clientId || 'anonimo';
    const dateStr  = formatDate(fb.createdAt);
    // Chi ha scritto, in chiaro (#443): l'identificativo grezzo diceva
    // "filo:chat" dove serviva leggere "Filo, per conto di un utente". Resta
    // ispezionabile passandoci sopra e nel pannello del mittente.
    mgDetailHead.innerHTML = `Da <a class="mg-sender-link" id="senderLink" href="#" data-client="${esc(clientId)}" title="${esc(clientId)}">${esc(senderLabel(fb))}</a> il ${dateStr}`;
    document.getElementById('senderLink').addEventListener('click', (e) => {
      e.preventDefault();
      openSidebarSender(clientId);
    });

    // La fila dei cinque livelli: triangolo, cerchi, rombo, pentagono,
    // quadrato. Ogni forma cliccata si apre nel pannello di destra.
    renderLivelliRow(fb);

    // Striscia "a che punto è la lavorazione" (solo per i feedback nell'iter
    // working/revision_*): stessi contenuti della card pinnata in lista.
    if (mgWorkState) {
      const progress = leggibile ? MR.workProgress(fb) : null;
      mgWorkState.hidden = !progress;
      mgWorkState.innerHTML = progress ? workStateHtml(progress) : '';
    }

    // Bolle chat
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
    // La casella e il rombo verde della fila nascono dalla stessa domanda.
    const isClarify = leggibile && MR.aspettaRisposta(fb);
    renderActions(fb);
    mgClarify.hidden = !(isAdmin && isClarify);
    mgClarifyText.value = '';
    setClarifyMsg('', '');

    // Gestione (⭐ + archivia/ripristina): visibile per l'owner su QUALUNQUE
    // feedback selezionato, accanto alle azioni contestuali.
    // La frase per chi ha segnalato: su qualunque feedback, anche già chiuso.
    // E' in chiaro, quindi si legge e si scrive anche su una macchina senza
    // la chiave privata — al contrario del resto della conversazione.
    // La barra sta in piedi per l'owner e per nessun altro: dentro ci sono
    // solo cose sue. Le azioni di stato che ci vivono spariscono da sole
    // quando lo stato non si legge (renderActions); preferito e frase no.
    if (mgOwnerBar) mgOwnerBar.hidden = !isAdmin;

    // La frase parte CHIUSA su ogni segnalazione (#497): si scrive una volta
    // sola, e da aperta si mangiava una fetta di dettaglio a ogni feedback
    // aperto. Il tasto della barra la apre, e dice se una frase c'è già.
    // Su un ridisegno però la sezione resta com'era: se l'owner l'aveva
    // aperta, un aggiornamento arrivato da remoto non gliela chiude in faccia.
    if (mgUserNote) {
      const restaAperta = ridisegno && !mgUserNote.hidden;
      if (!restaAperta) collassaFrase();
      mgUserNoteText.value = String(fb.userNote || '');
      riflettiFrase(mgUserNoteText.value);
      // Il valore con cui la riga è stata riempita: una bozza è ciò che differisce.
      mgUserNoteText.dataset.saved = mgUserNoteText.value;
      userNoteToccata = false;
      // Il salvataggio di un ALTRO feedback può essere ancora in volo: il
      // bottone è uno solo, e lasciarlo spento qui bloccherebbe una scrittura
      // che con quell'attesa non c'entra niente.
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
    // Cambiando pratica si chiude, come sempre.
    if (ridisegno && livelloAperto) riapriPannelloLivello(fb);
    else closeSidebar();
  }

  // Riapre il pannello sulla forma già scelta, tenendo il punto di scorrimento.
  function riapriPannelloLivello(fb) {
    const scrolls = [mgSideBody, mgSide].map((el) => (el ? el.scrollTop : 0));
    if (livelloAperto === 'l2' && giudiceAperto != null) openSidebarJudge(fb, giudiceAperto);
    else openSidebarLivello(fb, livelloAperto);
    [mgSideBody, mgSide].forEach((el, i) => { if (el) el.scrollTop = scrolls[i]; });
  }

  // Riflette lo stato corrente del feedback sul bottone ⭐. Il preferito è un
  // flag in chiaro, indipendente dallo stato: resta anche su una segnalazione
  // che questa macchina non riesce a leggere. Archivia/Ripristina invece è
  // un'AZIONE DI STATO e vive nella riga generata da renderActions.
  function reflectManage(fb) {
    mgStarBtn.disabled = false;
    const starred = MR.isStarred(fb);
    mgStarBtn.setAttribute('aria-pressed', starred ? 'true' : 'false');
    mgStarBtn.textContent = starred ? '★ Preferito' : '☆ Preferito';
    mgStarBtn.title = starred ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti';
    reflectPreapproved(fb);
  }

  // Il tasto «Fondi senza chiedermelo» e la riga che dice chi ha messo il
  // segno. Sulle pratiche chiuse il tasto sparisce: il segno lì non conta.
  function reflectPreapproved(fb) {
    if (!mgPreapproveBtn) return;
    const segno = preapprovedOf(fb);
    // L'interruttore è acceso solo col segno pieno: quello da approvazione non
    // fonde i blocchi nuovi, e un clic lo fa diventare pieno.
    const m = segno && segno.tipo === 'pieno' ? segno : null;
    const aperta = isOpenPublic(fb);
    mgPreapproveBtn.disabled = false;
    mgPreapproveBtn.hidden = !aperta;
    if (mgPreapproveLine) mgPreapproveLine.hidden = !aperta;
    mgPreapproveBtn.setAttribute('aria-pressed', m ? 'true' : 'false');
    mgPreapproveBtn.textContent = m ? 'Chiedimi prima di fondere' : 'Fondi senza chiedermelo';
    mgPreapproveBtn.title = m
      ? 'Oggi il lavoro delle automazioni su questa pratica si fonde da solo anche se i controlli lo fermano. Toglilo per tornare a ricevere la richiesta da approvare.'
      : 'Se i controlli di sicurezza fermano il lavoro delle automazioni su questa pratica, il server fonde lo stesso, senza aspettare il tuo click. Quello che era stato fermato lo trovi poi in Automazioni.';
    if (mgPreapprovedInfo) {
      const UI = window.SN_MERGE_APPROVALS;
      mgPreapprovedInfo.hidden = !(segno && aperta);
      mgPreapprovedInfo.textContent = !(segno && aperta) ? ''
        : m ? `Si fonde senza chiedere: segno messo da ${m.by}${m.at ? ` il ${formatDateTime(m.at)}` : ''}.`
          : UI.segnoTesti(segno).riga;
    }
  }

  // Mette o toglie il segno. Il CHI lo scrive il main dalla sessione: da qui
  // parte solo sì/no.
  async function togglePreapproved() {
    if (!selectedId || !mgPreapproveBtn) return;
    const id = selectedId;
    const fb = allFeedbacks.find((f) => f._id === id);
    if (!fb) return;
    const UI = window.SN_MERGE_APPROVALS;
    const next = UI && UI.segnoAlClic ? UI.segnoAlClic(preapprovedOf(fb)) : !preapprovedOf(fb);
    mgPreapproveBtn.disabled = true;
    setManageMsg(next ? 'Segno la pratica…' : 'Tolgo il segno…', '');
    try {
      const r = await sendToMain({ type: 'feedback_update', id, mergePreapproved: next });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'aggiornamento rifiutato');
      // Il documento vero porta l'email della sessione; qui basta che il segno
      // ci sia, e l'aggiornamento continuo porterà il resto.
      fb.mergePreapproved = next ? { by: (r && r.by) || 'te', at: new Date().toISOString() } : undefined;
      if (selectedId !== id) { renderList(); return; }
      reflectPreapproved(fb);
      renderList();
      let testo = next ? 'Da ora si fonde senza chiedere.' : 'Da ora ti chiede prima di fondere.';
      let kind = 'ok';
      if (next) {
        // Il segno messo con una richiesta già ferma davanti: si fonde adesso,
        // anche quella aperta per i soli blocchi nuovi, che l'owner ha sotto gli occhi.
        const avvia = () => setManageMsg(testo + ' Chiedo al server di fondere la richiesta ferma…', '');
        dimenticaTentativi(fb);
        for (const { msg } of await fondiCoperte(fb, { ancheNuovi: true, avvia })) {
          testo += ` Fusione ferma su questa pratica: ${msg.text}`;
          if (msg.kind !== 'ok') kind = 'err';
        }
      }
      if (selectedId !== id) return;
      setManageMsg(testo, kind);
    } catch (e) {
      // Un rifiuto va detto anche se intanto hai aperto un'altra pratica: il
      // segno che credevi messo non c'è, e senza questa riga nessuno lo sa.
      const altrove = selectedId !== id && FB && typeof FB.formatNum === 'function';
      const dove = altrove ? ` (#${FB.formatNum(fb.seq, fb.subSeq)})` : '';
      setManageMsg(`Segno non messo${dove}: ${e.message || 'Errore'}`, 'err');
    } finally {
      mgPreapproveBtn.disabled = false;
    }
  }
  if (mgPreapproveBtn) mgPreapproveBtn.addEventListener('click', togglePreapproved);

  // L'etichetta di stato NON si scrive più nel dettaglio (scelta owner
  // 2026-09-13): lo stato lo dicono il colore della scheda in lista e le
  // forme, e la decisione già presa — attacco confermato, bocciatura della
  // sicurezza — si legge nel pannello del triangolo (MR.righeStato).

  // ── Le azioni di stato: una riga GENERATA dalla tabella condivisa ─────────
  // Ogni azione ha un id stabile, così resta indirizzabile da fuori. Archivia e
  // Ripristina condividono l'id perché sono i due versi della STESSA azione, e
  // non compaiono mai insieme: nella sezione Archiviati esiste solo il
  // ripristino — così non c'è più un cammino che riscrive uno stato terminale
  // (attacco/spam confermato) con "archiviato", cancellando la conferma.
  const ACTION_BTN_ID = {
    accept: 'mgAcceptBtn',
    confirm_attack: 'mgConfirmBtn',
    confirm_spam: 'mgConfirmSpamBtn',
    archive: 'mgArchiveBtn',
    restore: 'mgArchiveBtn',
    resolve: 'mgResolveBtn',
    reopen: 'mgReopenBtn',
  };
  const ACTION_TITLE = {
    accept: 'Approva la segnalazione e mettila in coda di lavorazione',
    confirm_attack: 'Conferma che è un attacco: esce dai Ricevuti e resta consultabile negli Archiviati',
    confirm_spam: 'Conferma che è spam: esce dai Ricevuti e resta consultabile negli Archiviati',
    archive: 'Sposta la segnalazione negli archiviati',
    restore: 'Riporta la segnalazione in coda',
    resolve: 'Chiudi la segnalazione a mano',
    reopen: 'Riapri spiegando cosa manca ancora',
  };
  const ACTION_PROGRESS = {
    accept: 'Metto in coda…',
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
    setActionMsg('', '');
    mgActionsRow.querySelectorAll('button').forEach((b) => b.remove());
    const azioni = (isAdmin && fb) ? MR.ownerActions(fb, { releasedVersion }) : [];
    mgActions.hidden = !azioni.length;
    if (!azioni.length) {
      if (mgAcceptComment) mgAcceptComment.hidden = true;
      return;
    }
    // Il commento di revisione accompagna le decisioni sui Ricevuti (è ciò che
    // l'owner scrive quando approva o conferma un blocco). Altrove non c'è
    // niente da commentare e la casella sarebbe solo rumore.
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
      b.title = ACTION_TITLE[a.key] || a.label;
      b.addEventListener('click', () => {
        // "Riapri" non scrive subito: chiede prima cosa manca ancora.
        if (a.kind === 'reopen') { apriRiapertura(); return; }
        applyAction(a, null);
      });
      mgActionsRow.appendChild(b);
    }
  }

  // Una scrittura in volo spegne TUTTA la riga, non solo il bottone premuto:
  // «Archivia» premuto mentre «→ In coda» è ancora in volo scriverebbe due
  // decisioni sulla stessa segnalazione.
  function setActionsBusy(busy) {
    if (mgActionsRow) mgActionsRow.querySelectorAll('button').forEach((b) => { b.disabled = !!busy; });
    if (mgReopenConfirm) mgReopenConfirm.disabled = !!busy;
    if (mgReopenCancel) mgReopenCancel.disabled = !!busy;
  }

  // Il cammino UNICO di ogni azione di stato del pannello.
  async function applyAction(action, extra) {
    if (!selectedId || !action) return;
    const id = selectedId;
    const fb = allFeedbacks.find((f) => f._id === id);
    if (!fb) return;
    // Il guardiano sta SOTTO ai pulsanti, non accanto: si scrive solo uno stato
    // che la segnalazione offre in questo momento. Un pannello rimasto aperto
    // mentre lo stato cambiava scriverebbe altrimenti una decisione che la
    // pagina non offre più — ed è esattamente così che un attacco confermato si
    // ritrovava riscritto ad "archiviato", senza avviso.
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
    // Nell'attesa l'owner può essere passato a un'altra segnalazione: l'azione
    // era per questa, e qui si ferma.
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
    // Archiviazione/ripristino a mano = scelta esplicita: vince per sempre
    // sull'auto-archiviazione a punteggio (DC3), in un verso e nell'altro.
    if (action.kind === 'archive') { payload.archiveOverride = 'archived'; locale.archiveOverride = 'archived'; }
    if (action.kind === 'restore') { payload.archiveOverride = 'keep_open'; locale.archiveOverride = 'keep_open'; }
    if (extra && typeof extra.notes === 'string') { payload.notes = extra.notes; locale.notes = extra.notes; }

    setActionsBusy(true);
    setActionMsg(ACTION_PROGRESS[action.key] || 'Salvo…', '');
    try {
      const r = await sendToMain(payload);
      if (!r || r.ok === false) throw new Error((r && r.error) || 'aggiornamento rifiutato');
      Object.assign(fb, locale);
      updateTabCounts();
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
      mgClarify.hidden = true;
      collassaFrase();
      mgManage.hidden = true;
      if (mgOwnerBar) mgOwnerBar.hidden = true;
      chiudiRiapertura();
      closeSidebar();
      renderList();
    } catch (e) {
      setActionsBusy(false);
      if (selectedId !== id) return;
      setActionMsg(e.message || 'Errore', 'err');
    }
  }

  // ── Riapertura di un fix già uscito ───────────────────────────────────────
  // Come la gemella: non scrive subito, chiede COSA manca ancora e lo appende
  // alla conversazione come turno dell'utente, così il report di chi ci ha
  // lavorato resta leggibile.
  function chiudiRiapertura() {
    if (!mgReopen) return;
    mgReopen.hidden = true;
    if (mgReopenText) mgReopenText.value = '';
    // I due bottoni del modulo vivono nell'HTML, non li rigenera nessuno: senza
    // riaccenderli qui, una riapertura andata a buon fine li lascerebbe spenti
    // per sempre (setActionsBusy li aveva spenti insieme alla riga).
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
    // Stessa regola della risposta ai chiarimenti: non si riscrive una
    // conversazione che non si è potuta leggere.
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

  function setManageMsg(text, kind) {
    mgManageMsg.textContent = text || '';
    mgManageMsg.className = 'mg-action-msg' + (kind ? ` mg-${kind}` : '');
    riflettiMessaggiOwner();
  }

  // ── Azione: preferito ⭐ (toggle) ───────────────────────────────────────────
  // Il flag `starred` è indipendente dallo stato: l'owner può "parcheggiare"
  // qualunque feedback per il futuro. Compare nel filtro ⭐ della tab Archiviati.
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
      // Col filtro ⭐ acceso gli Archiviati elencano i preferiti: cambiarne uno
      // cambia quel numero anche da un'altra scheda, dove la lista non si
      // ridisegna. Il conteggio si aggiorna comunque.
      updateTabCounts();
      // Nell'attesa il pannello può essere passato a un altro feedback:
      // ridipingerlo con lo stato di questo direbbe il falso su quello aperto.
      if (selectedId !== id) { if (currentTab === 'archived' && starredOnly) renderList(); return; }
      reflectManage(fb);
      setManageMsg(next ? 'Aggiunto ai preferiti.' : 'Rimosso dai preferiti.', 'ok');
      // Se il filtro ⭐ è attivo, un feedback de-preferito deve sparire dalla lista.
      if (currentTab === 'archived' && starredOnly) renderList();
    } catch (e) {
      // Come il ramo di successo: se il pannello è passato a un altro feedback,
      // l'errore di questo non va scritto sopra quello.
      if (selectedId !== id) return;
      setManageMsg(e.message || 'Errore', 'err');
    } finally {
      mgStarBtn.disabled = false;
    }
  }

  mgStarBtn.addEventListener('click', toggleStarred);

  function setClarifyMsg(text, kind) {
    mgClarifyMsg.textContent = text || '';
    mgClarifyMsg.className = 'mg-action-msg' + (kind ? ` mg-${kind}` : '');
  }

  // Risposta dell'owner a un feedback in `clarify`: la risposta si appende alle
  // note (come turno utente, preservando lo storico) e il feedback rientra in
  // coda (todo) per la prossima passata.
  async function sendClarifyReply() {
    if (!selectedId) return;
    const id = selectedId;
    const reply = (mgClarifyText.value || '').trim();
    if (!reply) { mgClarifyText.focus(); return; }
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
    // Lo stesso guardiano delle azioni di stato: rispondere rimette in coda, e
    // in coda ci si rimette solo da dove la tabella condivisa lo prevede.
    if (fb && !MR.ownerActionAllowsStatus(fb, 'todo', { releasedVersion })) {
      setClarifyMsg('Lo stato di questa segnalazione è cambiato: aggiorna e riprova.', 'err');
      return;
    }
    const newNotes = T
      ? T.appendUserTurn(oldNotes, reply, {})
      : (oldNotes ? `${oldNotes}\n\n${reply}` : reply);

    mgClarifyBtn.disabled = true;
    setClarifyMsg('Invio in corso…', '');
    try {
      const r = await sendToMain({ type: 'feedback_update', id, status: 'todo', notes: newNotes });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'aggiornamento rifiutato');
      if (fb) { fb.status = 'todo'; fb.notes = newNotes; }
      // Nell'attesa l'owner può aver aperto un ALTRO feedback. Il dato è
      // salvato lo stesso e la lista si ridisegna, ma il pannello NON si tocca:
      // chiuderlo adesso chiuderebbe il dettaglio dell'altro feedback, che
      // sparirebbe sotto le mani senza motivo apparente.
      if (selectedId !== id) { renderList(); return; }
      // Il feedback non è più in chiarimento: esce dalla tab Ricevuti.
      selectedId = null;
      mgDetail.hidden = true;
      mgDetailEmpty.hidden = false;
      mgClarify.hidden = true;
      collassaFrase();
      if (mgOwnerBar) mgOwnerBar.hidden = true;
      closeSidebar();
      renderList();
    } catch (e) {
      if (selectedId !== id) return;
      setClarifyMsg(e.message || 'Errore nell\'invio', 'err');
    } finally {
      mgClarifyBtn.disabled = false;
    }
  }

  mgClarifyBtn.addEventListener('click', sendClarifyReply);

  // La casella della frase ha due cose da ricordare: se l'owner ci ha messo
  // mano dopo l'ultimo invio (allora comanda quello che ha scritto lui), e
  // quale invio e' l'ultimo partito (le risposte possono tornare in ordine
  // diverso, e una vecchia non deve rimettere in campo un testo superato).
  let userNoteToccata = false;
  // Uno per feedback: due salvataggi su feedback diversi sono indipendenti,
  // due sullo stesso si scavalcano e comanda il più recente SPEDITO — non
  // quello che per caso risponde per ultimo.
  const userNoteInvii = new Map();
  // E l'ultimo testo SPEDITO, sempre per feedback. Serve alla domanda “è
  // cambiato qualcosa?”: farla sul valore memorizzato la sbaglia finché la
  // risposta non torna — l'owner che ci ripensa e rimette la frase di prima
  // si sentiva dire "Nessuna modifica", non partiva niente, e a destinazione
  // restava quella che aveva appena ritirato.
  const userNoteSpedito = new Map();
  // Quando una scrittura fallisce non si torna a fidarsi del valore
  // memorizzato: se una scrittura precedente era andata a buon fine, quello
  // che c’è a destinazione non lo sa più nessuno. Si marca IGNOTO, che non
  // combacia con niente, così il salvataggio dopo riparte comunque.
  const FRASE_IGNOTA = Symbol('frase ignota');

  // ── Aprire e chiudere la frase ────────────────────────────────────────────
  // Il modulo della frase sta CHIUSO finché non lo si chiede: è un testo che si
  // scrive una volta sola, mentre il dettaglio — la conversazione — si legge
  // sempre. Aprendolo il cursore ci finisce dentro: chi ha premuto quel tasto
  // vuole scrivere, non cercare la casella.
  function mostraFrase(aperta) {
    if (!mgUserNote) return;
    mgUserNote.hidden = !aperta;
    if (mgUserNoteToggle) mgUserNoteToggle.setAttribute('aria-expanded', aperta ? 'true' : 'false');
    if (aperta && mgUserNoteText) mgUserNoteText.focus();
  }
  function collassaFrase() { mostraFrase(false); }

  // Da chiusa, la sezione non direbbe da nessuna parte che una frase c'è già:
  // il tasto se lo tiene addosso (pallino + bordo acceso) e la mostra intera
  // nell'hover, così l'owner sa se sta scrivendo o riscrivendo.
  function riflettiFrase(frase) {
    if (!mgUserNoteToggle) return;
    const testo = String(frase || '').trim();
    mgUserNoteToggle.classList.toggle('mg-usernote-piena', !!testo);
    mgUserNoteToggle.title = testo
      ? `Frase già scritta: “${testo}”`
      : 'Scrivi la riga che leggerà chi ha segnalato';
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
    // Un errore dentro una sezione chiusa non lo legge nessuno: il salvataggio
    // può fallire mentre la sezione è già stata richiusa. Si riapre da sola.
    if (kind === 'err') mostraFrase(true);
  }

  // Salva SOLO la frase: non tocca la conversazione, quindi si può scrivere
  // anche quando il report non è leggibile su questo computer.
  // Ritorna true quando a destinazione c'è quello che l'owner ha scritto: sia
  // che l'abbia appena spedito, sia che non ci fosse niente da spedire. False
  // solo se la scrittura è fallita. Il valore lo guarda chi deve decidere se
  // proseguire (un'azione di stato non parte se la frase non si è salvata).
  async function saveUserNote(opts) {
    const muto = !!(opts && opts.muto);
    if (!selectedId) return true;
    const id = selectedId;
    const fb = allFeedbacks.find((f) => f._id === id);
    const frase = (mgUserNoteText.value || '').trim().slice(0, 500);
    const gia = userNoteSpedito.has(id) ? userNoteSpedito.get(id) : String((fb && fb.userNote) || '');
    if (gia === frase) { if (!muto) setUserNoteMsg('Nessuna modifica', ''); return true; }

    // Da qui in poi quello che c'è nella casella è "partito": se l'owner ci
    // rimette mano, quello che scrive lui vince sulla risposta che arriverà.
    userNoteToccata = false;
    const mio = (userNoteInvii.get(id) || 0) + 1;
    userNoteInvii.set(id, mio);
    userNoteSpedito.set(id, frase);

    mgUserNoteBtn.disabled = true;
    setUserNoteMsg('Salvataggio…', '');
    try {
      const r = await sendToMain({ type: 'feedback_update', id, userNote: frase });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'aggiornamento rifiutato');
      // L’ORDINE DI QUESTE TRE GUARDIE È IL PUNTO.
      //
      // 1) Una risposta superata da un salvataggio più recente non tocca
      //    niente, né la schermata né il dato: il pannello ridipinge dal dato,
      //    quindi lasciarcela scrivere faceva ricomparire, rientrando nel
      //    feedback, parole già sostituite — e da lì la pagina rispondeva
      //    "Nessuna modifica" su un testo che a destinazione non c'era mai
      //    arrivato.
      if (mio !== userNoteInvii.get(id)) return true;
      // 2) Il dato si aggiorna SEMPRE, anche se intanto l’owner è passato a un
      //    altro feedback: la scrittura è andata a buon fine davvero, e
      //    rientrando deve trovare quello che ha salvato.
      if (fb) fb.userNote = frase;
      userNoteSpedito.delete(id);
      // 3) La SCHERMATA invece si tocca solo se è ancora quella di questo
      //    feedback: altrimenti ci finirebbe dentro la frase di un altro, e il
      //    salvataggio dopo manderebbe il messaggio di uno al mittente
      //    dell’altro.
      if (selectedId !== id) return true;
      // La casella si riallinea solo se l’owner non ci ha messo mano dopo
      // l’invio, altrimenti gli cancellerebbe la correzione sotto le dita. Non
      // basta confrontare il testo con quello inviato: uscendo dal feedback e
      // rientrandoci il pannello lo ha già ridipinto col valore VECCHIO, e il
      // confronto lo scambierebbe per una correzione.
      if (!userNoteToccata) {
        mgUserNoteText.value = frase;
        // Quello che c'è a destinazione È quello che si vede: senza questa
        // riga la casella restava "in bozza" per sempre agli occhi del
        // pannello (il confronto con dataset.saved), e ogni aggiornamento in
        // arrivo su questa segnalazione veniva trattenuto per una bozza che
        // non c'era più.
        mgUserNoteText.dataset.saved = frase;
      }
      // Il tasto della barra porta il segno di quello che c'è a destinazione:
      // da chiuso è l'unico posto dove si vede che una frase esiste.
      riflettiFrase(frase);
      setUserNoteMsg(frase ? 'Salvata' : 'Frase rimossa', 'ok');
      renderThread(fb);
      return true;
    } catch (e) {
      // Superata da un invio più recente: comanda quello, qui non si tocca
      // niente.
      // ed è quello a dire se a destinazione la frase è arrivata.
      if (mio !== userNoteInvii.get(id)) return true;
      // Non è arrivato a destinazione, e una scrittura precedente potrebbe
      // esserci arrivata: da qui in poi non sappiamo cosa ci sia. Va marcato
      // SEMPRE, anche se intanto si sta guardando un altro feedback, o il
      // salvataggio successivo verrebbe di nuovo inghiottito.
      userNoteSpedito.set(id, FRASE_IGNOTA);
      if (selectedId === id) setUserNoteMsg(e.message || 'Errore nel salvataggio', 'err');
      return false;
    } finally {
      mgUserNoteBtn.disabled = false;
    }
  }

  // ── La frase non si perde per strada ──────────────────────────────────────
  // Il tasto "Salva la frase" era l'UNICA strada: tutto il resto (premere
  // "Risolto", ricliccare la stessa segnalazione, cambiare sezione) ridipinge
  // il pannello e riporta la casella al valore salvato, buttando via la riga
  // appena scritta senza dire niente — e quella riga è l'unica cosa che chi ha
  // segnalato leggerà. Adesso si salva da sola: mentre scrivi, dopo una pausa,
  // e appena il cursore lascia la casella. È lo stesso comportamento della
  // gemella, che così faceva già.
  const FRASE_PAUSA_MS = 1500;
  let userNoteTimer = null;
  // L'ultimo salvataggio partito, e COSA portava: chi deve sapere se la frase è
  // a destinazione (un'azione di stato, il tasto premuto un istante dopo che la
  // casella ha perso il fuoco) aspetta questo invece di spedirlo una seconda
  // volta.
  let userNoteInVolo = null;
  let userNoteInVoloTesto = null;

  function fraseInCasella() {
    return mgUserNoteText ? (mgUserNoteText.value || '').trim().slice(0, 500) : '';
  }
  // C'è qualcosa da spedire? La domanda si fa su quello che è PARTITO, non su
  // quello che la pagina si ricorda: finché la risposta non torna, il valore
  // memorizzato è ancora quello di prima, e un ripensamento scritto in quella
  // finestra verrebbe inghiottito. È lo stesso confronto che fa il salvataggio.
  function bozzaFrase() {
    if (!mgUserNoteText || !selectedId) return false;
    const fb = allFeedbacks.find((f) => f._id === selectedId);
    const gia = userNoteSpedito.has(selectedId)
      ? userNoteSpedito.get(selectedId)
      : String((fb && fb.userNote) || '');
    return gia !== fraseInCasella();
  }
  function annullaSalvataggioProgrammato() {
    if (userNoteTimer) { clearTimeout(userNoteTimer); userNoteTimer = null; }
  }
  function programmaSalvataggioFrase() {
    annullaSalvataggioProgrammato();
    userNoteTimer = setTimeout(() => { userNoteTimer = null; salvaFraseAutomatico(); }, FRASE_PAUSA_MS);
  }
  // Salva ORA quello che c'è nella casella, se non è già a destinazione.
  // Ritorna la promessa dell'esito (true = a destinazione c'è quello che
  // l'owner ha scritto), così chi deve proseguire può aspettarla.
  function salvaFraseSubito(opts) {
    annullaSalvataggioProgrammato();
    const testo = fraseInCasella();
    // Già partito con ESATTAMENTE questo testo: si aspetta quello, non se ne
    // manda un altro uguale.
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
  // Il salvataggio che parte DA SOLO tocca solo quello che l'owner ha scritto
  // lui: senza questa guardia, aprire due segnalazioni di fila riscriverebbe
  // una frase che nessuno ha toccato (ripulita degli spazi, tagliata a 500) e
  // il mittente si vedrebbe cambiare la riga sotto il naso.
  function salvaFraseAutomatico() {
    // Una scrittura fallita lascia la frase IGNOTA: lì si riprova comunque,
    // anche se da allora nessuno ha più toccato la casella. Altrimenti "la
    // frase è al sicuro?" risponderebbe di sì su una riga che non è mai
    // arrivata.
    const ignota = !!selectedId && userNoteSpedito.get(selectedId) === FRASE_IGNOTA;
    if (!userNoteToccata && !ignota) return userNoteInVolo || Promise.resolve(true);
    return salvaFraseSubito({ muto: true });
  }
  // Quello che l'owner ha scritto è a destinazione? Aspetta sia il salvataggio
  // già partito sia quello che parte adesso.
  async function fraseAlSicuro() {
    const giaPartito = userNoteInVolo;                 // preso PRIMA: salvaFraseSubito lo sostituisce
    const nuovo = salvaFraseAutomatico();
    const esiti = await Promise.all([giaPartito || true, nuovo]);
    return esiti.every(Boolean);
  }

  // Il tasto e Invio restano la strada esplicita, e rispondono sempre.
  function salvaFraseAMano() {
    annullaSalvataggioProgrammato();
    // Premuto un istante dopo che la casella ha perso il fuoco: quel
    // salvataggio è già in volo con questo stesso testo, e l'esito lo scrive lui.
    if (userNoteInVolo && userNoteInVoloTesto === fraseInCasella()) return;
    if (!bozzaFrase()) {
      // Niente da spedire perché a destinazione c'è già questa riga (di solito
      // ce l'ha portata il salvataggio automatico). È quello che l'owner vuole
      // sapere premendo il tasto.
      const testo = fraseInCasella();
      setUserNoteMsg(testo ? 'Salvata' : 'Nessuna frase', 'ok');
      return;
    }
    salvaFraseSubito();
  }
  if (mgUserNoteBtn) mgUserNoteBtn.addEventListener('click', salvaFraseAMano);
  if (mgUserNoteText) {
    mgUserNoteText.addEventListener('input', () => { userNoteToccata = true; programmaSalvataggioFrase(); });
    mgUserNoteText.addEventListener('blur', () => { salvaFraseAutomatico(); });
    mgUserNoteText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); salvaFraseAMano(); }
    });
  }

  // Il messaggio d'esito della riga delle azioni di stato.
  function setActionMsg(text, kind) {
    mgActionMsg.textContent = text || '';
    mgActionMsg.className = 'mg-action-msg' + (kind ? ` mg-${kind}` : '');
    riflettiMessaggiOwner();
  }

  // La riga degli esiti esiste solo quando ha qualcosa da dire: vuota
  // lascerebbe uno spazio sotto i tasti che non significa niente.
  function riflettiMessaggiOwner() {
    if (!mgOwnerMsgs) return;
    const vuoto = !(mgActionMsg && mgActionMsg.textContent.trim())
      && !(mgManageMsg && mgManageMsg.textContent.trim());
    mgOwnerMsgs.hidden = vuoto;
  }

  // ── La fila dei cinque livelli ────────────────────────────────────────────
  //
  // I disegni delle quattro forme, dentro una griglia di 16. I cerchi dei
  // giudici restano `.mg-dot` come sempre: sono lo stesso oggetto di prima, e
  // cambiarne il disegno avrebbe cambiato una cosa che non c'era da cambiare.
  const FORME_SVG = {
    triangolo: 'M8 2 L14.5 13.6 L1.5 13.6 Z',
    rombo:     'M8 1.4 L14.6 8 L8 14.6 L1.4 8 Z',
    pentagono: 'M8 1.4 L14.6 6.3 L12.1 14.2 L3.9 14.2 L1.4 6.3 Z',
    quadrato:  'M2.6 2.6 H13.4 V13.4 H2.6 Z',
  };

  // Quale forma sta guardando il pannello di destra: serve a ridisegnarlo
  // quando arriva un aggiornamento (una fusione approvata altrove) e a
  // segnare la forma scelta.
  let livelloAperto = null;
  // Quale cerchio dei giudici sta aperto (posizione), quando livelloAperto è
  // 'l2': serve a riaprire lo stesso giudice su un ridisegno.
  let giudiceAperto = null;

  function formaEl(liv, fb) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mg-forma'
      + (liv.vuoto ? ' mg-forma--vuota' : ` mg-forma--${liv.classe}`)
      + (livelloAperto === liv.key ? ' mg-forma--scelta' : '');
    b.dataset.livello = liv.key;
    b.dataset.esito = liv.esito;
    // Una o due parole sotto il puntatore, come su ogni icona della pagina.
    b.title = liv.titolo;
    b.setAttribute('aria-label', liv.titolo);
    b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${FORME_SVG[liv.forma]}"/></svg>`;
    b.addEventListener('click', () => openSidebarLivello(fb, liv.key));
    return b;
  }

  function renderLivelliRow(fb) {
    if (!mgLivelliRow || !mgForme) return;
    mgForme.replaceChildren();

    // Stato illeggibile: le forme nascerebbero da uno stato che la macchina si
    // inventa (`unlabeled`), e direbbero "in attesa del giudizio" su una
    // segnalazione già chiusa. Al loro posto l'unica cosa che si sa: aperta o
    // chiusa, con le stesse parole della gemella.
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
    for (const liv of MR.livelli(fb, { fusioni, dettaglioLetto: !FB.soloLista(fb) })) {
      if (liv.key !== 'l2') { mgForme.appendChild(formaEl(liv, fb)); continue; }
      // I giudici: un cerchio per giudice ATTESO, non per verdetto. Un panel
      // parziale mostra i mancanti tratteggiati, non un panel accorciato — e
      // anche un tratteggiato si clicca: dice PERCHÉ è vuoto.
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

  // Crea e appende una bolla della conversazione. `side` decide il lato
  // ('user' = destra, 'model' = sinistra), `who` è l'etichetta sopra il testo,
  // `bodyHtml` è GIÀ escapato dal chiamante. Gli allegati (immagini + file) si
  // aggiungono sotto il corpo; le immagini aprono il lightbox.
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
        // Nessun src iniziale: l'URL punta a byte CIFRATI (allegato rotto). Il
        // main lo decifra e resolveBubbleImages riempie src col data URL.
        html += `<img class="mg-img-loading" alt="allegato" data-url="${esc(a.url)}" loading="lazy">`;
      }
      html += `</div>`;
    }
    for (const f of files) {
      // Niente href diretto: l'URL punta a byte CIFRATI (un file rotto). Il
      // click chiede al main di scaricare e decifrare, e salva col nome vero.
      html += `<div class="mg-bubble-file"><a href="#" class="mg-file-link" data-url="${esc(f.url)}" data-name="${esc(f.name || 'allegato')}" data-type="${esc(f.type || '')}">📎 ${esc(f.name || 'allegato')}</a></div>`;
    }
    b.innerHTML = html;
    resolveBubbleImages(b);
    resolveBubbleFiles(b);
    mgThread.appendChild(b);
    return b;
  }

  // Un riassunto è "completo" se finisce con una punteggiatura di chiusura
  // frase. Il backend che giudica i feedback sintetizza il parere di Filo
  // (filoSummary) con un limite di lunghezza che a volte lo TRONCA a metà
  // frase (è il "la frase si interrompe" segnalato): l'ultima parola resta
  // appesa senza punto. In quel caso non mostriamo il frammento spezzato ma
  // ripieghiamo sul parere COMPLETO ricostruito dai verdetti dei giudici, che
  // sono sempre archiviati per intero.
  function isCompleteSummary(s) {
    const t = String(s || '').trim();
    if (!t) return false;
    return /[.!?…»)\]"'’”:]$/.test(t);
  }

  // Parere di Filo ricostruito dai verdetti completi dei giudici. Fallback per
  // quando il riassunto sintetico manca o è troncato: ogni giudice contribuisce
  // classe + ragionamento (entrambi archiviati per intero). Ritorna '' se non
  // c'è nessun verdetto con ragionamento da mostrare.
  function filoOpinionFromVerdicts(fb) {
    const p = (fb && fb.pipeline) || {};
    const verdicts = Array.isArray(p.verdicts) ? p.verdicts : [];
    const withReason = verdicts.filter((v) => v && String(v.reasoning || '').trim());
    if (!withReason.length) return '';
    const letters = ['A', 'B', 'C', 'D', 'E'];
    // All'owner mostriamo il modello reale (come il pannello destro); ai
    // non-owner l'etichetta posizionale anonima. La pagina è comunque
    // owner-only, ma teniamo la stessa regola di anonimizzazione dei pallini.
    return withReason.map((v, i) => {
      const model = v.model || v.judgeModel;
      const who = (isAdmin && model) ? String(model) : `Giudice ${letters[i] || i + 1}`;
      const cls = v.class ? ` — ${v.class}` : '';
      return `<strong>${esc(who)}${esc(cls)}</strong>\n${esc(String(v.reasoning).trim())}`;
    }).join('\n\n');
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
    const fromModel = TH ? TH.isFromModel(fb.clientId) : false;
    const imgs = (Array.isArray(fb.images) ? fb.images : []).map((url) => ({ kind: 'img', url }));
    const files = (Array.isArray(fb.files) ? fb.files : [])
      .filter((f) => f && typeof f.url === 'string' && f.url)
      .map((f) => ({ kind: 'file', url: f.url, name: f.name, type: f.type }));
    appendBubble(fromModel ? 'model' : 'user', fromModel ? 'Filo (segnalazione automatica)' : 'Utente',
      esc(fb.text || ''), imgs.concat(files));

    // Bolla 2: parere di Filo. Il riassunto sintetico (filoSummary) può
    // arrivare troncato a metà frase dal backend; se manca o è troncato,
    // ripieghiamo sul parere completo ricostruito dai verdetti dei giudici,
    // così Filo non mostra mai una frase spezzata a metà né un falso "non ha
    // ancora un parere" quando in realtà ha già giudicato.
    const summary = (fb.pipeline && fb.pipeline.filoSummary)
      ? String(fb.pipeline.filoSummary).trim() : '';
    let opinionHtml;
    if (summary && isCompleteSummary(summary)) {
      opinionHtml = esc(summary);
    } else {
      const fromVerdicts = filoOpinionFromVerdicts(fb);
      if (fromVerdicts) opinionHtml = fromVerdicts;         // parere completo dai giudici
      else if (summary) opinionHtml = esc(summary);          // troncato ma è l'unica cosa che c'è
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

    // Bolla 3: LA DECISIONE dell'owner in revisione, col suo commento se c'è.
    // Prima compariva solo quando c'era un commento: una conferma presa senza
    // commentarla non lasciava traccia nella conversazione, che continuava a
    // dire "Filo non ha ancora un parere" su una segnalazione già decisa.
    // I campi della revisione viaggiano cifrati insieme allo status: senza la
    // chiave non si scrive un blob, si tace.
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
    for (const seg of TH.splitNotes(notes)) {
      const when = seg.ts ? ` — ${seg.ts}` : '';
      const who = seg.role === 'user' ? `Tu${when}` : `Filo (lavorazione${when})`;
      appendBubble(seg.role === 'user' ? 'user' : 'model', who, esc(seg.body), seg.attachments);
    }
    appendFraseBubble(fb);
    // La copia che si sta leggendo è rimasta indietro e il tentativo di
    // rileggerla non è tornato: si dice in coda alla conversazione, dove
    // l'owner sta già guardando.
    if (fb._dettaglioMancato) appendRiprovaDettaglio();
  }

  // La riga che leggerà chi ha segnalato è l'ULTIMO turno della conversazione:
  // è l'unica cosa che il mittente vede quando la segnalazione si chiude, ed è
  // in chiaro anche quando il resto non si legge. Prima compariva solo sul
  // report cifrato: da quando la sezione parte chiusa, nel caso normale la
  // frase non era scritta da nessuna parte e si scopriva solo passando col
  // mouse sul tasto.
  function appendFraseBubble(fb) {
    const frase = String((fb && fb.userNote) || '').trim();
    if (!frase) return;
    appendBubble('model', 'Filo (per chi ha segnalato)', esc(frase));
  }

  // ── Pannello laterale ─────────────────────────────────────────────────────
  function openSidebar(title, html) {
    mgSideEmpty.hidden = true;
    mgSide.hidden = false;
    mgSideTitle.textContent = title;
    mgSideBody.innerHTML = html;
  }

  function closeSidebar() {
    mgSide.hidden = true;
    mgSideEmpty.hidden = false;
    mgSideTitle.textContent = '';
    mgSideBody.innerHTML = '';
    livelloAperto = null;
    giudiceAperto = null;
    if (mgForme) mgForme.querySelectorAll('.mg-forma--scelta')
      .forEach((el) => el.classList.remove('mg-forma--scelta'));
  }

  // Segna quale forma sta guardando il pannello: senza, con cinque forme in
  // fila e un pannello che cambia, non si sa più quale si era premuta.
  function segnaForma(key) {
    livelloAperto = key || null;
    if (!mgForme) return;
    mgForme.querySelectorAll('.mg-forma').forEach((el) => {
      el.classList.toggle('mg-forma--scelta', el.dataset.livello === livelloAperto);
    });
  }

  // Toast discreto in basso a destra: l'esito di un'azione deve arrivare anche
  // se nel frattempo l'owner ha chiuso il pannello o cambiato scheda.
  let mgToastTimer = null;
  function toast(text, kind, ms) {
    let el = document.getElementById('mgToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mgToast';
      el.className = 'mg-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = String(text || '');
    el.dataset.kind = kind || '';
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(mgToastTimer);
    // Le frasi degli esiti sono lunghe: quattro secondi e mezzo per leggerle,
    // di più quando chi chiama ne mette insieme più d'una.
    mgToastTimer = setTimeout(() => el.classList.remove('show'), Math.max(4500, Number(ms) || 0));
  }

  // ── Il pannello di un livello ─────────────────────────────────────────────
  //
  // Il contenuto (titolo, righe, testo, azioni) arriva già pronto dal modulo
  // condiviso: qui c'è solo il markup, e i due pezzi che il markup non può
  // avere — i tasti Approva/Scarta della fusione (li costruisce il modulo delle
  // fusioni) e «Salta il controllo» dell'audit.
  function openSidebarLivello(fb, key) {
    if (!fb) return;
    const liv = MR.livelloPer(fb, key, { fusioni, dettaglioLetto: !FB.soloLista(fb) });
    if (!liv) return;
    segnaForma(key);
    giudiceAperto = null;

    // I giudici non hanno un pannello loro: la fila di cerchi apre il singolo
    // giudice. Cliccare il gruppo quando nessuno ha votato dice perché.
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
        // Le date arrivano in ISO dal server: qui si scrivono come le scrive
        // il resto della pagina.
        va.textContent = /^Quando$/i.test(r.etichetta) ? formatDateTime(r.valore) : r.valore;
        el.appendChild(et); el.appendChild(va);
        righe.appendChild(el);
      }
      body.appendChild(righe);
    }

    if (p.testo) {
      const t = document.createElement('div');
      t.className = 'mg-liv-testo';
      // Testo cifrato che questo computer non sa leggere: si dice, non si
      // mostra il blob.
      if (p.illeggibile) {
        t.textContent = 'Il testo è cifrato e questo computer non ha la chiave privata per leggerlo.';
      } else {
        // Titoli e voci d'elenco del markdown resi come tali, il resto come
        // testo: niente HTML dal testo (il modulo condiviso li riconosce).
        let lista = null;
        for (const r of MR.righeTesto(p.testo)) {
          if (r.tipo === 'voce') {
            if (!lista) { lista = document.createElement('ul'); lista.className = 'mg-liv-elenco'; t.appendChild(lista); }
            const li = document.createElement('li');
            li.textContent = r.testo;
            lista.appendChild(li);
            continue;
          }
          lista = null;
          const el = document.createElement('div');
          el.className = r.tipo === 'titolo' ? 'mg-liv-titolo' : 'mg-liv-par';
          el.textContent = r.testo;
          t.appendChild(el);
        }
      }
      body.appendChild(t);
    }

    if (liv.key === 'l5') body.appendChild(pannelloFusione(fb, liv));
    if (mostraSaltaAudit(fb, liv)) body.appendChild(pannelloSaltaAudit(fb));

    openSidebar(p.titolo, '');
    mgSideBody.replaceChildren(body);
  }

  // Le card della fusione dentro il pannello del quadrato: stesso disegno e
  // stessi tasti dell'elenco in Automazioni, perché è la stessa cosa.
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

  // Ogni esito del server detto in italiano. Un esito che questo client non
  // conosce si scrive lo stesso: meglio grezzo che muto, e mai un «fatto» al
  // posto di un guasto.
  const SALTA_ESITI = {
    fuso: { kind: 'ok', text: 'Saltato: il lavoro è entrato in main.' },
    bloccato: { kind: 'ok', text: 'Saltato. Il cancello di fusione ha fermato il ramo: ora aspetta il tuo via libera sul quadrato.' },
    conflitto: { kind: 'err', text: 'Saltato, ma il ramo è in conflitto con main: torna in lavorazione per riallinearlo.' },
    ramo_assente: { kind: 'err', text: 'Il ramo di questa pratica non c’è più: non c’è niente da fondere.' },
    feedback_assente: { kind: 'err', text: 'Il server non trova questa segnalazione.' },
    non_saltabile: { kind: 'err', text: 'Qui non c’è un controllo da saltare: l’audit non ha bocciato niente.' },
    non_owner: { kind: 'err', text: 'Questo lo può fare solo il proprietario.' },
    guasto: { kind: 'err', text: 'GitHub non risponde. Il salto è registrato: ripremi quando torna su.' },
  };

  function pannelloSaltaAudit(fb) {
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

    // Un secondo clic per confermare, come l'approvazione di una fusione:
    // scavalcare un controllo di sicurezza non è un gesto da un click solo.
    let armato = false;
    let timer = null;
    const disarma = () => {
      armato = false;
      btn.textContent = 'Salta il controllo';
      if (timer) { clearTimeout(timer); timer = null; }
    };
    btn.addEventListener('click', async () => {
      if (!armato) {
        armato = true;
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
        // L'esito cambia il pentagono e (se si è aperta una richiesta) il
        // quadrato: si rilegge tutto invece di indovinare.
        setTimeout(() => { loadMergeApprovals(); refreshFromRemote(); }, 800);
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

  mgSideClose.addEventListener('click', closeSidebar);

  // Click su un pallino giudice → apre QUEL giudice nel pannello destro.
  // Titolo: per l'OWNER è il MODELLO reale che ha emesso il verdetto (così l'owner
  // vede subito quale modello ha votato cosa); per i non-owner è anonimizzato e
  // posizionale ("Giudice A/B/C/D" — mai l'id interno del giudice né il modello).
  function openSidebarJudge(fb, i) {
    // `i` è la posizione del pallino. Con la pipeline NUOVA (expectedJudges) il
    // pallino mappa per nome alla posizione del panel; con lo STORICO è l'indice
    // posizionale nei verdetti presenti. In entrambi i casi i pallini tratteggiati
    // (giudici mancanti) non aprono nulla.
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
    if (!v) {
      const nota = MR.judgesNote ? MR.judgesNote(fb) : null;
      openSidebar(anonLabel, `
        <div class="mg-judge-detail">
          <div class="mg-liv-testo">Nessun verdetto in questa valutazione: il giudice non ha risposto — scaduto il tempo, credito esaurito o modello non configurato.</div>
          ${nota && nota.text ? `<div class="mg-judge-model">${esc(nota.text)}</div>` : ''}
        </div>
      `);
      return;
    }
    const cls     = v.class || '';
    const badgeClass = cls ? `mg-class-badge--${cls}` : '';

    // Modello reale del verdetto (campo `model` del backend). All'owner lo
    // mostriamo come TITOLO del pannello; se non è registrato (verdetti di
    // pipeline vecchie, precedenti all'aggiunta del campo) ripieghiamo
    // sull'etichetta anonima e lo dichiariamo nel corpo.
    const model = v && (v.model || v.judgeModel);
    const title = (isAdmin && model) ? String(model) : anonLabel;

    // Corpo: la riga "Modello" serve solo quando il modello NON è nel titolo, cioè
    // all'owner quando il modello manca (lo dichiara invece di sparire).
    const modelRow = (isAdmin && !model)
      ? `<div class="mg-judge-model"><em>Modello non registrato</em></div>`
      : '';

    const html = `
      <div class="mg-judge-detail">
        <span class="mg-class-badge ${badgeClass}">${esc(cls || '—')}</span>
        ${modelRow}
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
      // Stesso criterio della lista: un bordo colorato è un'affermazione sullo
      // stato, e su una segnalazione cifrata la macchina lo inventa.
      const cl  = statoLeggibile(fb) ? MR.classifyBlock(fb) : null;
      const num = FB.formatNum(fb.seq, fb.subSeq);
      const title = fb.name || FB.fallbackName(fb.text) || '(senza titolo)';
      const color = cl ? cl.color : 'var(--sn-border)';
      listHtml += `
        <div class="mg-sender-item" data-id="${esc(fb._id)}" style="border-left-color:${color}">
          ${num ? `<span class="mg-sender-item-num">#${esc(num)}</span>` : ''}
          <span class="mg-sender-item-title">${esc(title)}</span>
        </div>
      `;
    }

    const html = `
      <div class="mg-sender-info">
        <div class="mg-sender-stat"><strong>${esc(senderLabel(group[0] || { clientId }))}</strong></div>
        <div class="mg-sender-stat">${esc(clientId)}</div>
        <div class="mg-sender-stat">${esc(oldestStr)}</div>
        <div class="mg-sender-stat">Feedback totali: <strong>${total}</strong></div>
        <div class="mg-sender-list" id="senderFbList">${listHtml || '<em>Nessun feedback.</em>'}</div>
      </div>
    `;
    segnaForma(null);
    openSidebar('Mittente', html);

    // Click su un feedback del mittente → carica nel pannello centrale
    const listEl = document.getElementById('senderFbList');
    if (listEl) {
      listEl.querySelectorAll('.mg-sender-item[data-id]').forEach((el) => {
        el.addEventListener('click', () => openDetail(el.dataset.id));
      });
    }
  }

  // Escape di un id per usarlo dentro un selettore CSS (`[data-id="…"]`).
  // Gli id Firestore sono alfanumerici, ma CSS.escape copre ogni evenienza.
  function cssSel(s) {
    const str = String(s ?? '');
    return (window.CSS && CSS.escape) ? CSS.escape(str) : str.replace(/["\\]/g, '\\$&');
  }

  // ── Escape HTML ───────────────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Caricamento dati ──────────────────────────────────────────────────────
  async function loadData() {
    mgListLoading.hidden = false;
    mgList.hidden = true;
    mgListEmpty.hidden = true;

    // DB3: la versione dell'app in esecuzione è, per definizione, l'ultima
    // rilasciata (l'owner gira una build pubblicata). La leggiamo dal recap
    // aggiornamento, che il main calcola con app.getVersion().
    if (!releasedVersion) {
      try {
        const r = await sendToMain({ type: 'get_update_recap' });
        if (r && r.current) releasedVersion = r.current;
      } catch (_) { /* gate inattivo: senza versione, done→Risolti come prima */ }
    }
    if (testDataInjected) return;

    try {
      // Il tetto viene dal modulo condiviso: `loadHitCap()` confronta contro
      // QUELLO, e due numeri scritti a mano prima o poi divergono.
      // La prima lettura parte all'apertura della pagina (init), PRIMA delle
      // altre letture di avvio: qui la si aspetta soltanto. Le volte dopo
      // (ricaricamento dopo un errore) si legge da capo.
      const pending = firstListPromise;
      firstListPromise = null;
      const fresh = await (pending || FB.list({ pageSize: FB.LIST_PAGE_SIZE, fields: FB.CAMPI_LISTA }));
      // Nel frattempo uno spec ha iniettato dati finti? Quelli vincono: la
      // lista vera arrivata dopo non li sovrascrive (era una gara persa a caso,
      // e più il caricamento è veloce più spesso la si perdeva).
      if (testDataInjected) return;
      allFeedbacks = fresh;
      dataLoaded = true;
      loadFailed = false;
      fondiPreapprovateInAttesa();
    } catch (err) {
      if (testDataInjected) return;
      // Il guasto va RICORDATO, non solo scritto una volta: il primo click su
      // una scheda rirende il riquadro, e senza questo flag ci scriverebbe
      // "Nessun feedback in coda." — cioè una risposta al posto di un guasto.
      loadFailed = true;
      mgListLoading.hidden = true;
      mgListEmpty.hidden = false;
      // #583: un permesso che manca non è un guasto. Chiamarlo "errore" manda a
      // controllare la rete e a premere Aggiorna, e nessuna delle due cose
      // cambierà qualcosa: i feedback li legge solo chi li gestisce.
      mgListEmpty.textContent = (err && err.code === 'FEEDBACK_READ_DENIED')
        ? 'I feedback li vede chi li gestisce: accedi con un account amministratore.'
        : 'Errore nel caricamento dei feedback.';
      console.error('[manage] errore caricamento:', err);
      return;
    }

    // S1.3: decifratura batch dei campi FENC1: — una sola IPC per tutta la lista.
    // Se l'utente non è admin (o il modulo non è disponibile) i valori restano
    // invariati (graceful fallback: la dashboard non si rompe, mostra il ciphertext).
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
    liveLastAt = Date.now();
    liveOkAt = liveLastAt;
  }

  // Indice per mittente (il pannello laterale lo usa). Si rifà a ogni
  // caricamento e a ogni giro di aggiornamento.
  function reindexByClient() {
    allByClient = {};
    for (const fb of allFeedbacks) {
      const c = fb.clientId || '__anon__';
      if (!allByClient[c]) allByClient[c] = [];
      allByClient[c].push(fb);
    }
  }

  // ── Aggiornamento continuo ────────────────────────────────────────────────
  // Versioni → soli documenti cambiati → fusione, e solo mentre qualcuno
  // guarda: patterns/dati-che-cambiano-altrove-cloud-si-chiede-la-versione.md.
  const LIVE = window.SN_FEEDBACK_LIVE;
  // Sorgenti sostituibili dagli spec (che non hanno Firestore).
  const liveSources = {
    listVersions: (o) => FB.listVersions(o),
    // Il giro dal vivo rilegge le RIGHE: stessa proiezione del caricamento.
    getMany: (ids) => FB.getMany(ids, { fields: FB.CAMPI_LISTA, timeoutMs: 20000 }),
    // Il documento intero, per il feedback che l'owner ha aperto. Col tempo
    // massimo: una richiesta appesa terrebbe il pannello su «Caricamento…» e
    // dietro di sé tutti i tasti che scrivono sulla conversazione.
    getDettagli: (ids) => FB.getMany(ids, { timeoutMs: 20000 }),
  };
  let liveEnabled = false;
  let liveBlocked = false;  // dati finti iniettati: il giro non parte più, nemmeno se l'avvio finisce dopo
  let liveClock   = null;
  let liveTick    = null;   // promessa del giro in corso: uno alla volta
  let liveTickDa  = 0;
  let liveGen     = 0;      // un giro abbandonato perché appeso non scrive più sulla lista
  let liveLastAt  = 0;      // ultimo giro tentato
  let liveOkAt    = 0;      // ultimo giro riuscito
  let inVista     = true;   // lo dice il main: in una scheda `document.hidden` non cambia mai
  // Le soglie vengono dal modulo; gli spec le accorciano per non aspettare minuti.
  const liveTempi = LIVE
    ? { pollMs: LIVE.POLL_MS, rientroMs: LIVE.RIENTRO_MIN_MS, clockMs: LIVE.CLOCK_MS }
    : { pollMs: 60000, rientroMs: 15000, clockMs: 5000 };
  // Arrivate in una sezione mentre la pagina era aperta: con un ordinamento a
  // scelta possono finire a metà lista, e senza un segno l'arrivo non si vede.
  const arrivate = new Set();

  function vistaOra() {
    return inVista && !document.hidden;
  }

  function conTempo(promessa, ms) {
    let t = null;
    return Promise.race([
      promessa,
      new Promise((_, rej) => { t = setTimeout(() => rej(new Error('nessuna risposta')), ms); }),
    ]).finally(() => clearTimeout(t));
  }

  function sezioneDi(fb) {
    if (!sezioniAttendibili() || !statoLeggibile(fb)) return null;
    return MR.manageTabFor(fb, { releasedVersion, fusioni });
  }

  function segnaArrivi(prima, fresh) {
    for (const id of LIVE.arrivi(prima, fresh, sezioneDi)) arrivate.add(id);
  }

  // «Ferma» si dice solo a chi guarda, e solo dopo più giri mancati.
  function aggiornaSegnoFerma() {
    if (!mgListHead || !LIVE) return;
    const ferma = LIVE.listaFerma({ ora: Date.now(), inVista: vistaOra(), ultimoRiuscito: liveOkAt });
    mgListHead.classList.toggle('mg-list-head--ferma', ferma);
    if (ferma) {
      mgListHead.title = `Lista ferma alle ${formatDateTime(new Date(liveOkAt).toISOString())}: `
        + 'il server non risponde, riprovo da solo.';
    } else if (mgListHead.title && mgListHead.title.startsWith('Lista ferma')) {
      mgListHead.removeAttribute('title');
    }
  }

  // L'owner sta scrivendo nel pannello (commento, risposta, nota)? Allora il
  // pannello non si ridisegna sotto le sue dita: i dati si fondono lo stesso e
  // il pannello si aggiorna al giro dopo, o quando riapre la scheda.
  function detailBeingEdited() {
    if (!mgDetail) return false;
    const el = document.activeElement;
    if (el && mgDetail.contains(el)) {
      const tag = String(el.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'input' || tag === 'select' || el.isContentEditable) return true;
    }
    // Una bozza lasciata in una casella (cursore altrove, non ancora inviata)
    // vale quanto il cursore dentro: ridisegnare la butterebbe via.
    for (const box of mgDetail.querySelectorAll('textarea')) {
      if (!box.hidden && box.offsetParent !== null && String(box.value || '').trim()) return true;
    }
    // La riga "frase per chi ha segnalato" parte già piena col valore salvato:
    // è una bozza solo se differisce da quello. Vale anche a sezione CHIUSA:
    // richiuderla non butta via quello che l'owner ha scritto, e un ridisegno
    // che passasse di qui glielo cancellerebbe senza che lui veda niente.
    if (mgUserNote && mgUserNoteText) {
      if (String(mgUserNoteText.value || '') !== String(mgUserNoteText.dataset.saved || '')) return true;
    }
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
  if (mgDetail) {
    // `focusout` arriva mentre il fuoco è ancora sul campo che lo perde: il
    // rinvio di un giro fa trovare a detailBeingEdited() la situazione vera.
    const piuTardi = () => setTimeout(riprendiRidisegnoRimandato, 0);
    mgDetail.addEventListener('input', piuTardi);
    mgDetail.addEventListener('focusout', piuTardi);
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

  let listaMossaAt = 0;
  let listaPremuta = false;
  let listaRimandata = null;
  if (mgList) {
    mgList.addEventListener('pointermove', () => { listaMossaAt = Date.now(); });
    mgList.addEventListener('pointerdown', () => { listaPremuta = true; listaMossaAt = Date.now(); });
    window.addEventListener('pointerup', () => { listaPremuta = false; }, true);
    mgList.addEventListener('pointerleave', () => { listaMossaAt = 0; listaPremuta = false; riprendiLista(); });
  }
  function listaOccupata() {
    return LIVE.listaInUso({ ora: Date.now(), ultimoMovimento: listaMossaAt, premuto: listaPremuta });
  }
  function rimandaLista() {
    if (listaRimandata) return;
    listaRimandata = setTimeout(() => { listaRimandata = null; riprendiLista(); }, LIVE.LISTA_IN_USO_MS);
  }
  function riprendiLista() {
    if (!dataLoaded || searchMode) return;
    if (listaOccupata()) { rimandaLista(); return; }
    if (listaRimandata) { clearTimeout(listaRimandata); listaRimandata = null; }
    ridisegnaListaAlSuoPosto();
  }
  function listaCheScorre() {
    return [mgList, mgList && mgList.parentElement]
      .find((el) => el && el.scrollHeight > el.clientHeight) || null;
  }
  function righeLista(scroller) {
    const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
    return Array.from(mgList.querySelectorAll('.mg-item')).map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.id, top: r.top - base, height: r.height };
    });
  }
  // Lo scorrimento si ancora alla prima scheda visibile: se ne esce una più
  // su, la vista non salta.
  function ridisegnaListaAlSuoPosto() {
    if (!LIVE || !mgList) { renderList(); return; }
    const scroller = listaCheScorre();
    const prima = scroller ? scroller.scrollTop : 0;
    const ancora = scroller ? LIVE.ancoraScorrimento(righeLista(scroller), prima) : null;
    scrollDelGiroAt = Date.now();
    renderList();
    const dopo = listaCheScorre();
    if (dopo) dopo.scrollTop = LIVE.scrollDaAncora(ancora, righeLista(dopo), prima);
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
      // Ridisegno, non una nuova apertura: la sezione della frase resta come
      // l'owner l'ha lasciata.
      openDetail(selectedId, { ridisegno: true });
      return true;
    }
    return false;
  }

  // Un giro: versioni → differenze → documenti cambiati → decifratura → fusione.
  // Ritorna { changed } (quanti feedback sono stati toccati). Un giro già in
  // corso viene riusato, non raddoppiato.
  async function refreshFromRemote() {
    if (liveTick) return liveTick;
    const gen = ++liveGen;
    liveTickDa = Date.now();
    liveTick = (async () => {
      const remote = await liveSources.listVersions({ pageSize: FB.LIST_PAGE_SIZE, timeoutMs: 20000 });
      if (gen !== liveGen) return { changed: 0 };
      // Una risposta che non è un elenco non è "tutto sparito": è un guasto,
      // e un guasto lascia la lista com'è.
      if (!Array.isArray(remote)) throw new Error('versioni non lette');
      const { changed, added, removed } = LIVE.diffVersions(allFeedbacks, remote);
      const ids = changed.concat(added);
      if (ids.length === 0 && removed.length === 0) {
        // Niente di nuovo, ma una scheda sparita in un giro precedente (tenuta
        // aperta per una bozza) può chiudersi ora che la bozza non c'è più.
        closeDetailIfGone();
        // Nessuna segnalazione è cambiata, ma il registro delle routine può
        // essere cresciuto lo stesso (un'esplorazione che non trova niente):
        // le statistiche seguono anche questo giro (feedback #496).
        fsSegueLive([], []).catch(() => {});
        liveOkAt = Date.now();
        return { changed: 0 };
      }
      let fresh = ids.length > 0 ? await liveSources.getMany(ids) : [];
      if (isAdmin && fresh.length > 0) {
        try {
          const r = await conTempo(sendToMain({ type: 'feedback_decrypt_fields', list: fresh }), 30000);
          if (r && r.ok && Array.isArray(r.list)) fresh = r.list;
        } catch (_) { /* come al caricamento: valori cifrati piuttosto che niente */ }
      }
      if (gen !== liveGen) return { changed: 0 };
      const primaDelGiro = new Map(allFeedbacks.map((f) => [String(f._id), sezioneDi(f)]));
      const statiMossi = LIVE.statoCambiato(allFeedbacks, fresh);
      allFeedbacks = LIVE.applyChanges(allFeedbacks, { fresh, removed });
      reindexByClient();
      segnaArrivi(primaDelGiro, fresh);
      if (statiMossi && isAdmin) loadMergeApprovals();
      // Il segno «fondi senza chiedermelo» può arrivare da fuori — dallo script
      // dell'owner o da un'altra finestra — e allora la richiesta ferma è la
      // stessa di prima: nessuno avvisa, e senza questo giro il ramo resta fermo
      // finché la pagina non viene riaperta.
      fondiPreapprovateInAttesa();
      rerenderAfterLive(new Set(ids));
      // Anche le statistiche seguono il giro: quello che la pagina ha appena
      // imparato vale per i numeri quanto per la lista (feedback #496).
      fsSegueLive(fresh, removed).catch(() => {});
      liveOkAt = Date.now();
      return { changed: ids.length + removed.length };
    })().finally(() => {
      if (gen === liveGen) { liveTick = null; liveTickDa = 0; }
      liveLastAt = Date.now();
      aggiornaSegnoFerma();
    });
    return liveTick;
  }

  function orologio(motivo) {
    if (!liveEnabled || !LIVE) return;
    const ora = Date.now();
    if (liveTick && ora - liveTickDa >= LIVE.GIRO_BLOCCATO_MS) {
      console.warn('[manage] aggiornamento: un giro non ha avuto risposta, ne parte un altro');
      liveGen += 1;
      liveTick = null;
      liveTickDa = 0;
    }
    const scelta = LIVE.decidiGiro({
      ora, motivo, inVista: vistaOra(), dataLoaded,
      ultimoGiro: liveLastAt, giroDa: liveTick ? liveTickDa : 0,
      pollMs: liveTempi.pollMs, rientroMs: liveTempi.rientroMs,
    });
    aggiornaSegnoFerma();
    if (scelta === 'carica') {
      // La prima lista non è arrivata: si ritenta da soli invece di lasciare
      // «Errore nel caricamento» finché l'owner non ricarica a mano.
      liveLastAt = ora;
      loadData().catch(() => {});
    } else if (scelta === 'giro') {
      refreshFromRemote().catch((e) => console.warn('[manage] aggiornamento:', e?.message || e));
    }
  }

  function impostaVista(v) {
    const eraInVista = vistaOra();
    inVista = v !== false;
    if (!eraInVista && vistaOra()) orologio('rientro');
    else aggiornaSegnoFerma();
  }

  function armaOrologio() {
    if (liveClock) clearInterval(liveClock);
    liveClock = setInterval(() => orologio('battito'), liveTempi.clockMs);
  }

  let rientroAgganciato = false;
  function startLive() {
    if (!LIVE || liveEnabled || liveBlocked) return;
    liveEnabled = true;
    armaOrologio();
    if (!rientroAgganciato) {
      rientroAgganciato = true;
      document.addEventListener('visibilitychange', () => orologio('rientro'));
      if (window.filo?.onBroadcast) {
        window.filo.onBroadcast((m) => { if (m && m.type === TAB_IN_VISTA) impostaVista(m.inVista); });
      }
    }
    sendToMain({ type: TAB_IN_VISTA_GET })
      .then((r) => { if (r && r.ok && typeof r.inVista === 'boolean') impostaVista(r.inVista); })
      .catch(() => {});
  }

  function stopLive() {
    liveEnabled = false;
    if (liveClock) { clearInterval(liveClock); liveClock = null; }
  }

  // ── Hook di test ────────────────────────────────────────────────────────
  // Solo per gli spec Playwright: inietta feedback e apre il dettaglio
  // esercitando il VERO codice di rendering, senza duplicarne la logica nel
  // test (vedi CLAUDE.md → "Test che servono davvero"). Inerte in produzione.
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
      liveBlocked = !(opts && opts.dalVivo);
      testDataInjected = true;
      arrivate.clear();
      allFeedbacks = Array.isArray(fbs) ? fbs : [];
      dataLoaded = true;
      loadFailed = false;
      reindexByClient();
      renderList();
      if (opts && opts.dalVivo) {
        liveLastAt = Date.now();
        liveOkAt = liveLastAt;
        startLive();
      }
    },
    // Le soglie dell'orologio, accorciate: un giro vero ogni minuto farebbe
    // aspettare minuti a ogni spec.
    setLiveTiming(t) {
      Object.assign(liveTempi, t || {});
      if (liveEnabled) armaOrologio();
    },
    liveArrivate() { return Array.from(arrivate); },
    // Caricamento FALLITO, su richiesta. Lo spec che verifica "niente numeri
    // inventati quando i dati non sono arrivati" si affidava al fatto che nel
    // sandbox dei test Firestore non è raggiungibile: sulla macchina di chi
    // sviluppa Filo lo è, il caricamento riesce, e quel rosso non parlava di un
    // difetto ma della rete di casa. Qui lo stato di guasto si CHIEDE, e vale
    // ovunque allo stesso modo.
    simulaCaricamentoFallito() {
      stopLive();
      liveBlocked = true;
      testDataInjected = true;   // il caricamento vero, se atterra dopo, non lo annulla
      allFeedbacks = [];
      dataLoaded = false;
      loadFailed = true;
      reindexByClient();
      renderList();
    },
    // Aggiornamento continuo: un giro subito (ritorna { changed }), e le
    // sorgenti finte { listVersions(opts), getMany(ids) } con cui farlo.
    pollNow() { return refreshFromRemote(); },
    // Un giro di ridisegno da aggiornamento remoto, su richiesta: i test lo
    // usano per verificare che una bozza in corso lo trattenga (ritorna false).
    rerenderIfIdle(id) { return rerenderAfterLive(new Set([id])); },
    setLiveSources(src) { Object.assign(liveSources, src || {}); },
    isLiveOn() { return liveEnabled; },
    setAdmin(v) { setIsAdmin(!!v); applyAutoModeGate(); },
    // Ri-legge i contatori del verificatore dalla fonte (IPC) — per i test.
    loadCaps,
    // Ri-legge le scelte sulle sessioni delle routine (IPC) — per i test.
    loadSessions,
    // Ri-legge il timeout dei giudici (IPC) — usato dai test dopo lo stub.
    loadJudgeTimeout,
    // Ri-legge la config dell'automatica (IPC): interruttore master, mappa dei
    // mittenti auto-approvati, esplorazione a coda vuota — usato dai test.
    loadAutoMode,
    setTab(tab) { selectTab(tab); },
    // Ordinamento della lista (menu tasto destro): impostalo e rirender.
    setSortMode(mode) { if (SORT_MODES[mode]) { sortMode = mode; reflectSortBtn(); renderList(); } },
    getSortMode() { return sortMode; },
    // Ordine corrente dei numeri (#N) mostrati in lista — per asserire il sort.
    currentOrder() { return currentList.map((f) => f._id); },
    // DB3: imposta la "versione rilasciata" usata dal gate "Risolti" e rirende.
    setReleasedVersion(v) { releasedVersion = v || ''; renderList(); },
    openDetail,
    // Ricerca "a senso": stato e trigger per gli spec (che comunque possono
    // esercitare il codice reale cliccando la lente e digitando nel campo).
    isSearchMode() { return searchMode; },
    runSearch(q) { return runSearch(q); },
  };

  // ── Sezione "Modelli di supporto" (DD1) ──────────────────────────────────
  // Slot → editor a segmenti (buildChain del modelChainEditor).
  // Caricato pigro: viene inizializzato la prima volta che l'utente clicca la tab.
  const SM_SLOTS = ['sanitizer', 'judge1', 'judge2', 'judge3', 'judgeDynamic', 'judgeRedTeam', 'judgePriority'];
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
  };
  let smChains = {};        // slot → { getValue }
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

  // Popola la <datalist id="nicknames-list"> (l'id letto da SN_MODEL_CHAIN) coi
  // nickname che i giudici possono usare: quelli definiti nel registro giudici
  // (righe correnti) uniti ai predefiniti condivisi, così i selettori per-giudice
  // li propongono. Va richiamata dopo ogni modifica al registro.
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
    // 1. Registro dedicato ai giudici (priorità: compaiono per primi).
    const judgeReg = collectJudgeRegistry();
    for (const nick of Object.keys(judgeReg)) addNick(nick, judgeReg[nick].label);
    // 2. Registro condiviso predefinito (fallback comodo: flash, haiku, …).
    const shared = (window.SN_CONST && window.SN_CONST.DEFAULT_MODEL_REGISTRY) || {};
    for (const nick of Object.keys(shared)) addNick(nick, (shared[nick] || {}).label);
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

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sn-btn sn-btn-secondary';
    del.textContent = 'Rimuovi';
    del.addEventListener('click', () => { row.remove(); populateSmNicknames(); });

    // Aggiornare nickname o modello ridisegna i suggerimenti dei selettori
    // (un nickname compare tra i suggerimenti solo quando ha anche un modello).
    nickIn.addEventListener('input', () => populateSmNicknames());
    modelIn.addEventListener('input', () => populateSmNicknames());

    row.appendChild(nickIn);
    row.appendChild(modelIn);
    row.appendChild(del);
    return row;
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

  // Rende gli editor a segmenti per tutti gli slot, usando SN_MODEL_CHAIN.buildChain.
  // Ogni chain è attaccata al div #mgSmChain-<slot>.
  function renderSmSlots(models) {
    const ModelChain = window.SN_MODEL_CHAIN;
    if (!ModelChain) return;
    smChains = {};
    for (const slot of SM_SLOTS) {
      const host = document.getElementById(`mgSmChain-${slot}`);
      if (!host) continue;
      // Allinea la <label> dello slot all'etichetta amichevole (la mappa è la
      // sorgente di verità: HTML e JS non possono divergere).
      const slotEl = host.closest('.mg-sm-slot');
      const labelEl = slotEl && slotEl.querySelector('label');
      if (labelEl && SM_SLOT_LABELS[slot]) labelEl.textContent = SM_SLOT_LABELS[slot];
      host.innerHTML = '';
      // Nessun validatore di azione (questi slot non corrispondono a un'azione
      // in SN_CONST.ACTIONS): accettiamo qualunque nickname. Il validatore è
      // opzionale in buildChain — basta non passarlo.
      const chain = ModelChain.buildChain(models[slot] || '', null, {});
      host.appendChild(chain.el);
      smChains[slot] = chain;
    }
  }

  function setSmStatus(text, kind) {
    mgSmStatus.textContent = text || '';
    mgSmStatus.className = 'mg-sm-status' + (kind ? ` mg-${kind}` : '');
  }

  // Mostra "configurata/non configurata" accanto al campo chiave (la chiave vera
  // non lascia mai il main: dal GET arriva solo il booleano).
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

  // Render dell'editor (chiave + registro giudici + nickname + slot) e reveal.
  // Estratta da loadSupportModels così i test possono esercitarla senza il canale.
  function renderSupportModelsEditor(models) {
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
      models[slot] = smChains[slot] ? smChains[slot].getValue() : '';
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

  // Caricamento pigro: avviene la prima volta che l'utente seleziona la tab
  // "Modelli di supporto". La funzione selectTab già esiste e gestisce il
  // pannello; qui interceptiamo il click sulla tab models.
  mgTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.mg-tab');
    if (!btn || btn.dataset.tab !== 'models') return;
    if (!smLoaded && !smLoading) loadSupportModels();
  });

  // Tab "Log": ricarica il log dei worker a OGNI apertura (non solo la prima) —
  // vogliamo vedere gli spawn nuovi dall'ultima volta. È una singola lettura di
  // documento, quindi rileggerla a ogni click è a costo trascurabile.
  mgTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.mg-tab');
    if (!btn || btn.dataset.tab !== 'log') return;
    loadWorkerLog();
  });

  // Tab "Ricevuti" (l'avviso da decidere) e "Automazioni" (la traccia delle
  // decisioni passate): le fusioni si rileggono a OGNI apertura — una
  // richiesta già decisa o appena arrivata renderebbe la sezione una
  // fotografia vecchia.
  mgTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.mg-tab');
    if (!btn || (btn.dataset.tab !== 'automation' && btn.dataset.tab !== 'inbox')) return;
    loadMergeApprovals();
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
  // qui non si ricarica niente dalla rete: si applicano.
  async function fsSegueLive(fresh, removed) {
    if (!fsCaricato || !Array.isArray(fsFeedbacks)) return;
    const via = new Set(Array.isArray(removed) ? removed : []);
    const nuovi = Array.isArray(fresh) ? fresh : [];
    const aperto = fsPannelloAperto();
    if (!nuovi.length && !via.size && !aperto) return;
    if (nuovi.length || via.size) {
      const perId = new Map();
      for (const f of fsFeedbacks) if (f && f._id && !via.has(f._id)) perId.set(f._id, f);
      for (const f of nuovi) if (f && f._id) perId.set(f._id, f);
      fsFeedbacks = Array.from(perId.values());
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
      if (r.da == null && r.a == null) testo = 'Scegli le due date, o lascia vuota una delle due.';
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
      const meta = AUTHOR_META[kind] || AUTHOR_META.user;
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

  // ── Da dove partono davvero i numeri ─────────────────────────────────────
  // Un conteggio che afferma un totale che non conosce è peggio di nessun
  // conteggio (CLAUDE.md § Limiti). Qui si dice, in una riga, fin dove
  // arrivano le due sorgenti.
  function renderFsNota(stat) {
    const righe = [];
    if (fsRipiego) {
      righe.push(fsErrore
        ? fsErrore
        : `Non è riuscita la lettura di tutte le segnalazioni: qui sotto ci sono solo le ${FB.LIST_PAGE_SIZE} più recenti già in pagina, quindi i numeri sono minimi, non totali.`);
    } else if (!fsCompleto) {
      righe.push('La lettura delle segnalazioni si è fermata prima della fine: i numeri sulle segnalazioni sono minimi, non totali.');
    }
    const cop = stat.copertura;
    if (!fsLogOk) {
      righe.push('Il registro delle esecuzioni delle routine non si è letto: esplorazioni, lavorati, lanci e giri di verifica non si sanno finché non torna, e al loro posto c\'è un trattino.');
    } else if (cop.logVuoto) {
      righe.push('Il registro delle esecuzioni delle routine è vuoto: esplorazioni, lavorati e giri di verifica non hanno ancora niente da contare.');
    } else if (cop.logCorto) {
      righe.push(`Il registro delle esecuzioni tiene le ultime: parte dal ${FS.dataBreve(cop.logDa)}. Esplorazioni, lavorati e giri di verifica contano da lì, non dall'inizio della finestra.`);
    }
    // Una segnalazione con la data d'arrivo mancante o illeggibile non cade in
    // nessuna finestra, «Tutto» compreso. Sparire in silenzio da un totale è la
    // cosa che non deve succedere: qui si dice quante sono.
    const sd = stat.ricevuti.senzaData;
    if (sd > 0) {
      righe.push(sd === 1
        ? 'Una segnalazione non ha una data d\'arrivo leggibile: resta fuori da ogni finestra, «Tutto» compreso.'
        : `${fsNum(sd)} segnalazioni non hanno una data d'arrivo leggibile: restano fuori da ogni finestra, «Tutto» compreso.`);
    }
    // Il mittente viaggia cifrato come lo stato. Senza la chiave privata non si
    // legge, e la ripartizione per mittente (una delle cose chieste) non può
    // essere completa: si dice, invece di attribuirli tutti a una persona.
    const mi = stat.ricevuti.mittentiIgnoti;
    if (mi > 0) {
      righe.push(mi === 1
        ? 'Di una segnalazione non si è potuto leggere il mittente: serve la chiave dell\'owner su questo computer. Nel filtro per creatore non c\'è.'
        : `Di ${fsNum(mi)} segnalazioni non si è potuto leggere il mittente: serve la chiave dell'owner su questo computer. Nel filtro per creatore non ci sono.`);
    }
    mgFsNota.textContent = righe.join(' ');
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
    return (AUTHOR_META[kind] || AUTHOR_META.user).label;
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
  // le migliaia e la virgola i decimali (Intl.NumberFormat('it-IT')).
  const FS_FMT = (() => {
    try { return new Intl.NumberFormat('it-IT'); } catch (_) { return null; }
  })();
  function fsCifra(v, decimali) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return String(v);
    try {
      return decimali
        ? v.toLocaleString('it-IT', { minimumFractionDigits: decimali, maximumFractionDigits: decimali })
        : (FS_FMT ? FS_FMT.format(v) : String(v));
    } catch (_) { return decimali ? v.toFixed(decimali) : String(v); }
  }
  function fsNum(v) { return v == null ? '—' : fsCifra(v); }
  // «Nome: conto», per ogni etichetta che porta un numero, compresi i
  // suggerimenti col mouse: lì il conto si leggeva «1200» e la legenda «1.200».
  function fsRigaConto(label, n) { return `${label}: ${fsNum(n)}`; }

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
        })), 'creatori') };
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

  function renderFsTiles(stat) {
    const det = FS_DETTAGLI_TILES.includes(fsAperto) ? fsDettaglio(stat) : null;
    // Col registro non letto i tre riquadri che ne vivono non hanno un numero.
    // Il trattino da solo non basta: lo dicono anche sul riquadro, perché la
    // riga sopra sta in dodici pixel e il numero grande ne ha trenta.
    const ko = stat.copertura.registroLetto === false;
    const noto = ko ? 'registro delle routine non letto' : '';
    const fbKo = stat.copertura.feedbackLetti === false;
    mgFsTiles.innerHTML = [
      fsTile('ricevuti', stat.ricevuti.totale, 'Feedback ricevuti',
        fbKo ? 'segnalazioni non lette' : '', fbKo ? false : 'espandi'),
      // «in tutto» prometteva un totale che questo numero non ha: conta le
      // verifiche partite DENTRO la finestra, mentre la torta qui sotto conta
      // le critiche di un lavoro su tutto il registro. Con una finestra
      // stretta le due cose si contraddicevano a vista («1 verifica in tutto»
      // sopra, «2 critiche» sotto, stesso lavoro).
      fsTile('lavorati', stat.lavorati.totale, 'Feedback lavorati',
        ko ? noto : (stat.lavorati.verifiche
          ? `${fsNum(stat.lavorati.verifiche)} ${stat.lavorati.verifiche === 1 ? 'verifica partita' : 'verifiche partite'} in questa finestra`
          : ''), ko ? false : 'espandi'),
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
      fsTile('lanci', stat.lanci.totale, 'Lanci delle routine', ko ? noto : '', ko ? false : 'espandi'),
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
    const numeroApribile = (chiave, n) =>
      `<button type="button" class="mg-fs-quanti" data-fs-esito="${esc(chiave)}"`
      + ` title="${esc(`Mostra ${n === 1 ? 'la segnalazione contata' : 'le segnalazioni contate'}`)}">${esc(fsNum(n))}</button>`;
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
    const auditN = ko ? 0 : stat.audit.pass + stat.audit.fail + stat.audit.saltato;
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
      fsTile('audit', stat.audit.pass, 'Controlli di sicurezza passati',
        ko ? noto : `${fsNum(stat.audit.fail)} bocciati · ${fsNum(stat.audit.saltato)} saltati da te`,
        auditN ? 'espandi' : false),
      // Il numero grande conta ARENAMENTI: una segnalazione arenata due volte
      // ne vale due, quindi non è un conto di segnalazioni e non si apre.
      // Ad aprirle è la riga piccola, come nel riquadro delle esplorazioni.
      fsTile('arenati', stat.arenati.lavorazioni, 'Lavorazioni arenate e rimesse in coda',
        ko ? noto : (stat.arenati.feedback
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
      return { ...desc, titolo: f.label, ids: f.ids };
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
    if (mgFsDrill) mgFsDrill.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
      return `<li><button type="button" class="mg-fs-drill-row" data-fs-open="${esc(id)}"${apribile ? '' : ' disabled'}`
        + ` title="${esc(apribile ? 'Apri la segnalazione' : 'Non è fra le segnalazioni caricate nella lista: aprila dalla colonna di sinistra')}">`
        + `<span class="mg-fs-drill-num">${num ? '#' + esc(num) : '—'}</span>`
        + `<span class="mg-fs-drill-t">${esc(titolo)}</span>`
        + `<span class="mg-fs-drill-cat">${esc(cat.label)}</span></button></li>`;
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
    setTimeout(() => {
      document.addEventListener('mousedown', fsFuoriMenu, true);
      document.addEventListener('keydown', fsEscMenu, true);
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
    const ST = window.SN_FB_STATUS;
    let tab = 'inbox';
    try {
      const n = MR.normalizeStatus(fb) || {};
      if (n.status && ST && ST.tabFor) tab = ST.tabFor(n.status) || 'inbox';
    } catch (_) { /* senza stato leggibile si apre dai Ricevuti */ }
    selectTab(tab);
    openDetail(id);
  }

  // La scheda si rilegge a OGNI apertura: nel frattempo le routine possono
  // aver lavorato, e una fotografia vecchia qui è peggio di nessuna.
  mgTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.mg-tab');
    if (!btn || btn.dataset.tab !== 'fbstats') return;
    loadFsData();
  });

  // …e anche a pagina ferma: il main avvisa quando l'elenco cambia (una
  // fusione bloccata da `npm run finish`, o una decisa da un'altra finestra).
  // Senza questo, una pagina di Gestione lasciata aperta continuerebbe a
  // mostrare lo stato di quando è stata aperta.
  if (window.filo?.onBroadcast) {
    window.filo.onBroadcast((m) => {
      if (m && m.type === MERGE_APPROVALS_CHANGED) loadMergeApprovals(m);
    });
  }

  // Esponi per gli spec Playwright (hook di test).
  window.__mgTest.loadSupportModels = loadSupportModels;
  window.__mgTest.getSmChains = () => smChains;
  window.__mgTest.getSmSlots = () => SM_SLOTS;
  // Render diretto dell'editor con dati finti (bypassa il canale main: i test
  // non hanno una sessione admin né Firestore).
  window.__mgTest.renderSupportModelsEditor = (models) => { renderSupportModelsEditor(models); smLoaded = true; };
  window.__mgTest.collectJudgeRegistry = collectJudgeRegistry;
  // L'immagine a tutta pagina: gli spec la aprono e la chiudono dalla stessa
  // porta dell'utente, così passano anche dall'avviso al main (#514).
  window.__mgTest.openLightbox = openLightbox;
  window.__mgTest.closeLightbox = closeLightbox;
  // Tab "Log": render diretto con voci finte (bypassa il canale main), e
  // ri-lettura via IPC per gli spec che stubbano la risposta.
  window.__mgTest.renderWorkerLog = (entries) => { renderWorkerLog(entries); logLoaded = true; };
  window.__mgTest.loadWorkerLog = loadWorkerLog;
  // Tab "Statistiche feedback": dati finti al posto delle due letture vere
  // (negli spec non c'è né una sessione da proprietario né Firestore). Da qui
  // in poi la scheda esercita il codice VERO — conti, riquadri, torta.
  window.__mgTest.setFsData = (dati) => {
    const d = dati || {};
    fsFeedbacks = Array.isArray(d.feedbacks) ? d.feedbacks : [];
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
  // Fusioni in attesa: rilettura via IPC dopo lo stub (in test non c'è né una
  // sessione da proprietario né il server di sicurezza).
  window.__mgTest.loadMergeApprovals = loadMergeApprovals;
  // Le forme dei cinque livelli: quale forma sta aperta nel pannello e le
  // richieste di fusione che la pagina ha in mano (per gli spec).
  window.__mgTest.openSidebarLivello = openSidebarLivello;
  window.__mgTest.livelloAperto = () => livelloAperto;
  window.__mgTest.getFusioni = () => fusioni;

  // Icone della ricerca (lente): iniettate da JS così restano nel tema di Filo
  // (SVG outline, currentColor) invece di un glifo emoji.
  function injectSearchIcons() {
    const ICONS = window.SN_ICONS;
    if (!ICONS || !ICONS.search) return;
    if (mgSearchToggle) mgSearchToggle.innerHTML = ICONS.search(18);
    if (mgSearchIco)    mgSearchIco.innerHTML = ICONS.search(16);
  }

  // ── Larghezza delle colonne (divisori trascinabili) ───────────────────────
  // Le tre colonne del pannello lista sono ridimensionabili a mano: le due
  // esterne hanno larghezza fissa scelta dall'utente, il dettaglio al centro
  // assorbe il resto. Nessun ridimensionamento automatico: l'unica cosa che
  // muove le colonne è il trascinamento dei divisori (o la finestra che si
  // stringe troppo, e in quel caso le preferenze salvate restano intatte).
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

  // Larghezze EFFETTIVE: partono dalle preferenze salvate ma vengono ristrette
  // allo spazio davvero disponibile (logica pura condivisa col deck builder).
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

  // Imposta una larghezza clampata al minimo della colonna e a quanto resta
  // lasciando al dettaglio centrale il suo minimo. Ritorna true se è cambiata.
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

  // Trascinamento: aggiorna live, persiste al rilascio. Doppio clic: torna alla
  // misura iniziale (se si può allargare, si deve poter tornare indietro).
  // Frecce ←/→ con il divisore a fuoco: stessa cosa da tastiera.
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

  // Sinistra (lista): dal bordo sinistro del riquadro al centro della presa.
  wireDivider(mgDividerLeft, 'leftW', (ev, rect) => ev.clientX - rect.left - DIVIDER_W / 2);
  // Destra (pannello laterale): dal centro della presa al bordo destro.
  wireDivider(mgDividerRight, 'rightW', (ev, rect) => rect.right - ev.clientX - DIVIDER_W / 2);

  // La finestra che si rimpicciolisce deve ri-adattare le larghezze: senza,
  // con misure salvate più grandi dello spazio disponibile il dettaglio
  // centrale collasserebbe. Le preferenze salvate NON vengono toccate.
  window.addEventListener('resize', applyLayout);

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    // La lista è la cosa più lenta (secondi di rete): parte SUBITO, e le altre
    // letture di avvio girano mentre viaggia, invece di metterlesi davanti in
    // fila. loadData la aspetta; un errore lo raccoglie lì, non qui.
    firstListPromise = FB.list({ pageSize: FB.LIST_PAGE_SIZE, fields: FB.CAMPI_LISTA });
    firstListPromise.catch(() => {});
    injectSearchIcons();
    await loadLayout();
    await refreshAuth();
    applyAutoModeGate();
    // In parallelo e senza che una fallita fermi le altre (ognuna gestisce già
    // il proprio errore; allSettled è la cintura).
    await Promise.allSettled([loadAutoMode(), loadSortMode(), loadCaps(), loadSessions(), loadJudgeTimeout(), loadMergeApprovals()]);
    await loadData();
    startLive();
  }

  const bootDone = init().catch((e) => { console.error('[manage] init:', e); });
  // Gli spec devono poter aspettare la FINE del caricamento vero (Firestore)
  // prima di iniettare dati finti: se il caricamento atterra a metà test, li
  // sovrascrive e il test diventa rumore.
  window.__mgTest.whenReady = () => bootDone;

})();
