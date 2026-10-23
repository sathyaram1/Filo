// Azioni del content script: clipboard (copia/taglia/incolla + cronologia),
// screenshot (pieno e ritaglio), trascrizione OCR, salva/condividi/cerca,
// color picker, QR code e spiegazioni inline (testo/immagine/link; l'euristica
// dei link sospetti sta in src/shared/linkSospetto.js).
//
// Estratto da content.js — viene caricato prima di lui dai preload. content.js
// chiama init() passando le dipendenze che restano sue: il pasteContext
// (catturato all'apertura del menu), isBlocked (settings correnti) e l'ultimo
// evento mouse (per ancorare i popup).

(function (global) {
  'use strict';

  const { ACTIONS, spiegazioneDaMostrare } = global.SN_CONST;
  const { MSG } = global.SN_MSG;
  const I18n = global.SN_I18N;
  const Popup = global.SN_POPUP;
  const Extract = global.SN_EXTRACT;
  // Il nome di una scorciatoia si chiede qui, mai scritto a mano: regola in CLAUDE.md § Mac.
  const Tasti = global.SN_TASTI;
  const LinkSospetto = global.SN_LINK_SOSPETTO;
  // I pezzi che questo file mette nel documento del sito vanno avanti solo per un tasto o un clic dell'utente: lo script
  // della pagina li raggiunge e ci fabbrica sopra eventi (#592.16). Chiudere resta aperto a tutti.
  const gestoVero = (e) => !!global.SN_FILO_UI?.gestoVero(e);

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

  // Negli appunti deve finire un indirizzo apribile: un javascript:, un data: o un
  // blob: copiato da «Copia URL» non aprirebbe niente da nessuna parte (#437).
  function isAddress(url) {
    const raw = String(url || '').trim();
    // Senza il modulo condiviso non si rifiuta niente: meglio permissivi che bloccare tutto.
    if (!global.SN_URL_NAV) return !!raw;
    return global.SN_URL_NAV.isShareableAddress(raw);
  }

  // L'indirizzo della pagina per chi lo condivide o lo salva: sulla pagina «sito non raggiungibile» è il sito che si
  // voleva aprire, non l'indirizzo interno dell'errore (#1343).
  function indirizzoDellaPagina() {
    const qui = String(location.href || '');
    if (!qui.startsWith('filo://error/')) return qui;
    let voluto = '';
    try { voluto = new URL(qui).searchParams.get('url') || ''; } catch (_) { voluto = ''; }
    return /^https?:\/\//i.test(voluto) && isAddress(voluto) ? voluto : qui;
  }
  const paginaDErrore = () => indirizzoDellaPagina() !== String(location.href || '');

  function copyUrlToClipboard(url) {
    if (!isAddress(url)) {
      Popup.toastErrore('toast_not_an_address');
      return false;
    }
    copyToClipboard(String(url).trim());
    return true;
  }

  function cutSelection() {
    // La selezione dentro <input>/<textarea> si recupera dal nodo attivo: regola in src/content/content.js.
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
        activeEl.dispatchEvent(nostro(new Event('input', { bubbles: true })));
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

  // Senza fetch: la CSP di un sito può chiudere anche i data:.
  function blobDaDataUrl(dataUrl) {
    try {
      const m = /^data:([^;,]+);base64,(.*)$/.exec(String(dataUrl || ''));
      if (!m) return null;
      const bin = atob(m[2]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: m[1] });
    } catch (_) { return null; }
  }

  // Descrizione provvisoria per un'immagine prima che arrivi quella generata
  // dall'AI (o il perché non arriverà: vedi imagePlaceholderLabel).
  async function describeImage(_blob) {
    return imagePlaceholderLabel();
  }

  // ------------------------------------------------------------
  // Incolla (da clipboard e da cronologia)
  // ------------------------------------------------------------
  // Ciò che scriviamo noi in un campo di un riquadro di Filo lo deve sentire anche il riquadro, che ai finti è chiuso.
  const nostro = (ev) => (global.SN_FILO_UI?.nostro ? global.SN_FILO_UI.nostro(ev) : ev);

  // Incolla dagli appunti: prova prima a leggere immagini, poi testo.
  // Gli appunti li legge il main per Filo: la pagina non riceve nessun permesso, nemmeno per un attimo (#586).
  // `letti`: gli appunti già letti dal main, quando «Incolla» l'ha scelto l'utente nello strato sopra la scheda (#1054).
  async function pasteFromClipboard(letti = null) {
    deps.restorePasteContext();
    let appunti = null;
    if (letti && typeof letti === 'object') appunti = { ok: true, testo: letti.testo, immagine: letti.immagine };
    else try { appunti = await chrome.runtime.sendMessage({ type: MSG.APPUNTI_DI_FILO }); } catch (_) { appunti = null; }
    if (!appunti || !appunti.ok) { Popup.toastErrore('toast_paste_failed'); return; }
    const text = typeof appunti.testo === 'string' ? appunti.testo : '';
    let blob = null;
    if (appunti.immagine) blob = blobDaDataUrl(appunti.immagine);
    if (blob) {
      const dataUrl = appunti.immagine;
      deps.restorePasteContext();
      const ctx = deps.getPasteContext();
      const targetKind = ctx?.kind;
      if (targetKind === 'input') {
        // input/textarea non supportano immagini: prova a delegare ad
        // un handler custom (es. il modal feedback) via evento bubbling.
        const pasteEvt = nostro(new CustomEvent('filo:paste-image', {
          bubbles: true, cancelable: true, detail: { blob },
        }));
        if (ctx.el && ctx.el.dispatchEvent(pasteEvt) === false) return;
        if (text) {
          insertTextAtSelection(text);
          pushClipboardEntry({ type: 'text', text }, 'paste');
        } else {
          Popup.toastErrore('toast_cannot_paste_image');
        }
        return;
      }
      if (targetKind !== 'ce') {
        // Nessun target editabile valido per un'immagine.
        Popup.toastErrore('toast_cannot_paste_image');
        return;
      }
      if (!insertImageInEditable(blob, dataUrl)) {
        Popup.toastErrore('toast_paste_failed');
        return;
      }
      const description = await describeImage(blob);
      pushClipboardEntry({ type: 'image', dataUrl, description }, 'paste');
      Popup.showToast(I18n.t('toast_pasted_image'));
      return;
    }
    if (!text) return;
    deps.restorePasteContext();
    insertTextAtSelection(text);
    pushClipboardEntry({ type: 'text', text }, 'paste');
  }

  // `giaInCima`: scelta nello strato, il main l'ha già riportata in cima (#1054).
  async function pasteHistoryEntry(entry, { giaInCima = false } = {}) {
    if (!entry) return;
    // Riporta in cima alla cronologia: il background fa dedup e promuove.
    // Non passiamo per pushClipboardEntry() per evitare di ri-richiedere
    // all'AI la descrizione di un'immagine già descritta.
    if (!giaInCima) chrome.runtime.sendMessage({ type: MSG.PUSH_CLIPBOARD_ENTRY, entry }).catch(() => {});
    deps.restorePasteContext();
    const ctx = deps.getPasteContext();
    if (entry.type === 'image') {
      // Le immagini in cronologia sono offline (dataUrl in storage): niente provider.
      let blob = null;
      try { blob = await (await fetch(entry.dataUrl)).blob(); } catch (_) {}

      // input e textarea non accettano <img>: si delega con l'evento 'filo:paste-image' a chi
      // ha un handler dedicato, o l'incolla dalla cronologia fallisce su ogni immagine.
      if (ctx?.kind === 'input' && blob) {
        const pasteEvt = nostro(new CustomEvent('filo:paste-image', {
          bubbles: true, cancelable: true, detail: { blob },
        }));
        if (ctx.el.dispatchEvent(pasteEvt) === false) {
          Popup.showToast(I18n.t('toast_pasted_image'));
          return;
        }
        Popup.toastErrore('toast_cannot_paste_image');
        return;
      }
      if (ctx?.kind !== 'ce') {
        Popup.toastErrore('toast_cannot_paste_image');
        return;
      }
      const ok = insertImageInEditable(blob, entry.dataUrl, descriptionToFilename(entry.description));
      if (ok) Popup.showToast(I18n.t('toast_pasted_image'));
      else Popup.toastErrore('toast_paste_failed');
      return;
    }
    insertTextAtSelection(entry.text || '');
  }

  // Tre strategie: evento paste sintetico (gli editor moderni hanno un handler paste e
  // ignorano il resto), poi execCommand insertImage, infine inserimento via Range.
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
    // Incolla e dettatura li ha chiesti l'utente a Filo, fuori dalla pagina: il correttore li tratta come scritti a mano.
    try { global.SN_GESTO?.segna([global.SN_GESTO.CHIUDE], { el, x: null, y: null, tasto: '' }); } catch (_) {}
    if (kind === 'input') {
      const start = ctx.start ?? el.value.length;
      const end = ctx.end ?? el.value.length;
      el.value = el.value.slice(0, start) + text + el.value.slice(end);
      const caret = start + text.length;
      el.setSelectionRange(caret, caret);
      ctx.start = caret;
      ctx.end = caret;
      // Un incolla vero: chi ascolta il campo lo distingue da quello che l'utente scrive (#592.2).
      el.dispatchEvent(nostro(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: text })));
    } else if (kind === 'ce') {
      el.focus();
      // La selezione va ripristinata PRIMA di inserire: il click sul bottone sposta il fuoco,
      // e sugli editor moderni execCommand inseriva a fine testo invece che al caret.
      const sel = window.getSelection();
      if (ctx.range && el.contains(ctx.range.startContainer)) {
        try {
          sel.removeAllRanges();
          sel.addRange(ctx.range);
        } catch (_) {}
      }
      // Gli editor controllati tengono la loro selezione anche dopo il blur e inseriscono nel
      // punto giusto; execCommand lì finiva in coda.
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

  // Riallinea il punto d'incolla a dov'è il cursore ADESSO: la dettatura dura a lungo, e
  // il testo atterrerebbe dove si era aperto il menu, spaccando quanto digitato.
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

  // La dettatura arriva molto dopo il click: vedi refreshPasteContextLive.
  function insertDictatedText(text) {
    refreshPasteContextLive();
    deps.restorePasteContext();
    insertTextAtSelection(text);
  }

  function buildPasteItem(clipboardHistory) {
    return {
      type: 'paste',
      azione: 'paste-clipboard',
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
    // Col menu nello strato la cronologia la legge lo strato dal main: nella scheda non arriva (#1054).
    try { if (global.SN_STRATO_MENU_ACCESO?.() === true) return []; } catch (_) {}
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.GET_CLIPBOARD_HISTORY });
      return r?.items || [];
    } catch (_) { return []; }
  }

  // `via: 'paste'` dice a chi tiene la cronologia che la voce viene da un
  // incolla, non da una copia scelta: una voce appena tolta non rientra così.
  function pushClipboardEntry(entry, via) {
    const spinta = chrome.runtime.sendMessage({ type: MSG.PUSH_CLIPBOARD_ENTRY, entry, via }).catch(() => null);
    // Un'immagine che l'utente ha tolto dalla cronologia non torna a un modello per farsi descrivere.
    if (entry?.type === 'image' && entry.dataUrl) {
      spinta.then((r) => { if (r?.tenuta !== false) requestImageDescription(entry.dataUrl).catch(() => {}); });
    }
  }

  // L'avviso «manca il modello» si dà una volta per pagina: la descrizione parte a ogni
  // immagine e ripetere il toast sarebbe rumore.
  // La frase dice dove si sceglie il modello: l'avviso porta il tasto per andarci (#663, #1344.1).
  const modelConfigWarned = new Set();
  function warnModelConfigOnce(message, res) {
    if (!message || modelConfigWarned.has(message)) return;
    modelConfigWarned.add(message);
    try { Popup.showToast(message, { duration: 7000, rimedio: res || null }); } catch (_) {}
  }

  // «Descrizione…» solo finché può davvero arrivare: un'attesa che non finirà mai è una
  // bugia, meglio dire che manca il modello.
  let imageDescNoModel = false;
  // L'ultima immagine che non avrà descrizione, e perché: pagina delicata o descrizione spenta (#1004, #1274).
  let ultimaSenza = { dataUrl: null, etichetta: '' };
  const SENZA_DESCRIZIONE = { PAGINA_DELICATA: 'clipboard_image_delicata', DESCRIZIONE_SPENTA: 'clipboard_image_senza_descrizione' };
  function imagePlaceholderLabel(dataUrl) {
    if (dataUrl && dataUrl === ultimaSenza.dataUrl) return I18n.t(ultimaSenza.etichetta);
    return I18n.t(imageDescNoModel ? 'clipboard_image_no_model' : 'clipboard_image_pending');
  }

  // `originale`: la foto che l'utente tiene, quando al modello va una copia coperta.
  async function requestImageDescription(dataUrl, originale = null) {
    // NIENTE modello di ripiego scritto qui: gli unici modelli ammessi sono
    // quelli configurati per questa funzione (il ripiego VOLUTO fra i modelli
    // della catena vive nel main, dentro la catena). Se la funzione non ha un
    // modello — o cita una scorciatoia che non esiste — la descrizione non si
    // fa e l'utente lo viene a sapere, invece di riceverla da un modello che
    // nessuno ha mai scelto.
    let res;
    try {
      res = await chrome.runtime.sendMessage({
        type: MSG.AI_REQUEST,
        action: ACTIONS.DESCRIBE_IMAGE,
        payload: { dataUrl, automatica: true, ...(originale && originale !== dataUrl ? { originale } : {}) },
      });
    } catch (e) {
      res = { ok: false, error: e.message || String(e) };
    }
    // Nata su una pagina delicata, o con la descrizione spenta, l'immagine non va al modello: lo screenshot prende data e ora.
    const senza = res && SENZA_DESCRIZIONE[res.code];
    if (senza) {
      ultimaSenza = { dataUrl, etichetta: senza };
      chrome.runtime.sendMessage({
        type: MSG.UPDATE_CLIPBOARD_DESCRIPTION,
        dataUrl,
        description: I18n.t(senza),
      }).catch(() => {});
      return null;
    }
    // La descrizione si chiede una volta sola: una richiesta andata male lascerebbe la voce in cronologia su
    // «Descrizione…» per sempre (crediti finiti, rete, risposta vuota: #1344.1). Le si dice la verità.
    const nonArrivera = (chiave) => {
      chrome.runtime.sendMessage({
        type: MSG.UPDATE_CLIPBOARD_DESCRIPTION,
        dataUrl,
        description: I18n.t(chiave),
      }).catch(() => {});
    };
    if (!res?.ok) {
      // Un modello che nessun host ammesso serve (#828) è un modello che manca: la descrizione non arriverà.
      if ((res?.code === 'NO_MODEL_FOR_ACTION' || res?.code === 'NO_ALLOWED_HOST') && res.error) {
        imageDescNoModel = true;
        if (!modelConfigWarned.has(res.error)) Popup.conta({ misura: 'errore-modello', code: String(res.code || ''), status: 0 });
        warnModelConfigOnce(res.error, res);
        nonArrivera('clipboard_image_no_model');
      } else {
        nonArrivera('clipboard_image_non_descritta');
      }
      console.warn('[SN] descrizione immagine non eseguita:', res?.error || 'errore sconosciuto');
      return null;
    }
    imageDescNoModel = false;
    if (!res.text || !res.text.replace(/\s+/g, ' ').trim()) {
      console.warn('[SN] descrizione immagine: risposta vuota');
      nonArrivera('clipboard_image_non_descritta');
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

  // Il riquadro si stacca dalla PAROLA, non dal punto: ancorato al solo punto di partenza
  // copriva la metà bassa delle lettere. Senza selezione misurabile resta il puntatore.
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
      Popup.toastErrore('err_no_selection');
      return;
    }
    if (selInfo.segreto) {
      Popup.showToast(I18n.t('err_secret_selection'));
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

  // Sezione inline: avvia subito una richiesta EXPLAIN e mostra il risultato nel menu.
  // La sezione si nasconde solo se il modello rinuncia E non ha lasciato altro
  // (una conversione accanto alla rinuncia resta: #724).
  // ------------------------------------------------------------
  // Prefetch "Spiega" su selezione di testo (riduce latenza del menu)
  // ------------------------------------------------------------
  // Quando l'utente seleziona del testo, lanciamo subito la richiesta EXPLAIN in
  // background. Quando poi apre il menu (clic destro), il risultato è in cache:
  // il box inline lo mostra istantaneamente invece di aspettare il provider.
  // - Debounce 400ms (selectionchange spara molto durante il drag).
  // - Dedup per chiave selezione (no re-fetch sulla stessa selezione).
  // - No prefetch se tab nascosto, dominio bloccato, incognito, selezione troppo corta o troppo lunga.
  // - Una sola entry attiva: la selezione cambia velocemente, non serve cache larga.
  // - Parte solo dietro un gesto vero che seleziona (#1070): una selezione fatta da uno script spenderebbe i crediti dell'utente.
  let prefetchedExplain = null; // { key, sentence, promise<{text}|{errore: risposta dell'IPC}> }
  let prefetchTimer = null;
  // Oltre, una spiegazione «in anticipo» non vale il costo: si calcola intera al tasto destro.
  const PREFETCH_MAX_CHARS = 2000;

  function explainKey(text) { return (text || '').trim().slice(0, 2000); }

  function schedulePrefetchExplain() {
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(prefetchExplainNow, 400);
  }

  function prefetchExplainNow() {
    if (deps.isBlocked()) return;
    // Spenta dalle Preferenze, o per far durare i crediti (#818): la spiegazione parte al tasto destro.
    if (deps.spiegaAnticipata && !deps.spiegaAnticipata()) return;
    // In incognito la spiegazione parte solo dal tasto destro (#591, #1004).
    if (!deps.isIncognito || deps.isIncognito()) return;
    if (document.hidden) return;
    const Gesto = global.SN_GESTO;
    if (!Gesto || !Gesto.recente(Gesto.SELEZIONA)) return;
    const sel = Extract.getSelectionWithSentence();
    if (!sel || sel.segreto) return;
    if (sel.selection.length > PREFETCH_MAX_CHARS) return;
    const key = explainKey(sel.selection);
    if (key.length < 3) return;
    // Stessa selezione di prima: l'entry esistente sta già lavorando (o ha il risultato).
    if (prefetchedExplain && prefetchedExplain.key === key) return;
    // Solo il gesto che ha fatto o toccato questa selezione: un clic su un pulsante non paga il testo che la pagina
    // seleziona altrove (#1070).
    if (!Gesto.prendi('spiega', Gesto.SELEZIONA, Gesto.sullaSelezione)) return;
    prefetchedExplain = startExplainRequest(sel);
    prefetchedExplain.anticipata = true;
  }

  // `suRichiesta`: l'ha chiesta l'utente col tasto destro, e il tetto del main sulle automatiche non la ferma.
  function startExplainRequest(selInfo, { suRichiesta = false } = {}) {
    const key = explainKey(selInfo.selection);
    const entry = { key, sentence: selInfo.sentence, fermata: false };
    entry.promise = chrome.runtime.sendMessage({
      type: MSG.AI_REQUEST,
      action: ACTIONS.EXPLAIN,
      payload: { selection: selInfo.selection, sentence: selInfo.sentence },
      diceRipiego: true,
      // Preparata prima che la persona la chieda: l'uso lo conta l'apertura di Spiega, non questa chiamata (#969).
      ...(suRichiesta ? { suRichiesta: true } : { parteDiUnUso: true, anticipo: true }),
    }).then(
      (res) => {
        // Fermata dal tetto o da una pagina delicata (#1274): al tasto destro si chiede davvero.
        if (res && (res.code === 'TROPPE_AUTOMATICHE' || res.code === 'PAGINA_DELICATA')) entry.fermata = true;
        // L'errore resta la risposta intera: chi lo mostra ci legge anche dove si rimedia (#663).
        return (res?.ok && typeof res.text === 'string')
          ? { text: res.text, keyFallback: res.keyFallback || null }
          : { errore: res || {} };
      },
      (e) => ({ errore: { message: e?.message } }),
    );
    return entry;
  }

  function contaUso(action, attesaMs, anticipata = false) {
    try { Promise.resolve(chrome.runtime.sendMessage({ type: MSG.CONTATORI_USO, action, attesaMs, anticipata })).catch(() => {}); } catch (_) {}
  }

  // Restituisce la Promise per la spiegazione di questa selezione.
  // Riusa il prefetch se è dello stesso testo; altrimenti parte ora.
  // Un anticipo fermato dal tetto delle automatiche non è la risposta: al tasto destro si chiede davvero.
  function getExplainPromise(selInfo) {
    const key = explainKey(selInfo.selection);
    const chiedi = () => {
      // Con la spiegazione in anticipo spenta la chiede la persona: è il gesto che quella scelta le costa (#1461).
      if (deps.spiegaAnticipata && !deps.spiegaAnticipata()) Popup.conta({ misura: 'chiesto', action: ACTIONS.EXPLAIN });
      const entry = startExplainRequest(selInfo, { suRichiesta: true });
      prefetchedExplain = entry;
      return entry.promise;
    };
    const pre = prefetchedExplain;
    if (pre && pre.key === key && !pre.fermata) {
      return pre.promise.then((res) => {
        if (pre.fermata) return chiedi();
        // Preparata e aperta: per i crediti non è una chiamata sprecata (#818). Una fermata non è partita.
        const primaVolta = !!pre.anticipata && !pre.usata;
        if (primaVolta) {
          pre.usata = true;
          Promise.resolve(chrome.runtime.sendMessage({ type: MSG.SPIEGAZIONE_ANTICIPATA_USATA })).catch(() => {});
        }
        // Per i contatori un anticipo è aperto una volta sola, e solo se era pronto: riaperto o fallito non conta (#1461).
        return { ...res, giaChiesta: true, anticipata: primaVolta && !!res && !res.errore && !!res.text };
      });
    }
    return chiedi();
  }

  // Il tasto del rimedio sotto una spiegazione del menu apre un'altra scheda: il menu non resta aperto sopra il sito.
  function chiudiMenu() {
    try { global.SN_MENU?.close?.(); } catch (_) {}
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
          arrow.title = `${I18n.t('menu_explain_deep')} (${Tasti.etichettaFilo(Tasti.scorciatoiaFilo('explain-selection'))})`;
          arrow.textContent = '▸';
          arrow.addEventListener('click', (e) => {
            e.stopPropagation();
            try { global.SN_MENU?.close?.(); } catch (_) {}
            triggerExplainDeep(selInfo, deps.getLastMouseEvent());
          });
          el.appendChild(arrow);
        }

        let cancelled = false;
        const apertaIl = Date.now();
        getExplainPromise(selInfo).then((res) => {
          // Una risposta già chiesta prima (l'anticipo alla selezione) non passa dal conto delle chiamate: l'uso lo
          // conta chi la mostra, con l'attesa da quando la persona ha aperto Spiega (#969).
          if (res && res.giaChiesta) contaUso(ACTIONS.EXPLAIN, !cancelled && res.text ? Date.now() - apertaIl : null, res.anticipata);
          if (cancelled) return;
          el.classList.remove('sn-menu-inline-loading');
          if (!res || res.errore || !res.text) {
            el.classList.add('sn-menu-inline-error');
            Popup.scriviErrore(body, (res && res.errore) || {}, { dopo: chiudiMenu });
            return;
          }
          const daMostrare = spiegazioneDaMostrare(Popup.resolveCalcMarkers(res.text));
          if (!daMostrare) {
            const prev = el.previousElementSibling;
            if (prev && prev.classList.contains('sn-menu-sep')) prev.remove();
            el.remove();
            return;
          }
          body.innerHTML = Popup.renderMarkdown(daMostrare);
          Popup.notaRipiego(body, res.keyFallback);
          Popup.notaInterrotta(body, res.finishReason);
        });
        return () => { cancelled = true; };
      },
    };
  }

  // Un collegamento è anche la zona di una mappa d'immagine e l'<a> di un disegno SVG, anche con l'xlink:href dei disegni
  // vecchi (#725.6, #725.7). Lì `href` è un oggetto, non l'indirizzo: chi vuole l'indirizzo lo chiede qui.
  const SELETTORE_COLLEGAMENTO = 'a[href], a[*|href], area[href]';
  const XLINK = 'http://www.w3.org/1999/xlink';
  function indirizzoDelLink(el) {
    if (!el) return '';
    let h;
    try { h = el.href; } catch (_) { return ''; }
    if (typeof h === 'string') return h;
    const scritto = String((h && h.animVal) || el.getAttribute?.('href') || el.getAttributeNS?.(XLINK, 'href') || '').trim();
    if (!scritto) return '';
    try { return new URL(scritto, el.baseURI || location.href).href; } catch (_) { return scritto; }
  }

  // Il nome con cui il collegamento si presenta: una zona di mappa non ha testo, solo il suo `alt`.
  function nomeDelLink(el) {
    if (!el) return '';
    const testo = el.tagName === 'AREA' ? '' : (el.textContent || '').trim();
    return testo || String(el.getAttribute?.('alt') || el.getAttribute?.('aria-label') || el.getAttribute?.('title') || '').trim();
  }

  // L'avviso sull'indirizzo lo calcola Filo, non il modello: si mostra SUBITO e
  // resta anche se la spiegazione non arriva mai (#725).
  function mostraAvvisoLink(el, url) {
    const avviso = LinkSospetto.avviso(LinkSospetto.analizza(url));
    if (!avviso) return;
    const w = document.createElement('div');
    w.className = 'sn-menu-link-warn';
    w.textContent = avviso;
    el.appendChild(w);
  }

  // Quello che Filo dice di un'immagine viene da byte che il sito non può leggere (altro dominio,
  // cookie dell'utente): la ricerca nel testo del sito attraversa lo shadow chiuso, quindi glifi, non testo (#946).
  function testoChiuso(el, s) {
    el.textContent = '';
    global.SN_MENU.testoNascosto(el, el, s);
  }

  // Le etichette di origine di un'immagine già scaricata (#711): le legge il main
  // dai byte, sul computer e senza crediti. Il menu e l'Aiuto passano entrambi da qui.
  function leggiOrigine(dataUrl) {
    return chrome.runtime.sendMessage({ type: MSG.IMAGE_PROVENANCE, dataUrl });
  }

  // Il Referer che la pagina concede (<meta name="referrer">, l'attributo dell'elemento) vale anche per i byte che il
  // main scarica per lei; la politica dell'intestazione HTTP la vede il main da sé.
  function politicheReferrer(el) {
    const meta = Array.from(document.querySelectorAll('meta[name="referrer" i]'), (m) => m.getAttribute('content') || '');
    return [meta.join(','), String((el && el.referrerPolicy) || '')].filter(Boolean);
  }

  // I byte originali di un'immagine della pagina, come data URL. Quella di un'altra
  // origine (quasi sempre: le foto stanno su un CDN) lo script non la può leggere,
  // e la scarica il main (#946): senza, descrizione e origine tacevano sulla maggior parte dei siti.
  async function scaricaImmagine(src, el) {
    try {
      const r = await fetch(src);
      if (r.ok) return await blobToDataUrl(await r.blob());
    } catch (_) {}
    if (!/^https?:/i.test(String(src || ''))) throw new Error('immagine non leggibile');
    const res = await chrome.runtime.sendMessage({ type: MSG.IMAGE_BYTES, url: src, politiche: politicheReferrer(el) });
    if (!res || !res.ok || !res.dataUrl) throw new Error((res && res.error) || 'immagine non leggibile');
    return res.dataUrl;
  }

  // Sezione inline "Spiega immagine": stessa filosofia di buildInlineExplain ma con dataUrl.
  // `linkEl` è il collegamento che l'immagine apre: l'unica sezione del menu parla
  // dell'immagine, ma l'avviso sull'indirizzo non si perde (#725.1).
  // I byte si scaricano UNA volta: descrizione e controllo dell'origine partono da quelli.
  function buildInlineExplainImage(imgEl, linkEl) {
    return {
      type: 'inline',
      subject: 'image',
      content: I18n.t('menu_explain_loading'),
      onMount: (el) => {
        el.classList.add('sn-menu-inline-loading');
        el.textContent = '';
        const origine = document.createElement('div');
        origine.className = 'sn-menu-origine';
        origine.hidden = true;
        el.appendChild(origine);
        const indirizzo = indirizzoDelLink(linkEl);
        if (indirizzo) mostraAvvisoLink(el, indirizzo);
        const body = document.createElement('div');
        body.className = 'sn-menu-link-body';
        body.textContent = I18n.t('menu_explain_loading');
        el.appendChild(body);
        const src = imgEl.currentSrc || imgEl.src;
        if (!src) {
          body.textContent = I18n.t('err_provider_failed');
          el.classList.remove('sn-menu-inline-loading');
          el.classList.add('sn-menu-inline-error');
          return () => {};
        }
        let cancelled = false;
        // Il sito in lista lo dice anche l'immagine che fa da link, come il link di testo; la domanda non contatta il sito.
        if (indirizzo) {
          chrome.runtime.sendMessage({ type: MSG.LINK_FERMATO, url: indirizzo }).then((r) => {
            if (cancelled || !r?.bloccato) return;
            const nota = document.createElement('div');
            nota.className = 'sn-menu-link-nota';
            nota.textContent = I18n.t(r.bloccato === 'lists' ? 'menu_link_blocked_lists' : 'menu_link_blocked', r.host || '');
            el.insertBefore(nota, body);
          }).catch(() => {});
        }
        (async () => {
          let dataUrl;
          try {
            dataUrl = await scaricaImmagine(src, imgEl);
          } catch (_) {
            if (cancelled) return;
            el.classList.remove('sn-menu-inline-loading');
            el.classList.add('sn-menu-inline-error');
            body.textContent = I18n.t('menu_image_unreadable');
            return;
          }
          if (cancelled) return;

          // Locale: arriva molto prima della descrizione, e si mostra appena c'è.
          leggiOrigine(dataUrl).then((p) => {
            if (cancelled || !p || !p.ok || !p.frase) return;
            testoChiuso(origine, p.frase);
            origine.title = I18n.t(p.firmatario === 'non_verificato' ? 'menu_origin_hint_unverified'
              : p.firmatario === 'provvisorio' ? 'menu_origin_hint_interim'
                : p.prova === 'marchio' ? 'menu_origin_hint_mark' : 'menu_origin_hint');
            origine.classList.toggle('sn-menu-origine-debole', !p.forte);
            origine.hidden = false;
          }).catch(() => {});

          try {
            const res = await chrome.runtime.sendMessage({
              type: MSG.AI_REQUEST,
              action: ACTIONS.DESCRIBE_IMAGE,
              payload: { dataUrl },
              diceRipiego: true,
            });
            if (cancelled) return;
            el.classList.remove('sn-menu-inline-loading');
            if (!res?.ok || !res.text) {
              el.classList.add('sn-menu-inline-error');
              Popup.scriviErrore(body, res, { dopo: chiudiMenu });
              return;
            }
            testoChiuso(body, res.text);
            Popup.notaRipiego(el, res.keyFallback);
            Popup.notaInterrotta(el, res.finishReason);
          } catch (e) {
            if (cancelled) return;
            el.classList.remove('sn-menu-inline-loading');
            el.classList.add('sn-menu-inline-error');
            body.textContent = I18n.t('err_provider_failed');
          }
        })();
        return () => { cancelled = true; };
      },
    };
  }

  // Sezione inline "Spiega link": il link non si apre in una scheda; titolo e descrizione li legge il main.
  function buildInlineExplainLink(linkEl) {
    return {
      type: 'inline',
      subject: 'link',
      content: I18n.t('menu_link_loading'),
      onMount: (el) => {
        el.classList.add('sn-menu-inline-loading');
        let cancelled = false;
        (async () => {
          const url = indirizzoDelLink(linkEl);
          const anchorText = nomeDelLink(linkEl).slice(0, 200);
          const flags = LinkSospetto.analizza(url);
          el.textContent = '';
          mostraAvvisoLink(el, url);
          const body = document.createElement('div');
          body.className = 'sn-menu-link-body';
          body.textContent = I18n.t('menu_link_loading');
          el.appendChild(body);

          // Quando il sito non si contatta lo decide il main (#1307). Un sito bloccato non si spiega: si dice che è in lista.
          let ogTitle = '', ogDescription = '', r = null;
          // Scritto da un modello: mai giudicato, o con un dato che al clic chiede l'OK, non si contatta prima (#1505).
          // `delSito`: il collegamento è della pagina, che sa già dove porta.
          const proposta = global.SN_MARKDOWN?.scrittoDaUnModello
            ? global.SN_MARKDOWN.scrittoDaUnModello(linkEl)
            : !!(linkEl.closest && linkEl.closest('a.filo-md-link, [data-filo-verdetti]'));
          try { r = await chrome.runtime.sendMessage({ type: 'fetch_link_meta', url, proposta, delSito: !proposta }); } catch (_) {}
          if (cancelled) return;
          if (r?.ok) { ogTitle = r.ogTitle || ''; ogDescription = r.ogDescription || ''; }
          else if (r?.bloccato) {
            el.classList.remove('sn-menu-inline-loading');
            body.textContent = I18n.t(r.bloccato === 'lists' ? 'menu_link_blocked_lists' : 'menu_link_blocked', r.host || '');
            return;
          }

          let port;
          try {
            port = chrome.runtime.connect({ name: global.SN_MSG.PORTS.AI_STREAM });
          } catch (_) {
            el.classList.remove('sn-menu-inline-loading');
            el.classList.add('sn-menu-inline-error');
            body.textContent = I18n.t('err_provider_failed');
            return;
          }
          let buf = '';
          let firstDelta = true;
          port.onMessage.addListener((m) => {
            if (m.type === 'delta') {
              if (firstDelta) {
                el.classList.remove('sn-menu-inline-loading');
                firstDelta = false;
              }
              buf += m.delta;
              // Sicurezza: niente HTML, è testo.
              body.textContent = buf;
            } else if (m.type === 'reset') {
              // Provider caduto a metà risposta, si riparte col fallback:
              // butta il testo parziale (l'avviso sicurezza resta).
              buf = '';
              body.textContent = '';
            } else if (m.type === 'done') {
              Popup.notaRipiego(el, m.keyFallback);
              Popup.notaInterrotta(el, m.finishReason);
            } else if (m.type === 'error') {
              el.classList.remove('sn-menu-inline-loading');
              el.classList.add('sn-menu-inline-error');
              Popup.scriviErrore(body, m, { dopo: chiudiMenu });
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

  // ------------------------------------------------------------
  // Salva / condividi / cerca / immagini
  // ------------------------------------------------------------

  // Cattura del tab visibile SOLO dopo che il compositor ha ripresentato la
  // pagina. Le azioni di cattura partono quasi sempre da un click nel menu del
  // tasto destro: il menu viene rimosso dal DOM in modo sincrono, ma
  // capturePage nel main fotografa il frame del compositor, che in quel
  // momento non è ancora stato ridisegnato — e il menu finiva "stampato"
  // dentro l'immagine (miniatura di "Salva per dopo", screenshot, ritagli).
  // Doppio requestAnimationFrame: il primo callback apre il frame che
  // incorpora la rimozione, il secondo gira quando quel frame è stato
  // committato; il piccolo timeout copre la presentazione fuori processo del
  // compositor prima che il main scatti la foto.
  function attendiCompositor() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 50)));
    });
  }

  // La foto resta com'è per l'utente; `campi` sono i campi segreti da coprire nella copia che va a un modello (#810.7),
  // null se non si sono potuti trovare tutti: quella copia allora non parte.
  async function captureVisibleTab() {
    await attendiCompositor();
    const prima = Extract.campiSegretiInVista();
    const r = await chrome.runtime.sendMessage({ type: MSG.CAPTURE_VISIBLE_TAB, campiSegreti: true, campiNellaPagina: prima.length });
    if (r?.ok) return { ...r, campi: prima.concat(Array.isArray(r.campi) ? r.campi : [], Extract.campiSegretiInVista()) };
    if (r?.code !== 'segreti') return r;
    const pura = await chrome.runtime.sendMessage({ type: MSG.CAPTURE_VISIBLE_TAB });
    return pura?.ok ? { ...pura, campi: null } : pura;
  }

  // Il nome del file lo sceglie un modello guardando la foto: gli arriva coi campi segreti coperti, o non gli arriva.
  async function descrizioneCoperta(dataUrl, campi, ritaglio = null) {
    if (!Array.isArray(campi)) return null;
    const perModello = campi.length ? await Extract.fotoCoperta(dataUrl, campi, { ritaglio }) : dataUrl;
    return requestImageDescription(perModello, dataUrl);
  }

  function buildSavePayload() {
    // Del sito non raggiungibile si salva solo dove sta: il testo qui è quello dell'errore.
    if (paginaDErrore()) return { url: indirizzoDellaPagina(), title: document.title, favicon: '', description: '', excerpt: '' };
    const meta = Extract.pageMeta();
    return {
      url: location.href,
      title: document.title,
      favicon: document.querySelector('link[rel~="icon"]')?.href || '',
      description: meta.description || '',
      excerpt: Extract.pageExcerpt(500),
    };
  }

  // Un secondo Alt+S (o clic) mentre il salvataggio è in corso non apre una seconda conferma: la scheda sta già per
  // chiudersi, e chi chiede riceve lo stesso esito (la voce salvata, o null).
  let salvataggioInCorso = null;
  const confermeMostrate = new Set();

  function savePage() {
    if (!salvataggioInCorso) {
      salvataggioInCorso = salva().then((entry) => {
        if (!entry) salvataggioInCorso = null;
        return entry;
      }, () => {
        salvataggioInCorso = null;
        return null;
      });
    }
    return salvataggioInCorso;
  }

  // La miniatura è della pagina: l'Aiuto aperto sopra non ci finisce dentro.
  function nascondiPannelli() {
    const aperti = [...document.querySelectorAll('.sn-sidebar')].filter((el) => el.style.visibility !== 'hidden');
    for (const el of aperti) el.style.visibility = 'hidden';
    return () => { for (const el of aperti) el.style.visibility = ''; };
  }

  async function salva() {
    // Committa il salvataggio SUBITO, prima di qualsiasi attesa. La cattura
    // della miniatura attende ~120ms che il menu sparisca
    // dal compositor: se in quella finestra la pagina fa un redirect o si
    // ricarica, il contesto del content script viene distrutto e il messaggio
    // di salvataggio non partirebbe mai — l'utente crederebbe di aver salvato
    // ma non ci sarebbe nulla, senza alcun avviso (#334). Raccogliamo i dati e
    // inviamo SAVE_PAGE in modo sincrono al click (l'IPC parte prima di ogni
    // await): la miniatura arriva dopo, ed è best-effort.
    const base = buildSavePayload();
    let entry = null;
    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.SAVE_PAGE, page: base });
      if (!res?.ok) {
        Popup.toastErrore('toast_save_failed');
        return null;
      }
      entry = res.entry;
    } catch (e) {
      // Contesto distrutto da un redirect immediato o errore IPC: avvisa
      // invece di fallire in silenzio.
      console.error('[SN] savePage', e);
      Popup.toastErrore('toast_save_failed');
      return null;
    }

    // Miniatura best-effort: la scatta il main (piccola, #839) dopo che il menu
    // è sparito dal compositor. La cattura DEVE precedere il toast di conferma,
    // altrimenti il toast finisce dentro la miniatura (#325): si aspetta la
    // risposta. Se la pagina è già cambiata la cattura può fallire: il
    // salvataggio resta comunque valido, solo senza anteprima.
    const rimetti = nascondiPannelli();
    try {
      await attendiCompositor();
      if (entry?.id) await chrome.runtime.sendMessage({ type: MSG.SET_SAVED_PAGE_THUMB, id: entry.id });
    } catch (_) { /* miniatura opzionale */ }
    rimetti();

    // Conferma CLICCABILE: porta alla lista dove la pagina è finita (#252).
    showSaveConfirm(entry);
    return entry;
  }

  // Riquadro di conferma di "Salva per dopo" (#252). La scheda salvata sta per
  // chiudersi: prima di farlo diamo qualche secondo per raggiungere la lista
  // dove la pagina è finita. Cliccandolo apre "Aperti per dopo" con la scheda
  // appena messa da parte evidenziata; ignorandolo, la scheda si chiude da sola
  // come prima. È l'unico modo per far scoprire la lista proprio nel momento in
  // cui serve, senza aggiungere voci di menu.
  // `chiudiScheda: false` quando la mostra la scheda davanti per un salvataggio che la scheda salvata non poteva confermare (#839).
  // `conferma` è l'etichetta di quel salvataggio: il main la riprova finché una pagina risponde, e ogni salvataggio si conferma una volta sola.
  function showSaveConfirm(entry, { chiudiScheda = true, conferma = '' } = {}) {
    const AUTO_CLOSE_MS = 4000;
    let done = false;
    let timer = null;
    if (conferma) {
      if (confermeMostrate.has(conferma)) return;
      confermeMostrate.add(conferma);
    }

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
    Popup.mountToast(pill, {
      sticky: true,
      chiudi: () => finish(false),
      azioni: [{ label: I18n.t('toast_saved_open'), fn: () => finish(true) }],
    });
    requestAnimationFrame(() => pill.classList.add('sn-save-confirm-visible'));

    const finish = (openList) => {
      if (done) return;
      done = true;
      if (chiudiScheda) salvataggioInCorso = null;
      if (timer) { timer.annulla(); timer = null; }
      pill.dataset.snClosing = '1';
      pill.classList.remove('sn-save-confirm-visible');
      setTimeout(() => { try { Popup.unmountToast(pill); } catch (_) {} }, self.SN_THEME_TOKENS?.motionMs(220) ?? 220);
      if (openList && entry && entry.id) {
        chrome.runtime.sendMessage({ type: MSG.OPEN_HOME, highlight: entry.id }).catch(() => {});
      }
      if (chiudiScheda) chrome.runtime.sendMessage({ type: MSG.CLOSE_TAB }).catch(() => {});
    };

    pill.addEventListener('click', (e) => { if (gestoVero(e)) finish(true); });
    pill.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && gestoVero(e)) { e.preventDefault(); finish(true); }
    });
    // Nella pila: col puntatore sopra aspetta, come gli altri avvisi (la scheda si chiude dopo).
    timer = Popup.tempoAvviso(AUTO_CLOSE_MS, () => finish(false), { deveScadere: true });
  }

  async function saveLink(linkEl) {
    const res = await chrome.runtime.sendMessage({
      type: MSG.SAVE_LINK,
      url: indirizzoDelLink(linkEl),
      title: nomeDelLink(linkEl) || indirizzoDelLink(linkEl),
    });
    if (res?.ok) Popup.showToast(I18n.t('toast_link_saved'));
  }

  function dataUrlToBlob(dataUrl) {
    const m = /^data:([^;,]*)[^,]*;base64,(.*)$/s.exec(String(dataUrl || ''));
    if (!m) throw new Error('immagine non leggibile');
    const bin = atob(m[2]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: m[1] || 'application/octet-stream' });
  }

  async function copyImage(imgEl) {
    try {
      const originale = await scaricaImmagine(imgEl.currentSrc || imgEl.src, imgEl);
      const blob = dataUrlToBlob(originale);
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
      // Dopo la scrittura: il main legge gli appunti per riconoscere la copia quando torna incollata.
      chrome.runtime.sendMessage({ type: MSG.IMAGE_COPIED, originale, copia: dataUrl }).catch(() => {});
      const description = await describeImage(pngBlob);
      pushClipboardEntry({ type: 'image', dataUrl, description });
      Popup.showToast(I18n.t('toast_copied'));
    } catch (_) {}
  }

  async function downloadImage(imgEl) {
    const src = imgEl.currentSrc || imgEl.src;
    if (!src) return;
    // data: e blob: vivono solo nella pagina: lì Chromium onora l'attributo download e il
    // main non saprebbe risolverli, quindi restano sul cammino anchor.
    if (/^(data:|blob:)/i.test(src)) {
      const a = document.createElement('a');
      a.href = src;
      const m = /^data:image\/([a-z0-9.+-]+)/i.exec(src);
      a.download = 'image.' + (m ? m[1].replace(/[^a-z0-9]/gi, '') : 'png');
      document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    // Sulle immagini http(s) cross-origin Chromium ignora l'attributo download e la scheda
    // NAVIGAVA sull'immagine (#274): scarica il main, che risponde a download concluso.
    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.DOWNLOAD_IMAGE, url: src, politiche: politicheReferrer(imgEl) });
      if (res?.ok) Popup.showToast(I18n.t('toast_image_saved'));
      else if (!res?.cancelled) Popup.toastErrore('toast_image_save_failed');
    } catch (_) {
      Popup.toastErrore('toast_image_save_failed');
    }
  }

  // «Salva file» solo per i link a un file: su una pagina scaricherebbe l'HTML. Si decide
  // dagli indizi locali (attributo download, estensione non navigabile), senza una HEAD.
  const PAGE_EXTS = new Set([
    'html', 'htm', 'xhtml', 'shtml', 'php', 'php3', 'php4', 'php5', 'phtml',
    'asp', 'aspx', 'jsp', 'jspx', 'cgi', 'pl', 'do', 'action', 'cfm',
  ]);
  function isDownloadableLink(linkEl) {
    if (!linkEl) return false;
    const href = indirizzoDelLink(linkEl);
    if (!/^https?:/i.test(href)) return false;
    try { if (linkEl.hasAttribute && linkEl.hasAttribute('download')) return true; } catch (_) {}
    let pathname = '';
    try { pathname = new URL(href).pathname || ''; } catch (_) { return false; }
    const base = pathname.split('/').filter(Boolean).pop() || '';
    const m = /\.([a-z0-9]{1,8})$/i.exec(base);
    if (!m) return false;                       // nessuna estensione ⇒ pagina
    return !PAGE_EXTS.has(m[1].toLowerCase());
  }

  // Instrada il download NATIVO della scheda, così il menu e il clic sul link danno lo
  // stesso risultato visibile: barra, cartella Download, cronologia (#410.2).
  async function downloadLink(linkEl) {
    const href = indirizzoDelLink(linkEl);
    if (!href) return;
    // Vedi downloadImage: data: e blob: restano sul cammino anchor.
    if (/^(data:|blob:)/i.test(href)) {
      const a = document.createElement('a');
      a.href = href;
      a.download = (linkEl.getAttribute && linkEl.getAttribute('download')) || '';
      document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.DOWNLOAD_LINK, url: href });
      if (res && res.ok === false) Popup.toastErrore('toast_file_save_failed');
    } catch (_) {
      Popup.toastErrore('toast_file_save_failed');
    }
  }

  function toggleFullscreen() {
    // Demanda al main: requestFullscreen() su una WebContentsView non porta
    // la BrowserWindow in fullscreen OS, resta confinato al bounds della view.
    chrome.runtime.sendMessage({ type: MSG.TOGGLE_FULLSCREEN });
  }

  async function shareCurrentPage() {
    const url = indirizzoDellaPagina();
    const data = { title: document.title, url };
    if (navigator.share) {
      try { await navigator.share(data); return; } catch (_) {}
    }
    copyToClipboard(url);
  }

  // Senza condivisione nativa si copia negli appunti: vale il discorso di «Copia URL»
  // (#437), l'indirizzo deve essere apribile.
  async function shareLink(linkEl) {
    const href = indirizzoDelLink(linkEl);
    if (!isAddress(href)) {
      Popup.toastErrore('toast_not_an_address');
      return;
    }
    const data = { title: nomeDelLink(linkEl) || href, url: href };
    if (navigator.share) {
      try { await navigator.share(data); return; } catch (_) {}
    }
    copyToClipboard(href);
  }

  function searchUrlFor(text) {
    return `https://www.google.com/search?q=${encodeURIComponent((text || '').slice(0, 500))}`;
  }

  // Una voce del menu di Filo non usa il gesto della pagina (è di Filo): l'indirizzo scelto lo dichiara prima (#737.1).
  function apriInSchedaNuova(url) {
    if (!url) return;
    // Questi Chromium li rifiuta a una pagina senza dire niente: li ferma il main, che lo dice (#482).
    if (/^(?:file|data|javascript|vbscript):/i.test(String(url).trim())) {
      chrome.runtime.sendMessage({ type: MSG.OPEN_NEW_TAB, url: String(url) }).catch(() => {});
      return;
    }
    try {
      if (typeof global.SN_APERTURA_SCELTA === 'function') {
        const voce = global.SN_MENU && typeof global.SN_MENU.azioneInCorso === 'function' ? global.SN_MENU.azioneInCorso() : null;
        if (voce) voce.apre = true;
        global.SN_APERTURA_SCELTA(url, voce ? { id: voce.id, t0: voce.t0 } : null);
      }
    } catch (_) {}
    window.open(url, '_blank', 'noopener');
  }

  function searchTextOnWeb(text) {
    apriInSchedaNuova(searchUrlFor(text));
  }

  // Il menu di Filo prende il posto di quello di Chromium ovunque: senza queste voci il
  // tasto destro su un filmato non offrirebbe nulla (#400).

  const MEDIA_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  function isAudioEl(el) {
    return !!el && el.tagName === 'AUDIO';
  }

  // `currentSrc` è la sorgente che il browser sta davvero riproducendo (risolve i <source>
  // multipli); prima del caricamento si ripiega sull'attributo e sul primo <source>.
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

  // Ripetizione e controlli non danno riscontro a schermo (il filmato continua identico):
  // il toast è l'unica conferma che l'azione ha avuto effetto.
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
      Popup.toastErrore('toast_pip_failed');
    }
  }

  // Un blob: non è un indirizzo utilizzabile fuori dalla scheda: dirlo è meglio che
  // copiare una stringa che altrove non apre nulla (#437).
  function copyMediaUrl(el) {
    const src = mediaSrc(el);
    if (!src || /^blob:/i.test(src)) {
      Popup.toastErrore('toast_media_stream_only');
      return;
    }
    copyUrlToClipboard(src);
  }

  async function downloadMedia(el) {
    const audio = isAudioEl(el);
    const failToast = audio ? 'toast_audio_save_failed' : 'toast_video_save_failed';
    const src = mediaSrc(el);
    if (!src) { Popup.toastErrore(failToast); return; }

    // Come in downloadImage, blob: e data: restano sul cammino anchor. Un blob: di
    // MediaSource non è leggibile: lì non esiste nessun file da salvare.
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
        Popup.toastErrore('toast_media_stream_only');
      }
      return;
    }

    // Come per le immagini (#274) scarica il main, con Referer e cookie della scheda: così
    // regge il cross-origin e la protezione hotlink.
    try {
      const res = await chrome.runtime.sendMessage({
        type: MSG.DOWNLOAD_MEDIA,
        url: src,
        kind: audio ? 'audio' : 'video',
        politiche: politicheReferrer(el),
      });
      if (res?.ok) Popup.showToast(I18n.t(audio ? 'toast_audio_saved' : 'toast_video_saved'));
      else if (!res?.cancelled) Popup.toastErrore(failToast);
    } catch (_) {
      Popup.toastErrore(failToast);
    }
  }

  // Il corpo accelera di uno scatto, la freccetta apre l'elenco completo. L'etichetta
  // porta la velocità corrente, così il menu dice anche in che stato è il filmato.
  function buildMediaSpeedItem(el) {
    const rate = Number(el.playbackRate) || 1;
    return {
      type: 'split',
      azione: 'video-audio-controls',
      label: `${I18n.t('menu_media_speed')} ${formatSpeed(rate)}`,
      arrowTitle: I18n.t('menu_media_speed_pick'),
      onClick: () => setMediaSpeed(el, nextMediaSpeed(rate)),
      subItems: MEDIA_SPEEDS.map((s) => ({
        azione: 'video-audio-controls',
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
      azione: 'video-audio-controls',
      label: I18n.t(el.paused ? 'menu_media_play' : 'menu_media_pause'),
      onClick: () => toggleMediaPlay(el),
    });
    items.push({
      type: 'item',
      azione: 'video-audio-controls',
      label: I18n.t(el.muted ? 'menu_media_unmute' : 'menu_media_mute'),
      onClick: () => toggleMediaMute(el),
    });
    items.push(buildMediaSpeedItem(el));
    items.push({
      type: 'item',
      azione: 'video-audio-controls',
      label: I18n.t(el.loop ? 'menu_media_loop_off' : 'menu_media_loop'),
      onClick: () => toggleMediaLoop(el),
    });
    if (mediaPipAvailable(el)) {
      items.push({
        type: 'item',
        azione: 'video-pip',
        label: I18n.t(isMediaInPip(el) ? 'menu_media_pip_exit' : 'menu_media_pip'),
        onClick: () => toggleMediaPip(el),
      });
    }
    items.push({
      type: 'item',
      azione: 'video-audio-controls',
      label: I18n.t(el.controls ? 'menu_media_hide_controls' : 'menu_media_show_controls'),
      onClick: () => toggleMediaControls(el),
    });
    items.push({ type: 'separator' });
    items.push({
      type: 'item',
      azione: 'copy-download-video',
      label: I18n.t(audio ? 'menu_copy_audio_link' : 'menu_copy_video_link'),
      onClick: () => copyMediaUrl(el),
    });
    items.push({
      type: 'item',
      azione: 'copy-download-video',
      label: I18n.t(audio ? 'menu_save_audio_as' : 'menu_save_video_as'),
      onClick: () => downloadMedia(el),
    });
    return items;
  }

  // Lens-style reverse search (più affidabile di searchbyimage)
  function imageSearchUrlFor(imgEl) {
    const src = imgEl && (imgEl.currentSrc || imgEl.src);
    return src ? `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(src)}` : '';
  }

  function searchImageOnWeb(imgEl) {
    const url = imageSearchUrlFor(imgEl);
    apriInSchedaNuova(url);
  }

  async function takeScreenshot() {
    try {
      const cap = await captureVisibleTab();
      if (!cap?.dataUrl) {
        Popup.toastErrore('err_provider_failed');
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
      const desc = await descrizioneCoperta(cap.dataUrl, cap.campi).catch(() => null);
      try {
        chrome.runtime.sendMessage({
          type: MSG.PUSH_CLIPBOARD_ENTRY,
          entry: { type: 'image', dataUrl: cap.dataUrl, description: desc || imagePlaceholderLabel(cap.dataUrl) },
        }).catch(() => {});
      } catch (_) {}
      const a = document.createElement('a');
      a.href = cap.dataUrl;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      a.download = descriptionToFilename(desc) || `screenshot-${stamp}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (_) {}
  }

  // Risolve con { dataUrl, rect } — ritaglio PNG e rettangolo in pixel CSS — o null se
  // l'utente annulla. Gli errori escono come reject, non loggati.
  async function selectScreenRegion() {
    const cap = await captureVisibleTab();
    if (!cap?.dataUrl) throw new Error('capture failed');

    // L'immagine catturata è in pixel del device, l'overlay in pixel CSS: il viewport CSS si
    // conserva qui per calcolare la scala a immagine caricata.
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = cap.dataUrl;
    });

    return new Promise((resolve) => {
      // Crosshair disegnato da noi: quello di sistema su sfondo variabile può risultare
      // invisibile sopra la maschera semitrasparente. Hotspot al centro (16,16).
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
      // Stili inline per non dipendere da CSS esterni: l'overlay deve funzionare in qualsiasi
      // pagina, anche con CSP o stili restrittivi.
      Object.assign(overlay.style, {
        position: 'fixed', inset: '0', zIndex: '2147483647',
        cursor: cursorRule, userSelect: 'none', pointerEvents: 'auto',
      });
      overlay.setAttribute('data-sn-theme', document.documentElement.dataset.snTheme || '');

      // Il cursore va impostato sui figli: `cursor` si eredita, ma alcuni runtime Electron non
      // lo propagano durante il drag e l'utente resta senza riferimento visivo.
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
          r.onload = () => resolve({ dataUrl: r.result, blob, rect: { x: minX, y: minY, w, h }, campi: cap.campi });
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

      // Il riquadro scelto diventa una chiamata al modello, un file e gli appunti: lo disegna solo il mouse dell'utente.
      overlay.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || !gestoVero(e)) return;
        dragging = true;
        startX = curX = e.clientX;
        startY = curY = e.clientY;
        updateMask(startX, startY, startX, startY);
      });
      overlay.addEventListener('mousemove', (e) => {
        if (!dragging || !gestoVero(e)) return;
        curX = e.clientX; curY = e.clientY;
        updateMask(startX, startY, curX, curY);
      });
      overlay.addEventListener('mouseup', (e) => {
        if (!dragging || !gestoVero(e)) return;
        dragging = false;
        curX = e.clientX; curY = e.clientY;
        finish();
      });
      document.addEventListener('keydown', onKey, true);

      document.documentElement.appendChild(overlay);
    });
  }

  // Stessi effetti dello screenshot pieno: download, appunti, cronologia.
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
      const desc = await descrizioneCoperta(dataUrl, region.campi, region.rect).catch(() => null);
      try {
        chrome.runtime.sendMessage({
          type: MSG.PUSH_CLIPBOARD_ENTRY,
          entry: { type: 'image', dataUrl, description: desc || imagePlaceholderLabel(dataUrl) },
        }).catch(() => {});
      } catch (_) {}
      const a = document.createElement('a');
      a.href = dataUrl;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      a.download = descriptionToFilename(desc) || `screenshot-${stamp}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (_) {
      Popup.toastErrore('err_provider_failed');
    }
  }

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
      if (!res?.ok) { Popup.avvisoErrore(res); return; }
      const text = (res.text || '').trim();
      if (!text) { Popup.toastErrore('toast_transcribe_empty'); return; }
      try { await navigator.clipboard.writeText(text); } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        ta.remove();
      }
      try { pushClipboardEntry({ type: 'text', text }); } catch (_) {}
      // Copiato, ma non intero: fermato al tetto di lunghezza (#1097.3).
      const interrotta = globalThis.SN_CHAT_ERRORS?.rispostaInterrotta?.(res.finishReason);
      Popup.showToast(interrotta ? `${I18n.t('toast_transcribed')} ${interrotta}` : I18n.t('toast_transcribed'), interrotta ? { duration: 9000 } : undefined);
    } catch (_) {
      Popup.toastErrore('err_provider_failed');
    }
  }

  // La Clipboard API accetta solo image/png: il data URL (di solito JPEG) passa da canvas.
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

  // ------------------------------------------------------------
  // Color picker + QR code
  // ------------------------------------------------------------
  // Color picker stile PowerToys: usa la EyeDropper API nativa di Chrome. Al
  // click sull'icona il cursore cambia (gestito dal browser/SO) e la prossima
  // pressione del tasto sinistro su un pixel qualsiasi della pagina copia il
  // colore in formato hex nella clipboard. Esc annulla.
  // `scelto`: il colore l'ha già preso la barra laterale, che ha il gesto dell'utente e la pagina no (#1246).
  async function pickColor(scelto) {
    const giaScelto = typeof scelto === 'string' && /^#[0-9a-f]{6}$/i.test(scelto);
    if (!giaScelto && typeof window.EyeDropper !== 'function') {
      Popup.toastErrore('err_color_picker_unsupported', { duration: 3000 });
      return;
    }
    try {
      const result = giaScelto ? { sRGBHex: scelto } : await new window.EyeDropper().open();
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

  // La codifica del QR è locale (src/shared/qr.js): l'URL non va mai a servizi esterni.
  // Resta nero su bianco a prescindere dal tema: il contrasto che gli scanner pretendono.
  function showPageQrCode() {
    const QR = global.SN_QR;
    const url = String(location.href || '');
    if (!QR || typeof QR.toMatrix !== 'function') {
      Popup.toastErrore('qr_error', { duration: 3000 });
      return;
    }
    let matrix;
    try {
      matrix = QR.toMatrix(url, { ecc: 'M' });
    } catch (e) {
      Popup.toastErrore('qr_error', { duration: 3500 });
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

    // documentElement porta data-sn-theme e le variabili della palette anche sulle pagine
    // esterne: si usano quelle, col fallback se il tema non è ancora applicato.
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

    // Tile bianca: stacca il QR dal tema scuro e garantisce la quiet zone che gli scanner
    // pretendono, qualunque sia il colore della card.
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
        'font-family:inherit', 'cursor:pointer', 'transition:background calc(.12s * var(--sn-motion, 1)),border-color calc(.12s * var(--sn-motion, 1))',
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
    downloadBtn.addEventListener('click', (e) => { if (gestoVero(e)) downloadQrPng(matrix, quiet, url); });

    const copyBtn = mkBtn(I18n.t('qr_copy_link'), false);
    copyBtn.addEventListener('click', async (e) => {
      if (!gestoVero(e)) return;
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
      Popup.toastErrore('qr_error', { duration: 2500 });
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
    pushClipboardEntry,
    requestImageDescription,
    descriptionToFilename,
    triggerExplainOrTranslate,
    triggerExplainDeep,
    schedulePrefetchExplain,
    buildInlineExplain,
    buildInlineExplainImage,
    leggiOrigine,
    scaricaImmagine,
    buildInlineExplainLink,
    SELETTORE_COLLEGAMENTO,
    indirizzoDelLink,
    // salva / condividi / cerca / immagini
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
    apriInSchedaNuova,
    searchUrlFor,
    searchImageOnWeb,
    imageSearchUrlFor,
    // video / audio
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
