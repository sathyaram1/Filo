// Correttore AI a due livelli, complementare al correttore nativo del browser.
//
// ┌────────────────────────────────────────────────────────────────────────┐
// │ ROSSO (nativo) — il browser disegna lo zigzag rosso sulle parole       │
// │ ortograficamente errate, esattamente come fa di default. Non lo        │
// │ tocchiamo. Quando l'utente fa click destro su un editabile e non c'è   │
// │ un errore "blu" sotto il cursore, il flusso del menu (vedi             │
// │ content.js) chiama requestWordSuggestion() per ottenere on-demand un   │
// │ suggerimento dall'LLM e lo mostra nel menu.                            │
// │                                                                         │
// │ BLU (nostro) — un overlay assoluto, posizionato sopra l'editabile      │
// │ focalizzato, riproduce il testo con color: transparent e disegna       │
// │ uno zigzag blu sotto i range che l'LLM ha marcato come errori          │
// │ contestuali (semantic / grammar / repetition). L'editabile reale resta │
// │ intatto: il testo "vero" è quello sotto, lo zigzag blu è un livello    │
// │ visivo soprapposto.                                                    │
// │                                                                         │
// │ OCRA (nostro, #1115) — puntini sotto ciò che non torna col contenuto:  │
// │ date e giorni (in codice, coerenza.js) e contraddizioni con la pagina  │
// │ o frasi poco chiare (modello, dopo una pausa più lunga). Mai applicato │
// │ da solo; interruttore suo (featureFlags.spellcheckContext).            │
// └────────────────────────────────────────────────────────────────────────┘
//
// Restrizioni intenzionali:
// - Solo <textarea> e [contenteditable] (no <input>: barre di ricerca, password, ecc.)
// - Watch attivato solo quando l'editabile riceve focus (no overlay su tutta la pagina)
// - Debounce 1500ms sull'input
// - Limite lunghezza testo (oltre, niente scan continuo per non bombardare l'API)

