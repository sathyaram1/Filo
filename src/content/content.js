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

  let settings = null;
  let pageTranslating = false;
  // Rispecchia la modalità "contenuto a tutto schermo" del main (vedi tabs.js).
  // Serve a mostrare l'icona/etichetta giusta nella voce di menu "Schermo intero".
  let contentFullscreen = false;
  let pageHasTranslation = false;

  // ------------------------------------------------------------
  // Bootstrap
  // ------------------------------------------------------------
  async function init() {
    settings = await fetchSettings();
    applyTheme(settings.theme);

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
    document.addEventListener('selectionchange', schedulePrefetchExplain);
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      onRuntimeMessage(msg, sender, sendResponse);
      return true; // mantieni il canale aperto per sendResponse asincrono
    });
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
      getClipboardHistory(),
      getNavState(),
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
      getClipboardHistory(),
      getNavState(),
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

    // Memorizza lo stato di navigazione dell'apertura corrente: serve a
    // `redrawIconRows()` per ricostruire la riga icone dopo un drag SENZA
    // perdere lo stato "disabilitato" (grigio) di avanti/indietro. Senza
    // questo, riordinare un'icona faceva tornare avanti/indietro non grigi
    // perché il rebuild girava con navState=undefined (→ canBack/canFwd=true).
    lastNavState = navState || null;

    // 1. Riga icone globali (max 5 + overflow). Tutte mute, etichetta in tooltip.
    items.push(buildGlobalIconRow(navState));

    // 2. Aiuto — voce sempre presente, etichettata.
    items.push({ type: 'separator' });
    items.push(buildHelpItem());

    // 3. Zona contestuale — assente se non c'è contesto utile.
    const contextItems = buildContextualItems({ selInfo, linkEl, imgEl, editable, clipboardHistory });
    if (contextItems.length > 0) {
      items.push({ type: 'separator' });
      for (const it of contextItems) items.push(it);
    }

    // 3b. "Interrompi lettura" globale: mentre legge deve comparire in OGNI menu.
    // Quando c'è una selezione la voce è già fra gli item contestuali (via
    // buildReadAloudItem), quindi qui la aggiungo solo se non c'è selezione,
    // per evitare doppioni.
    if (!selInfo) {
      const stopItem = buildStopReadingItem();
      if (stopItem) {
        items.push({ type: 'separator' });
        items.push(stopItem);
      }
    }

    // 4. Feedback (alpha)
    items.push({ type: 'separator' });
    items.push(buildFeedbackItem());

    return items;
  }

  // Registro delle icone globali, con ID stabili per drag-and-drop + persistenza
  // della disposizione utente. Le icone primarie occupano la riga in alto del
  // menu; le secondarie vivono nel sotto-menu "Altro…" (griglia 4 colonne).
  function buildIconRegistry(navState) {
    const Icons = self.SN_ICONS;
    // Tutte le icone della riga primaria/griglia sono SVG renderizzate a 18px.
    // Vedi src/shared/icons.js e src/styles/ICONS.md per la guida di stile.
    const I = (name) => Icons[name](18);
    const translateIcon = pageHasTranslation ? I('showOriginal') : I('translate');
    const translateLabel = pageHasTranslation ? I18n.t('menu_show_original') : I18n.t('menu_global_translate');
    // Quando navState non è disponibile (es. menu aperto da flussi che non lo
    // calcolano), lascia abilitati: meglio rispetto al falso "disabilitato".
    const canBack = navState ? !!navState.canBack : true;
    const canFwd = navState ? !!navState.canFwd : true;
    return {
      translate:     { id: 'translate',     icon: translateIcon,    label: translateLabel,                   onClick: () => (pageHasTranslation ? restoreOriginal() : translatePage()) },
      screenshot:    { id: 'screenshot',    icon: I('screenshot'),  label: I18n.t('menu_screenshot'),        onClick: () => takeScreenshot() },
      screenshotCrop:{ id: 'screenshotCrop',icon: I('screenshotCrop'),label: I18n.t('menu_screenshot_crop'), onClick: () => takePartialScreenshot() },
      transcribe:    { id: 'transcribe',    icon: I('transcribe'),  label: I18n.t('menu_transcribe'),        onClick: () => transcribeRegion() },
      share:         { id: 'share',         icon: I('share'),       label: I18n.t('menu_share'),             onClick: () => shareCurrentPage() },
      saveForLater:  { id: 'saveForLater',  icon: I('saveForLater'),label: I18n.t('menu_save_for_later'),    onClick: () => savePage() },
      openForLater:  { id: 'openForLater',  icon: I('openForLater'),label: I18n.t('menu_open_for_later'),    onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_HOME }) },
      fullscreen:    { id: 'fullscreen',    icon: (document.fullscreenElement || contentFullscreen) ? I('shrink') : I('zoom'), label: (document.fullscreenElement || contentFullscreen) ? I18n.t('menu_exit_fullscreen') : I18n.t('menu_fullscreen'), onClick: () => toggleFullscreen() },
      back:          { id: 'back',          icon: I('back'),        label: I18n.t('menu_back'),              disabled: !canBack, onClick: () => chrome.runtime.sendMessage({ type: MSG.NAV_BACK }) },
      forward:       { id: 'forward',       icon: I('forward'),     label: I18n.t('menu_forward'),           disabled: !canFwd, onClick: () => chrome.runtime.sendMessage({ type: MSG.NAV_FORWARD }) },
      reload:        { id: 'reload',        icon: I('reload'),      label: I18n.t('menu_reload'),            onClick: () => chrome.runtime.sendMessage({ type: MSG.NAV_RELOAD }) },
      colorPicker:   { id: 'colorPicker',   icon: I('colorPicker'), label: I18n.t('menu_color_picker'),      onClick: () => pickColor() },
      closeTab:      { id: 'closeTab',      icon: I('close'),       label: I18n.t('menu_close_tab'),         onClick: () => chrome.runtime.sendMessage({ type: MSG.CLOSE_TAB }) },
      newTab:        { id: 'newTab',        icon: I('filoLogo'),    label: I18n.t('menu_new_tab'),           onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_NEW_TAB }) },
      qrCode:        { id: 'qrCode',        icon: I('qrCode'),      label: I18n.t('menu_qr_code'),           onClick: () => showPageQrCode() },
      incognito:     { id: 'incognito',     icon: I('incognito'),   label: I18n.t('menu_incognito'),         onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_INCOGNITO }) },
      // Scorciatoie a impostazioni, home e alle app interne (editor, feedback)
      // direttamente fra le icone del menu (feedback alpha).
      openOptions:   { id: 'openOptions',   icon: I('options'),     label: I18n.t('menu_open_options'),      onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_OPTIONS }) },
      home:          { id: 'home',          icon: I('home'),        label: I18n.t('menu_open_home'),         onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_HOME }) },
      editorApp:     { id: 'editorApp',     icon: I('editor'),      label: I18n.t('menu_open_editor'),       onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_URL, url: 'filo://editor/editor.html' }) },
      feedbackApp:   { id: 'feedbackApp',   icon: I('feedback'),    label: I18n.t('menu_open_feedback'),      onClick: () => chrome.runtime.sendMessage({ type: MSG.OPEN_URL, url: 'filo://feedback/feedback.html' }) },
    };
  }

  // Color picker stile PowerToys: usa la EyeDropper API nativa di Chrome. Al
  // click sull'icona il cursore cambia (gestito dal browser/SO) e la prossima
  // pressione del tasto sinistro su un pixel qualsiasi della pagina copia il
  // colore in formato hex nella clipboard. Esc annulla.
  async function pickColor() {
    if (typeof window.EyeDropper !== 'function') {
      Popup.showToast(I18n.t('err_color_picker_unsupported'), { duration: 3000 });
      return;
    }
    try {
      const ep = new window.EyeDropper();
      const result = await ep.open();
      const hex = (result?.sRGBHex || '').toUpperCase();
      if (!hex) return;
      try {
        await navigator.clipboard.writeText(hex);
      } catch (_) {
        // Fallback: textarea + execCommand se la clipboard API è bloccata.
        const ta = document.createElement('textarea');
        ta.value = hex;
        ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        ta.remove();
      }
      Popup.showToast(I18n.t('toast_color_copied') + hex, { duration: 2500 });
    } catch (_) {
      // L'utente ha annullato (Esc) — nessun toast.
    }
  }

  // Genera e mostra il QR code della pagina corrente in un overlay. La codifica
  // è 100% locale (src/shared/qr.js): l'URL non viene mai inviato a servizi
  // esterni. Il QR è sempre nero su bianco (a prescindere dal tema) per
  // garantire il contrasto richiesto dagli scanner.
  function showPageQrCode() {
    const QR = self.SN_QR;
    const url = String(location.href || '');
    if (!QR || typeof QR.toMatrix !== 'function') {
      Popup.showToast(I18n.t('qr_error'), { duration: 3000 });
      return;
    }
    let matrix;
    try {
      matrix = QR.toMatrix(url, { ecc: 'M' });
    } catch (e) {
      Popup.showToast(I18n.t('qr_error'), { duration: 3500 });
      return;
    }

    const n = matrix.length;
    const quiet = 4;            // quiet zone (moduli) richiesta dallo standard
    const total = n + quiet * 2;
    const cell = 8;             // px per modulo nel PNG/SVG sorgente
    const dim = total * cell;

    // Costruisce l'SVG del QR (nero su bianco) con quiet zone.
    const rects = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (matrix[r][c]) {
          const x = (c + quiet) * cell;
          const y = (r + quiet) * cell;
          rects.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}"/>`);
        }
      }
    }
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">` +
      `<rect width="${dim}" height="${dim}" fill="#ffffff"/>` +
      `<g fill="#000000">${rects.join('')}</g>` +
      `</svg>`;
    const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

    // --- Overlay ---
    // L'overlay è figlio di documentElement, che porta data-sn-theme + le
    // variabili della palette Filo (theme.css è iniettato anche sulle pagine
    // esterne). Usiamo quindi le stesse variabili del resto della UI (sfondo,
    // bordo, accento) con dei fallback hard-coded per i rari casi in cui il
    // tema non fosse ancora applicato. Il QR in sé resta nero su bianco (vedi
    // sotto): è l'unica parte che NON segue il tema, per restare scansionabile.
    const overlay = document.createElement('div');
    overlay.className = 'sn-qr-overlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483646',
      'display:flex', 'align-items:center', 'justify-content:center',
      'background:rgba(0,0,0,.45)', 'backdrop-filter:blur(2px)',
    ].join(';');

    const card = document.createElement('div');
    card.className = 'sn-qr-card';
    card.style.cssText = [
      'background:var(--sn-overlay-bg,#f8f6f0)', 'color:var(--sn-fg,#1a1918)',
      'border:1px solid var(--sn-border,#e0dcd4)', 'border-radius:14px',
      'padding:22px 22px 18px', 'box-shadow:0 12px 48px rgba(0,0,0,.4)',
      'max-width:min(92vw,360px)', 'font-family:var(--sn-font,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif)',
      'text-align:center',
    ].join(';');
    card.addEventListener('mousedown', (e) => e.stopPropagation());

    const title = document.createElement('div');
    title.textContent = I18n.t('qr_title');
    title.style.cssText = 'font-size:17px;font-weight:600;margin-bottom:2px;color:var(--sn-fg,#1a1918);';

    const subtitle = document.createElement('div');
    subtitle.textContent = I18n.t('qr_subtitle');
    subtitle.style.cssText = 'font-size:12px;color:var(--sn-muted,#6e6b63);margin-bottom:14px;';

    // Tile bianca attorno al QR: in tema scuro lo stacca dallo sfondo e — cosa
    // più importante — garantisce la quiet zone bianca che gli scanner si
    // aspettano, a prescindere dal colore della card.
    const qrTile = document.createElement('div');
    qrTile.style.cssText = 'background:#fff;border-radius:10px;padding:10px;display:inline-block;margin:0 auto;box-shadow:0 1px 4px rgba(0,0,0,.12);';

    const img = document.createElement('img');
    img.src = svgDataUrl;
    img.alt = 'QR code';
    img.style.cssText = 'width:240px;height:240px;display:block;border-radius:4px;image-rendering:pixelated;';
    qrTile.appendChild(img);

    const urlLine = document.createElement('div');
    urlLine.textContent = url;
    urlLine.title = url;
    urlLine.style.cssText = 'font-size:11px;color:var(--sn-muted,#6e6b63);margin:12px 4px 14px;word-break:break-all;max-height:3.2em;overflow:hidden;';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:center;';

    const mkBtn = (label, primary) => {
      const b = document.createElement('button');
      b.textContent = label;
      const base = [
        'flex:1', 'padding:9px 12px', 'border-radius:8px', 'font-size:13px',
        'font-family:inherit', 'cursor:pointer', 'transition:background .12s,border-color .12s',
      ];
      if (primary) {
        base.push('border:1px solid var(--sn-accent,#c45a3b)', 'background:var(--sn-accent,#c45a3b)', 'color:#fff');
      } else {
        base.push('border:1px solid var(--sn-border,#e0dcd4)', 'background:transparent', 'color:var(--sn-fg,#1a1918)');
      }
      b.style.cssText = base.join(';');
      // Hover coerente con il resto della UI Filo (l'accento sul bordo dei
      // secondari, leggero scurimento sui primari).
      b.addEventListener('mouseenter', () => {
        if (primary) b.style.filter = 'brightness(1.08)';
        else b.style.borderColor = 'var(--sn-accent,#c45a3b)';
      });
      b.addEventListener('mouseleave', () => {
        if (primary) b.style.filter = '';
        else b.style.borderColor = 'var(--sn-border,#e0dcd4)';
      });
      return b;
    };

    const downloadBtn = mkBtn(I18n.t('qr_download'), true);
    downloadBtn.addEventListener('click', () => downloadQrPng(matrix, quiet, url));

    const copyBtn = mkBtn(I18n.t('qr_copy_link'), false);
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(url);
      } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = url; ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        ta.remove();
      }
      Popup.showToast(I18n.t('qr_link_copied'), { duration: 1800 });
    });

    btnRow.appendChild(downloadBtn);
    btnRow.appendChild(copyBtn);
    card.appendChild(title);
    card.appendChild(subtitle);
    card.appendChild(qrTile);
    card.appendChild(urlLine);
    card.appendChild(btnRow);
    overlay.appendChild(card);

    const closeOverlay = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closeOverlay(); } }
    overlay.addEventListener('mousedown', closeOverlay);
    document.addEventListener('keydown', onKey, true);

    document.documentElement.appendChild(overlay);
  }

  // Converte la matrice QR in un PNG e lo scarica. Usa un canvas off-DOM:
  // disegna i moduli neri su sfondo bianco con quiet zone.
  function downloadQrPng(matrix, quiet, url) {
    try {
      const n = matrix.length;
      const total = n + quiet * 2;
      const scale = 10; // px per modulo nel PNG scaricato (alta risoluzione)
      const dim = total * scale;
      const canvas = document.createElement('canvas');
      canvas.width = dim; canvas.height = dim;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, dim, dim);
      ctx.fillStyle = '#000000';
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (matrix[r][c]) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
        }
      }
      const finish = (href) => {
        const a = document.createElement('a');
        a.href = href;
        let host = 'pagina';
        try { host = new URL(url).hostname || 'pagina'; } catch (_) {}
        a.download = `qr-${host}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      };
      if (canvas.toBlob) {
        canvas.toBlob((blob) => {
          if (!blob) { finish(canvas.toDataURL('image/png')); return; }
          const objUrl = URL.createObjectURL(blob);
          finish(objUrl);
          setTimeout(() => URL.revokeObjectURL(objUrl), 4000);
        }, 'image/png');
      } else {
        finish(canvas.toDataURL('image/png'));
      }
    } catch (e) {
      Popup.showToast(I18n.t('qr_error'), { duration: 2500 });
    }
  }

  // Layout di default: icone primarie nella riga, le altre nella griglia
  // "Altro…". Fra le secondarie ci sono le scorciatoie a Impostazioni (`openOptions`),
  // Home (`home`) e alle app interne Editor (`editorApp`) e Feedback (`feedbackApp`),
  // così sono raggiungibili direttamente dal menu del tasto destro (feedback alpha).
  const DEFAULT_ICON_LAYOUT = {
    primary: ['translate', 'screenshot', 'share', 'saveForLater', 'qrCode', 'newTab'],
    secondary: ['openOptions', 'home', 'editorApp', 'feedbackApp', 'incognito', 'screenshotCrop', 'transcribe', 'colorPicker', 'closeTab', 'fullscreen', 'back', 'forward', 'reload'],
  };

  // Marker (storage) della promozione una-tantum di `qrCode` nella riga primaria.
  // Feedback alpha: il QR doveva stare "fra le azioni rapide", non nascosto in
  // "Altro…". Promuoviamo l'icona una sola volta per chi aveva già un layout
  // salvato; dopo, l'utente resta libero di rispostarla dove vuole.
  const QR_PRIMARY_MARKER = 'sn_qr_in_primary_migrated';

  // Icone ritirate dal registro: vanno purgate dal layout salvato per non
  // generare bottoni "fantasma" (registry lookup miss).
  const RETIRED_ICONS = new Set(['openForLater']);

  // Vecchio default (prima del cambio a 5 slot): se trovo esattamente questo
  // layout in storage, è il default che non è mai stato customizzato — migro.
  const LEGACY_DEFAULT_LAYOUT = {
    primary: ['translate', 'screenshot', 'share', 'saveForLater'],
    secondary: ['openForLater', 'fullscreen', 'back', 'forward', 'reload'],
  };

  function arraysEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function isLegacyDefault(v) {
    return v && arraysEqual(v.primary, LEGACY_DEFAULT_LAYOUT.primary)
            && arraysEqual(v.secondary, LEGACY_DEFAULT_LAYOUT.secondary);
  }

  let iconLayoutCache = null;
  // Stato di navigazione (canBack/canFwd) dell'ultima apertura menu: riusato
  // dai redraw post-drag per non perdere il grigio di avanti/indietro.
  let lastNavState = null;
  function loadIconLayout() {
    try {
      chrome.storage.local.get([STORAGE_KEYS.ICON_LAYOUT, QR_PRIMARY_MARKER], (out) => {
        let v = out?.[STORAGE_KEYS.ICON_LAYOUT];
        const qrPromoted = !!out?.[QR_PRIMARY_MARKER];
        if (v && Array.isArray(v.primary) && Array.isArray(v.secondary)) {
          if (isLegacyDefault(v)) {
            iconLayoutCache = DEFAULT_ICON_LAYOUT;
            try { chrome.storage.local.set({ [STORAGE_KEYS.ICON_LAYOUT]: DEFAULT_ICON_LAYOUT, [QR_PRIMARY_MARKER]: true }); } catch (_) {}
          } else {
            // Migrazione (idempotente):
            //  1) purga le icone ritirate (openOptions, openForLater)
            //  2) aggiunge le icone introdotte dopo che il layout era stato
            //     salvato, così l'utente non perde feature nuove
            const filterRetired = (arr) => (arr || []).filter((id) => !RETIRED_ICONS.has(id));
            const beforePrim = (v.primary || []).join('|');
            const beforeSec = (v.secondary || []).join('|');
            v = { ...v, primary: filterRetired(v.primary), secondary: filterRetired(v.secondary) };
            const known = new Set([...v.primary, ...v.secondary]);
            const additions = ['incognito', 'qrCode', 'colorPicker', 'closeTab', 'screenshotCrop', 'transcribe', 'newTab', 'openOptions', 'home', 'editorApp', 'feedbackApp'].filter((id) => !known.has(id));
            if (additions.length) {
              v = { ...v, secondary: [...additions, ...v.secondary] };
            }
            // Promozione una-tantum di qrCode nella riga primaria (feedback
            // alpha: il QR è un'azione rapida, non va sepolto in "Altro…").
            // Solo se c'è spazio e l'utente non l'aveva già spostato in primaria.
            if (!qrPromoted && !v.primary.includes('qrCode')
                && v.secondary.includes('qrCode')
                && v.primary.length < MAX_PRIMARY_ICONS) {
              v = {
                ...v,
                primary: [...v.primary, 'qrCode'],
                secondary: v.secondary.filter((id) => id !== 'qrCode'),
              };
            }
            const changed = beforePrim !== v.primary.join('|') || beforeSec !== v.secondary.join('|');
            if (changed || !qrPromoted) {
              try {
                chrome.storage.local.set({ [STORAGE_KEYS.ICON_LAYOUT]: v, [QR_PRIMARY_MARKER]: true });
              } catch (_) {}
            }
            iconLayoutCache = v;
          }
        } else {
          iconLayoutCache = DEFAULT_ICON_LAYOUT;
          try { chrome.storage.local.set({ [QR_PRIMARY_MARKER]: true }); } catch (_) {}
        }
      });
    } catch (_) { iconLayoutCache = DEFAULT_ICON_LAYOUT; }
  }
  loadIconLayout();

  function getIconLayout() {
    return iconLayoutCache || DEFAULT_ICON_LAYOUT;
  }

  function saveIconLayout(layout) {
    iconLayoutCache = layout;
    try { chrome.storage.local.set({ [STORAGE_KEYS.ICON_LAYOUT]: layout }); } catch (_) {}
  }

  // Numero massimo di icone visibili nella riga primaria. Le eccedenti
  // (es. dopo un drag) traboccano automaticamente nella griglia secondaria.
  const MAX_PRIMARY_ICONS = 6;

  // Gestisce il drop di un'icona fra zone (riga primaria ↔ griglia secondaria),
  // reinserendola nell'ordine indicato (beforeId = ID dell'icona davanti alla
  // quale inserire; null = in fondo). Se la primaria sfora il limite, l'ultima
  // icona viene spinta in cima alla secondaria (swap di fatto).
  function applyIconDrop({ id, source, target, beforeId }) {
    if (!id) return;
    const layout = { ...getIconLayout() };
    layout.primary = (layout.primary || []).slice().filter((x) => x !== id);
    layout.secondary = (layout.secondary || []).slice().filter((x) => x !== id);
    if (target === 'primary') {
      const idx = beforeId ? layout.primary.indexOf(beforeId) : -1;
      if (idx >= 0) layout.primary.splice(idx, 0, id);
      else layout.primary.push(id);
      while (layout.primary.length > MAX_PRIMARY_ICONS) {
        const popped = layout.primary.pop();
        if (popped && !layout.secondary.includes(popped)) layout.secondary.unshift(popped);
      }
    } else {
      const idx = beforeId ? layout.secondary.indexOf(beforeId) : -1;
      if (idx >= 0) layout.secondary.splice(idx, 0, id);
      else layout.secondary.push(id);
    }
    saveIconLayout(layout);
  }

  // Costruisce gli item della riga primaria (icone + bottone overflow).
  function buildPrimaryRowItems(navState) {
    const registry = buildIconRegistry(navState);
    const layout = getIconLayout();
    const primaryIds = (layout.primary || []).filter((id) => registry[id]);
    const secondaryIds = (layout.secondary || []).filter((id) => registry[id]);
    const items = primaryIds.map((id) => ({ ...registry[id], draggable: true }));
    items.push({
      kind: 'overflow',
      icon: '▸',
      label: I18n.t('menu_overflow'),
      onClick: (anchorEl) => {
        const gridItems = secondaryIds.map((id) => ({ ...registry[id], draggable: true }));
        Menu.openIconGridSubmenu(anchorEl, gridItems, {
          cols: 4,
          dropTarget: 'secondary',
          onDrop: (e) => { applyIconDrop(e); redrawIconRows(); },
        });
      },
    });
    return items;
  }

  function buildSecondaryGridItems(navState) {
    const registry = buildIconRegistry(navState);
    const layout = getIconLayout();
    const secondaryIds = (layout.secondary || []).filter((id) => registry[id]);
    return secondaryIds.map((id) => ({ ...registry[id], draggable: true }));
  }

  // Riga globale: prende le icone "primary" dal layout utente. L'overflow apre
  // la griglia secondaria come sotto-menu ancorato (senza chiudere il primo).
  function buildGlobalIconRow(navState) {
    return {
      type: 'row',
      dropTarget: 'primary',
      onDrop: (e) => { applyIconDrop(e); redrawIconRows(); },
      items: buildPrimaryRowItems(navState),
    };
  }

  // Dopo un drop, rigenera in-place i bottoni delle due zone (riga primaria e
  // griglia secondaria) senza chiudere il menu, così l'utente può continuare a
  // riordinare. La griglia secondaria viene aggiornata solo se è aperta.
  function redrawIconRows() {
    try { Menu.refreshIconRow?.(buildPrimaryRowItems(lastNavState)); } catch (_) {}
    try { Menu.refreshIconGrid?.(buildSecondaryGridItems(lastNavState)); } catch (_) {}
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
      items.push({ type: 'item', label: I18n.t('menu_cut'), onClick: () => cutSelection() });
      items.push({ type: 'item', label: I18n.t('menu_copy'), onClick: () => copyToClipboard(selInfo.selection) });
      items.push(buildPasteItem(clipboardHistory));
      items.push(buildDictateItem());
      items.push(buildReadAloudItem(selInfo.selection));
      items.push({ type: 'separator' });
      items.push(buildInlineExplain(selInfo, { withDeepArrow: true }));
      items.push({
        type: 'item',
        label: I18n.t('menu_edit_selection'),
        onClick: () => openEditBox(selInfo.selection),
      });
      return items;
    }

    if (selInfo) {
      // Testo selezionato nella pagina (non editabile)
      items.push({ type: 'item', label: I18n.t('menu_copy'), onClick: () => copyToClipboard(selInfo.selection) });
      items.push({
        type: 'item',
        label: I18n.t('menu_search_text'),
        onClick: () => searchTextOnWeb(selInfo.selection),
      });
      items.push(buildReadAloudItem(selInfo.selection));
      items.push({ type: 'separator' });
      items.push(buildInlineExplain(selInfo, { withDeepArrow: true }));
      return items;
    }

    if (imgEl) {
      items.push({ type: 'item', label: I18n.t('menu_copy_image'), onClick: () => copyImage(imgEl) });
      items.push({ type: 'item', label: I18n.t('menu_save_image_as'), onClick: () => downloadImage(imgEl) });
      items.push({
        type: 'item',
        label: I18n.t('menu_copy_image_link'),
        onClick: () => copyToClipboard(imgEl.currentSrc || imgEl.src),
      });
      items.push({
        type: 'item',
        label: I18n.t('menu_search_image'),
        onClick: () => searchImageOnWeb(imgEl),
      });
      items.push({ type: 'separator' });
      items.push(buildInlineExplainImage(imgEl));
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
        onClick: () => copyToClipboard(linkEl.href),
      });
      items.push({
        type: 'item',
        label: I18n.t('menu_save_link_for_later'),
        onClick: () => saveLink(linkEl),
      });
      items.push({
        type: 'item',
        label: I18n.t('menu_share_link'),
        onClick: () => shareLink(linkEl),
      });
      items.push({ type: 'separator' });
      items.push(buildInlineExplainLink(linkEl));
      return items;
    }

    if (editable) {
      // Casella input senza selezione: incolla + detta.
      items.push(buildPasteItem(clipboardHistory));
      items.push(buildDictateItem());
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

  // ------------------------------------------------------------
  // Azioni
  // ------------------------------------------------------------
  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(
      () => {
        Popup.showToast(I18n.t('toast_copied'));
        pushClipboardEntry({ type: 'text', text });
      },
      () => {/* niente toast su errore — UX silenziosa */}
    );
  }

  // Incolla dagli appunti: prova prima a leggere immagini, poi testo.
  async function pasteFromClipboard() {
    restorePasteContext();
    // Tenta lettura strutturata (testo + immagini)
    try {
      if (navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const it of items) {
          // Cerca un'immagine
          const imgType = it.types.find((t) => t.startsWith('image/'));
          if (imgType) {
            const blob = await it.getType(imgType);
            const dataUrl = await blobToDataUrl(blob);
            restorePasteContext();
            const targetKind = pasteContext?.kind;
            if (targetKind === 'input') {
              // input/textarea non supportano immagini: prova a delegare ad
              // un handler custom (es. il modal feedback) via evento bubbling.
              const pasteEvt = new CustomEvent('filo:paste-image', {
                bubbles: true, cancelable: true, detail: { blob },
              });
              if (pasteContext.el && pasteContext.el.dispatchEvent(pasteEvt) === false) {
                return;
              }
              // Nessun handler ha accettato: ricadi sul testo se presente
              const textType = it.types.find((t) => t === 'text/plain');
              if (textType) {
                const text = await (await it.getType(textType)).text();
                insertTextAtSelection(text);
                pushClipboardEntry({ type: 'text', text });
              } else {
                Popup.showToast(I18n.t('toast_cannot_paste_image'));
              }
              return;
            }
            if (targetKind !== 'ce') {
              // Nessun target editabile valido per un'immagine.
              Popup.showToast(I18n.t('toast_cannot_paste_image'));
              return;
            }
            const ok = insertImageInEditable(blob, dataUrl);
            if (!ok) {
              Popup.showToast(I18n.t('toast_paste_failed'));
              return;
            }
            const description = await describeImage(blob);
            pushClipboardEntry({ type: 'image', dataUrl, description });
            Popup.showToast(I18n.t('toast_pasted_image'));
            return;
          }
        }
      }
    } catch (_) {
      // Permessi negati o API non disponibile: ricadi sul testo
    }
    // Fallback: solo testo
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      restorePasteContext();
      insertTextAtSelection(text);
      pushClipboardEntry({ type: 'text', text });
    } catch (_) {}
  }

  function cutSelection() {
    // window.getSelection() non vede la selezione dentro <input>/<textarea>:
    // recuperiamo il testo direttamente dal nodo attivo se serve.
    const sel = window.getSelection();
    let text = sel?.toString() || '';
    const activeEl = document.activeElement;
    const inInput = activeEl?.matches?.('input, textarea');
    if (!text && inInput) {
      const start = activeEl.selectionStart ?? 0;
      const end = activeEl.selectionEnd ?? 0;
      if (start !== end) text = (activeEl.value || '').slice(start, end);
    }
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      pushClipboardEntry({ type: 'text', text });
      if (inInput) {
        const start = activeEl.selectionStart ?? 0;
        const end = activeEl.selectionEnd ?? 0;
        activeEl.value = activeEl.value.slice(0, start) + activeEl.value.slice(end);
        activeEl.setSelectionRange(start, start);
        activeEl.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        document.execCommand('delete');
      }
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  // Descrizione provvisoria per un'immagine prima che arrivi quella generata dall'AI.
  async function describeImage(_blob) {
    return I18n.t('clipboard_image_pending');
  }

  function triggerExplainOrTranslate(action, selInfo, anchorEvent) {
    if (!selInfo) {
      Popup.showToast(I18n.t('err_no_selection'));
      return;
    }
    let title;
    if (action === ACTIONS.EXPLAIN) title = I18n.t('popup_explain_title');
    else if (action === ACTIONS.EXPLAIN_DEEP) title = I18n.t('popup_explain_deep_title');
    else title = I18n.t('popup_translate_title');

    Popup.openStreaming({
      action,
      payload: {
        selection: selInfo.selection,
        sentence: selInfo.sentence,
      },
      anchor: { x: anchorEvent.clientX, y: anchorEvent.clientY },
      title,
    });
  }

  function triggerExplainDeep(selInfo, anchorEvent) {
    triggerExplainOrTranslate(ACTIONS.EXPLAIN_DEEP, selInfo, anchorEvent);
  }

  // Costruisce l'item del menu "Incolla" con freccetta cronologia.
  function buildPasteItem(clipboardHistory) {
    return {
      type: 'paste',
      label: I18n.t('menu_paste'),
      shortcut: 'Ctrl+V',
      history: clipboardHistory,
      onClick: () => pasteFromClipboard(),
      onPickHistory: (entry) => pasteHistoryEntry(entry),
    };
  }

  // Sezione inline: avvia subito una richiesta EXPLAIN e mostra il risultato nel menu.
  // Se la risposta è "NESSUNA SPIEGAZIONE" la sezione viene nascosta.
  // ------------------------------------------------------------
  // Prefetch "Spiega" su selezione di testo (riduce latenza del menu)
  // ------------------------------------------------------------
  // Quando l'utente seleziona del testo, lanciamo subito la richiesta EXPLAIN in
  // background. Quando poi apre il menu (clic destro), il risultato è in cache:
  // il box inline lo mostra istantaneamente invece di aspettare il provider.
  // - Debounce 400ms (selectionchange spara molto durante il drag).
  // - Dedup per chiave selezione (no re-fetch sulla stessa selezione).
  // - No prefetch se tab nascosto, dominio bloccato, selezione troppo corta.
  // - Una sola entry attiva: la selezione cambia velocemente, non serve cache larga.
  let prefetchedExplain = null; // { key, sentence, promise<{text}|{error}> }
  let prefetchTimer = null;

  function explainKey(text) { return (text || '').trim().slice(0, 2000); }

  function schedulePrefetchExplain() {
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(prefetchExplainNow, 400);
  }

  function prefetchExplainNow() {
    if (isBlocked()) return;
    if (document.hidden) return;
    const sel = Extract.getSelectionWithSentence();
    if (!sel) return;
    const key = explainKey(sel.selection);
    if (key.length < 3) return;
    // Stessa selezione di prima: l'entry esistente sta già lavorando (o ha il risultato).
    if (prefetchedExplain && prefetchedExplain.key === key) return;
    prefetchedExplain = startExplainRequest(sel);
  }

  function startExplainRequest(selInfo) {
    const key = explainKey(selInfo.selection);
    const entry = { key, sentence: selInfo.sentence };
    entry.promise = chrome.runtime.sendMessage({
      type: MSG.AI_REQUEST,
      action: ACTIONS.EXPLAIN,
      payload: { selection: selInfo.selection, sentence: selInfo.sentence },
    }).then(
      (res) => (res?.ok && typeof res.text === 'string')
        ? { text: res.text }
        : { error: res?.error || I18n.t('err_provider_failed') },
      (e) => ({ error: e?.message || I18n.t('err_provider_failed') }),
    );
    return entry;
  }

  // Restituisce la Promise per la spiegazione di questa selezione.
  // Riusa il prefetch se è dello stesso testo; altrimenti parte ora.
  function getExplainPromise(selInfo) {
    const key = explainKey(selInfo.selection);
    if (prefetchedExplain && prefetchedExplain.key === key) {
      return prefetchedExplain.promise;
    }
    const entry = startExplainRequest(selInfo);
    prefetchedExplain = entry;
    return entry.promise;
  }

  function buildInlineExplain(selInfo, opts = {}) {
    const withDeepArrow = !!opts.withDeepArrow;
    return {
      type: 'inline',
      content: I18n.t('menu_explain_loading'),
      onMount: (el) => {
        el.classList.add('sn-menu-inline-loading', 'sn-menu-inline-explain');
        const body = document.createElement('div');
        body.className = 'sn-menu-inline-body';
        body.textContent = I18n.t('menu_explain_loading');
        el.textContent = '';
        el.appendChild(body);

        if (withDeepArrow) {
          const arrow = document.createElement('button');
          arrow.type = 'button';
          arrow.className = 'sn-menu-inline-arrow';
          arrow.title = I18n.t('menu_explain_deep') + ' (Alt+E)';
          arrow.textContent = '▸';
          arrow.addEventListener('click', (e) => {
            e.stopPropagation();
            try { self.SN_MENU?.close?.(); } catch (_) {}
            triggerExplainDeep(selInfo, lastMouseEvent);
          });
          el.appendChild(arrow);
        }

        let cancelled = false;
        getExplainPromise(selInfo).then((res) => {
          if (cancelled) return;
          el.classList.remove('sn-menu-inline-loading');
          if (!res || res.error || !res.text) {
            el.classList.add('sn-menu-inline-error');
            body.textContent = (res && res.error) || I18n.t('err_provider_failed');
            return;
          }
          const resolved = Popup.resolveCalcMarkers(res.text);
          if (/NESSUNA SPIEGAZIONE/i.test(resolved.trim())) {
            const prev = el.previousElementSibling;
            if (prev && prev.classList.contains('sn-menu-sep')) prev.remove();
            el.remove();
            return;
          }
          body.innerHTML = Popup.renderMarkdown(resolved);
        });
        return () => { cancelled = true; };
      },
    };
  }

  async function getClipboardHistory() {
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.GET_CLIPBOARD_HISTORY });
      return r?.items || [];
    } catch (_) { return []; }
  }

  // Stato di navigazione (canBack/canFwd) del tab corrente: serve per
  // mostrare le icone avanti/indietro del menu in grigio quando la cronologia
  // non lo consente, come già accade per i tasti analoghi nella barra in alto.
  async function getNavState() {
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.NAV_STATE });
      return { canBack: !!r?.canBack, canFwd: !!r?.canFwd };
    } catch (_) { return { canBack: true, canFwd: true }; }
  }

  function pushClipboardEntry(entry) {
    chrome.runtime.sendMessage({ type: MSG.PUSH_CLIPBOARD_ENTRY, entry }).catch(() => {});
    // Per le immagini, chiedi all'AI una breve descrizione e aggiorna l'entry.
    if (entry?.type === 'image' && entry.dataUrl) {
      requestImageDescription(entry.dataUrl).catch(() => {});
    }
  }

  async function requestImageDescription(dataUrl) {
    const FALLBACK_MODEL = 'google/gemini-2.0-flash-001';
    const tryOnce = async (modelOverride) => {
      try {
        return await chrome.runtime.sendMessage({
          type: MSG.AI_REQUEST,
          action: ACTIONS.DESCRIBE_IMAGE,
          payload: modelOverride ? { dataUrl, modelOverride } : { dataUrl },
        });
      } catch (e) {
        return { ok: false, error: e.message || String(e) };
      }
    };

    let res = await tryOnce();
    if (!res?.ok) {
      console.warn('[SN] descrizione immagine fallita col modello configurato:', res?.error || 'errore sconosciuto', '— provo con', FALLBACK_MODEL);
      res = await tryOnce(FALLBACK_MODEL);
    }
    if (!res?.ok) {
      console.warn('[SN] descrizione immagine fallita anche col fallback:', res?.error || 'errore sconosciuto');
      return null;
    }
    if (!res.text) {
      console.warn('[SN] descrizione immagine: risposta vuota');
      return null;
    }
    const description = res.text.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!description) return null;
    chrome.runtime.sendMessage({
      type: MSG.UPDATE_CLIPBOARD_DESCRIPTION,
      dataUrl,
      description,
    }).catch(() => {});
    return description;
  }

  function descriptionToFilename(description, ext = 'png') {
    if (!description) return null;
    let name = description
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    if (!name) return null;
    return `${name}.${ext}`;
  }

  async function pasteHistoryEntry(entry) {
    if (!entry) return;
    // Riporta in cima alla cronologia: il background fa dedup e promuove.
    // Non passiamo per pushClipboardEntry() per evitare di ri-richiedere
    // all'AI la descrizione di un'immagine già descritta.
    chrome.runtime.sendMessage({ type: MSG.PUSH_CLIPBOARD_ENTRY, entry }).catch(() => {});
    restorePasteContext();
    if (entry.type === 'image') {
      // Ricostruisci un Blob a partire dal data URL: serve a tutti i rami sotto.
      // Le immagini in cronologia sono offline (dataUrl in storage): niente provider.
      let blob = null;
      try { blob = await (await fetch(entry.dataUrl)).blob(); } catch (_) {}

      // input/textarea non accettano <img> nativamente: come fa pasteFromClipboard
      // delega via evento custom 'filo:paste-image' così handler dedicati (modal
      // feedback, barra input dashboard, ecc.) possono allegarla. Senza questa
      // delega l'Incolla→cronologia falliva ovunque Ctrl+V su immagine funziona.
      if (pasteContext?.kind === 'input' && blob) {
        const pasteEvt = new CustomEvent('filo:paste-image', {
          bubbles: true, cancelable: true, detail: { blob },
        });
        if (pasteContext.el.dispatchEvent(pasteEvt) === false) {
          Popup.showToast(I18n.t('toast_pasted_image'));
          return;
        }
        Popup.showToast(I18n.t('toast_cannot_paste_image'));
        return;
      }
      if (pasteContext?.kind !== 'ce') {
        Popup.showToast(I18n.t('toast_cannot_paste_image'));
        return;
      }
      const ok = insertImageInEditable(blob, entry.dataUrl, descriptionToFilename(entry.description));
      if (ok) Popup.showToast(I18n.t('toast_pasted_image'));
      else Popup.showToast(I18n.t('toast_paste_failed'));
      return;
    }
    // testo: incolla in input/textarea/contenteditable
    insertTextAtSelection(entry.text || '');
  }

  // Inserisce un'immagine in un contenteditable provando tre strategie in
  // sequenza: (1) paste event sintetico — necessario per editor moderni
  // (Gmail, Slate, Lexical, ProseMirror) che hanno un handler paste e
  // ignorerebbero execCommand o modifiche dirette al DOM; (2) execCommand
  // 'insertImage'; (3) inserimento manuale via Range API.
  function insertImageInEditable(blob, dataUrl, fileName) {
    if (!pasteContext || pasteContext.kind !== 'ce') return false;
    const el = pasteContext.el;
    if (!el || !el.isConnected) return false;
    el.focus();
    const sel = window.getSelection();
    if (pasteContext.range) {
      try {
        sel.removeAllRanges();
        sel.addRange(pasteContext.range);
      } catch (_) {}
    }

    // (1) Paste event sintetico con DataTransfer
    if (blob) {
      try {
        const dt = new DataTransfer();
        const file = new File([blob], fileName || 'image.png', { type: blob.type || 'image/png' });
        dt.items.add(file);
        const evt = new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        });
        const notCancelled = el.dispatchEvent(evt);
        // Se l'evento è stato cancellato (preventDefault), la pagina lo ha gestito.
        if (!notCancelled) return true;
      } catch (_) {}
    }

    // (2) execCommand classico
    try {
      if (document.execCommand('insertImage', false, dataUrl)) return true;
    } catch (_) {}

    // (3) Inserimento manuale via Range
    try {
      let range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      if (!range || !el.contains(range.startContainer)) {
        range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
      }
      const img = document.createElement('img');
      img.src = dataUrl;
      range.deleteContents();
      range.insertNode(img);
      range.setStartAfter(img);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      pasteContext.range = range.cloneRange();
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
      return true;
    } catch (_) {}

    return false;
  }

  function insertTextAtSelection(text) {
    if (!pasteContext) return;
    const { kind, el } = pasteContext;
    if (!el || !el.isConnected) return;
    if (kind === 'input') {
      const start = pasteContext.start ?? el.value.length;
      const end = pasteContext.end ?? el.value.length;
      el.value = el.value.slice(0, start) + text + el.value.slice(end);
      const caret = start + text.length;
      el.setSelectionRange(caret, caret);
      pasteContext.start = caret;
      pasteContext.end = caret;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (kind === 'ce') {
      el.focus();
      // Ripristina la selezione salvata all'apertura del menu PRIMA di inserire:
      // il click sul bottone del menu sposta il focus, e su editor moderni
      // (ProseMirror di claude.ai, Lexical, Slate) execCommand inseriva a fine
      // testo invece che dove era il caret (feedback alpha).
      const sel = window.getSelection();
      if (pasteContext.range && el.contains(pasteContext.range.startContainer)) {
        try {
          sel.removeAllRanges();
          sel.addRange(pasteContext.range);
        } catch (_) {}
      }
      // (1) paste event sintetico: gli editor "controllati" leggono la loro
      // selezione interna (mantenuta anche dopo il blur) e inseriscono nel
      // punto giusto. execCommand su quegli editor finiva in coda.
      let handled = false;
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        const evt = new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        });
        handled = !el.dispatchEvent(evt);
      } catch (_) {}
      // (2) fallback: execCommand insertText (editor "non controllati").
      if (!handled) {
        try { document.execCommand('insertText', false, text); } catch (_) {}
      }
    }
  }

  function buildSavePayload() {
    const meta = Extract.pageMeta();
    return {
      url: location.href,
      title: document.title,
      favicon: document.querySelector('link[rel~="icon"]')?.href || '',
      description: meta.description || '',
      excerpt: Extract.pageExcerpt(500),
    };
  }

  async function savePage() {
    try {
      const cap = await chrome.runtime.sendMessage({ type: MSG.CAPTURE_VISIBLE_TAB });
      const thumbnail = cap?.dataUrl || '';
      const base = buildSavePayload();
      const res = await chrome.runtime.sendMessage({
        type: MSG.SAVE_PAGE,
        page: { ...base, thumbnail },
      });
      if (res?.ok) {
        Popup.showToast(I18n.t('toast_saved', I18n.t('category_default')));
        setTimeout(() => chrome.runtime.sendMessage({ type: MSG.CLOSE_TAB }), 600);
      }
    } catch (e) {
      console.error('[SN] savePage', e);
    }
  }

  async function saveLink(linkEl) {
    const res = await chrome.runtime.sendMessage({
      type: MSG.SAVE_LINK,
      url: linkEl.href,
      title: linkEl.textContent?.trim() || linkEl.href,
    });
    if (res?.ok) Popup.showToast(I18n.t('toast_link_saved'));
  }

  async function copyImage(imgEl) {
    try {
      const r = await fetch(imgEl.currentSrc || imgEl.src);
      const blob = await r.blob();
      let pngBlob = blob;
      // Clipboard API supporta image/png; converte se serve
      if (blob.type !== 'image/png') {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        pngBlob = await new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'));
        URL.revokeObjectURL(url);
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      const dataUrl = await blobToDataUrl(pngBlob);
      const description = await describeImage(pngBlob);
      pushClipboardEntry({ type: 'image', dataUrl, description });
      Popup.showToast(I18n.t('toast_copied'));
    } catch (_) {}
  }

  function downloadImage(imgEl) {
    const a = document.createElement('a');
    a.href = imgEl.currentSrc || imgEl.src;
    const name = (a.href.split('/').pop() || 'image').split('?')[0] || 'image';
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  function toggleFullscreen() {
    // Demanda al main: requestFullscreen() su una WebContentsView non porta
    // la BrowserWindow in fullscreen OS, resta confinato al bounds della view.
    chrome.runtime.sendMessage({ type: MSG.TOGGLE_FULLSCREEN });
  }

  // ------------------------------------------------------------
  // Traduci pagina
  // ------------------------------------------------------------
  async function translatePage() {
    if (pageTranslating) {
      Popup.showToast(I18n.t('toast_translating_page'));
      return;
    }
    pageTranslating = true;
    Popup.showToast(I18n.t('toast_translating_page'), { duration: 1800 });

    const nodes = Extract.extractMainTextNodes();
    if (!nodes.length) { pageTranslating = false; return; }

    // Per ogni nodo: trasforma i figli (link, img, span, …) in placeholder [[Lk]],
    // così l'AI traduce solo il testo e i link restano cliccabili.
    for (const n of nodes) {
      const { templated, refs } = templateizeBlock(n.el);
      n.templated = templated;
      n.refs = refs;
    }

    // Chunking: aggrega nodi fino a ~3000 caratteri per chunk.
    const CHUNK_SIZE = 3000;
    const chunks = [];
    let cur = { nodes: [], length: 0 };
    for (const n of nodes) {
      const len = (n.templated || '').length + 2;
      if (cur.length + len > CHUNK_SIZE && cur.nodes.length) {
        chunks.push(cur);
        cur = { nodes: [], length: 0 };
      }
      cur.nodes.push(n);
      cur.length += len;
    }
    if (cur.nodes.length) chunks.push(cur);

    const SEPARATOR = '\n@@@SN_SEP@@@\n';
    let translatedAny = false;
    try {
      for (const c of chunks) {
        const joined = c.nodes.map((n) => n.templated).join(SEPARATOR);
        const res = await chrome.runtime.sendMessage({
          type: MSG.AI_REQUEST,
          action: ACTIONS.TRANSLATE_PAGE,
          payload: { chunk: joined },
        });
        if (!res?.ok) {
          Popup.showToast(res?.error || I18n.t('err_provider_failed'));
          break;
        }
        const parts = (res.text || '').split(/\n?@@@SN_SEP@@@\n?/);
        for (let i = 0; i < c.nodes.length; i++) {
          const part = parts[i];
          if (typeof part === 'string' && part.trim()) {
            try {
              const el = c.nodes[i].el;
              if (el.dataset.snTranslated) continue;
              const refs = c.nodes[i].refs || [];
              el.dataset.snOriginalHtml = el.innerHTML;
              el.dataset.snTranslated = '1';
              // Escape del testo dell'AI (no XSS), poi reinserimento dei placeholder
              // come HTML originale (gli outerHTML provengono dalla pagina stessa).
              const safe = escapeHtmlForTranslation(part.trim());
              const html = safe.replace(/\[\[L(\d+)\]\]/g, (_, k) => refs[Number(k)] || '');
              el.innerHTML = html;
              translatedAny = true;
            } catch (_) {}
          }
        }
      }
      if (translatedAny) {
        pageHasTranslation = true;
        Popup.showToast(I18n.t('toast_page_translated'));
      }
    } finally {
      pageTranslating = false;
    }
  }

  // Trasforma i figli del blocco in segnaposto [[Lk]] preservandoli per il rimontaggio.
  // Restituisce { templated: stringa con segnaposto, refs: array di outerHTML }.
  function templateizeBlock(el) {
    const refs = [];
    let out = '';
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.nodeValue;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const idx = refs.length;
        refs.push(child.outerHTML);
        out += `[[L${idx}]]`;
      }
    }
    return { templated: out.replace(/\s+/g, ' ').trim(), refs };
  }

  function escapeHtmlForTranslation(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  // Ripristina il testo originale annullando la traduzione di pagina.
  function restoreOriginal() {
    document.querySelectorAll('[data-sn-translated="1"]').forEach((el) => {
      if (el.dataset.snOriginalHtml !== undefined) {
        el.innerHTML = el.dataset.snOriginalHtml;
        delete el.dataset.snOriginalHtml;
      } else if (el.dataset.snOriginal !== undefined) {
        el.textContent = el.dataset.snOriginal;
        delete el.dataset.snOriginal;
      }
      delete el.dataset.snTranslated;
    });
    // Rimuovi eventuali note di traduzione (vecchio formato, retrocompatibilità)
    document.querySelectorAll('[data-sn-translation="1"]').forEach((n) => n.remove());
    pageHasTranslation = false;
    Popup.showToast(I18n.t('toast_original_restored'));
  }

  // ------------------------------------------------------------
  // Sidebar Aiuto (Fase 2)
  // ------------------------------------------------------------
  function openHelpSidebar() {
    Sidebar.open();
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
        sendResponse({ savePayload: buildSavePayload() });
        return;
      }
      handleShortcut(msg.command);
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

  function handleShortcut(command) {
    if (isBlocked()) return;
    const selInfo = Extract.getSelectionWithSentence();
    const anchor = selectionAnchor();
    if (command === 'explain-selection') {
      // La spiegazione breve ora è inline nel menu; lo shortcut apre direttamente l'approfondimento.
      if (selInfo) triggerExplainOrTranslate(ACTIONS.EXPLAIN_DEEP, selInfo, anchor);
      else Popup.showToast(I18n.t('err_no_selection'));
    } else if (command === 'translate-selection') {
      if (selInfo) triggerExplainOrTranslate(ACTIONS.TRANSLATE_SELECTION, selInfo, anchor);
      else Popup.showToast(I18n.t('err_no_selection'));
    } else if (command === 'open-help-sidebar') {
      openHelpSidebar();
    }
    // save-for-later è gestito direttamente nel background
  }

  // ------------------------------------------------------------
  // Nuove azioni globali / contestuali (riga icone + matrice contesto)
  // ------------------------------------------------------------

  async function takeScreenshot() {
    try {
      const cap = await chrome.runtime.sendMessage({ type: MSG.CAPTURE_VISIBLE_TAB });
      if (!cap?.dataUrl) {
        Popup.showToast(I18n.t('err_provider_failed'));
        return;
      }
      let copied = false;
      try {
        const pngBlob = await dataUrlToPngBlob(cap.dataUrl);
        if (pngBlob && navigator.clipboard?.write) {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
          copied = true;
        }
      } catch (_) {}
      // Toast immediato: feedback istantaneo prima che il LLM generi il nome file
      if (copied) Popup.showToast(I18n.t('toast_copied_saving'), { duration: 3000 });
      const desc = await requestImageDescription(cap.dataUrl).catch(() => null);
      try {
        chrome.runtime.sendMessage({
          type: MSG.PUSH_CLIPBOARD_ENTRY,
          entry: { type: 'image', dataUrl: cap.dataUrl, description: desc || I18n.t('clipboard_image_pending') },
        }).catch(() => {});
      } catch (_) {}
      const a = document.createElement('a');
      a.href = cap.dataUrl;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      a.download = descriptionToFilename(desc) || `screenshot-${stamp}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (_) {}
  }

  // Mostra un overlay fullscreen sopra la pagina e fa selezionare all'utente
  // un rettangolo trascinando. Risolve con { dataUrl, rect } dove dataUrl è
  // il ritaglio PNG della porzione di tab catturata, rect è in CSS pixel.
  // Risolve con null se l'utente annulla (Esc / clic senza drag / rettangolo
  // troppo piccolo). Non logga eccezioni: gli errori bubble-up come reject.
  async function selectScreenRegion() {
    const cap = await chrome.runtime.sendMessage({ type: MSG.CAPTURE_VISIBLE_TAB });
    if (!cap?.dataUrl) throw new Error('capture failed');

    // L'immagine catturata è in pixel del device; l'overlay è in pixel CSS.
    // Conserviamo la dimensione del viewport CSS qui per calcolare la scala
    // dopo aver caricato l'immagine sorgente.
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = cap.dataUrl;
    });

    return new Promise((resolve) => {
      // Cursore custom: il crosshair OS può risultare invisibile su sfondo
      // scuro/chiaro variabile (feedback alpha). Disegnamo un crosshair SVG
      // bianco con outline nero, abbastanza grande da essere sempre visibile
      // sopra la maschera semitrasparente. Hotspot al centro (16,16).
      const crosshairSvg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
        `<line x1="16" y1="2" x2="16" y2="30" stroke="black" stroke-width="3"/>` +
        `<line x1="2" y1="16" x2="30" y2="16" stroke="black" stroke-width="3"/>` +
        `<line x1="16" y1="2" x2="16" y2="30" stroke="white" stroke-width="1.5"/>` +
        `<line x1="2" y1="16" x2="30" y2="16" stroke="white" stroke-width="1.5"/>` +
        `</svg>`;
      const cursorRule = `url("data:image/svg+xml;utf8,${encodeURIComponent(crosshairSvg)}") 16 16, crosshair`;

      const overlay = document.createElement('div');
      overlay.className = 'sn-region-overlay';
      // Stili inline per evitare di dipendere da CSS esterni: l'overlay deve
      // funzionare in qualsiasi pagina, anche con CSP/style restrittivo.
      Object.assign(overlay.style, {
        position: 'fixed', inset: '0', zIndex: '2147483647',
        cursor: cursorRule, userSelect: 'none', pointerEvents: 'auto',
      });
      overlay.setAttribute('data-sn-theme', document.documentElement.dataset.snTheme || '');

      // 4 quadranti scuri intorno alla selezione (top/left/right/bottom).
      // Si aggiornano via .style.top/left/width/height durante il drag.
      // Il cursore va impostato esplicitamente sui figli: la regola CSS
      // `cursor` è ereditata, ma alcuni runtime Electron non la propagano in
      // modo affidabile durante il drag, lasciando l'utente senza riferimento
      // visivo (feedback alpha).
      const mask = ['t', 'r', 'b', 'l'].map(() => {
        const d = document.createElement('div');
        Object.assign(d.style, { position: 'absolute', background: 'rgba(0,0,0,0.45)', cursor: cursorRule });
        return d;
      });
      // All'inizio (nessun drag) tutto il viewport è coperto.
      Object.assign(mask[0].style, { left: '0', top: '0', right: '0', bottom: '0' });
      mask.forEach((d) => overlay.appendChild(d));

      const rectBox = document.createElement('div');
      Object.assign(rectBox.style, {
        position: 'absolute', border: '1px solid #fff',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
        display: 'none', pointerEvents: 'none', cursor: cursorRule,
      });
      overlay.appendChild(rectBox);

      const hint = document.createElement('div');
      hint.textContent = I18n.t('region_select_hint');
      Object.assign(hint.style, {
        position: 'absolute', left: '50%', top: '12px', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.75)', color: '#fff', font: '12px/1.4 system-ui, sans-serif',
        padding: '6px 10px', borderRadius: '6px', pointerEvents: 'none', cursor: cursorRule,
      });
      overlay.appendChild(hint);

      let startX = 0, startY = 0, curX = 0, curY = 0, dragging = false;

      function updateMask(x1, y1, x2, y2) {
        const minX = Math.min(x1, x2), minY = Math.min(y1, y2);
        const maxX = Math.max(x1, x2), maxY = Math.max(y1, y2);
        rectBox.style.display = 'block';
        rectBox.style.left = minX + 'px';
        rectBox.style.top = minY + 'px';
        rectBox.style.width = (maxX - minX) + 'px';
        rectBox.style.height = (maxY - minY) + 'px';
        // top
        Object.assign(mask[0].style, { left: '0', top: '0', width: '100%', height: minY + 'px', right: 'auto', bottom: 'auto' });
        // bottom
        Object.assign(mask[2].style, { left: '0', top: maxY + 'px', width: '100%', bottom: '0', height: 'auto', right: 'auto' });
        // left
        Object.assign(mask[3].style, { left: '0', top: minY + 'px', width: minX + 'px', height: (maxY - minY) + 'px', right: 'auto', bottom: 'auto' });
        // right
        Object.assign(mask[1].style, { left: maxX + 'px', top: minY + 'px', right: '0', height: (maxY - minY) + 'px', width: 'auto', bottom: 'auto' });
      }

      function cleanup() {
        overlay.remove();
        document.removeEventListener('keydown', onKey, true);
      }
      function cancel() {
        cleanup();
        resolve(null);
      }
      function finish() {
        const minX = Math.min(startX, curX), minY = Math.min(startY, curY);
        const maxX = Math.max(startX, curX), maxY = Math.max(startY, curY);
        const w = maxX - minX, h = maxY - minY;
        cleanup();
        if (w < 4 || h < 4) { resolve(null); return; }
        // Scala da CSS px a pixel della cattura.
        const sx = img.naturalWidth / vw;
        const sy = img.naturalHeight / vh;
        const cx = Math.round(minX * sx), cy = Math.round(minY * sy);
        const cw = Math.round(w * sx), ch = Math.round(h * sy);
        const canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        canvas.getContext('2d').drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
        canvas.toBlob((blob) => {
          if (!blob) { resolve(null); return; }
          const r = new FileReader();
          r.onload = () => resolve({ dataUrl: r.result, blob, rect: { x: minX, y: minY, w, h } });
          r.onerror = () => resolve(null);
          r.readAsDataURL(blob);
        }, 'image/png');
      }
      function onKey(e) {
        if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          cancel();
        }
      }

      overlay.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        dragging = true;
        startX = curX = e.clientX;
        startY = curY = e.clientY;
        updateMask(startX, startY, startX, startY);
      });
      overlay.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        curX = e.clientX; curY = e.clientY;
        updateMask(startX, startY, curX, curY);
      });
      overlay.addEventListener('mouseup', (e) => {
        if (!dragging) return;
        dragging = false;
        curX = e.clientX; curY = e.clientY;
        finish();
      });
      document.addEventListener('keydown', onKey, true);

      document.documentElement.appendChild(overlay);
    });
  }

  // Screenshot di una regione selezionata dall'utente. Stessi side-effect del
  // takeScreenshot pieno (download + clipboard + history clipboard).
  async function takePartialScreenshot() {
    try {
      const region = await selectScreenRegion();
      if (!region) { Popup.showToast(I18n.t('toast_region_cancelled')); return; }
      const { dataUrl, blob } = region;
      let copied = false;
      try {
        if (blob && navigator.clipboard?.write) {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          copied = true;
        }
      } catch (_) {}
      // Toast immediato: feedback istantaneo prima che il LLM generi il nome file
      if (copied) Popup.showToast(I18n.t('toast_copied_saving'), { duration: 3000 });
      const desc = await requestImageDescription(dataUrl).catch(() => null);
      try {
        chrome.runtime.sendMessage({
          type: MSG.PUSH_CLIPBOARD_ENTRY,
          entry: { type: 'image', dataUrl, description: desc || I18n.t('clipboard_image_pending') },
        }).catch(() => {});
      } catch (_) {}
      const a = document.createElement('a');
      a.href = dataUrl;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      a.download = descriptionToFilename(desc) || `screenshot-${stamp}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (_) {
      Popup.showToast(I18n.t('err_provider_failed'));
    }
  }

  // OCR: l'utente seleziona una regione dello schermo, il modello vision
  // trascrive il testo letteralmente e finisce nella clipboard come testo.
  async function transcribeRegion() {
    try {
      const region = await selectScreenRegion();
      if (!region) { Popup.showToast(I18n.t('toast_region_cancelled')); return; }
      Popup.showToast(I18n.t('toast_transcribing'), { duration: 2500 });
      const res = await chrome.runtime.sendMessage({
        type: MSG.AI_REQUEST,
        action: ACTIONS.TRANSCRIBE_IMAGE,
        payload: { dataUrl: region.dataUrl },
      });
      if (!res?.ok) { Popup.showToast(I18n.t('err_provider_failed')); return; }
      const text = (res.text || '').trim();
      if (!text) { Popup.showToast(I18n.t('toast_transcribe_empty')); return; }
      try { await navigator.clipboard.writeText(text); } catch (_) {
        // Fallback DOM se la Clipboard API è bloccata.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        ta.remove();
      }
      try { pushClipboardEntry({ type: 'text', text }); } catch (_) {}
      Popup.showToast(I18n.t('toast_transcribed'));
    } catch (_) {
      Popup.showToast(I18n.t('err_provider_failed'));
    }
  }

  // Converte un data URL (di solito JPEG) in un Blob PNG via canvas: serve per
  // la Clipboard API che accetta solo image/png.
  function dataUrlToPngBlob(dataUrl) {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.onload = () => {
          try {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            c.getContext('2d').drawImage(img, 0, 0);
            c.toBlob((b) => resolve(b), 'image/png');
          } catch (_) { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
      } catch (_) { resolve(null); }
    });
  }

  async function shareCurrentPage() {
    const data = { title: document.title, url: location.href };
    if (navigator.share) {
      try { await navigator.share(data); return; } catch (_) {}
    }
    copyToClipboard(location.href);
  }

  async function shareLink(linkEl) {
    const data = { title: linkEl.textContent?.trim() || linkEl.href, url: linkEl.href };
    if (navigator.share) {
      try { await navigator.share(data); return; } catch (_) {}
    }
    copyToClipboard(linkEl.href);
  }

  function searchTextOnWeb(text) {
    const q = encodeURIComponent((text || '').slice(0, 500));
    window.open(`https://www.google.com/search?q=${q}`, '_blank', 'noopener');
  }

  function searchImageOnWeb(imgEl) {
    const src = imgEl.currentSrc || imgEl.src;
    if (!src) return;
    const q = encodeURIComponent(src);
    // Lens-style reverse search (più affidabile di searchbyimage)
    window.open(`https://lens.google.com/uploadbyurl?url=${q}`, '_blank', 'noopener');
  }

  // ------------------------------------------------------------
  // Lettura ad alta voce (text-to-speech)
  // ------------------------------------------------------------
  // Usa l'API Web Speech del browser (speechSynthesis): gratuita, nessuna
  // chiave, voci fornite dal sistema operativo. La voce/velocità/tono preferite
  // arrivano da settings.tts (impostate in Preferenze).
  function ttsSupported() {
    return typeof window.speechSynthesis !== 'undefined'
      && typeof window.SpeechSynthesisUtterance === 'function';
  }

  // Flag interno "sto leggendo": più affidabile di synth.speaking, che su alcuni
  // motori torna false a intermittenza tra una frase e l'altra. Lo alziamo
  // all'avvio e lo abbassiamo a fine lettura, in caso di errore o su stop.
  let reading = false;

  function stopReading() {
    reading = false;
    if (!ttsSupported()) return;
    try { window.speechSynthesis.cancel(); } catch (_) {}
  }

  function readAloud(text) {
    if (!ttsSupported()) {
      Popup.showToast(I18n.t('tts_not_supported'));
      return;
    }
    const clean = String(text || '').trim();
    if (!clean) return;
    const synth = window.speechSynthesis;
    // Ferma un'eventuale lettura in corso prima di iniziarne una nuova: due
    // letture sovrapposte sono incomprensibili.
    synth.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    const tts = (settings && settings.tts) || {};
    const rate = Number(tts.rate);
    const pitch = Number(tts.pitch);
    u.rate = rate >= 0.5 && rate <= 2 ? rate : 1;
    u.pitch = pitch >= 0 && pitch <= 2 ? pitch : 1;
    if (tts.voice) {
      const voices = synth.getVoices() || [];
      const v = voices.find((vo) => vo.voiceURI === tts.voice || vo.name === tts.voice);
      if (v) { u.voice = v; u.lang = v.lang; }
    }
    // Tieni il flag allineato al ciclo di vita dell'utterance.
    u.onend = () => { reading = false; };
    u.onerror = () => { reading = false; };
    reading = true;
    // Segnala l'avvio della lettura come evento sul document (DOM condiviso):
    // hook per eventuali integrazioni e segnale osservabile a fini di test,
    // indipendente dalla presenza di un motore vocale nel sistema.
    try {
      document.dispatchEvent(new CustomEvent('filo:read-aloud', { detail: { text: clean } }));
    } catch (_) {}
    synth.speak(u);
  }

  // Voce di menu per la lettura: se sta già leggendo mostra "Interrompi
  // lettura" (simmetria: se puoi avviare la lettura, devi poterla fermare),
  // altrimenti "Leggi" il testo selezionato.
  function isReadingNow() {
    const synth = ttsSupported() ? window.speechSynthesis : null;
    return !!(synth && (synth.speaking || synth.pending));
  }

  function buildReadAloudItem(text) {
    const Icons = self.SN_ICONS;
    if (isReadingNow()) {
      return { type: 'item', icon: Icons.stopReading(18), label: I18n.t('menu_stop_reading'), onClick: () => stopReading() };
    }
    return { type: 'item', icon: Icons.readAloud(18), label: I18n.t('menu_read_aloud'), onClick: () => readAloud(text) };
  }

  // Voce "Interrompi lettura" globale: mentre una lettura è in corso deve
  // comparire in QUALSIASI menu tasto destro, anche senza testo selezionato
  // (l'utente avvia la lettura, clicca altrove e deve poterla comunque fermare).
  // Ritorna null se non sta leggendo, così i chiamanti la possono filtrare.
  function buildStopReadingItem() {
    if (!isReadingNow()) return null;
    const Icons = self.SN_ICONS;
    return { type: 'item', icon: Icons.stopReading(18), label: I18n.t('menu_stop_reading'), onClick: () => stopReading() };
  }

  // Overflow panel: ora vive come griglia di icone (sotto-menu ancorato al
  // bottone "▸"). Vedi buildGlobalIconRow + Menu.openIconGridSubmenu.

  // Decodifica un blob audio (qualunque formato che il browser sappia leggere
  // — tipicamente webm/opus prodotto da MediaRecorder) e lo ri-encoda come WAV
  // mono al sampleRate richiesto. Necessario perché la Gemini API accetta
  // wav/mp3/ogg/flac/aac/aiff ma NON webm. WAV PCM 16-bit mono a 16kHz è
  // abbondante per la voce e tiene il file piccolo (~32KB/s).
  async function audioBlobToWav(blob, targetSampleRate = 16000) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('AudioContext non disponibile');
    const arrayBuffer = await blob.arrayBuffer();
    const decoderCtx = new Ctx();
    let decoded;
    try {
      decoded = await decoderCtx.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      try { decoderCtx.close(); } catch (_) {}
    }
    const frameCount = Math.max(1, Math.ceil(decoded.duration * targetSampleRate));
    const offline = new OfflineAudioContext(1, frameCount, targetSampleRate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    let off = 0;
    const writeStr = (s) => { for (let i = 0; i < s.length; i++) view.setUint8(off++, s.charCodeAt(i)); };
    const writeU32 = (v) => { view.setUint32(off, v, true); off += 4; };
    const writeU16 = (v) => { view.setUint16(off, v, true); off += 2; };
    writeStr('RIFF');
    writeU32(36 + samples.length * 2);
    writeStr('WAVE');
    writeStr('fmt ');
    writeU32(16);
    writeU16(1);                     // PCM
    writeU16(1);                     // mono
    writeU32(targetSampleRate);
    writeU32(targetSampleRate * 2);  // byte rate (sampleRate * channels * 2)
    writeU16(2);                     // block align
    writeU16(16);                    // bits per sample
    writeStr('data');
    writeU32(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  // Item "Detta": registrazione audio via MediaRecorder + trascrizione con un
  // modello multimodale (default Gemini Flash). La freccetta apre la scelta
  // modello, popolata dinamicamente dai modelli del registry che supportano
  // input audio (per ora solo Gemini — Claude/OpenRouter chat non accettano
  // audio inline).
  function buildDictateItem() {
    const supported = typeof window !== 'undefined'
      && typeof window.MediaRecorder !== 'undefined'
      && navigator?.mediaDevices?.getUserMedia;
    return {
      type: 'split',
      icon: '🎤',
      label: I18n.t('menu_dictate'),
      onClick: () => startDictation(),
      disabled: !supported,
      arrowTitle: I18n.t('menu_dictate_model_select'),
      subItems: supported
        ? [
            { type: 'info', label: I18n.t('menu_dictate_model_select') },
            { type: 'separator' },
            ...buildDictateModelSubItems(),
          ]
        : [
            { type: 'info', label: I18n.t('menu_dictate_not_supported') },
          ],
    };
  }

  function buildDictateModelSubItems() {
    const C = self.SN_CONST;
    const registry = (settings && settings.modelRegistry) || C.DEFAULT_MODEL_REGISTRY;
    const currentRaw = (settings && settings.models && settings.models[C.ACTIONS.TRANSCRIBE_AUDIO])
      || C.DEFAULT_MODELS[C.ACTIONS.TRANSCRIBE_AUDIO];
    // Il campo può contenere più nickname (fallback): il "corrente" mostrato
    // come selezionato è il primario (il primo della lista).
    const current = C.parseModelRefs ? (C.parseModelRefs(currentRaw)[0] || currentRaw) : currentRaw;
    const items = [];
    for (const [nickname, entry] of Object.entries(registry)) {
      // Solo modelli con un binding Gemini: per ora è l'unico provider che
      // accetta audio inline tramite la stessa chat completion che usiamo.
      if (!entry || !entry.gemini) continue;
      const checked = nickname === current;
      items.push({
        label: (checked ? '✓ ' : '   ') + (entry.label || nickname),
        onClick: () => pickDictateModel(nickname),
      });
    }
    if (!items.length) {
      items.push({ type: 'info', label: I18n.t('menu_dictate_not_supported') });
    }
    return items;
  }

  async function pickDictateModel(nickname) {
    try {
      await chrome.runtime.sendMessage({
        type: MSG.UPDATE_SETTINGS,
        settings: { models: { [ACTIONS.TRANSCRIBE_AUDIO]: nickname } },
      });
      Popup.showToast(I18n.t('menu_dictate_model_set'));
    } catch (_) {
      Popup.showToast(I18n.t('err_provider_failed'));
    }
  }

  // Stato modulo per la registrazione in corso (al più una alla volta).
  let _dictateState = null;

  async function startDictation() {
    if (_dictateState) { stopDictation(); return; }
    if (typeof window.MediaRecorder === 'undefined' || !navigator?.mediaDevices?.getUserMedia) {
      Popup.showToast(I18n.t('menu_dictate_not_supported'));
      return;
    }
    if (!restorePasteContext()) {
      Popup.showToast(I18n.t('err_provider_failed'));
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (_) {
      Popup.showToast(I18n.t('menu_dictate_no_mic'));
      return;
    }
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = '';
    let rec;
    try {
      rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (_) {
      try { stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      Popup.showToast(I18n.t('err_provider_failed'));
      return;
    }
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    // Pill cliccabile per fermare la registrazione (il toast non è cliccabile).
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'sn-dictate-pill';
    pill.textContent = I18n.t('menu_dictate_listening');
    document.documentElement.appendChild(pill);

    const cleanup = () => {
      try { stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      if (pill.parentNode) pill.remove();
      _dictateState = null;
    };

    rec.onstop = async () => {
      try {
        const raw = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        if (!raw.size) { Popup.showToast(I18n.t('menu_dictate_empty')); cleanup(); return; }
        if (pill.parentNode) pill.remove();
        Popup.showToast(I18n.t('menu_dictate_transcribing'), { duration: 2500 });
        // Gemini accetta wav/mp3/ogg/flac/aac/aiff ma non webm: riencodiamo in
        // WAV mono 16kHz (più che sufficiente per voce, file piccolo).
        const wav = await audioBlobToWav(raw, 16000).catch(() => null);
        if (!wav) { Popup.showToast(I18n.t('err_provider_failed')); cleanup(); return; }
        const dataUrl = await blobToDataUrl(wav);
        const res = await chrome.runtime.sendMessage({
          type: MSG.AI_REQUEST,
          action: ACTIONS.TRANSCRIBE_AUDIO,
          payload: { dataUrl, lang: navigator.language || 'it-IT' },
        });
        cleanup();
        if (!res?.ok) { Popup.showToast(I18n.t('err_provider_failed')); return; }
        const text = (res.text || '').trim();
        if (!text) { Popup.showToast(I18n.t('menu_dictate_empty')); return; }
        restorePasteContext();
        insertTextAtSelection(text + ' ');
      } catch (_) {
        Popup.showToast(I18n.t('err_provider_failed'));
        cleanup();
      }
    };

    pill.addEventListener('click', () => stopDictation());

    _dictateState = { rec, stream, pill };
    try { rec.start(); } catch (_) { cleanup(); Popup.showToast(I18n.t('err_provider_failed')); return; }
    // Safety: stop forzato dopo 60s per non lasciare il mic aperto.
    const t = rec;
    setTimeout(() => { if (_dictateState && _dictateState.rec === t) stopDictation(); }, 60_000);
  }

  function stopDictation() {
    if (!_dictateState) return;
    try { _dictateState.rec.stop(); } catch (_) {}
  }

  // Sezione inline "Spiega immagine": stessa filosofia di buildInlineExplain ma con dataUrl.
  function buildInlineExplainImage(imgEl) {
    return {
      type: 'inline',
      content: I18n.t('menu_explain_loading'),
      onMount: (el) => {
        el.classList.add('sn-menu-inline-loading');
        const src = imgEl.currentSrc || imgEl.src;
        if (!src) {
          el.textContent = I18n.t('err_provider_failed');
          el.classList.remove('sn-menu-inline-loading');
          el.classList.add('sn-menu-inline-error');
          return () => {};
        }
        let cancelled = false;
        (async () => {
          try {
            const r = await fetch(src);
            const blob = await r.blob();
            const dataUrl = await blobToDataUrl(blob);
            if (cancelled) return;
            const res = await chrome.runtime.sendMessage({
              type: MSG.AI_REQUEST,
              action: ACTIONS.DESCRIBE_IMAGE,
              payload: { dataUrl },
            });
            if (cancelled) return;
            el.classList.remove('sn-menu-inline-loading');
            if (!res?.ok || !res.text) {
              el.classList.add('sn-menu-inline-error');
              el.textContent = res?.error || I18n.t('err_provider_failed');
              return;
            }
            el.textContent = res.text;
          } catch (e) {
            if (cancelled) return;
            el.classList.remove('sn-menu-inline-loading');
            el.classList.add('sn-menu-inline-error');
            el.textContent = I18n.t('err_provider_failed');
          }
        })();
        return () => { cancelled = true; };
      },
    };
  }

  // Sezione inline "Spiega link": niente apertura del link, solo metadati OG e dominio.
  function buildInlineExplainLink(linkEl) {
    return {
      type: 'inline',
      content: I18n.t('menu_link_loading'),
      onMount: (el) => {
        el.classList.add('sn-menu-inline-loading');
        let cancelled = false;
        (async () => {
          const url = linkEl.href;
          const anchorText = (linkEl.textContent || '').trim().slice(0, 200);
          const flags = analyzeLinkSuspicious(url);

          // Fetch leggero dei metadati OG via background (CORS-safe). Saltato se url sospetto in modo grave.
          let ogTitle = '', ogDescription = '';
          if (!flags.includes('side_effect')) {
            try {
              const r = await chrome.runtime.sendMessage({ type: 'fetch_link_meta', url });
              if (r?.ok) { ogTitle = r.ogTitle || ''; ogDescription = r.ogDescription || ''; }
            } catch (_) {}
          }
          if (cancelled) return;

          // Streaming spiegazione via AI
          let port;
          try {
            port = chrome.runtime.connect({ name: self.SN_MSG.PORTS.AI_STREAM });
          } catch (_) {
            el.classList.remove('sn-menu-inline-loading');
            el.classList.add('sn-menu-inline-error');
            el.textContent = I18n.t('err_provider_failed');
            return;
          }
          let buf = '';
          let firstDelta = true;
          let warned = false;
          port.onMessage.addListener((m) => {
            if (m.type === 'delta') {
              if (firstDelta) {
                el.classList.remove('sn-menu-inline-loading');
                el.textContent = '';
                if (flags.length && !warned) {
                  const w = document.createElement('div');
                  w.className = 'sn-menu-link-warn';
                  w.textContent = I18n.t('menu_link_suspicious') + ': ' + flags.join(', ');
                  el.appendChild(w);
                  warned = true;
                }
                firstDelta = false;
              }
              buf += m.delta;
              // Sicurezza: niente HTML, è testo.
              const txt = document.createElement('div');
              txt.textContent = buf;
              el.querySelector('.sn-menu-link-body')?.remove();
              txt.className = 'sn-menu-link-body';
              el.appendChild(txt);
            } else if (m.type === 'error') {
              el.classList.remove('sn-menu-inline-loading');
              el.classList.add('sn-menu-inline-error');
              el.textContent = m.message || I18n.t('err_provider_failed');
            }
          });
          port.postMessage({
            type: 'start',
            action: ACTIONS.EXPLAIN_LINK,
            payload: { url, anchorText, ogTitle, ogDescription, suspiciousFlags: flags },
            origin: location.href,
          });
        })();
        return () => { cancelled = true; };
      },
    };
  }

  // Euristica sicurezza link: pattern noti pericolosi (unsubscribe/logout/delete/confirm/token)
  // e typosquatting grossolano su domini popolari. Restituisce array di flag.
  function analyzeLinkSuspicious(rawUrl) {
    const flags = [];
    let u;
    try { u = new URL(rawUrl); } catch (_) { return ['url_invalido']; }
    const path = (u.pathname + '?' + u.search).toLowerCase();
    const sideEffectPatterns = /(^|[/?&=])(unsubscribe|optout|opt-out|logout|signout|sign-out|delete|remove|confirm|verify|reset|cancel)([/?&=]|$)/;
    if (sideEffectPatterns.test(path)) flags.push('side_effect');
    if (/[?&](token|key|sig|signature|hash|t)=/.test(path)) flags.push('token_in_url');

    const POPULAR = ['google.com', 'amazon.com', 'amazon.it', 'apple.com', 'microsoft.com', 'facebook.com', 'youtube.com', 'paypal.com', 'netflix.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com', 'github.com'];
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    for (const p of POPULAR) {
      if (host === p) break;
      if (host.endsWith('.' + p)) break;
      // typosquatting: distanza Levenshtein ≤ 2 sul dominio principale
      if (levenshteinSmall(host, p, 2)) { flags.push('typosquatting:' + p); break; }
    }
    return flags;
  }

  // Levenshtein limitata a `max` (early-exit). True se distance ≤ max e ≥ 1.
  function levenshteinSmall(a, b, max) {
    if (a === b) return false;
    if (Math.abs(a.length - b.length) > max) return false;
    const m = a.length, n = b.length;
    if (m === 0 || n === 0) return false;
    const prev = new Array(n + 1);
    const cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      let rowMin = cur[0];
      for (let j = 1; j <= n; j++) {
        const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return false;
      for (let j = 0; j <= n; j++) prev[j] = cur[j];
    }
    const d = prev[n];
    return d >= 1 && d <= max;
  }

  // ------------------------------------------------------------
  // Box "Modifica" (preview + conferma, mai sovrascrittura cieca)
  // ------------------------------------------------------------
  // Apre un overlay modale (HTML), mostra originale + proposta con diff, e
  // azioni esplicite [Sostituisci] / [Copia la nuova] / [Annulla]. Scorciatoie
  // pronte (più formale / informale / riassumi / traduci / correggi) + campo
  // libero per istruzioni arbitrarie.
  function openEditBox(originalText) {
    if (!pasteContext) {
      // Rivalido al volo: senza editable il "Sostituisci" non avrebbe senso.
      Popup.showToast(I18n.t('err_no_selection'));
      return;
    }
    const savedCtx = pasteContext; // congelo il riferimento per il momento del replace

    const root = document.createElement('div');
    root.className = 'sn-editbox-overlay';
    root.dataset.snTheme = document.documentElement.dataset.snTheme || '';
    root.innerHTML = `
      <div class="sn-editbox" role="dialog" aria-label="${I18n.t('edit_box_title')}">
        <div class="sn-editbox-header">${I18n.t('edit_box_title')}</div>
        <div class="sn-editbox-shortcuts">
          <button type="button" data-sc="formal">${I18n.t('edit_box_shortcut_formal')}</button>
          <button type="button" data-sc="casual">${I18n.t('edit_box_shortcut_casual')}</button>
          <button type="button" data-sc="summarize">${I18n.t('edit_box_shortcut_summarize')}</button>
          <button type="button" data-sc="translate">${I18n.t('edit_box_shortcut_translate')}</button>
          <button type="button" data-sc="fix">${I18n.t('edit_box_shortcut_fix')}</button>
        </div>
        <input type="text" class="sn-editbox-instruction" placeholder="${I18n.t('edit_box_instruction_placeholder')}">
        <div class="sn-editbox-panels">
          <div class="sn-editbox-panel">
            <div class="sn-editbox-label">${I18n.t('edit_box_original')}</div>
            <div class="sn-editbox-original"></div>
          </div>
          <div class="sn-editbox-panel">
            <div class="sn-editbox-label">${I18n.t('edit_box_proposed')}</div>
            <div class="sn-editbox-proposed sn-editbox-empty">${I18n.t('edit_box_loading')}</div>
          </div>
        </div>
        <div class="sn-editbox-footer">
          <button type="button" class="sn-editbox-cancel">${I18n.t('edit_box_cancel')}</button>
          <button type="button" class="sn-editbox-copy" disabled>${I18n.t('edit_box_copy_new')}</button>
          <button type="button" class="sn-editbox-replace" disabled>${I18n.t('edit_box_replace')}</button>
        </div>
      </div>
    `;
    document.documentElement.appendChild(root);

    const $orig = root.querySelector('.sn-editbox-original');
    const $prop = root.querySelector('.sn-editbox-proposed');
    const $instr = root.querySelector('.sn-editbox-instruction');
    const $cancel = root.querySelector('.sn-editbox-cancel');
    const $copy = root.querySelector('.sn-editbox-copy');
    const $replace = root.querySelector('.sn-editbox-replace');

    $orig.textContent = originalText;
    $instr.focus();

    const SHORTCUTS = {
      formal: 'Rendi il testo più formale, mantenendo il significato.',
      casual: 'Rendi il testo più informale e amichevole.',
      summarize: 'Riassumi il testo mantenendo i punti principali.',
      translate: 'Traduci il testo in inglese.',
      fix: 'Correggi eventuali errori grammaticali e di ortografia, senza alterare il senso.',
    };
    root.querySelectorAll('.sn-editbox-shortcuts button').forEach((b) => {
      b.addEventListener('click', () => {
        const k = b.dataset.sc;
        $instr.value = SHORTCUTS[k] || '';
        runEdit();
      });
    });

    let currentResult = '';
    let inFlight = false;
    async function runEdit() {
      const instruction = $instr.value.trim();
      if (!instruction || inFlight) return;
      inFlight = true;
      $prop.classList.add('sn-editbox-empty');
      $prop.textContent = I18n.t('edit_box_loading');
      $copy.disabled = true;
      $replace.disabled = true;
      try {
        const res = await chrome.runtime.sendMessage({
          type: MSG.AI_REQUEST,
          action: ACTIONS.EDIT_TEXT,
          payload: { original: originalText, instruction },
        });
        if (!res?.ok || !res.text) {
          $prop.textContent = res?.error || I18n.t('edit_box_error');
          return;
        }
        currentResult = res.text.trim();
        $prop.classList.remove('sn-editbox-empty');
        renderDiff($prop, originalText, currentResult);
        $copy.disabled = false;
        $replace.disabled = false;
      } catch (_) {
        $prop.textContent = I18n.t('edit_box_error');
      } finally {
        inFlight = false;
      }
    }

    $instr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        runEdit();
      } else if (e.key === 'Escape') {
        close();
      }
    });
    $cancel.addEventListener('click', close);
    $copy.addEventListener('click', () => {
      navigator.clipboard.writeText(currentResult).then(() => {
        Popup.showToast(I18n.t('toast_copied'));
        close();
      }, () => Popup.showToast(I18n.t('err_provider_failed')));
    });
    $replace.addEventListener('click', () => {
      pasteContext = savedCtx;
      restorePasteContext();
      // In input/textarea sostituisco il range salvato; in contenteditable uso execCommand insertText
      // dopo aver ripristinato la selezione originale, così Ctrl+Z funziona.
      if (savedCtx.kind === 'input') {
        const el = savedCtx.el;
        const start = savedCtx.start, end = savedCtx.end;
        el.value = el.value.slice(0, start) + currentResult + el.value.slice(end);
        const caret = start + currentResult.length;
        el.setSelectionRange(start, caret);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (savedCtx.kind === 'ce') {
        try { document.execCommand('insertText', false, currentResult); } catch (_) {}
      }
      Popup.showToast(I18n.t('edit_box_replaced'));
      close();
    });

    function close() {
      try { root.remove(); } catch (_) {}
      document.removeEventListener('keydown', onDocKey, true);
    }
    const onDocKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onDocKey, true);
    root.addEventListener('mousedown', (e) => {
      if (e.target === root) close(); // click fuori dal box
    });

    // Avvia subito una proposta neutra (rifrasi), così l'utente vede già qualcosa.
    $instr.value = '';
    // No autorun — l'utente deve dare istruzione esplicita.
    $prop.textContent = '—';
  }

  // Diff parola-per-parola: ricostruisce il testo proposto evidenziando aggiunte
  // (verde) e rimozioni (rosso barrato). Algoritmo LCS semplice sulle parole.
  function renderDiff(container, original, proposed) {
    container.innerHTML = '';
    const a = original.split(/(\s+)/);
    const b = proposed.split(/(\s+)/);
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
        else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    const ops = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) { ops.push({ op: 'eq', t: a[i - 1] }); i--; j--; }
      else if (dp[i - 1][j] >= dp[i][j - 1]) { ops.push({ op: 'del', t: a[i - 1] }); i--; }
      else { ops.push({ op: 'add', t: b[j - 1] }); j--; }
    }
    while (i > 0) { ops.push({ op: 'del', t: a[i - 1] }); i--; }
    while (j > 0) { ops.push({ op: 'add', t: b[j - 1] }); j--; }
    ops.reverse();
    for (const o of ops) {
      if (o.op === 'eq') {
        container.appendChild(document.createTextNode(o.t));
      } else if (o.op === 'add') {
        const s = document.createElement('span');
        s.className = 'sn-diff-add';
        s.textContent = o.t;
        container.appendChild(s);
      } else {
        const s = document.createElement('span');
        s.className = 'sn-diff-del';
        s.textContent = o.t;
        container.appendChild(s);
      }
    }
  }

  // ------------------------------------------------------------
  init();
})();
