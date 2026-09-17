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

    // Queste tre cose descrivono la SCHEDA, quindi restano alla pagina (vedi IS_SUBFRAME).
    if (!IS_SUBFRAME) {
      // Il colore della cima pagina va al main, che tinge la tab (§1.1). Attivo anche sulle
      // pagine senza menu: il colore non c'entra col menu.
      try { PageColor.startTabColorSampler(); } catch (_) {}

      // Colore identità del sito (§1.2): calcolato una volta e mandato al main, che lo cacha
      // per dominio e lo applica attenuato alle tab inattive.
      try { PageColor.reportTabIdentityColor(() => settings && settings.tabColor); } catch (_) {}

      // Segnali di attività (§2.1): ultima interazione, % di scroll, form sporco.
      // Servono all'LLM per decidere cosa archiviare.
      try { startTabActivityReporter(); } catch (_) {}
    }

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
    // Due tetti alle rivendicazioni di fila, per COSA si è visto succedere: prova forte
    // (qualcosa è sparito) tre, prova debole (tasto consumato) uno. Il tetto vero è nel main.
    const TETTO_PROVE_FORTI = 3;
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
      if (isEditable(target) || isEditable(document.activeElement)) return;
      e.preventDefault();
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: MSG.NAV_BACK }).catch(() => {});
    }, { capture: true });

    if (isBlocked()) return;

    SpellCheck.init(settings);

    // Sulle pagine web si passa dal listener window+capture del preload, per essere primi
    // anche dove il contextmenu è bloccato; sulle filo:// in BUBBLE, hanno un menu loro.
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

    // Marker per i test: `filoReady` dice solo che i moduli sono caricati, questo che i
    // listener sono attivi, spellcheck compreso. Innocuo a runtime.
    try { document.documentElement.dataset.filoContentReady = '1'; } catch (_) {}
  }

  // Campionatore del colore tab e colore identità del sito: src/content/pageColor.js.

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
    // Dentro un riquadro «about:blank» e «about:srcdoc» sono contenuto di chi lo ospita, non
    // pagine di sistema: lì il menu deve esserci come ovunque (#405).
    const embeddedAbout = IS_SUBFRAME && /^about:(blank|srcdoc)/i.test(url);
    if (!embeddedAbout && PAGES_WITHOUT_MENU_PREFIXES.some((p) => url.startsWith(p))) return true;
    const blocklist = settings?.blocklist || [];
    const matches = (host) => !!host && blocklist.some((d) => host === d || host.endsWith('.' + d));
    // Filo spento su un sito resta spento nei riquadri che quel sito incorpora: il riquadro
    // ha un'altra origine e da solo non lo saprebbe, quindi guarda l'indirizzo dell'ospite.
    if (matches(hostOfUrl(pageUrl))) return true;
    return matches(location.hostname);
  }

  function hostOfUrl(url) {
    try { return new URL(String(url || '')).hostname; } catch (_) { return ''; }
  }

  // Indirizzo della pagina che ospita questo frame: arriva dal main, perché da dentro un
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

  // Token estetici scelti dall'utente per le superfici Filo nella pagina (#146.1).
  // Idempotente, quindi innocuo anche sulle pagine filo://, dove ci pensa pageBootstrap.
  function applyThemeTokens(tokens) {
    const reg = self.SN_THEME_TOKENS;
    if (reg) reg.applyToDocument(document, tokens || {});
  }

  // Dentro uno shadow root `e.target` è ri-targettizzato all'host e non si vede più cosa è
  // stato davvero cliccato: composedPath()[0] attraversa il confine.
  function realTarget(e) {
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

    // stopPropagation tiene fuori il menu del sito; NON stopImmediatePropagation, che
    // soffocherebbe l'evento del correttore nativo, né preventDefault.
    e.stopPropagation();

    // In un editabile prima si cerca un errore «blu» (sincrono), altrimenti parte la
    // richiesta on-demand all'LLM per la parola sotto il cursore.
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
        // Anche su <input>, che il nostro overlay non copre: i suggerimenti nativi dipendono dal
        // dizionario della lingua attiva e da soli non bastano.
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

  // Solo gli input in cui ha senso una correzione: su password, email e number la
  // spellcheck nativa è disattivata o non significativa.
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
    // Serve a onNextNativeSuggestion per capire se il broadcast `_spell:native` arrivato
    // durante l'await qui sotto riguarda questa apertura del menu, invece di perderlo.
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

    // Lo slot per la correzione nativa si riserva su OGNI menu (#438): Chromium vede anche
    // i campi che nessuna API di pagina raggiunge. Senza broadcast resta invisibile.
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
      // Col timestamp di apertura il modulo spellcheck consegna subito un broadcast già
      // arrivato durante l'await qui sopra, invece di lasciarci aspettare.
      SpellCheck.onNextNativeSuggestion?.(({ word, suggestions }) => {
        if (!suggestions?.length) return;
        revealNativeCorrection(word, suggestions);
      }, { since: openedAt });
    }
  }

  // Applica un suggerimento nativo sostituendo la SELEZIONE, che è la parola segnata dal
  // correttore: è l'unica strada nei blocchi sigillati (#438), dove il campo è fuori mano.
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
    const linkEl = closestAcrossShadow(target, 'a[href]');
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
    const owner = contentUnder ? closestAcrossShadow(contentUnder, 'a[href]') : null;
    const hit = owner || findUnder(view, 'a[href]', target);
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

  // Mai il flash «Cerco una correzione…»: la riga compare solo quando sappiamo che la
  // parola è sbagliata. Il prefetch proattivo sta in spellcheck.js, qui si consuma.
  async function openSpellWordMenu(editableEl, wordCtx, mouseEvent) {
    const items = await buildBaseItemsAt(mouseEvent);

    const cached = SpellCheck.getCachedSuggestion(editableEl, wordCtx.word);
    const cachedUsable = cached && cached.misspelled && cached.correction && cached.correction !== wordCtx.word;
    const contextChanged = cached && cached.sentence !== wordCtx.sentence;
    // Si rilancia in background senza cache o col contesto cambiato: in entrambi i casi la
    // correzione potrebbe non essere quella mostrata all'inizio.
    const refireInBackground = !cached || contextChanged;

    let updateCorrection = null;

    // I suggerimenti del correttore NATIVO sono la base che garantisce «qualcosa appare»
    // anche senza LLM: sono quelli dietro lo zigzag rosso.
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
      // Lo slot si riserva SEMPRE: il correttore nativo può marcare la parola anche quando la
      // cache dice «non errata», e senza slot montato non avrebbe dove rivelarsi.
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
      // Si cacha solo un verdetto definitivo: `res` null è una chiamata FALLITA, e cacharla
      // come «non errata» soffocherebbe anche il suggerimento nativo al prossimo click.
      if (res) {
        SpellCheck.setCachedSuggestion(editableEl, wordCtx.word, { ...res, sentence: wordCtx.sentence });
      }
      if (!updateCorrection) return;
      const usable = res && res.misspelled && res.correction && res.correction !== wordCtx.word;
      if (!usable) {
        // Rilegge i suggerimenti nativi ADESSO: il broadcast può essere arrivato dopo
        // l'apertura del menu, ed è la fonte affidabile quando l'LLM non risponde.
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

  // Range «blu»: la correzione è già pronta, niente attesa. Click sulla riga = applica,
  // freccetta = box con la spiegazione.
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

  // I pannelli a tutta superficie appartengono alla pagina: dentro un riquadro incorporato
  // starebbero in poche centinaia di pixel, tagliati (#405).
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
    selInfo, linkEl, imgEl, mediaEl, mediaUnder, imgUnder, linkUnder, layers, editable, clipboardHistory, navState,
  }) {
    const items = [];

    // Registro, layout persistente e drag delle icone: src/content/menuIcons.js.
    items.push(MenuIcons.buildGlobalIconRow(navState));

    items.push({ type: 'separator' });
    items.push(buildHelpItem());

    // «Interrompi lettura» c'è in QUALSIASI menu mentre si legge, anche senza selezione: se
    // a leggere è un'altra scheda, lo stop passa dal main che lo inoltra a quella giusta.
    if (TTS.isAnyReading()) {
      items.push(TTS.buildStopReadingItem());
    }

    // «Mostra originale» solo quando alla traduzione manca ancora qualcosa: lì l'icona serve
    // a CONTINUARE, quindi il ritorno all'originale deve restare raggiungibile (#407, #408).
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

  // Il pannello vive in src/content/redteamAttack.js (spec §8.1).
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

  // Azioni sull'immagine, senza la sezione «Spiega»: la compone il chiamante, così quando
  // l'immagine è anche un link non partono due box AI a ogni apertura.
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
    // «Salva file» solo quando il link punta davvero a un file: su un link a un'altra pagina
    // scaricherebbe l'HTML.
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

  // Matrice: testo, testo editabile, video-audio, immagine (+ link), link, input, niente.
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
      items.push(Actions.buildInlineExplainImage(imgEl));
      return items;
    }

    if (linkEl) {
      // Il player copre il filmato col suo overlay: per chi guarda è lo stesso filmato dentro
      // lo stesso link, ma solo se è DAVVERO quello della scheda (#444).
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
      if (belongsTo(imgUnder, linkUnder, layers)) {
        items.push({ type: 'separator' });
        for (const it of buildLinkActionItems(linkUnder)) items.push(it);
      }
      items.push({ type: 'separator' });
      items.push(Actions.buildInlineExplainImage(imgUnder));
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

  function openHelpSidebar(context) {
    Sidebar.open(context);
  }

  function onRuntimeMessage(msg, sender, sendResponse) {
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
    // Stato della lettura condiviso fra le schede: «Interrompi lettura» deve esserci anche
    // quando a leggere è un'altra.
    if (msg?.type === MSG.TTS_GLOBAL_READING || msg?.type === MSG.TTS_STOP) {
      TTS.handleBroadcast(msg);
      return;
    }
    if (msg?.type === MSG.SETTINGS_UPDATED) {
      settings = msg.settings;
      applyTheme(settings.theme);
      applyThemeTokens(settings.themeTokens);
      // I parametri del colore identità possono cambiare a voce o in Preferenze: si ricalcola,
      // così la tinta della tab si aggiorna subito.
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
      // La spiegazione breve è già inline nel menu: la scorciatoia apre l'approfondimento.
      if (selInfo) Actions.triggerExplainOrTranslate(ACTIONS.EXPLAIN_DEEP, selInfo, anchor);
      else Popup.showToast(I18n.t('err_no_selection'));
    } else if (command === 'translate-selection') {
      if (selInfo) Actions.triggerExplainOrTranslate(ACTIONS.TRANSLATE_SELECTION, selInfo, anchor);
      else Popup.showToast(I18n.t('err_no_selection'));
    } else if (command === 'open-help-sidebar') {
      openHelpSidebar(context);
    }
  }

  // Lettura ad alta voce e dettatura: src/content/tts.js.

  init();
})();
