// Estrazione del contesto attorno alla selezione e del testo principale della pagina.

(function (global) {
  'use strict';

  // Filtra display:none, visibility:hidden, aria-hidden, sr-only (1×1 clipped), <script> e <style>.
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

  // Testo VISIBILE della selezione: i text node dentro elementi nascosti via CSS o aria-hidden non contano.
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

  // Non ci si può fidare del solo isCollapsed: dentro uno shadow root Chromium lo riporta true (anchor e focus ri-targettizzati all'host) anche con del testo selezionato, quindi si guardano anche la range vera e il testo.
  function selectionHasText(sel) {
    if (!sel || !sel.rangeCount) return false;
    if (!sel.isCollapsed) return true;
    try { if (!sel.getRangeAt(0).collapsed) return true; } catch (_) {}
    try { if (sel.toString().trim()) return true; } catch (_) {}
    return false;
  }

  // window.getSelection() NON espone il testo selezionato dentro uno shadow root: lì la selezione vive nel root del componente (shadowRoot.getSelection(), Chromium).
  // Se il documento non ne ha una utile, si risale dai root shadow che contengono il bersaglio.
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

  // Espande dal nodo della selezione al nodo testuale completo, poi ritaglia alla frase.
  function getSelectionWithSentence(target) {
    const sel = selectionForTarget(target);
    if (!selectionHasText(sel)) return null;
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

  // Euristiche semplici invece di Readability, per non gonfiare il bundle: <article>, <main>, oppure il body filtrando nav, footer e aside.
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
        // Solo i blocchi foglia, senza altri TEXT_TAG annidati: evita doppie traduzioni e rimpiazzi che si sovrascrivono.
        if (!cur.querySelector(TEXT_TAGS_SELECTOR)) {
          const txt = (cur.innerText || '').trim();
          if (txt.length > 20) nodes.push({ el: cur, text: txt });
        }
      }
      cur = walker.nextNode();
    }
    return nodes;
  }

  // Blocchi traducibili: «traduci la pagina» vuol dire TUTTA la pagina. extractMainTextNodes serve a capire di cosa parla la pagina, e lì restringersi all'articolo ha senso; qui vale la regola opposta.
  // Qualsiasi elemento con testo VISIBILE va tradotto, comunque il sito l'abbia scritto: titoli in <header>, didascalie in <div>/<span>, riquadri «Leggi anche» in <aside>, voci di menu, bottoni.
  // Unità = elemento con almeno un text node come figlio DIRETTO: così ogni pezzo appartiene a una sola unità, e i testi dentro elementi inline (i link) diventano unità invece di restare segnaposto.

  // Sottoalberi che non si traducono mai: o non c'è prosa (script, media, grafica) o il testo è codice o valore e tradurlo lo romperebbe.
  // SELECT e OPTGROUP non sono qui perché bisogna poterci scendere per arrivare alle OPTION, le cui etichette si leggono; DATALIST invece resta fuori: le sue voci finiscono dentro il campo.
  const TRANSLATE_SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'CANVAS',
    'IFRAME', 'OBJECT', 'EMBED', 'VIDEO', 'AUDIO', 'PRE', 'CODE', 'KBD',
    'SAMP', 'VAR', 'TEXTAREA', 'INPUT', 'OPTION',
    'DATALIST', 'HEAD', 'TITLE',
  ]);

  const HAS_LETTER = /\p{L}/u;

  // Testo che si legge sullo schermo ma sta negli ATTRIBUTI (#407): il grigio di un campo (`placeholder`), il suggerimento del mouse (`title`), la descrizione di un'immagine (`alt`), l'etichetta di una voce a tendina.
  // La riga di confine è netta: si traduce ciò che l'utente LEGGE, mai ciò che il sito RIMANDA INDIETRO. Quindi niente `value`, `href`, `src`, `name`, `id`, né voci di `datalist`, che finiscono nel campo come testo digitato.
  const TRANSLATABLE_ATTRS_ANY = ['title', 'aria-label'];
  const TRANSLATABLE_ATTRS_BY_TAG = {
    INPUT: ['placeholder', 'alt'],
    TEXTAREA: ['placeholder'],
    IMG: ['alt'],
    AREA: ['alt'],
    // Una voce a tendina si traduce SCRIVENDO `label`, mai sostituendone il testo: il testo di una <option> senza `value` è proprio ciò che il modulo invia.
    OPTION: ['label'],
    OPTGROUP: ['label'],
  };

  // Sui bottoni dei moduli (<input type="button|reset|submit">) la scritta che si legge è `value`, non il contenuto. Vale la stessa riga di confine, e fra gli input passa esattamente qui:
  // il valore di un bottone entra nei dati del modulo solo se il bottone ha un `name` ed è di quelli che inviano; uno che azzera o apre qualcosa non rimanda niente e la sua etichetta si traduce. `type="image"` resta fuori: lì la scritta visibile è `alt`, già tradotto.
  function inputValueIsLabel(el) {
    const type = String(el.getAttribute('type') || '').toLowerCase();
    if (type === 'button' || type === 'reset') return true;
    if (type !== 'submit') return false;
    return !el.hasAttribute('name');
  }

  // Valore di partenza di un attributo traducibile. Per l'etichetta di una
  // <option> che non ce l'ha, il testo che si legge è il suo contenuto.
  function attrSourceValue(el, attr, tag) {
    const v = el.getAttribute(attr);
    if (v !== null) return v;
    if (attr === 'label' && tag === 'OPTION') return el.textContent || '';
    return null;
  }

  // null quando non c'è nessun attributo da tradurre, il caso della stragrande maggioranza degli elementi: si esce subito.
  // `canMirror`: l'elemento è uno di quelli in cui SCENDIAMO, quindi il suo testo verrà tradotto. Serve a riconoscere l'ETICHETTA GEMELLA — il suggerimento uguale al testo del link, l'etichetta uguale alla scritta sul bottone: sono decine per pagina, si segnano `mirror` e si copiano invece di farle pagare due volte al modello.
  function attrTargetsOf(el, canMirror) {
    if (!el.getAttribute) return null;
    const tag = (el.tagName || '').toUpperCase();
    const extra = TRANSLATABLE_ATTRS_BY_TAG[tag];
    let names = extra ? TRANSLATABLE_ATTRS_ANY.concat(extra) : TRANSLATABLE_ATTRS_ANY;
    if (tag === 'INPUT' && inputValueIsLabel(el)) names = names.concat('value');
    const done = (el.dataset && el.dataset.snTranslatedAttrs) || '';
    let out = null;
    let visible;
    for (const attr of names) {
      if (done && done.split(',').indexOf(attr) >= 0) continue;
      const raw = attrSourceValue(el, attr, tag);
      if (raw === null) continue;
      const text = raw.replace(/\s+/g, ' ').trim();
      if (text.length < 2 || !HAS_LETTER.test(text)) continue;
      // `textContent` si paga solo quando un'etichetta c'è davvero: sulla
      // stragrande maggioranza degli elementi non si arriva fin qui.
      if (canMirror && visible === undefined) visible = visibleTextOf(el);
      const t = { el, attr, text };
      if (canMirror && text === visible) t.mirror = true;
      (out || (out = [])).push(t);
    }
    return out;
  }

  // Il testo che l'elemento MOSTRA, normalizzato come le etichette.
  function visibleTextOf(el) {
    try { return String(el.textContent || '').replace(/\s+/g, ' ').trim(); } catch (_) { return ''; }
  }

  // Solo il namespace HTML è «testo di pagina»: in SVG, MathML e ogni foreign content lo <style>, le <text> e le istruzioni interne romperebbero l'illustrazione o la formula se rimpiazzate.
  const HTML_NS = 'http://www.w3.org/1999/xhtml';

  // La UI che Filo inietta nella pagina (menu, avvisi, popup, sidebar) non è contenuto del sito e non va tradotta: la si riconosce dal MARCHIO che i moduli le mettono addosso (SN_FILO_UI.mark), mai dal nome.
  // Il nome lo sceglie anche il sito: bastava una classe che cominciasse per «sn-» — come le chiama ogni portale ServiceNow — perché un riquadro del sito restasse in lingua originale sotto un avviso che dichiarava la pagina tradotta (#407).
  function isFiloOwnUi(el) {
    const UI = global.SN_FILO_UI;
    return !!(UI && UI.is(el));
  }

  // Tre motivi diversi di saltare un sottoalbero, e la differenza conta. 'tag': qui dentro non c'è prosa (uno script, un video, un campo) — il contenuto non si tocca, ma le etichette che l'elemento espone si traducono lo stesso.
  // 'hard': non si tocca niente, nemmeno le etichette — testo scritto dall'utente, translate="no", la UI di Filo.
  // 'hidden': nascosto ADESSO ma non per sempre — non si traduce, però si segna (vedi isVisibilityHidden).
  function skipSubtreeForTranslation(el) {
    // Barriera 1, confronto INSENSIBILE al maiuscolo: dentro un SVG o MathML inline tagName è minuscolo ('svg', 'style', 'text'), e un confronto secco contro 'SVG' non farebbe mai presa.
    if (TRANSLATE_SKIP_TAGS.has((el.tagName || '').toUpperCase())) return 'tag';
    // Barriera 2, tutto ciò che sta fuori dal namespace HTML: ferma l'intero sottoalbero anche se un domani comparisse un tag radice non previsto nella lista sopra.
    if (el.namespaceURI && el.namespaceURI !== HTML_NS) return 'tag';
    const hard = hardSkipForTranslation(el);
    if (hard === 'hidden') return 'hidden';
    return hard ? 'hard' : false;
  }

  function hardSkipForTranslation(el) {
    if (el.isContentEditable) return true;                  // testo dell'utente
    if (el.getAttribute && el.getAttribute('translate') === 'no') return true;
    if (el.classList && el.classList.contains('notranslate')) return true;
    if (isFiloOwnUi(el)) return true;
    return isVisibilityHidden(el) ? 'hidden' : false;
  }

  // Nascosto in questo momento: una fisarmonica chiusa, la scheda non in primo piano, un «leggi tutto» ripiegato. Il testo è già nella pagina e l'utente lo scopre con un clic: per chi guarda lo schermo è come il testo che il sito aggiunge dopo (#407).
  // Non si traduce adesso, ma appena si vede il menu deve offrire di tradurlo, invece di lasciare come unica strada tornare all'originale e ripagare tutta la pagina.
  function isVisibilityHidden(el) {
    if (el.hasAttribute && el.hasAttribute('hidden')) return true;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return true;
    // La finestra dell'elemento, non la nostra: da quando la traduzione entra nei riquadri senza indirizzo (#407) qui arrivano elementi di un ALTRO documento, e la finestra sbagliata non risponde di loro.
    const cs = viewOf(el).getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse';
  }

  function viewOf(el) {
    try {
      const doc = el.ownerDocument;
      return (doc && doc.defaultView) || window;
    } catch (_) { return window; }
  }

  // Riquadro incorporato SENZA indirizzo proprio (`about:blank`, `srcdoc`), riempito da chi lo ospita: lì dentro il preload non entra, quindi non c'è nessun Filo a cui passare parola e il testo lo prende chi ospita, che è della stessa origine.
  // Un riquadro con un indirizzo vero non si apre da qui: ha il suo content script e traduce da sé, e leggerlo anche da fuori pagherebbe due volte lo stesso testo.
  function inlineFrameBody(el) {
    // Prima riga senza allocazioni: questa funzione la chiede anche chi cammina su tutti gli elementi della pagina, e lì un `toUpperCase()` a testa si sente.
    const tag = el && el.tagName;
    if (tag !== 'IFRAME' && tag !== 'FRAME' && tag !== 'iframe' && tag !== 'frame') return null;
    try {
      const win = el.contentWindow;
      if (!win || win.location.protocol !== 'about:') return null;
      const doc = el.contentDocument;
      return (doc && doc.body) || null;
    } catch (_) { return null; }   // altra origine: da qui non si legge
  }

  // È la domanda che si fa il menu del tasto destro, quindi deve costare poco: la lista è corta per costruzione (MAX_HIDDEN) e quasi tutti gli elementi escono alla prima riga.
  function hasRevealedText(list) {
    for (const el of (list || [])) {
      try {
        if (!el || !el.isConnected) continue;
        if (isVisibilityHidden(el)) continue;
        const txt = (el.textContent || '');
        if (!HAS_LETTER.test(txt)) continue;
        if (el.dataset && el.dataset.snTranslated) continue;
        return true;
      } catch (_) {}
    }
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

  // Un «componente chiuso» (#439): il sito costruisce un pezzo di pagina dentro uno shadow root in modalità closed, illeggibile da qualsiasi script della pagina, Filo compreso. Tradurlo non si può; ACCORGERSENE sì, e serve a tenere onesto l'avviso finale («tradotta solo in parte» invece di un lavoro monco dichiarato finito).
  // Riconoscerlo pretende PROVE, non prudenza: un avviso che scatta a vuoto manda a cercare del testo in lingua originale che non esiste, e brucia la credibilità dell'avviso quando è vero. Tre condizioni, tutte necessarie:
  // 1) il sito ha davvero REGISTRATO il componente (`:defined` è uno stato del DOM, e il DOM è lo stesso: scarta separatori e spaziatori col trattino nel nome, disegnati solo in CSS); 2) il rettangolo è grande abbastanza da starci del testo; 3) qualcosa è disegnato lì dentro e non lo raggiungiamo — il punto d'inserimento del cursore, che su un elemento vuoto cade sull'elemento e su un componente chiuso viene rimbalzato fuori.
  // La prova del punto si può fare solo dove il cursore arriva: dentro lo schermo, su un elemento che i clic non attraversano. Fuori di lì la risposta è «non lo so», che NON è «è un componente chiuso»: dove non si può guardare non si accusa, si tace.
  const CLOSED_MIN_W = 40;
  const CLOSED_MIN_H = 16;

  // 'self' = lì dentro non c'è niente · 'other' = c'è qualcosa che non
  // raggiungiamo · 'unknown' = non si può dire (fuori schermo, o coperto).
  function probePoint(el, x, y) {
    // Il punto deve colpire proprio lui: sotto un menu fisso o un riquadro
    // sovrapposto misureremmo l'elemento sbagliato.
    if (document.elementFromPoint(x, y) !== el) return 'unknown';
    const node = document.caretPositionFromPoint
      ? (document.caretPositionFromPoint(x, y) || {}).offsetNode
      : (document.caretRangeFromPoint ? (document.caretRangeFromPoint(x, y) || {}).startContainer : null);
    if (!node) return 'unknown';
    return node === el ? 'self' : 'other';
  }

  function paintedContentProbe(el, rect) {
    try {
      // Solo la parte che sta davvero sullo schermo: fuori dal riquadro visibile
      // non si può colpire niente, e la prova non si può fare.
      const x0 = Math.max(rect.left, 0);
      const x1 = Math.min(rect.right, window.innerWidth);
      const y0 = Math.max(rect.top, 0);
      const y1 = Math.min(rect.bottom, window.innerHeight);
      if (x1 - x0 < 2 || y1 - y0 < 2) return 'unknown';
      const w = x1 - x0;
      const h = y1 - y0;
      let seen = 'unknown';
      // Tre punti invece di uno: basta che UNO cada nel vuoto perché lì dentro non ci sia niente di nascosto, mentre un pezzo di UI sovrapposto o un bordo arrotondato rovinerebbero il punto singolo.
      // E tre righe invece di una, ma solo se la prima non ha risposto — una barra fissa che taglia l'elemento a metà lasciava «non lo so», che adesso vuol dire nessun avviso. Le righe in più non possono ribaltare una risposta certa: si fermano appena ne arriva una.
      for (const y of [y0 + h / 2, y0 + h * 0.25, y0 + h * 0.75]) {
        for (const x of [x0 + w / 2, x0 + w * 0.25, x0 + w * 0.75]) {
          const r = probePoint(el, x, y);
          if (r === 'self') return 'self';
          if (r === 'other') seen = 'other';
        }
        if (seen !== 'unknown') break;
      }
      return seen;
    } catch (_) { return 'unknown'; }
  }

  function isClosedComponent(el) {
    const tag = (el.tagName || '').toLowerCase();
    if (tag.indexOf('-') < 0) return false;
    // La prova del punto d'inserimento si fa sul documento della pagina: su un elemento dentro un riquadro incorporato misurerebbe coordinate sbagliate, e un avviso «una parte è rimasta fuori» che scatta a vuoto è peggio di nessun avviso.
    if (el.ownerDocument !== document) return false;
    if (el.shadowRoot) return false;                 // aperto: lo attraversiamo
    if (el.children.length) return false;            // ha contenuto raggiungibile
    if ((el.textContent || '').trim()) return false;
    try {
      if (el.matches && !el.matches(':defined')) return false;
      const r = el.getBoundingClientRect();
      if (r.width < CLOSED_MIN_W || r.height < CLOSED_MIN_H) return false;
      // Serve la PROVA che lì dentro ci sia qualcosa: 'unknown' vale quanto un no. Il prezzo è un componente chiuso sotto il bordo dello schermo che resta fuori dal conto, con l'avviso che dirà «Pagina tradotta» invece di «solo in parte».
      // Tacere su un pezzo che forse non esiste costa meno che mandare a cercare testo che non c'è: il primo è un avviso in meno, il secondo rende inutili tutti gli altri.
      return paintedContentProbe(el, r) === 'other';
    } catch (_) { return false; }
  }

  // Blocchi da tradurre, cercati anche DENTRO i componenti isolati dei siti moderni (#439): un TreeWalker si ferma al confine del componente, e titoli e paragrafi nello shadow root resterebbero in lingua originale mentre il resto della pagina cambia.
  // Il testo «in luce», passato dal sito al componente via <slot>, non si conta due volte: sta nell'albero normale e lo si incontra una volta sola, mentre nel componente c'è solo il segnaposto <slot>, che testo proprio non ne ha.
  // L'array porta anche `unreachable` (quanti componenti chiusi si sono incontrati) e `truncated` (quanti blocchi ci sono oltre il tetto di un giro): servono a chi scrive l'avviso finale, non alla traduzione — senza, una pagina enorme veniva dichiarata «tradotta» con la coda ancora in lingua originale (#407). Contare costa una camminata nel DOM, non richieste al modello.
  // Quanti sottoalberi nascosti tenere d'occhio: la lista serve al menu del tasto destro, che deve aprirsi subito. Una pagina con centinaia di sezioni ripiegate ne segna le prime: ne basta una per offrire «traduci quello nuovo».
  const MAX_HIDDEN = 200;

  function extractTranslatableBlocks({ maxBlocks = 2000 } = {}) {
    const root = document.body || document.documentElement;
    if (!root) return Object.assign([], { unreachable: 0, truncated: 0, attrs: [], mirrors: [], shadowRoots: [], frameDocs: [], hidden: [] });
    const out = [];
    // Gli alberi separati dei componenti aperti servono a chi sorveglia il testo che arriva DOPO: una MutationObserver sul documento non vede dentro un componente, e sui siti a componenti è proprio lì che il contenuto cambia.
    const shadowRoots = [];
    // Documenti dei riquadri senza indirizzo in cui siamo entrati (#407): come
    // gli alberi dei componenti aperti, vanno sorvegliati a parte.
    const frameDocs = [];
    // Etichette negli attributi (#407): stessa camminata, lista separata —
    // si applicano scrivendo l'attributo, non sostituendo i figli.
    const attrs = [];
    // Etichette GEMELLE del testo che l'elemento mostra già: si copiano dalla
    // traduzione di quel testo invece di ripagarle al modello.
    const mirrors = [];
    // Sottoalberi nascosti ADESSO (#407): non entrano nel lavoro, ma se
    // l'utente li scopre il menu deve offrire di tradurli.
    const hidden = [];
    let unreachable = 0;
    let truncated = 0;
    const room = () => out.length + attrs.length < maxBlocks;
    const takeAttrs = (el, checkHard) => {
      // `checkHard` distingue i due mondi anche per l'etichetta gemella: qui arrivano gli elementi in cui NON si scende (un campo, un'immagine, una voce a tendina), il cui testo non verrà tradotto — da lì non c'è niente da copiare.
      const targets = attrTargetsOf(el, !checkHard);
      if (!targets) return;
      // Le barriere dure (fra cui getComputedStyle) si pagano solo se un'etichetta c'è davvero: quasi tutti gli elementi saltati sono <script> o pezzi di SVG, e escono alla riga sopra.
      if (checkHard && hardSkipForTranslation(el)) return;
      for (const t of targets) {
        // Le gemelle non consumano il tetto del giro e non contano come
        // "rimasto fuori": non sono lavoro da spedire, sono una copia.
        if (t.mirror) { if (mirrors.length < maxBlocks) mirrors.push(t); continue; }
        if (room()) attrs.push(t);
        else truncated++;
      }
    };
    // Pila esplicita invece del TreeWalker: deve poter saltare da un albero
    // all'altro (pagina → componente) restando in ordine di lettura.
    const stack = [root];
    while (stack.length) {
      const el = stack.pop();
      // La radice non passa dal filtro: un <body translate="no"> o nascosto in partenza spegnerebbe la traduzione dell'intera pagina. Il filtro vale da lì in giù.
      const skip = el !== root && skipSubtreeForTranslation(el);
      if (skip) {
        // Sottoalbero senza prosa: il contenuto resta intoccato, ma le sue etichette si leggono sullo schermo e si traducono — salvo una barriera dura, che qui non è ancora stata controllata perché il tag l'ha preceduta.
        if (skip === 'tag') {
          takeAttrs(el, true);
          // Riquadro riempito dalla pagina stessa: lì dentro non c'è nessun Filo a cui passare parola, e il testo si legge da qui (#407). Nascosto o vietato dalle barriere dure resta fuori come gli altri.
          if (!hardSkipForTranslation(el)) {
            const inner = inlineFrameBody(el);
            if (inner) {
              stack.push(inner);
              // Anche qui il sito può aggiungere testo dopo: chi sorveglia la
              // pagina deve tenere d'occhio pure questo documento.
              if (frameDocs.length < 100) frameDocs.push(inner.ownerDocument);
            }
          }
        }
        // Ripiegato, in secondo piano, chiuso: si segna e si va avanti. Il
        // testo c'è già, l'utente non lo vede — tradurlo adesso vorrebbe dire
        // pagarlo per una sezione che magari non aprirà mai.
        else if (skip === 'hidden' && hidden.length < MAX_HIDDEN
                 && HAS_LETTER.test(el.textContent || '')) hidden.push(el);
        continue;
      }
      takeAttrs(el, false);
      // Già tradotto: si salta QUESTO elemento ma si scende lo stesso nei figli (#408), altrimenti i blocchi annidati che una traduzione interrotta a metà non ha toccato resterebbero irraggiungibili a qualsiasi ripresa.
      if (!(el.dataset && el.dataset.snTranslated)) {
        // Serve almeno una lettera: numeri, bullet e simboli non si traducono.
        const txt = ownTextOf(el);
        if (txt.length >= 2 && HAS_LETTER.test(txt)) {
          if (room()) out.push({ el, text: txt });
          else truncated++;
        }
      }
      const kids = [];
      const shadow = el.shadowRoot;
      if (shadow) {
        if (shadowRoots.length < 500) shadowRoots.push(shadow);
        for (const c of shadow.children) kids.push(c);
      } else if (isClosedComponent(el)) {
        unreachable++;
      }
      for (const c of el.children) kids.push(c);
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
    return Object.assign(out, { unreachable, truncated, attrs, mirrors, shadowRoots, frameDocs, hidden });
  }

  // Anche i componenti isolati: una querySelectorAll sul documento si ferma al loro confine e lascerebbe fuori, dal conteggio e dal ripristino, proprio i blocchi che #439 ha reso traducibili.
  function findTranslatedElements() {
    const out = [];
    // Le etichette tradotte non sono elementi da ripristinare come i blocchi, ma vanno CONTATE: altrimenti la ripresa dice «tradotti 10 su 12» su una pagina dove ne mancano davvero due.
    let attrCount = 0;
    const roots = [document];
    while (roots.length) {
      const r = roots.pop();
      let list;
      try { list = r.querySelectorAll('*'); } catch (_) { continue; }
      for (const el of list) {
        if (el.dataset && el.dataset.snTranslated) out.push(el);
        const done = el.dataset && el.dataset.snTranslatedAttrs;
        if (done) attrCount += done.split(',').filter(Boolean).length;
        if (el.shadowRoot) roots.push(el.shadowRoot);
        // Riquadri senza indirizzo: la traduzione ci entra, quindi anche il
        // conto dei pezzi già fatti e il ritorno all'originale devono entrarci.
        const inner = inlineFrameBody(el);
        if (inner && inner.ownerDocument) roots.push(inner.ownerDocument);
      }
    }
    return Object.assign(out, { attrCount });
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

  // Outline interattivo per l'agente «Aiuto»: una stringa compatta con gli elementi rilevanti (interattivi o landmark), il loro stato (visibile, fuori viewport, collassato), tag, testo e un selettore stabile.
  // L'agente vision riceve così lo screenshot della viewport più un quadro completo della pagina, anche fuori scroll o dentro <details> chiusi.

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

  // Selettore stabile, in ordine di preferenza: #id semplice e univoco, tag[aria-label], tag con name o data-testid univoci, infine un percorso :nth-of-type fino a 4 livelli.
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

  // Annotazioni per l'agente «Aiuto»: ⤤ hover = probabilmente apre un menu al passaggio del mouse (ci limitiamo all'attributo esplicito, i menu CSS non si rilevano in modo affidabile);
  // ⊕ reveal = l'agente può rivelarlo da solo, perché è un disclosure canonico (details chiuso, o [aria-expanded=false][aria-controls] non-form e non-link).
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
  // Euristica «apre un menu on-hover»: aria-haspopup esplicito (segnale forte), oppure un sibling o discendente che è un contenitore-menu (role=menu/listbox, classi *menu*/*dropdown*/*popover*/*flyout*) nascosto via CSS.
  // Così si prendono anche i menu :hover-driven senza ARIA, tipici di header e profilo.
  function hasHiddenMenuRelative(el) {
    if (!el) return false;
    const MENU_SEL = '[role="menu"],[role="listbox"],[class*="dropdown" i],[class*="menu" i],[class*="popover" i],[class*="flyout" i],[class*="submenu" i]';
    const candidates = [];
    try {
      const parent = el.parentElement;
      if (parent) {
        Array.from(parent.children).forEach((c) => { if (c !== el && c.matches?.(MENU_SEL)) candidates.push(c); });
      }
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
      if (isHiddenByCss(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        // Elementi 0×0 (voci di menu non aperto, sr-only) si tengono se hanno una label semantica: così l'agente li vede e può proporre un hover sul trigger.
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
    hasRevealedText,
    inlineFrameBody,
    isFiloOwnUi,
    pageMeta,
    pageExcerpt,
    extractInteractiveOutline,
    viewportInfo,
    expandAncestors,
    canRevealElement,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
