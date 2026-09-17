// Gestione unificata (filo://manage/, owner-only): quattro tab-lista che condividono
// il layout a 3 colonne (lista / dettaglio / pannello laterale), più Statistiche e
// Modelli, per ora segnaposto.

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
  const mgAutoApproveBlock = document.getElementById('mgAutoApproveBlock');
  // Un interruttore per ogni categoria d'autore che la lista mostra come icona (AUTHOR_META):
  // chi si vede separato si regola separato. Chiave = il gruppo in AUTO_APPROVE_GROUPS.
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
  const mgRoutinesSwitch = document.getElementById('mgRoutinesSwitch');
  const mgRoutinesToggle = document.getElementById('mgRoutinesToggle');
  const mgRoutinesState  = document.getElementById('mgRoutinesState');
  const mgRoutinesMsg    = document.getElementById('mgRoutinesMsg');
  const mgProberIdle      = document.getElementById('mgProberIdle');
  const mgProberIdleMsg   = document.getElementById('mgProberIdleMsg');
  const mgProberIdleBlock = document.getElementById('mgProberIdleBlock');
  // I tre bilanci dei giri di correzione: spiegazione distesa alla loro sezione, più sotto.
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
  const mgJudgeTimeout     = document.getElementById('mgJudgeTimeout');
  const mgJudgeTimeoutSave = document.getElementById('mgJudgeTimeoutSave');
  const mgJudgeTimeoutMsg  = document.getElementById('mgJudgeTimeoutMsg');

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

  const mgClarify     = document.getElementById('mgClarify');
  const mgClarifyText = document.getElementById('mgClarifyText');
  const mgClarifyBtn  = document.getElementById('mgClarifyBtn');
  const mgClarifyMsg  = document.getElementById('mgClarifyMsg');
  // Il modulo della frase sta chiuso finché non lo si apre col tasto della barra.
  const mgUserNote       = document.getElementById('mgUserNote');
  const mgUserNoteToggle = document.getElementById('mgUserNoteToggle');
  const mgUserNoteText   = document.getElementById('mgUserNoteText');
  const mgUserNoteBtn    = document.getElementById('mgUserNoteBtn');
  const mgUserNoteMsg    = document.getElementById('mgUserNoteMsg');

  const mgManage     = document.getElementById('mgManage');
  const mgPreapproveBtn = document.getElementById('mgPreapproveBtn');
  const mgPreapprovedInfo = document.getElementById('mgPreapprovedInfo');
  const mgPreapproveLine = document.getElementById('mgPreapproveLine');
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
  let selectedId    = null;
  let allByClient   = {};       // clientId → array di feedback (per il pannello mittente)
  let starredOnly   = false;    // filtro ⭐ della tab Archiviati (DB2)
  let confirmedOnly = false;    // filtro "Bloccati confermati" (attack/spam confermati)
  let releasedVersion = '';     // versione dell'app in esecuzione = ultima rilasciata (DB3)
  let firstListPromise = null;  // prima lettura della lista, avviata da init PRIMA del resto
  let testDataInjected = false; // uno spec ha iniettato la lista: il caricamento vero non la tocca più
  // Modalità automatica: agisce UNA volta al momento del giudizio (sicuro+ON → todo,
  // sicuro+OFF → aligned). Non è una lente sulle liste: le tab derivano dallo status.
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
  // Senza sezioni la lista non ha nome: nessuna sezione è stata scelta.
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

  // Icona d'autore: qui solo la resa visiva, la classificazione sta in TH.authorKind. Le tre
  // automazioni restano separate: conta se un ritrovamento nasce esplorando o verificando.
  const AUTHOR_META = {
    owner:    { icon: '👑', label: 'Owner' },
    user:     { icon: '👤', label: 'Utente' },
    filo:     { icon: '🧵', label: 'Filo (per conto di un utente)' },
    prober:   { icon: '🔍', label: 'Claude (esplorazione)' },
    worker:   { icon: '🔧', label: 'Claude (sviluppo)' },
    verifier: { icon: '🧪', label: 'Claude (verifica)' },
    // I rilievi rimasti fuori dal giro di correzione, raccolti dal server in un feedback
    // derivato per lavoro (#N.k): categoria propria, così si vede che nasce da una verifica.
    residuo:  { icon: '🧹', label: 'Claude (rilievi residui)' },
    // Sessione locale: Claude in chat con l'owner. Icona «computer» perché è l'unica istanza che
    // lavora davanti a lui.
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
  // Etichetta del mittente. Solo per gli utenti si mostra un pezzo di identificativo: è l'unica
  // cosa che li distingue; altrove sarebbe rumore.
  function senderLabel(fb) {
    const kind = authorKindOf(fb);
    const m = AUTHOR_META[kind] || AUTHOR_META.user;
    if (kind !== 'user') return `${m.icon} ${m.label}`;
    const id = String((fb && fb.clientId) || '').trim();
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
  // Rango «per creatore»: prima le persone, poi le istanze di Claude — la sessione locale in
  // testa perché lavora con l'owner. A parità si ordina per clientId, così resta unito.
  const AUTHOR_RANK = { owner: 0, user: 1, local: 2, worker: 3, verifier: 4, residuo: 5, prober: 6, claude: 7, filo: 8 };
  // `list` arriva già ordinata col criterio della tab: in 'smart' resta intatta. `sort` è stabile
  // → a parità di chiave si conserva quell'ordine.
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
    // Anche le risposte sulle pillole dei documenti: dipendono da chi guarda come quelle delle
    // immagini, e tenerne una sola lascerebbe metà del difetto in piedi.
    fileWhyCache.clear();
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
    // Finito l'accesso si richiede lo stato: toglie l'avviso di sola lettura e svuota le risposte
    // di quando non eravamo nessuno.
    sendToMain({ type: 'auth_signin' }).then(() => refreshAuth()).catch(() => {});
  });

  // Switch «Routine autonome»: vive in config/routines, che le routine leggono SENZA
  // credenziali — è l'unico modo perché «spento» arrivi alle loro macchine.
  let routinesOn = true;

  function reflectRoutines(on) {
    routinesOn = !!on;
    if (mgRoutinesToggle) mgRoutinesToggle.checked = routinesOn;
    if (mgRoutinesState)  mgRoutinesState.textContent = routinesOn ? 'On' : 'Off';
    if (mgProberIdleBlock) mgProberIdleBlock.classList.toggle('mg-auto-block--off', !routinesOn);
    for (const id of ['mgCap2Block', 'mgCap1Block', 'mgCap0Block', 'mgFixInstructionsBlock']) {
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
        // Spegnere vale dal prossimo giro: chi sta lavorando finisce. Senza dirlo, sembra non aver
        // fatto niente.
        setRoutinesMsg(on ? 'Salvato.' : 'Salvato. Un lavoro già in corso arriva in fondo, poi non ne parte nessun altro.', 'ok');
      } catch (err) {
        // Non scritto = non cambiato: lo switch non deve dire il contrario.
        reflectRoutines(!on);
        setRoutinesMsg('Salvataggio fallito: le routine NON sono cambiate.', 'err');
        console.error('[manage] salvataggio interruttore routine fallito:', err);
      }
    });
  }

  // Switch «Modalità automatica». Fonte di verità: config/automation (`enabled`), letto dal
  // backend dei giudici; chrome.storage.local è solo cache e ripiego se l'IPC tace.
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
    try {
      const data = await chrome.storage.local.get(AUTO_MODE_KEY);
      reflectAutoMode(!!data[AUTO_MODE_KEY]);
    } catch (_) {
      reflectAutoMode(false);
    }
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
      // Accendere vale da ORA: agisce al momento del giudizio, quindi i già in attesa restano dove
      // sono (hanno il loro pulsante due righe più in là).
      const pending = r.enabled ? alignedFeedbacks().length : 0;
      setAutoModeMsg(
        pending
          ? `Salvato. I ${pending} già in attesa restano nei Ricevuti: usa «Approva tutti gli allineati».`
          : 'Salvato.',
        'ok',
      );
    } catch (err) {
      // Se non è stato scritto su Firestore non è attivo, e lo switch non deve dire altro.
      reflectAutoMode(!on);
      setAutoModeMsg('Salvataggio fallito: la modalità automatica NON è cambiata.', 'err');
      console.error('[manage] salvataggio modalità automatica fallito:', err);
    }
  });

  // Auto-approvazione per mittente (#446): con l'automatica accesa dicono di chi ci si fida
  // abbastanza da entrare in coda senza passare dall'owner. Spenta: visibili ma inerti.
  function reflectAutoApprove(map) {
    // Il ripiego sul vecchio interruttore unico vive nel modulo condiviso: una mappa
    // salvata prima dello sdoppiamento non deve mostrare acceso ciò che l'owner aveva spento.
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

  // Esplorazione automatica a coda vuota (#448): cosa fanno le routine quando NON c'è più niente
  // in coda, non chi entra in coda. Indipendente dall'automatica.
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
    // Senza routine queste due impostazioni non decidono niente, quindi non si toccano. Restano
    // visibili: sono una scelta dell'owner, non un segreto.
    for (const el of [mgCap2, mgCap2Save, mgCap1, mgCap1Save, mgCap0, mgCap0Save, mgFixInstructions, mgFixInstructionsSave]) {
      if (el) el.disabled = !isAdmin || !routinesOn;
    }
    if (mgProberIdle)  mgProberIdle.disabled = !isAdmin || !routinesOn;
    if (mgJudgeTimeout)     mgJudgeTimeout.disabled = !isAdmin;
    if (mgJudgeTimeoutSave) mgJudgeTimeoutSave.disabled = !isAdmin;
    applyAutoApproveGate();
  }

  // I tre bilanci dei giri di correzione (config/routines): cap2 per i rilievi 3 e 2, cap1 per
  // gli 1, cap0 per gli 0 (0 = mai da soli). Li applica il SERVER; qui solo cache e clamp.
  function clampCap(n, min = AUTOMATION.CAP_MIN) {
    if (n === '' || n === null || n === undefined) return null;
    n = Math.round(Number(n));
    if (!Number.isFinite(n)) return null;
    return Math.min(AUTOMATION.CAP_MAX, Math.max(min, n));
  }

  const CAPS_GET = (window.SN_MSG?.MSG?.AUTOMATION_CAPS_GET) || 'automation_caps_get';
  const CAPS_SET = (window.SN_MSG?.MSG?.AUTOMATION_CAPS_SET) || 'automation_caps_set';

  const CAP_FIELDS = {
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
    try {
      const r = await sendToMain({ type: CAPS_GET });
      if (r && r.ok) {
        lettoDalServer = true;
        for (const k of Object.keys(CAP_FIELDS)) if (r[k] != null) remote[k] = r[k];
        if (typeof r.fixInstructions === 'string') remote.fixInstructions = r.fixInstructions;
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
  }

  async function saveCap(field) {
    const f = CAP_FIELDS[field];
    if (!f.input) return;
    // Un campo vuoto non è uno zero (per i gravi lo 0 ferma al primo rilievo) né un «torno al
    // default», che non c'è: vuoto = non si salva, e la scritta lo dice.
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
  if (mgFixInstructionsSave) mgFixInstructionsSave.addEventListener('click', saveFixInstructions);
  if (mgFixInstructions) mgFixInstructions.addEventListener('input', () => setCapMsg('fixInstructions', '', null));


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

  // Tab «Log»: gli ultimi worker spawnati. Fonte config/automation.workerLog, scritto dal
  // server al rilascio di ogni biglietto; sola lettura via main (owner-gated).
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
  const MERGE_APPROVAL_APPROVE = (window.SN_MSG?.MSG?.MERGE_APPROVAL_APPROVE) || 'merge_approval_approve';
  const MERGE_APPROVAL_DISCARD = (window.SN_MSG?.MSG?.MERGE_APPROVAL_DISCARD) || 'merge_approval_discard';
  const MERGE_APPROVALS_CHANGED = (window.SN_MSG?.MSG?.MERGE_APPROVALS_CHANGED) || 'merge_approvals_changed';
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

  // Le fusioni ferme si aprono dalla loro segnalazione; quelle senza numero non hanno una
  // scheda dove vivere e restano qui, con le decisioni già prese, che lasciano traccia.
  const mgMergeApprovalsOrphans = document.getElementById('mgMergeApprovalsOrphans');
  const mgMergeApprovalsRecent = document.getElementById('mgMergeApprovalsRecent');
  const mgMergeApprovalsPreapproved = document.getElementById('mgMergeApprovalsPreapproved');

  // Gli elenchi del server come sono arrivati: quadrati e bordi li leggono da qui, così una
  // scheda aperta ridisegna senza rileggere.
  let fusioni = { pending: [], failed: [], recent: [], preapproved: [] };

  // Dal numero sull'etichetta al feedback vero: la scheda è già in questa dashboard, quindi
  // «guarda cosa era stato chiesto» è un click, non una ricerca. Se non è in lista, nulla.
  function openFeedbackByNum(num) {
    const cerca = String(num || '').trim();
    if (!cerca || !FB || typeof FB.formatNum !== 'function') return;
    const fb = allFeedbacks.find((f) => FB.formatNum(f.seq, f.subSeq) === cerca);
    if (!fb) return;
    // Senza sezioni non c'è una sezione in cui saltare: la lista è una sola.
    if (sezioniAttendibili()) selectTab(MR.manageTabFor(fb, { releasedVersion }));
    openDetail(fb._id);
  }

  // `already` è l'elenco già pronto quando ad avvisare è il main: una pagina aperta deve
  // accorgersi di una richiesta nuova. Le opzioni sono del modulo condiviso: stesso esito.
  function opzioniFusioni(extra) {
    const UI = window.SN_MERGE_APPROVALS;
    return Object.assign({
      onDone: () => { setTimeout(loadMergeApprovals, 1200); },
      onApprove: (req) => sendToMain({ type: MERGE_APPROVAL_APPROVE, id: req.id }),
      onDiscard: (req) => sendToMain({ type: MERGE_APPROVAL_DISCARD, id: req.id }),
      onFeedback: (req) => openFeedbackByNum(UI ? UI.feedbackNum(req) : ''),
    }, extra || {});
  }

  // Le richieste ferme senza una scheda in lista. Finché i feedback non sono arrivati ci finiscono
  // tutte: meglio mostrarne una due volte che perderla.
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
    fusioni = {
      pending: r.pending || [],
      failed: r.failed || [],
      recent: r.recent || [],
      // Il campanello del main manda solo ciò che è cambiato: il resto vale finché non si rilegge.
      preapproved: Array.isArray(r.preapproved) ? r.preapproved : (fusioni.preapproved || []),
    };
    const n = renderFusioniOrfane();
    // Una richiesta nuova deve vedersi subito, senza riaprire la pagina.
    riflettiFusioni();
    UI.renderRecent(mgMergeApprovalsRecent, { recent: r.recent || [] });
    // Le fuse senza chiedere: il controllo a posteriori del segno sulla pratica.
    if (mgMergeApprovalsPreapproved && (Array.isArray(r.preapproved) || !already)) {
      UI.renderPreapproved(mgMergeApprovalsPreapproved, {
        preapproved: r.preapproved || [],
        preapprovedTotal: r.preapprovedTotal,
        onFeedback: (req) => openFeedbackByNum(UI.feedbackNum(req)),
      });
    }
    return n;
  }

  // Un cambiamento nelle fusioni si vede in due posti insieme: il quadrato della scheda aperta e
  // le card della lista (una fusione ferma le colora come un blocco).
  function riflettiFusioni() {
    if (selectedId && allFeedbacks.some((f) => f._id === selectedId)) {
      const fb = allFeedbacks.find((f) => f._id === selectedId);
      renderLivelliRow(fb);
      // Il pannello aperto si riempie di nuovo: se era il quadrato, dentro c'è una richiesta che
      // potrebbe non esistere più.
      if (livelloAperto) openSidebarLivello(fb, livelloAperto);
    }
    if (dataLoaded) renderList();
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

  // Le quattro tab-lista condividono `panel-list`: cambia solo quale sottoinsieme popola la lista.
  // Le segnaposto hanno il loro pannello.
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
      // La frase scritta e non ancora partita se ne va con la selezione: si salva finché
      // `selectedId` dice a chi appartiene.
      salvaFraseAutomatico();
      // Cambiando tab si azzera la selezione: il feedback aperto può non essere nella nuova lista.
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
    window.removeEventListener('scroll', closeSortMenu, true);
    window.removeEventListener('resize', closeSortMenu);
  }
  function onSortOutside(e) {
    if (sortMenu && !sortMenu.contains(e.target)) closeSortMenu();
  }
  function onSortKeydown(e) {
    if (e.key === 'Escape') closeSortMenu();
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
      window.addEventListener('scroll', closeSortMenu, true);
      window.addEventListener('resize', closeSortMenu);
    }, 0);
  }
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
    return FB.listHitCap(allFeedbacks, FB.LIST_PAGE_SIZE);
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
    if (n !== null && n !== undefined && loadHitCap()) mgListHead.title = FB.COUNT_CAP_HINT;
    else mgListHead.removeAttribute('title');
  }

  function updateTabCounts() {
    // Sezioni non disegnabili: niente da numerare. Uscire QUI evita di lasciare «(3) (0) (0) (0)»
    // appiccicato ai bottoni nascosti.
    if (!sezioniAttendibili()) return;
    const counts = dataLoaded
      ? MR.manageTabCounts(allFeedbacks, { releasedVersion, starredOnly, confirmedOnly })
      : null;
    const capped = counts ? loadHitCap() : false;
    for (const tab of LIST_TABS) {
      const btn = mgTabs.querySelector(`.mg-tab[data-tab="${tab}"]`);
      if (!btn) continue;
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

  // Rendering colonna sinistra
  function renderList() {
    mgListLoading.hidden = true;
    mgListEmpty.textContent = TAB_EMPTY[currentTab] || 'Nessun feedback.';

    // Stato illeggibile → niente sezioni: un elenco solo, i più recenti in cima, come la gemella.
    // Nome e filtri di sezione qui non si possono applicare.
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

    if (isArchived) {
      // OFF = solo i feedback `archived`; ON = tutti i preferiti ⭐, di ogni stato. La stessa
      // funzione conta la scheda, così numero e lista non divergono.
      currentList = MR.listArchiveTab(allFeedbacks, { starredOnly, confirmedOnly });
      mgListEmpty.textContent = confirmedOnly
        ? 'Nessun attacco o spam confermato.'
        : starredOnly
          ? 'Nessun feedback preferito.'
          : (TAB_EMPTY.archived || 'Nessun feedback archiviato.');
    } else {
      // DB3: la versione rilasciata fa sì che «Risolti» contenga solo i fix in produzione; i
      // done non ancora spediti restano in «In coda». La tab deriva SOLO dallo status.
      currentList = MR.listForManageTab(allFeedbacks, currentTab, { releasedVersion });
    }

    // Una fusione ferma È una decisione dell'owner: la sua segnalazione sale in cima alla scheda, o
    // chi scorre non saprebbe che un ramo è fermo lì.
    currentList = pinFusioniFerme(currentList);

    // Override scelto dal menu contestuale; in 'smart' resta l'ordine predefinito sopra.
    currentList = applySortMode(currentList);

    // #495: l'ordinamento non cambia il numero, quindi si conta qui.
    updateTabCounts();
    setListHead(TAB_LABELS[currentTab] || '', dataLoaded ? currentList.length : null);
    renderListBody();
    // Chi è «senza feedback» dipende da quali feedback ci sono: quando la lista cambia,
    // l'elenco in Automazioni si rifà, o una richiesta si leggerebbe due volte.
    renderFusioniOrfane();
  }

  function fusioneFerma(fb) {
    return MR.fusioneInAttesa(fb, { fusioni });
  }

  // Le segnalazioni con una fusione ferma davanti a tutte, conservando fra loro l'ordine
  // (`sort` è stabile).
  function pinFusioniFerme(lista) {
    return lista.slice().sort((a, b) => (fusioneFerma(b) ? 1 : 0) - (fusioneFerma(a) ? 1 : 0));
  }

  // La parte che NON dipende da quale sezione si guarda: la condivide anche l'elenco unico di
  // quando le sezioni non ci sono.
  function renderListBody() {
    // Col caricamento al tetto una sezione «vuota» può non esserlo: i più vecchi non sono qui.
    // Il vuoto lo dice, invece di negarli.
    if (loadHitCap() && dataLoaded) {
      mgListEmpty.textContent = `${mgListEmpty.textContent} ${FB.COUNT_CAP_HINT}`;
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
      // In lavorazione (working/revision_*): seconda riga col passaggio corrente dell'iter e se
      // un'istanza ci lavora ORA. Solo in «In coda», dove queste card sono pinnate in cima.
      const progress = (leggibile && currentTab === 'queue') ? MR.workProgress(fb) : null;
      item.className = 'mg-item'
        + (fb._id === selectedId ? ' mg-item--selected' : '')
        + unfilteredCls
        + alignedCls
        + (progress ? ' mg-item--staged' : '')
        + (progress && progress.active ? ' mg-item--active-work' : '');
      item.dataset.id = fb._id;
      // Una fusione ferma aspetta l'owner quanto un blocco: stessa tinta rossa, così si riconosce
      // scorrendo la lista.
      const ferma = fusioneFerma(fb);
      if (ferma) item.classList.add('mg-item--fusione');
      item.style.borderLeftColor = ferma
        ? MR.REASONS.secaudit.color
        : (cl ? cl.color : (aligned ? MR.ALIGNED_COLOR : 'transparent'));
      // Una riga sola: #N · titolo. Il motivo resta implicito nel colore del border-left; titolo
      // completo e sottotesto dello stato nel tooltip.
      const norm = leggibile ? MR.normalizeStatus(fb) : { status: null, statusReason: null };
      // Quante volte questo lavoro si è arenato: si legge `stalls`, che non si azzera, e non
      // `workingResets`, che una consegna vera azzera — facendo sparire il numero quando serve.
      const ripartenze = Math.max(0, Math.round(
        Number(fb.stalls) || Number(fb.workingResets) || 0
      ));
      item.title = (num ? `#${num} · ` : '') + title
        + (norm.statusReason ? ` — ${MR.reasonText(norm.statusReason)}` : '')
        + (ferma ? ' — una fusione aspetta il tuo via libera' : '')
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
        // Il click su un pallino priorità non apre il dettaglio (lo gestisce il listener delegato).
        if (e.target.closest('.mg-dot')) return;
        openDetail(fb._id);
      });
      mgList.appendChild(item);
    }
  }

  // Quello che si sa di una segnalazione cifrata, dall'enum in chiaro `statusPublic`; le
  // parole le dà il modulo condiviso. Se manca non si scrive: meglio vuoto che inventato.
  function statePublicHtml(fb) {
    const label = MR.publicStateLabel(fb);
    if (!label) return '';
    return `<span class="mg-state" title="${esc(`Stato: ${label} — ${MR.PUBLIC_STATE_HINT}`)}">${esc(label)}</span>`;
  }

  // «Fondi senza chiedermelo»: il segno `mergePreapproved`, in chiaro. A pratica chiusa non
  // si mostra: sarebbe un'informazione su niente.
  function preapprovedOf(fb) {
    const m = fb && fb.mergePreapproved;
    if (!m || typeof m !== 'object' || !String(m.by || '').trim()) return null;
    return { by: String(m.by || ''), at: String(m.at || '') };
  }
  function isOpenPublic(fb) {
    return String((fb && fb.statusPublic) || 'open') !== 'closed';
  }
  function preapprovedHtml(fb) {
    const m = preapprovedOf(fb);
    if (!m || !isOpenPublic(fb)) return '';
    return `<span class="mg-preapproved" title="${esc(`Si fonde senza chiedere: segno messo da ${m.by}`)}">senza chiedere</span>`;
  }

  // Traduce l'avanzamento (MR.workProgress) in una riga leggibile: i tre passaggi
  // dell'iter come spunte (✓ fatto · ● in corso · ○ da fare) e se un'istanza ci lavora ora.
  function workStateHtml(progress) {
    const marks = { done: '✓', current: '●', pending: '○' };
    const steps = progress.steps.map((s) =>
      `<span class="mg-step mg-step--${s.state}" title="${esc(s.label)}: ${
        s.state === 'done' ? 'fatto' : s.state === 'current' ? 'in corso' : 'da fare'
      }">${marks[s.state]} ${esc(s.label)}</span>`
    ).join('<span class="mg-step-sep">·</span>');
    // «Sta lavorando ora» si legge dal battito, non dall'ora della presa in carico, o ogni
    // lavorazione più lunga di un'ora verrebbe dichiarata morta. Nessun tempo promesso.
    const who = progress.active
      ? `<span class="mg-work-live"><i></i>Un'istanza ci sta lavorando ora</span>`
      : `<span class="mg-work-idle">${
          progress.current.key === 'impl'
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
    // Senza il criterio ogni segnalazione cifrata ricadrebbe fra i bianchi, e la barra offrirebbe
    // di ri-giudicare anche i chiusi.
    const whites = sezioniAttendibili() ? unfilteredFeedbacks() : [];
    // Solo l'owner, solo nei Ricevuti (dove vivono i bianchi), solo se ce n'è.
    const show = isAdmin && currentTab === 'inbox' && whites.length > 0;
    mgReevalBar.hidden = !show;
    if (show && mgReevalBtn) mgReevalBtn.textContent = `Ri-valuta i non filtrati (${whites.length})`;
  }

  // Approvare È scrivere `todo`: l'automatica non sposta più nulla nelle liste, quindi i blu si
  // mettono in coda da qui (o uno a uno dal dettaglio).
  function alignedFeedbacks() {
    // Stesso motivo dei bianchi: «allineato» è una lettura dello status, e approvare in
    // blocco quello che non si è potuto leggere è la scrittura più pesante della pagina.
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
  }

  // Durante la ricerca la lista è trasversale alle schede: le barre della scheda spariscono.
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
    searchMode = false;
    if (mgSearchBar) mgSearchBar.hidden = true;
    if (mgSearchInput) mgSearchInput.value = '';
    toggleSearchIcon(false);
    setSearchMsg('', null);
    if (!keepList) renderList();
  }

  // `reason` (il perché è pertinente) vive nel tooltip, non nel colore del bordo.
  function renderSearchResults(results, opts) {
    const fallback = !!(opts && opts.fallback);
    hideTabBars();
    mgListLoading.hidden = true;
    mgList.innerHTML = '';
    setSearchMsg(fallback ? 'Modello non disponibile: mostro i risultati per testo.' : '', null);

    // «Nessun risultato» al tetto significa «fra quelli caricati»: la ricerca legge solo i feedback
    // che stanno in pagina.
    const nessuno = () => {
      mgList.hidden = true;
      mgListEmpty.hidden = false;
      mgListEmpty.textContent = 'Nessun feedback pertinente.'
        + (loadHitCap() ? ` ${FB.COUNT_CAP_HINT}` : '');
    };

    if (!results.length) {
      // Quanti ne ha trovati è la domanda della ricerca: zero è una risposta e si scrive (#495).
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
    // Si contano le card DAVVERO disegnate: un risultato il cui feedback non è più fra i caricati
    // non si mostra, e non si conta.
    setListHead('Ricerca', shown);
    if (!shown) nessuno();
  }

  async function runSearch(rawQuery) {
    if (!searchMode || !SRCH) return;
    const query = String(rawQuery || '').trim();
    if (!query) {
      // Campo svuotato: torna all'invito, e il numero se ne va coi risultati.
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

    // Via il numero della ricerca precedente, che qui sarebbe già falso.
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
        // Funzione propria e non quella di «Categorizza»: in prestito, cambiarne uno cambiava
        // l'altra. Non style-aware (il prompt JSON non va inquinato) e fuori dalla cronologia.
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
  // Esc chiude la ricerca anche col focus fuori dal campo. Idempotente.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchMode && (!mgSearchInput || document.activeElement !== mgSearchInput)) {
      closeSearch();
    }
  });

  // `opts.ridisegno` = non è l'owner che apre una segnalazione, è il pannello che si
  // ridipinge da sé: una sezione che l'owner ha aperto non deve richiudersi mentre la guarda.
  function openDetail(id, opts) {
    const ridisegno = !!(opts && opts.ridisegno && id === selectedId);
    // La frase nella casella e non ancora partita parte ADESSO, finché `selectedId` è quello di
    // prima: un istante dopo finirebbe sul feedback sbagliato.
    if (!ridisegno) salvaFraseAutomatico();
    // Cambiando segnalazione il pannello di destra riparte da zero: la forma scelta era di un'altra
    // pratica. Su un ridisegno resta dov'era.
    if (!ridisegno) livelloAperto = null;
    selectedId = id;

    document.querySelectorAll('.mg-item').forEach((el) => {
      el.classList.toggle('mg-item--selected', el.dataset.id === id);
    });

    const fb = allFeedbacks.find((f) => f._id === id);
    if (!fb) return;

    mgDetailEmpty.hidden = true;
    mgDetail.hidden = false;

    // Tutto ciò che il pannello dice partendo dallo stato passa da qui: la regola della barra delle
    // sezioni, un gradino più in dentro.
    const leggibile = statoLeggibile(fb);

    const clientId = fb.clientId || 'anonimo';
    const dateStr  = formatDate(fb.createdAt);
    // Chi ha scritto, in chiaro (#443): l'identificativo grezzo diceva «filo:chat» dove serve
    // leggere «Filo, per conto di un utente». Resta ispezionabile nell'hover.
    mgDetailHead.innerHTML = `Da <a class="mg-sender-link" id="senderLink" href="#" data-client="${esc(clientId)}" title="${esc(clientId)}">${esc(senderLabel(fb))}</a> il ${dateStr}`;
    document.getElementById('senderLink').addEventListener('click', (e) => {
      e.preventDefault();
      openSidebarSender(clientId);
    });

    renderLivelliRow(fb);

    // Solo per i feedback nell'iter; stessi contenuti della card pinnata in lista.
    if (mgWorkState) {
      const progress = leggibile ? MR.workProgress(fb) : null;
      mgWorkState.hidden = !progress;
      mgWorkState.innerHTML = progress ? workStateHtml(progress) : '';
    }

    renderThread(fb);

    // QUALI azioni offrire lo dice MR.ownerActions, la stessa tabella della gemella. Stato
    // illeggibile: niente da offrire — «→ In coda» su una pratica forse chiusa è peggio.
    const normSel = leggibile ? MR.normalizeStatus(fb) : { status: null, statusReason: null };
    // `design` con domande → box risposta.
    const isClarify = normSel.status === 'design' && (normSel.statusReason === 'clarify' || (fb.status || '') === 'clarify');
    renderActions(fb);
    mgClarify.hidden = !(isAdmin && isClarify);
    mgClarifyText.value = '';
    setClarifyMsg('', '');

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

    // Su un ridisegno la forma che l'owner stava leggendo resta aperta e si riempie di nuovo:
    // con una segnalazione lunga, richiuderla perde il punto. Cambiando pratica si chiude.
    if (ridisegno && livelloAperto) riapriPannelloLivello(fb);
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
    reflectPreapproved(fb);
  }

  // Sulle pratiche chiuse il tasto sparisce: il segno lì non conta.
  function reflectPreapproved(fb) {
    if (!mgPreapproveBtn) return;
    const m = preapprovedOf(fb);
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
      mgPreapprovedInfo.hidden = !(m && aperta);
      mgPreapprovedInfo.textContent = m && aperta
        ? `Si fonde senza chiedere: segno messo da ${m.by}${m.at ? ` il ${formatDateTime(m.at)}` : ''}.`
        : '';
    }
  }

  // Il CHI lo scrive il main dalla sessione: da qui parte solo sì/no.
  async function togglePreapproved() {
    if (!selectedId || !mgPreapproveBtn) return;
    const id = selectedId;
    const fb = allFeedbacks.find((f) => f._id === id);
    if (!fb) return;
    const next = !preapprovedOf(fb);
    mgPreapproveBtn.disabled = true;
    setManageMsg(next ? 'Segno la pratica…' : 'Tolgo il segno…', '');
    try {
      const r = await sendToMain({ type: 'feedback_update', id, mergePreapproved: next });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'aggiornamento rifiutato');
      // Qui basta che il segno ci sia; l'email la porta l'aggiornamento continuo.
      fb.mergePreapproved = next ? { by: (r && r.by) || 'te', at: new Date().toISOString() } : undefined;
      if (selectedId !== id) { renderList(); return; }
      reflectPreapproved(fb);
      renderList();
      setManageMsg(next ? 'Da ora si fonde senza chiedere.' : 'Da ora ti chiede prima di fondere.', 'ok');
    } catch (e) {
      if (selectedId !== id) return;
      setManageMsg(e.message || 'Errore', 'err');
    } finally {
      mgPreapproveBtn.disabled = false;
    }
  }
  if (mgPreapproveBtn) mgPreapproveBtn.addEventListener('click', togglePreapproved);

  // L'etichetta di stato non si scrive nel dettaglio (scelta dell'owner): lo dicono il colore
  // della scheda e le forme, e la decisione presa si legge nel pannello del triangolo.

  // Ogni azione ha un id stabile, così resta indirizzabile da fuori. Archivia e Ripristina
  // condividono l'id: sono i due versi della stessa azione e non compaiono mai insieme.
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
      b.title = ACTION_TITLE[a.key] || a.label;
      b.addEventListener('click', () => {
        if (a.kind === 'reopen') { apriRiapertura(); return; }
        applyAction(a, null);
      });
      mgActionsRow.appendChild(b);
    }
  }

  // Una scrittura in volo spegne TUTTA la riga: «Archivia» premuto mentre «→ In coda» è in volo
  // scriverebbe due decisioni sulla stessa segnalazione.
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
    // Il guardiano sta SOTTO ai pulsanti: si scrive solo uno stato che la segnalazione offre
    // adesso, o un pannello rimasto aperto riscrive un attacco confermato ad «archiviato».
    if (!MR.ownerActionAllowsStatus(fb, action.to, { releasedVersion })) {
      renderActions(fb);
      setActionMsg('Lo stato di questa segnalazione è cambiato: questa azione non è più disponibile.', 'err');
      return;
    }
    // La riga per chi ha segnalato parte PRIMA del cambio di stato, e il cambio non parte se lei
    // non è arrivata: è il modo più facile di perdere l'unica frase che il mittente leggerà.
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
    const comment = (mgAcceptComment && !mgAcceptComment.hidden) ? (mgAcceptComment.value || '').trim() : '';
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

    setActionsBusy(true);
    setActionMsg(ACTION_PROGRESS[action.key] || 'Salvo…', '');
    try {
      const r = await sendToMain(payload);
      if (!r || r.ok === false) throw new Error((r && r.error) || 'aggiornamento rifiutato');
      Object.assign(fb, locale);
      updateTabCounts();
      // Nell'attesa l'owner può aver aperto un ALTRO feedback: il dato si salva e la lista si
      // ridisegna, ma il pannello no — chiuderlo chiuderebbe il dettaglio dell'altro.
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

  function confermaRiapertura() {
    const fb = allFeedbacks.find((f) => f._id === selectedId);
    if (!fb) return;
    const azione = MR.ownerActionFor(fb, 'reopen', { releasedVersion });
    if (!azione) {
      chiudiRiapertura();
      renderActions(fb);
      setActionMsg('Questa segnalazione non è più riapribile: lo stato è cambiato.', 'err');
      return;
    }
    const oldNotes = String(fb.notes || '');
    if (conversazioneIlleggibile(fb)) { setActionMsg(RIAPERTURA_ILLEGGIBILE, 'err'); return; }
    const reason = mgReopenText ? (mgReopenText.value || '').trim() : '';
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

  function setClarifyMsg(text, kind) {
    mgClarifyMsg.textContent = text || '';
    mgClarifyMsg.className = 'mg-action-msg' + (kind ? ` mg-${kind}` : '');
  }

  // La risposta si appende alle note come turno utente (lo storico si preserva) e il feedback
  // rientra in coda.
  async function sendClarifyReply() {
    if (!selectedId) return;
    const id = selectedId;
    const reply = (mgClarifyText.value || '').trim();
    if (!reply) { mgClarifyText.focus(); return; }
    const fb = allFeedbacks.find((f) => f._id === id);
    const oldNotes = (fb && fb.notes) || '';
    // La conversazione può arrivare illeggibile: appenderci sopra la risposta e risalvare
    // cancellerebbe il report vero. Si scrive solo su ciò che si è potuto leggere.
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

    mgClarifyBtn.disabled = true;
    setClarifyMsg('Invio in corso…', '');
    try {
      const r = await sendToMain({ type: 'feedback_update', id, status: 'todo', notes: newNotes });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'aggiornamento rifiutato');
      if (fb) { fb.status = 'todo'; fb.notes = newNotes; }
      // Come sopra: il dato si salva e la lista si ridisegna, il pannello no.
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
  let userNoteTimer = null;
  // L'ultimo salvataggio partito e COSA portava: chi deve sapere se la frase è a destinazione
  // aspetta questo, invece di spedirla di nuovo.
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
  function annullaSalvataggioProgrammato() {
    if (userNoteTimer) { clearTimeout(userNoteTimer); userNoteTimer = null; }
  }
  function programmaSalvataggioFrase() {
    annullaSalvataggioProgrammato();
    userNoteTimer = setTimeout(() => { userNoteTimer = null; salvaFraseAutomatico(); }, FRASE_PAUSA_MS);
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
    mgUserNoteText.addEventListener('input', () => { userNoteToccata = true; programmaSalvataggioFrase(); });
    mgUserNoteText.addEventListener('blur', () => { salvaFraseAutomatico(); });
    mgUserNoteText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); salvaFraseAMano(); }
    });
  }

  function setActionMsg(text, kind) {
    mgActionMsg.textContent = text || '';
    mgActionMsg.className = 'mg-action-msg' + (kind ? ` mg-${kind}` : '');
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

  // I disegni delle quattro forme, in una griglia di 16.
  const FORME_SVG = {
    triangolo: 'M8 2 L14.5 13.6 L1.5 13.6 Z',
    rombo:     'M8 1.4 L14.6 8 L8 14.6 L1.4 8 Z',
    pentagono: 'M8 1.4 L14.6 6.3 L12.1 14.2 L3.9 14.2 L1.4 6.3 Z',
    quadrato:  'M2.6 2.6 H13.4 V13.4 H2.6 Z',
  };

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
    for (const liv of MR.livelli(fb, { fusioni })) {
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

  // La conversazione completa, un turno per bolla: segnalazione → parere di Filo → commento
  // dell'owner → turni della lavorazione, parsati dalle note col modulo condiviso dei thread.
  function renderThread(fb) {
    mgThread.innerHTML = '';
    const TH = window.SN_FEEDBACK_THREAD;

    // I file non-immagine vivono nel campo piatto files[] ({ name, url, type }): senza mapparli
    // qui l'allegato del tester è invisibile in questa pagina e visibile nella gemella.
    const fromModel = TH ? TH.isFromModel(fb.clientId) : false;
    const imgs = (Array.isArray(fb.images) ? fb.images : []).map((url) => ({ kind: 'img', url }));
    const files = (Array.isArray(fb.files) ? fb.files : [])
      .filter((f) => f && typeof f.url === 'string' && f.url)
      .map((f) => ({ kind: 'file', url: f.url, name: f.name, type: f.type }));
    appendBubble(fromModel ? 'model' : 'user', fromModel ? 'Filo (segnalazione automatica)' : 'Utente',
      esc(fb.text || ''), imgs.concat(files));

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
      // «non ha ANCORA un parere» si legge come «sta arrivando»: vero solo finché la segnalazione
      // aspetta una decisione. Senza il criterio si dice il fatto: nessun verdetto è arrivato.
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

    // Le note contengono report, esiti del controllo e risposte dell'owner, in ordine: li separa il
    // parser condiviso.
    const notes = String(fb.notes || '');
    // Report illeggibile su questo computer: al posto del blob si dice perché.
    if (TH && TH.reportUnreadable && TH.reportUnreadable(notes)) {
      appendBubble('model', 'Filo', esc('Il report della lavorazione è cifrato e questo computer non ha la chiave privata per leggerlo.'));
      appendFraseBubble(fb);
      return;
    }
    if (!TH) {
      // Fallback senza parser: mostra il blob intero come un turno unico.
      if (notes.trim()) appendBubble('model', 'Filo (lavorazione)', esc(notes));
      appendFraseBubble(fb);
      return;
    }
    for (const seg of TH.splitNotes(notes)) {
      const when = seg.ts ? ` — ${seg.ts}` : '';
      const who = seg.role === 'user' ? `Tu${when}` : `Filo (lavorazione${when})`;
      appendBubble(seg.role === 'user' ? 'user' : 'model', who, esc(seg.body), seg.attachments);
    }
    appendFraseBubble(fb);
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

  // Segna quale forma guarda il pannello: con cinque forme in fila non si saprebbe più quale si
  // era premuta.
  function segnaForma(key) {
    livelloAperto = key || null;
    if (!mgForme) return;
    mgForme.querySelectorAll('.mg-forma').forEach((el) => {
      el.classList.toggle('mg-forma--scelta', el.dataset.livello === livelloAperto);
    });
  }

  // L'esito deve arrivare anche a pannello chiuso o scheda cambiata.
  let mgToastTimer = null;
  function toast(text, kind) {
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
    // Le frasi degli esiti sono lunghe: quattro secondi e mezzo per leggerle.
    mgToastTimer = setTimeout(() => el.classList.remove('show'), 4500);
  }

  // Il contenuto di un livello arriva pronto dal modulo condiviso: qui restano il markup e i
  // due pezzi che il markup non può avere (tasti della fusione, «Salta il controllo»).
  function openSidebarLivello(fb, key) {
    if (!fb) return;
    const liv = MR.livelloPer(fb, key, { fusioni });
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
        // Le date arrivano in ISO dal server: qui si scrivono come nel resto della pagina.
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
        // Titoli e voci d'elenco del markdown resi come tali, il resto come testo: niente HTML dal
        // testo.
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

  // «Salta il controllo» si offre su una bocciatura dell'audit e sulle pratiche ferme prima
  // che l'audit lasciasse traccia (`design` con motivo `secaudit`): o non avrebbero uscita.
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

    // Un secondo clic per confermare: scavalcare un controllo di sicurezza non è da un click solo.
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
        // L'esito cambia il pentagono e, se si era aperta una richiesta, il quadrato: si rilegge
        // tutto invece di indovinare.
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

    // Un giudice che non ha votato: il cerchio è tratteggiato e cliccarlo dice PERCHÉ. Un buco si
    // spiega, non si tace.
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
      // Stesso criterio della lista: un bordo colorato è un'affermazione sullo stato, che su una
      // cifrata la macchina inventa.
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

  // Caricamento dati
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
      // Il tetto viene dal modulo condiviso: due numeri a mano prima o poi divergono. La prima
      // lettura parte in init, prima delle altre letture di avvio: qui la si aspetta soltanto.
      const pending = firstListPromise;
      firstListPromise = null;
      const fresh = await (pending || FB.list({ pageSize: FB.LIST_PAGE_SIZE }));
      // Dati finti iniettati da uno spec vincono: la lista vera arrivata dopo non li sovrascrive
      // (era una gara persa a caso).
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
    liveLastAt = Date.now();
  }

  // Indice per mittente (lo usa il pannello laterale): si rifà a ogni caricamento e a ogni giro.
  function reindexByClient() {
    allByClient = {};
    for (const fb of allFeedbacks) {
      const c = fb.clientId || '__anon__';
      if (!allByClient[c]) allByClient[c] = [];
      allByClient[c].push(fb);
    }
  }

  // Aggiornamento continuo: a ogni giro le sole versioni, poi i soli documenti cambiati,
  // decifrati e fusi. Confronto e fusione sono logica pura in SN_FEEDBACK_LIVE.
  const LIVE = window.SN_FEEDBACK_LIVE;
  // Sorgenti sostituibili dagli spec (che non hanno Firestore).
  const liveSources = {
    listVersions: (o) => FB.listVersions(o),
    getMany: (ids) => FB.getMany(ids),
  };
  let liveEnabled = false;
  let liveBlocked = false;  // dati finti iniettati: il giro non parte più, nemmeno se l'avvio finisce dopo
  let liveTimer   = null;
  let liveTick    = null;   // promessa del giro in corso: uno alla volta
  let liveLastAt  = 0;      // quando la lista è stata allineata l'ultima volta

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
    return false;
  }

  // La scheda aperta non è più in pagina: il pannello si chiude, ma non se c'è una bozza in
  // corso (resta finché l'owner non la svuota).
  function closeDetailIfGone() {
    if (!selectedId || allFeedbacks.some((f) => f._id === selectedId)) return false;
    if (detailBeingEdited()) return true;
    selectedId = null;
    mgDetail.hidden = true;
    mgDetailEmpty.hidden = false;
    return true;
  }

  // Ridisegna senza perdere scorrimento né selezione. True se il DETTAGLIO è stato ridisegnato
  // davvero: distingue «trattenuto da una bozza» da «niente da ridisegnare».
  function rerenderAfterLive(touched) {
    if (!dataLoaded) return false;
    if (!searchMode) {
      const scrollers = [mgList, mgList && mgList.parentElement].filter(Boolean);
      const tops = scrollers.map((el) => el.scrollTop);
      renderList();
      scrollers.forEach((el, i) => { el.scrollTop = tops[i]; });
    }
    if (!selectedId || closeDetailIfGone()) return false;
    if (touched.has(selectedId) && !detailBeingEdited()) {
      // Ridisegno, non una nuova apertura: la sezione della frase resta come l'ha lasciata l'owner.
      openDetail(selectedId, { ridisegno: true });
      return true;
    }
    return false;
  }

  // Un giro: versioni → differenze → documenti cambiati → decifratura → fusione. Ritorna
  // { changed }. Un giro già in corso viene riusato, non raddoppiato.
  async function refreshFromRemote() {
    if (liveTick) return liveTick;
    liveTick = (async () => {
      const remote = await liveSources.listVersions({ pageSize: FB.LIST_PAGE_SIZE, timeoutMs: 20000 });
      // Una risposta che non è un elenco non è «tutto sparito»: è un guasto, e lascia la lista
      // com'è.
      if (!Array.isArray(remote)) throw new Error('versioni non lette');
      const { changed, added, removed } = LIVE.diffVersions(allFeedbacks, remote);
      const ids = changed.concat(added);
      if (ids.length === 0 && removed.length === 0) {
        // Niente di nuovo, ma una scheda sparita in un giro precedente (tenuta aperta per una
        // bozza) può chiudersi ora.
        closeDetailIfGone();
        return { changed: 0 };
      }
      let fresh = ids.length > 0 ? await liveSources.getMany(ids) : [];
      if (isAdmin && fresh.length > 0) {
        try {
          const r = await sendToMain({ type: 'feedback_decrypt_fields', list: fresh });
          if (r && r.ok && Array.isArray(r.list)) fresh = r.list;
        } catch (_) { /* come al caricamento: valori cifrati piuttosto che niente */ }
      }
      allFeedbacks = LIVE.applyChanges(allFeedbacks, { fresh, removed });
      reindexByClient();
      rerenderAfterLive(new Set(ids));
      return { changed: ids.length + removed.length };
    })().finally(() => { liveTick = null; liveLastAt = Date.now(); });
    return liveTick;
  }

  function liveTickIfDue(force) {
    if (!liveEnabled || document.hidden) return;
    if (!force && Date.now() - liveLastAt < LIVE.POLL_MS / 2) return;
    // Il primo caricamento fallito lo ritenta il giro, invece di lasciare «Errore nel caricamento»
    // finché l'owner non ricarica a mano.
    if (!dataLoaded) { loadData().catch(() => {}); return; }
    refreshFromRemote().catch((e) => console.warn('[manage] aggiornamento:', e?.message || e));
  }

  function startLive() {
    if (!LIVE || liveEnabled || liveBlocked) return;
    liveEnabled = true;
    liveTimer = setInterval(() => liveTickIfDue(true), LIVE.POLL_MS);
    // Scheda tornata in vista o finestra in primo piano: se è passato abbastanza tempo, non
    // aspettare il prossimo battito.
    document.addEventListener('visibilitychange', () => liveTickIfDue(false));
    window.addEventListener('focus', () => liveTickIfDue(false));
  }

  function stopLive() {
    liveEnabled = false;
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  }

  // Hook di test: gli spec iniettano feedback e aprono il dettaglio esercitando il VERO codice di
  // rendering. Inerte in produzione.
  window.__mgTest = {
    setData(fbs) {
      // Dati finti al posto dei veri: l'aggiornamento continuo si ferma, o al primo giro li
      // rimpiazzerebbe. Fermo E bloccato: se l'avvio vero finisce dopo, non deve ripartire.
      stopLive();
      liveBlocked = true;
      testDataInjected = true;
      allFeedbacks = Array.isArray(fbs) ? fbs : [];
      dataLoaded = true;
      loadFailed = false;
      reindexByClient();
      renderList();
    },
    // Caricamento FALLITO su richiesta: lo spec si affidava al fatto che nel sandbox Firestore
    // non è raggiungibile, e su una macchina di sviluppo quel rosso parlava della sua rete.
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
    // Un giro subito (ritorna { changed }) e le sorgenti finte { listVersions, getMany }.
    pollNow() { return refreshFromRemote(); },
    // Un giro di ridisegno da aggiornamento remoto: i test verificano che una bozza lo trattenga.
    rerenderIfIdle(id) { return rerenderAfterLive(new Set([id])); },
    setLiveSources(src) { Object.assign(liveSources, src || {}); },
    isLiveOn() { return liveEnabled; },
    setAdmin(v) { setIsAdmin(!!v); applyAutoModeGate(); },
    // Ri-legge i contatori del verificatore dalla fonte (IPC) — per i test.
    loadCaps,
    // Ri-legge il timeout dei giudici (IPC) — usato dai test dopo lo stub.
    loadJudgeTimeout,
    // Ri-legge la config dell'automatica (IPC) — per i test.
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
    // Ricerca «a senso»: stato e trigger per gli spec.
    isSearchMode() { return searchMode; },
    runSearch(q) { return runSearch(q); },
  };

  // Sezione «Modelli di supporto» (DD1). Slot → editor a segmenti (buildChain). Caricato pigro,
  // alla prima apertura della tab.
  const SM_SLOTS = ['sanitizer', 'judge1', 'judge2', 'judge3', 'judgeDynamic', 'judgeRedTeam', 'judgePriority'];
  // Etichette amichevoli per slot: l'id grezzo non va mai mostrato. L'HTML ha già le <label>
  // statiche; questa mappa è la sorgente di verità se venissero generate dal JS.
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
    // Registro condiviso predefinito (ripiego comodo: flash, haiku, …).
    const shared = (window.SN_CONST && window.SN_CONST.DEFAULT_MODEL_REGISTRY) || {};
    for (const nick of Object.keys(shared)) addNick(nick, (shared[nick] || {}).label);
  }

  // Registro modelli dei giudici: nickname + stringa modello. Provider implicito OpenRouter (il
  // backend dei giudici è OpenRouter-only).
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

    // Un nickname compare fra i suggerimenti solo quando ha anche un modello.
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

  function renderSmSlots(models) {
    const ModelChain = window.SN_MODEL_CHAIN;
    if (!ModelChain) return;
    smChains = {};
    for (const slot of SM_SLOTS) {
      const host = document.getElementById(`mgSmChain-${slot}`);
      if (!host) continue;
      const slotEl = host.closest('.mg-sm-slot');
      const labelEl = slotEl && slotEl.querySelector('label');
      if (labelEl && SM_SLOT_LABELS[slot]) labelEl.textContent = SM_SLOT_LABELS[slot];
      host.innerHTML = '';
      // Nessun validatore di azione (questi slot non sono in SN_CONST.ACTIONS): si accetta
      // qualunque nickname.
      const chain = ModelChain.buildChain(models[slot] || '', null, {});
      host.appendChild(chain.el);
      smChains[slot] = chain;
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

  // Caricamento pigro: alla prima selezione della tab «Modelli di supporto».
  mgTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.mg-tab');
    if (!btn || btn.dataset.tab !== 'models') return;
    if (!smLoaded && !smLoading) loadSupportModels();
  });

  // Tab «Log»: si ricarica a OGNI apertura, per vedere gli spawn nuovi. È una sola lettura di
  // documento, quindi a costo trascurabile.
  mgTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.mg-tab');
    if (!btn || btn.dataset.tab !== 'log') return;
    loadWorkerLog();
  });

  // Le fusioni si rileggono a OGNI apertura di Ricevuti e Automazioni: una richiesta appena
  // arrivata o già decisa renderebbe la sezione una fotografia vecchia.
  mgTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.mg-tab');
    if (!btn || (btn.dataset.tab !== 'automation' && btn.dataset.tab !== 'inbox')) return;
    loadMergeApprovals();
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
    // La lista è la più lenta (secondi di rete): parte SUBITO e le altre letture di avvio girano
    // mentre viaggia. loadData la aspetta; un errore lo raccoglie lì.
    firstListPromise = FB.list({ pageSize: FB.LIST_PAGE_SIZE });
    firstListPromise.catch(() => {});
    injectSearchIcons();
    await loadLayout();
    await refreshAuth();
    applyAutoModeGate();
    // In parallelo e senza che una fallita fermi le altre (ognuna gestisce già il proprio errore).
    await Promise.allSettled([loadAutoMode(), loadSortMode(), loadCaps(), loadJudgeTimeout(), loadMergeApprovals()]);
    await loadData();
    startLive();
  }

  const bootDone = init().catch((e) => { console.error('[manage] init:', e); });
  // Gli spec devono poter aspettare la FINE del caricamento vero prima di iniettare dati finti,
  // o a metà test li sovrascrive.
  window.__mgTest.whenReady = () => bootDone;

})();
