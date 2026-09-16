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
  // Come si chiama una scorciatoia sul sistema di chi legge (Ctrl o Cmd, Alt o
  // Ctrl+Alt): mai scriverla a mano in un'etichetta.
  const Tasti = self.SN_TASTI;

  // I moduli estratti (actions.js, menuIcons.js, tts.js, editBox.js) hanno bisogno di pezzi che restano qui: settings, pasteContext, blocklist, ultimo evento mouse. Sono dichiarazioni hoisted, quindi i riferimenti sono già validi.
  Actions.init({
    getPasteContext: () => pasteContext,
    restorePasteContext: () => restorePasteContext(),
    isBlocked: () => isBlocked(),
    getLastMouseEvent: () => lastMouseEvent,
  });
  MenuIcons.init({
    isContentFullscreen: () => contentFullscreen,
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
  // Rispecchia la modalità «contenuto a tutto schermo» del main (tabs.js): serve a dare icona ed etichetta giuste alla voce «Schermo intero».
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

  // Chi si è preso l'Esc, a schermo intero. Sopra la pagina Filo apre roba che si chiude con Esc (il menu, la risposta, il QR, il ritaglio, una conferma, un'immagine ingrandita), e a schermo intero quel tasto serve anche a uscire: chi arriva prima vince, e se esce la modalità il riquadro resta aperto su una pagina che nessuno voleva lasciare (#514).
  // La domanda giusta non è «quali riquadri esistono» — quella è una lista che invecchia — ma «questo Esc l'ha usato qualcuno?», e si risponde a giro finito guardando tre cose.
  // · I pezzi di UI DISEGNATI DA NOI presenti un istante prima: l'elenco lo tiene SN_FILO_UI nel mondo isolato, e ci finisce solo chi passa da `mark()`, quindi un riquadro nuovo è coperto dal giorno che nasce. Non basta la RADICE — Filo apre roba anche DENTRO un suo riquadro (l'immagine ingrandita nel box «Invia feedback») — quindi si guarda anche il SOTTOALBERO, che è roba nostra anche sui siti.
  // · Su una pagina DI FILO, in più, che il documento si sia ALLEGGERITO nel giro del tasto (i riquadri delle pagine interne non passano da `mark()`, e sparire è l'unica cosa che fanno tutti); e che qualcuno l'abbia consumato, perché lì tutto quello che si vede è roba nostra. Sui siti no: un sito che si mangia i tasti non deve poterci chiudere dentro allo schermo intero.
  // Se nessuno l'ha usato chiediamo noi di uscire, e se non chiediamo niente il main esce da solo: l'errore ammesso è un'uscita in ritardo, mai restare chiusi dentro. Tutto questo però presuppone che il tasto arrivi: quando lo schermo pieno è del SITO se lo prende il browser, e lì va CHIESTO (`chiediEsc` più sotto).
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
  // Uno dei pezzi che c'erano si è chiuso: o la radice si è staccata dal documento, o dentro la radice è sparito qualcosa. Si guardano UNO A UNO e non quanti sono, perché nello stesso istante ne può nascere un altro — chiudendo il ritaglio compare l'avvisino dell'esito, e a contarli sembrerebbe che non sia successo niente.
  function qualcosaSiEChiuso(pezziPrima) {
    try {
      return pezziPrima.some((p) => {
        if (!p || !p.el) return false;
        if (!p.el.isConnected) return true;
        return siEAlleggerito(p.dentro, peso(p.el));
      });
    } catch (_) { return false; }
  }

  // Il documento INTERO conta solo sulle pagine di Filo: su un sito sarebbe il sito a decidere quando l'Esc è suo, ed è esattamente ciò da cui ci difendiamo. I sottoalberi delle nostre radici, invece, sono roba nostra ovunque.
  function pesoDellaPagina() {
    if (!PAGINA_DI_FILO) return null;
    return peso(document.documentElement);
  }
  function siEAlleggerita(prima) {
    return siEAlleggerito(prima, pesoDellaPagina());
  }

  // #405 — stiamo girando dentro un riquadro incorporato (video, mappa, modulo, commenti)? Il menu e tutto ciò che riguarda l'ELEMENTO cliccato funziona identico qui dentro;
  // ciò che riguarda la PAGINA (colore della scheda, segnali di attività, avvisi di sistema, azioni globali) no: il riquadro conosce solo se stesso e parlerebbe del rettangolo sbagliato, quindi resta alla pagina.
  const IS_SUBFRAME = (() => {
    try { return window.top !== window.self; } catch (_) { return true; }
  })();

  async function init() {
    settings = await fetchSettings();
    applyTheme(settings.theme);
    applyThemeTokens(settings.themeTokens);

    // Le tre cose qui sotto descrivono la SCHEDA: un riquadro incorporato campionerebbe il colore di una pubblicità e conterebbe lo scroll di un rettangolo, quindi restano alla pagina che lo ospita (#405).
    if (!IS_SUBFRAME) {
      // «Vetro smerigliato» della tab attiva (§1.1): il colore della cima pagina va al main, che tinge la tab. Attivo su tutte le pagine, anche quelle senza menu: il colore non c'entra col menu.
      try { PageColor.startTabColorSampler(); } catch (_) {}

      // Colore identità del sito (§1.2): calcolato una volta (theme-color → manifest → favicon) e mandato al main, che lo cacha per dominio e lo applica attenuato alle tab inattive.
      try { PageColor.reportTabIdentityColor(() => settings && settings.tabColor); } catch (_) {}

      // Segnali di attività (§2.1): ultima interazione, % di scroll, form sporco.
      // Servono all'LLM per decidere cosa archiviare.
      try { startTabActivityReporter(); } catch (_) {}
    }

    // Lo CHIEDIAMO invece di aspettare l'annuncio, che parte solo quando la modalità cambia: una pagina arrivata dopo (scheda nuova, navigazione) non lo sentirebbe mai, e il menu offriva «Schermo intero» mentre ci si era già dentro, senza la via d'uscita (#514).
    try {
      chrome.runtime.sendMessage({ type: MSG.FULLSCREEN_STATE })
        .then((r) => {
          if (!fullscreenAnnunciato && r && r.ok) contentFullscreen = !!r.fullscreen;
        })
        .catch(() => {});
    } catch (_) {}

    // Esc esce dalla modalità «contenuto a tutto schermo» (vedi tabs.js), ma solo se non se l'è preso nessun altro: due ascoltatori sullo stesso tasto, il primo in capture fotografa la pagina prima di chiunque, l'ultimo in bolla su window vede se il tasto è arrivato in fondo intatto. La decisione arriva a giro finito.
    let escInCorso = null;
    // Quante volte di fila un Esc può essere rivendicato. Nessuna prova vale all'infinito, perché nessuna è a prova di pagina ostile: chi si prendesse ogni Esc ci chiuderebbe dentro allo schermo intero. Due tetti, e il taglio è COSA si è visto succedere, non su quale pagina siamo.
    // PROVA FORTE (qualcosa è sparito davvero): tetto tre, come i riquadri impilabili. PROVA DEBOLE (solo «qualcuno ha consumato il tasto»): tetto uno. Contarli insieme era il difetto — con due riquadri aperti il secondo Esc portava via anche lo schermo intero. Una prova forte riazzera le deboli; il tetto che GARANTISCE resta quello del main (ESC_RIVENDICAZIONI_MAX in src/main/tabs.js), e i conteggi si azzerano appena l'utente fa altro.
    const TETTO_PROVE_FORTI = 3;
    const TETTO_PROVE_DEBOLI = 1;
    let escFortiDiFila = 0;
    let escDeboliDiFila = 0;
    function azzeraRivendicazioni() { escFortiDiFila = 0; escDeboliDiFila = 0; }
    window.addEventListener('mousedown', azzeraRivendicazioni, { capture: true });

    // L'Esc ce l'ha consegnato il main invece di arrivare da sé? Succede quando lo schermo pieno è del SITO, dove il browser se lo mangia per uscire e nessun riquadro di Filo lo vedrebbe (#514). Quando è consegnato la deroga qui sotto non vale: il main ha già deciso che quel tasto passa di qui.
    let escInoltrato = false;
    // Chiedere l'Esc al browser, sopra lo schermo pieno di un SITO. Lì se lo mangia il browser per uscire: il documento non lo vede mai, e ogni riquadro di Filo veniva scavalcato mentre la modalità se ne andava lo stesso (#514).
    // Col Keyboard Lock il tasto si può CHIEDERE, e da lì Filo lo consegna alla pagina e decide con la regola di sempre. Lo chiediamo solo mentre c'è qualcosa di nostro aperto e solo l'Esc — un sito che si è preso dei tasti suoi non deve perderli — e lo restituiamo appena non serve. Dove il browser non lo presta resta il comportamento di prima: si esce, e il riquadro va chiuso a mano.
    let tastoChiesto = false;
    // Dentro un riquadro incorporato il tasto serve uguale, ma il browser lo presta solo al frame principale: la richiesta si gira a lui passando dal main, e chi la riceve la esegue con questa stessa funzione.
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
    // Il frame principale lo restituisce a fine schermo pieno, l'unico momento in cui quel tasto smette di essere in ballo: un riquadro dentro un riquadro non dice quando si chiude, e tenerlo un attimo in più non toglie niente.
    consegnaChiediEsc = () => { if (document.fullscreenElement) chiediEsc(); };
    try {
      self.SN_FILO_UI?.onMark?.(() => {
        if (document.fullscreenElement) chiediEsc();
      });
    } catch (_) {}
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) restituisciEsc();
      // Il nome della voce guarda anche lo schermo pieno della PAGINA, non solo la modalità di Filo: quando finisce quello, ridisegnarla è affar nostro. L'annuncio del main non basta, perché arriva mentre il documento sta ancora uscendo e la voce si ridisegnerebbe identica (#514).
      try { if (Menu?.isOpen?.()) MenuIcons.redrawIconRows?.(); } catch (_) {}
    });

    // Il tasto si rimette in circolo com'era: parte dal documento, sale fino a window e passa da tutti i gestori, i nostri e quelli della pagina, come un Esc vero. Non è «fidato», quindi non vale come gesto dell'utente: una pagina non può usarlo per riprendersi lo schermo (#514).
    consegnaEsc = () => {
      if (escInoltrato) return;
      escInoltrato = true;
      try {
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
          bubbles: true, cancelable: true, composed: true,
        }));
      } catch (_) {}
      escInoltrato = false;
    };

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') { azzeraRivendicazioni(); return; }
      if (!contentFullscreen) return;
      // Deroga, la stessa del main (src/main/tabs.js): se a tutto schermo c'è andata LA PAGINA col suo pulsante, l'Esc è suo — il browser la fa uscire e il main ripristina la barra. Chiedere noi l'uscita la lascerebbe convinta di essere ancora a schermo pieno.
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

    // Il giro è finito: se sopra la pagina non è rimasto niente di nostro, il
    // tasto torna al browser. Da lì l'Esc dopo vale come prima, e a nessuno
    // resta chiesto un tasto che non serve più.
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

    // Ctrl/Cmd+Z torna alla pagina precedente (#267), con una sola eccezione: dentro un campo di testo resta «annulla», il significato universale, così scrivere non perde mai l'undo. Shift esclusa (Shift+Ctrl+Z = ripeti), Alt esclusa.
    // In capture e anche sulle pagine «bloccate»: tornare indietro è una funzione di navigazione del browser, non una feature di Filo. Riusa MSG.NAV_BACK, che senza cronologia è un no-op nel main.
    window.addEventListener('keydown', (e) => {
      if ((e.key !== 'z' && e.key !== 'Z') || e.shiftKey || e.altKey) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      // composedPath()[0] vede oltre lo shadow DOM; controlliamo anche
      // activeElement nel caso il keydown arrivi sul body con un campo a fuoco.
      const target = (typeof e.composedPath === 'function' && e.composedPath()[0]) || e.target;
      if (isEditable(target) || isEditable(document.activeElement)) return;
      e.preventDefault();
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: MSG.NAV_BACK }).catch(() => {});
    }, { capture: true });

    if (isBlocked()) return;

    SpellCheck.init(settings);

    // window + capture, la fase più precoce possibile: alcune pagine gestiscono il tasto destro su certi SVG e lasciavano comparire il menu nativo. Sulle pagine web il page-preload ha già un listener window+capture a document_start, prima di ogni script di pagina: gli passiamo il nostro handler, così siamo i primi anche sui siti che bloccano il contextmenu (YouTube, Reddit).
    // Sulle pagine filo:// si registra in BUBBLE: sono pagine NOSTRE e alcune hanno un menu contestuale proprio (chip dell'archivio, card dei mazzi) che in capture + stopPropagation veniva soffocato. In bubble l'handler della pagina scatta per primo, e se ha già gestito il click il menu di Filo si fa da parte.
    if (typeof self.__snSetContextMenuHandler === 'function') {
      self.__snSetContextMenuHandler(onContextMenu);
    } else {
      window.addEventListener('contextmenu', (e) => {
        if (e.defaultPrevented) return; // la pagina interna ha il SUO menu
        onContextMenu(e);
      });
    }
    // Prefetch "Spiega" appena l'utente seleziona del testo, così quando apre il
    // menu il risultato è già in cache. Debounce + dedup gestiti dallo scheduler.
    document.addEventListener('selectionchange', Actions.schedulePrefetchExplain);
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      onRuntimeMessage(msg, sender, sendResponse);
      return true; // mantieni il canale aperto per sendResponse asincrono
    });

    // Marker DOM per i test. `filoReady` (dal preload) dice solo che i moduli sono CARICATI, e init() è async: quel flag arriva prima di SpellCheck.init() e del listener `_spell:native`, quindi un test che iniettava un broadcast nativo appena visto `filoReady` lo faceva cadere nel vuoto.
    // Questo invece segnala che i listener sono attivi, spellcheck compreso: i test lo aspettano prima di simulare il click destro. Innocuo a runtime.
    try { document.documentElement.dataset.filoContentReady = '1'; } catch (_) {}
  }

  // Il campionatore colore tab + colore identità sito vivono in
  // src/content/pageColor.js (SN_PAGE_COLOR), caricato prima di questo file.

  function startTabActivityReporter() {
    let formDirty = false;
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

    function onFormInput(e) {
      if (formDirty) return;
      const t = e.target;
      if (!t) return;
      const tag = (t.tagName || '').toUpperCase();
      const editable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
      if (!editable) return;
      formDirty = true;
      send({ formDirty: true, scrollPct: Math.round(scrollPct()) });
    }

    window.addEventListener('pointerdown', onInteract, { passive: true, capture: true });
    window.addEventListener('keydown', onInteract, { passive: true, capture: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('input', onFormInput, { passive: true, capture: true });
    window.addEventListener('change', onFormInput, { passive: true, capture: true });

    setTimeout(() => send({ scrollPct: Math.round(scrollPct()) }), 600);
  }

  function isBlocked() {
    const url = location.href;
    // #405 — dentro un riquadro «about:blank» e «about:srcdoc» NON sono pagine di sistema: sono contenuto scritto da chi ospita il riquadro (moduli, anteprime, commenti), e lì il menu deve esserci come ovunque. L'esclusione vale per le pagine di sistema vere.
    const embeddedAbout = IS_SUBFRAME && /^about:(blank|srcdoc)/i.test(url);
    if (!embeddedAbout && PAGES_WITHOUT_MENU_PREFIXES.some((p) => url.startsWith(p))) return true;
    const blocklist = settings?.blocklist || [];
    const matches = (host) => !!host && blocklist.some((d) => host === d || host.endsWith('.' + d));
    // Se l'utente ha spento Filo su un sito, deve restare spento anche nei
    // riquadri che quel sito incorpora: il riquadro ha un'altra origine e da
    // solo non lo saprebbe, quindi guarda l'indirizzo della pagina ospite.
    if (matches(hostOfUrl(pageUrl))) return true;
    return matches(location.hostname);
  }

  function hostOfUrl(url) {
    try { return new URL(String(url || '')).hostname; } catch (_) { return ''; }
  }

  // Indirizzo della pagina che ospita questo frame (uguale a location.href nel
  // frame principale). Arriva dal main insieme alle impostazioni: da dentro un
  // riquadro di un'altra origine non è leggibile.
  let pageUrl = '';

  async function fetchSettings() {
    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.GET_SETTINGS });
      if (res && typeof res.pageUrl === 'string') pageUrl = res.pageUrl;
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

  // Override dei token estetici (#146.1): le superfici Filo nella pagina usano le variabili --sn-* di theme.css, e qui emettiamo quelle sovrascritte dall'utente. Idempotente (upsert per id), quindi innocuo anche sulle pagine filo://, dove ci pensa già pageBootstrap.
  function applyThemeTokens(tokens) {
    const reg = self.SN_THEME_TOKENS;
    if (reg) reg.applyToDocument(document, tokens || {});
  }

  // Il listener contextmenu vive su window: quando l'evento nasce DENTRO uno shadow root, `e.target` è ri-targettizzato all'host del componente e closest()/tagName non vedono più il link, l'immagine o il campo davvero cliccati. composedPath()[0] attraversa il confine e restituisce l'elemento reale.
  function realTarget(e) {
    return (typeof e?.composedPath === 'function' && e.composedPath()[0]) || e?.target || null;
  }

  // `closest()` si ferma al confine del componente: da dentro uno shadow root non vede gli antenati in chiaro. Sui siti moderni la copertina di una scheda è quasi sempre un componente web infilato dentro l'`<a>` della scheda, e la risalita tornava null — il collegamento spariva dal menu (#444).
  // Questa versione, quando la risalita finisce dentro uno shadow root, riparte dal suo host, e così via per quanti componenti siano annidati.
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

  // `document.elementsFromPoint()` si ferma al confine come `closest()`, ma dall'altra parte: di un componente web restituisce l'HOST, mai quello che c'è dentro. Era cieca a una scheda che tiene collegamento e anteprima IMPILATI nello stesso componente — solo le voci del filmato, nessuna del collegamento (#444).
  // Qui, per ogni elemento con uno shadow root, si ripete il colpo dentro quel root: le parti del componente vengono PRIMA del loro host, che è l'ordine in cui si vedono. Il set `seen` chiude i cicli e toglie i doppioni.
  function deepElementsFromPoint(x, y) {
    const out = [];
    const seen = new Set();
    const collect = (root) => {
      let hits = [];
      try { hits = root.elementsFromPoint?.(x, y) || []; } catch (_) { hits = []; }
      for (const el of hits) {
        if (!el || seen.has(el)) continue;
        seen.add(el);
        if (el.shadowRoot) collect(el.shadowRoot);
        out.push(el);
      }
    };
    try { collect(document); } catch (_) {}
    return out;
  }

  async function onContextMenu(e) {
    // Se l'utente tiene Shift premuto, lascia passare il menu nativo (escape hatch)
    if (e.shiftKey) return;

    // stopPropagation impedisce alla pagina ospite (YouTube, Reddit) di mostrare il SUO menu: il nostro listener è registrato per primo e interrompe la discesa in cattura prima degli handler che i siti mettono su document e sugli elementi.
    // NON stopImmediatePropagation: a quel timing sopprimerebbe anche l'evento `context-menu` del webContents, quello che porta `misspelledWord` e `dictionarySuggestions` del correttore nativo. E nemmeno e.preventDefault(): in Electron il menu nativo non appare da solo, e chiuderebbe lo stesso canale.
    e.stopPropagation();

    // Spellcheck: in un editabile supportato, prima cerchiamo un errore "blu"
    // (sincrono); altrimenti partiamo con la richiesta on-demand all'LLM per la
    // parola sotto il cursore (zigzag rosso del browser).
    try {
      if (settings?.featureFlags?.spellcheck !== false && SpellCheck) {
        const rt = realTarget(e);
        const editableEl = SpellCheck.findSupportedEditable(rt);
        if (editableEl) {
          const blueIssue = SpellCheck.getSemanticIssueAt(editableEl, e.clientX, e.clientY);
          if (blueIssue) {
            await openSpellBlueMenu(editableEl, blueIssue, e);
            return;
          }
          const wordCtx = SpellCheck.getWordAt(editableEl, e.clientX, e.clientY);
          if (wordCtx && !SpellCheck.isInDictionary(wordCtx.word)) {
            await openSpellWordMenu(editableEl, wordCtx, e);
            return;
          }
        }
        // Su `<input>` testuali, che il nostro overlay non copre, la parola sotto il cursore va comunque corretta: i soli suggerimenti nativi non bastano, perché dipendono dal dizionario della lingua attiva. Come per textarea e contenteditable si chiede la correzione all'LLM, tenendo i nativi come base immediata quando ci sono.
        const inputEl = rt?.closest?.('input');
        if (inputEl && isTextLikeInput(inputEl)) {
          const wordCtx = SpellCheck.getInputWordAt?.(inputEl, e.clientX, e.clientY);
          if (wordCtx && !SpellCheck.isInDictionary(wordCtx.word)) {
            await openSpellWordMenu(inputEl, wordCtx, e);
            return;
          }
          await openNormalMenuAt(e);
          return;
        }
      }
    } catch (err) {
      console.error('[SN] spellcheck detection fallita, apro menu normale:', err);
    }

    await openNormalMenuAt(e);
  }

  // Input testuali in cui ha senso aspettarsi una correzione ortografica
  // (esclude type=password, email, number, ecc. dove la spellcheck nativa è
  // disabilitata o non significativa).
  function isTextLikeInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if (el.disabled || el.readOnly) return false;
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    if (!['text', 'search', ''].includes(t)) return false;
    const sc = el.getAttribute('spellcheck');
    if (sc === 'false') return false;
    return true;
  }

  async function openNormalMenuAt(e) {
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
      selInfo, linkEl, imgEl, mediaEl, mediaUnder, imgUnder, linkUnder, layers, editable, clipboardHistory, navState,
    });

    // Slot riservato per la correzione ortografica nativa, nascosto finché Electron non notifica parola e suggerimenti, in cima al menu come voce principale.
    // Lo riserviamo su OGNI menu normale, non solo sugli <input> (#438): il correttore di Chromium vede il campo anche dove noi non capiamo cosa è stato cliccato — dentro i blocchi sigillati il bersaglio non è raggiungibile da nessuna API di pagina. Il broadcast arriva solo quando una parola errata c'è davvero, quindi altrove lo slot resta invisibile e non costa niente.
    const wantCorrection = settings?.featureFlags?.spellcheck !== false && !!SpellCheck;
    let updateCorrection = null;
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

    Menu.open({ x: e.clientX, y: e.clientY, items, keepOnScroll: !!selInfo });

    if (wantCorrection) {
      // Passa il timestamp di apertura: se il broadcast nativo è già arrivato
      // (vincoli di timing con l'await getClipboardHistory sopra), il modulo
      // spellcheck ce lo consegna subito invece di lasciarci aspettare.
      SpellCheck.onNextNativeSuggestion?.(({ word, suggestions }) => {
        if (!suggestions?.length) return;
        revealNativeCorrection(word, suggestions);
      }, { since: openedAt });
    }
  }

  // Applica un suggerimento del correttore di sistema al campo in cui si stava scrivendo, senza doverlo identificare nella pagina: è il caso dei blocchi sigillati (#438), dove il campo non è raggiungibile da nessuna API.
  // Quando il correttore segna una parola il browser la SELEZIONA, quindi sostituire la selezione è sostituire quella parola ovunque viva. Prima di scrivere si verifica che la selezione sia ancora esattamente quella; se no si ripiega sull'API di Electron, che lavora sui segni del correttore.
  function applyNativeCorrection(word, suggestion) {
    if (!suggestion) return;
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

  // Video/audio sotto il cursore (#400). `mediaEl`: il click è arrivato sul media o su un suo discendente, ed è il contesto principale — vince su immagine e link.
  // `mediaUnder`: nessun media fra gli antenati ma ce n'è uno sotto al punto cliccato, come su quasi tutti i player veri, che coprono il filmato con overlay di controllo. Ripiego SOLO quando non c'è altro contesto, così un video di sfondo non ruba il menu a ciò che sta sopra.
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

  // Immagine e collegamento SOTTO il punto cliccato, gemelli di `mediaUnder`: devono esistere tutti e tre, perché le schede delle home video e social sono fatte di strati sovrapposti, non annidati (#444).
  // Senza il ripiego per OGNI famiglia lo stesso identico pixel dà menu diversi a seconda di quale strato ha vinto in quell'istante.
  function findUnder(view, selector, anchor) {
    for (const el of view.stack) {
      const hit = closestAcrossShadow(el, selector);
      if (hit && sameSurface(anchor, hit, view)) return hit;
    }
    return null;
  }

  // Il freno di TUTTO ciò che si adotta da sotto. Guardare sotto al punto cliccato serve — le schede sono strati: copertina, anteprima, velo col titolo, e il collegamento sotto a tutto — ma si adotta solo ciò che l'utente sta GUARDANDO.
  // Altrimenti basta un elemento opaco davanti (la barra fissa di un sito di notizie, il riquadro dei cookie, un manto steso sulla pagina) perché il menu parli di un collegamento invisibile scelto dalla pagina: «Copia URL», «Apri in nuova tab» e «Condividi» finirebbero lì sopra, con l'analisi del link che parte da sola e va a scaricarlo.
  // Due condizioni sui rettangoli: 1) l'intersezione copre almeno metà del più piccolo dei due; 2) nessuno dei due INGHIOTTE l'altro — non basta circondarlo, deve stare su un'altra scala. Una scheda col bordo circonda la copertina da tutti i lati ed è la forma più comune degli elenchi: fermarsi al «circonda» faceva sparire le voci del collegamento su mezzo web (#444). Un contenitore ABBRACCIA, mentre una barra o un manto sono grandi come la finestra e nascondono una frazione minima di sé.
  const SURFACE_SLACK_PX = 4;
  // Quanta parte del più grande deve occupare il più piccolo perché il primo lo contenga invece di coprirlo. Le misure vere stanno lontane dalla soglia da tutte e due le parti: una copertina rientrata di dodici pixel occupa l'85% della scheda, una barra fissa sopra una riga di titoli sta sotto al 5%.
  const CONTAINER_MIN_RATIO = 0.35;

  // Il contenimento si pretende STRETTO su tutti e quattro i lati: la striscia del titolo condivide i bordi con la copertina, e una tolleranza sui bordi condivisi la scambiava per una copertura, spegnendo le voci proprio sulla sfumatura del titolo.
  // Il buco opposto — il manto a filo pagina che condivide i bordi col testo che copre — non si chiude qui: lo chiude la regola sui collegamenti invisibili in findLinkUnder.
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

  // L'elemento vive in uno strato FISSO o appiccicoso? Barre in cima, riquadri dei cookie e inviti a iscriversi stanno sopra la pagina e non scorrono con lei: quello che finisce lì sotto è contenuto seppellito da un'altra superficie, non «la stessa scheda». Le schede vere non sono mai fisse.
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

  // La seconda prova: quello che sta sotto lo si VEDE. Il conto sui rettangoli sa dire «stessa scala, stessa scheda», ma sulla FORMA non dice niente, e due cose opposte hanno la stessa forma: la riga di un elenco di risultati (miniatura piccola, testo a destra, collegamento steso sopra a tutto) ha lo stesso ingombro di una barra fissa sopra un titolo scivolato sotto.
  // Nessuna soglia di area separa i due casi, e il freno geometrico buttava via i comandi del filmato proprio sulle miniature vere (#444). A separarli è se l'utente li vede: se fra il punto cliccato e il candidato non c'è niente di DIPINTO, il candidato è quello che sta guardando, e la geometria non ha più niente da aggiungere.

  const SELF_PAINTING_TAGS = new Set([
    'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'SVG', 'IFRAME', 'EMBED', 'OBJECT',
    'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'HR', 'PROGRESS', 'METER',
  ]);
  // Sotto questa opacità uno sfondo non copre niente: serve solo a intercettare
  // il mouse (è così che sono fatti i veli delle schede), e chi guarda vede
  // quello che c'è dietro.
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

  // Testo che si vede per davvero. Il testo per i lettori di schermo sta nel
  // DOM ma è ritagliato a un pixel: non deve far passare per opaco un velo
  // vuoto (le righe dei risultati ci infilano spesso il titolo ripetuto).
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

  // Risalita che attraversa i confini dei componenti web: `contains()` di un
  // elemento in chiaro non vede quello che sta dentro uno shadow root, quindi
  // "la copertina sta dentro il collegamento" risultava falso proprio sulle
  // schede fatte a componenti.
  function containsAcrossShadow(ancestor, el) {
    if (!ancestor || !el) return false;
    let node = el;
    while (node) {
      if (node === ancestor) return true;
      node = node.parentNode || node.host || null;
    }
    return false;
  }

  // Il rettangolo dell'elemento copre il punto cliccato? Se no, l'elemento sta nella pila per uno PSEUDO-ELEMENTO: il collegamento steso su tutta la scheda lo fanno quasi tutti con un `::after` a `inset:0`, e allora nella pila c'è l'`<a>` del titolo mentre il suo rettangolo sta nella colonna del testo. Lì il rettangolo non misura la superficie di niente.
  function coversPoint(rect, view) {
    if (!rect || !view) return false;
    return view.x >= rect.left && view.x <= rect.right
      && view.y >= rect.top && view.y <= rect.bottom;
  }

  // C'è qualcosa di DIPINTO davanti a `el` nel punto cliccato? La pila arriva da `deepElementsFromPoint`, nell'ordine in cui si vede: chi sta prima sta sopra. Antenati e discendenti di `el` non contano — un antenato disegna dietro al figlio, e un figlio per chi guarda È `el`.
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

  // Quanto del candidato può essere nascosto da uno strato dipinto ESTRANEO prima che smetta di essere quello che l'utente sta guardando. La striscia del titolo copre il 31% della sua scheda e deve passare; un titolo per metà sotto una barra, o un pannello su mezza scheda, devono fermarsi.
  const HIDDEN_FRACTION = 0.45;

  // L'alfa più basso fra i colori di un'immagine CSS (nel computed style i gradienti serializzano i colori come rgb()/rgba()). Senza nessun colore leggibile si risponde 1: nel dubbio la sfumatura copre — l'errore prudente spegne una voce di menu, quello imprudente regala al menu un collegamento scelto dalla pagina.
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

  // Il candidato adottato da sotto è NASCOSTO da uno strato dipinto che non è la sua faccia? La sua faccia sono lui stesso, i suoi parenti nel DOM e una copertina (immagine, filmato, disegno, o un contenitore con un'immagine di sfondo).
  // Tutto il resto — testo, pannelli, sfondi — quando ne copre più di HIDDEN_FRACTION lo sta seppellendo: la verifica avversariale è entrata proprio da qui, con coperture opache dentro la pagina e con coppie barra-e-riga entrambe fisse.
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
      // A nascondere è uno SFONDO COPRENTE. Il testo no: attorno ai glifi si vede quello che c'è dietro, e la striscia quasi trasparente col titolo sopra una copertina è la forma normale delle schede. I gradienti si contano per prudenza, l'immagine di sfondo no: è una copertina scritta in CSS.
      let cs = null;
      try { cs = getComputedStyle(L); } catch (_) { continue; }
      if (!cs || cs.visibility === 'hidden') continue;
      const layerOpacity = parseFloat(cs.opacity);
      if (Number.isFinite(layerOpacity) && layerOpacity < 0.5) continue;
      const bg = cs.backgroundImage;
      if (bg && bg !== 'none' && bg.includes('url(')) continue;
      // Una SFUMATURA che da qualche parte è trasparente è un velo, non una copertura: attraverso la parte chiara si vede la scheda, ed è la forma più comune del velo del titolo. Nasconde solo la sfumatura interamente coprente, con tutti i colori ad alfa piena.
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

  // Un contenuto «appartiene» a un collegamento quando ci sta dentro nel DOM o quando ne occupa la superficie (i player coprono il filmato col proprio overlay, e le schede impilano copertina e link invece di annidarli).
  // Il DOM viene prima: se la pagina dice già che copertina e collegamento sono la stessa scheda, rifare il conto sui rettangoli può solo buttare via un'informazione certa (#444).
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
    // I rettangoli si misurano solo se sono davvero quelli del punto cliccato.
    // Quando uno dei due è nella pila per uno pseudo-elemento, il suo
    // rettangolo sta da un'altra parte e ogni conto su di lui è rumore.
    if (coversPoint(ra, view) && coversPoint(rb, view)) {
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w <= 0 || h <= 0) return false;
      if ((w * h) * 2 < Math.min(areaA, areaB)) return false;
      // Ai RETTANGOLI un confine fisso non si può chiedere: una barra o un riquadro che non scorrono condividono i bordi con quello che gli scivola sotto, e il conto diceva «stessa scheda» proprio lì. Con fissità diverse decide la prova di visibilità qui sotto, che una barra OPACA non passa — e un velo fisso trasparente sopra un collegamento ben visibile sì, l'unico caso onesto di quella forma.
      if (inFixedLayer(a) === inFixedLayer(b)
        && !hiddenBehindForeignPaint(b, view)
        && !swallows(ra, rb) && !swallows(rb, ra)) return true;
    }
    // Il conto sui rettangoli non decide. Resta la prova diretta, e vale da sola: se né l'uno né l'altro hanno qualcosa di dipinto davanti, in questo punto sono entrambi sotto gli occhi dell'utente — l'unica cosa che il freno voleva sapere (#444).
    return !coveredAt(a, view) && !coveredAt(b, view);
  }

  // Cosa c'è sotto il tasto destro. Sta in un posto solo perché il menu si apre da due strade (normale e correzione): col riconoscimento copiato in tutte e due, lo stesso clic rischiava di dare due menu diversi a seconda che sotto ci fosse o no una parola da correggere.
  function detectContext(target, x, y) {
    const linkEl = closestAcrossShadow(target, 'a[href]');
    const imgEl = target?.tagName === 'IMG' ? target : closestAcrossShadow(target, 'img');
    // Un solo colpo di hit-test per tutte e tre le famiglie: è la stessa pila di strati, e ripeterlo tre volte costerebbe tre risalite dell'albero a ogni apertura. `view` = la pila PIÙ il punto: vanno sempre insieme, perché il rettangolo di un elemento vale come misura solo se copre quel punto.
    const view = { stack: deepElementsFromPoint(x, y), x, y };
    const { mediaEl, mediaUnder } = findMedia(target, view);
    const imgUnder = imgEl ? null : findUnder(view, 'img', target);
    return {
      linkEl,
      imgEl,
      mediaEl,
      // I tre `*Under` escono da qui GIÀ VAGLIATI: o `sameSurface` li ha confrontati con l'elemento davvero cliccato, o è il DOM a legarli alla copertina adottata. Chi li legge più a valle non deve rifare il controllo, né può dimenticarselo — è così che la barra fissa e il manto invisibile erano finiti nel menu.
      mediaUnder,
      imgUnder,
      // Il collegamento lo può dire il DOM (la copertina adottata sta dentro un
      // <a>) prima ancora della pila di strati.
      linkUnder: linkEl ? null : findLinkUnder(view, target, mediaUnder || imgUnder),
      // Gli strati sotto il cursore, così come li ha visti il freno: servono più a valle per l'unica domanda che resta, se la copertina adottata e il collegamento siano la STESSA scheda. Senza, quella risposta tornerebbe a dipendere dai soli rettangoli, che sulle righe con la miniatura piccola sbagliano (#444).
      layers: view,
      editable: isEditable(target),
    };
  }

  // Il collegamento della scheda quando non è fra gli antenati. Due strade, e la prima è il DOM (#444): se la copertina adottata sta DENTRO un <a>, la pagina ha già detto che sono la stessa scheda, e rifare il conto sui rettangoli lì toglie e non aggiunge — fra collegamento e copertina ci sono bordo, imbottitura e spesso il titolo.
  // Solo quando il DOM non lega niente si guarda la pila: il collegamento sepolto è coperto da una COPERTINA nel punto cliccato? Quella è la faccia visibile di una scheda, e un link invisibile lì sotto è la scheda stessa. Testo e sfondi dipinti no: un collegamento sotto un paragrafo è l'esca del #499, non una scheda.
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
    const owner = contentUnder ? closestAcrossShadow(contentUnder, 'a[href]') : null;
    const hit = owner || findUnder(view, 'a[href]', target);
    if (!hit) return null;
    try {
      // Un collegamento che non riceve i click per il menu NON ESISTE (decisione owner sul #499): non è un'affordance della pagina, un click sinistro lì non navigherebbe mai. I collegamenti trasparenti delle schede vere i click li ricevono.
      if (getComputedStyle(hit).pointerEvents === 'none') return null;
      // Seconda metà della stessa decisione: un collegamento che non disegna niente e che nel punto cliccato è coperto da qualcosa che non è la sua copertina è invisibile PER COSTRUZIONE, e per il menu non esiste (#499: il link trasparente ritagliato sull'ingombro di un paragrafo). Le schede vere passano da `owner` o hanno una copertina davanti.
      if (!owner && !paintsSomething(hit) && !coverInFront(hit, view) && coveredAt(hit, view)) {
        return null;
      }
    } catch (_) {}
    return hit;
  }

  // La regola sta in un posto solo, src/shared/campoTesto.js: la stessa domanda («si sta scrivendo qui?») arriva anche dal processo principale, perché su Mac è la barra dei menu a prendersi Ctrl/Cmd+Z prima di noi (#527). Due copie avrebbero cominciato a divergere subito.
  function isEditable(el) {
    return !!(self.SN_CAMPO_TESTO && self.SN_CAMPO_TESTO.campoDiTesto(el));
  }

  // Menu correzione: rosso (parola sotto il cursore) e blu (errore contestuale). Stesso layout del menu normale, con in cima una voce «correzione» cliccabile e una freccetta che apre il sotto-menu delle azioni.

  // Recupera la selezione corrente dentro un <input>/<textarea> e la converte
  // nel formato {selection, sentence} usato altrove. Restituisce null se non
  // c'è selezione utile.
  function getInputSelectionInfo(target) {
    const el = target?.closest?.('input, textarea');
    if (!el || !el.matches?.('input, textarea')) return null;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start == null || end == null || start === end) return null;
    const value = el.value || '';
    const selection = value.slice(start, end).trim();
    if (!selection) return null;
    return { selection, sentence: value.trim() || selection };
  }

  async function buildBaseItemsAt(mouseEvent) {
    const target = realTarget(mouseEvent);
    let selInfo = Extract.getSelectionWithSentence(target);
    if (!selInfo) selInfo = getInputSelectionInfo(target);
    const {
      linkEl, imgEl, mediaEl, mediaUnder, imgUnder, linkUnder, layers, editable,
    } = detectContext(target, mouseEvent.clientX, mouseEvent.clientY);
    // Cattura il contesto di incolla (elemento + caret/selezione) anche per i
    // menu di correzione: senza questo, l'item "Incolla" del menu spellcheck
    // usava un pasteContext stale e incollava all'inizio del campo / falliva
    // sulle immagini (feedback alpha).
    if (editable) capturePasteContext(target);
    else pasteContext = null;
    const [clipboardHistory, navState] = await Promise.all([
      Actions.getClipboardHistory(),
      Actions.getNavState(),
    ]);
    return buildMenuItems({
      selInfo, linkEl, imgEl, mediaEl, mediaUnder, imgUnder, linkUnder, layers, editable, clipboardHistory, navState,
    });
  }

  function buildRedSubItems(editableEl, wordCtx, correction, altSuggestions = []) {
    const items = [];
    const seen = new Set([String(correction || '').toLowerCase()]);
    for (const s of altSuggestions) {
      const v = String(s || '').trim();
      if (!v || seen.has(v.toLowerCase())) continue;
      seen.add(v.toLowerCase());
      items.push({
        label: v,
        onClick: () => SpellCheck.applyFix(editableEl, { start: wordCtx.start, end: wordCtx.end }, v, {
          expectedSegment: wordCtx.word,
        }),
      });
    }
    if (items.length) items.push({ type: 'separator' });
    items.push(
      {
        label: I18n.t('spell_add_dict'),
        onClick: () => {
          SpellCheck.addToDictionary(wordCtx.word);
          Popup.showToast(I18n.t('toast_added_to_dict'));
        },
      },
      {
        label: I18n.t('spell_autocorrect'),
        onClick: async () => {
          await SpellCheck.setAutocorrect(wordCtx.word, correction);
          SpellCheck.applyFix(editableEl, { start: wordCtx.start, end: wordCtx.end }, correction);
          Popup.showToast(I18n.t('toast_autocorrect_saved'));
        },
      },
      {
        label: I18n.t('spell_manage'),
        onClick: () => {
          chrome.runtime.sendMessage({ type: MSG.OPEN_SPELLCHECK_PAGE });
        },
      },
    );
    return items;
  }

  function buildBlueSubItems(issue) {
    return [
      {
        type: 'info',
        label: issue.explanation || I18n.t('spell_semantic_issue'),
      },
      { type: 'separator' },
      {
        label: I18n.t('spell_manage'),
        onClick: () => {
          chrome.runtime.sendMessage({ type: MSG.OPEN_SPELLCHECK_PAGE });
        },
      },
    ];
  }

  // Click destro su parola in editabile (errore «rosso», non coperta da un issue blu). Mai il flash «Cerco una correzione…»: la riga compare solo se sappiamo che la parola è davvero sbagliata. Se la cache l'ha già marcata errata si mostra subito, e se il contesto è cambiato si rilancia in background aggiornando la riga.
  // Senza cache si riserva uno slot nascosto e si spara la richiesta: lo slot si rivela SOLO a misspelled=true. Il prefetch proattivo sta in spellcheck.js; qui si consuma la cache e si coprono i casi non prefetchati.
  async function openSpellWordMenu(editableEl, wordCtx, mouseEvent) {
    const items = await buildBaseItemsAt(mouseEvent);

    const cached = SpellCheck.getCachedSuggestion(editableEl, wordCtx.word);
    const cachedUsable = cached && cached.misspelled && cached.correction && cached.correction !== wordCtx.word;
    const contextChanged = cached && cached.sentence !== wordCtx.sentence;
    // Rilanciamo in background quando: (a) non c'è cache, oppure (b) c'è cache ma
    // il contesto è cambiato. In entrambi i casi potremmo finire per mostrare una
    // correzione che inizialmente non era visibile.
    const refireInBackground = !cached || contextChanged;

    let updateCorrection = null;

    // Suggerimenti del correttore NATIVO: immediati e affidabili, sono quelli dietro lo zigzag rosso. Di solito sono già in cache quando il menu si compone, altrimenti si rivelano appena arrivano. Sono la base che garantisce «qualcosa appare» anche senza LLM.
    const nativeSugg = (SpellCheck.getNativeSuggestions?.(wordCtx.word)) || [];
    const nativeTop = nativeSugg[0] || '';

    const applyAt = (corr) => SpellCheck.applyFix(
      editableEl, { start: wordCtx.start, end: wordCtx.end }, corr, { expectedSegment: wordCtx.word },
    );

    let visibleCorrection = cachedUsable ? cached.correction : nativeTop;
    let shown = !!visibleCorrection;

    const buildCorrectionItem = (initialLabel, initialOnClick, initialSubItems, hidden) => ({
      type: 'correction',
      label: initialLabel,
      loading: false,
      hidden,
      onClick: initialOnClick,
      subItems: initialSubItems,
      onMount: (_root, update) => { updateCorrection = update; },
    });

    if (shown) {
      items.unshift(
        buildCorrectionItem(
          visibleCorrection,
          () => applyAt(visibleCorrection),
          buildRedSubItems(editableEl, wordCtx, visibleCorrection, nativeSugg),
          /* hidden */ false,
        ),
        { type: 'separator' },
      );
    } else {
      // Slot riservato ma invisibile finché non sappiamo se la parola è errata. Lo riserviamo SEMPRE, non solo quando rilanciamo l'LLM: il correttore nativo può marcare la parola anche quando la cache dice «non errata», o il broadcast `_spell:native` può arrivare con qualche ms di ritardo.
      // Senza uno slot montato, onNativeSuggestions non avrebbe dove rivelare la correzione e il suggerimento dietro lo zigzag rosso non comparirebbe mai.
      items.unshift(
        buildCorrectionItem('', null, [], /* hidden */ true),
        { type: 'separator', hidden: true },
      );
    }

    Menu.open({ x: mouseEvent.clientX, y: mouseEvent.clientY, items, keepOnScroll: true });

    const revealCorrection = (corr, alts) => {
      if (!updateCorrection || !corr) return;
      visibleCorrection = corr;
      shown = true;
      updateCorrection({
        hidden: false,
        label: corr,
        loading: false,
        onClick: () => applyAt(corr),
        subItems: buildRedSubItems(editableEl, wordCtx, corr, alts || []),
      });
    };

    if (!shown) {
      SpellCheck.onNativeSuggestions?.(wordCtx.word, (sugg) => {
        if (shown || !sugg?.length) return;
        revealCorrection(sugg[0], sugg);
      });
    }

    // Se l'LLM declina ma c'è un suggerimento nativo, quest'ultimo resta visibile.
    const applyResponse = (res) => {
      // Si cache SOLO un verdetto definitivo dell'LLM. Se `res` è null la chiamata è FALLITA (nessuna chiave, errore del provider, parse fallito): cacharla come «non errata» impedirebbe al prossimo click destro di rilanciare e — peggio — soffocherebbe il suggerimento nativo, lasciando la parola segnata in rosso senza correzione nel menu.
      if (res) {
        SpellCheck.setCachedSuggestion(editableEl, wordCtx.word, { ...res, sentence: wordCtx.sentence });
      }
      if (!updateCorrection) return;
      const usable = res && res.misspelled && res.correction && res.correction !== wordCtx.word;
      if (!usable) {
        // Rileggi i suggerimenti nativi ADESSO: il broadcast `_spell:native` può
        // essere arrivato dopo l'apertura del menu (lo snapshot in `nativeSugg`
        // era vuoto). È la fonte affidabile quando l'LLM non risponde.
        const freshNative = (SpellCheck.getNativeSuggestions?.(wordCtx.word)) || [];
        const freshTop = freshNative[0] || '';
        if (freshTop) {
          if (!shown || visibleCorrection !== freshTop) revealCorrection(freshTop, freshNative);
        } else if (shown) {
          updateCorrection({ remove: true });
        } else {
          updateCorrection({ hidden: true });
        }
        return;
      }
      revealCorrection(res.correction, (SpellCheck.getNativeSuggestions?.(wordCtx.word)) || nativeSugg);
    };

    if (refireInBackground) {
      SpellCheck.requestWordSuggestion(wordCtx).then(applyResponse).catch(() => {});
    }
  }

  // Click destro su un range "blu" (issue contestuale già rilevata): la correzione
  // (o l'esplicazione del problema) è già pronta, niente loading. Click sulla riga
  // = applica; freccetta = box con la spiegazione completa.
  async function openSpellBlueMenu(editableEl, issue, mouseEvent) {
    const items = await buildBaseItemsAt(mouseEvent);

    let label;
    if (issue.correction) {
      label = issue.correction;
    } else if (issue.type === 'repetition') {
      label = I18n.t('spell_resolve');
    } else {
      label = (issue.explanation || I18n.t('spell_semantic_issue')).slice(0, 60);
    }

    items.unshift(
      {
        type: 'correction',
        label,
        loading: false,
        onClick: () => {
          SpellCheck.applyFix(editableEl, { start: issue.start, end: issue.end }, issue.correction || '', {
            expectedSegment: issue.segment,
          });
        },
        subItems: buildBlueSubItems(issue),
      },
      { type: 'separator' },
    );
    Menu.open({ x: mouseEvent.clientX, y: mouseEvent.clientY, items, keepOnScroll: true });
  }

  function buildFeedbackItem() {
    return {
      type: 'item',
      label: 'Invia feedback',
      onClick: () => openSurface('feedback', () => self.SN_FEEDBACK_UI?.open()),
    };
  }

  // #405 — i pannelli a tutta superficie (feedback, red-team, sidebar Aiuto) appartengono alla pagina: aperti dentro un riquadro incorporato starebbero in un rettangolo di poche centinaia di pixel, tagliati. Dal riquadro si chiede alla pagina di aprirli.
  function openSurface(surface, localOpen) {
    if (!IS_SUBFRAME) {
      try { localOpen(); } catch (e) { console.error('[SN] apertura pannello', e); }
      return;
    }
    try {
      Promise.resolve(chrome.runtime.sendMessage({ type: MSG.RUN_IN_TOP_FRAME, surface })).catch(() => {});
    } catch (_) {}
  }

  // Ordine verticale del menu: riga icone globali → Aiuto → zona contestuale → Feedback. La riga globale è stabile e fa da ancora, la zona contestuale varia in base al click.
  function buildMenuItems({
    selInfo, linkEl, imgEl, mediaEl, mediaUnder, imgUnder, linkUnder, layers, editable, clipboardHistory, navState,
  }) {
    const items = [];

    // Riga icone globali (max 5 + overflow), tutte mute con etichetta nel tooltip. Registro, layout persistente e drag vivono in src/content/menuIcons.js.
    items.push(MenuIcons.buildGlobalIconRow(navState));

    items.push({ type: 'separator' });
    items.push(buildHelpItem());

    // «Interrompi lettura» è presente in QUALSIASI menu mentre la sintesi riproduce, anche senza selezione o contesto, così la lettura si ferma da dove si è. isAnyReading è vero anche se a leggere è un'ALTRA scheda: lo stop chiede al main di inoltrarlo a quella giusta.
    if (TTS.isAnyReading()) {
      items.push(TTS.buildStopReadingItem());
    }

    // «Mostra originale» solo quando alla traduzione manca ancora qualcosa: interrotta a metà (#408), o finita ma col sito che ha aggiunto altro testo (#407). In quegli stati l'icona serve a CONTINUARE, quindi il ritorno all'originale deve restare raggiungibile; a traduzione completa e ferma lo offre già l'icona.
    const iconIsRestore = TranslatePage && typeof TranslatePage.showsRestore === 'function'
      && TranslatePage.showsRestore();
    if (TranslatePage && typeof TranslatePage.canContinue === 'function'
        && TranslatePage.canContinue() && !iconIsRestore) {
      items.push(TranslatePage.buildRestoreOriginalItem());
    }

    const contextItems = buildContextualItems({
      selInfo, linkEl, imgEl, mediaEl, mediaUnder, imgUnder, linkUnder, layers, editable, clipboardHistory,
    });
    if (contextItems.length > 0) {
      items.push({ type: 'separator' });
      for (const it of contextItems) items.push(it);
    }

    items.push({ type: 'separator' });
    items.push(buildFeedbackItem());
    items.push(buildRedteamAttackItem());

    return items;
  }

  // Red-team «Invia attacco» (spec §8.1): pannello dedicato con due campi separati e il costo sul bottone. Vive in src/content/redteamAttack.js.
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

  function buildHelpItem() {
    return {
      type: 'item',
      label: I18n.t('menu_help'),
      shortcut: Tasti.etichetta('Alt+H'),
      onClick: () => openSurface('help', () => openHelpSidebar()),
    };
  }

  // Azioni sull'immagine, senza la sezione «Spiega»: la compone il chiamante, così quando l'immagine è anche un link non partono due box AI a ogni apertura.
  function buildImageActionItems(imgEl) {
    return [
      { type: 'item', label: I18n.t('menu_copy_image'), onClick: () => Actions.copyImage(imgEl) },
      { type: 'item', label: I18n.t('menu_save_image_as'), onClick: () => Actions.downloadImage(imgEl) },
      {
        type: 'item',
        label: I18n.t('menu_copy_image_link'),
        onClick: () => Actions.copyUrlToClipboard(imgEl.currentSrc || imgEl.src),
      },
      {
        type: 'item',
        label: I18n.t('menu_search_image'),
        onClick: () => Actions.searchImageOnWeb(imgEl),
      },
    ];
  }

  function buildLinkActionItems(linkEl) {
    const out = [
      {
        type: 'item',
        label: I18n.t('menu_open_in_new_tab'),
        onClick: () => window.open(linkEl.href, '_blank', 'noopener'),
      },
    ];
    // «Salva file», gemello di «Salva immagine come» per i link a un file (PDF, ZIP, allegato). Compare solo quando il link punta davvero a un file (isDownloadableLink): su un link a un'altra pagina scaricare l'HTML non avrebbe senso.
    if (Actions.isDownloadableLink(linkEl)) {
      out.push({
        type: 'item',
        label: I18n.t('menu_save_file'),
        onClick: () => Actions.downloadLink(linkEl),
      });
    }
    out.push(
      {
        type: 'item',
        label: I18n.t('menu_copy_link'),
        onClick: () => Actions.copyUrlToClipboard(linkEl.href),
      },
      {
        type: 'item',
        label: I18n.t('menu_save_link_for_later'),
        onClick: () => Actions.saveLink(linkEl),
      },
      {
        type: 'item',
        label: I18n.t('menu_share_link'),
        onClick: () => Actions.shareLink(linkEl),
      },
    );
    return out;
  }

  // Costruisce gli item della zona contestuale in base a cosa è stato cliccato.
  // Matrice: testo / testo+editabile / video-audio / immagine (+ link) / link /
  // casella input / niente.
  function buildContextualItems({
    selInfo, linkEl, imgEl, mediaEl, mediaUnder, imgUnder, linkUnder, layers, editable, clipboardHistory,
  }) {
    const items = [];

    if (selInfo && editable) {
      items.push({ type: 'item', label: I18n.t('menu_cut'), onClick: () => Actions.cutSelection() });
      items.push({ type: 'item', label: I18n.t('menu_copy'), onClick: () => Actions.copyToClipboard(selInfo.selection) });
      items.push(Actions.buildPasteItem(clipboardHistory));
      items.push(TTS.buildDictateItem());
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
      items.push({ type: 'item', label: I18n.t('menu_copy'), onClick: () => Actions.copyToClipboard(selInfo.selection) });
      items.push({
        type: 'item',
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
      // …ma se il media è racchiuso in un <a> (copertina di un video in una lista, anteprima di un articolo) è ANCHE un collegamento, ed è proprio il caso in cui l'utente vuole spesso il link: senza queste voci non avrebbe modo di aprirlo, copiarlo o salvarlo (#434).
      // Il collegamento non è sempre un antenato: nelle home dei siti video e social l'anteprima che parte al passaggio del mouse si STENDE SOPRA la scheda e il link resta sotto (#444). È `linkUnder`, che arriva qui solo se occupa la stessa superficie del filmato cliccato.
      const link = linkEl || linkUnder;
      if (link) {
        items.push({ type: 'separator' });
        for (const it of buildLinkActionItems(link)) items.push(it);
        items.push({ type: 'separator' });
        // Il media non ha una sua sezione «Spiega»: quella del collegamento è l'unica, quindi resta — nessuna seconda chiamata AI, e il menu del link è completo come quando lo si clicca da solo.
        items.push(Actions.buildInlineExplainLink(link));
      }
      return items;
    }

    if (imgEl) {
      for (const it of buildImageActionItems(imgEl)) items.push(it);
      // …ma se l'immagine è racchiusa in un <a> (miniature di articoli, schede prodotto, risultati per immagini) è ANCHE un collegamento, e in un browser normale le due famiglie di voci compaiono insieme (#401). Come per il filmato, la copertina può essere STESA SOPRA il link invece che stargli dentro: se occupa la stessa superficie è la stessa scheda (#444).
      const linkOfImg = linkEl || linkUnder;
      if (linkOfImg) {
        items.push({ type: 'separator' });
        for (const it of buildLinkActionItems(linkOfImg)) items.push(it);
      }
      items.push({ type: 'separator' });
      // Una sola sezione "Spiega" (quella dell'immagine, l'elemento cliccato):
      // aggiungerne una seconda firerebbe una seconda chiamata AI a ogni apertura.
      items.push(Actions.buildInlineExplainImage(imgEl));
      return items;
    }

    if (linkEl) {
      // Copertina di un video dentro un link, col player che copre il filmato con l'overlay: il clic arriva all'overlay e il <video> finisce in `mediaUnder`. Per chi guarda è lo stesso filmato dentro lo stesso link, quindi il menu dev'essere lo stesso del ramo qui sopra — ma solo se il filmato è DAVVERO quello della scheda, dentro il collegamento o a occuparne la superficie.
      const mediaInLink = belongsTo(mediaUnder, linkEl, layers) ? mediaUnder : null;
      if (mediaInLink) {
        for (const it of Actions.buildMediaItems(mediaInLink)) items.push(it);
        items.push({ type: 'separator' });
      }
      // Stessa storia per la copertina ferma: le schede la coprono quasi sempre con una sfumatura o un velo che regge il titolo, e il clic arriva lì invece che sull'`<img>`. Senza un filmato in funzione, il contenuto della scheda è quell'immagine (#444).
      const imgInLink = (!mediaInLink && belongsTo(imgUnder, linkEl, layers)) ? imgUnder : null;
      if (imgInLink) {
        for (const it of buildImageActionItems(imgInLink)) items.push(it);
        items.push({ type: 'separator' });
      }
      for (const it of buildLinkActionItems(linkEl)) items.push(it);
      items.push({ type: 'separator' });
      // Il riquadro parla dell'elemento primario, cioè quello le cui voci aprono il menu: se abbiamo adottato la copertina, il primario è lei. Senza, la stessa scheda cambiava argomento a seconda del punto cliccato, con le stesse identiche voci-azione (#444). Sul filmato resta il collegamento: una spiegazione del filmato non esiste.
      items.push(imgInLink
        ? Actions.buildInlineExplainImage(imgInLink)
        : Actions.buildInlineExplainLink(linkEl));
      return items;
    }

    if (editable) {
      items.push(Actions.buildPasteItem(clipboardHistory));
      items.push(TTS.buildDictateItem());
      return items;
    }

    // Nessun altro contesto, ma sotto al punto cliccato c'è un filmato coperto
    // dall'overlay del player: sono comunque le sue azioni che l'utente cerca.
    if (mediaUnder) {
      for (const it of Actions.buildMediaItems(mediaUnder)) items.push(it);
      // Scheda a strati: sopra un velo trasparente che non è né link né media, sotto il filmato e il link (#444). Qui sono due cose prese entrambe da sotto, quindi devono stare insieme anche fra loro — il filmato dentro il collegamento, o sulla sua stessa superficie — o il menu unirebbe due schede diverse.
      if (belongsTo(mediaUnder, linkUnder, layers)) {
        items.push({ type: 'separator' });
        for (const it of buildLinkActionItems(linkUnder)) items.push(it);
        items.push({ type: 'separator' });
        items.push(Actions.buildInlineExplainLink(linkUnder));
      }
      return items;
    }

    // Stessa scheda, anteprima ferma: sotto il velo non c'è più un filmato ma la copertina, e sotto di lei il collegamento. Senza questo ramo lo stesso identico pixel dava due esiti opposti, menu completo mentre il filmatino suonava e menu vuoto un istante dopo (#444).
    if (imgUnder) {
      for (const it of buildImageActionItems(imgUnder)) items.push(it);
      if (belongsTo(imgUnder, linkUnder, layers)) {
        items.push({ type: 'separator' });
        for (const it of buildLinkActionItems(linkUnder)) items.push(it);
      }
      items.push({ type: 'separator' });
      items.push(Actions.buildInlineExplainImage(imgUnder));
      return items;
    }

    // E il collegamento da solo: un velo trasparente sopra una scheda-link basta a far sparire «Apri in nuova tab», «Copia URL», «Salva link per dopo» e «Condividi». È come sono costruiti quasi tutti gli elenchi di schede (#444). Un velo, appunto: barre fisse, riquadri modali e manti sono già stati scartati da `linkUnder`.
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

  // Le azioni del tasto destro (appunti, screenshot, OCR, salva/condividi/cerca, color picker, QR, spiegazioni inline) vivono in src/content/actions.js, caricato prima di questo file; le dipendenze gliele passa Actions.init() in testa.

  function openHelpSidebar(context) {
    Sidebar.open(context);
  }

  function onRuntimeMessage(msg, sender, sendResponse) {
    if (msg?.type === MSG.FULLSCREEN_CHANGED) {
      fullscreenAnnunciato = true;
      contentFullscreen = !!msg.fullscreen;
      // Se un menu è aperto proprio adesso, la sua voce dello schermo intero
      // sta dicendo una cosa che non è più vera: ridisegnala sul posto invece
      // di lasciarla mentire finché il menu non si chiude (#514).
      try { if (Menu?.isOpen?.()) MenuIcons.redrawIconRows?.(); } catch (_) {}
      return;
    }
    // Il main ci consegna un Esc che il browser ci avrebbe mangiato (schermo
    // pieno del sito): lo rimettiamo in circolo e il giro di sempre decide di
    // chi era (#514, giro 10).
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
    // Toast di sistema dal main (#341): il broadcast arriva a TUTTE le schede, lo mostra solo quella in primo piano per non moltiplicare lo stesso avviso.
    // #405 — un riquadro incorporato della stessa scheda ha aperto il suo menu: gli eventi del mouse non attraversano il bordo di un riquadro, quindi il nostro menu non si accorgerebbe del clic e ne resterebbero aperti due.
    if (msg?.type === MSG.CLOSE_OTHER_MENUS) {
      try { Menu.close(); } catch (_) {}
      return;
    }
    // #405 — azione di PAGINA scelta dal menu aperto dentro un riquadro
    // (tradurre, condividere, salvare, QR, screenshot…): il riquadro l'ha
    // rimandata qui perché solo il frame principale è "la pagina".
    if (msg?.type === MSG.TOP_FRAME_COMMAND) {
      try {
        if (msg.surface === 'feedback') self.SN_FEEDBACK_UI?.open();
        else if (msg.surface === 'redteam') self.SN_REDTEAM_ATTACK_UI?.open();
        else if (msg.surface === 'help') openHelpSidebar();
        else MenuIcons.runIconAction(msg.iconId);
      } catch (e) { console.error('[SN] azione di pagina dal riquadro', e); }
      return;
    }
    if (msg?.type === MSG.SHOW_TOAST) {
      // Gli avvisi di sistema appartengono alla pagina: mostrarli anche dentro
      // ogni riquadro incorporato li duplicherebbe (#405).
      if (IS_SUBFRAME) return;
      try {
        if (document.visibilityState === 'visible' && document.hasFocus()) {
          Popup?.showToast?.(String(msg.text || ''), { duration: Number(msg.duration) || 2800 });
        }
      } catch (_) {}
      return;
    }
    // Stato della lettura condiviso fra le schede: aggiorna il flag globale (per mostrare «Interrompi lettura» anche se legge un'altra scheda) o ferma quella locale quando un'altra chiede lo stop.
    if (msg?.type === MSG.TTS_GLOBAL_READING || msg?.type === MSG.TTS_STOP) {
      TTS.handleBroadcast(msg);
      return;
    }
    if (msg?.type === MSG.SETTINGS_UPDATED) {
      settings = msg.settings;
      applyTheme(settings.theme);
      applyThemeTokens(settings.themeTokens);
      // I parametri di estrazione del colore identità possono cambiare (a voce o in Preferenze): si ricalcola il colore del favicon coi nuovi, così la tinta della tab si aggiorna live.
      if (!IS_SUBFRAME) { try { PageColor.reportTabIdentityColor(() => settings && settings.tabColor); } catch (_) {} }
      // SpellCheck.init registra listener globali; per non duplicarli su update
      // usiamo updateSettings (definito apposta da spellcheck.js).
      SpellCheck.updateSettings(isBlocked() ? { featureFlags: { spellcheck: false } } : settings);
      return;
    }
    if (msg?.type === MSG.SHORTCUT_TRIGGERED) {
      if (msg.command === 'save-for-later') {
        if (isBlocked()) { sendResponse({ savePayload: null }); return; }
        sendResponse({ savePayload: Actions.buildSavePayload() });
        return;
      }
      handleShortcut(msg.command, msg.context);
      sendResponse({ ok: true });
    }
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
      // La spiegazione breve ora è inline nel menu; lo shortcut apre direttamente l'approfondimento.
      if (selInfo) Actions.triggerExplainOrTranslate(ACTIONS.EXPLAIN_DEEP, selInfo, anchor);
      else Popup.showToast(I18n.t('err_no_selection'));
    } else if (command === 'translate-selection') {
      if (selInfo) Actions.triggerExplainOrTranslate(ACTIONS.TRANSLATE_SELECTION, selInfo, anchor);
      else Popup.showToast(I18n.t('err_no_selection'));
    } else if (command === 'open-help-sidebar') {
      openHelpSidebar(context);
    }
  }

  // Lettura ad alta voce e dettatura vivono in src/content/tts.js, caricato prima di questo file; le dipendenze gliele passa TTS.init() in testa.

  init();
})();
