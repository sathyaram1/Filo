// Estrazione del contesto attorno alla selezione e del testo principale della pagina.

(function (global) {
  'use strict';

  // Verifica se un text node ha tutti gli antenati visibili.
  // Filtra display:none, visibility:hidden, aria-hidden, sr-only (1x1 clipped),
  // <script>/<style>.
  function isTextNodeVisible(textNode) {
    let el = textNode.parentElement;
    while (el) {
      const tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return false;
      if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none') return false;
      if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
      // Pattern sr-only: elemento clippato di 1×1px con overflow hidden
      const r = el.getBoundingClientRect();
      if (r.width <= 1 && r.height <= 1 && (cs.overflow === 'hidden' || cs.clip !== 'auto')) return false;
      el = el.parentElement;
    }
    return true;
  }

  // Estrae il testo "visibile" della selezione corrente, ignorando i text node
  // dentro elementi nascosti via CSS o aria-hidden.
  function getRenderedSelectionText(sel) {
    sel = sel || window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return '';
    const range = sel.getRangeAt(0);
    const cac = range.commonAncestorContainer;
    const root = cac.nodeType === Node.ELEMENT_NODE ? cac : cac.parentElement;
    if (!root) return '';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let out = '';
    let node;
    while ((node = walker.nextNode())) {
      // Salta text node fuori dalla range (prima di start o dopo end)
      const nr = document.createRange();
      nr.selectNode(node);
      if (range.compareBoundaryPoints(Range.END_TO_START, nr) >= 0) continue;
      if (range.compareBoundaryPoints(Range.START_TO_END, nr) <= 0) continue;
      if (!isTextNodeVisible(node)) continue;
      let t = node.nodeValue;
      if (node === range.startContainer && node === range.endContainer) {
        t = t.slice(range.startOffset, range.endOffset);
      } else if (node === range.startContainer) {
        t = t.slice(range.startOffset);
      } else if (node === range.endContainer) {
        t = t.slice(0, range.endOffset);
      }
      out += t;
    }
    return out;
  }

  // Una selezione "ha davvero del testo"? Non ci si può fidare del solo
  // isCollapsed: per una selezione DENTRO uno shadow root Chromium riporta
  // isCollapsed=true (anchor/focus ri-targettizzati all'host del componente)
  // pur avendo una range con testo dentro il root. Guardiamo quindi anche la
  // range vera e il testo.
  function selectionHasText(sel) {
    if (!sel || !sel.rangeCount) return false;
    if (!sel.isCollapsed) return true;
    try { if (!sel.getRangeAt(0).collapsed) return true; } catch (_) {}
    try { if (sel.toString().trim()) return true; } catch (_) {}
    return false;
  }

  // La selezione "giusta" per un dato bersaglio. window.getSelection() NON espone
  // il testo selezionato dentro uno shadow root (i "componenti" web dei siti
  // moderni): lì la selezione vive nel root del componente, esposta da
  // shadowRoot.getSelection() (Chromium). Se il documento non ha una selezione
  // utile, risaliamo dai root shadow che contengono il bersaglio.
  function selectionForTarget(target) {
    const docSel = window.getSelection();
    if (selectionHasText(docSel)) return docSel;
    let node = target;
    // Massimo qualche livello per gli shadow annidati (evita loop patologici).
    for (let i = 0; node && i < 20; i++) {
      const root = typeof node.getRootNode === 'function' ? node.getRootNode() : null;
      if (!root || root.nodeType !== 11 /* DOCUMENT_FRAGMENT_NODE (ShadowRoot) */) break;
      if (typeof root.getSelection === 'function') {
        const ss = root.getSelection();
        if (selectionHasText(ss)) return ss;
      }
      node = root.host; // sali allo shadow che contiene questo (annidamento)
    }
    return docSel;
  }

  // Trova la frase che contiene la selezione, espandendo dal nodo della selezione
  // al nodo testuale completo, e ritagliando alla frase.
  function getSelectionWithSentence(target) {
    const sel = selectionForTarget(target);
    if (!selectionHasText(sel)) return null;
    // Solo testo VISIBILE (filtra sr-only, aria-hidden, display:none ecc.)
    const rendered = getRenderedSelectionText(sel).replace(/\s+/g, ' ').trim();
    const fallback = sel.toString().trim();
    const text = rendered || fallback;
    if (!text) return null;

    let sentence = text;
    try {
      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const parent = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
      // innerText riflette il testo "as rendered" (skippa display:none, ecc.)
      const fullText = (parent?.innerText || parent?.textContent || '').replace(/\s+/g, ' ').trim();
      if (fullText) {
        const idx = fullText.indexOf(text);
        if (idx >= 0) {
          // Espandi a confini di frase: . ? ! o inizio/fine
          const before = fullText.slice(0, idx);
          const after = fullText.slice(idx + text.length);
          const startMatch = before.match(/[.!?\n][^.!?\n]*$/);
          const start = startMatch ? before.length - (startMatch[0].length - 1) : 0;
          const endMatch = after.match(/^[^.!?\n]*[.!?]/);
          const end = idx + text.length + (endMatch ? endMatch[0].length : after.length);
          sentence = fullText.slice(start, end).trim();
        } else {
          sentence = fullText.slice(0, 400);
        }
      }
    } catch (_) {}

    return { selection: text, sentence };
  }

  // Estrazione del testo principale via euristiche semplici (no Readability per ridurre bundle).
  // Strategia: prendi <article>, <main>, oppure il blocco <body> filtrando nav/footer/aside.
  function extractMainTextNodes() {
    const candidates = ['article', 'main', '[role="main"]'];
    let root = null;
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.innerText && el.innerText.length > 200) { root = el; break; }
    }
    if (!root) root = document.body;

    const SKIP = new Set(['NAV', 'FOOTER', 'ASIDE', 'HEADER', 'FORM', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG']);
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(el) {
        if (SKIP.has(el.tagName)) return NodeFilter.FILTER_REJECT;
        // ignora elementi nascosti
        const cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const TEXT_TAGS = new Set(['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'TD', 'DD', 'DT', 'FIGCAPTION']);
    const TEXT_TAGS_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, dd, dt, figcaption';
    let cur = walker.currentNode;
    while (cur) {
      if (TEXT_TAGS.has(cur.tagName)) {
        // Aggiungi solo i blocchi "foglia" (senza altri TEXT_TAG annidati).
        // Es: <blockquote><p>...</p></blockquote> → salta <blockquote>, prendi <p>.
        // Evita doppia traduzione e rimpiazzi che si sovrascrivono.
        if (!cur.querySelector(TEXT_TAGS_SELECTOR)) {
          const txt = (cur.innerText || '').trim();
          if (txt.length > 20) nodes.push({ el: cur, text: txt });
        }
      }
      cur = walker.nextNode();
    }
    return nodes;
  }

  // ---------------------------------------------------------------------------
  // Blocchi traducibili — "traduci la pagina" vuol dire TUTTA la pagina.
  //
  // extractMainTextNodes() sopra serve a capire di cosa parla la pagina (excerpt
  // per il categorizer): lì ha senso restringersi all'articolo e ai tag di prosa.
  // Per la traduzione la regola opposta è quella giusta: qualsiasi elemento che
  // contiene testo VISIBILE va tradotto, indipendentemente dal tag con cui il
  // sito lo ha scritto (titoli dentro <header>, sommari e didascalie dentro
  // <div>/<span>, riquadri "Leggi anche" dentro <aside>, voci di menu, bottoni).
  //
  // Unità = elemento che ha almeno un text node come figlio DIRETTO. Così ogni
  // pezzo di testo appartiene a una sola unità (niente doppie traduzioni) e i
  // testi annidati dentro elementi inline (tipicamente i link) diventano a loro
  // volta unità, invece di restare intoccati come segnaposto.
  // ---------------------------------------------------------------------------

  // Sottoalberi che non si traducono mai: o non contengono prosa (script, media,
  // grafica) o il testo è codice/valore e tradurlo lo romperebbe.
  // NB: SELECT e OPTGROUP NON sono qui: il loro testo proprio è vuoto (non
  // rischiano di diventare blocchi) ma bisogna poterci scendere dentro per
  // arrivare alle OPTION, le cui etichette si leggono sullo schermo. DATALIST
  // invece resta fuori: le sue voci sono valori che finiscono dentro il campo,
  // non etichette da leggere.
  const TRANSLATE_SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'CANVAS',
    'IFRAME', 'OBJECT', 'EMBED', 'VIDEO', 'AUDIO', 'PRE', 'CODE', 'KBD',
    'SAMP', 'VAR', 'TEXTAREA', 'INPUT', 'OPTION',
    'DATALIST', 'HEAD', 'TITLE',
  ]);

  const HAS_LETTER = /\p{L}/u;

  // ---------------------------------------------------------------------------
  // Testo che si legge sullo schermo ma non sta nella pagina: sta negli
  // ATTRIBUTI (#407). Il grigio dentro un campo di ricerca (`placeholder`), il
  // suggerimento che compare fermando il mouse (`title`), la descrizione di
  // un'immagine (`alt`), l'etichetta di una voce di menu a tendina. Lasciarli
  // in inglese sotto un avviso "Pagina tradotta" è la stessa bugia da cui nasce
  // la segnalazione: si vede a occhio che il lavoro non è finito.
  //
  // La riga di confine è netta: si traduce ciò che l'utente LEGGE, mai ciò che
  // il sito RIMANDA INDIETRO. Perciò niente `value` (viene inviato col modulo),
  // niente `href`/`src`/`name`/`id`, niente voci di `datalist` (finiscono
  // dentro al campo come testo digitato).
  const TRANSLATABLE_ATTRS_ANY = ['title', 'aria-label'];
  const TRANSLATABLE_ATTRS_BY_TAG = {
    INPUT: ['placeholder', 'alt'],
    TEXTAREA: ['placeholder'],
    IMG: ['alt'],
    AREA: ['alt'],
    // Una voce di menu a tendina si traduce SCRIVENDO l'etichetta, mai
    // sostituendone il testo: il testo di una <option> senza `value` è proprio
    // ciò che il modulo invia. Con `label` presente il browser mostra
    // l'etichetta e continua a inviare il valore di prima.
    OPTION: ['label'],
    OPTGROUP: ['label'],
  };

  // Valore di partenza di un attributo traducibile. Per l'etichetta di una
  // <option> che non ce l'ha, il testo che si legge è il suo contenuto.
  function attrSourceValue(el, attr, tag) {
    const v = el.getAttribute(attr);
    if (v !== null) return v;
    if (attr === 'label' && tag === 'OPTION') return el.textContent || '';
    return null;
  }

  // Attributi da tradurre di QUESTO elemento, già ripuliti; null se non ce ne
  // sono (il caso della stragrande maggioranza degli elementi: si esce subito).
  function attrTargetsOf(el) {
    if (!el.getAttribute) return null;
    const tag = (el.tagName || '').toUpperCase();
    const extra = TRANSLATABLE_ATTRS_BY_TAG[tag];
    const names = extra ? TRANSLATABLE_ATTRS_ANY.concat(extra) : TRANSLATABLE_ATTRS_ANY;
    const done = (el.dataset && el.dataset.snTranslatedAttrs) || '';
    let out = null;
    for (const attr of names) {
      if (done && done.split(',').indexOf(attr) >= 0) continue;
      const raw = attrSourceValue(el, attr, tag);
      if (raw === null) continue;
      const text = raw.replace(/\s+/g, ' ').trim();
      if (text.length < 2 || !HAS_LETTER.test(text)) continue;
      (out || (out = [])).push({ el, attr, text });
    }
    return out;
  }

  // Namespace HTML: solo gli elementi qui dentro sono "testo di pagina". Tutto
  // ciò che sta in un altro namespace (SVG, MathML e qualsiasi foreign content)
  // NON è prosa da tradurre — il suo <style>, le sue etichette <text> e le sue
  // istruzioni interne romperebbero l'illustrazione/formula se rimpiazzate.
  const HTML_NS = 'http://www.w3.org/1999/xhtml';

  // La UI che Filo inietta nella pagina (menu, toast, popup, sidebar) usa il
  // prefisso di classe "sn-": non è contenuto del sito e non va tradotta.
  // Alcuni riquadri di Filo (avviso sito pericoloso, proposta cambio paese)
  // vivono invece dentro un componente isolato agganciato a un host con id
  // "filo-…": da quando la traduzione entra nei componenti, anche quelli
  // finirebbero tradotti — e sono già scritti nella lingua dell'utente.
  function isFiloOwnUi(el) {
    const id = el.id || '';
    if (id.indexOf('sn-') === 0 || id.indexOf('filo-') === 0) return true;
    const cl = el.classList;
    if (!cl || !cl.length) return false;
    for (const c of cl) if (c.indexOf('sn-') === 0) return true;
    return false;
  }

  // Due motivi diversi di saltare un sottoalbero, e la differenza conta:
  //  - `'tag'` → "qui dentro non c'è prosa" (uno script, un video, un campo di
  //    testo). Il CONTENUTO non si tocca, ma l'elemento può esporre etichette
  //    da leggere (il grigio di un campo, il suggerimento di un bottone): quelle
  //    si traducono lo stesso.
  //  - `'hard'` → "qui non si tocca niente", nemmeno le etichette: testo scritto
  //    dall'utente, roba nascosta, `translate="no"`, la UI di Filo.
  function skipSubtreeForTranslation(el) {
    // Barriera 1 — tag noti non-prosa. Confronto INSENSIBILE al maiuscolo/minuscolo:
    // gli elementi dentro un SVG/MathML inline espongono tagName in minuscolo
    // (es. 'svg', 'style', 'text'), quindi un confronto secco contro 'SVG'/'STYLE'
    // non farebbe mai presa e il loro contenuto finirebbe tradotto.
    if (TRANSLATE_SKIP_TAGS.has((el.tagName || '').toUpperCase())) return 'tag';
    // Barriera 2 — qualsiasi elemento fuori dal namespace HTML (SVG, MathML,
    // foreign content futuro): non è testo di pagina. Ferma l'intero sottoalbero
    // anche se un domani comparisse un tag radice non previsto nella lista sopra.
    if (el.namespaceURI && el.namespaceURI !== HTML_NS) return 'tag';
    return hardSkipForTranslation(el) ? 'hard' : false;
  }

  function hardSkipForTranslation(el) {
    if (el.isContentEditable) return true;                  // testo dell'utente
    if (el.hasAttribute && el.hasAttribute('hidden')) return true;
    if (el.getAttribute && el.getAttribute('translate') === 'no') return true;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return true;
    if (el.classList && el.classList.contains('notranslate')) return true;
    if (isFiloOwnUi(el)) return true;
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return true;
    return false;
  }

  // Testo "proprio" dell'elemento: solo i text node figli DIRETTI (quelli più in
  // profondità appartengono alle loro unità).
  function ownTextOf(el) {
    let out = '';
    for (const c of el.childNodes) {
      if (c.nodeType === Node.TEXT_NODE) out += c.nodeValue;
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  // Un "componente chiuso" (#439): il sito costruisce un pezzo di pagina dentro
  // un contenitore che ha deciso di NON aprire a nessuno script (shadow root in
  // modalità closed). Il suo testo non è leggibile — né da Filo né da qualsiasi
  // altro codice della pagina — quindi non si può tradurre. Quello che si può
  // fare è ACCORGERSENE, così l'avviso finale resta onesto ("tradotta solo in
  // parte") invece di dichiarare finito un lavoro monco.
  //
  // Riconoscerlo senza falsi allarmi: un elemento personalizzato del sito (nome
  // col trattino) che non espone un contenitore aperto, non ha NIENTE dentro di
  // sé nella pagina, e ciò nonostante occupa un rettangolo grande abbastanza da
  // starci del testo — sta disegnando qualcosa che noi non vediamo.
  //
  // NB: "è un componente registrato dal sito?" non è una domanda che si possa
  // fare da qui — il registro dei componenti della pagina non è lo stesso che
  // vede il codice di Filo, e da qui risulterebbe sempre vuoto. Restano la
  // forma del nome e il rettangolo. La soglia tiene fuori le icone disegnate
  // via CSS (quadratini di 20-30px senza testo), che sono il falso allarme
  // plausibile; nel dubbio si sbaglia dalla parte della prudenza, perché
  // "tradotta solo in parte" di troppo costa molto meno di un "Pagina tradotta"
  // falso.
  const CLOSED_MIN_W = 40;
  const CLOSED_MIN_H = 16;

  function isClosedComponent(el) {
    const tag = (el.tagName || '').toLowerCase();
    if (tag.indexOf('-') < 0) return false;
    if (el.shadowRoot) return false;                 // aperto: lo attraversiamo
    if (el.children.length) return false;            // ha contenuto raggiungibile
    if ((el.textContent || '').trim()) return false;
    try {
      const r = el.getBoundingClientRect();
      return r.width >= CLOSED_MIN_W && r.height >= CLOSED_MIN_H;
    } catch (_) { return false; }
  }

  // Blocchi da tradurre, cercati anche DENTRO i componenti isolati dei siti
  // moderni (#439). Un TreeWalker si ferma al confine di un componente: il suo
  // contenuto vive in un albero a parte (shadow root) che va attraversato
  // esplicitamente, altrimenti titoli e paragrafi lì dentro restano in lingua
  // originale mentre il resto della pagina cambia.
  //
  // Il testo "in luce" (passato dal sito al componente via <slot>) NON viene
  // contato due volte: sta nell'albero normale, dove lo incontriamo una volta
  // sola; nel componente c'è solo il segnaposto <slot>, che testo proprio non
  // ne ha.
  //
  // L'array ritornato porta anche `unreachable`: quanti componenti chiusi
  // (contenuto illeggibile per chiunque) sono stati incontrati. Serve a chi
  // scrive l'avviso finale, non alla traduzione.
  //
  // E porta `truncated`: quanti blocchi ci sono OLTRE il tetto di un giro. Il
  // tetto tiene sotto controllo quanto lavoro parte in una volta, ma la
  // scansione non si ferma lì — perché il conteggio serve a chi scrive
  // l'avviso finale: senza, una pagina enorme veniva dichiarata "tradotta" con
  // la coda ancora in lingua originale (la bugia di #407, altra causa). Contare
  // costa una camminata nel DOM, niente richieste al modello.
  function extractTranslatableBlocks({ maxBlocks = 2000 } = {}) {
    const root = document.body || document.documentElement;
    if (!root) return Object.assign([], { unreachable: 0, truncated: 0 });
    const out = [];
    let unreachable = 0;
    let truncated = 0;
    // Pila esplicita invece del TreeWalker: deve poter saltare da un albero
    // all'altro (pagina → componente) restando in ordine di lettura.
    const stack = [root];
    while (stack.length) {
      const el = stack.pop();
      // La radice non passa dal filtro: un <body translate="no"> o nascosto in
      // partenza spegnerebbe la traduzione dell'intera pagina, che prima invece
      // partiva. Il filtro vale — come prima — da lì in giù.
      if (el !== root && skipSubtreeForTranslation(el)) continue;
      // Già tradotto: si salta QUESTO elemento ma si continua a scendere nei
      // figli (#408). Scartare tutto il sottoalbero renderebbe irraggiungibili
      // i blocchi annidati che una traduzione interrotta a metà non ha ancora
      // toccato — nessuna ripresa potrebbe più completarli.
      if (!(el.dataset && el.dataset.snTranslated)) {
        // Serve almeno una lettera: numeri, bullet e simboli non si traducono.
        const txt = ownTextOf(el);
        if (txt.length >= 2 && HAS_LETTER.test(txt)) {
          if (out.length >= maxBlocks) truncated++;
          else out.push({ el, text: txt });
        }
      }
      const kids = [];
      const shadow = el.shadowRoot;
      if (shadow) {
        for (const c of shadow.children) kids.push(c);
      } else if (isClosedComponent(el)) {
        unreachable++;
      }
      for (const c of el.children) kids.push(c);
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
    return Object.assign(out, { unreachable, truncated });
  }

  // Tutti gli elementi già tradotti, componenti isolati compresi: una
  // querySelectorAll sul documento si ferma al confine del componente e
  // lascerebbe fuori (dal conteggio e dal ripristino) proprio i blocchi che
  // #439 ha reso traducibili.
  function findTranslatedElements() {
    const out = [];
    const roots = [document];
    while (roots.length) {
      const r = roots.pop();
      let list;
      try { list = r.querySelectorAll('*'); } catch (_) { continue; }
      for (const el of list) {
        if (el.dataset && el.dataset.snTranslated) out.push(el);
        if (el.shadowRoot) roots.push(el.shadowRoot);
      }
    }
    return out;
  }

  function pageMeta() {
    const og = (name) => document.querySelector(`meta[property="og:${name}"]`)?.content || '';
    const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content || '';
    return {
      url: location.href,
      title: document.title,
      description: meta('description') || og('description'),
    };
  }

  // ~500 caratteri di estratto del contenuto principale, per categorizer.
  function pageExcerpt(maxChars = 500) {
    const nodes = extractMainTextNodes();
    let acc = '';
    for (const n of nodes) {
      acc += (acc ? ' ' : '') + n.text;
      if (acc.length >= maxChars) break;
    }
    return acc.slice(0, maxChars);
  }

  // ---------------------------------------------------------------------------
  // Outline interattivo della pagina per l'agente "Aiuto".
  // Restituisce una stringa compatta che elenca elementi rilevanti (interattivi
  // o landmark) con: stato (visibile/fuori-viewport/collassato), tag, testo,
  // selettore stabile (id, aria-label, testo univoco, oppure path posizionale).
  // L'agente vision riceve così sia lo screenshot della viewport sia un quadro
  // completo della pagina, anche fuori scroll o dentro <details> chiusi.
  // ---------------------------------------------------------------------------

  const OUTLINE_INTERACTIVE_SELECTOR = [
    'a[href]', 'button', 'summary', 'select', 'textarea',
    'input:not([type="hidden"])',
    '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
    '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="combobox"]',
    '[contenteditable=""]', '[contenteditable="true"]',
    'details', 'dialog', 'label',
    'h1', 'h2', 'h3', 'nav', 'form',
  ].join(',');

  function isHiddenByCss(el) {
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none') return true;
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return true;
    if (parseFloat(cs.opacity || '1') === 0) return true;
    return false;
  }

  // Cerca un antenato che "collassa" il contenuto: <details> non aperto,
  // [aria-expanded="false"], [hidden], oppure CSS che lo nasconde.
  function getCollapsedAncestor(el) {
    let cur = el.parentElement;
    while (cur && cur !== document.documentElement) {
      if (cur.tagName === 'DETAILS' && !cur.open) return cur;
      if (cur.hasAttribute && cur.hasAttribute('hidden')) return cur;
      const ariaExp = cur.getAttribute && cur.getAttribute('aria-expanded');
      if (ariaExp === 'false') return cur;
      if (cur.getAttribute && cur.getAttribute('aria-hidden') === 'true') return cur;
      if (isHiddenByCss(cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function isInViewport(rect) {
    return rect.bottom > 0 && rect.top < window.innerHeight
        && rect.right > 0 && rect.left < window.innerWidth;
  }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  // Costruisce un selettore stabile per un elemento. Preferenza:
  // 1) #id (se id semplice e univoco), 2) tag[aria-label="..."], 3) tag con
  // name/data-testid univoci, 4) percorso :nth-of-type fino a 4 livelli.
  function buildSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) {
      const s = '#' + el.id;
      try { if (document.querySelectorAll(s).length === 1) return s; } catch (_) {}
    }
    const tag = el.tagName.toLowerCase();
    const tryAttr = (name) => {
      const v = el.getAttribute && el.getAttribute(name);
      if (!v) return null;
      const sel = `${tag}[${name}="${cssEscape(v).replace(/\\(["\\])/g, '\\$1')}"]`;
      try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (_) {}
      return null;
    };
    for (const attr of ['data-testid', 'data-test', 'name', 'aria-label', 'aria-labelledby']) {
      const s = tryAttr(attr);
      if (s) return s;
    }
    // Path posizionale, max 5 livelli
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && depth < 5) {
      let part = cur.tagName.toLowerCase();
      if (cur.id && /^[a-zA-Z][\w-]*$/.test(cur.id)) {
        parts.unshift('#' + cur.id);
        break;
      }
      const parent = cur.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(cur) + 1;
          part += `:nth-of-type(${idx})`;
        }
      }
      parts.unshift(part);
      cur = parent;
      depth++;
    }
    return parts.join(' > ');
  }

  function shortText(el) {
    const txt = (el.getAttribute?.('aria-label')
      || el.getAttribute?.('alt')
      || el.getAttribute?.('placeholder')
      || el.value
      || el.innerText
      || el.textContent
      || '').replace(/\s+/g, ' ').trim();
    return txt.slice(0, 80);
  }

  // Espande <details> e [aria-expanded="false"] sull'antenato per portare
  // l'elemento in stato "raggiungibile". Pensato per accompagnare lo scroll
  // verso un elemento indicato dall'agente.
  function expandAncestors(el) {
    let cur = el.parentElement;
    let changed = false;
    while (cur && cur !== document.documentElement) {
      if (cur.tagName === 'DETAILS' && !cur.open) {
        try { cur.open = true; changed = true; } catch (_) {}
      }
      cur = cur.parentElement;
    }
    return changed;
  }

  // Annotazioni utili per l'agente "Aiuto":
  // - ⤤ hover  : elemento che probabilmente nasconde un menu aprendolo on-hover
  //              (ha aria-haspopup, oppure il suo sibling/descendant è un menu
  //              CSS :hover-driven non rilevabile in modo affidabile, quindi
  //              ci limitiamo all'attributo esplicito).
  // - ⊕ reveal : elemento che l'agente può "rivelare" in autonomia, perché
  //              è un disclosure pattern canonico (details chiuso, oppure
  //              [aria-expanded=false][aria-controls] non-form, non-link).
  function revealHint(el) {
    if (!el) return '';
    if (el.tagName === 'DETAILS' && !el.open) return ' ⊕reveal';
    if (el.tagName === 'SUMMARY' && el.parentElement?.tagName === 'DETAILS' && !el.parentElement.open) return ' ⊕reveal';
    if (el.getAttribute?.('aria-expanded') === 'false' && el.getAttribute?.('aria-controls')) {
      if (el.tagName === 'A' && el.getAttribute('href') && el.getAttribute('href') !== '#') return '';
      if (el.tagName === 'BUTTON' && (el.type === 'submit' || el.type === 'reset')) return '';
      if (el.closest('form') && el.tagName !== 'BUTTON') return '';
      return ' ⊕reveal';
    }
    return '';
  }
  // Heuristica "questo elemento apre un menu on-hover":
  // 1) aria-haspopup esplicito (segnale forte)
  // 2) ha un sibling o descendant che è un contenitore-menu (role=menu/listbox,
  //    classi *menu*/*dropdown*/*popover*/*flyout*) attualmente nascosto via
  //    CSS (display:none/visibility:hidden/opacity 0). Questo cattura i menu
  //    CSS :hover-driven senza attributi ARIA, tipici di header/profilo.
  function hasHiddenMenuRelative(el) {
    if (!el) return false;
    const MENU_SEL = '[role="menu"],[role="listbox"],[class*="dropdown" i],[class*="menu" i],[class*="popover" i],[class*="flyout" i],[class*="submenu" i]';
    const candidates = [];
    try {
      // Sibling immediati (pattern: <button>trigger</button><ul.menu>...</ul>)
      const parent = el.parentElement;
      if (parent) {
        Array.from(parent.children).forEach((c) => { if (c !== el && c.matches?.(MENU_SEL)) candidates.push(c); });
      }
      // Descendant diretti (pattern: <div.trigger><ul.menu>...</ul></div>)
      el.querySelectorAll?.(MENU_SEL)?.forEach((c) => candidates.push(c));
    } catch (_) {}
    for (const c of candidates) {
      try {
        const cs = window.getComputedStyle(c);
        if (cs.display === 'none') return true;
        if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return true;
        if (parseFloat(cs.opacity || '1') === 0) return true;
        // visibile ma fuori schermo (translate o left:-9999) → probabile menu chiuso
        const r = c.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return true;
      } catch (_) {}
    }
    return false;
  }
  function hoverHint(el) {
    if (!el) return '';
    const hasPopup = el.getAttribute?.('aria-haspopup');
    if (hasPopup && hasPopup !== 'false') return ' ⤤hover';
    if (hasHiddenMenuRelative(el)) return ' ⤤hover';
    return '';
  }

  // Whitelist runtime per l'azione "reveal". Usata da highlight.js per
  // rifiutare reveal su elementi che farebbero side-effect (nav, submit).
  function canRevealElement(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === 'DETAILS' && !el.open) return true;
    if (el.tagName === 'SUMMARY' && el.parentElement?.tagName === 'DETAILS' && !el.parentElement.open) return true;
    if (el.getAttribute?.('aria-expanded') === 'false' && el.getAttribute?.('aria-controls')) {
      if (el.tagName === 'A' && el.getAttribute('href') && el.getAttribute('href') !== '#') return false;
      if (el.tagName === 'BUTTON' && (el.type === 'submit' || el.type === 'reset')) return false;
      if (el.closest('form') && el.tagName !== 'BUTTON') return false;
      return true;
    }
    return false;
  }

  function extractInteractiveOutline({ maxItems = 120, maxChars = 4000 } = {}) {
    const all = Array.from(document.querySelectorAll(OUTLINE_INTERACTIVE_SELECTOR));
    const out = [];
    let chars = 0;
    for (const el of all) {
      if (out.length >= maxItems || chars >= maxChars) break;
      // Salta script/style/elementi nascosti permanentemente per CSS
      if (isHiddenByCss(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        // Elementi 0x0 (es. voci di menu hover non aperto, sr-only): teniamoli
        // se hanno una label semantica (testo, aria-label, alt, placeholder),
        // così l'agente li vede e può proporre un hover sul trigger.
        const txt = shortText(el);
        if (!txt) continue;
      }
      const collapsed = getCollapsedAncestor(el);
      const inView = !collapsed && isInViewport(rect);
      const flag = inView ? '✓' : (collapsed ? '▸' : '↕');
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute?.('role') || '';
      const tagDesc = role ? `${tag}[role=${role}]` : tag;
      const text = shortText(el) || '(senza testo)';
      const sel = buildSelector(el);
      const hint = revealHint(el) + hoverHint(el);
      const line = `${flag} ${tagDesc} "${text}"${hint} :: ${sel}`;
      out.push(line);
      chars += line.length + 1;
    }
    return out.join('\n');
  }

  function viewportInfo() {
    const docHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight || 0,
    );
    const scrollY = Math.round(window.scrollY || 0);
    const height = window.innerHeight;
    const width = window.innerWidth;
    return {
      scrollY,
      maxScrollY: Math.max(0, docHeight - height),
      width,
      height,
      docHeight,
    };
  }

  global.SN_EXTRACT = {
    getSelectionWithSentence,
    getRenderedSelectionText,
    extractMainTextNodes,
    extractTranslatableBlocks,
    findTranslatedElements,
    pageMeta,
    pageExcerpt,
    extractInteractiveOutline,
    viewportInfo,
    expandAncestors,
    canRevealElement,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
