// Entry point content script. Intercetta contextmenu, costruisce le voci, gestisce shortcut.

(function () {
  'use strict';

  const { ACTIONS, PAGES_WITHOUT_MENU_PREFIXES } = self.SN_CONST;
  const { MSG } = self.SN_MSG;
  const I18n = self.SN_I18N;
  const Menu = self.SN_MENU;
  const Popup = self.SN_POPUP;
  const Extract = self.SN_EXTRACT;
  const Sidebar = self.SN_SIDEBAR;
  const SpellCheck = self.SN_SPELLCHECK;
  const PageColor = self.SN_PAGE_COLOR;
  const TTS = self.SN_TTS;
  const EditBox = self.SN_EDITBOX;
  const Actions = self.SN_ACTIONS;
  const MenuIcons = self.SN_MENU_ICONS;
  const TranslatePage = self.SN_TRANSLATE_PAGE;
  // Come si chiama una scorciatoia lo dice SN_TASTI, mai scritta a mano: CLAUDE.md § Mac.
  const Tasti = self.SN_TASTI;

  // I moduli estratti hanno bisogno di pezzi che restano qui (settings, contesto d'incolla,
  // blocklist, ultimo evento del mouse): sono hoisted, i riferimenti valgono già.
  Actions.init({
    getPasteContext: () => pasteContext,
    restorePasteContext: () => restorePasteContext(),
    isBlocked: () => isBlocked(),
    isIncognito: () => inIncognito,
    getLastMouseEvent: () => lastMouseEvent,
    spiegaAnticipata: () => !(settings && settings.spiegaAnticipata && settings.spiegaAnticipata.enabled === false),
  });
  MenuIcons.init({
    isContentFullscreen: () => contentFullscreen,
    aiutoPasso: () => aiutoPasso(),
    aiutoStato: () => Sidebar.stato(),
    aiutoAcceso: () => aiutoAcceso(),
  });
  TTS.init({
    getSettings: () => settings,
    restorePasteContext: () => restorePasteContext(),
    insertDictatedText: (text) => Actions.insertDictatedText(text),
    blobToDataUrl: (blob) => Actions.blobToDataUrl(blob),
  });
  EditBox.init({
    getPasteContext: () => pasteContext,
    setPasteContext: (ctx) => { pasteContext = ctx; },
    restorePasteContext: () => restorePasteContext(),
  });

  let settings = null;
  // Rispecchia la modalità del main (tabs.js): dà icona ed etichetta giuste alla voce
  // «Schermo intero».
  let contentFullscreen = false;
  // Vero appena il main ci ha annunciato un cambio: da quel momento l'annuncio
  // è più fresco della risposta alla domanda che facciamo al montaggio, e vince.
  let fullscreenAnnunciato = false;
  // Il main ci consegna un Esc che il browser avrebbe mangiato (MSG.ESC_INOLTRATO,
  // vedi sotto). La consegna la esegue il giro dell'Esc montato in init().
  let consegnaEsc = null;
  // Un riquadro incorporato ci chiede di prendere noi il tasto (MSG.ESC_CHIEDI_TASTO):
  // il browser lo presta solo al frame principale.
  let consegnaChiediEsc = null;

  // Chi si è preso l'Esc a schermo intero: non «quali riquadri ci sono» ma «l'ha usato
  // qualcuno?», deciso a giro finito. In dubbio si esce: mai restare chiusi dentro (#514).
  const PAGINA_DI_FILO = (() => {
    try { return location.protocol === 'filo:'; } catch (_) { return false; }
  })();

  // Quanta roba c'è dentro un pezzo di pagina, in due numeri. Lo stesso metro
  // vale per il documento intero e per il sottoalbero di una nostra radice.
  function peso(radice) {
    try {
      if (!radice) return null;
      return {
        elementi: radice.getElementsByTagName('*').length,
        nascosti: radice.querySelectorAll('[hidden]').length,
      };
    } catch (_) { return null; }
  }
  // Solo la direzione "qualcosa è sparito": chi sta AGGIUNGENDO roba (una
  // risposta che arriva a pezzi) non deve poter rivendicare il tasto.
  function siEAlleggerito(prima, dopo) {
    if (!prima || !dopo) return false;
    return dopo.elementi < prima.elementi || dopo.nascosti > prima.nascosti;
  }

  function pezziDiFiloSullaPagina() {
    const out = [];
    try {
      for (const el of (self.SN_FILO_UI?.aperti?.() || [])) out.push({ el, dentro: peso(el) });
    } catch (_) {}
    return out;
  }
  // Si guardano i pezzi UNO A UNO e non quanti sono: nello stesso istante ne può nascere
  // un altro, e a contarli sembrerebbe che non sia successo niente.
  function qualcosaSiEChiuso(pezziPrima) {
    try {
      return pezziPrima.some((p) => {
        if (!p || !p.el) return false;
        if (!p.el.isConnected) return true;
        return siEAlleggerito(p.dentro, peso(p.el));
      });
    } catch (_) { return false; }
  }

  // Il documento intero conta solo sulle pagine di Filo: su un sito sarebbe il sito a
  // decidere di chi è l'Esc. I sottoalberi delle nostre radici sono nostri ovunque.
  function pesoDellaPagina() {
    if (!PAGINA_DI_FILO) return null;
    return peso(document.documentElement);
  }
  function siEAlleggerita(prima) {
    return siEAlleggerito(prima, pesoDellaPagina());
  }

  // Dentro un riquadro incorporato il menu sull'ELEMENTO vale identico; ciò che riguarda
  // la PAGINA no: il riquadro conosce solo sé e parlerebbe del rettangolo sbagliato (#405).
  const IS_SUBFRAME = (() => {
    try { return window.top !== window.self; } catch (_) { return true; }
  })();

  async function init() {
    settings = await fetchSettings();
    applyTheme(settings.theme);
    applyThemeTokens(settings.themeTokens);
    self.SN_AVVISI?.imposta(settings.notifications);
    // I tasti di Spiega e Aiuto scelti dall'utente: il menu li scrive accanto alle voci (#842).
    Tasti.usaScorciatoieFilo(settings.scorciatoie);

    // Queste tre cose descrivono la SCHEDA, quindi restano alla pagina (vedi IS_SUBFRAME).
    if (!IS_SUBFRAME) {
      // Il colore della cima pagina va al main, che tinge la tab (§1.1). Attivo anche sulle
      // pagine senza menu: il colore non c'entra col menu.
      try { PageColor.startTabColorSampler(); } catch (_) {}

      // Colore identità del sito (§1.2): calcolato una volta (theme-color →
      // manifest → favicon → fallback) e mandato al main, che lo cacha per dominio
      // e lo mescola col fondo della barra nelle tab inattive.
      try { PageColor.reportTabIdentityColor(() => settings && settings.tabColor); } catch (_) {}

      // Segnali di attività (§2.1): ultima interazione, % di scroll.
      // Servono all'LLM per decidere cosa archiviare.
      try { startTabActivityReporter(); } catch (_) {}
    }
    // Il testo da inviare invece si guarda in ogni frame: editor, commenti e
    // moduli di contatto stanno spesso in un riquadro (#824).
    try { startFormTracker(); } catch (_) {}

    // Lo si CHIEDE invece di aspettare l'annuncio, che parte solo al cambio: una pagina
    // arrivata dopo offrirebbe «Schermo intero» mentre ci si è già dentro (#514).
    try {
      chrome.runtime.sendMessage({ type: MSG.FULLSCREEN_STATE })
        .then((r) => {
          if (!fullscreenAnnunciato && r && r.ok) contentFullscreen = !!r.fullscreen;
        })
        .catch(() => {});
    } catch (_) {}

    // Esc esce dalla modalità a tutto schermo solo se non se l'è preso nessun altro: uno in
    // capture fotografa la pagina, l'ultimo in bolla vede se il tasto è arrivato intatto.
    let escInCorso = null;
    // Quante volte di fila un Esc è stato rivendicato da qualcuno. Nessuna prova
    // vale all'infinito, perché nessuna prova è a prova di pagina ostile: chi si
    // prendesse ogni Esc ci chiuderebbe dentro allo schermo intero. Due tetti,
    // perché le prove non valgono uguale, e il taglio è **cosa si è visto
    // succedere**, non su quale pagina siamo:
    //  · PROVA FORTE — qualcosa è sparito davvero: un pezzo nostro si è
    //    staccato dal documento, oppure (su una pagina di Filo) la pagina si è
    //    alleggerita. Tetto dieci: i riquadri si impilano davvero (una risposta
    //    ne apre un'altra), e a tre il quarto Esc costava la modalità (#648).
    //  · PROVA DEBOLE — solo "qualcuno ha consumato il tasto", senza che si sia
    //    visto sparire niente. Tetto uno: chi si prendesse ogni Esc senza
    //    chiudere nulla si ferma al secondo.
    // Contare i due tipi INSIEME era il difetto del giro 7: con due riquadri
    // aperti sopra una pagina di Filo (la ricerca della gestione e l'immagine a
    // tutta pagina; la domanda di conferma e l'immagine ingrandita nella home)
    // il secondo Esc chiudeva il riquadro di sotto e portava via anche lo
    // schermo intero, che nessuno aveva chiesto di lasciare. Una prova forte
    // riazzera il conto delle deboli: la pagina sta dimostrando di fare
    // qualcosa, non di mangiare tasti.
    // Il tetto che GARANTISCE resta quello del main (ESC_RIVENDICAZIONI_MAX in
    // src/main/tabs.js): questo è solo il primo filtro, e vive dentro la pagina.
    // Entrambi i conteggi tornano a zero appena l'utente fa qualcos'altro (un
    // clic, un altro tasto): a quel punto la volta dopo è una volta nuova, e
    // riaprire un'immagine le ridà il suo tasto.
    const TETTO_PROVE_FORTI = 10;
    const TETTO_PROVE_DEBOLI = 1;
    let escFortiDiFila = 0;
    let escDeboliDiFila = 0;
    function azzeraRivendicazioni() { escFortiDiFila = 0; escDeboliDiFila = 0; }
    window.addEventListener('mousedown', azzeraRivendicazioni, { capture: true });

    // L'Esc consegnato dal main (schermo pieno del SITO, dove il browser se lo mangia) non
    // passa dalla deroga qui sotto: il main ha già deciso che quel tasto viene a noi (#514).
    let escInoltrato = false;
    // Sopra lo schermo pieno di un SITO l'Esc va CHIESTO col Keyboard Lock, o il documento
    // non lo vede mai (#514). Solo l'Esc, solo mentre c'è qualcosa di nostro aperto.
    let tastoChiesto = false;
    // Il browser presta il tasto solo al frame principale: da un riquadro la richiesta si
    // gira a lui passando dal main, che la esegue con questa stessa funzione.
    function chiediEsc() {
      if (tastoChiesto) return;
      if (IS_SUBFRAME) {
        tastoChiesto = true;
        try { chrome.runtime.sendMessage({ type: MSG.ESC_CHIEDI_TASTO }).catch(() => {}); } catch (_) {}
        return;
      }
      try {
        const p = navigator.keyboard?.lock?.(['Escape']);
        if (!p) return;
        tastoChiesto = true;
        p.catch?.(() => { tastoChiesto = false; });
      } catch (_) { tastoChiesto = false; }
    }
    function restituisciEsc() {
      if (!tastoChiesto) return;
      tastoChiesto = false;
      if (IS_SUBFRAME) return; // il tasto ce l'ha il frame principale, non noi
      try { navigator.keyboard?.unlock?.(); } catch (_) {}
    }
    // Si restituisce a fine schermo pieno, l'unico momento in cui il tasto smette di essere
    // in ballo: un riquadro non dice quando si chiude, e tenerlo di più non costa niente.
    consegnaChiediEsc = () => { if (document.fullscreenElement) chiediEsc(); };
    try {
      self.SN_FILO_UI?.onMark?.(() => {
        if (document.fullscreenElement) chiediEsc();
      });
    } catch (_) {}
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) restituisciEsc();
      // Il nome della voce guarda anche lo schermo pieno della PAGINA: l'annuncio del main
      // arriva mentre il documento sta ancora uscendo, e la voce si ridisegnerebbe identica.
      try { if (Menu?.isOpen?.()) MenuIcons.redrawIconRows?.(); } catch (_) {}
    });

    // Il tasto si rimette in circolo com'era, ma non è «fidato»: una pagina non può usarlo
    // per riprendersi lo schermo (#514).
    consegnaEsc = () => {
      if (escInoltrato) return;
      escInoltrato = true;
      try {
        const tasto = new KeyboardEvent('keydown', {
          key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
          bubbles: true, cancelable: true, composed: true,
        });
        // Segnato come nostro: il primo ascolto della pagina lo dà ai riquadri di Filo prima che al sito (#859).
        try { self.SN_FILO_UI?.nostro?.(tasto); } catch (_) {}
        document.dispatchEvent(tasto);
      } catch (_) {}
      escInoltrato = false;
    };

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') { azzeraRivendicazioni(); return; }
      if (!contentFullscreen) return;
      // Deroga, la stessa del main: se a tutto schermo è andata LA PAGINA l'Esc è suo, e
      // chiedere noi l'uscita la lascerebbe convinta di esserci ancora.
      if (document.fullscreenElement && !escInoltrato) return;
      escInCorso = {
        ev: e,
        pezziPrima: pezziDiFiloSullaPagina(),
        pesoPrima: pesoDellaPagina(),
        inFondo: false,
        consumato: false,
      };
      setTimeout(decidiEsc, 0);
    }, { capture: true });

    window.addEventListener('keydown', (e) => {
      if (!escInCorso || escInCorso.ev !== e) return;
      escInCorso.inFondo = true;
      escInCorso.consumato = !!e.defaultPrevented;
    });

    // A giro finito: se sopra la pagina non è rimasto niente di nostro il tasto torna al
    // browser, e a nessuno resta chiesto un tasto che non serve più.
    function decidiEsc() {
      try { decidiChiEraQuellEsc(); } finally {
        try { if (!pezziDiFiloSullaPagina().length) restituisciEsc(); } catch (_) {}
      }
    }

    function decidiChiEraQuellEsc() {
      const giro = escInCorso;
      escInCorso = null;
      if (!giro || !contentFullscreen) return;
      // Qualcosa è sparito davvero: un pezzo nostro staccato dal documento, o
      // (solo su una pagina di Filo) la pagina che si è alleggerita.
      const forte = qualcosaSiEChiuso(giro.pezziPrima)
        || (PAGINA_DI_FILO && siEAlleggerita(giro.pesoPrima));
      // Nessuno si è visto sparire, ma su una pagina di Filo qualcuno il tasto
      // se l'è preso: lì tutto quello che c'è sullo schermo è roba nostra.
      const debole = PAGINA_DI_FILO && (!giro.inFondo || giro.consumato);
      const rivendica = (forte && escFortiDiFila < TETTO_PROVE_FORTI)
        || (debole && escDeboliDiFila < TETTO_PROVE_DEBOLI);
      if (rivendica) {
        if (forte) { escFortiDiFila++; escDeboliDiFila = 0; } else { escDeboliDiFila++; }
        try { chrome.runtime.sendMessage({ type: MSG.ESC_CONSUMATO }).catch(() => {}); } catch (_) {}
        return;
      }
      azzeraRivendicazioni();
      contentFullscreen = false; // evita ripetizioni mentre il main esce
      try { chrome.runtime.sendMessage({ type: MSG.EXIT_FULLSCREEN }).catch(() => {}); } catch (_) {}
    }

    // Ctrl/Cmd+Z torna alla pagina precedente (#267), salvo dentro un campo di testo, dove
    // resta «annulla». In capture e anche sulle pagine bloccate: è navigazione del browser.
    window.addEventListener('keydown', (e) => {
      if ((e.key !== 'z' && e.key !== 'Z') || e.shiftKey || e.altKey) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      // composedPath()[0] vede oltre lo shadow DOM; controlliamo anche
      // activeElement nel caso il keydown arrivi sul body con un campo a fuoco.
      const target = (typeof e.composedPath === 'function' && e.composedPath()[0]) || e.target;
      if (isEditable(target) || isEditable(document.activeElement)) {
        // In un campo vuoto non c'è niente da disfare: subito dopo un'azione di Filo (chiesta in chat, col cursore
        // rimasto nella casella) è lei che si vuole annullare (#1461). Il campo resta suo: niente indietro.
        if (campoVuoto(isEditable(target) ? target : document.activeElement)) {
          chrome.runtime.sendMessage({ type: MSG.CONTATORI_EVENTO, misura: 'tasto-annulla' }).catch(() => {});
        }
        return;
      }
      // Il campo dentro un componente chiuso lo vede solo la regola intera (src/shared/campoTesto.js).
      if (self.SN_CAMPO_TESTO && self.SN_CAMPO_TESTO.scriveQui(document) === true) return;
      // Una pagina di Filo in cui l'utente ha dato Ctrl+Z a un suo comando (un
      // modulo dell'Editor) se lo tiene: vince la scelta esplicita (#545).
      if (PAGINA_DI_FILO && document.documentElement.dataset.filoCtrlZ === 'pagina') return;
      e.preventDefault();
      e.stopPropagation();
      // `daAnnulla`: subito dopo un'azione di Filo è anche il suo annullo, per i contatori (#1461).
      chrome.runtime.sendMessage({ type: MSG.NAV_BACK, daAnnulla: true }).catch(() => {});
    }, { capture: true });

    // Filo spento sul sito si decide a ogni gesto, non al caricamento (#589.2): tutto si monta, e ogni porta chiede
    // isBlocked() quando scatta. Il ponte del tasto destro lo legge da qui, prima di dare l'evento al menu.
    seguiSpento();
    SpellCheck.init(impostazioniDelCorrettore());

    // Sulle pagine web si passa dal listener window+capture del preload, per essere primi
    // anche dove il contextmenu è bloccato; sulle filo:// in BUBBLE, hanno un menu loro.
    if (typeof self.__snSetContextMenuHandler === 'function') {
      self.__snSetContextMenuHandler(onContextMenu);
      if (typeof self.__snSetMenuDelSitoPrima === 'function') self.__snSetMenuDelSitoPrima(menuDelSitoPrima);
    } else {
      window.addEventListener('contextmenu', (e) => {
        if (e.defaultPrevented || isBlocked()) return; // la pagina interna ha il SUO menu
        onContextMenu(e);
      });
    }
    // Prefetch "Spiega" appena l'utente seleziona del testo, così quando apre il
    // menu il risultato è già in cache. Debounce + dedup gestiti dallo scheduler.
    document.addEventListener('selectionchange', Actions.schedulePrefetchExplain);
    // Chi si ferma prima di rilasciare il mouse o il dito non cambia più la selezione: il rilascio, gesto vero, la
    // prepara (#1070); la pressione lunga del dito seleziona prima del rilascio.
    for (const tipo of ['mouseup', 'touchend']) {
      document.addEventListener(tipo, (e) => { if (e.isTrusted) Actions.schedulePrefetchExplain(); }, true);
    }
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      // Spento sul sito tacciono le azioni sulla pagina; lo stato (impostazioni, schermo intero) si segue lo stesso.
      if (isBlocked() && AZIONI_DA_FUORI.has(msg?.type)) return;
      onRuntimeMessage(msg, sender, sendResponse);
      return true; // mantieni il canale aperto per sendResponse asincrono
    });

    // Marker per i test: `filoReady` dice solo che i moduli sono caricati, questo che i
    // listener sono attivi, spellcheck compreso. Innocuo a runtime.
    try { document.documentElement.dataset.filoContentReady = '1'; } catch (_) {}
  }

  // Campionatore del colore tab e colore identità del sito: src/content/pageColor.js.

  // ------------------------------------------------------------
  // Segnali di attività della tab (spec §2.1)
  // ------------------------------------------------------------
  // Riporta al main: quando l'utente ha interagito l'ultima volta e quanto ha
  // scrollato (0-100%). Throttled per non inondare l'IPC.
  function startTabActivityReporter() {
    let lastSentScroll = -1;
    let pending = false;
    let lastSend = 0;

    function scrollPct() {
      const doc = document.documentElement;
      const max = (doc.scrollHeight || 0) - window.innerHeight;
      if (max <= 0) return 0; // pagina che non scrolla → consumata per intero? la lasciamo a 0
      const y = window.scrollY || doc.scrollTop || 0;
      return Math.max(0, Math.min(100, (y / max) * 100));
    }

    function send(extra) {
      const payload = { type: MSG.TAB_ACTIVITY, lastInteractionAt: Date.now(), ...extra };
      try {
        Promise.resolve(chrome.runtime.sendMessage(payload)).catch(() => {});
      } catch (_) {}
      lastSend = performance.now();
    }

    function onInteract() {
      const since = performance.now() - lastSend;
      if (since < 2000) return;
      send({});
    }

    function onScroll() {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        const pct = Math.round(scrollPct());
        if (pct !== lastSentScroll) {
          lastSentScroll = pct;
          send({ scrollPct: pct });
        }
      }, 500);
    }

    window.addEventListener('pointerdown', onInteract, { passive: true, capture: true });
    window.addEventListener('keydown', onInteract, { passive: true, capture: true });
    window.addEventListener('scroll', onScroll, { passive: true });

    setTimeout(() => send({ scrollPct: Math.round(scrollPct()) }), 600);
  }

  // Testo scritto dall'utente e non ancora inviato: finché ce n'è la pulizia non chiude la scheda
  // (#824). Conta il testo nato da un gesto (o scritto da Filo per lui), seguito per contenuto; il sito
  // l'ha ricevuto quando una richiesta riuscita lo porta (src/main/tabs.js). Porte: tests/tab-auto-archive.spec.mjs.
  function startFormTracker() {
    if (/^filo:\/\/(options|preferences)\//i.test(location.href)) return;
    const PAGINA_DI_FILO = /^filo:/i.test(location.href);
    // Area in cui l'utente ha scritto → testo che mostrava prima che ci scrivesse.
    const aree = new Map();
    const basi = new WeakMap();
    // Caselle a più righe ed editor: il solo testo che si segue fuori dal suo campo.
    const lunghe = new WeakSet();
    // Componenti chiusi in cui è arrivata una scrittura: il testo lì dentro non si legge.
    const opachi = new Set();
    // Testo di un campo tolto dalla pagina: la pagina può tenerlo in memoria (il passo dopo di una
    // procedura, il riepilogo), quindi protegge finché non ricompare in un campo o non parte. { t, righe }
    const orfani = [];
    // Le righe di ogni area all'ultima rilettura: tolta dalla pagina, un editor non le dà più.
    const righeViste = new WeakMap();
    // Impronte dei testi lunghi mandati al server: la risposta può rimetterli in un campo.
    const partiti = new Set();
    let ultimoMandato = null;
    let ultimeImpronte = '';
    let ultimoTocco = null;
    let rilettura = null;
    const TIPI_DI_TESTO = /^(text|search|email|url|tel|password|number)$/;
    function campoDiTesto(t) {
      if (t && t.nodeType === 3) t = t.parentElement;
      if (!t || !t.tagName) return null;
      const tag = t.tagName.toUpperCase();
      if (tag === 'TEXTAREA') return t;
      if (tag === 'INPUT') return TIPI_DI_TESTO.test(String(t.type || 'text').toLowerCase()) ? t : null;
      if (!t.isContentEditable) return null;
      while (t.parentElement && t.parentElement.isContentEditable) t = t.parentElement;
      return t;
    }
    // Una ricerca non è una bozza: si riscrive in un attimo, e quella dal vivo ha già
    // dato i risultati senza un invio da riconoscere.
    function diRicerca(el) {
      const tag = el.tagName.toUpperCase();
      if (tag !== 'INPUT' && tag !== 'TEXTAREA') return false;
      if (/^searchbox$/i.test(el.getAttribute('role') || '') || el.closest('[role="search" i]')) return true;
      if (/^(q|s|k|query|search|search_query|keywords?|field-keywords)$/i.test(el.name || '')) return true;
      if (tag === 'TEXTAREA') return false;
      if (String(el.type).toLowerCase() === 'search') return true;
      return /(search|cerca|ricerca|busca|recherche|suche)/i.test(`${el.getAttribute('aria-label') || ''} ${el.placeholder || ''}`);
    }
    const grande = (el) => { try { const r = el.getBoundingClientRect(); return r.width >= 8 && r.height >= 8; } catch (_) { return true; } };
    function primoGrande(da, body) {
      for (let p = da, n = 0; p && p !== body && n < 8; p = p.parentElement, n++) if (grande(p)) return p;
      return null;
    }
    // Gli editor di codice ricevono i tasti in una casella minuscola e mostrano il testo
    // altrove: l'area è il contenitore visibile, o quello su cui si è cliccato per scrivere.
    const areaDelCampo = new WeakMap();
    function areaDi(campo) {
      if (campo.isContentEditable) return campo;
      let area = areaDelCampo.get(campo);
      if (area && area.isConnected) return area;
      const body = campo.ownerDocument.body;
      const tocco = ultimoTocco && ultimoTocco.ownerDocument === campo.ownerDocument ? ultimoTocco : null;
      area = grande(campo) ? campo : (primoGrande(campo.parentElement, body) || (tocco && primoGrande(tocco, body)) || campo);
      areaDelCampo.set(campo, area);
      return area;
    }
    function testo(area) {
      const tag = area.tagName.toUpperCase();
      if (tag === 'TEXTAREA' || tag === 'INPUT') return area.value || '';
      if (area.isContentEditable) return area.textContent || '';
      return area.innerText || area.textContent || '';
    }
    // Gli editor ricchi lasciano spazi a larghezza zero anche quando sono vuoti.
    const pulito = (s) => String(s).replace(/[\s\u200B-\u200D\u2060\uFEFF]+/g, '');
    // Solo lettere e cifre minuscole, come il main riduce il testo delle richieste: il sito pu\u00F2
    // averlo mandato in Markdown, in HTML o con le maiuscole sue.
    const essenziale = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
    // Casella a pi\u00F9 righe \u2192 il suo testo all'ultima richiesta riuscita che lo portava al sito.
    const ricevuti = new WeakMap();
    // Campo di una riga \u2192 il suo testo dopo l'ultima scrittura dell'utente: se la pagina lo cambia
    // (una voce scelta dai suggerimenti, una correzione) quel testo non \u00E8 pi\u00F9 suo.
    const digitati = new WeakMap();
    const sostituito = (area) => !lunghe.has(area) && digitati.has(area) && essenziale(testo(area)) !== digitati.get(area);
    // Un riquadro tolto dalla pagina lascia i suoi nodi «connessi» a un documento morto.
    const viva = (a) => a.isConnected && !!(a.ownerDocument && a.ownerDocument.defaultView);

    // Quello che Filo scrive per l'utente (Incolla, dettatura, sostituzioni, l'agente) arriva con
    // eventi sintetici dal suo mondo isolato e conta come un gesto; quelli della pagina no.
    let daFilo = 0;
    const segnate = new WeakSet();
    function segnaScrittureDiFilo(win) {
      if (PAGINA_DI_FILO) return;
      try {
        const proto = win.EventTarget.prototype;
        if (segnate.has(proto)) return;
        segnate.add(proto);
        const originale = proto.dispatchEvent;
        proto.dispatchEvent = function (ev) { daFilo++; try { return originale.call(this, ev); } finally { daFilo--; } };
      } catch (_) {}
    }
    const gesto = (e) => e.isTrusted || daFilo > 0 || PAGINA_DI_FILO;

    // Un'area vuota resta in elenco: l'editor può rimetterci il testo dopo l'evento.
    function stato() {
      let daInviare = false;
      for (const [area, base] of aree) {
        if (!viva(area)) { lascia(area, base); continue; }
        const ora = pulito(testo(area));
        if (ora && ora !== pulito(base) && !sostituito(area)) daInviare = true;
      }
      // Un componente chiuso tolto dalla pagina non dice se il testo è ricomparso: resta protetto.
      return daInviare || opachi.size > 0 || orfani.length > 0;
    }
    function righeDi(area) {
      let s = '';
      try { s = area.isContentEditable ? area.innerText || area.textContent || '' : testo(area); } catch (_) { s = testo(area); }
      return s.split(/\r\n|\r|\n/).map(pulito).filter(Boolean);
    }
    function lascia(area, base) {
      aree.delete(area);
      // Una password non è una bozza: dopo un accesso fatto senza cambiare pagina proteggerebbe per sempre.
      if (/^input$/i.test(area.tagName) && String(area.type).toLowerCase() === 'password') return;
      const t = pulito(testo(area));
      if (!t || t === pulito(base) || orfani.some((o) => o.t === t)) return;
      if (ricevuti.get(area) === t || sostituito(area)) return;
      const viste = righeViste.get(area);
      orfani.push({ t, righe: viste && viste.join('') === t ? viste : [t] });
      if (orfani.length > 100) orfani.shift();
    }
    // Ricevuto = una richiesta riuscita ne porta ogni riga. Una casella a più righe protegge finché il
    // testo è lì (un'anteprima lo porta come un salvataggio); tolta dalla pagina, non lascia un orfano.
    function partito(inviato) {
      if (typeof inviato !== 'string' || !inviato) return;
      const dentro = (t, righe) => {
        const tutto = essenziale(t);
        if (tutto && inviato.includes(tutto)) return true;
        const r = righe.map(essenziale).filter(Boolean);
        return r.length > 0 && r.every((x) => inviato.includes(x));
      };
      // Il campo può sparire mentre la richiesta è in viaggio: prima diventa un orfano, poi si cerca.
      stato();
      for (const area of [...aree.keys()]) {
        if (!viva(area)) continue;
        const ora = testo(area);
        if (!pulito(ora) || !dentro(ora, righeDi(area))) continue;
        if (lunghe.has(area)) ricevuti.set(area, pulito(ora)); else aree.set(area, ora);
      }
      for (let i = orfani.length - 1; i >= 0; i--) if (dentro(orfani[i].t, orfani[i].righe)) orfani.splice(i, 1);
      aggiorna(false);
    }
    function impronta(s) {
      let h1 = 0xdeadbeef;
      let h2 = 0x41c6ce57;
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 2654435761);
        h2 = Math.imul(h2 ^ c, 1597334677);
      }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
    }
    function impronte() {
      const out = new Set(partiti);
      for (const [area, base] of aree) {
        if (!lunghe.has(area) || !viva(area)) continue;
        const t = pulito(testo(area));
        if (t && t !== pulito(base) && ricevuti.get(area) !== t) out.add(impronta(t));
      }
      return [...out].slice(-50);
    }
    function invia(payload) {
      try { Promise.resolve(chrome.runtime.sendMessage(payload)).catch(() => {}); } catch (_) {}
    }
    // Solo la digitazione vera è un'interazione: una risposta al ricontrollo non
    // deve far sembrare la scheda appena usata al modello.
    function manda(ora, daUtente) {
      ultimoMandato = ora;
      const payload = { type: MSG.TAB_ACTIVITY, formDirty: ora };
      if (daUtente) payload.lastInteractionAt = Date.now();
      invia(payload);
    }
    // Le impronte partono a riposo (dopo la rilettura, all'invio, al ricontrollo), mai a ogni tasto.
    function mandaImpronte() {
      const imp = impronte();
      const k = imp.join(',');
      if (k === ultimeImpronte) return;
      ultimeImpronte = k;
      invia({ type: MSG.TAB_ACTIVITY, impronte: imp });
    }
    function aggiorna(daUtente) {
      const ora = stato();
      if (ora !== ultimoMandato) manda(ora, daUtente);
    }

    const bersaglio = (e) => (e.composedPath && e.composedPath()[0]) || e.target;
    // I riquadri di Filo nella pagina (feedback, spiegazioni, Aiuto) non sono del sito: il loro
    // testo parte o si butta col riquadro. Vale l'elenco di chi li ha disegnati, non l'attributo.
    function diFilo(el) {
      let nostre = [];
      try { nostre = self.SN_FILO_UI?.aperti?.() || []; } catch (_) {}
      for (let n = el; n && nostre.length;) {
        if (nostre.some((r) => r === n || (r.contains && r.contains(n)))) return true;
        const radice = n.getRootNode && n.getRootNode();
        n = radice && radice.host ? radice.host : null;
      }
      return false;
    }
    function campoDa(e) {
      const el = campoDiTesto(bersaglio(e));
      return el && !diRicerca(el) && !diFilo(el) ? el : null;
    }
    // Da dentro un componente chiuso la scrittura arriva al suo host, che non è un campo.
    function opaco(e) {
      if (typeof e.inputType !== 'string') return null;
      const t = bersaglio(e);
      if (!t || t.nodeType !== 1 || t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName)) return null;
      return diFilo(t) ? null : t;
    }
    function aRiposo() {
      clearTimeout(rilettura);
      rilettura = setTimeout(() => {
        stato();
        for (const area of aree.keys()) righeViste.set(area, righeDi(area));
        adotta(null);
        aggiorna(false);
        mandaImpronte();
      }, 400);
    }
    // Un editor di codice riceve i tasti in una casella a più righe e mostra il testo altrove.
    const aPiuRighe = (el) => !!el && (el.tagName.toUpperCase() === 'TEXTAREA' || el.isContentEditable);
    function scritto(area, base, campo) {
      if (!aree.has(area)) aree.set(area, base);
      if (aPiuRighe(area) || aPiuRighe(campo)) lunghe.add(area);
      else digitati.set(area, essenziale(testo(area)));
      aggiorna(true);
      aRiposo();
    }
    function scrittoInOpaco(e) {
      const h = opaco(e);
      if (!h || opachi.has(h)) return;
      opachi.add(h);
      aggiorna(true);
    }
    const iniziale = (a) => (/^(input|textarea)$/i.test(a.tagName) ? a.defaultValue || '' : '');
    function onTocco(e) { ultimoTocco = bersaglio(e); }
    function onPrima(e) {
      if (!gesto(e)) return;
      const campo = campoDa(e);
      if (!campo) { scrittoInOpaco(e); return; }
      const area = areaDi(campo);
      if (!aree.has(area)) basi.set(area, testo(area));
    }
    function onFormInput(e) {
      if (!gesto(e)) return;
      const campo = campoDa(e);
      if (!campo) { scrittoInOpaco(e); return; }
      const area = areaDi(campo);
      scritto(area, basi.has(area) ? basi.get(area) : iniziale(area), campo);
    }
    // Molti editor ricchi incollano e ricevono il trascinamento da soli, senza «input».
    function onIncolla(e) {
      if (!gesto(e)) return;
      const campo = campoDa(e);
      if (!campo) return;
      const area = areaDi(campo);
      scritto(area, testo(area), campo);
      setTimeout(() => {
        if (aree.has(area) && !lunghe.has(area)) digitati.set(area, essenziale(testo(area)));
        aggiorna(true);
      }, 0);
    }

    // Chi invia davvero lascia la pagina. Se la pagina trattiene l'invio, un rifiuto e un invio
    // via script si somigliano: lì decide la risposta del sito alla richiesta che porta il testo (partito).
    // Il testo si smette di seguire solo quando il documento se ne va (lo azzera il main): un modulo
    // mandato in un'altra scheda, in un riquadro o senza cambiare pagina lo lascia nella casella.
    function onSubmit(e) {
      const form = e.target;
      if (!form || !aree.size) return;
      mandaImpronte();
      setTimeout(() => {
        if (e.defaultPrevented) return;
        let conTesto = false;
        for (const [a, base] of [...aree]) {
          if (a.form !== form && !(form.contains && form.contains(a))) continue;
          const ora = pulito(testo(a));
          if (ora && ora !== pulito(base) && !sostituito(a)) conTesto = true;
          const t = lunghe.has(a) ? ora : '';
          if (t && t !== pulito(base)) partiti.add(impronta(t));
        }
        // Il testo ora sta nella pagina di prima: se il sito respinge l'invio la pulizia deve saperlo (main).
        // Un modulo con la password è un accesso o un'iscrizione, non una bozza.
        let dest = '';
        try {
          if (form.querySelector('input[type=password]')) conTesto = false;
          dest = (e.submitter && e.submitter.getAttribute('formtarget')) || form.getAttribute('target') || '';
        } catch (_) {}
        if (conTesto && !IS_SUBFRAME && /^(|_self|_top)$/i.test(dest)) invia({ type: MSG.TAB_ACTIVITY, invioPagina: true, pwPrima: passwordFuori(form) });
        aggiorna(false);
        mandaImpronte();
      }, 0);
    }
    // L'accesso in testata c'è in ogni pagina del sito: nella pagina dopo non vuol dire sessione scaduta.
    function passwordFuori(form) {
      try {
        return Array.prototype.some.call(document.querySelectorAll('input[type=password]'),
          (el) => !form.contains(el) && el.getClientRects().length > 0);
      } catch (_) { return false; }
    }
    // Il modulo parte anche senza il suo bottone (uno script, un controllo antispam, un editor in un
    // riquadro che copia il testo nel modulo): conta quello che il modulo porta, non da dove si è scritto.
    function onDatiModulo(e) {
      const form = e.target;
      if (IS_SUBFRAME || !form || !aree.size || !e.formData) return;
      try {
        if (form.querySelector('input[type=password]')) return;
        if (!/^(|_self|_top)$/i.test(form.getAttribute('target') || '')) return;
      } catch (_) { return; }
      const valori = [];
      try {
        for (const [, v] of e.formData) {
          if (typeof v !== 'string' || !v) continue;
          const t = /[<&]/.test(v) ? new DOMParser().parseFromString(v, 'text/html').body.textContent || '' : v;
          valori.push(essenziale(t));
        }
      } catch (_) {}
      for (const [a, base] of aree) {
        if (!viva(a) || sostituito(a)) continue;
        const ora = testo(a);
        if (!pulito(ora) || pulito(ora) === pulito(base)) continue;
        const ess = essenziale(ora);
        if (ess && valori.some((v) => v.includes(ess))) {
          invia({ type: MSG.TAB_ACTIVITY, invioPagina: true, pwPrima: passwordFuori(form) });
          return;
        }
      }
    }

    // Il documento e le radici aperte dei componenti che contiene. Costa un giro di tutta la
    // pagina: solo al ricontrollo, mai al caricamento.
    function radici(doc) {
      const out = [doc];
      for (let i = 0; i < out.length; i++) for (const el of out[i].querySelectorAll('*')) if (el.shadowRoot) out.push(el.shadowRoot);
      return out;
    }
    function* documenti(doc, n = 0) {
      yield doc;
      if (n >= 4) return;
      for (const r of radici(doc)) for (const f of r.querySelectorAll('iframe, frame')) {
        const d = globalThis.SN_RIQUADRI_IN_ARRIVO?.documento(f);
        if (d) yield* documenti(d, n + 1);
      }
    }
    // Il testo dell'utente si segue per contenuto: un campo che mostra il testo di un'area tolta
    // (cambio di editor) o rimandato dal server (anteprima, invio respinto, passo dopo) è ancora suo.
    function adotta(daServer) {
      const cercate = new Set(Array.isArray(daServer) ? daServer.map(String) : []);
      if (!cercate.size && !orfani.length) return;
      for (const doc of documenti(document)) for (const r of radici(doc)) {
        for (const el of r.querySelectorAll('textarea, [contenteditable], input')) {
          const nascosto = el.tagName.toUpperCase() === 'INPUT' && String(el.type).toLowerCase() === 'hidden';
          const area = nascosto ? el : campoDiTesto(el);
          if (!area || aree.has(area) || area.readOnly || area.disabled || diRicerca(area) || diFilo(area)) continue;
          const t = pulito(testo(area));
          if (!t) continue;
          const o = orfani.findIndex((x) => x.t === t || (x.t.length >= 20 && t.includes(x.t)));
          if (o < 0 && !cercate.has(impronta(t))) continue;
          if (o >= 0) orfani.splice(o, 1);
          aree.set(area, '');
          if (area.tagName.toUpperCase() !== 'INPUT' || nascosto) lunghe.add(area);
        }
      }
    }
    // I riquadri senza indirizzo proprio (gli editor classici scritti dalla pagina)
    // non caricano Filo: li segue il documento che li contiene. Riaggiungere gli
    // ascoltatori non li duplica, e dopo un document.open() li rimette.
    function osserva(win) {
      const o = { passive: true, capture: true };
      segnaScrittureDiFilo(win);
      try {
        win.addEventListener('pointerdown', onTocco, o);
        win.addEventListener('beforeinput', onPrima, o);
        win.addEventListener('input', onFormInput, o);
        win.addEventListener('change', onFormInput, o);
        win.addEventListener('paste', onIncolla, o);
        win.addEventListener('drop', onIncolla, o);
        win.addEventListener('submit', onSubmit, o);
        win.addEventListener('formdata', onDatiModulo, o);
        win.addEventListener('blur', onUscita);
        win.document.addEventListener('load', onCaricato, o);
        for (const f of win.document.querySelectorAll('iframe, frame')) riquadro(f);
      } catch (_) {}
    }
    // Uno che carica ancora il suo indirizzo non si tocca (perderebbe il suo Filo, #1560): lo riprende onCaricato.
    function riquadro(f) {
      const w = globalThis.SN_RIQUADRI_IN_ARRIVO?.finestra(f);
      try { if (!w || !w.document) return; } catch (_) { return; }
      osserva(w);
    }
    const eRiquadro = (t) => !!(t && t.tagName && /^i?frame$/i.test(t.tagName));
    function onCaricato(e) { if (eRiquadro(e.target)) riquadro(e.target); }
    function onUscita(e) {
      const w = e.target;
      setTimeout(() => {
        try {
          let a = w.document.activeElement;
          while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
          if (eRiquadro(a)) riquadro(a);
        } catch (_) {}
      }, 0);
    }

    // Tornando Indietro il browser rimette nei campi il testo di prima, senza
    // eventi: è ancora testo dell'utente.
    function adottaRipristinati() {
      let nav = null;
      try { nav = performance.getEntriesByType('navigation')[0]; } catch (_) {}
      if (!nav || nav.type !== 'back_forward') return;
      for (const el of document.querySelectorAll('input, textarea')) {
        if (!campoDiTesto(el) || diRicerca(el) || !grande(el) || el.value === el.defaultValue) continue;
        aree.set(el, el.defaultValue);
        if (el.tagName.toUpperCase() === 'TEXTAREA') lunghe.add(el);
      }
    }
    adottaRipristinati();
    // In un riquadro Filo si monta al primo tocco: quel che si è scritto prima
    // dell'arrivo di questo script sta nel campo col fuoco.
    const attivo = IS_SUBFRAME && campoDiTesto(document.activeElement);
    if (attivo && !diRicerca(attivo) && areaDi(attivo) === attivo
      && (attivo.isContentEditable || attivo.value !== attivo.defaultValue)) {
      aree.set(attivo, attivo.isContentEditable ? '' : attivo.defaultValue);
      if (attivo.isContentEditable || attivo.tagName.toUpperCase() === 'TEXTAREA') lunghe.add(attivo);
    }
    if (aree.size) { aggiorna(false); mandaImpronte(); }

    osserva(window);
    // Pagina tornata dalla cache di navigazione: per il main è un documento nuovo.
    window.addEventListener('pageshow', (e) => {
      if (!e.persisted) return;
      manda(stato(), false);
      ultimeImpronte = '';
      mandaImpronte();
    });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === MSG.FORM_SENT) { try { partito(msg.testo); } catch (_) {} return; }
      if (!msg || msg.type !== MSG.FORM_RECHECK) return;
      osserva(window);
      stato();
      try { adotta(msg.impronte); } catch (_) {}
      manda(stato(), false);
      mandaImpronte();
    });
  }

  // Le richieste di fuori che agiscono sulla pagina: con Filo spento sul sito non partono (#843).
  const AZIONI_DA_FUORI = new Set([MSG.TOP_FRAME_COMMAND, MSG.BARRA_FUORI, MSG.BARRA_ETICHETTE_CHIEDI, MSG.SHOW_TOAST]);

  // Il segno che legge il ponte del tasto destro (page-preload.js) a ogni clic, rifatto a ogni cambio dell'elenco.
  // Spegnendosi se ne va il menu di Filo già aperto; l'Aiuto aperto resta, perché ci si sta parlando.
  function seguiSpento() {
    const spento = isBlocked();
    if (spento && self.__snFiloSpento !== true) { try { Menu.close(); } catch (_) {} }
    self.__snFiloSpento = spento;
    riferisciAiuto();
  }

  function isBlocked() { return !!motivoBlocco(); }

  // 'pagina' dove Filo non c'è mai, 'sito' dove l'utente l'ha spento; '' altrimenti.
  function motivoBlocco() {
    const url = location.href;
    // Dentro un riquadro «about:blank» e «about:srcdoc» sono contenuto di chi lo ospita, non
    // pagine di sistema: lì il menu deve esserci come ovunque (#405).
    const embeddedAbout = IS_SUBFRAME && /^about:(blank|srcdoc)/i.test(url);
    if (!embeddedAbout && PAGES_WITHOUT_MENU_PREFIXES.some((p) => url.startsWith(p))) return 'pagina';
    const blocklist = settings?.blocklist || [];
    const matches = (host) => !!host && blocklist.some((d) => host === d || host.endsWith('.' + d));
    // Se l'utente ha spento Filo su un sito, deve restare spento anche nei
    // riquadri che quel sito incorpora: il riquadro ha un'altra origine e da
    // solo non lo saprebbe, quindi guarda l'indirizzo della pagina ospite.
    if (matches(hostOfUrl(pageUrl))) return 'sito';
    return matches(location.hostname) ? 'sito' : '';
  }

  function hostOfUrl(url) {
    try { return new URL(String(url || '')).hostname; } catch (_) { return ''; }
  }

  // Indirizzo della pagina che ospita questo frame: arriva dal main, perché da dentro un
  // riquadro di un'altra origine non è leggibile.
  let pageUrl = '';
  // Finché il main non l'ha detto non si sa: vale incognito, e la selezione non parte da sola verso un modello.
  let inIncognito = true;

  async function fetchSettings() {
    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.GET_SETTINGS });
      if (res && typeof res.pageUrl === 'string') pageUrl = res.pageUrl;
      if (res && typeof res.incognito === 'boolean') inIncognito = res.incognito;
      return res?.settings || self.SN_CONST.DEFAULT_SETTINGS;
    } catch (_) {
      return self.SN_CONST.DEFAULT_SETTINGS;
    }
  }

  function applyTheme(theme) {
    let resolved = theme;
    if (theme === 'system') {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.dataset.snTheme = resolved;
  }

  // Token estetici scelti dall'utente per le superfici Filo nella pagina (#146.1).
  // Idempotente, quindi innocuo anche sulle pagine filo://, dove ci pensa pageBootstrap.
  function applyThemeTokens(tokens) {
    const reg = self.SN_THEME_TOKENS;
    if (reg) reg.applyToDocument(document, tokens || {});
  }

  // Il vero elemento cliccato. Il listener contextmenu vive su window (via il
  // ponte del page-preload): quando l'evento nasce DENTRO uno shadow root (i
  // "componenti" web usati dai siti moderni) `e.target` viene ri-targettizzato
  // all'host del componente, e closest()/tagName non vedono più il link,
  // l'immagine o il campo davvero cliccati. composedPath()[0] attraversa lo
  // shadow boundary e restituisce l'elemento reale.
  // Dentro un riquadro chiuso di Filo (spiegazione, Modifica, feedback) il nodo vero lo sa solo SN_FILO_UI.
  function realTarget(e) {
    const UI = self.SN_FILO_UI;
    if (e && UI?.bersaglio) return UI.bersaglio(e);
    return (typeof e?.composedPath === 'function' && e.composedPath()[0]) || e?.target || null;
  }

  // `closest()` si ferma al confine del componente: sui siti moderni la copertina di una
  // scheda sta in un componente dentro l'<a>, e la risalita tornava null (#444).
  function closestAcrossShadow(el, selector) {
    let node = el;
    while (node) {
      const hit = node.closest?.(selector);
      if (hit) return hit;
      const root = node.getRootNode?.();
      node = (root && root.host) ? root.host : null;
    }
    return null;
  }

  // `elementsFromPoint` di un componente restituisce l'HOST, mai il contenuto: qui si
  // ripete il colpo dentro ogni shadow root, le parti prima del loro host (#444).
  function deepElementsFromPoint(x, y) {
    const out = [];
    const seen = new Set();
    const collect = (root) => {
      let hits = [];
      try { hits = root.elementsFromPoint?.(x, y) || []; } catch (_) { hits = []; }
      for (const el of hits) {
        if (!el || seen.has(el)) continue;
        seen.add(el);
        const ombra = el.shadowRoot || self.SN_FILO_UI?.ombraDi?.(el);
        if (ombra) collect(ombra);
        out.push(el);
      }
    };
    try { collect(document); } catch (_) {}
    return out;
  }

  // ------------------------------------------------------------
  // Handler contextmenu
  // ------------------------------------------------------------
  // ------------------------------------------------------------
  // Il menu che il sito si disegna da sé (#975): «Menu di <sito>» in cima, e la scelta di aprirlo subito.
  // Chi ascolta e il clic rigiocato stanno in src/preload/menu-del-sito.js; la scelta per sito in menuDelSito.siti.
  // ------------------------------------------------------------
  // Il sito è quello del frame cliccato: il menu di un riquadro è del suo sito, non della pagina che lo ospita.
  function hostQui() {
    try { return String(location.hostname || '').toLowerCase().replace(/\.+$/, ''); } catch (_) { return ''; }
  }

  function menuDelSitoPrima() {
    const h = hostQui();
    const siti = settings?.menuDelSito?.siti;
    if (!h || !Array.isArray(siti)) return false;
    return siti.some((d) => typeof d === 'string' && d && (h === d || h.endsWith(`.${d}`)));
  }

  // Il nome che il sito dà a sé stesso; senza, il suo indirizzo. Testo della pagina: niente caratteri che girano la riga.
  const NOME_SITO_MAX = 40;
  function nomeDelSito() {
    const meta = (sel) => { try { return document.querySelector(sel)?.getAttribute('content') || ''; } catch (_) { return ''; } };
    let n = meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]')
      || meta('meta[name="apple-mobile-web-app-title"]');
    n = String(n).replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
    if (n.length > NOME_SITO_MAX) n = `${n.slice(0, NOME_SITO_MAX - 1).trimEnd()}…`;
    return n || hostQui().replace(/^www\./, '');
  }

  // La voce c'è se sul cammino del clic la pagina ascolta il tasto destro; col menu del sito già al primo posto,
  // dal menu aperto con Shift c'è sempre: è da lì che si torna a quello di Filo.
  function statoMenuDelSito(e, opzioni) {
    const M = self.__snMenuDelSito;
    if (!M || PAGINA_DI_FILO || !hostQui()) return null;
    const nodo = realTarget(e);
    if (!nodo || self.SN_FILO_UI?.inside?.(nodo)) return null;
    const prima = menuDelSitoPrima();
    if (!(prima && opzioni && opzioni.conMaiusc) && !M.ascolta(nodo)) return null;
    return {
      nodo, prima, nome: nomeDelSito(),
      x: e.clientX, y: e.clientY, sx: e.screenX, sy: e.screenY,
      ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, clic: Date.now(),
    };
  }

  function conMenuDelSito(items, sito) {
    if (!sito) return;
    items.unshift({
      type: 'split',
      azione: 'site-own-menu',
      label: I18n.t('menu_del_sito').replace('%s', () => sito.nome),
      onClick: () => apriMenuDelSito(sito),
      arrowTitle: I18n.t('menu_del_sito_scelta'),
      subItems: [sito.prima
        ? { label: I18n.t('menu_del_sito_torna_filo'), onClick: () => impostaMenuDelSito(false) }
        : { label: I18n.t('menu_del_sito_sempre'), onClick: () => impostaMenuDelSito(true) }],
    }, { type: 'separator' });
  }

  // Dopo il clic sulla voce, non dentro: il clic che risale al documento chiuderebbe il menu appena aperto.
  function apriMenuDelSito(sito) {
    setTimeout(async () => {
      let esito = null;
      try { esito = await self.__snMenuDelSito.apri(sito); } catch (_) { esito = null; }
      if (esito !== 'menu' || sito.prima) return;
      try { await chrome.runtime.sendMessage({ type: MSG.MENU_DEL_SITO_SCELTO }); } catch (_) {}
    }, 0);
  }

  function impostaMenuDelSito(attivo) {
    try { Promise.resolve(chrome.runtime.sendMessage({ type: MSG.MENU_DEL_SITO_IMPOSTA, attivo, avvisa: true })).catch(() => {}); } catch (_) {}
  }

  // `conMaiusc`: sui siti dove il tasto destro apre il loro menu, Shift porta qui (#975).
  async function onContextMenu(e, opzioni) {
    // Se l'utente tiene Shift premuto, lascia passare il menu nativo (escape hatch); Shift+F10 è la tastiera che chiede il nostro.
    if (e.shiftKey && !(opzioni && opzioni.conMaiusc) && !(Menu.daTastiera && Menu.daTastiera())) return;
    // Prima di ogni attesa: dopo, il cammino dell'evento non c'è più.
    const sito = statoMenuDelSito(e, opzioni);

    // stopPropagation tiene fuori il menu del sito; NON stopImmediatePropagation, che
    // soffocherebbe l'evento del correttore nativo, né preventDefault.
    e.stopPropagation();

    const avviso = self.SN_AVVISI?.avvisoSotto?.(realTarget(e));
    if (avviso) { openAvvisoMenu(avviso, e); return; }
    // Il documento trovato dall'Aiuto (#947.3): le azioni di un file, non quelle della pagina.
    const file = self.SN_SIDEBAR?.fileSotto?.(realTarget(e));
    if (file) { Menu.open({ x: e.clientX, y: e.clientY, items: file.map((a) => ({ type: 'item', label: a.label, onClick: () => a.fn() })) }); return; }

    // Il correttore (#1446): su un segno, il menu del segno; nelle caselle di una riga, che Filo non segna, la parola
    // sotto il cursore. Il resto è il menu normale, che sul campo porta «Correggi tutti gli errori».
    try {
      if (SpellCheck && (SpellCheck.erroriAttivi() || SpellCheck.suggerimentiAttivi() || SpellCheck.segnapostiAttivi())) {
        const rt = realTarget(e);
        // Il valore sopra un segnaposto (#1448) ha il menu del suo segnaposto.
        const valore = SpellCheck.valoreSotto(rt);
        if (valore) {
          await openSpellMarksMenu(valore.el, { errore: null, suggerimento: valore.segno }, e, sito);
          return;
        }
        const editableEl = SpellCheck.findSupportedEditable(rt);
        if (editableEl) {
          const sotto = SpellCheck.segniSotto(editableEl, e.clientX, e.clientY);
          if (sotto.errore || sotto.suggerimento) {
            await openSpellMarksMenu(editableEl, sotto, e, sito);
            return;
          }
          // Una parola che il browser segna e Filo no (il dizionario non ancora pronto, un campo mai entrato col fuoco):
          // la proposta del browser, come nelle caselle di una riga.
          const wordCtx = SpellCheck.erroriAttivi() ? SpellCheck.getWordAt(editableEl, e.clientX, e.clientY) : null;
          if (wordCtx && !SpellCheck.parolaGiusta(editableEl, wordCtx.word)
            && (SpellCheck.getNativeSuggestions(wordCtx.word).length || SpellCheck.sbagliataPerIlBrowser(wordCtx.word))) {
            await openSpellWordMenu(editableEl, wordCtx, e, sito);
            return;
          }
        }
        const inputEl = SpellCheck.erroriAttivi() ? rt?.closest?.('input') : null;
        if (inputEl && isTextLikeInput(inputEl) && !SpellCheck.campoEscluso(inputEl)) {
          const wordCtx = SpellCheck.getInputWordAt?.(inputEl, e.clientX, e.clientY);
          if (wordCtx && !SpellCheck.isInDictionary(wordCtx.word)) {
            await openSpellWordMenu(inputEl, wordCtx, e, sito);
            return;
          }
        }
      }
    } catch (err) {
      console.error('[SN] correttore, tasto destro: apro il menu normale', err);
    }

    await openNormalMenuAt(e, sito);
  }

  // Le azioni dell'avviso e «Chiudi», nello stesso ordine del menu degli avvisi della barra.
  function openAvvisoMenu({ el, chiudi, azioni }, e) {
    const items = [];
    if (azioni) {
      for (const a of azioni) items.push({ type: 'item', label: a.label, onClick: () => a.fn() });
    } else {
      for (const b of el.querySelectorAll('button')) {
        const label = (b.textContent || '').trim();
        if (label) items.push({ type: 'item', label, onClick: () => b.click() });
      }
    }
    items.push({ type: 'item', label: I18n.t('popup_close'), onClick: () => chiudi() });
    Menu.open({ x: e.clientX, y: e.clientY, items });
  }

  // Solo gli input in cui ha senso una correzione: su password, email e number la
  // spellcheck nativa è disattivata o non significativa.
  function isTextLikeInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if (el.disabled || el.readOnly) return false;
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    if (!['text', 'search', ''].includes(t)) return false;
    // La correzione manda al modello la parola e tutto il campo: in una password resa visibile, no (#810.7).
    if (Extract?.campoSegreto?.(el)) return false;
    // Rispetta la disabilitazione esplicita.
    const sc = el.getAttribute('spellcheck');
    if (sc === 'false') return false;
    return true;
  }

  // Sul sito dove Filo è spento il correttore tace e il browser torna a sottolineare da sé (#589.2, #1446).
  function impostazioniDelCorrettore() {
    return isBlocked() ? { featureFlags: { spellcheck: false, spellcheckContext: false }, sitoSpento: true } : settings;
  }

  async function openNormalMenuAt(e, sito = null) {
    // Timestamp del click destro: serve a onNextNativeSuggestion per decidere
    // se il broadcast `_spell:native` arrivato durante l'await sotto è già
    // pertinente a questa apertura del menu (altrimenti lo perdevamo).
    const openedAt = Date.now();
    const target = realTarget(e);
    let selInfo = Extract.getSelectionWithSentence(target);
    // window.getSelection() non vede la selezione dentro <input>/<textarea>:
    // recuperiamola dal nodo stesso così Taglia/Copia compaiono nel menu.
    if (!selInfo) selInfo = getInputSelectionInfo(target);
    const {
      linkEl, imgEl, mediaEl, mediaUnder, imgUnder, linkUnder, layers, editable,
    } = detectContext(target, e.clientX, e.clientY);
    if (editable) capturePasteContext(target);
    else pasteContext = null;
    const [clipboardHistory, navState] = await Promise.all([
      Actions.getClipboardHistory(),
      Actions.getNavState(),
    ]);
    const items = buildMenuItems({
      selInfo, linkEl, imgEl, mediaEl, mediaUnder, imgUnder, linkUnder, layers, editable, clipboardHistory, navState, target,
    });

    // Slot riservato per la correzione ortografica nativa: nascosto finché
    // Electron non ci notifica via broadcast la parola misspelled e i
    // suggerimenti. Posizionato in cima al menu come voce principale.
    //
    // Lo riserviamo su OGNI menu normale, non solo sui <input> (#438). Il
    // correttore nativo di Chromium vede il campo anche dove noi non riusciamo a
    // capire cosa è stato cliccato: dentro i blocchi "sigillati" (shadow root
    // chiuso) il bersaglio reale non è raggiungibile da nessuna API di pagina, e
    // lì il menu restava senza correzione pur essendoci una parola sbagliata
    // sotto al cursore. Il broadcast arriva SOLO quando Chromium ha davvero
    // trovato una parola errata sotto al click, quindi su un menu qualunque lo
    // slot resta invisibile e non costa nulla. La sostituzione passa da
    // applyNativeCorrection, che agisce sul campo a fuoco senza doverlo
    // identificare dalla pagina. Resta appeso al correttore: se l'utente lo ha
    // spento, niente slot e niente suggerimenti.
    // Nei campi dove i segni li disegna Filo (#1446) decide il correttore: una parola che sa giusta (un cognome scartato
    // dal modello, una parola ignorata) non riprende dal browser la sua «correzione».
    const campoDiFilo = SpellCheck?.findSupportedEditable?.(target) || null;
    const wantCorrection = !!SpellCheck && SpellCheck.erroriAttivi();
    let updateCorrection = null;
    const tutti = campoDiFilo ? voceCorreggiTutti(campoDiFilo, 1) : null;
    if (tutti) items.unshift(tutti, { type: 'separator' });
    const annulla = campoDiFilo ? voceAnnullaCorrezione(campoDiFilo, e) : null;
    if (annulla) items.unshift(annulla, { type: 'separator' });
    if (wantCorrection) {
      items.unshift(
        {
          type: 'correction',
          label: '',
          loading: false,
          hidden: true,
          onClick: null,
          subItems: [],
          onMount: (_root, update) => { updateCorrection = update; },
        },
        { type: 'separator', hidden: true },
      );
    }
    const revealNativeCorrection = (word, suggestions) => {
      const sugg = (suggestions || []).filter((s) => s && s !== word);
      if (!updateCorrection || !sugg.length) return;
      const top = sugg[0];
      const subItems = sugg.slice(1, 5).map((s) => ({
        label: s,
        onClick: () => applyNativeCorrection(word, s),
      }));
      updateCorrection({
        hidden: false,
        label: top,
        loading: false,
        onClick: () => applyNativeCorrection(word, top),
        subItems,
      });
    };

    conMenuDelSito(items, sito);
    Menu.open({ x: e.clientX, y: e.clientY, items, keepOnScroll: !!selInfo });

    if (wantCorrection) {
      // Col timestamp di apertura il modulo spellcheck consegna subito un broadcast già
      // arrivato durante l'await qui sopra, invece di lasciarci aspettare.
      SpellCheck.onNextNativeSuggestion?.(({ word, suggestions }) => {
        if (!suggestions?.length || (campoDiFilo && SpellCheck.parolaGiusta(campoDiFilo, word))) return;
        revealNativeCorrection(word, suggestions);
      }, { since: openedAt });
    }
  }

  // Applica un suggerimento nativo sostituendo la SELEZIONE, che è la parola segnata dal
  // correttore: è l'unica strada nei blocchi sigillati (#438), dove il campo è fuori mano.
  function applyNativeCorrection(word, suggestion) {
    if (!suggestion) return;
    if (word && SpellCheck?.accettata) SpellCheck.accettata(word, suggestion);
    try {
      const sel = window.getSelection && window.getSelection();
      const selected = sel ? String(sel) : '';
      if (word && selected.trim() === String(word).trim()
          && document.execCommand('insertText', false, suggestion)) return;
    } catch (_) {}
    chrome.runtime.sendMessage({ type: MSG.REPLACE_MISSPELLING, suggestion });
  }

  // Salva il target editabile e la sua selezione/range al momento dell'apertura
  // del menu, perché il click sul bottone del menu sposta il focus altrove.
  let pasteContext = null;
  function capturePasteContext(target) {
    if (!target) { pasteContext = null; return; }
    const inputEl = target.closest?.('input, textarea');
    if (inputEl && inputEl.matches('input, textarea')) {
      pasteContext = {
        kind: 'input',
        el: inputEl,
        start: inputEl.selectionStart ?? inputEl.value.length,
        end: inputEl.selectionEnd ?? inputEl.value.length,
      };
      return;
    }
    const ceEl = target.closest?.('[contenteditable=""], [contenteditable="true"]');
    if (ceEl) {
      const sel = window.getSelection();
      let range = null;
      if (sel && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0);
        if (ceEl.contains(r.startContainer)) range = r.cloneRange();
      }
      pasteContext = { kind: 'ce', el: ceEl, range };
      return;
    }
    pasteContext = null;
  }

  function restorePasteContext() {
    if (!pasteContext) return false;
    const { kind, el } = pasteContext;
    if (!el || !el.isConnected) { pasteContext = null; return false; }
    if (kind === 'input') {
      el.focus();
      try { el.setSelectionRange(pasteContext.start, pasteContext.end); } catch (_) {}
      return true;
    }
    if (kind === 'ce') {
      el.focus();
      if (pasteContext.range) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(pasteContext.range);
      }
      return true;
    }
    return false;
  }

  // `mediaEl`: il click è sul media, ed è il contesto principale. `mediaUnder`: media sotto
  // al punto cliccato, ripiego SOLO senza altro contesto, o un video di sfondo ruberebbe.
  function findMedia(target, view) {
    const direct = (target?.tagName === 'VIDEO' || target?.tagName === 'AUDIO')
      ? target
      : closestAcrossShadow(target, 'video, audio');
    if (direct) return { mediaEl: direct, mediaUnder: null };
    let under = null;
    for (const el of view.stack) {
      if (el.tagName !== 'VIDEO' && el.tagName !== 'AUDIO') continue;
      if (!sameSurface(target, el, view)) continue;
      under = el;
      break;
    }
    return { mediaEl: null, mediaUnder: under };
  }

  // Immagine e collegamento SOTTO il punto cliccato: le schede sono strati sovrapposti, e
  // senza il ripiego per ogni famiglia lo stesso pixel dà menu diversi (#444).
  function findUnder(view, selector, anchor) {
    for (const el of view.stack) {
      const hit = closestAcrossShadow(el, selector);
      if (hit && sameSurface(anchor, hit, view)) return hit;
    }
    return null;
  }

  // Si adotta da sotto solo ciò che l'utente sta GUARDANDO, o una barra fissa o un manto
  // regalerebbero al menu un collegamento invisibile scelto dalla pagina (#444).
  const SURFACE_SLACK_PX = 4;
  // Sopra questa frazione il più grande CONTIENE il più piccolo invece di coprirlo: le
  // misure vere stanno lontane dalla soglia da tutte e due le parti.
  const CONTAINER_MIN_RATIO = 0.35;

  // Contenimento STRETTO su tutti e quattro i lati: la striscia del titolo condivide i
  // bordi con la copertina, e una tolleranza la scambiava per una copertura.
  function engulfs(outer, inner) {
    return outer.left < inner.left - SURFACE_SLACK_PX
      && outer.top < inner.top - SURFACE_SLACK_PX
      && outer.right > inner.right + SURFACE_SLACK_PX
      && outer.bottom > inner.bottom + SURFACE_SLACK_PX;
  }

  function swallows(outer, inner) {
    if (!engulfs(outer, inner)) return false;
    const areaOuter = outer.width * outer.height;
    const areaInner = inner.width * inner.height;
    return areaInner < areaOuter * CONTAINER_MIN_RATIO;
  }

  // Barre, riquadri dei cookie e inviti stanno in uno strato fisso: quello che finisce lì
  // sotto è contenuto seppellito, non la stessa scheda. Le schede vere non sono mai fisse.
  function inFixedLayer(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      try {
        const p = getComputedStyle(node).position;
        if (p === 'fixed' || p === 'sticky') return true;
      } catch (_) { return false; }
      node = node.parentElement || node.getRootNode?.()?.host || null;
    }
    return false;
  }

  // Seconda prova: se fra il punto cliccato e il candidato non c'è niente di DIPINTO,
  // l'utente lo vede, e la geometria non ha più niente da aggiungere (#444).

  const SELF_PAINTING_TAGS = new Set([
    'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'SVG', 'IFRAME', 'EMBED', 'OBJECT',
    'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'HR', 'PROGRESS', 'METER',
  ]);
  // Sotto questa opacità uno sfondo non copre niente: serve solo a intercettare il mouse,
  // come i veli delle schede.
  const VEIL_ALPHA = 0.05;

  function colorAlpha(css) {
    const v = (css || '').trim();
    if (!v || v === 'transparent' || v === 'none') return 0;
    const m = /^rgba?\(([^)]+)\)$/.exec(v);
    if (!m) return 1;
    const parts = m[1].split(/[,/\s]+/).filter(Boolean);
    if (parts.length < 4) return 1;
    const a = parseFloat(parts[3]);
    return Number.isFinite(a) ? a : 1;
  }

  // Testo dei lettori di schermo ritagliato a un pixel: non deve far passare per opaco un
  // velo vuoto (le righe dei risultati ci infilano spesso il titolo ripetuto).
  function hasVisibleText(el) {
    const t = el.textContent;
    if (!t || !t.trim()) return false;
    try {
      const r = document.createRange();
      r.selectNodeContents(el);
      const box = r.getBoundingClientRect();
      return box.width > 2 && box.height > 2;
    } catch (_) {
      return true;
    }
  }

  function paintsSomething(el) {
    if (!el || el.nodeType !== 1) return false;
    if (SELF_PAINTING_TAGS.has(el.tagName)) return true;
    let cs = null;
    try { cs = getComputedStyle(el); } catch (_) { return true; }
    if (!cs) return true;
    if (cs.visibility === 'hidden' || cs.opacity === '0') return false;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
    if (colorAlpha(cs.backgroundColor) > VEIL_ALPHA) return true;
    if (cs.boxShadow && cs.boxShadow !== 'none') return true;
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (cs[`border${side}Style`] !== 'none'
        && parseFloat(cs[`border${side}Width`]) > 0
        && colorAlpha(cs[`border${side}Color`]) > VEIL_ALPHA) return true;
    }
    return hasVisibleText(el);
  }

  // `contains()` non vede dentro uno shadow root: «la copertina sta dentro il
  // collegamento» risultava falso proprio sulle schede fatte a componenti.
  function containsAcrossShadow(ancestor, el) {
    if (!ancestor || !el) return false;
    let node = el;
    while (node) {
      if (node === ancestor) return true;
      node = node.parentNode || node.host || null;
    }
    return false;
  }

  // Se il rettangolo non copre il punto cliccato, l'elemento sta nella pila per uno
  // PSEUDO-elemento (il link steso con ::after): lì il rettangolo non misura niente.
  function coversPoint(rect, view) {
    if (!rect || !view) return false;
    return view.x >= rect.left && view.x <= rect.right
      && view.y >= rect.top && view.y <= rect.bottom;
  }

  // La pila arriva nell'ordine in cui si vede: chi sta prima sta sopra. Antenati e
  // discendenti di `el` non contano — per chi guarda un figlio È `el`.
  function coveredAt(el, view) {
    // Senza la pila non possiamo dimostrare niente: in dubbio resta il freno
    // geometrico, cioè il comportamento di prima.
    if (!el || !Array.isArray(view?.stack)) return true;
    for (const other of view.stack) {
      if (other === el) return false;
      if (containsAcrossShadow(el, other) || containsAcrossShadow(other, el)) continue;
      if (!coversPoint(other.getBoundingClientRect?.(), view)) continue;
      if (paintsSomething(other)) return true;
    }
    return true;
  }

  // Quanto del candidato può stare sotto uno strato ESTRANEO restando quello che l'utente
  // guarda: la striscia del titolo copre il 31% e passa, un pannello su mezza scheda no.
  const HIDDEN_FRACTION = 0.45;

  // Senza nessun colore leggibile si risponde 1: nel dubbio la sfumatura copre, perché
  // l'errore imprudente regala al menu un collegamento scelto dalla pagina.
  function minAlphaInCssImage(bg) {
    let min = Infinity;
    const re = /rgba?\([^)]+\)/g;
    let m;
    while ((m = re.exec(bg))) {
      const a = colorAlpha(m[0]);
      if (a < min) min = a;
    }
    if (/\btransparent\b/.test(bg)) min = 0;
    return min === Infinity ? 1 : min;
  }

  // La faccia del candidato sono lui, i suoi parenti DOM e una copertina; tutto il resto,
  // se ne copre più di HIDDEN_FRACTION, lo sta seppellendo.
  function hiddenBehindForeignPaint(cand, view) {
    if (!cand || !Array.isArray(view?.stack)) return false;
    const rb = cand.getBoundingClientRect?.();
    if (!rb || !(rb.width * rb.height > 0)) return false;
    for (const L of view.stack) {
      // Arrivati al candidato o alla sua famiglia DOM: da qui in giù è la sua
      // stessa faccia, non una copertura.
      if (L === cand || containsAcrossShadow(cand, L) || containsAcrossShadow(L, cand)) return false;
      if (!coversPoint(L.getBoundingClientRect?.(), view)) continue;
      // Le copertine sono la faccia della scheda, non una copertura.
      if (COVER_TAGS.has(L.tagName)) continue;
      // A nascondere è uno SFONDO COPRENTE: attorno ai glifi del testo si vede quello che c'è
      // dietro. I gradienti si contano per prudenza, l'immagine di sfondo no: è una copertina.
      let cs = null;
      try { cs = getComputedStyle(L); } catch (_) { continue; }
      if (!cs || cs.visibility === 'hidden') continue;
      const layerOpacity = parseFloat(cs.opacity);
      if (Number.isFinite(layerOpacity) && layerOpacity < 0.5) continue;
      const bg = cs.backgroundImage;
      if (bg && bg !== 'none' && bg.includes('url(')) continue;
      // Una sfumatura trasparente da qualche parte è un velo, non una copertura: nasconde solo
      // quella coprente su tutti i colori.
      const gradientHides = bg && bg !== 'none' ? minAlphaInCssImage(bg) >= 0.5 : false;
      const opaqueBg = gradientHides || colorAlpha(cs.backgroundColor) >= 0.5;
      if (!opaqueBg) continue;
      const r = L.getBoundingClientRect();
      const w = Math.min(r.right, rb.right) - Math.max(r.left, rb.left);
      const h = Math.min(r.bottom, rb.bottom) - Math.max(r.top, rb.top);
      if (w > 0 && h > 0 && (w * h) > rb.width * rb.height * HIDDEN_FRACTION) return true;
    }
    return false;
  }

  // Un contenuto appartiene a un collegamento se ci sta dentro nel DOM o se ne occupa la
  // superficie. Il DOM viene prima: rifare il conto sui rettangoli può solo togliere.
  function belongsTo(el, linkEl, view) {
    if (!el || !linkEl) return false;
    return containsAcrossShadow(linkEl, el) || sameSurface(el, linkEl, view);
  }

  function sameSurface(a, b, view) {
    if (!a || !b) return false;
    const ra = a.getBoundingClientRect?.();
    const rb = b.getBoundingClientRect?.();
    if (!ra || !rb) return false;
    const areaA = ra.width * ra.height;
    const areaB = rb.width * rb.height;
    if (!(areaA > 0) || !(areaB > 0)) return false;
    // I rettangoli valgono solo se sono quelli del punto cliccato: se uno dei due è nella
    // pila per uno pseudo-elemento, il suo rettangolo sta altrove e il conto è rumore.
    if (coversPoint(ra, view) && coversPoint(rb, view)) {
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w <= 0 || h <= 0) return false;
      if ((w * h) * 2 < Math.min(areaA, areaB)) return false;
      // Con fissità diverse i rettangoli non decidono: una barra condivide i bordi con ciò che
      // le scivola sotto. Decide la prova di visibilità, che una barra opaca non passa.
      if (inFixedLayer(a) === inFixedLayer(b)
        && !hiddenBehindForeignPaint(b, view)
        && !swallows(ra, rb) && !swallows(rb, ra)) return true;
    }
    // Prova diretta, e vale da sola: se nessuno dei due ha qualcosa di dipinto davanti, in
    // questo punto sono entrambi sotto gli occhi dell'utente (#444).
    return !coveredAt(a, view) && !coveredAt(b, view);
  }

  // Il riconoscimento sta in un posto solo: il menu si apre da due strade (normale e
  // correzione), e copiato in entrambe lo stesso clic dava due menu diversi.
  function detectContext(target, x, y) {
    const linkEl = closestAcrossShadow(target, Actions.SELETTORE_COLLEGAMENTO);
    const imgEl = target?.tagName === 'IMG' ? target : closestAcrossShadow(target, 'img');
    // Un solo hit-test per tutte e tre le famiglie: è la stessa pila. `view` = la pila PIÙ
    // il punto, perché un rettangolo vale come misura solo se copre quel punto.
    const view = { stack: deepElementsFromPoint(x, y), x, y };
    const { mediaEl, mediaUnder } = findMedia(target, view);
    const imgUnder = imgEl ? null : findUnder(view, 'img', target);
    return {
      linkEl,
      imgEl,
      mediaEl,
      // I tre `*Under` escono da qui GIÀ VAGLIATI: chi li legge a valle non deve rifare il
      // controllo, né può dimenticarselo.
      mediaUnder,
      imgUnder,
      // Il collegamento lo può dire il DOM (la copertina adottata sta dentro un
      // <a>) prima ancora della pila di strati.
      linkUnder: linkEl ? null : findLinkUnder(view, target, mediaUnder || imgUnder),
      // Gli strati come li ha visti il freno: servono a valle per sapere se copertina e
      // collegamento sono la STESSA scheda, che i soli rettangoli sbagliano (#444).
      layers: view,
      editable: isEditable(target),
    };
  }

  // Prima il DOM: se la copertina adottata sta dentro un <a>, la pagina ha già detto che
  // sono la stessa scheda. Poi la pila: sotto una COPERTINA sì, sotto del testo no (#499).
  const COVER_TAGS = new Set(['IMG', 'VIDEO', 'CANVAS', 'SVG', 'PICTURE', 'OBJECT', 'EMBED']);
  function coverInFront(hit, view) {
    if (!Array.isArray(view?.stack)) return false;
    for (const other of view.stack) {
      if (other === hit) return false;
      if (!coversPoint(other.getBoundingClientRect?.(), view)) continue;
      if (COVER_TAGS.has(other.tagName)) return true;
      // Molte copertine vere sono un contenitore con l'immagine di SFONDO, non
      // un tag immagine: per chi guarda è la stessa faccia della scheda.
      try {
        const bg = getComputedStyle(other).backgroundImage;
        if (bg && bg !== 'none') return true;
      } catch (_) {}
    }
    return false;
  }

  function findLinkUnder(view, target, contentUnder) {
    const owner = contentUnder ? closestAcrossShadow(contentUnder, Actions.SELETTORE_COLLEGAMENTO) : null;
    const hit = owner || findUnder(view, Actions.SELETTORE_COLLEGAMENTO, target);
    if (!hit) return null;
    try {
      // Un collegamento che non riceve i click non esiste per il menu (#499): un clic sinistro
      // lì non navigherebbe mai. Quelli trasparenti delle schede vere i click li ricevono.
      if (getComputedStyle(hit).pointerEvents === 'none') return null;
      // Seconda metà: un collegamento che non disegna niente ed è coperto da ciò che non è la
      // sua copertina è invisibile per costruzione, quindi per il menu non esiste (#499).
      if (!owner && !paintsSomething(hit) && !coverInFront(hit, view) && coveredAt(hit, view)) {
        return null;
      }
    } catch (_) {}
    return hit;
  }

  // La regola sta in src/shared/campoTesto.js: la stessa domanda arriva anche dal main,
  // dove su Mac la barra dei menu prende Ctrl/Cmd+Z prima di noi (#527).
  function isEditable(el) {
    return !!(self.SN_CAMPO_TESTO && self.SN_CAMPO_TESTO.campoDiTesto(el));
  }

  function campoVuoto(el) {
    if (!el) return false;
    const v = 'value' in el && typeof el.value === 'string' ? el.value : el.textContent;
    return typeof v === 'string' && v.trim() === '';
  }

  // Menu correzione: rosso = parola sotto il cursore, blu = errore contestuale.

  function getInputSelectionInfo(target) {
    const el = target?.closest?.('input, textarea');
    if (!el || !el.matches?.('input, textarea')) return null;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start == null || end == null || start === end) return null;
    const value = el.value || '';
    const selection = value.slice(start, end).trim();
    if (!selection) return null;
    if (Extract.campoSegreto?.(el)) return { selection, sentence: selection, segreto: true };
    return { selection, sentence: value.trim() || selection };
  }

  async function buildBaseItemsAt(mouseEvent) {
    const target = realTarget(mouseEvent);
    let selInfo = Extract.getSelectionWithSentence(target);
    if (!selInfo) selInfo = getInputSelectionInfo(target);
    const {
      linkEl, imgEl, mediaEl, mediaUnder, imgUnder, linkUnder, layers, editable,
    } = detectContext(target, mouseEvent.clientX, mouseEvent.clientY);
    // Il contesto d'incolla si cattura anche per i menu di correzione: senza, «Incolla»
    // usava un contesto stantio e incollava all'inizio del campo.
    if (editable) capturePasteContext(target);
    else pasteContext = null;
    const [clipboardHistory, navState] = await Promise.all([
      Actions.getClipboardHistory(),
      Actions.getNavState(),
    ]);
    return buildMenuItems({
      selInfo, linkEl, imgEl, mediaEl, mediaUnder, imgUnder, linkUnder, layers, editable, clipboardHistory, navState, target,
    });
  }

  // La freccetta di una correzione: le altre proposte del dizionario, poi aggiungi, correggi da sé, gestisci.
  // `parola`: il segno è una parola sola, e allora si può aggiungere al dizionario o correggere da sé d'ora in poi.
  // `esito`: chi tiene la proposta per i contatori sa cosa ne ha fatto la persona (#1461).
  function buildRedSubItems(editableEl, wordCtx, correction, altSuggestions = [], parola = true, esito = () => {}) {
    const items = [];
    const seen = new Set([String(correction || '').toLowerCase()]);
    for (const s of altSuggestions) {
      const v = String(s || '').trim();
      if (!v || seen.has(v.toLowerCase())) continue;
      seen.add(v.toLowerCase());
      items.push({
        label: v,
        onClick: () => {
          esito('accettata');
          SpellCheck.applyFix(editableEl, { start: wordCtx.start, end: wordCtx.end }, v, { expectedSegment: wordCtx.word });
        },
      });
      if (items.length >= 4) break;
    }
    if (items.length) items.push({ type: 'separator' });
    if (parola) {
      items.push({
        label: I18n.t('spell_add_dict'),
        onClick: () => {
          esito('rifiutata');
          SpellCheck.addToDictionary(wordCtx.word);
          Popup.showToast(I18n.t('toast_added_to_dict'));
        },
      });
    }
    if (parola && correction) {
      items.push({
        label: I18n.t('spell_autocorrect'),
        onClick: async () => {
          esito('accettata');
          await SpellCheck.setAutocorrect(wordCtx.word, correction);
          SpellCheck.applyFix(editableEl, { start: wordCtx.start, end: wordCtx.end }, correction, { expectedSegment: wordCtx.word });
          Popup.showToast(I18n.t('toast_autocorrect_saved'));
        },
      });
    }
    items.push({ label: I18n.t('spell_manage'), onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_SPELLCHECK_PAGE }) });
    return items;
  }

  // Una parola sola, senza spazi intorno: « il» ripetuto non è una parola da mettere nel dizionario.
  const unaParola = (s) => /^[^\s]+$/.test(String(s || ''));

  // Il perché di un segno, col bordo del suo colore; per un suggerimento con la frase della pagina che lo motiva.
  function rigaDelPerche(segno, cambia) {
    return {
      type: 'inline',
      onMount(el) {
        el.classList.add('sn-menu-segno', segno.segno === 'errore' ? 'sn-menu-segno-errore' : 'sn-menu-segno-suggerimento');
        const scrivi = (s) => {
          el.textContent = '';
          const perche = document.createElement('div');
          const ripiego = s.cercando ? 'spell_segnaposto_cerco' : s.segno !== 'errore' ? 'spell_ocra_controlla'
            : (s.fonte === 'dizionario' ? 'spell_errore_forse' : 'spell_errore_generico');
          perche.textContent = s.motivo || I18n.t(ripiego);
          el.appendChild(perche);
          // La fonte del valore di un segnaposto (#1448), col giorno a cui il dato si riferisce.
          if (s.fonteDato && s.fonteDato.nome) {
            const fonte = document.createElement('div');
            fonte.className = 'sn-menu-segno-citazione';
            fonte.textContent = I18n.t('spell_segnaposto_fonte', [s.fonteDato.nome, s.fonteDato.data].filter(Boolean).join(', '));
            el.appendChild(fonte);
          }
          if (s.citazione) {
            const prova = document.createElement('div');
            prova.className = 'sn-menu-segno-citazione';
            prova.textContent = I18n.t('spell_ocra_prima', s.citazione);
            el.appendChild(prova);
          }
        };
        scrivi(segno);
        if (cambia) cambia(scrivi);
      },
    };
  }

  // Su un errore (#1446): la correzione in cima, un clic; il perché; «Ignora»; «Aggiungi al dizionario» per una parola.
  // Un candidato ancora da giudicare mostra la proposta del dizionario e chiede il controllo rapido, che quando risponde
  // aggiorna la riga nel menu aperto.
  function vociErrore(editableEl, errore) {
    const parola = { word: errore.segment, start: errore.start, end: errore.end };
    // Le proposte del dizionario: quelle che il browser ha mandato col tasto destro, o chieste adesso; arrivate dopo
    // l'apertura del menu, prendono il posto di quelle chieste.
    const mandate = unaParola(errore.segment) ? SpellCheck.getNativeSuggestions(errore.segment) : [];
    let native = mandate.length ? mandate : (unaParola(errore.segment) ? SpellCheck.proposteDelBrowser(errore.segment) : []);
    let giudicato = null;
    const proposta = (s) => (s.correzioni && s.correzioni.length ? s.correzioni[0] : (s.dubbio ? native[0] : undefined));
    const etichetta = (s, c) => (c === '' ? I18n.t('spell_togli', s.segment.trim()) : c);
    const riga = (s) => {
      const c = proposta(s);
      return {
        hidden: c === undefined,
        label: c === undefined ? '' : etichetta(s, c),
        loading: false,
        onClick: c === undefined ? null : () => SpellCheck.correggi(editableEl, s, c),
        subItems: buildRedSubItems(editableEl, parola, c || '', s.dubbio ? native.slice(1) : native, unaParola(s.segment),
          (e) => SpellCheck.esitoSegno?.(editableEl, s, e)),
      };
    };
    const ascolti = [];
    const segui = (fn) => { ascolti.push(fn); };
    let staccato = null;
    const avvia = () => {
      if (staccato || !ascolti.length) return;
      staccato = SpellCheck.seguiSegno(editableEl, errore, (nuovo) => { if (nuovo && !nuovo.dubbio) for (const fn of ascolti) fn(nuovo); });
      SpellCheck.giudicaOra(editableEl, errore);
    };
    if (!errore.dubbio && (errore.fonte === 'rapido' || errore.giudicatoDa === 'rapido')) contaUsoDelCorrettore(ACTIONS.SPELLCHECK_SEMANTIC);
    const items = [
      {
        type: 'correction', ...riga(errore),
        onMount: (_root, update) => {
          let stacca = null;
          if (errore.dubbio) {
            segui((nuovo) => { giudicato = nuovo; update(riga(nuovo)); });
            if (!mandate.length && unaParola(errore.segment)) {
              stacca = SpellCheck.onNativeSuggestions(errore.segment, (sugg) => {
                if (giudicato || !sugg || !sugg.length) return;
                native = sugg;
                update(riga(errore));
              });
            }
          }
          avvia();
          return () => { if (staccato) staccato(); if (stacca) stacca(); };
        },
      },
      { type: 'separator', hidden: proposta(errore) === undefined },
      rigaDelPerche(errore, errore.dubbio ? (scrivi) => { segui(scrivi); avvia(); } : null),
      { type: 'item', label: I18n.t('spell_ocra_ignora'), onClick: () => SpellCheck.ignora(editableEl, errore) },
    ];
    // Un errore fisso resta un errore anche nel dizionario (#1447): la voce non farebbe niente.
    if (unaParola(errore.segment) && errore.fonte !== 'fisso') {
      items.push({
        type: 'item', label: I18n.t('spell_add_dict'),
        onClick: () => { SpellCheck.aggiungiAlDizionario(editableEl, errore); Popup.showToast(I18n.t('toast_added_to_dict')); },
      });
    }
    items.push({ type: 'separator' });
    return items;
  }

  // Su un segnaposto (#1448): il valore in cima, un clic; il perché con la fonte e la data; «Ignora». Mentre Filo cerca,
  // la riga del valore aspetta e si riempie quando la ricerca risponde.
  function vociSegnaposto(editableEl, sp) {
    if (!sp.dubbio) contaUsoDelCorrettore(ACTIONS.SPELLCHECK_CONTEXT);
    const riga = (s) => {
      if (s.cercando) return { hidden: false, label: I18n.t('spell_segnaposto_cerco'), loading: true, onClick: null };
      const v = s.correzioni && s.correzioni[0];
      return v ? { hidden: false, label: v, loading: false, onClick: () => SpellCheck.riempi(editableEl, s) } : { hidden: true, label: '', loading: false, onClick: null };
    };
    const ascolti = [];
    let staccato = null;
    const segui = (fn) => {
      ascolti.push(fn);
      if (!staccato) staccato = SpellCheck.seguiSegno(editableEl, sp, (nuovo) => { if (nuovo && !nuovo.cercando) for (const f of ascolti) f(nuovo); });
    };
    const righe = [
      {
        type: 'correction', ...riga(sp), senzaFreccia: true,
        onMount: (_root, update) => {
          if (sp.cercando) segui((nuovo) => update(riga(nuovo)));
          return () => { if (staccato) staccato(); };
        },
      },
      rigaDelPerche(sp, sp.cercando ? segui : null),
    ];
    if (sp.fonteDato && sp.fonteDato.url) {
      righe.push({ type: 'item', label: I18n.t('spell_segnaposto_apri_fonte'), onClick: () => Actions.apriInSchedaNuova(sp.fonteDato.url) });
    }
    if (sp.ricercaFallita) righe.push({ type: 'item', label: I18n.t(sp.vocePerCercare || 'spell_segnaposto_riprova'), onClick: () => SpellCheck.cercaDiNuovo(editableEl, sp) });
    righe.push(
      { type: 'item', label: I18n.t('spell_ocra_ignora'), onClick: () => SpellCheck.ignora(editableEl, sp) },
      { type: 'separator' },
    );
    return righe;
  }

  // Su un suggerimento: il perché con la frase della pagina, la correzione se c'è, «Ignora». Mai applicato da solo.
  function vociSuggerimento(editableEl, sugg) {
    if (sugg.tipo === 'segnaposto') return vociSegnaposto(editableEl, sugg);
    if (!sugg.dubbio && (sugg.fonte === 'ragionato' || sugg.giudicatoDa === 'ragionato')) contaUsoDelCorrettore(ACTIONS.SPELLCHECK_CONTEXT);
    const righe = [rigaDelPerche(sugg)];
    for (const c of sugg.correzioni || []) {
      righe.push({
        type: 'correction',
        label: c === '' ? I18n.t('spell_togli', sugg.segment.trim()) : c,
        loading: false,
        onClick: () => SpellCheck.correggi(editableEl, sugg, c),
        senzaFreccia: true,
      });
    }
    righe.push(
      { type: 'item', label: I18n.t('spell_ocra_ignora'), onClick: () => SpellCheck.ignora(editableEl, sugg) },
      { type: 'separator' },
    );
    return righe;
  }

  // «Correggi tutti gli errori» sul campo: solo gli errori confermati, mai i suggerimenti né i candidati in dubbio.
  // `minimo`: sul menu di un errore la voce serve solo se ce n'è almeno un altro.
  function voceCorreggiTutti(editableEl, minimo = 1) {
    const n = SpellCheck.erroriDaCorreggere(editableEl).length;
    if (n < minimo) return null;
    return { type: 'item', label: I18n.t('spell_correggi_tutti', n), onClick: () => SpellCheck.correggiTutti(editableEl) };
  }

  // Una correzione preparata mentre si scriveva, mostrata adesso: è qui che la persona usa il correttore (#969).
  function contaUsoDelCorrettore(action) {
    try { Promise.resolve(chrome.runtime.sendMessage({ type: MSG.CONTATORI_USO, action, attesaMs: 0 })).catch(() => {}); } catch (_) {}
  }

  // La parola che il correttore ha corretto da sé (#1447): «Annulla correzione» la riporta com'era scritta, e conta
  // come un rifiuto da cui Filo impara.
  function voceAnnullaCorrezione(editableEl, mouseEvent) {
    const v = SpellCheck?.automaticaSotto?.(editableEl, mouseEvent.clientX, mouseEvent.clientY);
    if (!v) return null;
    return { type: 'item', label: I18n.t('spell_annulla_correzione'), onClick: () => SpellCheck.annullaAutomatica(editableEl, v) };
  }

  async function openSpellMarksMenu(editableEl, { errore, suggerimento }, mouseEvent, sito = null) {
    const items = await buildBaseItemsAt(mouseEvent);
    const sopra = [];
    const annulla = voceAnnullaCorrezione(editableEl, mouseEvent);
    if (annulla) sopra.push(annulla, { type: 'separator' });
    if (errore) sopra.push(...vociErrore(editableEl, errore));
    if (suggerimento) sopra.push(...vociSuggerimento(editableEl, suggerimento));
    const correggibile = (s) => s && !s.dubbio && (s.segno === 'errore' || (s.tipo === 'segnaposto' && !s.cercando && s.correzioni?.length));
    const tutti = voceCorreggiTutti(editableEl, 1 + [errore, suggerimento].filter(correggibile).length);
    if (tutti) sopra.push(tutti, { type: 'separator' });
    items.unshift(...sopra);
    conMenuDelSito(items, sito);
    Menu.open({ x: mouseEvent.clientX, y: mouseEvent.clientY, items, keepOnScroll: true });
  }

  // Una parola di una casella di una riga, che Filo non segna: le proposte del dizionario subito, e il controllo rapido
  // chiesto adesso, che quando dice che è un errore mette la sua correzione in cima. Se non è un errore la riga resta
  // nascosta, o la proposta del dizionario se il dizionario non la conosce.
  async function openSpellWordMenu(editableEl, wordCtx, mouseEvent, sito = null) {
    const items = await buildBaseItemsAt(mouseEvent);
    let native = SpellCheck.getNativeSuggestions?.(wordCtx.word) || [];
    if (!native.length && SpellCheck.sbagliataPerIlBrowser(wordCtx.word)) native = SpellCheck.proposteDelBrowser(wordCtx.word);
    let updateCorrection = null;
    // La proposta del menu, per i contatori (#1461): chi l'ha fatta, e cosa ne ha fatto la persona.
    const chiave = `${wordCtx.word}|${wordCtx.start}`;
    const esito = (e) => SpellCheck.esitoProposta?.(editableEl, 'ortografia', chiave, e);
    const applyAt = (corr) => {
      esito('accettata');
      return SpellCheck.applyFix(editableEl, { start: wordCtx.start, end: wordCtx.end }, corr, { expectedSegment: wordCtx.word });
    };
    const riga = (corr, alts) => ({
      hidden: !corr, label: corr || '', loading: false,
      onClick: corr ? () => applyAt(corr) : null,
      subItems: buildRedSubItems(editableEl, wordCtx, corr || '', alts || [], true, esito),
    });
    let mostrata = native[0] || '';
    items.unshift(
      { type: 'correction', ...riga(mostrata, native.slice(1)), onMount: (_root, update) => { updateCorrection = update; } },
      { type: 'separator', hidden: !mostrata },
    );
    conMenuDelSito(items, sito);
    // Chiuso senza una scelta: la proposta è ignorata. Dopo, perché il clic che lo chiude arriva prima di chiuderlo.
    Menu.open({
      x: mouseEvent.clientX, y: mouseEvent.clientY, items, keepOnScroll: true,
      alChiudere: () => setTimeout(() => esito('ignorata'), 1500),
    });
    if (mostrata) SpellCheck.propostaMostrata?.(editableEl, 'ortografia', chiave, 'nativo');

    const mostra = (corr, alts, modello = 'nativo') => {
      if (!updateCorrection || !corr || corr === wordCtx.word) return;
      mostrata = corr;
      updateCorrection(riga(corr, alts));
      SpellCheck.propostaMostrata?.(editableEl, 'ortografia', chiave, modello);
    };
    if (!mostrata) {
      SpellCheck.onNativeSuggestions?.(wordCtx.word, (sugg) => { if (!mostrata && sugg?.length) mostra(sugg[0], sugg.slice(1)); });
    }
    const giudizio = await SpellCheck.controlloSuRichiesta(editableEl, wordCtx);
    if (giudizio && giudizio.errore && giudizio.correzione) mostra(giudizio.correzione, native.filter((p) => p !== giudizio.correzione), giudizio.modello);
  }

  function buildFeedbackItem() {
    return {
      type: 'item',
      label: 'Invia feedback',
      onClick: () => openSurface('feedback', () => self.SN_FEEDBACK_UI?.open()),
    };
  }

  // #843 — spegne Filo sul sito della scheda (anche dal menu di un riquadro: «questo sito» è quello che si sta visitando).
  // Solo dove c'è un sito con un nome: una pagina di Filo, un IP o «localhost» non entrano nell'elenco.
  function buildSpegniFiloItem() {
    if (PAGINA_DI_FILO || !self.SN_NOMI_SITO) return null;
    let host = '';
    try {
      const u = new URL(pageUrl || location.href);
      if (u.protocol === 'http:' || u.protocol === 'https:') host = u.hostname;
    } catch (_) { host = ''; }
    if (!self.SN_NOMI_SITO.daScritto(host)) return null;
    return {
      type: 'item',
      azione: 'filo-off-on-site',
      label: I18n.t('menu_spegni_filo'),
      onClick: () => {
        try { Promise.resolve(chrome.runtime.sendMessage({ type: MSG.FILO_SPENTO_IMPOSTA, spento: true, avvisa: true })).catch(() => {}); } catch (_) {}
      },
    };
  }

  // #405 — i pannelli a tutta superficie (feedback, red-team, sidebar Aiuto)
  // appartengono alla pagina: aperti dentro un riquadro incorporato starebbero
  // dentro un rettangolo di poche centinaia di pixel, tagliati. Dal riquadro
  // chiediamo alla pagina di aprirli; nella pagina si aprono e basta.
  function openSurface(surface, localOpen) {
    if (!IS_SUBFRAME) {
      try { localOpen(); } catch (e) { console.error('[SN] apertura pannello', e); }
      return;
    }
    try {
      Promise.resolve(chrome.runtime.sendMessage({ type: MSG.RUN_IN_TOP_FRAME, surface })).catch(() => {});
    } catch (_) {}
  }

  // Ordine: icone globali, Aiuto, zona contestuale, Feedback. La riga globale è stabile e
  // fa da ancora, la zona contestuale cambia col click.
  function buildMenuItems({
    selInfo, linkEl, imgEl, mediaEl, mediaUnder, imgUnder, linkUnder, layers, editable, clipboardHistory, navState, target = null,
  }) {
    const items = [];

    // Registro, layout persistente e drag delle icone: src/content/menuIcons.js.
    items.push(MenuIcons.buildGlobalIconRow(navState));

    // 2. Aiuto, se è acceso, e le voci di stato qui sotto: il separatore c'è solo se la sezione ha qualcosa.
    const sezioneAiuto = [];
    if (aiutoAcceso()) sezioneAiuto.push(buildHelpItem());

    // «Interrompi lettura» c'è in QUALSIASI menu mentre si legge, anche senza selezione: se
    // a leggere è un'altra scheda, lo stop passa dal main che lo inoltra a quella giusta.
    if (TTS.isAnyReading()) {
      sezioneAiuto.push(TTS.buildStopReadingItem());
    }

    // «Mostra originale» solo quando alla traduzione manca ancora qualcosa: lì l'icona serve
    // a CONTINUARE, quindi il ritorno all'originale deve restare raggiungibile (#407, #408).
    const iconIsRestore = TranslatePage && typeof TranslatePage.showsRestore === 'function'
      && TranslatePage.showsRestore();
    if (TranslatePage && typeof TranslatePage.canContinue === 'function'
        && TranslatePage.canContinue() && !iconIsRestore) {
      sezioneAiuto.push(TranslatePage.buildRestoreOriginalItem());
    }

    // 2d. Zoom — solo quando la pagina NON è alla dimensione reale (#686). È
    // lo stato meno visibile che il tasto destro può raccontare: una pagina
    // rimasta zoomata da un'altra visita spiega da sé perché è così, e la voce
    // è anche la via d'uscita. Il livello lo sa il preload: glielo si chiede
    // con un evento, la risposta arriva nel dataset nello stesso dispatch.
    const zoomItem = buildZoomItem();
    if (zoomItem) sezioneAiuto.push(zoomItem);
    if (sezioneAiuto.length) items.push({ type: 'separator' }, ...sezioneAiuto);

    // 3. Zona contestuale — assente se non c'è contesto utile.
    // #760 — il tasto destro dentro un riquadro di un altro sito riattiva o toglie i cookie del suo servizio.
    const vociRiquadro = (self.SN_RIQUADRO_COOKIE && self.SN_RIQUADRO_COOKIE.voci()) || [];
    const contextItems = [
      ...vociDellaPagina(target),
      ...buildContextualItems({
        selInfo, linkEl, imgEl, mediaEl, mediaUnder, imgUnder, linkUnder, layers, editable, clipboardHistory, target,
      }),
      ...vociRiquadro,
    ];
    if (contextItems.length > 0) {
      items.push({ type: 'separator' });
      // Da tastiera il fuoco parte da qui: è quello che si può fare proprio sull'elemento (#1295).
      const prima = contextItems.findIndex((it) => it && (it.type === 'item' || !it.type));
      contextItems.forEach((it, i) => items.push(i === prima ? { ...it, primaDaTastiera: true } : it));
    }

    items.push({ type: 'separator' });
    items.push(buildFeedbackItem());
    const spegni = buildSpegniFiloItem();
    if (spegni) items.push(spegni);
    // In pausa (#896) la voce c'è solo per chi vede il Red Team. Si richiede a ogni apertura: vale dalla successiva.
    refreshRedteamVisibile();
    if (redteamVisibile) items.push(buildRedteamAttackItem());

    return items;
  }

  // Le voci che una pagina di Filo dà ai suoi elementi (il segno di un cambio sulla bolla, #867): ogni
  // fornitore in SN_VOCI_PAGINA riceve l'elemento cliccato. Mai sui siti: lì quel nome è della pagina.
  function vociDellaPagina(target) {
    if (!PAGINA_DI_FILO || !target) return [];
    const fornitori = Array.isArray(self.SN_VOCI_PAGINA) ? self.SN_VOCI_PAGINA : [];
    const out = [];
    for (const f of fornitori) {
      try {
        const voci = typeof f === 'function' ? f(target) : null;
        if (Array.isArray(voci)) out.push(...voci.filter((v) => v && v.label && typeof v.onClick === 'function'));
      } catch (_) {}
    }
    return out;
  }

  // Parte nascosta: per difetto la voce manca a chi la vedrebbe fino alla risposta, per eccesso porta tutti in un vicolo cieco.
  let redteamVisibile = false;
  function refreshRedteamVisibile() {
    try {
      Promise.resolve(chrome.runtime.sendMessage({ type: MSG.REDTEAM_VISIBILITY }))
        .then((r) => { redteamVisibile = !!(r && r.ok && r.visible); })
        .catch(() => {});
    } catch (_) {}
  }
  refreshRedteamVisibile();

  // Red-team — "Invia attacco" (spec §8.1): apre un pannello dedicato (mirrors
  // il flusso feedback) con due campi separati (testo attacco + descrizione) e
  // un bottone d'invio che mostra il costo (50 cr). Vive in
  // src/content/redteamAttack.js (SN_REDTEAM_ATTACK_UI).
  function buildRedteamAttackItem() {
    const ricon = (self.SN_ICONS && typeof self.SN_ICONS.redteam === 'function')
      ? self.SN_ICONS.redteam(16) : undefined;
    return {
      type: 'item',
      icon: ricon,
      label: 'Invia attacco (Red-team)',
      onClick: () => openSurface('redteam', () => self.SN_REDTEAM_ATTACK_UI?.open()),
    };
  }

  // Livello di zoom della pagina, o null se è alla dimensione reale. Il numero
  // lo tiene il preload, che gira nello stesso mondo isolato di questo file:
  // passare dal documento lo metterebbe a portata del sito, che lo userebbe per
  // rimettersi lo zoom come vuole lui (#686, primo giro di verifica).
  function zoomPagina() {
    return (typeof self !== 'undefined' && self.SN_ZOOM_PAGINA) || null;
  }

  function zoomCorrente() {
    const Z = zoomPagina();
    if (!Z) return null;
    try {
      const p = Z.percentuale();
      return Number.isFinite(p) && p !== 100 ? p : null;
    } catch (_) { return null; }
  }

  function buildZoomItem() {
    const p = zoomCorrente();
    if (p == null) return null;
    return {
      type: 'item',
      // Stesso nome della voce nella barra dei menu: due strade per la stessa
      // cosa non si chiamano in due modi.
      label: `Dimensione reale (ora ${p}%)`,
      shortcut: Tasti.etichetta('Ctrl+0'),
      onClick: () => { try { zoomPagina()?.azzera(); } catch (_) {} },
    };
  }

  function buildHelpItem() {
    return {
      type: 'item',
      label: I18n.t('menu_help'),
      shortcut: Tasti.etichettaFilo(Tasti.scorciatoiaFilo('open-help-sidebar')),
      onClick: () => openSurface('help', () => openHelpSidebar()),
    };
  }

  // Azioni sull'immagine, senza la sezione «Spiega»: la compone il chiamante, così quando
  // l'immagine è anche un link non partono due box AI a ogni apertura.
  function buildImageActionItems(imgEl) {
    return [
      { type: 'item', azione: 'copy-download-image', label: I18n.t('menu_copy_image'), onClick: () => Actions.copyImage(imgEl) },
      { type: 'item', azione: 'copy-download-image', label: I18n.t('menu_save_image_as'), onClick: () => Actions.downloadImage(imgEl) },
      {
        type: 'item',
        azione: 'copy-download-image',
        label: I18n.t('menu_copy_image_link'),
        onClick: () => Actions.copyUrlToClipboard(imgEl.currentSrc || imgEl.src),
      },
      {
        type: 'item',
        azione: 'search-image',
        label: I18n.t('menu_search_image'),
        onClick: () => Actions.searchImageOnWeb(imgEl),
      },
    ];
  }

  function buildLinkActionItems(linkEl) {
    // Un collegamento scritto da un modello di Filo si apre e si scarica solo dal main, dopo la porta delle uscite (#810).
    const diFilo = !!(linkEl.classList && linkEl.classList.contains('filo-md-link') && Popup && Popup.apriCollegamento);
    const indirizzo = Actions.indirizzoDelLink(linkEl);
    const out = [];
    // Un link d'invito esiste per portare l'invito dentro Filo: è la sua prima voce (#664).
    if (self.SN_WALLET && self.SN_WALLET.inviteCodeFromLink(indirizzo)) {
      out.push({
        type: 'item',
        label: I18n.t('menu_redeem_invite'),
        onClick: () => { chrome.runtime.sendMessage({ type: MSG.WALLET_INVITE_OPEN, link: indirizzo }).catch(() => {}); },
      });
    }
    out.push(
      {
        type: 'item',
        label: I18n.t('menu_open_in_new_tab'),
        onClick: () => (diFilo ? Popup.apriCollegamento(linkEl) : Actions.apriInSchedaNuova(indirizzo)),
      },
    );
    // "Salva file" — gemello di "Salva immagine come" per i link a un file
    // (PDF, ZIP, allegato). Compare SOLO quando il link punta davvero a un
    // file (vedi isDownloadableLink): su un link a un'altra pagina scaricare
    // l'HTML non avrebbe senso.
    if (Actions.isDownloadableLink(linkEl)) {
      out.push({
        type: 'item',
        azione: 'download-progress',
        label: I18n.t('menu_save_file'),
        onClick: () => (diFilo ? Popup.scaricaCollegamento(linkEl) : Actions.downloadLink(linkEl)),
      });
    }
    out.push(
      {
        type: 'item',
        azione: 'share-copy-link',
        label: I18n.t('menu_copy_link'),
        onClick: () => Actions.copyUrlToClipboard(indirizzo),
      },
      {
        type: 'item',
        azione: 'save-link',
        label: I18n.t('menu_save_link_for_later'),
        onClick: () => Actions.saveLink(linkEl),
      },
      {
        type: 'item',
        azione: 'share-copy-link',
        label: I18n.t('menu_share_link'),
        onClick: () => Actions.shareLink(linkEl),
      },
    );
    return out;
  }

  // L'immagine su cui è disegnata la zona di una mappa: fra quelle che usano la mappa, quella sotto il cursore.
  function immagineDellaZona(area, view) {
    if (!area || area.tagName !== 'AREA') return null;
    const mappa = area.closest('map');
    const nome = String((mappa && (mappa.getAttribute('name') || mappa.id)) || '').toLowerCase();
    if (!nome) return null;
    let usano = [];
    try {
      usano = [...area.getRootNode().querySelectorAll('img[usemap]')]
        .filter((img) => String(img.getAttribute('usemap') || '').toLowerCase() === '#' + nome);
    } catch (_) {}
    return usano.find((img) => view?.stack?.includes(img)) || usano[0] || null;
  }

  // Costruisce gli item della zona contestuale in base a cosa è stato cliccato.
  // Matrice: testo / testo+editabile / video-audio / immagine (+ link) / link /
  // casella input / niente.
  function buildContextualItems({
    selInfo, linkEl, imgEl, mediaEl, mediaUnder, imgUnder, linkUnder, layers, editable, clipboardHistory, target = null,
  }) {
    const items = [];

    if (selInfo && editable) {
      items.push({ type: 'item', azione: 'copy-cut', label: I18n.t('menu_cut'), onClick: () => Actions.cutSelection() });
      items.push({ type: 'item', azione: 'copy-cut', label: I18n.t('menu_copy'), onClick: () => Actions.copyToClipboard(selInfo.selection) });
      items.push(Actions.buildPasteItem(clipboardHistory));
      items.push(TTS.buildDictateItem(target));
      if (selInfo.segreto) return items;
      { const ra = TTS.buildReadAloudItem(selInfo.selection); if (ra) items.push(ra); }
      items.push({ type: 'separator' });
      items.push(Actions.buildInlineExplain(selInfo, { withDeepArrow: true }));
      items.push({
        type: 'item',
        label: I18n.t('menu_edit_selection'),
        onClick: () => EditBox.openEditBox(selInfo.selection),
      });
      return items;
    }

    if (selInfo) {
      items.push({ type: 'item', azione: 'copy-cut', label: I18n.t('menu_copy'), onClick: () => Actions.copyToClipboard(selInfo.selection) });
      if (selInfo.segreto) return items;
      items.push({
        type: 'item',
        azione: 'search-web',
        label: I18n.t('menu_search_text'),
        onClick: () => Actions.searchTextOnWeb(selInfo.selection),
      });
      { const ra = TTS.buildReadAloudItem(selInfo.selection); if (ra) items.push(ra); }
      items.push({ type: 'separator' });
      items.push(Actions.buildInlineExplain(selInfo, { withDeepArrow: true }));
      return items;
    }

    // Video/audio cliccato direttamente: le sue azioni vengono prima (un filmato
    // dentro una scheda-link resta soprattutto un filmato)…
    if (mediaEl) {
      for (const it of Actions.buildMediaItems(mediaEl)) items.push(it);
      // Un media dentro un <a> è ANCHE un collegamento e spesso è il link che si vuole (#434).
      // Non è sempre un antenato: nelle home l'anteprima si stende sopra il link (#444).
      const link = linkEl || linkUnder;
      if (link) {
        items.push({ type: 'separator' });
        for (const it of buildLinkActionItems(link)) items.push(it);
        items.push({ type: 'separator' });
        // Il media non ha una sezione «Spiega»: quella del collegamento è l'unica, quindi
        // nessuna seconda chiamata AI e il menu del link resta completo.
        items.push(Actions.buildInlineExplainLink(link));
      }
      return items;
    }

    if (imgEl) {
      for (const it of buildImageActionItems(imgEl)) items.push(it);
      // Un'immagine dentro un <a> è ANCHE un collegamento e le due famiglie di voci vanno
      // insieme (#401). La copertina può essere STESA SOPRA il link invece che dentro (#444).
      const linkOfImg = linkEl || linkUnder;
      if (linkOfImg) {
        items.push({ type: 'separator' });
        for (const it of buildLinkActionItems(linkOfImg)) items.push(it);
      }
      items.push({ type: 'separator' });
      // Una sola sezione "Spiega" (quella dell'immagine, l'elemento cliccato):
      // aggiungerne una seconda firerebbe una seconda chiamata AI a ogni apertura.
      items.push(Actions.buildInlineExplainImage(imgEl, linkOfImg));
      return items;
    }

    if (linkEl) {
      // La zona di una mappa d'immagine è il collegamento cliccato, disegnato su un'immagine (#725.6): prima le sue voci,
      // poi quelle dell'immagine, e la sezione parla del collegamento, col suo avviso.
      const immagineZona = immagineDellaZona(linkEl, layers);
      if (immagineZona) {
        for (const it of buildLinkActionItems(linkEl)) items.push(it);
        items.push({ type: 'separator' });
        for (const it of buildImageActionItems(immagineZona)) items.push(it);
        items.push({ type: 'separator' });
        items.push(Actions.buildInlineExplainLink(linkEl));
        return items;
      }
      // Copertina di un video dentro un link con il player che copre il filmato
      // col suo overlay: il clic destro arriva all'overlay, quindi il <video>
      // non è fra gli antenati e finisce in `mediaUnder`. Per chi guarda è lo
      // stesso identico filmato dentro lo stesso identico link: il menu deve
      // essere lo stesso del ramo qui sopra, overlay o non overlay. Solo se il
      // filmato è DAVVERO quello della scheda, però: dentro il collegamento
      // oppure a occuparne la superficie. Un video di sfondo che si ritrova per
      // caso un link sopra non deve intrufolarsi nel menu di quel link.
      const mediaInLink = belongsTo(mediaUnder, linkEl, layers) ? mediaUnder : null;
      if (mediaInLink) {
        for (const it of Actions.buildMediaItems(mediaInLink)) items.push(it);
        items.push({ type: 'separator' });
      }
      // Stessa storia con la copertina ferma: le schede la coprono con un velo che regge il
      // titolo, e il clic arriva lì invece che sull'<img> (#444).
      const imgInLink = (!mediaInLink && belongsTo(imgUnder, linkEl, layers)) ? imgUnder : null;
      if (imgInLink) {
        for (const it of buildImageActionItems(imgInLink)) items.push(it);
        items.push({ type: 'separator' });
      }
      for (const it of buildLinkActionItems(linkEl)) items.push(it);
      items.push({ type: 'separator' });
      // Il riquadro parla dell'elemento primario: se abbiamo adottato la copertina il primario
      // è lei, o la stessa scheda cambiava argomento a seconda del pixel cliccato (#444).
      items.push(imgInLink
        ? Actions.buildInlineExplainImage(imgInLink, linkEl)
        : Actions.buildInlineExplainLink(linkEl));
      return items;
    }

    if (editable) {
      items.push(Actions.buildPasteItem(clipboardHistory));
      items.push(TTS.buildDictateItem(target));
      return items;
    }

    // Nessun altro contesto, ma sotto al punto cliccato c'è un filmato coperto
    // dall'overlay del player: sono comunque le sue azioni che l'utente cerca.
    if (mediaUnder) {
      for (const it of Actions.buildMediaItems(mediaUnder)) items.push(it);
      // Due cose prese entrambe da sotto devono stare insieme anche fra loro, o il menu
      // unirebbe due schede diverse (#444).
      if (belongsTo(mediaUnder, linkUnder, layers)) {
        items.push({ type: 'separator' });
        for (const it of buildLinkActionItems(linkUnder)) items.push(it);
        items.push({ type: 'separator' });
        items.push(Actions.buildInlineExplainLink(linkUnder));
      }
      return items;
    }

    // Stessa scheda con l'anteprima ferma: senza questo ramo lo stesso pixel dava menu
    // completo mentre il filmatino suonava e menu vuoto un istante dopo (#444).
    if (imgUnder) {
      for (const it of buildImageActionItems(imgUnder)) items.push(it);
      const linkOfCover = belongsTo(imgUnder, linkUnder, layers) ? linkUnder : null;
      if (linkOfCover) {
        items.push({ type: 'separator' });
        for (const it of buildLinkActionItems(linkOfCover)) items.push(it);
      }
      items.push({ type: 'separator' });
      items.push(Actions.buildInlineExplainImage(imgUnder, linkOfCover));
      return items;
    }

    // Un velo trasparente sopra una scheda-link basta a far sparire le voci del collegamento
    // (#444). Barre fisse, modali e manti li ha già scartati `linkUnder`.
    if (linkUnder) {
      for (const it of buildLinkActionItems(linkUnder)) items.push(it);
      items.push({ type: 'separator' });
      items.push(Actions.buildInlineExplainLink(linkUnder));
      return items;
    }

    return items;
  }


  let lastMouseEvent = { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 };
  document.addEventListener('mousedown', (e) => {
    lastMouseEvent = { clientX: e.clientX, clientY: e.clientY };
  }, true);

  // Le azioni del tasto destro vivono in src/content/actions.js.

  // La traduzione di pagina (e il suo stato) vive in
  // src/content/translatePage.js (SN_TRANSLATE_PAGE), caricato prima di questo file.

  // ------------------------------------------------------------
  // Sidebar Aiuto (Fase 2)
  // ------------------------------------------------------------
  // L'interruttore dell'Aiuto (#841): spento, nessuna strada apre il pannello e il tasto dice perché.
  function aiutoAcceso() {
    return !(settings && settings.featureFlags && settings.featureFlags.help === false);
  }

  function openHelpSidebar(context) {
    if (!aiutoAcceso()) { Popup.showToast(I18n.t('help_disabled')); return; }
    Sidebar.open(context);
  }

  // L'icona Aiuto (barra laterale, riga del tasto destro): apre, poi detta, poi ferma (#1432).
  function aiutoPasso() {
    if (!aiutoAcceso()) { Popup.showToast(I18n.t('help_disabled')); return; }
    Sidebar.passo();
  }

  // Alla barra laterale: cosa farà il clic sulla sua icona Aiuto, perché è spenta, e la risposta ancora da leggere.
  // Solo dal frame principale: il pannello vive lì.
  let aiutoRiferito = '';
  let rispostaRiferita = null;
  function riferisciAiuto() {
    if (IS_SUBFRAME || !Sidebar?.stato) return;
    const s = Sidebar.stato();
    const spento = motivoBlocco() || (aiutoAcceso() ? '' : 'aiuto');
    const firma = `${s.pannello}|${s.voce}|${spento}`;
    try {
      if (firma !== aiutoRiferito) {
        aiutoRiferito = firma;
        Promise.resolve(chrome.runtime.sendMessage({ type: MSG.AIUTO_STATO, pannello: s.pannello, voce: s.voce, spento })).catch(() => {});
      }
      if (s.nonLetta !== rispostaRiferita) {
        rispostaRiferita = s.nonLetta;
        Promise.resolve(chrome.runtime.sendMessage({ type: MSG.RISPOSTA_IN_ATTESA, fonte: 'aiuto', attesa: s.nonLetta })).catch(() => {});
      }
    } catch (_) {}
  }
  try { Sidebar?.suCambio?.(riferisciAiuto); } catch (_) {}
  // Tornata dalla cache di navigazione: per il main è un documento nuovo, e il suo Aiuto va ridetto.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    aiutoRiferito = '';
    rispostaRiferita = null;
    riferisciAiuto();
  });

  // ------------------------------------------------------------
  // Messaggi runtime: shortcut, settings update
  // ------------------------------------------------------------
  function rispondiEtichetteBarra(ids) {
    if (IS_SUBFRAME) return;
    try {
      const voci = MenuIcons.statoPerBarra?.(ids) || [];
      if (voci.length) chrome.runtime.sendMessage({ type: MSG.BARRA_ETICHETTE, voci }).catch?.(() => {});
    } catch (_) {}
  }

  function onRuntimeMessage(msg, sender, sendResponse) {
    // #871 — la disposizione delle icone è cambiata altrove, o un'icona arriva dalla barra laterale.
    if (msg?.type === MSG.ICON_LAYOUT_CHANGED) {
      try { MenuIcons.layoutCambiato?.(msg.layout); } catch (_) {}
      return;
    }
    if (msg?.type === MSG.BARRA_FUORI) {
      try { MenuIcons.dallaBarra?.(msg); } catch (_) {}
      return;
    }
    if (msg?.type === MSG.BARRA_ETICHETTE_CHIEDI) {
      rispondiEtichetteBarra(msg.ids);
      return;
    }
    if (msg?.type === MSG.FULLSCREEN_CHANGED) {
      fullscreenAnnunciato = true;
      contentFullscreen = !!msg.fullscreen;
      // Se un menu è aperto adesso, la sua voce dello schermo intero sta mentendo: si
      // ridisegna sul posto invece di lasciarla lì fino alla chiusura (#514).
      try { if (Menu?.isOpen?.()) MenuIcons.redrawIconRows?.(); } catch (_) {}
      return;
    }
    // L'Esc consegnato dal main (schermo pieno del sito) si rimette in circolo, e il giro di
    // sempre decide di chi era (#514).
    if (msg?.type === MSG.ESC_INOLTRATO) {
      try { consegnaEsc?.(); } catch (_) {}
      return;
    }
    // Un riquadro incorporato della stessa scheda ha aperto qualcosa sopra lo
    // schermo pieno: il tasto lo chiediamo noi, che siamo il frame principale.
    if (msg?.type === MSG.ESC_CHIEDI_TASTO) {
      try { consegnaChiediEsc?.(); } catch (_) {}
      return;
    }
    // Il toast di sistema arriva a TUTTE le schede: lo mostra solo quella in primo piano.
    // Gli eventi del mouse non attraversano un riquadro, o resterebbero aperti due menu.
    if (msg?.type === MSG.CLOSE_OTHER_MENUS) {
      try { Menu.close(); } catch (_) {}
      return;
    }
    // Azione di PAGINA scelta dal menu aperto dentro un riquadro: rimandata qui perché solo
    // il frame principale è «la pagina» (#405).
    if (msg?.type === MSG.TOP_FRAME_COMMAND) {
      try {
        if (msg.surface === 'feedback') self.SN_FEEDBACK_UI?.open();
        else if (msg.surface === 'redteam') { if (redteamVisibile) self.SN_REDTEAM_ATTACK_UI?.open(); }
        else if (msg.surface === 'help') openHelpSidebar();
        else MenuIcons.runIconAction(msg.iconId);
      } catch (e) { console.error('[SN] azione di pagina dal riquadro', e); }
      // Premuta dalla barra laterale: la barra rilegge come si chiama adesso (Traduci → Mostra originale).
      if (msg.daBarra) setTimeout(() => rispondiEtichetteBarra([msg.iconId]), 60);
      return;
    }
    if (msg?.type === MSG.SHOW_TOAST) {
      // Gli avvisi di sistema appartengono alla pagina: mostrarli anche dentro
      // ogni riquadro incorporato li duplicherebbe (#405).
      if (IS_SUBFRAME) return;
      try {
        if (document.visibilityState === 'visible' && document.hasFocus()) {
          // `rimedio` sceglie solo fra le pagine note di SN_CHAT_ERRORS: l'indirizzo non viaggia nel messaggio.
          Popup?.showToast?.(String(msg.text || ''), {
            duration: Number(msg.duration) || 2800, rimedio: msg.rimedio || null, segnala: typeof msg.segnala === 'string' ? msg.segnala : '',
          });
        }
      } catch (_) {}
      return;
    }
    // Stato della lettura condiviso fra le schede: «Interrompi lettura» deve esserci anche
    // quando a leggere è un'altra.
    if (msg?.type === MSG.TTS_GLOBAL_READING || msg?.type === MSG.TTS_STOP) {
      TTS.handleBroadcast(msg);
      return;
    }
    if (msg?.type === MSG.SETTINGS_UPDATED) {
      settings = msg.settings;
      seguiSpento();
      applyTheme(settings.theme);
      applyThemeTokens(settings.themeTokens);
      self.SN_AVVISI?.imposta(settings.notifications);
      Tasti.usaScorciatoieFilo(settings.scorciatoie);
      // Colore identità delle tab: i parametri di estrazione possono essere
      // cambiati (a voce o nelle Preferenze). Ricalcola il colore del favicon
      // coi nuovi parametri così la tinta della tab si aggiorna live.
      if (!IS_SUBFRAME) { try { PageColor.reportTabIdentityColor(() => settings && settings.tabColor); } catch (_) {} }
      // SpellCheck.init registra listener globali; per non duplicarli su update
      // usiamo updateSettings (definito apposta da spellcheck.js).
      SpellCheck.updateSettings(impostazioniDelCorrettore());
      // Spento l'Aiuto, il pannello già aperto se ne va come la sua voce (#841.r1).
      if (!aiutoAcceso() && Sidebar.isOpen()) Sidebar.close({ davvero: true });
      return;
    }
    if (msg?.type === MSG.SHORTCUT_TRIGGERED) {
      // Alt+S è un gesto rivolto a Filo: salva anche dove Filo è spento (#839); le altre scorciatoie lì tacciono.
      if (COMANDI_SALVA.has(msg.command)) { suSalvaPerDopo(msg, sendResponse); return; }
      if (isBlocked()) return;
      handleShortcut(msg.command, msg.context);
      sendResponse({ ok: true });
    }
  }

  // #839 — Alt+S è la voce «Salva per dopo» del menu: stessa funzione, stessa miniatura, stessa conferma.
  // La conferma arriva qui anche per un salvataggio che la scheda salvata non poteva mostrare: questa è quella davanti.
  const COMANDI_SALVA = new Set(['save-for-later', 'save-for-later-confirm']);

  function suSalvaPerDopo(msg, sendResponse) {
    if (IS_SUBFRAME) return;
    // Anche la conferma torna con la ricevuta: finché nessuna pagina la prende il main la riprova sulla scheda davanti.
    sendResponse({ presa: true });
    if (msg.command === 'save-for-later') {
      try { Menu.close(); } catch (_) {}
      Actions.savePage();
      return;
    }
    const ctx = msg.context || {};
    Actions.showSaveConfirm(ctx.entry, { chiudiScheda: false, conferma: ctx.conferma });
  }

  function selectionAnchor() {
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        if (r.width || r.height) {
          return { clientX: r.left + r.width / 2, clientY: r.bottom };
        }
      }
    } catch (_) {}
    return lastMouseEvent;
  }

  function handleShortcut(command, context) {
    if (isBlocked()) return;
    const selInfo = Extract.getSelectionWithSentence();
    const anchor = selectionAnchor();
    if (command === 'explain-selection') {
      // La spiegazione breve è già inline nel menu: la scorciatoia apre l'approfondimento.
      if (selInfo) Actions.triggerExplainOrTranslate(ACTIONS.EXPLAIN_DEEP, selInfo, anchor);
      else Popup.toastErrore('err_no_selection');
    } else if (command === 'translate-selection') {
      if (selInfo) Actions.triggerExplainOrTranslate(ACTIONS.TRANSLATE_SELECTION, selInfo, anchor);
      else Popup.toastErrore('err_no_selection');
    } else if (command === 'open-help-sidebar') {
      openHelpSidebar(context);
    } else if (command === 'aiuto-dalla-barra') {
      aiutoPasso();
    }
  }

  // Lettura ad alta voce e dettatura: src/content/tts.js.

  init();
})();
