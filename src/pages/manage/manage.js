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
  // I due contatori del verificatore (SPEC-RIDISEGNO-MAX.md §13):
  // failCap (M) = bocciature prima di fermarsi; improvableCap (N) = giri
  // «migliorabile» prima di promuovere e aprire il rilievo residuo.
  const mgFailCap     = document.getElementById('mgFailCap');
  const mgFailCapSave = document.getElementById('mgFailCapSave');
  const mgFailCapMsg  = document.getElementById('mgFailCapMsg');
  const mgImprovableCap     = document.getElementById('mgImprovableCap');
  const mgImprovableCapSave = document.getElementById('mgImprovableCapSave');
  const mgImprovableCapMsg  = document.getElementById('mgImprovableCapMsg');
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
  const mgDetailState = document.getElementById('mgDetailState');
  const mgJudgesRow   = document.getElementById('mgJudgesRow');
  const mgWorkState   = document.getElementById('mgWorkState');
  const mgThread      = document.getElementById('mgThread');

  // Revisione — pannello laterale
  const mgSideEmpty  = document.getElementById('mgSideEmpty');
  const mgSide       = document.getElementById('mgSide');
  const mgSideTitle  = document.getElementById('mgSideTitle');
  const mgSideClose  = document.getElementById('mgSideClose');
  const mgSideBody   = document.getElementById('mgSideBody');

  // Azioni (accetta/sblocca un bloccato, owner-only)
  const mgActions       = document.getElementById('mgActions');
  const mgAcceptComment = document.getElementById('mgAcceptComment');
  const mgAcceptBtn     = document.getElementById('mgAcceptBtn');
  const mgConfirmBtn    = document.getElementById('mgConfirmBtn');
  const mgActionMsg     = document.getElementById('mgActionMsg');

  // Risposta ai chiarimenti (owner-only)
  const mgClarify     = document.getElementById('mgClarify');
  const mgClarifyText = document.getElementById('mgClarifyText');
  const mgClarifyBtn  = document.getElementById('mgClarifyBtn');
  const mgClarifyMsg  = document.getElementById('mgClarifyMsg');
  const mgUserNote     = document.getElementById('mgUserNote');
  const mgUserNoteText = document.getElementById('mgUserNoteText');
  const mgUserNoteBtn  = document.getElementById('mgUserNoteBtn');
  const mgUserNoteMsg  = document.getElementById('mgUserNoteMsg');

  // Gestione feedback: preferito ⭐ + archivia/ripristina (owner-only)
  const mgManage     = document.getElementById('mgManage');
  const mgStarBtn    = document.getElementById('mgStarBtn');
  const mgArchiveBtn = document.getElementById('mgArchiveBtn');
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
    // Rilievi rimasti aperti quando un lavoro «migliorabile» viene promosso
    // (SPEC-RIDISEGNO-MAX.md §13): categoria propria, così leggendo la coda si
    // vede che nasce dal declassamento di una verifica, non da un'esplorazione.
    residuo:  { icon: '🧹', label: 'Claude (rilievi residui)' },
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
  const FAIL_CAP_KEY = (window.SN_CONST?.STORAGE_KEYS?.AUTOMATION_LOOP_CAP) || 'filo_automation_loop_cap';
  const IMPROVABLE_CAP_KEY = (window.SN_CONST?.STORAGE_KEYS?.AUTOMATION_IMPROVABLE_CAP) || 'filo_automation_improvable_cap';
  const AUTOMATION = window.SN_CONST?.AUTOMATION || { LOOP_CAP_MIN: 1, LOOP_CAP_MAX: 10 };
  // Default dei contatori dalla fonte unica (feedbackTransitions.js): la stessa
  // che il server incorpora al deploy. Mai due copie a mano.
  const VERIFIER_CAPS = window.SN_FB_TRANSITIONS?.VERIFIER_CAPS || { improvableCap: 3, failCap: 10 };

  // ── Canale main process ───────────────────────────────────────────────────
  function sendToMain(msg) {
    if (window.filo?.message)               return window.filo.message(msg);
    if (window.chrome?.runtime?.sendMessage) return window.chrome.runtime.sendMessage(msg);
    return Promise.reject(new Error('canale main non disponibile'));
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  async function refreshAuth() {
    try {
      const r = await sendToMain({ type: 'auth_status' });
      isAdmin = !!(r && r.isAdmin);
    } catch (_) {
      isAdmin = false;
    }
    mgBanner.hidden = isAdmin;
  }

  mgSignInBtn.addEventListener('click', () => {
    sendToMain({ type: 'auth_signin' }).catch(() => {});
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
    const mgFailCapBlock = document.getElementById('mgFailCapBlock');
    const mgImprovableCapBlock = document.getElementById('mgImprovableCapBlock');
    if (mgFailCapBlock)       mgFailCapBlock.classList.toggle('mg-auto-block--off', !routinesOn);
    if (mgImprovableCapBlock) mgImprovableCapBlock.classList.toggle('mg-auto-block--off', !routinesOn);
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
    if (mgFailCap)     mgFailCap.disabled = !isAdmin || !routinesOn;
    if (mgFailCapSave) mgFailCapSave.disabled = !isAdmin || !routinesOn;
    if (mgImprovableCap)     mgImprovableCap.disabled = !isAdmin || !routinesOn;
    if (mgImprovableCapSave) mgImprovableCapSave.disabled = !isAdmin || !routinesOn;
    if (mgProberIdle)  mgProberIdle.disabled = !isAdmin || !routinesOn;
    if (mgJudgeTimeout)     mgJudgeTimeout.disabled = !isAdmin;
    if (mgJudgeTimeoutSave) mgJudgeTimeoutSave.disabled = !isAdmin;
    applyAutoApproveGate();
  }

  // ── Contatori del verificatore a tre esiti (tab Automazioni) ──────────────
  // Due campi sul doc Firestore config/routines (SPEC-RIDISEGNO-MAX.md §13):
  //   failCap (M)       bocciature «fail» prima di fermarsi e chiamare l'owner;
  //   improvableCap (N) giri «migliorabile» prima di promuovere il lavoro e
  //                     aprire il feedback dei rilievi residui.
  // Li applica il SERVER quando registra i verdetti; chrome.storage.local è
  // solo una CACHE per mostrare subito un valore (e un ripiego offline).
  function clampCap(n, def) {
    n = Math.round(Number(n));
    if (!Number.isFinite(n)) return def;
    return Math.min(AUTOMATION.LOOP_CAP_MAX, Math.max(AUTOMATION.LOOP_CAP_MIN, n));
  }

  const CAPS_GET = (window.SN_MSG?.MSG?.AUTOMATION_CAPS_GET) || 'automation_caps_get';
  const CAPS_SET = (window.SN_MSG?.MSG?.AUTOMATION_CAPS_SET) || 'automation_caps_set';

  // I due campi condividono il meccanismo: descrizione una volta sola.
  const CAP_FIELDS = {
    failCap: {
      input: mgFailCap, save: mgFailCapSave, msg: mgFailCapMsg,
      def: VERIFIER_CAPS.failCap, cacheKey: FAIL_CAP_KEY,
    },
    improvableCap: {
      input: mgImprovableCap, save: mgImprovableCapSave, msg: mgImprovableCapMsg,
      def: VERIFIER_CAPS.improvableCap, cacheKey: IMPROVABLE_CAP_KEY,
    },
  };

  function setCapMsg(field, text, kind) {
    const el = CAP_FIELDS[field].msg;
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('mg-ok', kind === 'ok');
    el.classList.toggle('mg-err', kind === 'err');
  }

  async function loadCaps() {
    const remote = {};
    // Sorgente autorevole: Firestore via main (owner-gated).
    try {
      const r = await sendToMain({ type: CAPS_GET });
      if (r && r.ok) {
        if (r.failCap != null) remote.failCap = r.failCap;
        if (r.improvableCap != null) remote.improvableCap = r.improvableCap;
      }
    } catch (_) {}
    for (const [field, f] of Object.entries(CAP_FIELDS)) {
      if (!f.input) continue;
      let val = f.def;
      if (remote[field] != null) {
        val = clampCap(remote[field], f.def);
        chrome.storage.local.set({ [f.cacheKey]: val }).catch(() => {});
      } else {
        // Ripiego sulla cache locale (non admin / offline).
        try {
          const data = await chrome.storage.local.get(f.cacheKey);
          if (data[f.cacheKey] != null) val = clampCap(data[f.cacheKey], f.def);
        } catch (_) {}
      }
      f.input.value = String(val);
    }
  }

  async function saveCap(field) {
    const f = CAP_FIELDS[field];
    if (!f.input) return;
    const val = clampCap(f.input.value, f.def);
    f.input.value = String(val); // normalizza eventuali fuori-range
    try {
      // Scrive su Firestore (la config che il server dei verdetti legge); il
      // main applica il gate admin e ri-clampa. Usa il valore confermato.
      const r = await sendToMain({ type: CAPS_SET, [field]: val });
      if (!r || !r.ok) {
        setCapMsg(field, 'Salvataggio fallito.', 'err');
        if (r?.error) console.error(`[manage] salvataggio ${field}:`, r.error);
        return;
      }
      const saved = clampCap(r[field] != null ? r[field] : val, f.def);
      f.input.value = String(saved);
      chrome.storage.local.set({ [f.cacheKey]: saved }).catch(() => {});
      setCapMsg(field, 'Salvato.', 'ok');
    } catch (err) {
      setCapMsg(field, 'Salvataggio fallito.', 'err');
      console.error(`[manage] salvataggio ${field} fallito:`, err);
    }
  }

  for (const [field, f] of Object.entries(CAP_FIELDS)) {
    if (f.save) f.save.addEventListener('click', () => saveCap(field));
    // Digitando si azzera il messaggio di esito precedente.
    if (f.input) f.input.addEventListener('input', () => setCapMsg(field, '', null));
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
    f.input.min = String(AUTOMATION.LOOP_CAP_MIN);
    f.input.max = String(AUTOMATION.LOOP_CAP_MAX);
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
  // L'UNICA superficie dove si approvano (scelta owner 2026-08-26: prima
  // l'avviso stava anche sulla prima schermata del browser). Vive in cima ai
  // Ricevuti perché i Ricevuti sono le cose che aspettano una decisione
  // dell'owner, e questa è la più urgente: un ramo fermo finché lui non dice
  // sì o no. Il disegno e i bottoni li costruisce il modulo condiviso
  // (src/shared/mergeApprovals.js); qui c'è il posto dove appenderlo, la
  // lettura via IPC e il legame con la lista dei feedback.
  //
  // Quando non c'è niente in attesa il blocco resta invisibile: una sezione
  // vuota in una pagina di gestione è rumore, non informazione. Le decisioni
  // già prese restano invece elencate in Automazioni: un'eccezione ai
  // controlli di sicurezza deve lasciare una traccia che si può guardare.
  const mgMergeApprovals = document.getElementById('mgMergeApprovals');
  const mgMergeApprovalsRecent = document.getElementById('mgMergeApprovalsRecent');

  // Il pannello-lista è condiviso dalle quattro schede (Ricevuti / In coda /
  // Risolti / Archiviati): l'avviso appartiene SOLO ai Ricevuti, quindi la
  // visibilità dipende da due cose — c'è qualcosa da approvare, e si sta
  // guardando la scheda giusta. Il conteggio resta qui e il cambio scheda
  // riapplica la regola senza rileggere niente dal server.
  let mergeApprovalsCount = 0;
  function applyMergeApprovalsVisibility() {
    if (!mgMergeApprovals) return;
    // Le fusioni ferme non vengono dallo status dei feedback: senza sezioni non
    // c'è una scheda "Ricevuti" in cui metterle, ma restano vere e si mostrano.
    const sezione = sezioniAttendibili() ? currentTab === 'inbox' : true;
    mgMergeApprovals.hidden = mergeApprovalsCount === 0 || !sezione;
  }

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
    if (sezioniAttendibili()) selectTab(MR.manageTabFor(fb, { releasedVersion }));
    openDetail(fb._id);
  }

  // `already` è l'elenco già pronto, quando ad avvisare è stato il main
  // (MERGE_APPROVALS_CHANGED): una pagina già aperta deve accorgersi di una
  // richiesta nuova, altrimenti l'avviso lo vede solo chi riapre la pagina.
  async function loadMergeApprovals(already) {
    const UI = window.SN_MERGE_APPROVALS;
    if (!mgMergeApprovals || !UI) return 0;
    const spegni = () => {
      mergeApprovalsCount = 0;
      mgMergeApprovals.replaceChildren();
      mgMergeApprovals.hidden = true;
      if (mgMergeApprovalsRecent) {
        mgMergeApprovalsRecent.replaceChildren();
        mgMergeApprovalsRecent.hidden = true;
      }
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
    const n = UI.render(mgMergeApprovals, {
      requests: r.pending || [],
      failed: r.failed || [],
      onDone: () => { setTimeout(loadMergeApprovals, 1200); },
      onApprove: (req) => sendToMain({ type: MERGE_APPROVAL_APPROVE, id: req.id }),
      onDiscard: (req) => sendToMain({ type: MERGE_APPROVAL_DISCARD, id: req.id }),
      onFeedback: (req) => openFeedbackByNum(UI.feedbackNum(req)),
    });
    mergeApprovalsCount = n;
    applyMergeApprovalsVisibility();
    UI.renderRecent(mgMergeApprovalsRecent, { recent: r.recent || [] });
    return n;
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
  // sinistra. Le tab segnaposto (stats/models) hanno il loro pannello.
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
      // Cambiando tab si azzera la selezione: il feedback aperto potrebbe non
      // appartenere alla nuova lista.
      selectedId = null;
      mgDetail.hidden = true;
      mgDetailEmpty.hidden = false;
      mgActions.hidden = true;
      mgClarify.hidden = true;
      if (mgUserNote) mgUserNote.hidden = true;
      mgManage.hidden = true;
      closeSidebar();
      renderList();
      // L'avviso delle fusioni appartiene ai soli Ricevuti: il pannello è lo
      // stesso per le quattro schede-lista, quindi si ricontrolla qui.
      applyMergeApprovalsVisibility();
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
  const imgCache = new Map();
  async function resolveImageSrc(url) {
    if (!url) return { dataUrl: null, error: '' };
    if (imgCache.has(url)) return imgCache.get(url);
    let dataUrl = null;
    let error = '';
    try {
      const r = await sendToMain({ type: 'feedback_decrypt_image', url });
      if (r && r.ok && r.dataUrl) dataUrl = r.dataUrl;
      else if (r && r.error) error = String(r.error);
      else error = 'immagine non disponibile';
    } catch (_) {
      // rete/canale: trattala come non disponibile
      error = 'immagine non raggiungibile';
    }
    const res = { dataUrl, error };
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
      resolveImageSrc(url).then(({ dataUrl, error }) => {
        img.classList.remove('mg-img-loading');
        if (dataUrl) {
          img.src = dataUrl;
          img.dataset.full = dataUrl;
        } else {
          img.classList.add('mg-img-failed');
          img.alt = 'immagine non disponibile';
          if (error) img.title = error;
        }
      });
    });
  }

  // ── Lightbox ──────────────────────────────────────────────────────────────
  function openLightbox(src) {
    mgLightboxImg.src = src;
    mgLightbox.classList.add('open');
  }
  mgLightbox.addEventListener('click', () => {
    mgLightbox.classList.remove('open');
    mgLightboxImg.src = '';
  });

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
      window.addEventListener('scroll', closeSortMenu, true);
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
  // È UNA regola e le copre tutte: qui non si chiude "la barra" e basta. Tutto
  // ciò che questa pagina afferma partendo dallo status — i numeri delle
  // sezioni, il nome della sezione in cima alla colonna, il colore del bordo
  // della scheda ("Non filtrato" è un'affermazione), le barre "Ri-valuta i non
  // filtrati" / "Approva tutti gli allineati", i pulsanti di decisione del
  // dettaglio, la frase accanto ai giudici — passa da qui.
  function sezioniAttendibili() {
    return MR.sectionsReliable(allFeedbacks);
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
  }

  function updateTabCounts() {
    // Sezioni non disegnabili: non c'è niente da numerare. Uscire QUI evita di
    // lasciare "(3) (0) (0) (0)" appiccicato ai bottoni nascosti, pronto a
    // ricomparire al primo dato leggibile che non passa da renderList.
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
      currentList = MR.listForManageTab(allFeedbacks, currentTab, { releasedVersion });
    }

    // Override di ordinamento scelto dall'owner dal menu contestuale (tasto
    // destro sull'intestazione). In 'smart' resta l'ordine predefinito sopra.
    currentList = applySortMode(currentList);

    // #495: quante ne contiene ogni scheda, senza doverle aprire. L'ordinamento
    // non cambia il numero, quindi si può contare qui.
    updateTabCounts();
    setListHead(TAB_LABELS[currentTab] || '', dataLoaded ? currentList.length : null);
    renderListBody();
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
      const cl = sezioni ? MR.classifyBlock(fb) : null;
      const num = FB.formatNum(fb.seq, fb.subSeq);
      const title = fb.name || FB.fallbackName(fb.text) || '(senza titolo)';

      const item = document.createElement('div');
      const unfilteredCls = cl && cl.reason === 'unfiltered' ? ' mg-item--unfiltered' : '';
      // Allineato (tutti i giudici d'accordo, nessun blocco) → bordo BLU.
      const aligned = sezioni && !cl && MR.isAligned(fb);
      const alignedCls = aligned ? ' mg-item--aligned' : '';
      // In lavorazione (working/revision_*): la card mostra una seconda riga con
      // il passaggio corrente dell'iter e se un'istanza ci lavora ORA. Solo
      // nella tab "In coda" (dove queste card sono pinnate in cima).
      const progress = (sezioni && currentTab === 'queue') ? MR.workProgress(fb) : null;
      item.className = 'mg-item'
        + (fb._id === selectedId ? ' mg-item--selected' : '')
        + unfilteredCls
        + alignedCls
        + (progress ? ' mg-item--staged' : '')
        + (progress && progress.active ? ' mg-item--active-work' : '');
      item.dataset.id = fb._id;
      item.style.borderLeftColor = cl ? cl.color : (aligned ? MR.ALIGNED_COLOR : 'transparent');
      // Una riga sola: #N · titolo (ellissi). Il motivo (attacco/spam/…) resta
      // implicito nel colore del border-left; il titolo completo nel tooltip,
      // col sottotesto dello stato (statusReason: loop, clarify, …) se presente.
      const norm = sezioni ? MR.normalizeStatus(fb) : { status: null, statusReason: null };
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
        + (ripartenze ? ` · rientrato in coda ${ripartenze} volt${ripartenze === 1 ? 'a' : 'e'}` : '');
      const rowHtml = `
        ${authorIconHtml(fb)}
        ${num ? `<span class="mg-item-num">#${esc(num)}</span>` : ''}
        <span class="mg-item-title">${esc(title)}</span>
        ${sezioni ? '' : statePublicHtml(fb)}
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
    return allFeedbacks.filter((f) => MR.isAligned(f));
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

  // ── Rendering pannello centrale ───────────────────────────────────────────
  function openDetail(id) {
    selectedId = id;

    // Aggiorna selezione visiva nella lista
    document.querySelectorAll('.mg-item').forEach((el) => {
      el.classList.toggle('mg-item--selected', el.dataset.id === id);
    });

    const fb = allFeedbacks.find((f) => f._id === id);
    if (!fb) return;

    mgDetailEmpty.hidden = true;
    mgDetail.hidden = false;

    // Lo stato di QUESTA segnalazione si legge? Tutto ciò che il pannello dice
    // e offre a partire dallo stato passa da qui — la stessa regola della barra
    // delle sezioni, un gradino più in dentro.
    const leggibile = !MR.statusUnreadable(fb);

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

    // Riga giudici (4 pallini, riassunto a colpo d'occhio). Il click su un
    // pallino apre QUEL giudice (nome + classe + reasoning) nel pannello destro.
    renderJudgesRow(fb);

    // Striscia "a che punto è la lavorazione" (solo per i feedback nell'iter
    // working/revision_*): stessi contenuti della card pinnata in lista.
    if (mgWorkState) {
      const progress = leggibile ? MR.workProgress(fb) : null;
      mgWorkState.hidden = !progress;
      mgWorkState.innerHTML = progress ? workStateHtml(progress) : '';
    }

    // Bolle chat
    renderThread(fb);

    // Azioni contestuali (owner-only):
    //  - feedback bloccato dal pipeline → "Accetta e sblocca";
    //  - feedback allineato ancora nei Ricevuti (automatica OFF) → "Approva e
    //    metti in coda" (problema #2: senza automatica serve un'approvazione manuale);
    //  - feedback in chiarimento → box di risposta che lo rimette in coda;
    //  - altrimenti nessuna azione.
    //
    // Stato illeggibile: nessuna. I pulsanti nascono dallo stato, e su una
    // segnalazione cifrata la macchina lo inventa (`unlabeled` → "bloccato"):
    // offrire "Accetta e sblocca" o "Conferma attacco" su una pratica che
    // potrebbe essere già chiusa è peggio che non offrire niente. È la stessa
    // regola della gemella, che lì spegne i pulsanti della scheda.
    const isBlocked = leggibile && MR.classifyBlock(fb) !== null;
    const tab = leggibile ? MR.manageTabFor(fb, { releasedVersion }) : null;
    const alignedInbox = leggibile && MR.isAligned(fb) && tab === 'inbox';
    const normSel = leggibile ? MR.normalizeStatus(fb) : { status: null, statusReason: null };
    // design con domande (ex clarify) → box risposta; legacy clarify idem.
    const isClarify = normSel.status === 'design' && (normSel.statusReason === 'clarify' || (fb.status || '') === 'clarify');
    mgActions.hidden = !(isAdmin && (isBlocked || alignedInbox));
    // "Conferma blocco" (macchina a stati): per attack/spam/suspicious_file
    // l'owner può confermare — il feedback diventa attack_confirmed/
    // spam_confirmed (terminale, esce dai Ricevuti, resta in Archiviati sotto
    // il filtro "Bloccati confermati").
    if (mgConfirmBtn) {
      const conf = normSel.status === 'spam' ? 'spam_confirmed'
        : (normSel.status === 'attack' || normSel.status === 'suspicious_file') ? 'attack_confirmed'
        : null;
      mgConfirmBtn.hidden = !conf;
      mgConfirmBtn.dataset.confirmStatus = conf || '';
      mgConfirmBtn.textContent = conf === 'spam_confirmed' ? 'Conferma spam' : 'Conferma attacco';
    }
    // Etichetta/placeholder del box: sblocco per i bloccati, approvazione per gli
    // allineati. L'azione sottostante è la stessa (accetta → In coda).
    if (isBlocked) {
      mgAcceptBtn.textContent = 'Accetta e sblocca';
      mgAcceptComment.placeholder = 'Commento (opzionale): perché lo sblocchi…';
    } else {
      mgAcceptBtn.textContent = 'Approva e metti in coda';
      mgAcceptComment.placeholder = 'Commento (opzionale): perché lo approvi…';
    }
    mgAcceptComment.value = '';
    setActionMsg('', '');
    mgClarify.hidden = !(isAdmin && isClarify);
    mgClarifyText.value = '';
    setClarifyMsg('', '');

    // Gestione (⭐ + archivia/ripristina): visibile per l'owner su QUALUNQUE
    // feedback selezionato, accanto alle azioni contestuali.
    // La frase per chi ha segnalato: su qualunque feedback, anche già chiuso.
    // E' in chiaro, quindi si legge e si scrive anche su una macchina senza
    // la chiave privata — al contrario del resto della conversazione.
    if (mgUserNote) {
      mgUserNote.hidden = !isAdmin;
      mgUserNoteText.value = String(fb.userNote || '');
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

    // Chiudi pannello laterale
    closeSidebar();
  }

  // Riflette lo stato corrente del feedback sui controlli di gestione:
  // il bottone ⭐ acceso se è preferito; "Archivia" o "Ripristina" a seconda
  // che il feedback sia già archiviato.
  function reflectManage(fb) {
    mgStarBtn.disabled = false;
    mgArchiveBtn.disabled = false;
    const starred = MR.isStarred(fb);
    mgStarBtn.setAttribute('aria-pressed', starred ? 'true' : 'false');
    mgStarBtn.textContent = starred ? '★ Preferito' : '☆ Preferito';
    mgStarBtn.title = starred ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti';
    // ⭐ resta: il preferito è un flag in chiaro, indipendente dallo stato.
    // "Archivia"/"Ripristina" no: il bottone DICE dov'è la segnalazione, e su
    // uno stato cifrato direbbe sempre "Archivia" — anche su una già
    // archiviata, che il clic riporterebbe indietro senza che nessuno lo
    // volesse. Non si mostra un verso solo di un'azione a due versi.
    mgArchiveBtn.hidden = MR.statusUnreadable(fb);
    const archived = (fb.status || '') === 'archived';
    mgArchiveBtn.textContent = archived ? 'Ripristina' : 'Archivia';
    mgArchiveBtn.title = archived
      ? 'Riporta il feedback in coda'
      : 'Sposta il feedback negli archiviati';
  }

  function setManageMsg(text, kind) {
    mgManageMsg.textContent = text || '';
    mgManageMsg.className = 'mg-action-msg' + (kind ? ` mg-${kind}` : '');
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

  // ── Azione: archivia / ripristina ───────────────────────────────────────────
  // Archivia → status `archived` (tab Archiviati). Su un feedback già archiviato
  // il bottone ripristina, riportandolo in coda (todo): invariante UX "se puoi
  // archiviare, puoi togliere dall'archivio".
  async function toggleArchive() {
    if (!selectedId) return;
    const id = selectedId;
    const fb = allFeedbacks.find((f) => f._id === id);
    if (!fb) return;
    const wasArchived = (fb.status || '') === 'archived';
    const next = wasArchived ? 'todo' : 'archived';
    // Override owner (DC3, SN_BOARD_ARCHIVE.hasOwnerOverride): un'azione manuale
    // qui è sempre esplicita → vince per sempre sull'auto-archiviazione a
    // punteggio. Archivio a mano → 'archived' (non riarchiviabile/non
    // riapribile dall'automazione); ripristino a mano → 'keep_open' (il
    // punteggio NON lo farà ri-archiviare anche se sopra soglia).
    const nextOverride = wasArchived ? 'keep_open' : 'archived';

    mgArchiveBtn.disabled = true;
    setManageMsg(wasArchived ? 'Ripristino…' : 'Archivio…', '');
    try {
      const r = await sendToMain({ type: 'feedback_update', id, status: next, archiveOverride: nextOverride });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'aggiornamento rifiutato');
      fb.status = next;
      fb.archiveOverride = nextOverride;
      // Nell'attesa l'owner può aver aperto un ALTRO feedback. Il dato è
      // salvato lo stesso e la lista si ridisegna, ma il pannello NON si tocca:
      // chiuderlo adesso chiuderebbe il dettaglio dell'altro feedback, che
      // sparirebbe sotto le mani senza motivo apparente.
      if (selectedId !== id) { renderList(); return; }
      // Il feedback cambia tab: chiudi il dettaglio e ricalcola la lista corrente.
      selectedId = null;
      mgDetail.hidden = true;
      mgDetailEmpty.hidden = false;
      mgActions.hidden = true;
      mgClarify.hidden = true;
      if (mgUserNote) mgUserNote.hidden = true;
      mgManage.hidden = true;
      closeSidebar();
      renderList();
    } catch (e) {
      mgArchiveBtn.disabled = false;
      if (selectedId !== id) return;
      setManageMsg(e.message || 'Errore', 'err');
    }
  }

  mgStarBtn.addEventListener('click', toggleStarred);
  mgArchiveBtn.addEventListener('click', toggleArchive);

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
    const fb = allFeedbacks.find((f) => f._id === id);
    const oldNotes = (fb && fb.notes) || '';
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
      if (mgUserNote) mgUserNote.hidden = true;
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

  function setUserNoteMsg(text, kind) {
    if (!mgUserNoteMsg) return;
    mgUserNoteMsg.textContent = text || '';
    mgUserNoteMsg.className = 'mg-action-msg' + (kind ? ` mg-${kind}` : '');
  }

  // Salva SOLO la frase: non tocca la conversazione, quindi si può scrivere
  // anche quando il report non è leggibile su questo computer.
  async function saveUserNote() {
    if (!selectedId) return;
    const id = selectedId;
    const fb = allFeedbacks.find((f) => f._id === id);
    const frase = (mgUserNoteText.value || '').trim().slice(0, 500);
    const gia = userNoteSpedito.has(id) ? userNoteSpedito.get(id) : String((fb && fb.userNote) || '');
    if (gia === frase) { setUserNoteMsg('Nessuna modifica', ''); return; }

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
      if (mio !== userNoteInvii.get(id)) return;
      // 2) Il dato si aggiorna SEMPRE, anche se intanto l’owner è passato a un
      //    altro feedback: la scrittura è andata a buon fine davvero, e
      //    rientrando deve trovare quello che ha salvato.
      if (fb) fb.userNote = frase;
      userNoteSpedito.delete(id);
      // 3) La SCHERMATA invece si tocca solo se è ancora quella di questo
      //    feedback: altrimenti ci finirebbe dentro la frase di un altro, e il
      //    salvataggio dopo manderebbe il messaggio di uno al mittente
      //    dell’altro.
      if (selectedId !== id) return;
      // La casella si riallinea solo se l’owner non ci ha messo mano dopo
      // l’invio, altrimenti gli cancellerebbe la correzione sotto le dita. Non
      // basta confrontare il testo con quello inviato: uscendo dal feedback e
      // rientrandoci il pannello lo ha già ridipinto col valore VECCHIO, e il
      // confronto lo scambierebbe per una correzione.
      if (!userNoteToccata) mgUserNoteText.value = frase;
      setUserNoteMsg(frase ? 'Salvata' : 'Frase rimossa', 'ok');
      renderThread(fb);
    } catch (e) {
      // Superata da un invio più recente: comanda quello, qui non si tocca
      // niente.
      if (mio !== userNoteInvii.get(id)) return;
      // Non è arrivato a destinazione, e una scrittura precedente potrebbe
      // esserci arrivata: da qui in poi non sappiamo cosa ci sia. Va marcato
      // SEMPRE, anche se intanto si sta guardando un altro feedback, o il
      // salvataggio successivo verrebbe di nuovo inghiottito.
      userNoteSpedito.set(id, FRASE_IGNOTA);
      if (selectedId !== id) return;
      setUserNoteMsg(e.message || 'Errore nel salvataggio', 'err');
    } finally {
      mgUserNoteBtn.disabled = false;
    }
  }

  if (mgUserNoteBtn) mgUserNoteBtn.addEventListener('click', saveUserNote);
  if (mgUserNoteText) {
    mgUserNoteText.addEventListener('input', () => { userNoteToccata = true; });
    mgUserNoteText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveUserNote(); }
    });
  }

  // ── Azione: accetta e sblocca un feedback bloccato ──────────────────────────
  function setActionMsg(text, kind) {
    mgActionMsg.textContent = text || '';
    mgActionMsg.className = 'mg-action-msg' + (kind ? ` mg-${kind}` : '');
  }

  async function acceptSelected() {
    if (!selectedId) return;
    const id = selectedId;
    const comment = (mgAcceptComment.value || '').trim();
    const fbSel = allFeedbacks.find((f) => f._id === id);
    const wasBlocked = fbSel ? MR.classifyBlock(fbSel) !== null : true;
    mgAcceptBtn.disabled = true;
    setActionMsg(wasBlocked ? 'Sblocco in corso…' : 'Approvazione in corso…', '');
    try {
      // Override owner: il feedback esce dai bloccati e rientra nella coda (todo).
      const r = await sendToMain({
        type: 'feedback_update',
        id,
        reviewDecision: 'accepted',
        reviewComment: comment,
        reviewedAt: new Date().toISOString(),
        status: 'todo',
      });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'aggiornamento rifiutato');

      // Aggiorna lo stato locale (ottimistico): l'override "accepted" toglie il
      // blocco e il feedback diventa un `todo` — resta in "In coda", non più tra
      // i bloccati. renderList ricalcola la lista dalla sorgente.
      const fb = allFeedbacks.find((f) => f._id === id);
      if (fb) { fb.reviewDecision = 'accepted'; fb.reviewComment = comment; fb.status = 'todo'; }

      // Nell'attesa l'owner può aver aperto un ALTRO feedback. Il dato è
      // salvato lo stesso e la lista si ridisegna, ma il pannello NON si tocca:
      // chiuderlo adesso chiuderebbe il dettaglio dell'altro feedback, che
      // sparirebbe sotto le mani senza motivo apparente.
      if (selectedId !== id) { renderList(); return; }
      // Il feedback non è più in revisione: torna allo stato vuoto del dettaglio.
      selectedId = null;
      mgDetail.hidden = true;
      mgDetailEmpty.hidden = false;
      mgActions.hidden = true;
      mgClarify.hidden = true;
      if (mgUserNote) mgUserNote.hidden = true;
      closeSidebar();
      renderList();
    } catch (e) {
      if (selectedId !== id) return;
      setActionMsg(e.message || (wasBlocked ? 'Errore nello sblocco' : 'Errore nell\'approvazione'), 'err');
    } finally {
      mgAcceptBtn.disabled = false;
    }
  }

  mgAcceptBtn.addEventListener('click', acceptSelected);

  // ── Azione: conferma un attacco/spam (terminale, macchina a stati) ─────────
  async function confirmSelected() {
    if (!selectedId || !mgConfirmBtn) return;
    const id = selectedId;
    const to = mgConfirmBtn.dataset.confirmStatus;
    if (!to) return;
    const comment = (mgAcceptComment.value || '').trim();
    mgConfirmBtn.disabled = true;
    setActionMsg('Conferma in corso…', '');
    try {
      const r = await sendToMain({
        type: 'feedback_update',
        id,
        reviewDecision: 'rejected',
        reviewComment: comment,
        reviewedAt: new Date().toISOString(),
        status: to,
      });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'aggiornamento rifiutato');
      const fb = allFeedbacks.find((f) => f._id === id);
      if (fb) { fb.reviewDecision = 'rejected'; fb.reviewComment = comment; fb.status = to; }
      // Nell'attesa l'owner può aver aperto un ALTRO feedback. Il dato è
      // salvato lo stesso e la lista si ridisegna, ma il pannello NON si tocca:
      // chiuderlo adesso chiuderebbe il dettaglio dell'altro feedback, che
      // sparirebbe sotto le mani senza motivo apparente.
      if (selectedId !== id) { renderList(); return; }
      selectedId = null;
      mgDetail.hidden = true;
      mgDetailEmpty.hidden = false;
      mgActions.hidden = true;
      mgClarify.hidden = true;
      if (mgUserNote) mgUserNote.hidden = true;
      closeSidebar();
      renderList();
    } catch (e) {
      if (selectedId !== id) return;
      setActionMsg(e.message || 'Errore nella conferma', 'err');
    } finally {
      mgConfirmBtn.disabled = false;
    }
  }

  if (mgConfirmBtn) mgConfirmBtn.addEventListener('click', confirmSelected);

  function renderJudgesRow(fb) {
    // Pulisce tutto tranne la label
    const label = mgJudgesRow.querySelector('.mg-judge-label');
    mgJudgesRow.innerHTML = '';
    if (label) mgJudgesRow.appendChild(label);
    else {
      const lbl = document.createElement('span');
      lbl.className = 'mg-judge-label';
      lbl.textContent = 'Giudici:';
      mgJudgesRow.appendChild(lbl);
    }

    // Stato illeggibile: i pallini tratteggiati nascono da "non filtrato", che
    // qui la macchina si inventa — e la frase accanto diceva "In attesa del
    // giudizio." anche su una segnalazione già chiusa. Al loro posto va l'unica
    // cosa che si sa: aperta o chiusa, con le stesse parole della gemella.
    if (MR.statusUnreadable(fb)) {
      const pubblico = MR.publicStateLabel(fb);
      if (!pubblico) { mgJudgesRow.hidden = true; return; }
      mgJudgesRow.hidden = false;
      mgJudgesRow.innerHTML = '';
      const span = document.createElement('span');
      span.className = 'mg-state';
      span.textContent = pubblico;
      span.title = `Stato: ${pubblico} — ${MR.PUBLIC_STATE_HINT}`;
      mgJudgesRow.appendChild(span);
      return;
    }

    // Un pallino per ogni giudice ATTESO del panel (non per verdetto): un panel
    // parziale mostra i mancanti come pallini tratteggiati, non un panel
    // "accorciato". Pipeline NUOVA → posizioni esatte da `expectedJudges`.
    // STORICO (senza quel campo) → mostriamo i verdetti presenti e poi pad-iamo
    // con pallini tratteggiati fino alla dimensione attesa del panel (così 2
    // giudici su 4 = 2 colorati + 2 tratteggiati).
    const p = (fb && fb.pipeline) || {};
    const verdicts = Array.isArray(p.verdicts) ? p.verdicts : [];
    const expected = (Array.isArray(p.expectedJudges) && p.expectedJudges.length) ? p.expectedJudges : null;
    const judgeLetters = ['A', 'B', 'C', 'D', 'E'];

    // Nessun verdetto registrato. Se il feedback è "non filtrato" (da giudicare —
    // es. mai giudicato o identità dell'owner sbloccata), mostra COMUNQUE il panel
    // atteso tutto tratteggiato, così l'owner vede i giudici che non hanno (ancora)
    // votato. Altrimenti (clarify, chiusi…) nascondi la riga.
    if (!expected && verdicts.length === 0) {
      const cl = MR.classifyBlock(fb);
      if (!cl || cl.reason !== 'unfiltered') { mgJudgesRow.hidden = true; return; }
      mgJudgesRow.hidden = false;
      const n = MR.EXPECTED_PANEL_SIZE || 4;
      for (let i = 0; i < n; i++) {
        const dot = document.createElement('span');
        dot.className = 'mg-dot mg-dot--empty';
        dot.title = `Giudice ${judgeLetters[i] || i + 1}: nessun verdetto`;
        mgJudgesRow.appendChild(dot);
      }
      appendJudgesNote(fb);
      return;
    }
    mgJudgesRow.hidden = false;

    const fallbackSize = Math.max(verdicts.length, (MR.EXPECTED_PANEL_SIZE || 4));
    const size = expected ? expected.length : fallbackSize;
    for (let i = 0; i < size; i++) {
      const v = expected ? verdictByName(fb, expected[i]) : (verdicts[i] || null);
      const dot = document.createElement('span');
      dot.className = 'mg-dot';
      if (v) {
        const cls = v.class || '';
        if (cls) dot.classList.add(`mg-dot--${cls}`);
        dot.classList.add('mg-dot--clickable');
        dot.title = `Giudice ${judgeLetters[i] || i + 1}: ${cls}`;
        // Click sul pallino → apre QUEL giudice nel pannello destro.
        dot.addEventListener('click', () => openSidebarJudge(fb, i));
      } else {
        // Quel giudice NON ha emesso un verdetto in quella run (timeout/errore/
        // giudice non configurato): pallino tratteggiato. È la causa del
        // "non filtrato" (panel parziale).
        dot.classList.add('mg-dot--empty');
        dot.title = `Giudice ${judgeLetters[i] || i + 1}: nessun verdetto`;
      }
      mgJudgesRow.appendChild(dot);
    }
    appendJudgesNote(fb);
  }

  // La frase accanto ai pallini: perché il feedback è in questo stato. I
  // pallini da soli raccontavano solo il voto dei giudici, e uno stato deciso
  // DOPO (sicurezza che boccia il fix, domande della routine) sembrava in
  // contraddizione con quattro pallini blu (#462).
  function appendJudgesNote(fb) {
    const note = MR.judgesNote ? MR.judgesNote(fb) : null;
    if (!note || !note.text) return;
    const span = document.createElement('span');
    span.className = 'mg-judge-note';
    span.textContent = note.text;
    if (note.color) span.style.color = note.color;
    mgJudgesRow.appendChild(span);
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
      html += `<div class="mg-bubble-file"><a href="${esc(f.url)}" target="_blank" rel="noopener">📎 ${esc(f.name || 'allegato')}</a></div>`;
    }
    b.innerHTML = html;
    resolveBubbleImages(b);
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
      .map((f) => ({ kind: 'file', url: f.url, name: f.name }));
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
      else opinionHtml = '<em>Filo non ha ancora un parere su questo feedback (giudici non attivi).</em>';
    }
    appendBubble('model', 'Filo', opinionHtml);

    // Bolla 3: il commento dell'owner alla revisione (approvazione/sblocco/
    // conferma). Prima era scritto ma non mostrato da nessuna parte.
    if (String(fb.reviewComment || '').trim()) {
      const when = fb.reviewedAt ? ` — ${formatDate(fb.reviewedAt)}` : '';
      appendBubble('user', `Tu (revisione${when})`, esc(fb.reviewComment));
    }

    // Turni della lavorazione: le note contengono i report delle istanze che
    // hanno implementato, gli esiti del controllo funzionalità e le risposte
    // dell'owner ai chiarimenti, in ordine. Il parser condiviso li separa.
    const notes = String(fb.notes || '');
    // Report illeggibile su questo computer: al posto del blob si dice perché,
    // e si mostra la frase scritta per chi ha segnalato, che è in chiaro.
    if (TH && TH.reportUnreadable && TH.reportUnreadable(notes)) {
      const frase = String(fb.userNote || '').trim();
      if (frase) appendBubble('model', 'Filo (per chi ha segnalato)', esc(frase));
      appendBubble('model', 'Filo', esc('Il report della lavorazione è cifrato e questo computer non ha la chiave privata per leggerlo.'));
      return;
    }
    if (!TH) {
      // Fallback senza parser: mostra il blob intero come un turno unico.
      if (notes.trim()) appendBubble('model', 'Filo (lavorazione)', esc(notes));
      return;
    }
    for (const seg of TH.splitNotes(notes)) {
      const when = seg.ts ? ` — ${seg.ts}` : '';
      const who = seg.role === 'user' ? `Tu${when}` : `Filo (lavorazione${when})`;
      appendBubble(seg.role === 'user' ? 'user' : 'model', who, esc(seg.body), seg.attachments);
    }
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
    if (!v) return;

    const letters = ['A', 'B', 'C', 'D', 'E'];
    const anonLabel = `Giudice ${letters[i] || String(i + 1)}`;
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
      const cl  = MR.statusUnreadable(fb) ? null : MR.classifyBlock(fb);
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

    try {
      // Il tetto viene dal modulo condiviso: `loadHitCap()` confronta contro
      // QUELLO, e due numeri scritti a mano prima o poi divergono.
      allFeedbacks = await FB.list({ pageSize: FB.LIST_PAGE_SIZE });
      dataLoaded = true;
      loadFailed = false;
    } catch (err) {
      // Il guasto va RICORDATO, non solo scritto una volta: il primo click su
      // una scheda rirende il riquadro, e senza questo flag ci scriverebbe
      // "Nessun feedback in coda." — cioè una risposta al posto di un guasto.
      loadFailed = true;
      mgListLoading.hidden = true;
      mgListEmpty.hidden = false;
      mgListEmpty.textContent = 'Errore nel caricamento dei feedback.';
      console.error('[manage] errore caricamento:', err);
      return;
    }

    // S1.3: decifratura batch dei campi FENC1: — una sola IPC per tutta la lista.
    // Se l'utente non è admin (o il modulo non è disponibile) i valori restano
    // invariati (graceful fallback: la dashboard non si rompe, mostra il ciphertext).
    if (isAdmin && allFeedbacks.length > 0) {
      try {
        const r = await sendToMain({ type: 'feedback_decrypt_fields', list: allFeedbacks });
        if (r && r.ok && Array.isArray(r.list)) allFeedbacks = r.list;
      } catch (_) { /* fallback: render con valori cifrati */ }
    }

    // Indice per mittente
    allByClient = {};
    for (const fb of allFeedbacks) {
      const c = fb.clientId || '__anon__';
      if (!allByClient[c]) allByClient[c] = [];
      allByClient[c].push(fb);
    }

    renderList();
  }

  // ── Hook di test ────────────────────────────────────────────────────────
  // Solo per gli spec Playwright: inietta feedback e apre il dettaglio
  // esercitando il VERO codice di rendering, senza duplicarne la logica nel
  // test (vedi CLAUDE.md → "Test che servono davvero"). Inerte in produzione.
  window.__mgTest = {
    setData(fbs) {
      allFeedbacks = Array.isArray(fbs) ? fbs : [];
      dataLoaded = true;
      loadFailed = false;
      // Reindicizza per mittente (il pannello laterale lo usa).
      allByClient = {};
      for (const fb of allFeedbacks) {
        const c = fb.clientId || '__anon__';
        (allByClient[c] || (allByClient[c] = [])).push(fb);
      }
      renderList();
    },
    setAdmin(v) { isAdmin = !!v; applyAutoModeGate(); },
    // Ri-legge i contatori del verificatore dalla fonte (IPC) — per i test.
    loadCaps,
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
  // Tab "Log": render diretto con voci finte (bypassa il canale main), e
  // ri-lettura via IPC per gli spec che stubbano la risposta.
  window.__mgTest.renderWorkerLog = (entries) => { renderWorkerLog(entries); logLoaded = true; };
  window.__mgTest.loadWorkerLog = loadWorkerLog;
  window.__mgTest.renderChannelLog = renderChannelLog;
  // Fusioni in attesa: rilettura via IPC dopo lo stub (in test non c'è né una
  // sessione da proprietario né il server di sicurezza).
  window.__mgTest.loadMergeApprovals = loadMergeApprovals;

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
    injectSearchIcons();
    await loadLayout();
    await refreshAuth();
    applyAutoModeGate();
    await loadAutoMode();
    await loadSortMode();
    await loadCaps();
    await loadJudgeTimeout();
    await loadMergeApprovals();
    await loadData();
  }

  const bootDone = init().catch((e) => { console.error('[manage] init:', e); });
  // Gli spec devono poter aspettare la FINE del caricamento vero (Firestore)
  // prima di iniettare dati finti: se il caricamento atterra a metà test, li
  // sovrascrive e il test diventa rumore.
  window.__mgTest.whenReady = () => bootDone;

})();
