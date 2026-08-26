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

  // I moduli estratti (actions.js, menuIcons.js, tts.js, editBox.js) hanno
  // bisogno di pezzi che restano qui: settings correnti, gestione del
  // pasteContext, blocklist e ultimo evento mouse. Le funzioni sono
  // dichiarazioni hoisted, quindi i riferimenti sono già validi.
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
  // Rispecchia la modalità "contenuto a tutto schermo" del main (vedi tabs.js).
  // Serve a mostrare l'icona/etichetta giusta nella voce di menu "Schermo intero".
  let contentFullscreen = false;

  // #405 — stiamo girando dentro un riquadro incorporato (video, mappa, modulo,
  // blocco commenti) invece che nella pagina? Il menu del tasto destro e tutto
  // ciò che riguarda l'ELEMENTO cliccato funzionano identici qui dentro; ciò che
  // riguarda la PAGINA (colore della scheda, segnali di attività, avvisi di
  // sistema, azioni globali del menu) no: il riquadro conosce solo se stesso e
  // parlerebbe del rettangolo sbagliato. Quelle cose restano/tornano alla pagina.
  const IS_SUBFRAME = (() => {
    try { return window.top !== window.self; } catch (_) { return true; }
  })();

  // ------------------------------------------------------------
  // Bootstrap
  // ------------------------------------------------------------
  async function init() {
    settings = await fetchSettings();
    applyTheme(settings.theme);
    applyThemeTokens(settings.themeTokens);

    // Le tre cose qui sotto descrivono la SCHEDA: il colore che la tinge e i
    // segnali su quanto è stata usata. Un riquadro incorporato non ne sa nulla —
    // campionerebbe il colore di una pubblicità e conterebbe lo scroll di un
    // rettangolo — quindi restano alla pagina che lo ospita (#405).
    if (!IS_SUBFRAME) {
      // "Vetro smerigliato" della tab attiva (§1.1): campiona il colore della cima
      // della pagina e mandalo al main, che tinge la tab. Attivo su tutte le pagine
      // (anche quelle senza menu), perché il colore non c'entra col menu.
      try { PageColor.startTabColorSampler(); } catch (_) {}

      // Colore identità del sito (§1.2): calcolato una volta (theme-color →
      // manifest → favicon → fallback) e mandato al main, che lo cacha per dominio
      // e lo applica attenuato alle tab inattive.
      try { PageColor.reportTabIdentityColor(() => settings && settings.tabColor); } catch (_) {}

      // Segnali di attività (§2.1): ultima interazione, % di scroll, form sporco.
      // Servono all'LLM per decidere cosa archiviare.
      try { startTabActivityReporter(); } catch (_) {}
    }

    // Esc esce dalla modalità "contenuto a tutto schermo" (vedi tabs.js). Va
    // registrato anche su pagine "bloccate" (senza menu) e in capture, così
    // pre-empta gli handler Escape della pagina solo quando la modalità è attiva.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && contentFullscreen) {
        e.preventDefault();
        e.stopPropagation();
        contentFullscreen = false; // evita ripetizioni mentre il main esce
        chrome.runtime.sendMessage({ type: MSG.EXIT_FULLSCREEN }).catch(() => {});
      }
    }, { capture: true });

    // Ctrl/Cmd+Z → torna alla pagina precedente (feedback #267). Ecceziona un
    // solo caso, ma cruciale: dentro un campo di testo (input/textarea/
    // contenteditable) Ctrl+Z resta "annulla", il significato universale — così
    // scrivere non perde mai l'undo. Shift esclusa (Shift+Ctrl+Z = ripeti), Alt
    // esclusa. Registrato in capture e ANCHE su pagine "bloccate": tornare
    // indietro è una funzione di navigazione del browser, non una feature di
    // Filo, quindi deve valere ovunque si navighi. Riusa lo stesso comando della
    // freccia "Indietro" della barra e del menu (MSG.NAV_BACK): se non c'è una
    // pagina precedente nella cronologia della scheda, il main è un no-op.
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

    // window + capture: fase più precoce possibile, così intercettiamo il
    // contextmenu prima di eventuali handler della pagina ospite (alcune pagine
    // — es. iframe artifact di claude.ai — gestiscono il tasto destro su certi
    // SVG e lasciavano comparire il menu nativo del browser; feedback alpha).
    //
    // Su pagine web esterne il page-preload ha già registrato a document_start
    // un listener window+capture (PRIMA di ogni script di pagina): gli passiamo
    // il nostro handler così siamo i primi a ricevere l'evento anche sui siti che
    // bloccano il contextmenu con stopImmediatePropagation (YouTube, Reddit…).
    // Sulle pagine filo:// (nessun preload-bridge) registriamo in BUBBLE, non
    // in capture: le pagine interne sono NOSTRE e alcune hanno un menu
    // contestuale proprio (chip dell'archivio, card dei mazzi) attaccato agli
    // elementi. In capture + stopPropagation il nostro handler li soffocava
    // (il tasto destro sulle pagine interne apriva solo il menu di Filo). In
    // bubble l'handler della pagina scatta per primo: se ha già gestito il
    // click (e.preventDefault()), il menu di Filo si fa da parte.
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

    // Marker DOM per i test: `filoReady` (impostato dal preload) segnala solo che
    // i moduli sono CARICATI, ma init() è async e setta quel flag PRIMA di
    // risolvere `await fetchSettings()` — cioè prima di SpellCheck.init() e del
    // listener `_spell:native`. Un test che inietta un broadcast nativo appena
    // visto `filoReady` poteva quindi farlo cadere nel vuoto (listener non ancora
    // registrato), rendendo flaky il menu di correzione. Questo flag segnala che
    // i listener (spellcheck incluso) sono attivi: i test lo aspettano prima di
    // simulare il click destro. Innocuo a runtime (solo un dataset).
    try { document.documentElement.dataset.filoContentReady = '1'; } catch (_) {}
  }

  // Il campionatore colore tab + colore identità sito vivono in
  // src/content/pageColor.js (SN_PAGE_COLOR), caricato prima di questo file.

  // ------------------------------------------------------------
  // Segnali di attività della tab (spec §2.1)
  // ------------------------------------------------------------
  // Riporta al main: quando l'utente ha interagito l'ultima volta, quanto ha
  // scrollato (0-100%) e se ha "sporcato" un form (input non ancora inviato).
  // Throttled per non inondare l'IPC.
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

    // Interazione "vera": pointer/keyboard → aggiorna lastInteractionAt (throttle 2s).
    function onInteract() {
      const since = performance.now() - lastSend;
      if (since < 2000) return;
      send({});
    }

    // Scroll: aggiorna % (throttle ~500ms) e conta come interazione.
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

    // Form "sporco": primo input/change su un campo editabile. Si manda una volta.
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

    // Primo campione dello scroll iniziale (alcune pagine aprono già scrollate).
    setTimeout(() => send({ scrollPct: Math.round(scrollPct()) }), 600);
  }

  function isBlocked() {
    const url = location.href;
    // #405 — dentro un riquadro incorporato "about:blank" e "about:srcdoc" NON
    // sono pagine di sistema: sono contenuto scritto dalla pagina che ospita il
    // riquadro (moduli, anteprime, blocchi commenti). Lì il menu deve esserci
    // come ovunque; l'esclusione vale per le pagine di sistema vere.
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

  // Override dei token estetici (#146.1): le superfici Filo iniettate nella
  // pagina (menu, popup, sidebar) usano le variabili --sn-* di theme.css; qui
  // emettiamo le variabili sovrascritte dall'utente. Idempotente (upsert per
  // id), quindi innocuo anche sulle pagine filo:// dove pageBootstrap fa già
  // lo stesso lavoro.
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
  function realTarget(e) {
    return (typeof e?.composedPath === 'function' && e.composedPath()[0]) || e?.target || null;
  }

  // `closest()` si ferma al confine del componente: da dentro uno shadow root
  // NON vede gli antenati in chiaro. Sui siti moderni la copertina di una scheda
  // è quasi sempre un componente web (`<video>` dentro lo shadow root) infilato
  // dentro l'`<a>` della scheda: `realTarget` ci porta al filmato vero, ma poi
  // `target.closest('a[href]')` risaliva fino alla radice del componente e
  // tornava null — il collegamento spariva dal menu (#444). Questa versione,
  // quando la risalita finisce dentro uno shadow root, riparte dal suo host, e
  // così via per quanti componenti siano annidati.
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

  // `document.elementsFromPoint()` si ferma al confine del componente esattamente
  // come `closest()`, ma dall'altra parte: di un componente web restituisce
  // l'HOST, mai quello che c'è dentro. Quindi la ricerca "cosa c'è sotto il
  // cursore" era cieca a una scheda che tiene collegamento e anteprima IMPILATI
  // dentro lo stesso componente — il caso resta quello della lamentela: solo le
  // voci del filmato, nessuna voce del collegamento (#444). Qui, per ogni
  // elemento che ha uno shadow root, ripetiamo il colpo dentro quel root: le
  // parti del componente vengono PRIMA del loro host, che è l'ordine in cui si
  // vedono (l'host lo disegna il suo contenuto). Il set `seen` chiude i cicli e
  // toglie i doppioni fra un root e l'altro.
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

  // ------------------------------------------------------------
  // Handler contextmenu
  // ------------------------------------------------------------
  async function onContextMenu(e) {
    // Se l'utente tiene Shift premuto, lascia passare il menu nativo (escape hatch)
    if (e.shiftKey) return;

    // Impedisci alla pagina ospite (es. YouTube, Reddit) di gestire l'evento e
    // mostrare il SUO menu: il nostro listener è registrato per primo (vedi sotto
    // / page-preload bridge a document_start), quindi stopPropagation interrompe
    // la discesa in cattura verso document e gli elementi — dove i siti mettono
    // quasi sempre il loro handler `contextmenu` — prima che scatti.
    //
    // PERCHÉ stopPropagation e NON stopImmediatePropagation: sulle pagine web il
    // listener vive nel bridge del page-preload, registrato a document_start (per
    // battere in ordine gli handler della pagina, che altrimenti vincevano —
    // feedback alpha «tasto destro non funziona su YouTube»). Ma a quel timing
    // stopImmediatePropagation sopprime anche l'evento `context-menu` del
    // webContents che Chromium emette nel main (quello che porta `misspelledWord`
    // + `dictionarySuggestions` del correttore nativo); stopPropagation invece lo
    // lascia scattare. Usando stopPropagation manteniamo aperto il canale dei
    // suggerimenti nativi e blocchiamo comunque gli handler di pagina su
    // document/elementi (il caso comune).
    //
    // NB: NON chiamiamo nemmeno e.preventDefault(). In Electron il menu nativo non
    // appare comunque da solo (è l'app a costruirlo), e preventDefault chiuderebbe
    // lo stesso canale `context-menu` del webContents.
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
        // Su `<input>` testuali (non "supportati" dal nostro overlay): la
        // parola sotto il cursore va comunque corretta. La vecchia estensione
        // mostrava il suggerimento in cima e la nuova app no, perché si
        // affidava ai SOLI suggerimenti nativi di Electron (che non sempre
        // arrivano — dipende dal dizionario della lingua attiva). Ora, come per
        // textarea/contenteditable, estraiamo la parola e chiediamo la
        // correzione all'LLM (affidabile a prescindere dal dizionario nativo),
        // tenendo i suggerimenti nativi come base immediata quando ci sono.
        const inputEl = rt?.closest?.('input');
        if (inputEl && isTextLikeInput(inputEl)) {
          const wordCtx = SpellCheck.getInputWordAt?.(inputEl, e.clientX, e.clientY);
          if (wordCtx && !SpellCheck.isInDictionary(wordCtx.word)) {
            await openSpellWordMenu(inputEl, wordCtx, e);
            return;
          }
          // Nessuna parola sotto il cursore (es. click su area vuota): menu
          // normale, che riserva comunque lo slot per il nativo se arriva.
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
    // Rispetta la disabilitazione esplicita.
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
      linkEl, imgEl, mediaEl, mediaUnder, imgUnder, linkUnder, editable,
    } = detectContext(target, e.clientX, e.clientY);
    if (editable) capturePasteContext(target);
    else pasteContext = null;
    const [clipboardHistory, navState] = await Promise.all([
      Actions.getClipboardHistory(),
      Actions.getNavState(),
    ]);
    const items = buildMenuItems({
      selInfo, linkEl, imgEl, mediaEl, mediaUnder, imgUnder, linkUnder, editable, clipboardHistory, navState,
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

  // Applica un suggerimento del correttore di sistema al campo in cui si stava
  // scrivendo, senza doverlo identificare nella pagina — è il caso dei blocchi
  // "sigillati" (#438), dove il campo non è raggiungibile da nessuna API.
  //
  // Quando il correttore di sistema segna una parola sotto al cursore, il
  // browser la SELEZIONA: sostituire la selezione è quindi sostituire quella
  // parola, ovunque viva. Verifichiamo che la selezione sia ancora esattamente
  // quella parola prima di scrivere, altrimenti scriveremmo il suggerimento nel
  // punto sbagliato. Se la verifica non passa (selezione persa o cambiata),
  // ripieghiamo sull'API di Electron, che lavora sui segni del correttore.
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

  // Video/audio sotto il cursore (#400).
  // - `mediaEl`: il click è ARRIVATO sul media (o su un suo discendente) — è il
  //   contesto principale, vince su immagine e link.
  // - `mediaUnder`: nessun media nel cammino degli antenati, ma ce n'è uno sotto
  //   al punto cliccato. Succede su quasi tutti i player veri, che coprono il
  //   filmato con overlay di controllo: il tasto destro arriva all'overlay e il
  //   <video> non compare fra gli antenati. Lo usiamo come ripiego SOLO quando
  //   non c'è altro contesto (niente selezione, immagine, link, campo di testo),
  //   così un video di sfondo non ruba il menu a ciò che sta sopra.
  function findMedia(target, stack) {
    const direct = (target?.tagName === 'VIDEO' || target?.tagName === 'AUDIO')
      ? target
      : closestAcrossShadow(target, 'video, audio');
    if (direct) return { mediaEl: direct, mediaUnder: null };
    let under = null;
    for (const el of stack) {
      if (el.tagName !== 'VIDEO' && el.tagName !== 'AUDIO') continue;
      if (!sameSurface(target, el)) continue;
      under = el;
      break;
    }
    return { mediaEl: null, mediaUnder: under };
  }

  // Immagine e collegamento SOTTO il punto cliccato, quando non ce n'è uno fra
  // gli antenati (#444). Sono i gemelli di `mediaUnder`, e devono esistere tutti
  // e tre: le schede delle home video/social sono fatte di strati sovrapposti,
  // non annidati. L'anteprima si stende SOPRA la copertina, il link della scheda
  // passa sotto a entrambe, e sopra a tutto c'è spesso un velo trasparente che
  // non è né link né immagine né filmato. Senza il ripiego per OGNI famiglia lo
  // stesso identico pixel dà menu diversi a seconda di quale strato ha vinto in
  // quell'istante — con l'anteprima in funzione il menu era completo, e con
  // l'anteprima ferma restava vuoto.
  function findUnder(stack, selector, anchor) {
    for (const el of stack) {
      const hit = closestAcrossShadow(el, selector);
      if (hit && sameSurface(anchor, hit)) return hit;
    }
    return null;
  }

  // Il freno di TUTTO ciò che si adotta da sotto.
  //
  // Guardare sotto al punto cliccato serve (le schede sono fatte di strati:
  // copertina, anteprima, velo col titolo, e il collegamento sotto a tutto), ma
  // quello che sta sotto lo si adotta solo quando è la stessa cosa che l'utente
  // sta GUARDANDO. Altrimenti basta un elemento opaco davanti perché il menu
  // parli di un collegamento invisibile: la barra fissa di un sito di notizie
  // sotto cui sono scivolati i titoli, il riquadro dei cookie, o un manto che la
  // pagina stende su tutta se stessa sotto al testo — e lì il collegamento lo
  // sceglie la pagina, quindi «Copia URL», «Apri in nuova tab» e «Condividi»
  // finirebbero su un indirizzo deciso da lei, con in più l'analisi del link che
  // parte da sola e va a scaricarlo.
  //
  // Due condizioni, entrambe misurate sui rettangoli:
  // 1. si sovrappongono davvero — l'intersezione copre almeno metà del più
  //    piccolo dei due (un incrocio d'angolo fra una barra laterale e una riga
  //    di testo non è una sovrapposizione);
  // 2. nessuno dei due INGHIOTTE l'altro: non basta circondarlo da tutte le
  //    parti, deve anche stare su un'altra scala. La differenza è quella fra un
  //    contenitore e una copertura. La scheda con un bordo, o con l'imbottitura
  //    fra il bordo e la copertina, circonda la copertina da tutti e quattro i
  //    lati — ed è la forma più comune degli elenchi di schede: fermarsi al
  //    "circonda" faceva sparire di nuovo le voci del collegamento su mezzo web
  //    (#444). Un contenitore però ABBRACCIA quello che tiene: la copertina
  //    riempie quasi tutta la scheda. Una barra fissa, un riquadro dei cookie o
  //    un manto steso sulla pagina sono grandi come la finestra e coprono un
  //    titolo di poche parole: quello che nascondono è una frazione minima di
  //    loro, ed è il segno che non lo stanno contenendo, se lo stanno solo
  //    trovando sotto.
  const SURFACE_SLACK_PX = 4;
  // Quanta parte del più grande deve occupare il più piccolo perché il primo
  // sia il suo contenitore e non una copertura. Le misure vere stanno lontane
  // dalla soglia da tutte e due le parti: la copertina rientrata di dodici
  // pixel in una scheda ne occupa l'85%, e una scheda che tiene dentro anche il
  // titolo resta sopra alla metà; una barra fissa a tutta larghezza sopra una
  // riga di titoli sta sotto al 5%, il manto invisibile sopra un paragrafo al 3%.
  const CONTAINER_MIN_RATIO = 0.35;

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

  // ------------------------------------------------------------
  // La seconda prova: quello che sta sotto lo si VEDE.
  //
  // Il conto sui rettangoli sa dire "stessa scala, stessa scheda", ma sulla
  // FORMA non sa dire niente, e ci sono due cose opposte con la stessa forma.
  // La riga di un elenco di risultati — miniatura piccola a sinistra, titolo e
  // tre righe di testo a destra, il collegamento della riga steso sopra a
  // tutto — ha lo stesso ingombro di una barra fissa sopra un titolo scivolato
  // sotto: un rettangolo largo quanto la pagina che ne circonda uno piccolo.
  // Nessuna soglia di area separa i due casi, e infatti il freno geometrico
  // buttava via i comandi del filmato proprio sulle miniature vere (#444):
  // sotto a circa un terzo di riga sparivano tutti, e la stessa riga costruita
  // con la miniatura dentro un collegamento suo dava invece il menu completo.
  //
  // Quello che separa i due casi è se l'utente li vede: sopra la miniatura c'è
  // un collegamento invisibile, sopra il titolo sepolto c'è una barra opaca.
  // Quindi: se fra il punto cliccato e il candidato non c'è niente di DIPINTO,
  // il candidato è esattamente quello che l'utente sta guardando, e a quel
  // punto la geometria non ha più niente da aggiungere.
  // ------------------------------------------------------------

  // Elementi che si disegnano da soli, senza bisogno di sfondo o di testo.
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

  // Un contenuto "appartiene" a un collegamento quando ci sta dentro (nel DOM) o
  // quando ne occupa la superficie (i player veri coprono il filmato col proprio
  // overlay, e le schede impilano copertina e link invece di annidarli). Il DOM
  // viene prima: se la pagina dice già che copertina e collegamento sono la
  // stessa scheda, rifare il conto sui rettangoli può solo buttare via
  // un'informazione certa (#444).
  function belongsTo(el, linkEl) {
    if (!el || !linkEl) return false;
    return containsAcrossShadow(linkEl, el) || sameSurface(el, linkEl);
  }

  function sameSurface(a, b) {
    if (!a || !b) return false;
    const ra = a.getBoundingClientRect?.();
    const rb = b.getBoundingClientRect?.();
    if (!ra || !rb) return false;
    const areaA = ra.width * ra.height;
    const areaB = rb.width * rb.height;
    if (!(areaA > 0) || !(areaB > 0)) return false;
    const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
    const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (w <= 0 || h <= 0) return false;
    if ((w * h) * 2 < Math.min(areaA, areaB)) return false;
    return !swallows(ra, rb) && !swallows(rb, ra);
  }

  // Cosa c'è sotto il tasto destro. Sta in un posto solo perché il menu si apre
  // da due strade (menu normale e menu di correzione): quando il riconoscimento
  // era copiato in tutt'e due, lo stesso clic rischiava di dare due menu diversi
  // a seconda che sotto ci fosse o no una parola da correggere.
  function detectContext(target, x, y) {
    const linkEl = closestAcrossShadow(target, 'a[href]');
    const imgEl = target?.tagName === 'IMG' ? target : closestAcrossShadow(target, 'img');
    // Un solo colpo di hit-test per tutte e tre le famiglie: è la stessa pila di
    // strati, e ripeterlo tre volte costerebbe tre risalite dell'albero a ogni
    // apertura del menu.
    const stack = deepElementsFromPoint(x, y);
    const { mediaEl, mediaUnder } = findMedia(target, stack);
    // Cercati solo se non sono già fra gli antenati.
    const imgUnder = imgEl ? null : findUnder(stack, 'img', target);
    return {
      linkEl,
      imgEl,
      mediaEl,
      // I tre `*Under` escono da qui GIÀ VAGLIATI: o `sameSurface` li ha
      // confrontati con l'elemento davvero cliccato, o è il DOM a legarli alla
      // copertina adottata. Chi legge questi campi più a valle non deve rifare
      // il controllo (né può dimenticarselo — è così che la barra fissa e il
      // manto invisibile erano finiti nel menu).
      mediaUnder,
      imgUnder,
      // Il collegamento lo può dire il DOM (la copertina adottata sta dentro un
      // <a>) prima ancora della pila di strati.
      linkUnder: linkEl ? null : findLinkUnder(stack, target, mediaUnder || imgUnder),
      editable: isEditable(target),
    };
  }

  // Il collegamento della scheda, quando non è fra gli antenati del punto
  // cliccato. Due strade, e la prima è il DOM (#444): se abbiamo già adottato la
  // copertina — il filmato o l'immagine che l'utente sta guardando — e quella
  // copertina sta DENTRO un <a>, la pagina ha già detto che sono la stessa
  // scheda. Rifare il conto sui rettangoli lì non aggiunge niente e toglie: fra
  // il collegamento e la copertina ci sono il bordo, l'imbottitura, e spesso il
  // titolo, quindi la geometria da sola diceva di no proprio dove la struttura
  // diceva di sì. Solo quando il DOM non lega niente si guarda la pila di strati
  // sotto il cursore, e lì il freno geometrico è l'unica cosa che regge.
  function findLinkUnder(stack, target, contentUnder) {
    const owner = contentUnder ? closestAcrossShadow(contentUnder, 'a[href]') : null;
    return owner || findUnder(stack, 'a[href]', target);
  }

  function isEditable(el) {
    if (!el) return false;
    if (el.matches?.('input, textarea')) {
      const t = (el.getAttribute('type') || '').toLowerCase();
      // input non testuali (button, checkbox, ecc) non sono editabili nel senso che ci interessa
      const nonText = ['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'color', 'range'];
      if (el.tagName === 'INPUT' && nonText.includes(t)) return false;
      return !el.disabled && !el.readOnly;
    }
    return !!el.closest?.('[contenteditable=""], [contenteditable="true"]');
  }

  // ------------------------------------------------------------
  // Menu correzione: rosso (parola sotto cursore) e blu (errore contestuale).
  // Stesso layout: menu normale (back/forward/copia/…) con in alto un item
  // "correzione" cliccabile e freccetta che apre un sotto-menu di azioni.
  // ------------------------------------------------------------

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

  // Helper: costruisce gli item del menu normale per un determinato evento mouse.
  async function buildBaseItemsAt(mouseEvent) {
    const target = realTarget(mouseEvent);
    let selInfo = Extract.getSelectionWithSentence(target);
    if (!selInfo) selInfo = getInputSelectionInfo(target);
    const {
      linkEl, imgEl, mediaEl, mediaUnder, imgUnder, linkUnder, editable,
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
      selInfo, linkEl, imgEl, mediaEl, mediaUnder, imgUnder, linkUnder, editable, clipboardHistory, navState,
    });
  }

  // Sub-menu per una correzione "rosso" (parola): aggiungi al dizionario,
  // correggi automaticamente, gestisci correttore.
  function buildRedSubItems(editableEl, wordCtx, correction, altSuggestions = []) {
    const items = [];
    // Suggerimenti alternativi (dal correttore nativo): righe "applica" sopra le
    // azioni di gestione. Saltiamo quello già mostrato come correzione primaria.
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

  // Sub-menu per una correzione "blu" (errore contestuale): mostra la spiegazione
  // dell'errore come riga informativa, poi link a "Gestisci correttore".
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

  // Click destro su parola in editabile (errore "rosso", non coperta da issue blu).
  //
  // Regole (feedback alpha):
  // - Non mostriamo MAI il flash "Cerco una correzione…": la riga compare solo se
  //   sappiamo che la parola è davvero sbagliata.
  // - Se la cache locale ha già marcato la parola come errata, mostriamo subito
  //   la correzione cached (anche quando il contesto è cambiato).
  // - Se il contesto è cambiato dal calcolo originale, rilanciamo la richiesta in
  //   background e aggiorniamo la riga quando arriva (eventualmente sostituendo
  //   la correzione visibile).
  // - Se non c'è cache, riserviamo uno slot nascosto e firiamo la richiesta in
  //   background: lo slot si rivela SOLO se la risposta dice misspelled=true.
  //   Niente cache ≈ niente prefetch coperto la parola (testo pre-esistente o
  //   editor che non emette input event attesi): garantisce che il suggerimento
  //   appaia comunque entro la latenza dell'LLM.
  // La logica di prefetch proattivo (al completamento di una parola durante la
  // digitazione e dopo gli scan blu) sta in spellcheck.js — qui ci limitiamo a
  // consumare la cache e a coprire i casi non prefetchati.
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

    // Suggerimenti del correttore NATIVO (Electron) per questa parola: immediati
    // e affidabili (sono quelli dietro lo zigzag rosso). Il main li spinge al
    // click destro; di solito sono già in cache quando il menu si compone (c'è il
    // round-trip della clipboard history prima), altrimenti li riveliamo appena
    // arrivano. Sono la base che garantisce "qualcosa appare" anche senza LLM.
    const nativeSugg = (SpellCheck.getNativeSuggestions?.(wordCtx.word)) || [];
    const nativeTop = nativeSugg[0] || '';

    const applyAt = (corr) => SpellCheck.applyFix(
      editableEl, { start: wordCtx.start, end: wordCtx.end }, corr, { expectedSegment: wordCtx.word },
    );

    // Correzione mostrata inizialmente: la cache LLM se usabile, altrimenti il
    // primo suggerimento nativo. `shown` traccia se una riga è visibile.
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
      // Slot riservato, ma invisibile finché non sappiamo se la parola è errata.
      // Lo riserviamo SEMPRE (non solo quando rilanciamo l'LLM): il correttore
      // nativo può marcare la parola — e quindi avere suggerimenti — anche
      // quando la cache LLM dice "non errata" o quando il broadcast `_spell:native`
      // arriva con qualche ms di ritardo dopo l'apertura del menu. Senza uno slot
      // montato, onNativeSuggestions non avrebbe dove rivelare la correzione e il
      // suggerimento (es. "ciiao" → "ciao", quello dietro lo zigzag rosso) non
      // comparirebbe mai — proprio il sintomo del feedback.
      items.unshift(
        buildCorrectionItem('', null, [], /* hidden */ true),
        { type: 'separator', hidden: true },
      );
    }

    Menu.open({ x: mouseEvent.clientX, y: mouseEvent.clientY, items, keepOnScroll: true });

    // Rivela/aggiorna la riga di correzione con `corr` (e relative alternative).
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

    // Se i suggerimenti nativi non erano ancora arrivati al momento dell'apertura,
    // rivela appena arrivano (a meno che non si stia già mostrando qualcosa).
    if (!shown) {
      SpellCheck.onNativeSuggestions?.(wordCtx.word, (sugg) => {
        if (shown || !sugg?.length) return;
        revealCorrection(sugg[0], sugg);
      });
    }

    // Helper: applica la risposta dell'LLM. Quando l'LLM declina ma esiste un
    // suggerimento nativo, manteniamo comunque quest'ultimo visibile.
    const applyResponse = (res) => {
      // Cache SOLO un verdetto definitivo dell'LLM. Se `res` è null la chiamata è
      // FALLITA (nessuna chiave/errore provider, parse fallito): NON va cachata
      // come "non errata", altrimenti il prossimo click destro sulla stessa parola
      // non rilancerebbe più nulla e — peggio — soffocherebbe il suggerimento
      // nativo. È esattamente lo scenario del feedback: senza chiave LLM la parola
      // resta segnata in rosso dal nativo ma il menu non mostrava più la correzione.
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
          // Il correttore nativo ha comunque marcato la parola: mostra il nativo.
          if (!shown || visibleCorrection !== freshTop) revealCorrection(freshTop, freshNative);
        } else if (shown) {
          updateCorrection({ remove: true });
        } else {
          updateCorrection({ hidden: true });
        }
        return;
      }
      // Correzione LLM (contestuale): preferiscila, mantenendo i nativi come alternative.
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

    // Etichetta della riga: la correzione, se c'è; altrimenti una sintesi della spiegazione.
    // Per le ripetizioni (correction === '') etichettiamo con un'azione esplicita.
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

  // ------------------------------------------------------------
  // Composizione del menu (nuova struttura: globale + Aiuto + contestuale + Feedback)
  // ------------------------------------------------------------
  // Ordine verticale: riga icone globali → Aiuto → zona contestuale → Feedback.
  // La riga globale è stabile (ancora), la zona contestuale varia in base al click.
  function buildMenuItems({
    selInfo, linkEl, imgEl, mediaEl, mediaUnder, imgUnder, linkUnder, editable, clipboardHistory, navState,
  }) {
    const items = [];

    // 1. Riga icone globali (max 5 + overflow). Tutte mute, etichetta in tooltip.
    // Registro, layout persistente e drag-and-drop vivono in
    // src/content/menuIcons.js (SN_MENU_ICONS), caricato prima di questo file.
    items.push(MenuIcons.buildGlobalIconRow(navState));

    // 2. Aiuto — voce sempre presente, etichettata.
    items.push({ type: 'separator' });
    items.push(buildHelpItem());

    // 2b. Interrompi lettura — presente in QUALSIASI menu mentre la sintesi
    // vocale è in riproduzione, anche senza selezione/contesto, così la
    // lettura si può sempre fermare da dove si è (richiesta alpha). isAnyReading
    // è true anche se a leggere è un'ALTRA scheda: lo stop chiede al main di
    // inoltrare l'arresto alla scheda che legge davvero.
    if (TTS.isAnyReading()) {
      items.push(TTS.buildStopReadingItem());
    }

    // 2c. Mostra originale — solo quando la traduzione di pagina si è interrotta
    // a metà (#408): in quello stato l'icona serve a RIPRENDERE, quindi il
    // ritorno all'originale deve restare raggiungibile da qualche parte.
    // A traduzione completa la voce non compare: la offre già l'icona.
    if (TranslatePage && typeof TranslatePage.isPartial === 'function' && TranslatePage.isPartial()) {
      items.push(TranslatePage.buildRestoreOriginalItem());
    }

    // 3. Zona contestuale — assente se non c'è contesto utile.
    const contextItems = buildContextualItems({
      selInfo, linkEl, imgEl, mediaEl, mediaUnder, imgUnder, linkUnder, editable, clipboardHistory,
    });
    if (contextItems.length > 0) {
      items.push({ type: 'separator' });
      for (const it of contextItems) items.push(it);
    }

    // 4. Feedback (alpha) + Red-team (invia attacco)
    items.push({ type: 'separator' });
    items.push(buildFeedbackItem());
    items.push(buildRedteamAttackItem());

    return items;
  }

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

  function buildHelpItem() {
    return {
      type: 'item',
      label: I18n.t('menu_help'),
      shortcut: 'Alt+H',
      onClick: () => openSurface('help', () => openHelpSidebar()),
    };
  }

  // Azioni sull'immagine (senza la sezione "Spiega": la compone il chiamante,
  // così quando l'immagine è anche un link non firiamo due box AI a ogni apertura).
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

  // Azioni sul collegamento (senza la sezione "Spiega", come sopra).
  function buildLinkActionItems(linkEl) {
    const out = [
      {
        type: 'item',
        label: I18n.t('menu_open_in_new_tab'),
        onClick: () => window.open(linkEl.href, '_blank', 'noopener'),
      },
    ];
    // "Salva file" — gemello di "Salva immagine come" per i link a un file
    // (PDF, ZIP, allegato). Compare SOLO quando il link punta davvero a un
    // file (vedi isDownloadableLink): su un link a un'altra pagina scaricare
    // l'HTML non avrebbe senso.
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
    selInfo, linkEl, imgEl, mediaEl, mediaUnder, imgUnder, linkUnder, editable, clipboardHistory,
  }) {
    const items = [];

    if (selInfo && editable) {
      // Testo selezionato dentro casella di input
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
      // Testo selezionato nella pagina (non editabile)
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
      // …ma se il media è racchiuso in un <a> (copertina di un video in una
      // lista, anteprima di un articolo) è ANCHE un collegamento, ed è proprio
      // il caso in cui l'utente vuole spesso il link e non il filmato: senza
      // queste voci non avrebbe nessun modo di aprirlo, copiarlo o salvarlo
      // (#434). Stessa forma del ramo immagine: contenuto in cima, separatore,
      // collegamento sotto.
      //
      // Il collegamento non è sempre un antenato: nelle home dei siti video e
      // dei social l'anteprima che parte al passaggio del mouse si STENDE SOPRA
      // la scheda, e il link della scheda resta sotto (#444). Per chi guarda è
      // la stessa identica scheda, ed è `linkUnder` — che arriva qui solo se
      // occupa la stessa superficie del filmato cliccato.
      const link = linkEl || linkUnder;
      if (link) {
        items.push({ type: 'separator' });
        for (const it of buildLinkActionItems(link)) items.push(it);
        items.push({ type: 'separator' });
        // Il media non ha una sua sezione "Spiega": quella del collegamento è
        // l'unica, quindi resta (nessuna seconda chiamata AI, e il menu del
        // link è completo come quando lo si clicca da solo).
        items.push(Actions.buildInlineExplainLink(link));
      }
      return items;
    }

    if (imgEl) {
      // Immagine cliccata. Le sue azioni vengono prima…
      for (const it of buildImageActionItems(imgEl)) items.push(it);
      // …ma se l'immagine è racchiusa in un <a> (miniature di articoli, schede
      // prodotto, risultati di ricerca per immagini) è ANCHE un collegamento:
      // in un browser normale le due famiglie di voci compaiono insieme. Prima
      // il ramo immagine ritornava subito e le azioni sul link sparivano (#401).
      // Come per il filmato (#444), la copertina può anche essere STESA SOPRA il
      // link della scheda invece che stargli dentro: se occupa la stessa
      // superficie è la stessa scheda, e le voci del collegamento restano.
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
      // Copertina di un video dentro un link con il player che copre il filmato
      // col suo overlay: il clic destro arriva all'overlay, quindi il <video>
      // non è fra gli antenati e finisce in `mediaUnder`. Per chi guarda è lo
      // stesso identico filmato dentro lo stesso identico link: il menu deve
      // essere lo stesso del ramo qui sopra, overlay o non overlay. Solo se il
      // filmato è DAVVERO quello della scheda, però: dentro il collegamento
      // oppure a occuparne la superficie. Un video di sfondo che si ritrova per
      // caso un link sopra non deve intrufolarsi nel menu di quel link.
      const mediaInLink = belongsTo(mediaUnder, linkEl) ? mediaUnder : null;
      if (mediaInLink) {
        for (const it of Actions.buildMediaItems(mediaInLink)) items.push(it);
        items.push({ type: 'separator' });
      }
      // Stessa storia per la copertina ferma: le schede la coprono quasi sempre
      // con una sfumatura o un velo trasparente che regge il titolo, e il clic
      // destro arriva lì invece che sull'`<img>`. Se non c'è un filmato in
      // funzione, il contenuto della scheda è quell'immagine: le sue voci sono
      // quelle che l'utente cerca (#444).
      const imgInLink = (!mediaInLink && belongsTo(imgUnder, linkEl)) ? imgUnder : null;
      if (imgInLink) {
        for (const it of buildImageActionItems(imgInLink)) items.push(it);
        items.push({ type: 'separator' });
      }
      for (const it of buildLinkActionItems(linkEl)) items.push(it);
      items.push({ type: 'separator' });
      items.push(Actions.buildInlineExplainLink(linkEl));
      return items;
    }

    if (editable) {
      // Casella input senza selezione: incolla + detta.
      items.push(Actions.buildPasteItem(clipboardHistory));
      items.push(TTS.buildDictateItem());
      return items;
    }

    // Nessun altro contesto, ma sotto al punto cliccato c'è un filmato coperto
    // dall'overlay del player: sono comunque le sue azioni che l'utente cerca.
    if (mediaUnder) {
      for (const it of Actions.buildMediaItems(mediaUnder)) items.push(it);
      // Scheda a strati: sopra un velo trasparente che non è né link né media,
      // sotto il filmato e il link della scheda (#444). Qui sono due cose prese
      // entrambe da sotto: oltre al velo devono stare insieme anche fra loro —
      // il filmato dentro il collegamento, o sulla sua stessa superficie —
      // altrimenti il menu unirebbe due schede diverse.
      if (belongsTo(mediaUnder, linkUnder)) {
        items.push({ type: 'separator' });
        for (const it of buildLinkActionItems(linkUnder)) items.push(it);
        items.push({ type: 'separator' });
        items.push(Actions.buildInlineExplainLink(linkUnder));
      }
      return items;
    }

    // Stessa scheda, anteprima ferma. Il velo trasparente c'è ancora, ma sotto
    // non c'è più un filmato: c'è la copertina, e sotto di lei il collegamento.
    // Senza questo ramo lo stesso identico pixel dava due esiti opposti — menu
    // completo mentre il filmatino suonava, menu vuoto un istante dopo (#444).
    if (imgUnder) {
      for (const it of buildImageActionItems(imgUnder)) items.push(it);
      if (belongsTo(imgUnder, linkUnder)) {
        items.push({ type: 'separator' });
        for (const it of buildLinkActionItems(linkUnder)) items.push(it);
      }
      items.push({ type: 'separator' });
      items.push(Actions.buildInlineExplainImage(imgUnder));
      return items;
    }

    // E il collegamento da solo: un velo trasparente sopra una scheda-link basta
    // a far sparire «Apri in nuova tab», «Copia URL», «Salva link per dopo» e
    // «Condividi link». Non è un caso di nicchia — è come sono costruiti quasi
    // tutti gli elenchi di schede, con o senza filmato (#444). Un velo, appunto:
    // se davanti c'è una barra fissa, un riquadro modale o un manto steso sulla
    // pagina, `linkUnder` è già stato scartato e qui non arriva niente.
    if (linkUnder) {
      for (const it of buildLinkActionItems(linkUnder)) items.push(it);
      items.push({ type: 'separator' });
      items.push(Actions.buildInlineExplainLink(linkUnder));
      return items;
    }

    // Pagina generica senza contesto: nessuna zona contestuale.
    return items;
  }


  // ------------------------------------------------------------
  // Tracking ultimo evento mouse per posizionare popup
  // ------------------------------------------------------------
  let lastMouseEvent = { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 };
  document.addEventListener('mousedown', (e) => {
    lastMouseEvent = { clientX: e.clientX, clientY: e.clientY };
  }, true);

  // Le azioni (clipboard/incolla, screenshot pieno e a regione, trascrizione
  // OCR, salva/condividi/cerca, color picker, QR code, spiegazioni inline e
  // prefetch "Spiega") vivono in src/content/actions.js (SN_ACTIONS),
  // caricato prima di questo file. content.js gli inietta le dipendenze con
  // Actions.init() in testa al file.

  // La traduzione di pagina (e il suo stato) vive in
  // src/content/translatePage.js (SN_TRANSLATE_PAGE), caricato prima di questo file.

  // ------------------------------------------------------------
  // Sidebar Aiuto (Fase 2)
  // ------------------------------------------------------------
  function openHelpSidebar(context) {
    Sidebar.open(context);
  }

  // ------------------------------------------------------------
  // Messaggi runtime: shortcut, settings update
  // ------------------------------------------------------------
  function onRuntimeMessage(msg, sender, sendResponse) {
    if (msg?.type === MSG.FULLSCREEN_CHANGED) {
      contentFullscreen = !!msg.fullscreen;
      return;
    }
    // Toast di sistema inviato dal main (es. esito differito dell'invio di un
    // feedback, #341). Il broadcast arriva a TUTTE le schede: lo mostra solo
    // quella in primo piano, per non moltiplicare lo stesso avviso.
    // #405 — un riquadro incorporato della stessa scheda ha aperto il suo menu.
    // Gli eventi del mouse non attraversano il bordo di un riquadro, quindi il
    // nostro menu non si accorgerebbe del clic e resterebbero aperti in due.
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
    // Stato lettura ad alta voce condiviso tra le schede: aggiorna il flag
    // globale (per mostrare "Interrompi lettura" anche se legge un'altra scheda)
    // o ferma la lettura locale quando un'altra scheda chiede lo stop globale.
    if (msg?.type === MSG.TTS_GLOBAL_READING || msg?.type === MSG.TTS_STOP) {
      TTS.handleBroadcast(msg);
      return;
    }
    if (msg?.type === MSG.SETTINGS_UPDATED) {
      settings = msg.settings;
      applyTheme(settings.theme);
      applyThemeTokens(settings.themeTokens);
      // Colore identità delle tab: i parametri di estrazione possono essere
      // cambiati (a voce o nelle Preferenze). Ricalcola il colore del favicon
      // coi nuovi parametri così la tinta della tab si aggiorna live.
      if (!IS_SUBFRAME) { try { PageColor.reportTabIdentityColor(() => settings && settings.tabColor); } catch (_) {} }
      // SpellCheck.init registra listener globali; per non duplicarli su update
      // usiamo updateSettings (definito apposta da spellcheck.js).
      SpellCheck.updateSettings(isBlocked() ? { featureFlags: { spellcheck: false } } : settings);
      return;
    }
    if (msg?.type === MSG.SHORTCUT_TRIGGERED) {
      // Shortcut save-for-later: il SW chiede al content il payload.
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
    // save-for-later è gestito direttamente nel background
  }

  // La lettura ad alta voce e la dettatura (tutto l'audio del content script)
  // vivono in src/content/tts.js (SN_TTS), caricato prima di questo file.
  // content.js gli inietta le dipendenze con TTS.init() in testa al file.

  // Il box "Modifica" (preview + diff + conferma) vive in
  // src/content/editBox.js (SN_EDITBOX), caricato prima di questo file.

  // ------------------------------------------------------------
  init();
})();