(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;
  const { ACTIONS, STORAGE_KEYS } = global.SN_CONST;

  const DEBOUNCE_MS = 1500;
  const MIN_TEXT_LENGTH = 8;
  const MAX_TEXT_LENGTH = 4000;
  // L'ocra parte più di rado del blu: a una pausa vera, e solo se il testo è cambiato.
  const OCRA_PAUSA_MS = 3500;
  const OCRA_MAX_TEXT = 10000;
  // Il testo della pagina intorno al campo: tetto largo, e oltre si tiene la parte più vicina al campo.
  const CONTESTO_MAX = 12000;
  const CONTESTO_DOPO_MAX = 3000;
  const CONTESTO_NODI_MAX = 20000;
  const CACHE_OCRA_MAX = 40;
  const Coerenza = () => global.SN_COERENZA;

  // Stato per ogni editabile attualmente "agganciato" (focus). WeakMap per non
  // tenere riferimenti che impediscano GC se il sito rimuove l'elemento.
  const monitored = new WeakMap();
  const ascoltate = new WeakSet(); // caselle con gli ascoltatori già messi
  // «Ignora» dell'ocra, per casella: sopravvive al fuoco che esce e rientra, si svuota quando la casella si svuota.
  const ignoratePerCampo = new WeakMap();
  let activeEl = null;
  let personalDict = new Set();
  let autocorrectMap = {}; // { lowercased misspelled: correction }
  let settings = null;
  // Guard contro la ricorsione: l'applyFix dell'autocorrect dispatcha un input
  // event che rientrerebbe nel listener; questa flag salta una sola passata.
  let suppressAutocorrect = false;

  // Suggerimenti del correttore NATIVO (Electron) per l'ultima parola su cui è
  // stato richiesto il menu contestuale. Il main li spinge via broadcast
  // `_spell:native` sull'evento context-menu (vedi tabs.js). Sono immediati e
  // non dipendono dall'LLM: il menu di correzione li usa come base affidabile.
  let lastNative = { word: '', suggestions: [], ts: 0 };
  const nativeWaiters = new Set();

  // ============================================================================
  // Init
  // ============================================================================
  function init(s) {
    settings = s;
    loadDictionary();
    loadAutocorrect();

    // Aggancia/sgancia in base al focus. Usiamo capture per intercettare anche
    // focus su elementi dentro custom elements / shadow root (per quanto possibile).
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);

    // Riallinea overlay attivo a scroll/resize della finestra.
    window.addEventListener('scroll', queueSync, true);
    window.addEventListener('resize', queueSync, true);
    document.addEventListener('visibilitychange', riprendiScanRimandato);

    // Riceve i suggerimenti del correttore nativo spinti dal main al click destro.
    try {
      chrome.runtime.onMessage.addListener((m) => {
        if (m?.type !== '_spell:native') return;
        lastNative = {
          word: String(m.word || ''),
          suggestions: Array.isArray(m.suggestions) ? m.suggestions : [],
          ts: Date.now(),
        };
        // Marker DOM per i test: espone l'ultima parola con suggerimenti nativi
        // ricevuta, così un test può attendere che il broadcast sia stato
        // EFFETTIVAMENTE registrato prima di simulare il click destro, invece di
        // affidarsi a un timeout fisso (causa di flakiness). Innocuo a runtime.
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
    if (!isEnabled() && !ocraAttiva()) { detachAll(); return; }
    const state = activeEl && monitored.get(activeEl);
    if (!state) return;
    // Ogni segno si spegne col suo interruttore, e l'altro resta.
    if (!isEnabled()) {
      if (state.timer) { clearTimeout(state.timer); state.timer = null; }
      state.issues = [];
    }
    if (!ocraAttiva()) {
      for (const k of ['timerOcra', 'timerDate']) if (state[k]) { clearTimeout(state[k]); state[k] = null; }
      state.ocra = [];
      state.ocraUltimo = '';
    }
    // Anche il tema può essere cambiato: i colori dei segni lo leggono dall'overlay.
    syncOverlay(state);
  }

  function isEnabled() {
    return settings?.featureFlags?.spellcheck !== false;
  }

  function ocraAttiva() {
    return settings?.featureFlags?.spellcheckContext !== false && !!Coerenza();
  }

  // ============================================================================
  // Dizionario personale
  // ============================================================================
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
      // Legge l'array esistente dallo storage (che preserva il casing originale) e aggiunge
      // la nuova parola mantenendo il casing, con dedup case-insensitive.
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

  // ============================================================================
  // Autocorrect
  // ============================================================================
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

  // Applica al testo della correzione la stessa "case" della parola digitata:
  // - "PAROLA" -> tutta maiuscola
  // - "Parola" -> prima lettera maiuscola
  // - altrimenti invariata
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

    // Cerca la chiave (anche multi-parola, es. "x es") che termina a `end`.
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

  // Trova la chiave di autocorrect che termina ESATTAMENTE all'offset `end` nel
  // testo, delimitata a sinistra da un confine di parola. Le chiavi possono
  // contenere spazi ("x es" → "per esempio"): non basta più risalire al singolo
  // token prima del confine. A parità di posizione finale vince la chiave più
  // lunga, così "x es" batte "es" se entrambe esistono. Ritorna { start, key }
  // (con `key` la chiave lowercased nella mappa) oppure null.
  function findAutocorrectMatch(text, end) {
    const lowerRegion = text.slice(0, end).toLowerCase();
    let best = null;
    for (const key of Object.keys(autocorrectMap)) {
      if (!key) continue;
      const start = end - key.length;
      if (start < 0) continue;
      // Il testo che precede il confine deve coincidere con la chiave.
      if (lowerRegion.slice(start) !== key) continue;
      // Confine di parola a sinistra: il carattere prima del match non dev'essere
      // un carattere di parola, così "es" non scatta dentro "mese".
      if (start > 0 && isWordCharLocal(text[start - 1])) continue;
      // La chiave deve iniziare con un carattere di parola (le chiavi sono
      // trim()+lowercase, quindi lo sono sempre): esclude match che partono da
      // uno spazio interno spurio.
      if (!isWordCharLocal(text[start])) continue;
      if (!best || key.length > best.key.length) best = { start, key };
    }
    return best;
  }

  // Posiziona il caret all'offset di carattere `target` nell'elemento contenteditable,
  // popolando il Range passato (non lo aggiunge al selection: lascia farlo al chiamante).
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
    // Fallback: a fine elemento
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

  // ============================================================================
  // Detection editabili
  // ============================================================================
  // Editabili supportati: textarea e contenteditable. Niente <input>.
  // Per il contenteditable consideriamo SOLO il "root" — l'elemento che porta
  // l'attributo contenteditable. I discendenti ereditano isContentEditable,
  // ma agganciare l'overlay a un figlio invece che al root (es. uno <span>
  // dentro un editor di Slack/Twitter) sballa allineamento e dimensioni.
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

  // Da un riquadro chiuso di Filo (feedback, spiegazione) il focus arriva all'host: il campo vero lo sa SN_FILO_UI,
  // e l'overlay sta dentro lo stesso riquadro, perché ripete il testo e nel documento del sito lo leggerebbe (#1071).
  function editabileDellEvento(e) {
    const UI = global.SN_FILO_UI;
    const t = e && e.target;
    const riquadro = !!(UI && UI.bersaglio && t && t.hasAttribute && t.hasAttribute(UI.RIQUADRO));
    return findSupportedEditable(riquadro ? UI.bersaglio(e) : t);
  }
  function radiceDi(el) {
    try {
      const r = el.getRootNode();
      const UI = global.SN_FILO_UI;
      if (r && r !== document && r.host && UI && r.host.hasAttribute(UI.RIQUADRO)) return r;
    } catch (_) {}
    return null;
  }

  // ============================================================================
  // Focus lifecycle
  // ============================================================================
  function onFocusIn(e) {
    if (!isEnabled() && !ocraAttiva()) return;
    const el = editabileDellEvento(e);
    if (!el) return;
    attach(el);
  }

  function onFocusOut(e) {
    const el = editabileDellEvento(e);
    if (!el) return;
    // Mantieni l'overlay finché l'utente sta interagendo col popup correzione,
    // altrimenti il click destro su un range blu lo nasconde subito.
    setTimeout(() => {
      if ((radiceDi(el) || document).activeElement === el) return;
      detach(el);
    }, 200);
  }

  function suInput(state) {
    // 1) autocorrect istantaneo
    if (isEnabled()) tryAutocorrect(state);
    // 2) gli issue blu e ocra seguono il testo fino al prossimo scan
    seguiIlTesto(state);
    if (ocraAttiva()) {
      programmaDate(state);
      if (prendeGesto(state, null, 'coerenza') || state.timerOcra) scheduleOcra(state);
    }
    if (!isEnabled()) return;
    // Il testo l'ha cambiato uno script, non l'utente (#1070): niente chiamate al modello. Lo scan già chiesto
    // da un gesto (un tasto tenuto premuto) si sposta soltanto: resta una chiamata, sul testo finale.
    if (!prendeGesto(state)) {
      if (state.timer) scheduleScan(state);
      return;
    }
    // 3) prefetch parola completata: se l'utente ha appena chiuso una parola
    //    (boundary char), lancia subito il check ortografico così che al
    //    click destro non ci sia attesa. Limitato e in background.
    //    Solo il tasto con cui l'utente chiude una parola lo paga: una pagina che a ogni lettera aggiunge una parola
    //    ne otterrebbe uno per tasto (#1070).
    const G = global.SN_GESTO;
    if (G.prendi('parola', G.CHIUDE, G.dentro(state.el))) prefetchJustCompletedWord(state);
    // 4) il prossimo scan
    scheduleScan(state);
  }

  function attach(el) {
    let state = monitored.get(el);
    if (!state) {
      state = {
        el,
        overlay: null,
        issues: [],
        // Il testo a cui si riferiscono gli offset di `issues`.
        testoIssues: '',
        lastScannedText: '',
        timer: null,
        ro: null,
        // Cache delle correzioni per-parola (popolata sia dal prefetch dopo lo scan
        // blu sia dalle richieste on-demand al click destro). Le chiavi sono lowercased.
        wordCache: new Map(),
        // I segni ocra, sugli stessi offset (`testoIssues`) dei blu.
        ocra: [],
        ocraUltimo: '',
        timerOcra: null,
        timerDate: null,
        ocraIgnorate: ignoratePerCampo.get(el) || new Map(),
      };
      ignoratePerCampo.set(el, state.ocraIgnorate);
      monitored.set(el, state);
      // Un ascoltatore per casella, che guarda lo stato vivo: chi esce e rientra non lascia indietro uno stato morto
      // che si prende il gesto, e una casella lasciata non lavora più (#1070).
      if (!ascoltate.has(el)) {
        ascoltate.add(el);
        el.addEventListener('input', () => { const vivo = monitored.get(el); if (vivo) suInput(vivo); });
        el.addEventListener('scroll', () => { const vivo = monitored.get(el); if (vivo) syncOverlay(vivo); });
      }
      // Resize observer per cambi di dimensione (autoresize textarea, ecc.)
      try {
        state.ro = new ResizeObserver(() => syncOverlay(state));
        state.ro.observe(el);
      } catch (_) {}
    }
    activeEl = el;
    ensureOverlay(state);
    syncOverlay(state);
    // Il fuoco lo dà anche un focus() di script: il testo che c'è già si controlla solo se ci è entrato l'utente, col
    // mouse sulla casella o con Tab (che cade sul campo di prima: la casella la riceve solo al rilascio).
    if (isEnabled() && prendeGesto(state, (l) => l.tasto === 'Tab')) scheduleScan(state);
    if (ocraAttiva()) {
      programmaDate(state);
      if (prendeGesto(state, (l) => l.tasto === 'Tab', 'coerenza')) scheduleOcra(state);
    }
  }

  function detach(el) {
    const state = monitored.get(el);
    if (!state) return;
    for (const k of ['timer', 'timerOcra', 'timerDate']) if (state[k]) { clearTimeout(state[k]); state[k] = null; }
    if (state.overlay) { state.overlay.remove(); state.overlay = null; }
    if (state.ro) { try { state.ro.disconnect(); } catch (_) {} state.ro = null; }
    if (activeEl === el) activeEl = null;
    monitored.delete(el);
  }

  function detachAll() {
    if (activeEl) detach(activeEl);
  }

  // ============================================================================
  // Overlay rendering
  // ============================================================================
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
    if (state.overlay && state.overlay.isConnected) return;
    const o = document.createElement('div');
    o.className = 'sn-spell-overlay';
    global.SN_FILO_UI?.mark(o);
    o.setAttribute('aria-hidden', 'true');
    casaDelloSpecchio(state.el).appendChild(o);
    state.overlay = o;
  }
  // Un campo dentro un pezzo di Filo nel documento (l'Aiuto) ha lo specchio dentro quel pezzo: sopra, la guardia dei
  // clic lo prendeva per un velo del sito sul microfono, e con l'Aiuto spostato restava indietro (#1340, giro 4).
  function casaDelloSpecchio(el) {
    const r = radiceDi(el);
    if (r) return r;
    const UI = global.SN_FILO_UI;
    let pezzo = null;
    try { pezzo = UI && el.parentElement ? el.parentElement.closest(UI.SELECTOR) : null; } catch (_) {}
    return pezzo || document.body;
  }

  const SPORGENZA_SEGNI = 8;

  function syncOverlay(state) {
    const o = state.overlay;
    const el = state.el;
    if (!o || !el || !el.isConnected) return;

    const cs = window.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    state.riquadro = { left: r.left, top: r.top, width: r.width, height: r.height };

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
    // Lo specchio deve andare a capo come la casella: larghezza e altezza qui sopra sono del bordo esterno, e la barra
    // di scorrimento della casella toglie spazio al testo che lo specchio (senza barra) avrebbe in più.
    o.style.boxSizing = 'border-box';
    const px = (p) => parseFloat(cs.getPropertyValue(p)) || 0;
    const barraV = Math.max(0, el.offsetWidth - el.clientWidth - px('border-left-width') - px('border-right-width'));
    const barraO = Math.max(0, el.offsetHeight - el.clientHeight - px('border-top-width') - px('border-bottom-width'));
    const latoBarra = cs.direction === 'rtl' ? 'padding-left' : 'padding-right';
    if (barraV) o.style.setProperty(latoBarra, `${px(latoBarra) + barraV}px`);
    // Sotto l'ultima riga di una casella piena c'è solo il suo margine interno: i segni stanno qualche pixel più giù del
    // testo, e lo specchio li lascia sporgere sotto il bordo invece di tagliarli (stesso scorrimento: altezza e margine
    // crescono insieme).
    o.style.height = (r.height + SPORGENZA_SEGNI) + 'px';
    o.style.setProperty('padding-bottom', `${px('padding-bottom') + barraO + SPORGENZA_SEGNI}px`);

    renderOverlayContent(state);
  }

  // Svuotare e riempire lo specchio lo riporta in cima: ogni disegno riprende lo scorrimento della casella. Sul campo
  // modificabile i segni sono già dove si vedono le parole: lo specchio non scorre.
  function allineaScorrimento(state) {
    const o = state.overlay;
    if (!o || !state.el) return;
    const scorre = campoDiTesto(state.el);
    o.scrollTop = scorre ? state.el.scrollTop : 0;
    o.scrollLeft = scorre ? state.el.scrollLeft : 0;
  }

  const campoDiTesto = (el) => el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';

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

  // Il testo che va ai controlli (modelli e date): in un campo modificabile le righe sono paragrafi, <div> e <br>, che
  // textContent attacca («Ciao Marcosì»). Qui hanno il loro a capo; `riporta` rimette i segni sulle posizioni di
  // getEditableText, su cui si disegna e si corregge.
  function testoDaControllare(el) {
    if (campoDiTesto(el)) return { testo: getEditableText(el), riporta: (lista) => lista };
    let testo = '';
    let pos = 0;
    let serveACapo = false;
    const bordi = [0];
    const aCapo = () => { testo += '\n'; bordi.push(pos); serveACapo = false; };
    const visita = (n) => {
      if (n.nodeType === 3) {
        const v = n.nodeValue;
        if (!v) return;
        if (serveACapo && testo && !testo.endsWith('\n')) aCapo();
        serveACapo = false;
        for (let i = 0; i < v.length; i++) { pos++; bordi.push(pos); }
        testo += v;
        return;
      }
      if (n.nodeType !== 1) return;
      if (n.tagName === 'BR') {
        if (serveACapo && testo && !testo.endsWith('\n')) aCapo();
        aCapo();
        return;
      }
      const blocco = !/^inline/.test(window.getComputedStyle(n).display);
      if (blocco) serveACapo = true;
      for (const c of n.childNodes) visita(c);
      if (blocco) serveACapo = true;
    };
    for (const c of el.childNodes) visita(c);
    const campo = getEditableText(el);
    const riporta = (lista) => lista.map((it) => {
      const start = bordi[it.start];
      const end = bordi[it.end];
      return 'segment' in it ? { ...it, start, end, segment: campo.slice(start, end) } : { ...it, start, end };
    }).filter((it) => it.end > it.start);
    return { testo, riporta };
  }

  function renderOverlayContent(state) {
    disegnaSpecchio(state);
    allineaScorrimento(state);
    seguiIlCampo();
  }

  // La pagina può spostare il campo senza scorrere né ridimensionare (un avviso che compare sopra, un riquadro che si
  // apre): finché il campo attivo ha segni, a ogni fotogramma il suo riquadro si confronta con quello dell'ultimo disegno.
  let seguendo = false;
  function seguiIlCampo() {
    if (seguendo) return;
    seguendo = true;
    const giro = () => {
      const state = activeEl && monitored.get(activeEl);
      if (!state || !state.overlay || !state.el.isConnected || !(state.issues?.length || state.ocra?.length)) {
        seguendo = false;
        return;
      }
      const r = state.el.getBoundingClientRect();
      const u = state.riquadro;
      if (!u || r.left !== u.left || r.top !== u.top || r.width !== u.width || r.height !== u.height) syncOverlay(state);
      requestAnimationFrame(giro);
    };
    requestAnimationFrame(giro);
  }

  function disegnaSpecchio(state) {
    const o = state.overlay;
    if (!o) return;
    const text = getEditableText(state.el);
    if (!text) { o.textContent = ''; return; }

    const valido = (i) => i.start >= 0 && i.end <= text.length && i.end > i.start;
    const segni = [
      ...(state.issues || []).filter(valido).map((i) => ({ start: i.start, end: i.end, classe: 'sn-semantic-error' })),
      ...(state.ocra || []).filter(valido).map((i) => ({ start: i.start, end: i.end, classe: 'sn-coerenza' })),
    ];
    if (!campoDiTesto(state.el)) { disegnaSulCampo(state, segni); return; }

    // Un a capo in fondo è una riga nella casella ma non nello specchio: senza, lo specchio è più basso e lo scorrimento
    // si ferma una riga prima.
    const coda = /\n$/.test(text) && (state.el.tagName === 'TEXTAREA') ? '​' : '';
    if (!segni.length) { o.textContent = text + coda; return; }

    // Blu e ocra possono coprire la stessa parola: il testo si taglia a ogni bordo e ogni pezzo porta le classi dei
    // segni che lo coprono (lo zigzag è uno sfondo, i puntini una sottolineatura: convivono).
    const bordi = [...new Set([0, text.length, ...segni.flatMap((s) => [s.start, s.end])])].sort((a, b) => a - b);
    let pos = 0;
    const scrivi = (pezzo, dove) => {
      const fine = pos + pezzo.length;
      let a = pos;
      for (const b of [...bordi.filter((x) => x > pos && x < fine), fine]) {
        if (b <= a) continue;
        const classi = [...new Set(segni.filter((s) => s.start <= a && s.end >= b).map((s) => s.classe))];
        const t = pezzo.slice(a - pos, b - pos);
        if (!classi.length) dove.appendChild(document.createTextNode(t));
        else {
          const span = document.createElement('span');
          span.className = classi.join(' ');
          span.textContent = t;
          dove.appendChild(span);
        }
        a = b;
      }
      pos = fine;
    };
    const frag = document.createDocumentFragment();
    scrivi(text, frag);
    if (coda) frag.appendChild(document.createTextNode(coda));
    o.innerHTML = '';
    o.appendChild(frag);
  }

  // Un campo modificabile si impagina con lo stile della pagina (margini e interlinea dei paragrafi, righe nuove,
  // scorrimento): una copia lo rincorre una proprietà alla volta. I segni si misurano sulle parole vere del campo, un
  // riquadro per riga, col font del loro testo; si ridisegnano a ogni scorrimento e ridimensionamento (syncOverlay).
  const FONT_DEL_TESTO = ['font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variant',
    'font-feature-settings', 'font-variation-settings', 'font-kerning', 'letter-spacing', 'word-spacing', 'text-transform',
    'direction'];

  function disegnaSulCampo(state, segni) {
    const o = state.overlay;
    o.innerHTML = '';
    if (!segni.length) return;
    const nodi = [];
    const w = document.createTreeWalker(state.el, NodeFilter.SHOW_TEXT);
    let tot = 0;
    for (let n = w.nextNode(); n; n = w.nextNode()) { nodi.push({ n, da: tot }); tot += n.nodeValue.length; }
    const base = o.getBoundingClientRect();
    const ox = base.left + o.clientLeft;
    const oy = base.top + o.clientTop;
    const range = document.createRange();
    const frag = document.createDocumentFragment();
    const bordi = [...new Set(segni.flatMap((s) => [s.start, s.end]))].sort((a, b) => a - b);
    for (let k = 0; k + 1 < bordi.length; k++) {
      const a = bordi[k];
      const b = bordi[k + 1];
      const classi = [...new Set(segni.filter((s) => s.start <= a && s.end >= b).map((s) => s.classe))];
      if (!classi.length) continue;
      for (const { n, da } of nodi) {
        const fine = da + n.nodeValue.length;
        if (fine <= a || da >= b) continue;
        for (const riga of righeDelPezzo(range, n, Math.max(a, da) - da, Math.min(b, fine) - da)) {
          frag.appendChild(riquadroDelSegno(n, riga, classi, ox, oy));
        }
      }
    }
    o.appendChild(frag);
  }

  // Le righe su cui il pezzo [s, e) del nodo di testo va a capo, carattere per carattere: { s, e, left, top, height }.
  function righeDelPezzo(range, n, s, e) {
    const v = n.nodeValue;
    const righe = [];
    let cur = null;
    for (let i = s; i < e;) {
      const j = Math.min(e, i + (/[\uD800-\uDBFF]/.test(v[i]) ? 2 : 1));
      range.setStart(n, i);
      range.setEnd(n, j);
      const q = range.getBoundingClientRect();
      if (q.width || q.height) {
        if (!cur || Math.abs(q.top - cur.top) > q.height / 2) {
          cur = { s: i, e: j, left: q.left, top: q.top, height: q.height };
          righe.push(cur);
        } else {
          cur.e = j;
          cur.left = Math.min(cur.left, q.left);
        }
      }
      i = j;
    }
    return righe;
  }

  function riquadroDelSegno(n, riga, classi, ox, oy) {
    const cs = window.getComputedStyle(n.parentElement);
    const box = document.createElement('div');
    // L'interlinea alta quanto il testo: il pezzo sta dove sta la parola, senza mezza interlinea sopra.
    box.style.cssText = `position:absolute;left:${riga.left - ox}px;top:${riga.top - oy}px;margin:0;padding:0;border:0;`
      + `white-space:pre;text-indent:0;text-align:left;line-height:${riga.height}px;`;
    const span = document.createElement('span');
    // Anche sul pezzo: una regola della pagina sugli span non deve cambiargli il font.
    for (const p of FONT_DEL_TESTO) for (const e of [box, span]) e.style.setProperty(p, cs.getPropertyValue(p));
    span.className = classi.join(' ');
    span.textContent = n.nodeValue.slice(riga.s, riga.e).replace(/\s+$/, '');
    box.appendChild(span);
    return box;
  }

  // Chi corregge una parola perde il segno di quella: gli altri restano dov'erano finché lo scan dopo non li rinnova
  // (#1111), sugli offset giusti per «Risolvi».
  function seguiIlTesto(state) {
    const ora = getEditableText(state.el);
    if (ora === state.testoIssues) return;
    const prima = state.testoIssues;
    state.testoIssues = ora;
    // La casella svuotata (il messaggio è partito) chiude il testo a cui valevano gli «Ignora».
    if (!ora.trim()) state.ocraIgnorate.clear();
    if (!state.issues.length && !state.ocra.length) return;
    const blu = riallineaIssues(state.issues, prima, ora);
    const ocra = riallineaIssues(state.ocra, prima, ora);
    state.issues = blu.issues;
    state.ocra = ocra.issues;
    // Un segno perso torna solo da uno scan, anche se il testo ritorna quello già controllato.
    if (blu.perse) state.lastScannedText = '';
    if (ocra.perse) state.ocraUltimo = '';
    renderOverlayContent(state);
  }

  // I segni di una risposta dello scan su `inviato`, portati sul testo di `adesso`. `mandato` è il testo andato al
  // modello quando ha i suoi a capo (testoDaControllare): i segni tornano prima sugli offset di `inviato`.
  function segniDellaRisposta(risposta, inviato, adesso, mandato = { testo: inviato, riporta: (l) => l }) {
    return riallineaIssues(mandato.riporta(buildIssues(parseIssues(risposta), mandato.testo)), inviato, adesso);
  }

  // Le stesse parole a meno di spazi e punteggiatura: lo scan rifarebbe la stessa domanda (#1097.5). Due parole fuse
  // o separate invece cambiano le parole, e così apostrofo e trattino («un amico» / «un'amico», «e-mail»).
  const ossatura = (t) => String(t ?? '').replace(/\u2019/g, "'").replace(/\u2010/g, '-')
    .replace(/(?:(?!['-])[\s\p{P}])+/gu, ' ').trim();
  function soloSpaziOPunteggiatura(prima, dopo) {
    return typeof prima === 'string' && !!prima && prima !== dopo && ossatura(prima) === ossatura(dopo);
  }

  // Prima del cambio resta, dopo scorre; chi tocca il cambio, o la cui parola il cambio allunga o fonde con un'altra
  // (un bordo che passa da separatore a lettera), si perde.
  function riallineaIssues(issues, vecchio, nuovo) {
    const lista = Array.isArray(issues) ? issues : [];
    vecchio = String(vecchio ?? '');
    nuovo = String(nuovo ?? '');
    if (!lista.length || vecchio === nuovo) return { issues: lista, perse: false };
    const corto = Math.min(vecchio.length, nuovo.length);
    let p = 0;
    while (p < corto && vecchio[p] === nuovo[p]) p++;
    let s = 0;
    while (s < corto - p && vecchio[vecchio.length - 1 - s] === nuovo[nuovo.length - 1 - s]) s++;
    const fineCambio = vecchio.length - s;
    const delta = nuovo.length - vecchio.length;
    const out = [];
    for (const it of lista) {
      let da;
      if (it.end <= p) da = it.start;
      else if (it.start >= fineCambio) da = it.start + delta;
      else continue;
      const a = da + (it.end - it.start);
      if (isWordCharLocal(vecchio[it.start - 1]) !== isWordCharLocal(nuovo[da - 1])) continue;
      if (isWordCharLocal(vecchio[it.end]) !== isWordCharLocal(nuovo[a])) continue;
      out.push(da === it.start ? it : { ...it, start: da, end: a });
    }
    return { issues: out, perse: out.length !== lista.length };
  }

  // ============================================================================
  // Scan LLM (zigzag blu)
  // ============================================================================
  // Solo un gesto vero caduto dentro la casella apre una chiamata al modello, e una volta sola: `input` e `focus` li
  // fabbrica anche la pagina, e scrivere nella sua ricerca non deve pagare il controllo di un'altra casella (#1070).
  // Blu e ocra prendono il gesto ognuno per sé (`chi`): lo stesso tasto paga uno scan di ciascuno, non due dello stesso.
  function prendeGesto(state, oppure, chi = 'correttore') {
    const G = global.SN_GESTO;
    if (!G) return false;
    const qui = G.dentro(state.el);
    return G.prendi(chi, undefined, oppure ? (l) => qui(l) || oppure(l) : qui);
  }

  // Gli esiti già pagati, per testo e contesto (#1097.5): fuori dalla cache del main, un campo lasciato e ripreso, o un
  // annulla che torna a un testo controllato, non ripagano la stessa domanda. Pochi e per pagina.
  const ESITI_MAX = 30;
  const esitiRecenti = new Map();
  const chiaveEsito = (text, context) => `${JSON.stringify(context ?? null)}\u0000${text}`;
  function ricordaEsito(chiave, risposta) {
    esitiRecenti.delete(chiave);
    esitiRecenti.set(chiave, risposta);
    while (esitiRecenti.size > ESITI_MAX) esitiRecenti.delete(esitiRecenti.keys().next().value);
  }
  // Le domande ancora in viaggio, per la stessa chiave: rientrare nel campo mentre il controllo corre non lo ripaga.
  const inViaggio = new Map();
  function chiediScan(chiave, text, context) {
    let p = inViaggio.get(chiave);
    if (!p) {
      p = Promise.resolve(chrome.runtime.sendMessage({
        type: MSG.AI_REQUEST,
        action: ACTIONS.SPELLCHECK_SEMANTIC,
        payload: { text, context },
      }));
      inViaggio.set(chiave, p);
      const via = () => { if (inViaggio.get(chiave) === p) inViaggio.delete(chiave); };
      p.then(via, via);
    }
    return p;
  }

  function scheduleScan(state) {
    if (!isEnabled()) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => { state.timer = null; scanText(state); }, DEBOUNCE_MS);
  }

  // Lo scan chiesto dall'utente e arrivato a scheda nascosta parte quando la scheda torna davanti.
  function riprendiScanRimandato() {
    if (document.hidden || !activeEl) return;
    const state = monitored.get(activeEl);
    if (!state) return;
    if (state.rimandato) { state.rimandato = false; scheduleScan(state); }
    if (state.ocraRimandato) { state.ocraRimandato = false; scheduleOcra(state); }
  }

  async function scanText(state) {
    if (!state || !state.el || !state.el.isConnected) return;
    if (document.hidden) { state.rimandato = true; return; }
    state.rimandato = false;
    const text = getEditableText(state.el);

    // Reset se il testo è troppo corto o invariato
    if (!text || text.length < MIN_TEXT_LENGTH) {
      seguiIlTesto(state);
      state.issues = [];
      state.testoIssues = text;
      // Mai controllato: un segno che lo porta alla lunghezza minima deve far partire lo scan, non saltarlo.
      state.lastScannedText = '';
      // Una risposta ancora in viaggio parlava del testo di prima: non riporta i segni.
      state.scanMostrato = state.scanInviati || 0;
      renderOverlayContent(state);
      return;
    }
    if (text === state.lastScannedText) return;
    if (soloSpaziOPunteggiatura(state.lastScannedText, text)) return;
    // Lo stesso testo, o solo un segno in più, è già in viaggio: la sua risposta arriva su quello di adesso.
    if (state.testoInViaggio && (text === state.testoInViaggio || soloSpaziOPunteggiatura(state.testoInViaggio, text))) return;
    if (text.length > MAX_TEXT_LENGTH) {
      // Niente scan continuo su testi enormi: lasciamo invariati gli issue precedenti.
      return;
    }

    const context = extractContext(state.el);
    const numero = (state.scanInviati || 0) + 1;
    state.scanInviati = numero;
    const daControllare = testoDaControllare(state.el);
    const chiave = chiaveEsito(daControllare.testo, context);
    let res;
    if (esitiRecenti.has(chiave)) res = { ok: true, text: esitiRecenti.get(chiave) };
    else {
      state.testoInViaggio = text;
      try {
        res = await chiediScan(chiave, daControllare.testo, context);
      } catch (err) {
        console.error('[SN] scan blu — sendMessage fallito:', err);
        return;
      } finally {
        if (state.testoInViaggio === text) state.testoInViaggio = '';
      }
    }

    if (!res?.ok) {
      console.error('[SN] scan blu — provider error:', res?.code, res?.error);
      return;
    }
    if (typeof res.text !== 'string') {
      console.warn('[SN] scan blu — risposta senza text:', res);
      return;
    }
    // Ricordata prima di guardare la casella: arrivata a campo lasciato, serve a chi ci rientra.
    ricordaEsito(chiave, res.text);
    // Una risposta più vecchia di quella già in vista non la sovrascrive.
    if (numero < (state.scanMostrato || 0)) return;
    const currentText = getEditableText(state.el);
    if (!currentText || currentText.length < MIN_TEXT_LENGTH) return;
    // Il testo è tornato a uno già controllato (un annulla): i suoi segni sono quelli giusti, non quelli dell'abbandonato.
    if (currentText !== text && currentText === state.lastScannedText) return;
    state.scanMostrato = numero;
    // Arrivata mentre l'utente scriveva, la risposta pagata non si butta (#1097.5): i segni passano sul testo di adesso
    // come quelli già in vista; quelli che il cambio tocca li rifà lo scan che segue.
    const { issues, perse } = segniDellaRisposta(res.text, text, currentText, daControllare);
    seguiIlTesto(state);
    state.issues = issues;
    state.testoIssues = currentText;
    state.lastScannedText = perse ? '' : text;
    renderOverlayContent(state);
    // Prefetch delle correzioni a singola parola: per ogni issue blu su 1 parola
    // chiediamo subito allo stesso modello la verifica ortografica e mettiamo in
    // cache, così il click destro non deve attendere la chiamata.
    // NB: NON filtriamo più gli issue blu in base al risultato — la verifica
    // per-parola è una stima inaffidabile di "il browser ha messo il rosso?"
    // (l'LLM e lo spellcheck nativo dissentono spesso, soprattutto su parole
    // italiane reali ma usate male). Il blu resta stabile; per evitare la
    // sovrapposizione con il rosso nativo lo zigzag blu è leggermente offsettato
    // verticalmente in CSS.
    prefetchSingleWordSuggestions(state, currentText).catch((e) => {
      console.warn('[SN] prefetch single-word failed:', e);
    });
  }

  // ============================================================================
  // Ocra: coerenza col contesto (#1115)
  // ============================================================================
  // Le date si controllano in codice, quindi senza gesto né modello: a ogni pausa breve, come il blu.
  function programmaDate(state) {
    if (state.timerDate) clearTimeout(state.timerDate);
    state.timerDate = setTimeout(() => { state.timerDate = null; aggiornaDate(state); }, DEBOUNCE_MS);
  }

  function aggiornaDate(state) {
    if (!ocraAttiva() || !state.el || !state.el.isConnected) return;
    seguiIlTesto(state);
    const { testo, riporta } = testoDaControllare(state.el);
    fissaOcra(state, riporta(Coerenza().dateDi(testo, new Date())), state.ocra.filter((i) => i.fonte === 'modello'));
  }

  function fissaOcra(state, date, modello) {
    const testo = getEditableText(state.el);
    if (!testo.trim()) state.ocraIgnorate.clear();
    const ignorate = [...state.ocraIgnorate.values()];
    state.ocra = Coerenza().unisci(date, modello).filter((i) => !Coerenza().ignorato(i, ignorate, testo));
    renderOverlayContent(state);
  }

  function scheduleOcra(state) {
    if (!ocraAttiva()) return;
    if (state.timerOcra) clearTimeout(state.timerOcra);
    state.timerOcra = setTimeout(() => { state.timerOcra = null; scanOcra(state); }, OCRA_PAUSA_MS);
  }

  // La cache sta nella scheda: chiave testo + impronta del contesto + giorno (le date relative cambiano a mezzanotte).
  const cacheOcra = new Map();
  function ricordaOcra(chiave, segni) {
    cacheOcra.delete(chiave);
    cacheOcra.set(chiave, segni);
    while (cacheOcra.size > CACHE_OCRA_MAX) cacheOcra.delete(cacheOcra.keys().next().value);
  }

  async function scanOcra(state) {
    if (!ocraAttiva() || !state || !state.el || !state.el.isConnected) return;
    if (document.hidden) { state.ocraRimandato = true; return; }
    state.ocraRimandato = false;
    const campo = getEditableText(state.el);
    const { testo, riporta } = testoDaControllare(state.el);
    if (testo.trim().length < MIN_TEXT_LENGTH || testo === state.ocraUltimo || testo.length > OCRA_MAX_TEXT) return;
    const C = Coerenza();
    const contesto = contestoDelCampo(state.el);
    const chiave = [C.impronta(testo), C.impronta(C.contestoComeTesto(contesto)), new Date().toDateString()].join('|');
    let modello = cacheOcra.get(chiave);
    if (!modello) {
      let res;
      try {
        res = await chrome.runtime.sendMessage({
          type: MSG.AI_REQUEST,
          action: ACTIONS.SPELLCHECK_CONTEXT,
          payload: { text: testo, contesto },
        });
      } catch (err) {
        console.error('[SN] coerenza — sendMessage fallito:', err);
        return;
      }
      // Un testo cambiato nel frattempo avrà il suo controllo: questa risposta sarebbe disallineata.
      if (getEditableText(state.el) !== campo || !ocraAttiva()) return;
      if (!res?.ok || typeof res.text !== 'string') {
        console.warn('[SN] coerenza — provider:', res?.code, res?.error);
        state.ocraUltimo = testo;
        return;
      }
      modello = C.leggiRisposta(res.text, testo, res.senzaContesto ? {} : contesto);
      ricordaOcra(chiave, modello);
    }
    seguiIlTesto(state);
    state.ocraUltimo = testo;
    fissaOcra(state, riporta(C.dateDi(testo, new Date())), riporta(modello));
  }

  // Il testo della pagina intorno al campo, dal più vicino: in una chat la conversazione (gli ultimi messaggi stanno
  // subito sopra la casella), altrove il contenuto principale. Niente di nascosto, niente UI di Filo, niente altri campi.
  const RADICI_CONTESTO = 'main, [role="main"], #main, article, [role="dialog"], dialog';
  const TAG_SALTATI = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
    'DATALIST', 'BUTTON', 'SVG', 'svg', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'VIDEO', 'AUDIO', 'NAV', 'ASIDE', 'HEAD']);
  const RUOLI_SALTATI = new Set(['navigation', 'complementary', 'menu', 'menubar', 'listbox', 'tooltip', 'button', 'search']);
  const TAG_IN_RIGA = new Set(['A', 'ABBR', 'B', 'BDI', 'BDO', 'CITE', 'CODE', 'DATA', 'DFN', 'EM', 'FONT', 'I', 'KBD',
    'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR', 'LABEL']);

  function radiceContesto(el) {
    let r = el.parentElement && el.parentElement.closest(RADICI_CONTESTO);
    // Un riquadro piccolo (la scheda di un post) non basta: si sale al contenitore successivo.
    while (r) {
      const su = r.parentElement && r.parentElement.closest(RADICI_CONTESTO);
      const proprio = el.isContentEditable ? (el.textContent || '').length : 0;
      if (!su || (r.textContent || '').length - proprio >= 600) break;
      r = su;
    }
    if (r) return r;
    const root = el.getRootNode();
    if (root && root.nodeType === 11) return root;
    return el.ownerDocument.body || el.ownerDocument.documentElement;
  }

  function contestoDelCampo(el) {
    const vuoto = { prima: '', dopo: '', troncato: false };
    // Nei riquadri di Filo intorno c'è Filo, non la pagina.
    if (!el || radiceDi(el)) return vuoto;
    try {
      const radice = radiceContesto(el);
      const UI = global.SN_FILO_UI;
      const doc = el.ownerDocument;
      const filtro = {
        acceptNode(n) {
          if (n === el || el.contains(n)) return NodeFilter.FILTER_REJECT;
          if (n.nodeType === 3) return /\S/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
          if (n.contains(el)) return NodeFilter.FILTER_SKIP;
          if (TAG_SALTATI.has(n.tagName) || (UI && UI.is(n))) return NodeFilter.FILTER_REJECT;
          const ruolo = n.getAttribute('role');
          if (ruolo && RUOLI_SALTATI.has(ruolo)) return NodeFilter.FILTER_REJECT;
          if (n.getAttribute('aria-hidden') === 'true') return NodeFilter.FILTER_REJECT;
          const ce = n.getAttribute('contenteditable');
          if (ce === '' || ce === 'true' || ce === 'plaintext-only') return NodeFilter.FILTER_REJECT;
          if (typeof n.checkVisibility === 'function' && !n.checkVisibility({ visibilityProperty: true })) return NodeFilter.FILTER_REJECT;
          return n.tagName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        },
      };
      const blocco = (n) => {
        let e = n.nodeType === 3 ? n.parentElement : n;
        while (e && e !== radice && TAG_IN_RIGA.has(e.tagName)) e = e.parentElement;
        return e;
      };
      const raccogli = (avanti, tetto) => {
        const w = doc.createTreeWalker(radice, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, filtro);
        w.currentNode = el;
        const pezzi = [];
        let lunghezza = 0;
        let visti = 0;
        let n;
        while ((n = avanti ? w.nextNode() : w.previousNode())) {
          if (++visti > CONTESTO_NODI_MAX) return { pezzi, pieno: true };
          const t = n.nodeType === 3 ? n.nodeValue.replace(/\s+/g, ' ') : '\n';
          pezzi.push({ t, b: n.nodeType === 3 ? blocco(n) : n });
          lunghezza += t.length;
          if (lunghezza > tetto) return { pezzi, pieno: true };
        }
        return { pezzi, pieno: false };
      };
      const cuci = (pezzi) => {
        let s = '';
        let prima = null;
        for (const p of pezzi) {
          if (prima && p.b !== prima) s += '\n';
          s += p.t;
          prima = p.b;
        }
        return s.replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{2,}/g, '\n').trim();
      };
      const dopo = raccogli(true, CONTESTO_DOPO_MAX);
      let testoDopo = cuci(dopo.pezzi);
      if (testoDopo.length > CONTESTO_DOPO_MAX) testoDopo = testoDopo.slice(0, CONTESTO_DOPO_MAX);
      const tettoPrima = CONTESTO_MAX - testoDopo.length;
      const prima = raccogli(false, tettoPrima);
      let testoPrima = cuci(prima.pezzi.reverse());
      if (testoPrima.length > tettoPrima) testoPrima = testoPrima.slice(-tettoPrima);
      return { prima: testoPrima, dopo: testoDopo, troncato: prima.pieno || dopo.pieno };
    } catch (e) {
      console.warn('[SN] coerenza — contesto non letto:', e);
      return vuoto;
    }
  }

  function getContextIssueAt(el, clientX, clientY) {
    const state = monitored.get(el);
    if (!state || !state.ocra?.length) return null;
    const pos = caretCharOffsetFromPoint(el, clientX, clientY);
    if (pos < 0) return null;
    return state.ocra.find((it) => pos >= it.start && pos < it.end) || null;
  }

  // «Ignora»: quel segno, su quel testo, non torna.
  function ignoraCoerenza(el, issue) {
    const state = monitored.get(el);
    if (!state || !issue) return;
    state.ocraIgnorate.set(Coerenza().chiaveIgnora(issue), { fonte: issue.fonte, tipo: issue.tipo, segment: issue.segment });
    const ignorate = [...state.ocraIgnorate.values()];
    const testo = getEditableText(el);
    state.ocra = state.ocra.filter((i) => !(i.start === issue.start && i.end === issue.end) && !Coerenza().ignorato(i, ignorate, testo));
    renderOverlayContent(state);
  }

  // ============================================================================
  // Prefetch e cache delle correzioni per parola
  // ============================================================================
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

  // Set globale di chiavi "in volo" per evitare richieste duplicate per la
  // stessa parola/frase mentre la precedente è in corso.
  function makeWordKey(word, sentence) {
    return String(word || '').toLowerCase() + '|' + String(sentence || '').trim().slice(0, 200);
  }

  // Lancia un check ortografico in background per la parola che l'utente ha
  // appena chiuso (ultimo carattere = boundary), così quando fa click destro
  // sulla parola la correzione è già pronta in cache.
  async function prefetchJustCompletedWord(state) {
    if (!isEnabled() || document.hidden) return;
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
    // Risali alla parola che precede il boundary.
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
      // Cache con la frase usata, per poter rilevare cambio di contesto al
      // momento del click destro. Anche risposte null/negative entrano in
      // cache per evitare fire ripetuti.
      state.wordCache.set(c.key, sugg ? { ...sugg, sentence } : { misspelled: false, correction: '', sentence });
    }));
  }

  // Cerca di estrarre frase precedente e successiva al campo editabile.
  // Best-effort: se non riusciamo, ritorniamo stringhe vuote.
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

  // Estrae le porzioni avvolte in **...** da `annotated` IN ORDINE, e per ognuna
  // trova la posizione della prossima occorrenza nel testo originale a partire
  // da dopo l'ultima trovata. Così i refusi ripetuti (es. "oggi … oggi") vengono
  // localizzati correttamente quando solo una delle due è marcata.
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
        // Segmento "originale" del testo. Usato in applyFix per validare che il
        // testo non sia cambiato fra scan e click su Risolvi: se è cambiato, niente
        // fix (evita di cancellare/sostituire la frase sbagliata).
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

  // ============================================================================
  // API per il content script (right-click)
  // ============================================================================
  // Restituisce il range "blu" sotto il punto, se c'è. Altrimenti null.
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

  // Trova la parola sotto al click in un editabile, restituisce
  // { word, start, end, sentence, prev, next } o null.
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

  // Variante per <input type=text/search> (single-line, non "supportati"
  // dall'overlay blu ma che meritano comunque il suggerimento di correzione nel
  // menu tasto destro — feedback alpha: la vecchia estensione lo mostrava anche
  // qui, la nuova app no perché si affidava ai soli suggerimenti nativi che non
  // sempre arrivano). Estrae la parola sotto il punto e ritorna lo stesso shape
  // di getWordAt, così openSpellWordMenu la gestisce identica a textarea/CE.
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

  // Offset di carattere nel valore di un <input> single-line a partire da una
  // coordinata X viewport. Misura col canvas imitando il font dell'elemento.
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
      // Per la textarea il caretPositionFromPoint non torna utile (offsetNode non è il textarea).
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
    // La domanda "che carattere c'è in questo punto" si ferma al confine dei
    // componenti web (shadow root): dentro un blocco isolato la risposta cade
    // nel light DOM — fuori dall'editabile — o non arriva affatto. Lì (e in
    // qualunque altro caso in cui la risposta non è utilizzabile) misuriamo noi
    // l'elemento che abbiamo già in mano. Vedi #438.
    return caretCharOffsetByRects(el, clientX, clientY);
  }

  // Quanti caratteri misurare uno per uno prima di passare alla ricerca binaria:
  // in un editabile lungo (una mail, un documento) il nodo di testo sotto al
  // cursore può essere enorme e un rettangolo per carattere costerebbe troppo.
  const RECT_SCAN_MAX = 400;
  const RECT_SCAN_WINDOW = 64;

  // Offset di carattere ricavato dalla sola geometria: confronta i rettangoli
  // dei caratteri dell'editabile col punto cliccato. Non chiede nulla al
  // documento, quindi funziona ovunque viva l'editabile (componenti web
  // compresi). Ritorna -1 se il punto non cade su nessun testo.
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
      // Considera solo i nodi la cui banda verticale contiene il punto: senza
      // questo filtro misureremmo tutto il testo dell'editabile.
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

  // Carattere di un singolo nodo di testo sotto al punto (o il più vicino).
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

  // Misura la posizione di carattere in una textarea ricostruendo il word-wrap
  // con un canvas che imita lo stile dell'elemento. Costoso ma corretto.
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

    // Suddivisione del testo in righe rispettando i \n e il word-wrap.
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

    // Ricerca binaria del char nella riga
    let lo = 0, hi = line.text.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const w = ctx.measureText(line.text.slice(0, mid)).width;
      if (w < px) lo = mid + 1;
      else hi = mid;
    }
    return line.startOffset + Math.max(0, Math.min(line.text.length, lo));
  }

  // ============================================================================
  // Applicazione correzioni
  // ============================================================================
  // Come una battuta, dall'editing del browser: il correttore nativo sposta i segni delle altre parole invece di
  // perderli (riscrivere il valore cancella tutto lo zigzag rosso del campo, #1111), e Ctrl+Z annulla la correzione.
  // Falso se il campo è rimasto com'era: allora lo si riscrive.
  function sostituisciComeBattuta(el, range, testo, cursorMode) {
    testo = String(testo ?? '');
    const prima = el.value;
    const caret = el.selectionEnd;
    // Una battuta rispetta maxlength e taglierebbe la correzione a metà.
    if (el.maxLength >= 0 && prima.length - (range.end - range.start) + testo.length > el.maxLength) return false;
    try {
      const radice = el.getRootNode();
      if (radice.activeElement !== el) el.focus({ preventScroll: true });
      if (radice.activeElement !== el) return false;
      el.setSelectionRange(range.start, range.end);
      if (testo) document.execCommand('insertText', false, testo);
      else if (range.end > range.start) document.execCommand('delete', false);
    } catch (_) {}
    if (el.value === prima) return false;
    if (cursorMode === 'preserve' && typeof caret === 'number') {
      const dove = caret >= range.end ? caret + testo.length - (range.end - range.start) : caret;
      try { el.setSelectionRange(dove, dove); } catch (_) {}
    }
    return true;
  }

  function applyFix(el, range, replacement, opts = {}) {
    const safeReplacement = String(replacement == null ? '' : replacement);
    // 'end' = caret a fine inserzione (popup correttore manuale).
    // 'preserve' = caret resta dove era (autocorrect: l'utente ha appena digitato
    // lo spazio, vogliamo che il caret resti dopo lo spazio, non dentro la parola).
    const cursorMode = opts.cursor || 'end';
    // Validazione "segment": se il chiamante passa il testo originale che ci aspettiamo
    // di trovare a [start, end), aborta se non corrisponde più (testo cambiato dopo lo
    // scan). Questo previene il bug "Risolvi cancella tutta la frase" causato da issue
    // con offset stale.
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
      // Validazione: se il range è fuori bounds o l'inizio è >= fine, usciamo.
      // Senza questo, v.slice(range.end) con range.end > v.length restituisce ""
      // e il salvataggio cancella tutto il testo dopo range.start.
      if (typeof range.start !== 'number' || typeof range.end !== 'number' ||
          range.start < 0 || range.end > v.length || range.end <= range.start) {
        console.warn('[SN] applyFix: range fuori bounds, skip', { range, length: v.length });
        return;
      }
      if (!sostituisciComeBattuta(el, range, safeReplacement, cursorMode)) {
        try {
          el.setRangeText(safeReplacement, range.start, range.end, cursorMode === 'preserve' ? 'preserve' : 'end');
        } catch (_) {
          const before = v.slice(0, range.start);
          const after = v.slice(range.end);
          el.value = before + safeReplacement + after;
          const caret = before.length + safeReplacement.length;
          try { el.setSelectionRange(caret, caret); } catch (_) {}
        }
        // Segnato come nostro: un campo di un riquadro di Filo, chiuso ai finti, deve sentire la correzione.
        el.dispatchEvent(global.SN_FILO_UI?.nostro ? global.SN_FILO_UI.nostro(new Event('input', { bubbles: true })) : new Event('input', { bubbles: true }));
      }
    } else {
      const text = el.textContent || '';
      if (range.start < 0 || range.end > text.length || range.end <= range.start) {
        console.warn('[SN] applyFix CE: range fuori bounds, skip', { range, length: text.length });
        return;
      }
      // Salva l'offset originale del caret, per ripristinarlo in modalità 'preserve'.
      const caretBefore = cursorMode === 'preserve' ? contenteditableCaretOffset(el) : -1;
      // Trova i text node di start e end via walker.
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

      // Posiziona la selezione sul range da rimpiazzare.
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

      // Tentativo 1: execCommand('insertText'). Passa per il pipeline di
      // beforeinput/input nativo del browser, così editor "controllati"
      // (Slate/Lexical/Discord, ecc.) aggiornano il loro modello interno
      // invece di resettare la mutazione DOM. Solo se fallisce ricadiamo
      // sul fallback DOM-mutation diretto (per editor "uncontrolled").
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
    // L'issue corretto cade col testo che cambia (anche se l'input non è arrivato); il prossimo scan rivaluterà.
    const state = monitored.get(el);
    if (state) {
      seguiIlTesto(state);
      if (getEditableText(el) === currentText) {
        const altro = (i) => !(i.start === range.start && i.end === range.end);
        state.issues = state.issues.filter(altro);
        state.ocra = state.ocra.filter(altro);
      }
      state.lastScannedText = '';
      renderOverlayContent(state);
      scheduleScan(state);
      // Una correzione scelta dal menu cambia il testo: l'ocra lo ricontrolla. L'autocorrezione (`preserve`) arriva
      // battendo, e lì l'ocra la programma già il tasto.
      if (cursorMode !== 'preserve' && ocraAttiva()) { programmaDate(state); scheduleOcra(state); }
    }
  }

  // ============================================================================
  // Richiesta on-demand: parola sotto cursore → suggerimento LLM
  // ============================================================================
  // Restituisce { misspelled, correction } o null se la chiamata fallisce.
  // `suRichiesta`: il tasto destro dell'utente, che il tetto del main sulle chiamate automatiche non ferma.
  async function requestWordSuggestion({ word, sentence, prev, next }, { suRichiesta = false } = {}) {
    try {
      const res = await chrome.runtime.sendMessage({
        type: MSG.AI_REQUEST,
        action: ACTIONS.SPELLCHECK_WORD,
        payload: { word, sentence, prev, next },
        // Senza il tasto destro è un anticipo: l'uso lo conta il menu che mostra la correzione già pronta (#969).
        ...(suRichiesta ? { suRichiesta: true } : { parteDiUnUso: true }),
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

  // ============================================================================
  // Suggerimenti correttore nativo (Electron)
  // ============================================================================
  // Ritorna i suggerimenti nativi per `word` se sono recenti e riferiti a quella
  // parola; altrimenti []. Usato dal menu di correzione (content.js) come fonte
  // immediata e affidabile, in parallelo al suggerimento contestuale dell'LLM.
  function getNativeSuggestions(word) {
    if (!word || !lastNative.word) return [];
    if (lastNative.word.toLowerCase() !== String(word).toLowerCase()) return [];
    if (Date.now() - lastNative.ts > 4000) return [];
    return lastNative.suggestions.slice();
  }

  // Registra un callback chiamato (una volta) per la prossima notifica nativa
  // di spellcheck, qualunque sia la parola. Utile su `<input>` dove non
  // conosciamo a priori la parola sotto il cursore: aspettiamo che Electron
  // ce la dica via `wc.on('context-menu')`. Ritorna una funzione per annullare.
  //
  // `opts.since` (timestamp ms): se passato, e se `lastNative` è arrivato dopo
  // quell'istante, serviamo subito il dato già in cache invece di aspettare un
  // nuovo broadcast. Serve perché `openNormalMenuAt` ha un `await` su
  // getClipboardHistory() PRIMA di registrare il waiter: il broadcast nativo
  // può quindi arrivare in mezzo, e senza questa scorciatoia andava perso.
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

  // Registra un callback chiamato (una volta) quando arrivano i suggerimenti
  // nativi per `word`, se non sono già disponibili al momento dell'apertura del
  // menu (il broadcast dal main può arrivare con qualche ms di ritardo). Ritorna
  // una funzione per annullare l'attesa.
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

  // ============================================================================
  // API pubblica
  // ============================================================================
  global.SN_SPELLCHECK = {
    init,
    updateSettings,
    isEnabled,
    ocraAttiva,
    isSupportedEditable,
    findSupportedEditable,
    getSemanticIssueAt,
    getContextIssueAt,
    ignoraCoerenza,
    contestoDelCampo,
    getWordAt,
    getInputWordAt,
    requestWordSuggestion,
    applyFix,
    sostituisciComeBattuta,
    riallineaIssues,
    soloSpaziOPunteggiatura,
    segniDellaRisposta,
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
