// Entry point content script. Intercetta contextmenu, costruisce le voci, gestisce shortcut.

(function () {
  'use strict';

  const { ACTIONS, PAGES_WITHOUT_MENU_PREFIXES, STORAGE_KEYS } = self.SN_CONST;
  const { MSG } = self.SN_MSG;
  const I18n = self.SN_I18N;
  const Menu = self.SN_MENU;
  const Popup = self.SN_POPUP;
  const Extract = self.SN_EXTRACT;
  const Sidebar = self.SN_SIDEBAR;
  const SpellCheck = self.SN_SPELLCHECK;
  const PageColor = self.SN_PAGE_COLOR;
  const Translate = self.SN_TRANSLATE_PAGE;
  const TTS = self.SN_TTS;
  const EditBox = self.SN_EDITBOX;
  const Actions = self.SN_ACTIONS;
  const MenuIcons = self.SN_MENU_ICONS;

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
    insertTextAtSelection: (text) => Actions.insertTextAtSelection(text),
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

  // ------------------------------------------------------------
  // Bootstrap
  // ------------------------------------------------------------
  async function init() {
    settings = await fetchSettings();
    applyTheme(settings.theme);

    // "Vetro smerigliato" della tab attiva (§1.1): campiona il colore della cima
    // della pagina e mandalo al main, che tinge la tab. Attivo su tutte le pagine
    // (anche quelle senza menu), perché il colore non c'entra col menu.
    try { PageColor.startTabColorSampler(); } catch (_) {}

    // Colore identità del sito (§1.2): calcolato una volta (theme-color →
    // manifest → favicon → fallback) e mandato al main, che lo cacha per dominio
    // e lo applica attenuato alle tab inattive.
    try { PageColor.reportTabIdentityColor(); } catch (_) {}

    // Segnali di attività (§2.1): ultima interazione, % di scroll, form sporco.
    // Servono all'LLM per decidere cosa archiviare.
    try { startTabActivityReporter(); } catch (_) {}

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

    if (isBlocked()) return;

    SpellCheck.init(settings);

    // window + capture: fase più precoce possibile, così intercettiamo il
    // contextmenu prima di eventuali handler della pagina ospite (alcune pagine
    // — es. iframe artifact di claude.ai — gestiscono il tasto destro su certi
    // SVG e lasciavano comparire il menu nativo del browser; feedback alpha).
    window.addEventListener('contextmenu', onContextMenu, { capture: true });
    // Prefetch "Spiega" appena l'utente seleziona del testo, così quando apre il
    // menu il risultato è già in cache. Debounce + dedup gestiti dallo scheduler.
    document.addEventListener('selectionchange', Actions.schedulePrefetchExplain);
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      onRuntimeMessage(msg, sender, sendResponse);
      return true; // mantieni il canale aperto per sendResponse asincrono
    });
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
    if (PAGES_WITHOUT_MENU_PREFIXES.some((p) => url.startsWith(p))) return true;
    const host = location.hostname;
    return (settings?.blocklist || []).some((d) => host === d || host.endsWith('.' + d));
  }

  async function fetchSettings() {
    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.GET_SETTINGS });
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

  // ------------------------------------------------------------
  // Handler contextmenu
  // ------------------------------------------------------------
  async function onContextMenu(e) {
    // Se l'utente tiene Shift premuto, lascia passare il menu nativo (escape hatch)
    if (e.shiftKey) return;

    // Impedisci ad altri listener sullo stesso target (es. YouTube, Reddit) di
    // gestire l'evento: stopImmediatePropagation blocca sia la propagazione sia
    // gli handler successivi su window stesso.
    //
    // NB: NON chiamiamo e.preventDefault() qui. In Electron il menu contestuale
    // nativo non viene MAI mostrato in automatico (è l'app a doverlo costruire e
    // fare popup: noi non lo facciamo, quindi non appare nulla di nativo). Ma
    // chiamare preventDefault sul DOM event impedisce a Chromium di inviare al
    // main process l'evento `context-menu` del webContents — quello che porta
    // `misspelledWord` + `dictionarySuggestions` del correttore nativo. Senza
    // quell'evento il suggerimento ortografico in cima al menu (che la vecchia
    // estensione mostrava sfruttando il menu nativo di Chrome) non arrivava mai
    // in produzione: i `_spell:native` partivano solo nei test che li iniettano
    // a mano. Lasciando passare il default action, l'evento del webContents
    // scatta, tabs.js inoltra i suggerimenti nativi e la correzione ricompare.
    e.stopImmediatePropagation();

    // Spellcheck: in un editabile supportato, prima cerchiamo un errore "blu"
    // (sincrono); altrimenti partiamo con la richiesta on-demand all'LLM per la
    // parola sotto il cursore (zigzag rosso del browser).
    try {
      if (settings?.featureFlags?.spellcheck !== false && SpellCheck) {
        const editableEl = SpellCheck.findSupportedEditable(e.target);
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
        const inputEl = e.target?.closest?.('input');
        if (inputEl && isTextLikeInput(inputEl)) {
          const wordCtx = SpellCheck.getInputWordAt?.(inputEl, e.clientX, e.clientY);
          if (wordCtx && !SpellCheck.isInDictionary(wordCtx.word)) {
            await openSpellWordMenu(inputEl, wordCtx, e);
            return;
          }
          // Nessuna parola sotto il cursore (es. click su area vuota): menu
          // normale, riservando comunque lo slot per il nativo se arriva.
          await openNormalMenuAt(e, { reserveInputCorrection: true });
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

  async function openNormalMenuAt(e, opts = {}) {
    // Timestamp del click destro: serve a onNextNativeSuggestion per decidere
    // se il broadcast `_spell:native` arrivato durante l'await sotto è già
    // pertinente a questa apertura del menu (altrimenti lo perdevamo).
    const openedAt = Date.now();
    const target = e.target;
    let selInfo = Extract.getSelectionWithSentence();
    // window.getSelection() non vede la selezione dentro <input>/<textarea>:
    // recuperiamola dal nodo stesso così Taglia/Copia compaiono nel menu.
    if (!selInfo) selInfo = getInputSelectionInfo(target);
    const linkEl = target?.closest?.('a[href]');
    const imgEl = target?.tagName === 'IMG' ? target : target?.closest?.('img');
    const editable = isEditable(target);
    if (editable) capturePasteContext(target);
    else pasteContext = null;
    const [clipboardHistory, navState] = await Promise.all([
      Actions.getClipboardHistory(),
      Actions.getNavState(),
    ]);
    const items = buildMenuItems({ selInfo, linkEl, imgEl, editable, clipboardHistory, navState });

    // Slot riservato per la correzione ortografica nativa nei <input>: nascosto
    // finché Electron non ci notifica via broadcast la parola misspelled e i
    // suggerimenti. Posizionato in cima al menu come voce principale.
    let revealInputCorrection = null;
    if (opts.reserveInputCorrection) {
      let updateCorrection = null;
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
      revealInputCorrection = (word, suggestions) => {
        const sugg = (suggestions || []).filter((s) => s && s !== word);
        if (!updateCorrection || !sugg.length) return;
        const top = sugg[0];
        const subItems = sugg.slice(1, 5).map((s) => ({
          label: s,
          onClick: () => chrome.runtime.sendMessage({ type: MSG.REPLACE_MISSPELLING, suggestion: s }),
        }));
        updateCorrection({
          hidden: false,
          label: top,
          loading: false,
          onClick: () => chrome.runtime.sendMessage({ type: MSG.REPLACE_MISSPELLING, suggestion: top }),
          subItems,
        });
      };
    }

    Menu.open({ x: e.clientX, y: e.clientY, items, keepOnScroll: !!selInfo });

    if (revealInputCorrection) {
      // Passa il timestamp di apertura: se il broadcast nativo è già arrivato
      // (vincoli di timing con l'await getClipboardHistory sopra), il modulo
      // spellcheck ce lo consegna subito invece di lasciarci aspettare.
      SpellCheck.onNextNativeSuggestion?.(({ word, suggestions }) => {
        if (!suggestions?.length) return;
        revealInputCorrection(word, suggestions);
      }, { since: openedAt });
    }
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
    const target = mouseEvent.target;
    let selInfo = Extract.getSelectionWithSentence();
    if (!selInfo) selInfo = getInputSelectionInfo(target);
    const linkEl = target?.closest?.('a[href]');
    const imgEl = target?.tagName === 'IMG' ? target : target?.closest?.('img');
    const editable = isEditable(target);
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
    return buildMenuItems({ selInfo, linkEl, imgEl, editable, clipboardHistory, navState });
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
      onClick: () => {
        try { self.SN_FEEDBACK_UI?.open(); } catch (e) { console.error('[SN] feedback open', e); }
      },
    };
  }

  // ------------------------------------------------------------
  // Composizione del menu (nuova struttura: globale + Aiuto + contestuale + Feedback)
  // ------------------------------------------------------------
  // Ordine verticale: riga icone globali → Aiuto → zona contestuale → Feedback.
  // La riga globale è stabile (ancora), la zona contestuale varia in base al click.
  function buildMenuItems({ selInfo, linkEl, imgEl, editable, clipboardHistory, navState }) {
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
    // lettura si può sempre fermare da dove si è (richiesta alpha).
    if (TTS.ttsBusy()) {
      items.push(TTS.buildStopReadingItem());
    }

    // 3. Zona contestuale — assente se non c'è contesto utile.
    const contextItems = buildContextualItems({ selInfo, linkEl, imgEl, editable, clipboardHistory });
    if (contextItems.length > 0) {
      items.push({ type: 'separator' });
      for (const it of contextItems) items.push(it);
    }

    // 4. Feedback (alpha)
    items.push({ type: 'separator' });
    items.push(buildFeedbackItem());

    return items;
  }

  function buildHelpItem() {
    return {
      type: 'item',
      label: I18n.t('menu_help'),
      shortcut: 'Alt+H',
      onClick: () => openHelpSidebar(),
    };
  }

  // Costruisce gli item della zona contestuale in base a cosa è stato cliccato.
  // Matrice: testo / testo+editabile / immagine / link / casella input / niente.
  function buildContextualItems({ selInfo, linkEl, imgEl, editable, clipboardHistory }) {
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

    if (imgEl) {
      items.push({ type: 'item', label: I18n.t('menu_copy_image'), onClick: () => Actions.copyImage(imgEl) });
      items.push({ type: 'item', label: I18n.t('menu_save_image_as'), onClick: () => Actions.downloadImage(imgEl) });
      items.push({
        type: 'item',
        label: I18n.t('menu_copy_image_link'),
        onClick: () => Actions.copyToClipboard(imgEl.currentSrc || imgEl.src),
      });
      items.push({
        type: 'item',
        label: I18n.t('menu_search_image'),
        onClick: () => Actions.searchImageOnWeb(imgEl),
      });
      items.push({ type: 'separator' });
      items.push(Actions.buildInlineExplainImage(imgEl));
      return items;
    }

    if (linkEl) {
      items.push({
        type: 'item',
        label: I18n.t('menu_open_in_new_tab'),
        onClick: () => window.open(linkEl.href, '_blank', 'noopener'),
      });
      items.push({
        type: 'item',
        label: I18n.t('menu_copy_link'),
        onClick: () => Actions.copyToClipboard(linkEl.href),
      });
      items.push({
        type: 'item',
        label: I18n.t('menu_save_link_for_later'),
        onClick: () => Actions.saveLink(linkEl),
      });
      items.push({
        type: 'item',
        label: I18n.t('menu_share_link'),
        onClick: () => Actions.shareLink(linkEl),
      });
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
    if (msg?.type === MSG.SETTINGS_UPDATED) {
      settings = msg.settings;
      applyTheme(settings.theme);
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
