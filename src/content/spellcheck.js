// Correttore AI a due livelli, complementare a quello nativo. ROSSO: lo zigzag del browser, che non tocchiamo; al click destro su un editabile senza errore blu sotto il cursore, il menu chiede un suggerimento on-demand (requestWordSuggestion).
// BLU: un overlay assoluto sopra l'editabile focalizzato ripete il testo in color:transparent e disegna lo zigzag sotto i range che l'LLM ha marcato (semantic, grammar, repetition). L'editabile vero resta intatto, il blu è solo un livello visivo.
// Restrizioni volute: solo <textarea> e [contenteditable] (niente <input>: barre di ricerca, password), aggancio al focus, debounce 1500ms, e oltre una certa lunghezza niente scan continuo per non bombardare l'API.

(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;
  const { ACTIONS, STORAGE_KEYS } = global.SN_CONST;

  const DEBOUNCE_MS = 1500;
  const MIN_TEXT_LENGTH = 8;
  const MAX_TEXT_LENGTH = 4000;

  // Stato per ogni editabile agganciato. WeakMap per non trattenere riferimenti che impedirebbero la GC se il sito rimuove l'elemento.
  const monitored = new WeakMap();
  let activeEl = null;
  let personalDict = new Set();
  let autocorrectMap = {}; // { lowercased misspelled: correction }
  let settings = null;
  // Guardia contro la ricorsione: l'applyFix dell'autocorrect dispatcha un input event che rientrerebbe nel listener; la flag salta una passata sola.
  let suppressAutocorrect = false;

  // Suggerimenti del correttore NATIVO (Electron), spinti dal main via `_spell:native` al context-menu (tabs.js): immediati e indipendenti dall'LLM, il menu li usa come base affidabile.
  let lastNative = { word: '', suggestions: [], ts: 0 };
  const nativeWaiters = new Set();

  function init(s) {
    settings = s;
    loadDictionary();
    loadAutocorrect();

    // capture per intercettare anche il focus su elementi dentro custom element e shadow root.
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);

    window.addEventListener('scroll', queueSync, true);
    window.addEventListener('resize', queueSync, true);

    try {
      chrome.runtime.onMessage.addListener((m) => {
        if (m?.type !== '_spell:native') return;
        lastNative = {
          word: String(m.word || ''),
          suggestions: Array.isArray(m.suggestions) ? m.suggestions : [],
          ts: Date.now(),
        };
        // Marker DOM per i test: espone l'ultima parola nativa ricevuta, così un test può aspettare il broadcast invece di un timeout fisso (fonte di flakiness). Innocuo a runtime.
        try { document.documentElement.dataset.filoNativeWord = lastNative.word; } catch (_) {}
        for (const fn of [...nativeWaiters]) { try { fn(lastNative); } catch (_) {} }
      });
    } catch (_) {}

    // Aggiornamento live se la pagina del correttore cambia dizionario/autocorrect.
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes[STORAGE_KEYS.PERSONAL_DICT]) {
          const words = changes[STORAGE_KEYS.PERSONAL_DICT].newValue || [];
          personalDict = new Set(words.map((w) => String(w).toLowerCase()));
        }
        if (changes[STORAGE_KEYS.AUTOCORRECT]) {
          autocorrectMap = changes[STORAGE_KEYS.AUTOCORRECT].newValue || {};
        }
      });
    } catch (_) {}
  }

  function updateSettings(s) {
    settings = s;
    if (!isEnabled()) detachAll();
  }

  function isEnabled() {
    return settings?.featureFlags?.spellcheck !== false;
  }

  async function loadDictionary() {
    try {
      const d = await chrome.storage.local.get(STORAGE_KEYS.PERSONAL_DICT);
      const words = d?.[STORAGE_KEYS.PERSONAL_DICT] || [];
      personalDict = new Set(words.map((w) => String(w).toLowerCase()));
    } catch (_) {}
  }

  async function addToDictionary(word) {
    const w = String(word || '').trim();
    if (!w) return;
    const wLower = w.toLowerCase();
    // Match case-insensitive: se la parola (in qualsiasi casing) è già presente, non aggiungerla.
    if (personalDict.has(wLower)) return;
    personalDict.add(wLower); // Il set interno resta lowercase per isInDictionary
    try {
      const d = await chrome.storage.local.get(STORAGE_KEYS.PERSONAL_DICT);
      const existing = d?.[STORAGE_KEYS.PERSONAL_DICT] || [];
      const alreadyExists = existing.some((x) => String(x).toLowerCase() === wLower);
      if (!alreadyExists) {
        existing.push(w); // preserva il casing originale
        await chrome.storage.local.set({ [STORAGE_KEYS.PERSONAL_DICT]: existing });
      }
    } catch (_) {}
  }

  function isInDictionary(word) {
    return personalDict.has(String(word || '').trim().toLowerCase());
  }

  async function loadAutocorrect() {
    try {
      const d = await chrome.storage.local.get(STORAGE_KEYS.AUTOCORRECT);
      const m = d?.[STORAGE_KEYS.AUTOCORRECT] || {};
      autocorrectMap = (m && typeof m === 'object') ? m : {};
    } catch (_) {}
  }

  async function setAutocorrect(misspelled, correction) {
    const w = String(misspelled || '').trim().toLowerCase();
    const c = String(correction || '').trim();
    if (!w || !c) return;
    autocorrectMap = { ...autocorrectMap, [w]: c };
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.AUTOCORRECT]: autocorrectMap });
    } catch (_) {}
  }

  function isWordCharLocal(c) { return !!c && /[\p{L}\p{N}'’\-]/u.test(c); }
  function isBoundaryChar(c) {
    // Whitespace o punteggiatura "fine parola" che ha senso per l'autocorrect.
    return !!c && /[\s.,!?;:)\]…"'»“”]/u.test(c);
  }

  // La correzione prende il case della parola digitata: tutta maiuscola, iniziale maiuscola, o invariata.
  function matchCase(originalWord, correction) {
    if (!originalWord || !correction) return correction;
    if (originalWord.length > 1 && originalWord === originalWord.toUpperCase()) {
      return correction.toUpperCase();
    }
    const first = originalWord[0];
    if (first && first === first.toUpperCase() && first !== first.toLowerCase()) {
      return correction[0].toUpperCase() + correction.slice(1);
    }
    return correction;
  }

  function tryAutocorrect(state) {
    if (suppressAutocorrect) return;
    if (!autocorrectMap || Object.keys(autocorrectMap).length === 0) return;
    const el = state.el;
    const text = getEditableText(el);
    if (!text) return;

    let pos = -1;
    if (el.tagName === 'TEXTAREA') {
      pos = el.selectionStart ?? -1;
    } else {
      pos = contenteditableCaretOffset(el);
    }
    if (pos <= 1) return;

    const lastChar = text[pos - 1];
    if (!isBoundaryChar(lastChar)) return;

    const end = pos - 1;
    // Serve almeno un carattere di parola prima del confine.
    if (end <= 0 || !isWordCharLocal(text[end - 1])) return;

    const match = findAutocorrectMatch(text, end);
    if (!match) return;
    const { start } = match;
    const original = text.slice(start, end);
    const replacement = matchCase(original, autocorrectMap[match.key]);
    if (!replacement || replacement === original) return;

    suppressAutocorrect = true;
    try {
      applyFix(el, { start, end }, replacement, { cursor: 'preserve' });
    } finally {
      // Resetta la guardia dopo il flush degli eventi sincroni e dell'input event
      // riemesso da setRangeText.
      setTimeout(() => { suppressAutocorrect = false; }, 0);
    }
  }

  // Le chiavi possono contenere spazi ("x es" → "per esempio"), quindi non basta il token prima del confine: a parità di posizione finale vince la più lunga, così "x es" batte "es".
  // Ritorna { start, key } con la chiave lowercased della mappa, oppure null.
  function findAutocorrectMatch(text, end) {
    const lowerRegion = text.slice(0, end).toLowerCase();
    let best = null;
    for (const key of Object.keys(autocorrectMap)) {
      if (!key) continue;
      const start = end - key.length;
      if (start < 0) continue;
      if (lowerRegion.slice(start) !== key) continue;
      // Confine di parola a sinistra, così "es" non scatta dentro "mese".
      if (start > 0 && isWordCharLocal(text[start - 1])) continue;
      // La chiave deve iniziare con un carattere di parola: esclude i match che partono da uno spazio interno spurio.
      if (!isWordCharLocal(text[start])) continue;
      if (!best || key.length > best.key.length) best = { start, key };
    }
    return best;
  }

  // Popola il Range passato e NON lo aggiunge alla selection: quello lo fa il chiamante.
  function placeCaretAtOffset(el, target, range) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let cur = 0, n;
    while ((n = walker.nextNode())) {
      const len = n.nodeValue.length;
      if (cur + len >= target) {
        range.setStart(n, Math.max(0, target - cur));
        range.collapse(true);
        return;
      }
      cur += len;
    }
    range.selectNodeContents(el);
    range.collapse(false);
  }

  // Offset (0-based) del caret nel testo completo dell'elemento contenteditable.
  function contenteditableCaretOffset(el) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return -1;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.endContainer)) return -1;
    let offset = 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n === range.endContainer) return offset + range.endOffset;
      offset += n.nodeValue.length;
    }
    return -1;
  }

  // Solo textarea e contenteditable, niente <input>. Del contenteditable si aggancia SOLO il root che porta l'attributo: i discendenti ereditano isContentEditable,
  // ma un overlay su un figlio — uno <span> dentro l'editor di Slack o Twitter — sballa allineamento e dimensioni.
  function isSupportedEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === 'TEXTAREA') return !el.disabled && !el.readOnly;
    if (typeof el.getAttribute !== 'function') return false;
    const ce = el.getAttribute('contenteditable');
    return ce === '' || ce === 'true' || ce === 'plaintext-only';
  }

  // L'editabile può essere un antenato del target. Saliamo finché non troviamo
  // un textarea o un elemento con attributo contenteditable.
  function findSupportedEditable(el) {
    while (el && el.nodeType === 1) {
      if (isSupportedEditable(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function onFocusIn(e) {
    if (!isEnabled()) return;
    const el = findSupportedEditable(e.target);
    if (!el) return;
    attach(el);
  }

  function onFocusOut(e) {
    const el = findSupportedEditable(e.target);
    if (!el) return;
    // L'overlay resta finché l'utente interagisce col popup correzione, altrimenti il click destro su un range blu lo farebbe sparire subito.
    setTimeout(() => {
      if (document.activeElement === el) return;
      detach(el);
    }, 200);
  }

  function attach(el) {
    let state = monitored.get(el);
    if (!state) {
      state = {
        el,
        overlay: null,
        issues: [],
        lastScannedText: '',
        timer: null,
        ro: null,
        // Cache delle correzioni per parola, riempita dal prefetch dopo lo scan blu e dalle richieste al click destro. Chiavi lowercased.
        wordCache: new Map(),
      };
      monitored.set(el, state);
      el.addEventListener('input', () => {
        tryAutocorrect(state);
        // Gli issue blu hanno offset relativi al testo di prima: basta un carattere per sfasarli tutti, quindi si cancellano subito e li ricostruisce il prossimo scan.
        // Senza, «Risolvi» applica il fix sul range sbagliato e si mangia la frase.
        if (state.issues.length) {
          state.issues = [];
          renderOverlayContent(state);
        }
        // Prefetch a parola chiusa (boundary char): il check parte subito, così al click destro non c'è attesa. Limitato e in background.
        prefetchJustCompletedWord(state);
        scheduleScan(state);
      });
      el.addEventListener('scroll', () => syncOverlay(state));
      try {
        state.ro = new ResizeObserver(() => syncOverlay(state));
        state.ro.observe(el);
      } catch (_) {}
    }
    activeEl = el;
    ensureOverlay(state);
    syncOverlay(state);
    scheduleScan(state);
  }

  function detach(el) {
    const state = monitored.get(el);
    if (!state) return;
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }
    if (state.overlay) { state.overlay.remove(); state.overlay = null; }
    if (state.ro) { try { state.ro.disconnect(); } catch (_) {} state.ro = null; }
    if (activeEl === el) activeEl = null;
    monitored.delete(el);
  }

  function detachAll() {
    if (activeEl) detach(activeEl);
  }

  // Stili copiati dall'editabile per allineare il testo invisibile dell'overlay.
  const COPIED_STYLE_PROPS = [
    'font-family', 'font-size', 'font-weight', 'font-style',
    'letter-spacing', 'word-spacing', 'text-transform', 'text-indent',
    'text-align', 'line-height', 'white-space', 'word-break', 'overflow-wrap',
    'tab-size', 'direction',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'box-sizing',
  ];

  function ensureOverlay(state) {
    if (state.overlay && document.body.contains(state.overlay)) return;
    const o = document.createElement('div');
    o.className = 'sn-spell-overlay';
    global.SN_FILO_UI?.mark(o);
    o.setAttribute('aria-hidden', 'true');
    document.body.appendChild(o);
    state.overlay = o;
  }

  function syncOverlay(state) {
    const o = state.overlay;
    const el = state.el;
    if (!o || !el || !document.body.contains(el)) return;

    const cs = window.getComputedStyle(el);
    const r = el.getBoundingClientRect();

    // Posizione fissa rispetto al viewport: l'overlay segue l'editabile.
    o.style.position = 'fixed';
    o.style.left = r.left + 'px';
    o.style.top = r.top + 'px';
    o.style.width = r.width + 'px';
    o.style.height = r.height + 'px';
    o.style.zIndex = '2147483646';
    o.style.pointerEvents = 'none';
    o.style.overflow = 'hidden';
    o.style.color = 'transparent';
    o.style.background = 'transparent';
    o.style.margin = '0';
    o.style.borderColor = 'transparent';
    o.style.borderStyle = cs.borderStyle || 'solid';
    o.dataset.snTheme = document.documentElement.dataset.snTheme || '';

    for (const p of COPIED_STYLE_PROPS) {
      o.style.setProperty(p, cs.getPropertyValue(p));
    }

    renderOverlayContent(state);

    o.scrollTop = el.scrollTop;
    o.scrollLeft = el.scrollLeft;
  }

  // Sincronizzazione differita per scroll/resize globali (evita ridisegni inutili).
  let syncQueued = false;
  function queueSync() {
    if (syncQueued || !activeEl) return;
    syncQueued = true;
    requestAnimationFrame(() => {
      syncQueued = false;
      const state = monitored.get(activeEl);
      if (state) syncOverlay(state);
    });
  }

  function getEditableText(el) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value;
    return el.textContent || '';
  }

  function renderOverlayContent(state) {
    const o = state.overlay;
    if (!o) return;
    const text = getEditableText(state.el);
    if (!text) { o.textContent = ''; return; }

    const issues = (state.issues || [])
      .filter((i) => i.start >= 0 && i.end <= text.length && i.end > i.start)
      .sort((a, b) => a.start - b.start);

    if (!issues.length) { o.textContent = text; return; }

    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const issue of issues) {
      if (issue.start > pos) {
        frag.appendChild(document.createTextNode(text.slice(pos, issue.start)));
      }
      const span = document.createElement('span');
      span.className = 'sn-semantic-error';
      span.textContent = text.slice(issue.start, issue.end);
      frag.appendChild(span);
      pos = issue.end;
    }
    if (pos < text.length) {
      frag.appendChild(document.createTextNode(text.slice(pos)));
    }
    o.innerHTML = '';
    o.appendChild(frag);
  }

  function scheduleScan(state) {
    if (!isEnabled()) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => scanText(state), DEBOUNCE_MS);
  }

  async function scanText(state) {
    if (!state || !state.el || !document.body.contains(state.el)) return;
    const text = getEditableText(state.el);

    if (!text || text.length < MIN_TEXT_LENGTH) {
      state.issues = [];
      state.lastScannedText = text;
      renderOverlayContent(state);
      return;
    }
    if (text === state.lastScannedText) return;
    if (text.length > MAX_TEXT_LENGTH) {
      // Niente scan continuo su testi enormi: lasciamo invariati gli issue precedenti.
      return;
    }

    const context = extractContext(state.el);
    let res;
    try {
      res = await chrome.runtime.sendMessage({
        type: MSG.AI_REQUEST,
        action: ACTIONS.SPELLCHECK_SEMANTIC,
        payload: { text, context },
      });
    } catch (err) {
      console.error('[SN] scan blu — sendMessage fallito:', err);
      return;
    }

    // Se nel frattempo l'utente ha modificato il testo la risposta si scarta, perché sarebbe disallineata: rilancia il prossimo input.
    const currentText = getEditableText(state.el);
    if (currentText !== text) return;

    if (!res?.ok) {
      console.error('[SN] scan blu — provider error:', res?.code, res?.error);
      return;
    }
    if (typeof res.text !== 'string') {
      console.warn('[SN] scan blu — risposta senza text:', res);
      return;
    }
    const allIssues = buildIssues(parseIssues(res.text), text);
    state.issues = allIssues;
    state.lastScannedText = text;
    renderOverlayContent(state);
    // Prefetch delle correzioni a parola singola, così il click destro trova la cache calda. Gli issue blu NON si filtrano col risultato: la verifica per-parola è una stima inaffidabile di «il browser ha messo il rosso»,
    // e LLM e spellcheck nativo dissentono spesso su parole italiane vere ma usate male. Il blu resta stabile; per non sovrapporsi al rosso, lo zigzag è offsettato in verticale via CSS.
    prefetchSingleWordSuggestions(state, text).catch((e) => {
      console.warn('[SN] prefetch single-word failed:', e);
    });
  }

  function getCachedSuggestion(el, word) {
    const state = monitored.get(el);
    if (!state || !state.wordCache) return null;
    return state.wordCache.get(String(word || '').toLowerCase()) || null;
  }

  function setCachedSuggestion(el, word, sugg) {
    const state = monitored.get(el);
    if (!state) return;
    if (!state.wordCache) state.wordCache = new Map();
    state.wordCache.set(String(word || '').toLowerCase(), sugg);
  }

  // Chiavi «in volo» per non chiedere due volte la stessa parola mentre la prima è in corso.
  function makeWordKey(word, sentence) {
    return String(word || '').toLowerCase() + '|' + String(sentence || '').trim().slice(0, 200);
  }

  // Check in background sulla parola appena chiusa, così al click destro la correzione è già in cache.
  async function prefetchJustCompletedWord(state) {
    if (!isEnabled()) return;
    const el = state.el;
    const text = getEditableText(el);
    if (!text || text.length < 2) return;
    let pos = -1;
    if (el.tagName === 'TEXTAREA') {
      pos = el.selectionStart ?? -1;
    } else {
      pos = contenteditableCaretOffset(el);
    }
    if (pos <= 1) return;
    const lastChar = text[pos - 1];
    if (!isBoundaryChar(lastChar)) return;
    let end = pos - 1;
    while (end > 0 && /\s/.test(text[end - 1])) end--;
    let s = end;
    while (s > 0 && /[\p{L}\p{N}'’\-]/u.test(text[s - 1])) s--;
    if (end <= s) return;
    const word = text.slice(s, end);
    if (!/[\p{L}]/u.test(word)) return;
    if (isInDictionary(word)) return;
    const sentence = sentenceAround(text, s, end);
    const key = makeWordKey(word, sentence);
    if (!state.wordCache) state.wordCache = new Map();
    if (!state.inflightKeys) state.inflightKeys = new Set();
    const cached = state.wordCache.get(word.toLowerCase());
    if (cached && cached.sentence === sentence) return; // già coperto
    if (state.inflightKeys.has(key)) return;
    state.inflightKeys.add(key);
    try {
      const ctx = extractContext(el);
      const sugg = await requestWordSuggestion({ word, sentence, prev: ctx.prev, next: ctx.next });
      // Salva anche se null o non-misspelled: evita ri-fire continui.
      state.wordCache.set(word.toLowerCase(), sugg ? { ...sugg, sentence } : { misspelled: false, correction: '', sentence });
    } catch (_) {
      // Errore: lasciamo che la richiesta possa essere riprovata in futuro.
    } finally {
      state.inflightKeys.delete(key);
    }
  }

  // Limite di chiamate simultanee per non saturare il provider.
  const PREFETCH_MAX = 8;

  async function prefetchSingleWordSuggestions(state, scannedText) {
    if (!state.issues?.length) return;
    const ctx = extractContext(state.el);
    const candidates = [];
    for (const issue of state.issues) {
      const seg = scannedText.slice(issue.start, issue.end).trim();
      // Solo issue che coprono una sola "parola" tipografica.
      if (!/^[\p{L}\p{N}'’\-]+$/u.test(seg)) continue;
      const key = seg.toLowerCase();
      // Già in cache? Salta la chiamata, ma considera comunque per il filtro.
      if (state.wordCache.has(key)) {
        candidates.push({ issue, seg, key, cached: state.wordCache.get(key) });
      } else {
        candidates.push({ issue, seg, key, cached: null });
      }
    }
    if (!candidates.length) return;

    const toFetch = candidates.filter((c) => !c.cached).slice(0, PREFETCH_MAX);
    await Promise.all(toFetch.map(async (c) => {
      const sentence = sentenceAround(scannedText, c.issue.start, c.issue.end);
      const sugg = await requestWordSuggestion({
        word: c.seg, sentence, prev: ctx.prev, next: ctx.next,
      });
      // In cache anche la frase usata, per accorgersi del cambio di contesto al click destro; entrano anche le risposte negative, per non rifare la chiamata.
      state.wordCache.set(c.key, sugg ? { ...sugg, sentence } : { misspelled: false, correction: '', sentence });
    }));
  }

  // Frase precedente e successiva al campo, best-effort: se non ci riusciamo tornano stringhe vuote.
  function extractContext(el) {
    let prev = '';
    let next = '';
    try {
      const parent = el.parentElement;
      if (!parent) return { prev, next };
      const siblings = Array.from(parent.childNodes);
      const idx = siblings.indexOf(el);
      if (idx > 0) {
        for (let i = idx - 1; i >= 0; i--) {
          const t = (siblings[i].textContent || '').trim();
          if (t) { prev = t; break; }
        }
      }
      if (idx >= 0 && idx < siblings.length - 1) {
        for (let i = idx + 1; i < siblings.length; i++) {
          const t = (siblings[i].textContent || '').trim();
          if (t) { next = t; break; }
        }
      }
    } catch (_) {}
    return { prev: prev.slice(0, 300), next: next.slice(0, 300) };
  }

  function parseIssues(raw) {
    if (!raw) return { annotated: '', issues: [] };
    const trimmed = String(raw).trim();
    // L'LLM a volte avvolge la risposta in ```json ... ```
    const cleaned = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return { annotated: '', issues: [] };
    try {
      const obj = JSON.parse(cleaned.slice(start, end + 1));
      return {
        annotated: typeof obj.annotated === 'string' ? obj.annotated : '',
        issues: Array.isArray(obj.issues) ? obj.issues : [],
      };
    } catch (_) {
      return { annotated: '', issues: [] };
    }
  }

  // Le porzioni fra ** si cercano IN ORDINE, ognuna a partire da dopo l'ultima trovata: così i refusi ripetuti ("oggi … oggi") finiscono sulla occorrenza giusta quando solo una è marcata.
  function locateAnnotatedRanges(text, annotated) {
    if (!annotated) return [];
    const out = [];
    const re = /\*\*(.+?)\*\*/g;
    let cursor = 0;
    let m;
    while ((m = re.exec(annotated)) !== null) {
      const marked = m[1];
      if (!marked) continue;
      const idx = text.indexOf(marked, cursor);
      if (idx < 0) {
        // Fallback: prova case-insensitive (l'LLM a volte cambia maiuscole).
        const lower = text.toLowerCase().indexOf(marked.toLowerCase(), cursor);
        if (lower < 0) { out.push(null); continue; }
        out.push({ start: lower, end: lower + marked.length });
        cursor = lower + marked.length;
        continue;
      }
      out.push({ start: idx, end: idx + marked.length });
      cursor = idx + marked.length;
    }
    return out;
  }

  function buildIssues({ annotated, issues }, text) {
    const ranges = locateAnnotatedRanges(text, annotated);
    const out = [];
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (!r) continue;
      const meta = (issues && issues[i]) || {};
      if (!['semantic', 'grammar', 'repetition'].includes(meta.type)) continue;
      const segment = text.slice(r.start, r.end).trim();
      if (!segment) continue;
      if (segment.split(/\s+/).every((w) => isInDictionary(w))) continue;
      out.push({
        type: meta.type,
        start: r.start,
        end: r.end,
        explanation: String(meta.explanation || '').slice(0, 100),
        correction: String(meta.correction || ''),
        // Segmento originale: applyFix lo confronta e rinuncia se il testo è cambiato dopo lo scan, per non sostituire la frase sbagliata.
        segment: text.slice(r.start, r.end),
      });
    }
    // Garantisce ordine + niente sovrapposizioni.
    out.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const it of out) {
      const last = merged[merged.length - 1];
      if (last && it.start < last.end) continue;
      merged.push(it);
    }
    return merged;
  }

  // Ritorna il range blu sotto il punto, se c'è; altrimenti null.
  function getSemanticIssueAt(el, clientX, clientY) {
    const state = monitored.get(el);
    if (!state || !state.issues?.length) return null;
    const pos = caretCharOffsetFromPoint(el, clientX, clientY);
    if (pos < 0) return null;
    for (const it of state.issues) {
      if (pos >= it.start && pos < it.end) return it;
    }
    return null;
  }

  // Parola sotto al click: { word, start, end, sentence, prev, next } oppure null.
  function getWordAt(el, clientX, clientY) {
    const text = getEditableText(el);
    if (!text) return null;
    const pos = caretCharOffsetFromPoint(el, clientX, clientY);
    if (pos < 0 || pos > text.length) return null;
    const idx = Math.min(pos, text.length - 1);
    const { start, end } = expandToWord(text, idx);
    if (end <= start) return null;
    const word = text.slice(start, end);
    if (!/[\p{L}]/u.test(word)) return null;
    const sentence = sentenceAround(text, start, end);
    const ctx = extractContext(el);
    return { word, start, end, sentence, prev: ctx.prev, next: ctx.next };
  }

  // Anche su <input> single-line: niente overlay blu, ma il suggerimento nel menu tasto destro ci deve essere, perché i soli suggerimenti nativi non arrivano sempre.
  // Ritorna lo stesso shape di getWordAt, così openSpellWordMenu non deve distinguere.
  function getInputWordAt(el, clientX) {
    if (!el || el.tagName !== 'INPUT') return null;
    const text = el.value || '';
    if (!text) return null;
    let pos = inputCharOffset(el, clientX);
    if (pos < 0) return null;
    const idx = Math.min(pos, text.length - 1);
    const { start, end } = expandToWord(text, idx);
    if (end <= start) return null;
    const word = text.slice(start, end);
    if (!/[\p{L}]/u.test(word)) return null;
    const sentence = text.trim() || word;
    const ctx = extractContext(el);
    return { word, start, end, sentence, prev: ctx.prev, next: ctx.next };
  }

  // Offset di carattere in un <input> single-line da una coordinata X del viewport, misurato col canvas imitando il font dell'elemento.
  function inputCharOffset(el, clientX) {
    const text = el.value || '';
    if (!text) return 0;
    const cs = window.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const px = clientX - r.left + (el.scrollLeft || 0)
      - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.borderLeftWidth || 0);
    const canvas = inputCharOffset._canvas || (inputCharOffset._canvas = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    let lo = 0, hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const w = ctx.measureText(text.slice(0, mid)).width;
      if (w < px) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(0, Math.min(text.length, lo));
  }

  function expandToWord(text, idx) {
    const isWordChar = (c) => !!c && /[\p{L}\p{N}'’\-]/u.test(c);
    let s = idx, e = idx;
    if (!isWordChar(text[s])) {
      // Se siamo sopra uno spazio/punteggiatura, prova a guardare il carattere precedente.
      if (isWordChar(text[s - 1])) { s = s - 1; e = s; }
      else return { start: 0, end: 0 };
    }
    while (s > 0 && isWordChar(text[s - 1])) s--;
    while (e < text.length && isWordChar(text[e])) e++;
    return { start: s, end: e };
  }

  function sentenceAround(text, start, end) {
    let s = start;
    while (s > 0 && !/[.!?\n]/.test(text[s - 1])) s--;
    let e = end;
    while (e < text.length && !/[.!?\n]/.test(text[e])) e++;
    return text.slice(s, Math.min(e + 1, text.length)).trim();
  }

  // Calcola l'offset di carattere (0-based) nel TESTO COMPLETO dell'editabile
  // a partire da coordinate viewport. Funziona sia per textarea che per contenteditable.
  function caretCharOffsetFromPoint(el, clientX, clientY) {
    if (el.tagName === 'TEXTAREA') {
      // Per la textarea caretPositionFromPoint non serve: offsetNode non è la textarea.
      return textareaCharOffset(el, clientX, clientY);
    }
    const doc = el.ownerDocument || document;
    let node = null, offset = 0;
    if (doc.caretPositionFromPoint) {
      const cp = doc.caretPositionFromPoint(clientX, clientY);
      if (cp) { node = cp.offsetNode; offset = cp.offset; }
    } else if (doc.caretRangeFromPoint) {
      const r = doc.caretRangeFromPoint(clientX, clientY);
      if (r) { node = r.startContainer; offset = r.startOffset; }
    }
    if (node && el.contains(node)) {
      let total = 0;
      const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        if (n === node) return total + offset;
        total += n.nodeValue.length;
      }
    }
    // La domanda «che carattere c'è in questo punto» si ferma al confine dei componenti web: dentro uno shadow root la risposta cade nel light DOM, fuori dall'editabile, o non arriva.
    // Lì, e in ogni altro caso di risposta inutilizzabile, misuriamo noi l'elemento che abbiamo già in mano (#438).
    return caretCharOffsetByRects(el, clientX, clientY);
  }

  // Quanti caratteri misurare uno per uno prima di passare alla ricerca binaria: in una mail o un documento il nodo di testo può essere enorme e un rettangolo per carattere costerebbe troppo.
  const RECT_SCAN_MAX = 400;
  const RECT_SCAN_WINDOW = 64;

  // Offset ricavato dalla sola geometria, confrontando i rettangoli dei caratteri col punto: non chiede niente al documento, quindi funziona ovunque viva l'editabile, componenti web compresi.
  // Ritorna -1 se il punto non cade su nessun testo.
  function caretCharOffsetByRects(el, clientX, clientY) {
    const doc = el.ownerDocument || document;
    let range;
    try { range = doc.createRange(); } catch (_) { return -1; }
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let total = 0, best = -1, bestDist = Infinity, n;
    while ((n = walker.nextNode())) {
      const len = n.nodeValue.length;
      if (!len) continue;
      let box = null;
      try { range.selectNodeContents(n); box = range.getBoundingClientRect(); } catch (_) {}
      // Solo i nodi la cui banda verticale contiene il punto: senza il filtro misureremmo tutto il testo dell'editabile.
      if (box && (box.width || box.height)
          && clientY >= box.top - 2 && clientY <= box.bottom + 2) {
        const hit = charOffsetInTextNode(range, n, clientX, clientY);
        if (hit.exact) return total + hit.index;
        if (hit.index >= 0 && hit.dist < bestDist) { bestDist = hit.dist; best = total + hit.index; }
      }
      total += len;
    }
    return best;
  }

  function charOffsetInTextNode(range, node, clientX, clientY) {
    const len = node.nodeValue.length;
    const rectOf = (i) => {
      try {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        let fallback = null;
        for (const r of range.getClientRects()) {
          if (!r.width && !r.height) continue;
          if (clientY >= r.top && clientY <= r.bottom) return r;
          if (!fallback) fallback = r;
        }
        return fallback;
      } catch (_) { return null; }
    };
    // Posizione del carattere rispetto al punto nell'ordine di lettura:
    // -1 = prima (riga sopra o più a sinistra), +1 = dopo, 0 = lo contiene.
    const side = (r) => {
      if (clientY > r.bottom) return -1;
      if (clientY < r.top) return 1;
      if (clientX > r.right) return -1;
      if (clientX < r.left) return 1;
      return 0;
    };

    let lo = 0, hi = len;
    if (len > RECT_SCAN_MAX) {
      let a = 0, b = len - 1;
      while (a < b) {
        const mid = (a + b) >> 1;
        const r = rectOf(mid);
        const s = r ? side(r) : 0;
        if (s < 0) a = mid + 1;
        else if (s > 0) b = mid;
        else { a = mid; break; }
      }
      lo = Math.max(0, a - RECT_SCAN_WINDOW);
      hi = Math.min(len, a + RECT_SCAN_WINDOW);
    }

    let best = -1, bestDist = Infinity;
    for (let i = lo; i < hi; i++) {
      const r = rectOf(i);
      if (!r) continue;
      if (side(r) === 0) return { exact: true, index: i, dist: 0 };
      const dx = clientX < r.left ? r.left - clientX : (clientX > r.right ? clientX - r.right : 0);
      const dy = clientY < r.top ? r.top - clientY : (clientY > r.bottom ? clientY - r.bottom : 0);
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return { exact: false, index: best, dist: bestDist };
  }

  // Posizione di carattere in una textarea, ricostruendo il word-wrap con un canvas che imita lo stile dell'elemento: costoso ma corretto.
  function textareaCharOffset(el, clientX, clientY) {
    const text = el.value;
    if (!text) return 0;
    const cs = window.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const px = clientX - r.left + el.scrollLeft - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.borderLeftWidth || 0);
    const py = clientY - r.top + el.scrollTop - parseFloat(cs.paddingTop || 0) - parseFloat(cs.borderTopWidth || 0);

    const lineHeight = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) * 1.2);
    const innerWidth = el.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);

    const canvas = textareaCharOffset._canvas || (textareaCharOffset._canvas = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;

    const wrap = cs.whiteSpace !== 'pre' && cs.whiteSpace !== 'nowrap';
    const lines = [];
    const paragraphs = text.split('\n');
    function lineStartOffset(idx) {
      let off = 0;
      for (let i = 0; i < idx; i++) off += paragraphs[i].length + 1;
      return off;
    }
    for (let p = 0; p < paragraphs.length; p++) {
      const para = paragraphs[p];
      if (!wrap) { lines.push({ text: para, startOffset: lineStartOffset(p) }); continue; }
      let cursor = 0;
      while (cursor <= para.length) {
        let lineEnd = cursor;
        let lastSpace = -1;
        let widthAcc = 0;
        for (let i = cursor; i <= para.length; i++) {
          if (i < para.length) {
            const ch = para[i];
            const w = ctx.measureText(ch).width;
            if (widthAcc + w > innerWidth && lastSpace > cursor) {
              lineEnd = lastSpace + 1;
              break;
            }
            if (ch === ' ') lastSpace = i;
            widthAcc += w;
          } else {
            lineEnd = para.length + 1;
            break;
          }
        }
        if (lineEnd === cursor) lineEnd = cursor + 1;
        const startOffset = lineStartOffset(p) + cursor;
        lines.push({ text: para.slice(cursor, Math.min(lineEnd, para.length)), startOffset });
        if (lineEnd > para.length) break;
        cursor = lineEnd;
      }
      if (para === '' && p < paragraphs.length - 1) {
        lines.push({ text: '', startOffset: lineStartOffset(p) });
      }
    }

    const lineIdx = Math.max(0, Math.min(lines.length - 1, Math.floor(py / lineHeight)));
    const line = lines[lineIdx];
    if (!line) return 0;

    let lo = 0, hi = line.text.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const w = ctx.measureText(line.text.slice(0, mid)).width;
      if (w < px) lo = mid + 1;
      else hi = mid;
    }
    return line.startOffset + Math.max(0, Math.min(line.text.length, lo));
  }

  function applyFix(el, range, replacement, opts = {}) {
    const safeReplacement = String(replacement == null ? '' : replacement);
    // 'end' = caret a fine inserzione (popup del correttore). 'preserve' = caret dov'era: nell'autocorrect l'utente ha appena digitato lo spazio e il caret deve restare dopo lo spazio, non dentro la parola.
    const cursorMode = opts.cursor || 'end';
    // Se il chiamante passa il testo che ci aspettiamo a [start, end) e non corrisponde più, si aborta: è la guardia contro «Risolvi cancella tutta la frase» con offset stale.
    const expected = typeof opts.expectedSegment === 'string' ? opts.expectedSegment : null;
    const currentText = getEditableText(el);
    if (expected !== null) {
      const actual = currentText.slice(range.start, range.end);
      if (actual !== expected) {
        console.warn('[SN] applyFix: testo cambiato fra scan e fix, skip', { expected, actual });
        return;
      }
    }
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const v = el.value;
      // Range fuori bounds o inizio ≥ fine: si esce. Senza, v.slice(range.end) oltre la lunghezza torna "" e il salvataggio cancella tutto il testo dopo range.start.
      if (typeof range.start !== 'number' || typeof range.end !== 'number' ||
          range.start < 0 || range.end > v.length || range.end <= range.start) {
        console.warn('[SN] applyFix: range fuori bounds, skip', { range, length: v.length });
        return;
      }
      // setRangeText (API standard) invece del concat manuale: mantiene l'undo stack del browser.
      try {
        el.setRangeText(safeReplacement, range.start, range.end, cursorMode === 'preserve' ? 'preserve' : 'end');
      } catch (_) {
        const before = v.slice(0, range.start);
        const after = v.slice(range.end);
        el.value = before + safeReplacement + after;
        const caret = before.length + safeReplacement.length;
        try { el.setSelectionRange(caret, caret); } catch (_) {}
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      const text = el.textContent || '';
      if (range.start < 0 || range.end > text.length || range.end <= range.start) {
        console.warn('[SN] applyFix CE: range fuori bounds, skip', { range, length: text.length });
        return;
      }
      // Salva l'offset originale del caret, per ripristinarlo in modalità 'preserve'.
      const caretBefore = cursorMode === 'preserve' ? contenteditableCaretOffset(el) : -1;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let cur = 0, startNode = null, startOff = 0, endNode = null, endOff = 0, n;
      while ((n = walker.nextNode())) {
        const len = n.nodeValue.length;
        if (!startNode && cur + len >= range.start) {
          startNode = n; startOff = range.start - cur;
        }
        if (!endNode && cur + len >= range.end) {
          endNode = n; endOff = range.end - cur;
          break;
        }
        cur += len;
      }
      if (!startNode || !endNode) return;

      const sel = window.getSelection();
      const r = document.createRange();
      try {
        r.setStart(startNode, startOff);
        r.setEnd(endNode, endOff);
      } catch (e) {
        console.warn('[SN] applyFix CE: range inválido', e);
        return;
      }
      sel.removeAllRanges();
      sel.addRange(r);

      // Prima execCommand('insertText'): passa dal pipeline beforeinput/input nativo, così gli editor controllati (Slate, Lexical, Discord) aggiornano il modello interno invece di resettare la mutazione DOM.
      // Il fallback a mutazione DOM diretta serve agli editor non controllati.
      let ok = false;
      try {
        if (safeReplacement.length > 0) {
          ok = document.execCommand('insertText', false, safeReplacement);
        } else {
          ok = document.execCommand('delete', false);
        }
      } catch (_) {}

      if (!ok) {
        try {
          // Riapplica la selezione se execCommand l'ha alterata, poi DOM-mutation.
          sel.removeAllRanges();
          sel.addRange(r);
          r.deleteContents();
          let newNode = null;
          if (safeReplacement.length > 0) {
            newNode = document.createTextNode(safeReplacement);
            r.insertNode(newNode);
          }
          const cr = document.createRange();
          if (cursorMode === 'preserve' && caretBefore >= 0) {
            const delta = safeReplacement.length - (range.end - range.start);
            const target = caretBefore >= range.end ? caretBefore + delta : caretBefore;
            placeCaretAtOffset(el, target, cr);
          } else if (newNode) {
            cr.setStartAfter(newNode);
            cr.collapse(true);
          } else {
            cr.setStart(startNode, startOff);
            cr.collapse(true);
          }
          sel.removeAllRanges();
          sel.addRange(cr);
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: safeReplacement }));
        } catch (e) {
          console.warn('[SN] applyFix CE fallback failed:', e);
        }
      }
    }
    // Rimuovi l'issue dallo stato e ridisegna; il prossimo scan rivaluterà.
    const state = monitored.get(el);
    if (state) {
      state.issues = (state.issues || []).filter((i) => !(i.start === range.start && i.end === range.end));
      state.lastScannedText = '';
      renderOverlayContent(state);
      scheduleScan(state);
    }
  }

  // Parola sotto il cursore → suggerimento dell'LLM: { misspelled, correction }, o null se la chiamata fallisce.
  async function requestWordSuggestion({ word, sentence, prev, next }) {
    try {
      const res = await chrome.runtime.sendMessage({
        type: MSG.AI_REQUEST,
        action: ACTIONS.SPELLCHECK_WORD,
        payload: { word, sentence, prev, next },
      });
      if (!res?.ok) {
        console.error('[SN] word check — provider error:', res?.code, res?.error);
        return null;
      }
      if (!res.text) {
        console.warn('[SN] word check — risposta vuota:', res);
        return null;
      }
      return parseWordResponse(res.text);
    } catch (err) {
      console.error('[SN] word check — sendMessage fallito:', err);
      return null;
    }
  }

  function parseWordResponse(raw) {
    const cleaned = String(raw).trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const obj = JSON.parse(cleaned.slice(start, end + 1));
      if (typeof obj.misspelled !== 'boolean') return null;
      return {
        misspelled: obj.misspelled,
        correction: String(obj.correction || ''),
      };
    } catch (_) { return null; }
  }

  // Suggerimenti nativi per `word` solo se recenti e riferiti a quella parola, altrimenti []. Il menu di correzione li usa come fonte immediata e affidabile, in parallelo al suggerimento contestuale dell'LLM.
  function getNativeSuggestions(word) {
    if (!word || !lastNative.word) return [];
    if (lastNative.word.toLowerCase() !== String(word).toLowerCase()) return [];
    if (Date.now() - lastNative.ts > 4000) return [];
    return lastNative.suggestions.slice();
  }

  // Callback una-tantum per la prossima notifica nativa, qualunque sia la parola: sugli <input> non sappiamo a priori quale sia, ce lo dice Electron. Ritorna la funzione per annullare.
  // `opts.since`: se il dato in cache è arrivato dopo quell'istante lo serviamo subito, perché openNormalMenuAt fa un await PRIMA di registrare il waiter e il broadcast può arrivare nel mezzo, andando perso.
  function onNextNativeSuggestion(cb, opts = {}) {
    const timeoutMs = typeof opts === 'number' ? opts : (opts.timeoutMs || 600);
    const since = (typeof opts === 'object' && opts.since) || 0;
    let done = false;
    let timer = null;
    const finish = () => { done = true; nativeWaiters.delete(waiter); clearTimeout(timer); };
    const waiter = (n) => {
      if (done) return;
      finish();
      cb({ word: n.word, suggestions: (n.suggestions || []).slice() });
    };
    if (since && lastNative.ts >= since && lastNative.word) {
      // Già arrivato durante l'await: consegna sincrona al prossimo tick.
      const snapshot = lastNative;
      setTimeout(() => waiter(snapshot), 0);
      timer = setTimeout(finish, timeoutMs);
      return finish;
    }
    nativeWaiters.add(waiter);
    timer = setTimeout(finish, timeoutMs);
    return finish;
  }

  // Callback una-tantum per i suggerimenti nativi di `word` quando non ci sono già: il broadcast dal main può ritardare di qualche ms. Ritorna la funzione per annullare.
  function onNativeSuggestions(word, cb, timeoutMs = 800) {
    const have = getNativeSuggestions(word);
    if (have.length) { setTimeout(() => cb(have), 0); return () => {}; }
    let done = false;
    const finish = () => { done = true; nativeWaiters.delete(waiter); clearTimeout(timer); };
    const waiter = (n) => {
      if (done || !word) return;
      if (n.word && n.word.toLowerCase() === String(word).toLowerCase()) {
        finish();
        cb((n.suggestions || []).slice());
      }
    };
    nativeWaiters.add(waiter);
    const timer = setTimeout(finish, timeoutMs);
    return finish;
  }

  global.SN_SPELLCHECK = {
    init,
    updateSettings,
    isEnabled,
    isSupportedEditable,
    findSupportedEditable,
    getSemanticIssueAt,
    getWordAt,
    getInputWordAt,
    requestWordSuggestion,
    applyFix,
    addToDictionary,
    isInDictionary,
    setAutocorrect,
    getCachedSuggestion,
    setCachedSuggestion,
    getNativeSuggestions,
    onNativeSuggestions,
    onNextNativeSuggestion,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
