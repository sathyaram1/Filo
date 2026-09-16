// Azioni del content script: appunti (copia, taglia, incolla e cronologia), screenshot e ritagli, OCR, salva/condividi/cerca, color picker, QR, spiegazioni inline e analisi dei link sospetti.
// I preload lo caricano prima di content.js, che poi chiama init() passandogli le dipendenze che restano sue: il pasteContext catturato all'apertura del menu, isBlocked e l'ultimo evento del mouse per ancorare i popup.

(function (global) {
  'use strict';

  const { ACTIONS } = global.SN_CONST;
  const { MSG } = global.SN_MSG;
  const I18n = global.SN_I18N;
  const Popup = global.SN_POPUP;
  const Extract = global.SN_EXTRACT;
  // Le scorciatoie si NOMINANO da qui: su Mac hanno un'altra forma e scriverle
  // a mano è il modo con cui il menu del tasto destro è tornato a mentire.
  const Tasti = global.SN_TASTI;

  // Dipendenze iniettate da content.js (vedi init in fondo).
  let deps = {
    getPasteContext: () => null,
    restorePasteContext: () => false,
    isBlocked: () => false,
    getLastMouseEvent: () => ({ clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 }),
  };

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(
      () => {
        Popup.showToast(I18n.t('toast_copied'));
        pushClipboardEntry({ type: 'text', text });
      },
      () => {/* niente toast su errore — UX silenziosa */}
    );
  }

  // #437 — «Copia URL» copia un INDIRIZZO: se quello che il sito ha messo lì non lo è (un `javascript:`, un `data:` lunghissimo, un `blob:` che muore con la pagina, o niente affatto) negli appunti finirebbe una stringa che non apre nulla da nessuna parte, senza che niente lo dica.
  function isAddress(url) {
    const raw = String(url || '').trim();
    // Senza il modulo condiviso non peggioriamo il comportamento storico.
    if (!global.SN_URL_NAV) return !!raw;
    return global.SN_URL_NAV.isShareableAddress(raw);
  }

  function copyUrlToClipboard(url) {
    if (!isAddress(url)) {
      Popup.showToast(I18n.t('toast_not_an_address'));
      return false;
    }
    copyToClipboard(String(url).trim());
    return true;
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

  // Descrizione provvisoria per un'immagine prima che arrivi quella generata
  // dall'AI (o il perché non arriverà: vedi imagePlaceholderLabel).
  async function describeImage(_blob) {
    return imagePlaceholderLabel();
  }

  async function pasteFromClipboard() {
    deps.restorePasteContext();
    try {
      if (navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const it of items) {
          const imgType = it.types.find((t) => t.startsWith('image/'));
          if (imgType) {
            const blob = await it.getType(imgType);
            const dataUrl = await blobToDataUrl(blob);
            deps.restorePasteContext();
            const ctx = deps.getPasteContext();
            const targetKind = ctx?.kind;
            if (targetKind === 'input') {
              // input/textarea non supportano immagini: prova a delegare ad
              // un handler custom (es. il modal feedback) via evento bubbling.
              const pasteEvt = new CustomEvent('filo:paste-image', {
                bubbles: true, cancelable: true, detail: { blob },
              });
              if (ctx.el && ctx.el.dispatchEvent(pasteEvt) === false) {
                return;
              }
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
    }
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      deps.restorePasteContext();
      insertTextAtSelection(text);
      pushClipboardEntry({ type: 'text', text });
    } catch (_) {}
  }

  async function pasteHistoryEntry(entry) {
    if (!entry) return;
    // Il background fa dedup e promuove. Non passiamo da pushClipboardEntry() per non ri-chiedere all'AI la descrizione di un'immagine già descritta.
    chrome.runtime.sendMessage({ type: MSG.PUSH_CLIPBOARD_ENTRY, entry }).catch(() => {});
    deps.restorePasteContext();
    const ctx = deps.getPasteContext();
    if (entry.type === 'image') {
      // Le immagini in cronologia sono offline (dataUrl in storage): niente provider.
      let blob = null;
      try { blob = await (await fetch(entry.dataUrl)).blob(); } catch (_) {}

      // input e textarea non accettano <img>: come in pasteFromClipboard si delega con l'evento 'filo:paste-image', così chi ha un handler dedicato (modale feedback, barra della dashboard) può allegarla.
      // Senza la delega, l'incolla dalla cronologia falliva ovunque Ctrl+V su immagine funziona.
      if (ctx?.kind === 'input' && blob) {
        const pasteEvt = new CustomEvent('filo:paste-image', {
          bubbles: true, cancelable: true, detail: { blob },
        });
        if (ctx.el.dispatchEvent(pasteEvt) === false) {
          Popup.showToast(I18n.t('toast_pasted_image'));
          return;
        }
        Popup.showToast(I18n.t('toast_cannot_paste_image'));
        return;
      }
      if (ctx?.kind !== 'ce') {
        Popup.showToast(I18n.t('toast_cannot_paste_image'));
        return;
      }
      const ok = insertImageInEditable(blob, entry.dataUrl, descriptionToFilename(entry.description));
      if (ok) Popup.showToast(I18n.t('toast_pasted_image'));
      else Popup.showToast(I18n.t('toast_paste_failed'));
      return;
    }
    insertTextAtSelection(entry.text || '');
  }

  // Tre strategie in sequenza: (1) evento paste sintetico, necessario agli editor moderni (Gmail, Slate, Lexical, ProseMirror) che hanno un handler paste e ignorerebbero execCommand o le modifiche dirette al DOM;
  // (2) execCommand 'insertImage'; (3) inserimento manuale via Range.
  function insertImageInEditable(blob, dataUrl, fileName) {
    const ctx = deps.getPasteContext();
    if (!ctx || ctx.kind !== 'ce') return false;
    const el = ctx.el;
    if (!el || !el.isConnected) return false;
    el.focus();
    const sel = window.getSelection();
    if (ctx.range) {
      try {
        sel.removeAllRanges();
        sel.addRange(ctx.range);
      } catch (_) {}
    }

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
        if (!notCancelled) return true;
      } catch (_) {}
    }

    try {
      if (document.execCommand('insertImage', false, dataUrl)) return true;
    } catch (_) {}

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
      ctx.range = range.cloneRange();
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
      return true;
    } catch (_) {}

    return false;
  }

  function insertTextAtSelection(text) {
    const ctx = deps.getPasteContext();
    if (!ctx) return;
    const { kind, el } = ctx;
    if (!el || !el.isConnected) return;
    if (kind === 'input') {
      const start = ctx.start ?? el.value.length;
      const end = ctx.end ?? el.value.length;
      el.value = el.value.slice(0, start) + text + el.value.slice(end);
      const caret = start + text.length;
      el.setSelectionRange(caret, caret);
      ctx.start = caret;
      ctx.end = caret;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (kind === 'ce') {
      el.focus();
      // La selezione salvata all'apertura del menu va ripristinata PRIMA di inserire: il click sul bottone sposta il focus, e sugli editor moderni (ProseMirror di claude.ai, Lexical, Slate) execCommand inseriva a fine testo invece che al caret.
      const sel = window.getSelection();
      if (ctx.range && el.contains(ctx.range.startContainer)) {
        try {
          sel.removeAllRanges();
          sel.addRange(ctx.range);
        } catch (_) {}
      }
      // Gli editor «controllati» leggono la loro selezione interna, mantenuta anche dopo il blur, e inseriscono nel punto giusto; execCommand su quegli editor finiva in coda.
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
      if (!handled) {
        try { document.execCommand('insertText', false, text); } catch (_) {}
      }
    }
  }

  // Riallinea il contesto di incolla alla posizione CORRENTE del cursore nello stesso campo. Serve alla dettatura, che dura a lungo: nel frattempo l'utente continua a scrivere o sposta il cursore,
  // e senza questo il testo trascritto atterrerebbe dove il menu era stato aperto, spaccando in due quello che ha digitato.
  function refreshPasteContextLive() {
    const ctx = deps.getPasteContext();
    if (!ctx) return;
    const { kind, el } = ctx;
    if (!el || !el.isConnected) return;
    if (kind === 'input') {
      // selectionStart/End di input/textarea persistono anche dopo il blur:
      // riflettono l'ultima posizione scelta dall'utente nel campo.
      const start = el.selectionStart;
      const end = el.selectionEnd;
      if (start != null && end != null) { ctx.start = start; ctx.end = end; }
    } else if (kind === 'ce') {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0);
        // Solo se la selezione viva è ancora dentro il nostro campo: se il
        // focus è finito altrove, teniamo il range catturato come fallback.
        if (el.contains(r.startContainer)) ctx.range = r.cloneRange();
      }
    }
  }

  // La dettatura arriva molto dopo il click, a differenza di «Incolla»: prima di inserire si riallinea la posizione a dov'è il cursore ADESSO.
  function insertDictatedText(text) {
    refreshPasteContextLive();
    deps.restorePasteContext();
    insertTextAtSelection(text);
  }

  function buildPasteItem(clipboardHistory) {
    return {
      type: 'paste',
      label: I18n.t('menu_paste'),
      shortcut: Tasti.etichetta('Ctrl+V'),
      history: clipboardHistory,
      onClick: () => pasteFromClipboard(),
      onPickHistory: (entry) => pasteHistoryEntry(entry),
      onRemoveHistory: (entry) => removeClipboardEntry(entry),
      onClearHistory: () => clearClipboardHistory(),
    };
  }

  function removeClipboardEntry(entry) {
    chrome.runtime.sendMessage({ type: MSG.REMOVE_CLIPBOARD_ENTRY, entry }).catch(() => {});
  }

  function clearClipboardHistory() {
    chrome.runtime.sendMessage({ type: MSG.CLEAR_CLIPBOARD_HISTORY }).catch(() => {});
  }

  async function getClipboardHistory() {
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.GET_CLIPBOARD_HISTORY });
      return r?.items || [];
    } catch (_) { return []; }
  }

  // Stato di navigazione del tab: serve a mostrare in grigio avanti e indietro nel menu quando la cronologia non lo consente, come già fanno i tasti nella barra in alto.
  async function getNavState() {
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.NAV_STATE });
      return { canBack: !!r?.canBack, canFwd: !!r?.canFwd };
    } catch (_) { return { canBack: true, canFwd: true }; }
  }

  function pushClipboardEntry(entry) {
    chrome.runtime.sendMessage({ type: MSG.PUSH_CLIPBOARD_ENTRY, entry }).catch(() => {});
    if (entry?.type === 'image' && entry.dataUrl) {
      requestImageDescription(entry.dataUrl).catch(() => {});
    }
  }

  // L'avviso «questa funzione non ha un modello» si mostra una volta sola finché la pagina resta aperta: la descrizione parte da sola a ogni immagine, ripetere il toast sarebbe rumore e tacere sarebbe il ripiego muto di prima.
  const modelConfigWarned = new Set();
  function warnModelConfigOnce(message) {
    if (!message || modelConfigWarned.has(message)) return;
    modelConfigWarned.add(message);
    try { Popup.showToast(message, { duration: 7000 }); } catch (_) {}
  }

  // «Descrizione…» solo finché una descrizione può davvero arrivare, altrimenti si dice che manca il modello: un'attesa che non finirà mai è una bugia.
  let imageDescNoModel = false;
  function imagePlaceholderLabel() {
    return I18n.t(imageDescNoModel ? 'clipboard_image_no_model' : 'clipboard_image_pending');
  }

  async function requestImageDescription(dataUrl) {
    // NIENTE modello di ripiego scritto qui: gli unici ammessi sono quelli configurati per questa funzione, e il ripiego VOLUTO vive nel main, dentro la catena.
    // Senza modello — o con una scorciatoia che non esiste — la descrizione non si fa e l'utente lo viene a sapere, invece di riceverla da un modello che nessuno ha scelto.
    let res;
    try {
      res = await chrome.runtime.sendMessage({
        type: MSG.AI_REQUEST,
        action: ACTIONS.DESCRIBE_IMAGE,
        payload: { dataUrl },
      });
    } catch (e) {
      res = { ok: false, error: e.message || String(e) };
    }
    if (!res?.ok) {
      if (res?.code === 'NO_MODEL_FOR_ACTION' && res.error) {
        imageDescNoModel = true;
        warnModelConfigOnce(res.error);
        // La voce in cronologia incolla resterebbe su «Descrizione…» per
        // sempre: dille la verità invece di far finta che stia arrivando.
        chrome.runtime.sendMessage({
          type: MSG.UPDATE_CLIPBOARD_DESCRIPTION,
          dataUrl,
          description: I18n.t('clipboard_image_no_model'),
        }).catch(() => {});
      }
      console.warn('[SN] descrizione immagine non eseguita:', res?.error || 'errore sconosciuto');
      return null;
    }
    imageDescNoModel = false;
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

  // Il riquadro si stacca dalla PAROLA, non da un punto: una parola ha un'altezza, e ancorato al solo punto di partenza copriva la metà bassa delle lettere, rendendo illeggibile proprio la parola che si stava spiegando.
  // Il rettangolo viene dalla selezione, la stessa per la scorciatoia e per la freccetta del tasto destro, che così si comportano uguale; senza una selezione misurabile restano il punto del puntatore e il vecchio comportamento.
  function ancoraSelezione(anchorEvent) {
    const x = Number.isFinite(anchorEvent?.clientX) ? anchorEvent.clientX : 0;
    const y = Number.isFinite(anchorEvent?.clientY) ? anchorEvent.clientY : 0;
    const ancora = { x, y, top: y, bottom: y };
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        if (r.width || r.height) { ancora.top = r.top; ancora.bottom = r.bottom; }
      }
    } catch (_) {}
    return ancora;
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
      anchor: ancoraSelezione(anchorEvent),
      title,
    });
  }

  function triggerExplainDeep(selInfo, anchorEvent) {
    triggerExplainOrTranslate(ACTIONS.EXPLAIN_DEEP, selInfo, anchorEvent);
  }

  // Sezione inline: parte subito una EXPLAIN e il risultato compare nel menu; «NESSUNA SPIEGAZIONE» nasconde la sezione.
  // Prefetch alla selezione del testo: quando poi si apre il menu il risultato è già in cache e il box lo mostra subito invece di aspettare il provider.
  // Debounce 400ms (selectionchange spara molto durante il trascinamento), dedup per chiave selezione, niente prefetch a tab nascosto, dominio bloccato o selezione troppo corta, una sola entry attiva: la selezione cambia in fretta e una cache larga non serve.
  let prefetchedExplain = null; // { key, sentence, promise<{text}|{error}> }
  let prefetchTimer = null;

  function explainKey(text) { return (text || '').trim().slice(0, 2000); }

  function schedulePrefetchExplain() {
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(prefetchExplainNow, 400);
  }

  function prefetchExplainNow() {
    if (deps.isBlocked()) return;
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
      subject: 'text',
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
          arrow.title = Tasti.frase(I18n.t('menu_explain_deep'), 'Alt+E');
          arrow.textContent = '▸';
          arrow.addEventListener('click', (e) => {
            e.stopPropagation();
            try { global.SN_MENU?.close?.(); } catch (_) {}
            triggerExplainDeep(selInfo, deps.getLastMouseEvent());
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

  function buildInlineExplainImage(imgEl) {
    return {
      type: 'inline',
      subject: 'image',
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

  function buildInlineExplainLink(linkEl) {
    return {
      type: 'inline',
      subject: 'link',
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

          let port;
          try {
            port = chrome.runtime.connect({ name: global.SN_MSG.PORTS.AI_STREAM });
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
            } else if (m.type === 'reset') {
              // Provider caduto a metà risposta, si riparte col fallback:
              // butta il testo parziale (l'avviso sicurezza resta).
              buf = '';
              el.querySelector('.sn-menu-link-body')?.remove();
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

  // Si cattura solo dopo che il compositor ha ripresentato la pagina: il menu viene rimosso dal DOM in modo sincrono, ma capturePage fotografa il frame del compositor, non ancora ridisegnato, e il menu finiva stampato dentro l'immagine (miniature, screenshot, ritagli).
  // Doppio requestAnimationFrame: il primo apre il frame che incorpora la rimozione, il secondo gira quando quel frame è committato; il piccolo timeout copre la presentazione fuori processo prima dello scatto.
  async function captureVisibleTab() {
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 50)));
    });
    return chrome.runtime.sendMessage({ type: MSG.CAPTURE_VISIBLE_TAB });
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
    // Il salvataggio si committa SUBITO, prima di qualsiasi attesa: la cattura della miniatura aspetta ~120ms che il menu sparisca, e se in quella finestra la pagina fa un redirect il contesto del content script muore e il messaggio non parte più — l'utente crederebbe di aver salvato, senza alcun avviso (#334).
    // Quindi SAVE_PAGE parte sincrono al click, prima di ogni await; la miniatura arriva dopo ed è best-effort.
    const base = buildSavePayload();
    let entry = null;
    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.SAVE_PAGE, page: base });
      if (!res?.ok) {
        Popup.showToast(I18n.t('toast_save_failed'));
        return;
      }
      entry = res.entry;
    } catch (e) {
      // Contesto distrutto da un redirect immediato o errore IPC: avvisa
      // invece di fallire in silenzio.
      console.error('[SN] savePage', e);
      Popup.showToast(I18n.t('toast_save_failed'));
      return;
    }

    // La cattura DEVE precedere il toast di conferma, o il toast finisce dentro la miniatura (#325). Se la pagina è già cambiata la cattura può fallire: il salvataggio resta valido, solo senza anteprima.
    let thumbnail = '';
    try {
      const cap = await captureVisibleTab();
      thumbnail = cap?.dataUrl || '';
    } catch (_) { /* miniatura opzionale */ }

    if (thumbnail && entry?.id) {
      chrome.runtime.sendMessage({
        type: MSG.SET_SAVED_PAGE_THUMB,
        id: entry.id,
        thumbnail,
      }).catch(() => {});
    }

    // Conferma CLICCABILE che porta alla lista (#252): il vecchio toast muto si chiudeva in 600ms, troppo rapido per farci qualcosa.
    showSaveConfirm(entry);
  }

  // Riquadro di conferma di «Salva per dopo» (#252): la scheda salvata sta per chiudersi, e prima di farlo si danno qualche secondo per raggiungere la lista dove la pagina è finita.
  // Cliccandolo si apre «Aperti per dopo» con la scheda evidenziata; ignorandolo si chiude da sola. È l'unico modo di far scoprire la lista proprio quando serve, senza aggiungere voci di menu.
  function showSaveConfirm(entry) {
    const AUTO_CLOSE_MS = 4000;
    let done = false;
    let timer = null;

    const pill = document.createElement('div');
    pill.className = 'sn-save-confirm';
    pill.setAttribute('role', 'button');
    pill.tabIndex = 0;
    const text = document.createElement('span');
    text.className = 'sn-save-confirm-text';
    text.textContent = I18n.t('toast_saved', (entry && entry.category) || I18n.t('category_default'));
    const cta = document.createElement('span');
    cta.className = 'sn-save-confirm-cta';
    cta.textContent = I18n.t('toast_saved_open');
    pill.appendChild(text);
    pill.appendChild(cta);
    // Nello stack degli avvisi in pagina (#409). `sticky`: porta l'unica strada
    // verso la lista "Aperti per dopo", un toast in arrivo non deve sfrattarla.
    Popup.mountToast(pill, { sticky: true });
    requestAnimationFrame(() => pill.classList.add('sn-save-confirm-visible'));

    const finish = (openList) => {
      if (done) return;
      done = true;
      if (timer) { clearTimeout(timer); timer = null; }
      pill.dataset.snClosing = '1';
      pill.classList.remove('sn-save-confirm-visible');
      setTimeout(() => { try { Popup.unmountToast(pill); } catch (_) {} }, 220);
      if (openList && entry && entry.id) {
        chrome.runtime.sendMessage({ type: MSG.OPEN_HOME, highlight: entry.id }).catch(() => {});
      }
      chrome.runtime.sendMessage({ type: MSG.CLOSE_TAB }).catch(() => {});
    };

    pill.addEventListener('click', () => finish(true));
    pill.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish(true); }
    });
    timer = setTimeout(() => finish(false), AUTO_CLOSE_MS);
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

  async function downloadImage(imgEl) {
    const src = imgEl.currentSrc || imgEl.src;
    if (!src) return;
    // data: e blob: nascono nella pagina stessa: lì Chromium onora l'attributo download di un <a>, e il main non saprebbe risolverli — restano sul cammino anchor.
    if (/^(data:|blob:)/i.test(src)) {
      const a = document.createElement('a');
      a.href = src;
      const m = /^data:image\/([a-z0-9.+-]+)/i.exec(src);
      a.download = 'image.' + (m ? m[1].replace(/[^a-z0-9]/gi, '') : 'png');
      document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    // Le immagini http(s) sono quasi sempre di un altro dominio, dove Chromium ignora l'attributo download e la scheda NAVIGAVA sull'immagine senza scaricare niente (#274).
    // Il salvataggio passa dal main, che scarica a prescindere dall'origine e risponde a download concluso (nessun toast se l'utente annulla il dialogo).
    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.DOWNLOAD_IMAGE, url: src });
      if (res?.ok) Popup.showToast(I18n.t('toast_image_saved'));
      else if (!res?.cancelled) Popup.showToast(I18n.t('toast_image_save_failed'));
    } catch (_) {
      Popup.showToast(I18n.t('toast_image_save_failed'));
    }
  }

  // Un link a un file (PDF, ZIP, allegato) merita «Salva file»; un link a un'altra pagina no, scaricherebbe l'HTML. Una HEAD a ogni apertura del menu sarebbe attrito, quindi si decide dagli indizi locali:
  // l'attributo `download` sull'<a>, oppure un'estensione nell'ultimo segmento del percorso che non sia di una pagina navigabile (html, php, asp…). Solo http e https: data:, blob: e mailto: non offrono la voce.
  const PAGE_EXTS = new Set([
    'html', 'htm', 'xhtml', 'shtml', 'php', 'php3', 'php4', 'php5', 'phtml',
    'asp', 'aspx', 'jsp', 'jspx', 'cgi', 'pl', 'do', 'action', 'cfm',
  ]);
  function isDownloadableLink(linkEl) {
    if (!linkEl) return false;
    let href = '';
    try { href = linkEl.href || ''; } catch (_) { return false; }
    if (!/^https?:/i.test(href)) return false;
    try { if (linkEl.hasAttribute && linkEl.hasAttribute('download')) return true; } catch (_) {}
    let pathname = '';
    try { pathname = new URL(href).pathname || ''; } catch (_) { return false; }
    const base = pathname.split('/').filter(Boolean).pop() || '';
    const m = /\.([a-z0-9]{1,8})$/i.exec(base);
    if (!m) return false;                       // nessuna estensione ⇒ pagina
    return !PAGE_EXTS.has(m[1].toLowerCase());
  }

  // «Salva file» (#410.2) instrada il download NATIVO della scheda (webContents.downloadURL, che passa dall'intercettazione will-download di #410.1) invece di scaricare i byte a mano come downloadImage:
  // così scaricare dal menu e cliccare il link danno lo STESSO risultato visibile — barra di avanzamento, cartella Download, avviso finale, cronologia. Nessun toast qui: la conferma è quella condivisa col clic, e si avvisa solo se il download non parte proprio.
  async function downloadLink(linkEl) {
    let href = '';
    try { href = linkEl.href || ''; } catch (_) {}
    if (!href) return;
    // data: e blob: nascono nella pagina: stessa scelta di downloadImage, restano sul cammino anchor.
    if (/^(data:|blob:)/i.test(href)) {
      const a = document.createElement('a');
      a.href = href;
      a.download = (linkEl.getAttribute && linkEl.getAttribute('download')) || '';
      document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.DOWNLOAD_LINK, url: href });
      if (res && res.ok === false) Popup.showToast(I18n.t('toast_file_save_failed'));
    } catch (_) {
      Popup.showToast(I18n.t('toast_file_save_failed'));
    }
  }

  function toggleFullscreen() {
    // Demanda al main: requestFullscreen() su una WebContentsView non porta
    // la BrowserWindow in fullscreen OS, resta confinato al bounds della view.
    chrome.runtime.sendMessage({ type: MSG.TOGGLE_FULLSCREEN });
  }

  async function shareCurrentPage() {
    const data = { title: document.title, url: location.href };
    if (navigator.share) {
      try { await navigator.share(data); return; } catch (_) {}
    }
    copyToClipboard(location.href);
  }

  // Senza sistema di condivisione nativo, condividere un link finisce in una copia negli appunti: vale lo stesso discorso di «Copia URL» (#437).
  async function shareLink(linkEl) {
    const href = linkEl?.href || '';
    if (!isAddress(href)) {
      Popup.showToast(I18n.t('toast_not_an_address'));
      return;
    }
    const data = { title: linkEl.textContent?.trim() || href, url: href };
    if (navigator.share) {
      try { await navigator.share(data); return; } catch (_) {}
    }
    copyToClipboard(href);
  }

  function searchTextOnWeb(text) {
    const q = encodeURIComponent((text || '').slice(0, 500));
    window.open(`https://www.google.com/search?q=${q}`, '_blank', 'noopener');
  }

  // Video e audio (#400). Il menu di Filo prende il posto di quello di Chromium su TUTTE le pagine: finché qui non c'era niente, il tasto destro su un filmato toglieva all'utente ogni azione (salva, copia indirizzo, finestra mobile, ripeti, velocità) senza rimpiazzarla.

  const MEDIA_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  function isAudioEl(el) {
    return !!el && el.tagName === 'AUDIO';
  }

  // Sorgente effettiva: `currentSrc` è quella che il browser sta davvero
  // riproducendo (risolve i <source> multipli); se il media non ha ancora
  // caricato nulla ripieghiamo sull'attributo e sul primo <source>.
  function mediaSrc(el) {
    if (!el) return '';
    const direct = el.currentSrc || el.src || '';
    if (direct) return direct;
    try {
      const s = el.querySelector('source[src]');
      return s ? s.src : '';
    } catch (_) { return ''; }
  }

  function formatSpeed(rate) {
    const r = Math.round(Number(rate) * 100) / 100;
    return `${String(r).replace('.', ',')}×`;
  }

  function toggleMediaPlay(el) {
    if (!el) return;
    try {
      if (el.paused) { const p = el.play(); if (p && p.catch) p.catch(() => {}); }
      else el.pause();
    } catch (_) {}
  }

  function toggleMediaMute(el) {
    if (!el) return;
    try { el.muted = !el.muted; } catch (_) {}
  }

  // Ripetizione e controlli non hanno un riscontro immediato a schermo (il
  // filmato continua identico): il toast è l'unica conferma che l'azione ha
  // avuto effetto.
  function toggleMediaLoop(el) {
    if (!el) return;
    try {
      el.loop = !el.loop;
      Popup.showToast(I18n.t(el.loop ? 'toast_media_loop_on' : 'toast_media_loop_off'));
    } catch (_) {}
  }

  function toggleMediaControls(el) {
    if (!el) return;
    try { el.controls = !el.controls; } catch (_) {}
  }

  function setMediaSpeed(el, rate) {
    if (!el) return;
    try {
      el.playbackRate = rate;
      Popup.showToast(I18n.t('toast_media_speed', formatSpeed(rate)));
    } catch (_) {}
  }

  // Velocità successiva "in su" fra quelle >= 1 (il caso comune è accelerare);
  // dopo 2× si torna a 1×. Le velocità rallentate restano nel sotto-menu.
  function nextMediaSpeed(rate) {
    const up = MEDIA_SPEEDS.filter((s) => s >= 1);
    for (const s of up) if (s > rate + 0.001) return s;
    return 1;
  }

  function mediaPipAvailable(el) {
    if (!el || el.tagName !== 'VIDEO') return false;
    try {
      return !!document.pictureInPictureEnabled && !el.disablePictureInPicture
        && typeof el.requestPictureInPicture === 'function';
    } catch (_) { return false; }
  }

  function isMediaInPip(el) {
    try { return document.pictureInPictureElement === el; } catch (_) { return false; }
  }

  async function toggleMediaPip(el) {
    try {
      if (isMediaInPip(el)) { await document.exitPictureInPicture(); return; }
      await el.requestPictureInPicture();
    } catch (_) {
      Popup.showToast(I18n.t('toast_pip_failed'));
    }
  }

  // Un blob: (stream MSE, o una Blob creata dalla pagina) non è un indirizzo utilizzabile fuori dalla scheda: dirlo è meglio che copiare una stringa che altrove non apre nulla.
  // Un blob: assente o vuoto è il caso «streaming a pezzi», che ha il suo messaggio; ogni altra sorgente che non è un indirizzo passa dal messaggio generico (#437).
  function copyMediaUrl(el) {
    const src = mediaSrc(el);
    if (!src || /^blob:/i.test(src)) {
      Popup.showToast(I18n.t('toast_media_stream_only'));
      return;
    }
    copyUrlToClipboard(src);
  }

  async function downloadMedia(el) {
    const audio = isAudioEl(el);
    const failToast = audio ? 'toast_audio_save_failed' : 'toast_video_save_failed';
    const src = mediaSrc(el);
    if (!src) { Popup.showToast(I18n.t(failToast)); return; }

    // blob: e data: nascono nella pagina e restano sul cammino anchor. Attenzione: un blob: di MediaSource (lo streaming adattivo dei player) NON è leggibile — fetch fallisce, e in quel caso non esiste alcun file da salvare.
    if (/^(blob:|data:)/i.test(src)) {
      try {
        const r = await fetch(src);
        if (!r.ok) throw new Error('non leggibile');
        const blob = await r.blob();
        if (!blob || !blob.size) throw new Error('vuoto');
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objUrl;
        const ext = (blob.type.split('/')[1] || (audio ? 'mp3' : 'mp4')).replace(/[^a-z0-9]/gi, '');
        a.download = (audio ? 'audio.' : 'video.') + ext;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => { try { URL.revokeObjectURL(objUrl); } catch (_) {} }, 20000);
      } catch (_) {
        Popup.showToast(I18n.t('toast_media_stream_only'));
      }
      return;
    }

    // http(s): stesso cammino del salvataggio immagini (#274) — scarica il main presentando Referer e cookie della scheda, così funziona anche cross-origin e sui server con protezione hotlink.
    try {
      const res = await chrome.runtime.sendMessage({
        type: MSG.DOWNLOAD_MEDIA,
        url: src,
        kind: audio ? 'audio' : 'video',
      });
      if (res?.ok) Popup.showToast(I18n.t(audio ? 'toast_audio_saved' : 'toast_video_saved'));
      else if (!res?.cancelled) Popup.showToast(I18n.t(failToast));
    } catch (_) {
      Popup.showToast(I18n.t(failToast));
    }
  }

  // Voce «Velocità»: il corpo accelera di uno scatto (dopo 2× torna a 1×), la freccetta apre l'elenco completo coi rallentamenti. L'etichetta porta la velocità corrente, così il menu dice anche in che stato è.
  function buildMediaSpeedItem(el) {
    const rate = Number(el.playbackRate) || 1;
    return {
      type: 'split',
      label: `${I18n.t('menu_media_speed')} ${formatSpeed(rate)}`,
      arrowTitle: I18n.t('menu_media_speed_pick'),
      onClick: () => setMediaSpeed(el, nextMediaSpeed(rate)),
      subItems: MEDIA_SPEEDS.map((s) => ({
        label: `${Math.abs(s - rate) < 0.001 ? '✓ ' : ''}${formatSpeed(s)}${s === 1 ? ` (${I18n.t('menu_media_speed_normal')})` : ''}`,
        onClick: () => setMediaSpeed(el, s),
      })),
    };
  }

  function buildMediaItems(el) {
    const audio = isAudioEl(el);
    const items = [];
    items.push({
      type: 'item',
      label: I18n.t(el.paused ? 'menu_media_play' : 'menu_media_pause'),
      onClick: () => toggleMediaPlay(el),
    });
    items.push({
      type: 'item',
      label: I18n.t(el.muted ? 'menu_media_unmute' : 'menu_media_mute'),
      onClick: () => toggleMediaMute(el),
    });
    items.push(buildMediaSpeedItem(el));
    items.push({
      type: 'item',
      label: I18n.t(el.loop ? 'menu_media_loop_off' : 'menu_media_loop'),
      onClick: () => toggleMediaLoop(el),
    });
    if (mediaPipAvailable(el)) {
      items.push({
        type: 'item',
        label: I18n.t(isMediaInPip(el) ? 'menu_media_pip_exit' : 'menu_media_pip'),
        onClick: () => toggleMediaPip(el),
      });
    }
    items.push({
      type: 'item',
      label: I18n.t(el.controls ? 'menu_media_hide_controls' : 'menu_media_show_controls'),
      onClick: () => toggleMediaControls(el),
    });
    items.push({ type: 'separator' });
    items.push({
      type: 'item',
      label: I18n.t(audio ? 'menu_copy_audio_link' : 'menu_copy_video_link'),
      onClick: () => copyMediaUrl(el),
    });
    items.push({
      type: 'item',
      label: I18n.t(audio ? 'menu_save_audio_as' : 'menu_save_video_as'),
      onClick: () => downloadMedia(el),
    });
    return items;
  }

  function searchImageOnWeb(imgEl) {
    const src = imgEl.currentSrc || imgEl.src;
    if (!src) return;
    const q = encodeURIComponent(src);
    // Lens-style reverse search (più affidabile di searchbyimage)
    window.open(`https://lens.google.com/uploadbyurl?url=${q}`, '_blank', 'noopener');
  }

  async function takeScreenshot() {
    try {
      const cap = await captureVisibleTab();
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
          entry: { type: 'image', dataUrl: cap.dataUrl, description: desc || imagePlaceholderLabel() },
        }).catch(() => {});
      } catch (_) {}
      const a = document.createElement('a');
      a.href = cap.dataUrl;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      a.download = descriptionToFilename(desc) || `screenshot-${stamp}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (_) {}
  }

  // Risolve con { dataUrl, rect }: il ritaglio PNG della porzione catturata e il rettangolo in pixel CSS. Risolve con null se l'utente annulla (Esc, clic senza trascinamento, rettangolo troppo piccolo).
  // Non logga eccezioni: gli errori escono come reject.
  async function selectScreenRegion() {
    const cap = await captureVisibleTab();
    if (!cap?.dataUrl) throw new Error('capture failed');

    // L'immagine catturata è in pixel del device, l'overlay in pixel CSS: la dimensione del viewport CSS si conserva qui per calcolare la scala dopo aver caricato l'immagine.
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = cap.dataUrl;
    });

    return new Promise((resolve) => {
      // Crosshair SVG bianco con outline nero invece di quello del sistema, che su sfondo variabile può risultare invisibile sopra la maschera semitrasparente. Hotspot al centro (16,16).
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
      global.SN_FILO_UI?.mark(overlay);
      // Stili inline per non dipendere da CSS esterni: l'overlay deve funzionare in qualsiasi pagina, anche con CSP o stili restrittivi.
      Object.assign(overlay.style, {
        position: 'fixed', inset: '0', zIndex: '2147483647',
        cursor: cursorRule, userSelect: 'none', pointerEvents: 'auto',
      });
      overlay.setAttribute('data-sn-theme', document.documentElement.dataset.snTheme || '');

      // Quattro quadranti scuri intorno alla selezione, aggiornati via style durante il trascinamento.
      // Il cursore va impostato esplicitamente sui figli: la regola `cursor` è ereditata, ma alcuni runtime Electron non la propagano durante il drag e l'utente resta senza riferimento visivo.
      const mask = ['t', 'r', 'b', 'l'].map(() => {
        const d = document.createElement('div');
        Object.assign(d.style, { position: 'absolute', background: 'rgba(0,0,0,0.45)', cursor: cursorRule });
        return d;
      });
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
        Object.assign(mask[0].style, { left: '0', top: '0', width: '100%', height: minY + 'px', right: 'auto', bottom: 'auto' });
        Object.assign(mask[2].style, { left: '0', top: maxY + 'px', width: '100%', bottom: '0', height: 'auto', right: 'auto' });
        Object.assign(mask[3].style, { left: '0', top: minY + 'px', width: minX + 'px', height: (maxY - minY) + 'px', right: 'auto', bottom: 'auto' });
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

  // Screenshot di una regione scelta dall'utente. Stessi effetti del takeScreenshot pieno: download, appunti, cronologia degli appunti.
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
      if (copied) Popup.showToast(I18n.t('toast_copied_saving'), { duration: 3000 });
      const desc = await requestImageDescription(dataUrl).catch(() => null);
      try {
        chrome.runtime.sendMessage({
          type: MSG.PUSH_CLIPBOARD_ENTRY,
          entry: { type: 'image', dataUrl, description: desc || imagePlaceholderLabel() },
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

  // Color picker con la EyeDropper API nativa: al click il cursore cambia (lo gestisce il browser) e la pressione successiva su un pixel qualsiasi copia il colore in hex negli appunti. Esc annulla.
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
        const ta = document.createElement('textarea');
        ta.value = hex;
        ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        ta.remove();
      }
      Popup.showToast(I18n.t('toast_color_copied') + hex, { duration: 2500 });
    } catch (_) {
    }
  }

  // La codifica del QR è tutta locale (src/shared/qr.js): l'URL non viene mai mandato a servizi esterni.
  // Il QR resta nero su bianco a prescindere dal tema, per il contrasto che gli scanner pretendono.
  function showPageQrCode() {
    const QR = global.SN_QR;
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

    // L'overlay è figlio di documentElement, che porta data-sn-theme e le variabili della palette (theme.css è iniettato anche sulle pagine esterne): si usano quelle, coi fallback per i rari casi in cui il tema non sia ancora applicato.
    const overlay = document.createElement('div');
    overlay.className = 'sn-qr-overlay';
    global.SN_FILO_UI?.mark(overlay);
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

    // Tile bianca attorno al QR: lo stacca dallo sfondo in tema scuro e, soprattutto, garantisce la quiet zone che gli scanner si aspettano, qualunque sia il colore della card.
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

  function init(d) { deps = { ...deps, ...d }; }

  global.SN_ACTIONS = {
    init,
    copyToClipboard,
    copyUrlToClipboard,
    isAddress,
    cutSelection,
    blobToDataUrl,
    pasteFromClipboard,
    pasteHistoryEntry,
    insertTextAtSelection,
    insertDictatedText,
    buildPasteItem,
    getClipboardHistory,
    getNavState,
    pushClipboardEntry,
    requestImageDescription,
    descriptionToFilename,
    triggerExplainOrTranslate,
    triggerExplainDeep,
    schedulePrefetchExplain,
    buildInlineExplain,
    buildInlineExplainImage,
    buildInlineExplainLink,
    analyzeLinkSuspicious,
    buildSavePayload,
    savePage,
    showSaveConfirm,
    saveLink,
    isDownloadableLink,
    downloadLink,
    copyImage,
    downloadImage,
    toggleFullscreen,
    shareCurrentPage,
    shareLink,
    searchTextOnWeb,
    searchImageOnWeb,
    buildMediaItems,
    buildMediaSpeedItem,
    downloadMedia,
    copyMediaUrl,
    mediaSrc,
    toggleMediaPlay,
    toggleMediaMute,
    toggleMediaLoop,
    toggleMediaControls,
    toggleMediaPip,
    setMediaSpeed,
    takeScreenshot,
    takePartialScreenshot,
    transcribeRegion,
    pickColor,
    showPageQrCode,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
