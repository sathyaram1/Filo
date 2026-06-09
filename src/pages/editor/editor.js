// Editor di Filo — prototipo.
// Pannello testo (contenteditable, serializzato in JSON compatibile ProseMirror)
// + griglia moduli configurabile (7 colonne × 10 righe) con workspace/pagine,
// drag-and-drop, salvataggio su localStorage nel formato di editor-spec.md.

(() => {
  'use strict';

  // La griglia è ridimensionabile dall'utente (impostazione nella vista moduli):
  // per questo COLS/ROWS sono variabili, non costanti. Il default resta 7×10.
  let GRID_COLS = 7;
  let GRID_ROWS = 10;
  const GRID_MIN_COLS = 3, GRID_MAX_COLS = 12;
  const GRID_MIN_ROWS = 4, GRID_MAX_ROWS = 16;
  const STORAGE_KEY = 'filo.editor.doc';
  const MSG = (window.SN_MSG && window.SN_MSG.MSG) || {};
  const ACTIONS = (window.SN_CONST && window.SN_CONST.ACTIONS) || {};
  const ICONS = window.SN_ICONS || {};

  // ── Riferimenti DOM ───────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const root = $('root');
  const docEl = $('doc');
  const saveStateEl = $('saveState');
  const gridEl = $('grid');
  const sidebarToggle = $('sidebarToggle');
  const settingsView = $('settingsView');
  const docWrap = $('docWrap');
  const paletteEl = $('palette');
  const overlay = $('overlay');
  const overlayBox = $('overlayBox');

  // ── Metadati tipi di modulo ───────────────────────────────────────────
  const MODULE_TYPES = {
    switch:           { label: 'Switch', icon: 'apps', defaultW: 2, defaultH: 1, minW: 2, minH: 1, desc: 'Cambia pagina/workspace della griglia.' },
    'word-count':     { label: 'Conteggio parole', icon: 'transcribe', defaultW: 1, defaultH: 1, minW: 1, minH: 1, desc: 'Numero di parole, aggiornato in tempo reale.' },
    'search-replace': { label: 'Cerca e sostituisci', icon: 'reload', defaultW: 2, defaultH: 2, minW: 2, minH: 2, desc: 'Trova ed evidenzia, sostituisci nel testo.' },
    comment:          { label: 'Commenta', icon: 'share', defaultW: 1, defaultH: 1, minW: 1, minH: 1, desc: 'Seleziona testo e aggiungi commenti.' },
    chat:             { label: 'Chat', icon: 'filoLogo', defaultW: 3, defaultH: 3, minW: 3, minH: 3, desc: 'Chat con LLM che vede il documento.' },
    // ── Moduli di formattazione (agiscono sul testo selezionato nell'editor) ──
    bold:             { label: 'Grassetto', glyph: '<b>B</b>', defaultW: 1, defaultH: 1, minW: 1, minH: 1, desc: 'Grassetto sul testo selezionato (Ctrl+B).' },
    italic:           { label: 'Corsivo', glyph: '<i>I</i>', defaultW: 1, defaultH: 1, minW: 1, minH: 1, desc: 'Corsivo sul testo selezionato (Ctrl+I).' },
    underline:        { label: 'Sottolineato', glyph: '<u>U</u>', defaultW: 1, defaultH: 1, minW: 1, minH: 1, desc: 'Sottolineato sul testo selezionato (Ctrl+U).' },
    undo:             { label: 'Indietro', icon: 'back', defaultW: 1, defaultH: 1, minW: 1, minH: 1, desc: 'Annulla l\'ultima modifica.' },
    redo:             { label: 'Avanti', icon: 'forward', defaultW: 1, defaultH: 1, minW: 1, minH: 1, desc: 'Ripeti la modifica annullata.' },
    'text-size':      { label: 'Dimensione testo', glyph: 'A±', defaultW: 2, defaultH: 1, minW: 2, minH: 1, desc: 'Aumenta o riduci la dimensione del testo selezionato.' },
    align:            { label: 'Allineamento', glyph: '≡', defaultW: 2, defaultH: 1, minW: 2, minH: 1, desc: 'Allinea il testo a sinistra, centro, destra o giustificato.' },
    font:             { label: 'Font', glyph: '<span style="font-family:Georgia,serif">F</span>', defaultW: 2, defaultH: 1, minW: 2, minH: 1, desc: 'Cambia il tipo di carattere del testo selezionato.' },
    // `fixed`: modulo di sistema. Non eliminabile, non aggiungibile dalla palette
    // e "appuntato" su tutte le pagine (visibile qualunque sia lo switch attivo).
    settings:         { label: 'Impostazioni', icon: 'options', defaultW: 1, defaultH: 1, minW: 1, minH: 1, desc: 'Apri/chiudi la modalità modifica moduli.', fixed: true },
  };

  // Un modulo è "fisso" (di sistema) se il suo tipo è marcato fixed.
  const isFixed = (m) => !!(m && MODULE_TYPES[m.type] && MODULE_TYPES[m.type].fixed);

  // Un modulo è "appuntato" su tutte le pagine se è fisso (impostazioni) OPPURE
  // se è lo switch: lo switch deve restare visibile e occupare la stessa cella su
  // OGNI pagina, così l'utente può sempre cambiare pagina e — modificandolo da una
  // qualunque vista — lo modifica per tutte (è un unico modulo condiviso).
  const isPinned = (m) => isFixed(m) || (!!m && m.type === 'switch');

  // Icone-preset per lo switch (estetiche, non vincolano i moduli).
  const SWITCH_PRESETS = {
    pen:  ICONS.editor,
    chat: ICONS.filoLogo,
    serif: null, // reso come "A" testuale
  };

  // ── Stato ─────────────────────────────────────────────────────────────
  let doc = null;        // documento corrente (vedi loadDoc/blankDoc)
  let dirty = false;
  let settingsMode = false;
  let commenting = false;
  let saveTimer = null;
  let uid = 0;
  const newId = (p) => `${p}-${Date.now().toString(36)}-${(uid++).toString(36)}`;

  // ════════════════════════════════════════════════════════════════════
  //  DOCUMENTO: modello & persistenza
  // ════════════════════════════════════════════════════════════════════

  function blankDoc() {
    const now = new Date().toISOString();
    return {
      meta: { title: 'Documento senza titolo', created: now, modified: now, version: 1 },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
      comments: [],
      modules: [
        mkModule('switch', 0, 6, 2, 1, 0, {
          activePage: 0,
          pages: [
            { z: 0, name: 'Scrittura', icon: 'pen' },
            { z: 1, name: 'Revisione', icon: 'serif' },
          ],
        }),
        mkModule('word-count', 0, 0, 1, 1, 0, { count: 'words' }),
        mkModule('search-replace', 0, 1, 2, 2, 1, {}),
        mkModule('comment', 2, 0, 1, 1, 1, {}),
        mkModule('chat', 0, 3, 3, 3, 1, {}),
        // Ingranaggio impostazioni: modulo fisso, angolo in basso a destra.
        mkModule('settings', GRID_COLS - 1, GRID_ROWS - 1, 1, 1, 0, {}),
      ],
    };
  }

  // Garantisce che esista sempre un (solo) modulo impostazioni fisso, anche per
  // documenti salvati prima della sua introduzione. Lo colloca nella prima cella
  // libera partendo dall'angolo in basso a destra.
  function ensureSettingsModule() {
    if (!doc || !Array.isArray(doc.modules)) return;
    const existing = doc.modules.filter((m) => m.type === 'settings');
    if (existing.length > 1) doc.modules = doc.modules.filter((m) => m.type !== 'settings').concat(existing[0]);
    if (existing.length >= 1) return;
    const z = activePage();
    for (let y = GRID_ROWS - 1; y >= 0; y--) {
      for (let x = GRID_COLS - 1; x >= 0; x--) {
        if (fits({ x, y, w: 1, h: 1 }, z)) {
          doc.modules.push(mkModule('settings', x, y, 1, 1, z, {}));
          return;
        }
      }
    }
    // Nessuna cella libera: forza l'angolo (verrà comunque renderizzato sopra).
    doc.modules.push(mkModule('settings', GRID_COLS - 1, GRID_ROWS - 1, 1, 1, z, {}));
  }

  function mkModule(type, x, y, w, h, z, data) {
    return { id: newId('mod'), type, x, y, w, h, z, data: data || {} };
  }

  // Converte rettangolo interno {x,y,w,h,z} ↔ cells[] del formato spec.
  function rectToCells(m) {
    const cells = [];
    for (let dy = 0; dy < m.h; dy++)
      for (let dx = 0; dx < m.w; dx++)
        cells.push({ x: m.x + dx, y: m.y + dy, z: m.z });
    return cells;
  }
  function cellsToRect(cells) {
    const xs = cells.map((c) => c.x), ys = cells.map((c) => c.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    return {
      x: minX, y: minY,
      w: Math.max(...xs) - minX + 1,
      h: Math.max(...ys) - minY + 1,
      z: cells[0] ? cells[0].z || 0 : 0,
    };
  }

  function serialize() {
    // Il titolo non è più editabile dall'UI: si conserva quello del modello.
    if (!doc.meta.title) doc.meta.title = 'Documento senza titolo';
    doc.meta.modified = new Date().toISOString();
    doc.content = htmlToPM(docEl);
    return {
      meta: doc.meta,
      content: doc.content,
      comments: doc.comments,
      modules: doc.modules.map((m) => ({
        id: m.id, type: m.type, cells: rectToCells(m), data: m.data,
      })),
    };
  }

  // Applica al modello la dimensione griglia salvata (clamp nei limiti). I doc
  // privi di `meta.grid` restano al default 7×10.
  function loadGridSize() {
    const g = doc && doc.meta && doc.meta.grid;
    if (g && Number.isFinite(g.cols) && Number.isFinite(g.rows)) {
      GRID_COLS = Math.max(GRID_MIN_COLS, Math.min(GRID_MAX_COLS, g.cols));
      GRID_ROWS = Math.max(GRID_MIN_ROWS, Math.min(GRID_MAX_ROWS, g.rows));
    }
  }

  function loadDoc() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (_) {}
    if (!raw || !raw.meta) { doc = blankDoc(); loadGridSize(); return; }
    doc = {
      meta: raw.meta,
      content: raw.content || { type: 'doc', content: [] },
      comments: Array.isArray(raw.comments) ? raw.comments : [],
      modules: (raw.modules || []).map((m) => {
        const rect = Array.isArray(m.cells) && m.cells.length ? cellsToRect(m.cells) : { x: 0, y: 0, w: 1, h: 1, z: 0 };
        return { id: m.id || newId('mod'), type: m.type, ...rect, data: m.data || {} };
      }),
    };
    loadGridSize();
  }

  function save(flash) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize()));
      dirty = false;
      saveStateEl.textContent = flash ? 'Salvato' : '';
      saveStateEl.classList.remove('dirty');
      if (flash) setTimeout(() => { if (!dirty) saveStateEl.textContent = ''; }, 1500);
    } catch (e) {
      saveStateEl.textContent = 'Errore';
      console.error('[Filo editor] save', e);
    }
  }
  function markDirty() {
    dirty = true;
    saveStateEl.textContent = 'Non salvato';
    saveStateEl.classList.add('dirty');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(false), 1200);
  }

  // ════════════════════════════════════════════════════════════════════
  //  EDITOR DI TESTO (contenteditable ↔ JSON ProseMirror)
  // ════════════════════════════════════════════════════════════════════

  const MARK_TAGS = { B: 'bold', STRONG: 'bold', I: 'italic', EM: 'italic', U: 'underline', S: 'strike', STRIKE: 'strike', DEL: 'strike' };

  // Le marche sono oggetti { type, attrs? }: i tag (B/I/U/S) producono marche
  // semplici; il font-size — applicato come stile inline su uno <span>/<font> —
  // diventa una marca con attrs.size così sopravvive al round-trip.
  function inlineToPM(parent, marks) {
    const out = [];
    parent.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.nodeValue) out.push({ type: 'text', text: node.nodeValue, ...(marks.length ? { marks: marks.map((m) => ({ type: m.type, ...(m.attrs ? { attrs: m.attrs } : {}) })) } : {}) });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node;
      if (el.classList && el.classList.contains('ed-collapse-toggle')) return;
      if (el.tagName === 'BR') { out.push({ type: 'hardBreak' }); return; }
      let next = marks;
      const extra = MARK_TAGS[el.tagName];
      if (extra && !next.some((m) => m.type === extra)) next = [...next, { type: extra }];
      const fs = el.style && el.style.fontSize;
      if (fs) next = [...next.filter((m) => m.type !== 'fontSize'), { type: 'fontSize', attrs: { size: fs } }];
      // Font: applicato come <span style="font-family:…"> (styleWithCSS) o, in
      // alcune build, come <font face="…">. Entrambi diventano una marca
      // fontFamily così sopravvivono al round-trip.
      const ff = (el.style && el.style.fontFamily) || (el.tagName === 'FONT' ? el.getAttribute('face') : '');
      if (ff) next = [...next.filter((m) => m.type !== 'fontFamily'), { type: 'fontFamily', attrs: { family: ff } }];
      out.push(...inlineToPM(el, next));
    });
    return out;
  }

  // Allineamento di un blocco: legge lo stile inline text-align (o l'attributo
  // align legacy). Ritorna '' se non impostato o non valido.
  function blockAlign(el) {
    let a = (el.style && el.style.textAlign) || (el.getAttribute && el.getAttribute('align')) || '';
    a = String(a).toLowerCase();
    return ['left', 'center', 'right', 'justify'].includes(a) ? a : '';
  }

  function htmlToPM(container) {
    const content = [];
    container.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.nodeValue && node.nodeValue.trim()) content.push({ type: 'paragraph', content: [{ type: 'text', text: node.nodeValue }] });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node;
      const tag = el.tagName;
      const align = blockAlign(el);
      if (/^H[1-3]$/.test(tag)) {
        const attrs = { level: Number(tag[1]) };
        if (align) attrs.align = align;
        content.push({ type: 'heading', attrs, content: inlineToPM(el, []) });
      } else if (tag === 'BLOCKQUOTE') {
        content.push({ type: 'blockquote', content: [{ type: 'paragraph', content: inlineToPM(el, []) }] });
      } else if (tag === 'UL' || tag === 'OL') {
        const items = [];
        el.querySelectorAll(':scope > li').forEach((li) => {
          items.push({ type: 'listItem', content: [{ type: 'paragraph', content: inlineToPM(li, []) }] });
        });
        content.push({ type: tag === 'UL' ? 'bulletList' : 'orderedList', content: items });
      } else if (tag === 'DIV' || tag === 'P') {
        content.push({ type: 'paragraph', ...(align ? { attrs: { align } } : {}), content: inlineToPM(el, []) });
      }
    });
    if (!content.length) content.push({ type: 'paragraph', content: [] });
    return { type: 'doc', content };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }
  function inlineToHtml(nodes) {
    if (!Array.isArray(nodes)) return '';
    return nodes.map((n) => {
      if (n.type === 'hardBreak') return '<br>';
      if (n.type !== 'text') return '';
      let html = escapeHtml(n.text);
      const marks = n.marks || [];
      const has = (t) => marks.some((m) => m.type === t);
      if (has('bold')) html = `<strong>${html}</strong>`;
      if (has('italic')) html = `<em>${html}</em>`;
      if (has('underline')) html = `<u>${html}</u>`;
      if (has('strike')) html = `<s>${html}</s>`;
      const fs = marks.find((m) => m.type === 'fontSize');
      if (fs && fs.attrs && fs.attrs.size) html = `<span style="font-size:${escapeHtml(fs.attrs.size)}">${html}</span>`;
      const ff = marks.find((m) => m.type === 'fontFamily');
      if (ff && ff.attrs && ff.attrs.family) html = `<span style="font-family:${escapeHtml(ff.attrs.family)}">${html}</span>`;
      return html;
    }).join('');
  }
  function pmToHtml(content) {
    if (!content || !Array.isArray(content.content)) return '<p></p>';
    return content.content.map((b) => {
      const inner = inlineToHtml(b.content) || '';
      const alignStyle = b.attrs?.align ? ` style="text-align:${b.attrs.align}"` : '';
      switch (b.type) {
        case 'heading': {
          const lvl = b.attrs?.level || 1;
          return `<h${lvl}${alignStyle}>${inner}</h${lvl}>`;
        }
        case 'blockquote': {
          const para = b.content && b.content[0] ? inlineToHtml(b.content[0].content) : '';
          return `<blockquote>${para}</blockquote>`;
        }
        case 'bulletList':
        case 'orderedList': {
          const tag = b.type === 'bulletList' ? 'ul' : 'ol';
          const lis = (b.content || []).map((li) => {
            const p = li.content && li.content[0] ? inlineToHtml(li.content[0].content) : '';
            return `<li>${p}</li>`;
          }).join('');
          return `<${tag}>${lis}</${tag}>`;
        }
        default: return `<p${alignStyle}>${inner}</p>`;
      }
    }).join('') || '<p></p>';
  }

  function renderDocBody() {
    docEl.innerHTML = pmToHtml(doc.content);
    // Documento vuoto → paragrafo con <br> così il caret ha dove posarsi.
    if (!docEl.firstChild || !docEl.textContent.trim()) docEl.innerHTML = '<p><br></p>';
    refreshCollapseToggles();
    applyCommentHighlights();
  }

  // Cliccare nello spazio vuoto del foglio (margini, area sotto il testo) deve
  // dare il focus all'editor e posare il caret in fondo: senza questo l'area
  // editabile coincide col solo testo e il "foglio" sembra non scrivibile.
  function focusDocAtEnd() {
    docEl.focus();
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(docEl);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  docWrap.addEventListener('mousedown', (e) => {
    if (e.target !== docWrap && e.target !== docEl) return;
    if (e.target === docEl && docEl.textContent.trim()) return;
    e.preventDefault();
    focusDocAtEnd();
  });

  // ── Formattazione ───────────────────────────────────────────────────
  function exec(cmd, val) {
    docEl.focus();
    document.execCommand(cmd, false, val);
    onDocInput();
  }
  // Variante che forza l'output in CSS inline (styleWithCSS). Serve per i comandi
  // che vogliamo serializzare in modo pulito: l'allineamento (style text-align sul
  // blocco) e la dimensione del testo (<span style="font-size:…">). Riportiamo
  // subito styleWithCSS a false così grassetto/corsivo continuano a usare i tag
  // <b>/<i> (che il serializzatore già conosce).
  function execCss(cmd, val) {
    docEl.focus();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(cmd, false, val);
    document.execCommand('styleWithCSS', false, false);
    onDocInput();
  }
  // Dimensione testo: indice 1..7 (3 = normale). A+/A− muovono l'indice e
  // applicano la dimensione corrispondente alla selezione corrente.
  let fontSizeIdx = 3;
  function stepFontSize(dir) {
    fontSizeIdx = Math.max(1, Math.min(7, fontSizeIdx + dir));
    execCss('fontSize', String(fontSizeIdx));
  }
  // SVG per le icone di allineamento: 4 righe la cui posizione comunica
  // sinistra/centro/destra/giustificato.
  function alignSvg(kind) {
    const rows = [[3, 12], [6, 8], [9, 12], [12, 8]];
    const lines = rows.map(([y, len]) => {
      let w = len, x = 2;
      if (kind === 'justify') { w = 12; x = 2; }
      else if (kind === 'right') x = 14 - len;
      else if (kind === 'center') x = (16 - len) / 2;
      return `<rect x="${x}" y="${y}" width="${w}" height="1.6" rx="0.8" fill="currentColor"/>`;
    }).join('');
    return `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">${lines}</svg>`;
  }
  // Bottone di un modulo di formattazione. Il mousedown con preventDefault è
  // intenzionale: tenere il default farebbe perdere la selezione/focus
  // dell'editor (cliccare un elemento esterno collassa la selezione), e il
  // comando di formattazione non agirebbe sul testo voluto. In modalità modifica
  // moduli lasciamo invece passare il click così si apre la configurazione.
  function fmtButton(label, title, onAct) {
    const b = document.createElement('button');
    b.className = 'ed-fmt-btn';
    b.type = 'button';
    b.innerHTML = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('mousedown', (e) => {
      if (settingsMode) return;
      e.preventDefault();
      e.stopPropagation();
      onAct();
    });
    b.addEventListener('click', (e) => { if (!settingsMode) e.stopPropagation(); });
    return b;
  }
  const SIMPLE_FORMATS = {
    bold:      { glyph: '<b>B</b>', title: 'Grassetto (Ctrl+B)', act: () => exec('bold') },
    italic:    { glyph: '<i>I</i>', title: 'Corsivo (Ctrl+I)', act: () => exec('italic') },
    underline: { glyph: '<u>U</u>', title: 'Sottolineato (Ctrl+U)', act: () => exec('underline') },
    undo:      { glyph: ICONS.back ? ICONS.back(16) : '↶', title: 'Indietro (annulla)', act: () => exec('undo') },
    redo:      { glyph: ICONS.forward ? ICONS.forward(16) : '↷', title: 'Avanti (ripeti)', act: () => exec('redo') },
  };
  function renderSimpleFormat(cell, m) {
    cell.classList.add('ed-fmt-mod');
    const pad = document.createElement('div');
    pad.className = 'ed-mod-pad ed-fmt';
    const cfg = SIMPLE_FORMATS[m.type];
    pad.appendChild(fmtButton(cfg.glyph, cfg.title, cfg.act));
    cell.appendChild(pad);
  }
  function renderTextSize(cell, _m) {
    cell.classList.add('ed-fmt-mod');
    const pad = document.createElement('div');
    pad.className = 'ed-mod-pad ed-fmt ed-fmt-row';
    const minus = fmtButton('A<small>−</small>', 'Riduci dimensione testo', () => stepFontSize(-1));
    const plus = fmtButton('A<big>+</big>', 'Aumenta dimensione testo', () => stepFontSize(1));
    minus.dataset.size = 'down';
    plus.dataset.size = 'up';
    pad.appendChild(minus);
    pad.appendChild(plus);
    cell.appendChild(pad);
  }
  function renderAlign(cell, _m) {
    cell.classList.add('ed-fmt-mod');
    const pad = document.createElement('div');
    pad.className = 'ed-mod-pad ed-fmt ed-fmt-row ed-align';
    const defs = [
      ['left', 'Allinea a sinistra', 'justifyLeft'],
      ['center', 'Allinea al centro', 'justifyCenter'],
      ['right', 'Allinea a destra', 'justifyRight'],
      ['justify', 'Giustifica', 'justifyFull'],
    ];
    for (const [kind, title, cmd] of defs) {
      const b = fmtButton(alignSvg(kind), title, () => execCss(cmd));
      b.dataset.align = kind;
      pad.appendChild(b);
    }
    cell.appendChild(pad);
  }

  // I controlli che aprono un menu nativo (es. il <select> del font) rubano il
  // focus all'editor e collassano la selezione: senza un preventDefault il
  // comando non saprebbe più su QUALE testo agire. Salviamo il range prima che
  // il menu si apra e lo ripristiniamo prima di applicare il comando.
  let savedDocRange = null;
  function saveDocSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && docEl.contains(sel.anchorNode)) savedDocRange = sel.getRangeAt(0).cloneRange();
  }
  function restoreDocSelection() {
    if (!savedDocRange) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedDocRange);
  }
  // ~30 famiglie comuni, buona varietà (serif, sans-serif, monospace, display,
  // corsivi). Garamond incluso. Ogni voce è uno stack con fallback sicuri così
  // l'applicazione regge anche dove il font esatto non è installato.
  const FONT_LIST = [
    ['Arial, Helvetica, sans-serif', 'Arial'],
    ['Helvetica, Arial, sans-serif', 'Helvetica'],
    ['Verdana, Geneva, sans-serif', 'Verdana'],
    ['Tahoma, Geneva, sans-serif', 'Tahoma'],
    ['"Trebuchet MS", Helvetica, sans-serif', 'Trebuchet MS'],
    ['Calibri, Candara, sans-serif', 'Calibri'],
    ['"Segoe UI", Tahoma, sans-serif', 'Segoe UI'],
    ['"Gill Sans", "Gill Sans MT", sans-serif', 'Gill Sans'],
    ['"Century Gothic", AppleGothic, sans-serif', 'Century Gothic'],
    ['"Franklin Gothic Medium", Arial, sans-serif', 'Franklin Gothic'],
    ['Futura, "Century Gothic", sans-serif', 'Futura'],
    ['Optima, "Segoe UI", sans-serif', 'Optima'],
    ['Candara, Calibri, sans-serif', 'Candara'],
    ['Corbel, "Lucida Grande", sans-serif', 'Corbel'],
    ['Georgia, serif', 'Georgia'],
    ['"Times New Roman", Times, serif', 'Times New Roman'],
    ['Garamond, "EB Garamond", "Apple Garamond", serif', 'Garamond'],
    ['"Palatino Linotype", Palatino, serif', 'Palatino'],
    ['"Book Antiqua", Palatino, serif', 'Book Antiqua'],
    ['Baskerville, "Baskerville Old Face", serif', 'Baskerville'],
    ['Cambria, Georgia, serif', 'Cambria'],
    ['Constantia, Georgia, serif', 'Constantia'],
    ['Didot, "Didot LT STD", "Times New Roman", serif', 'Didot'],
    ['"Bodoni MT", Didot, serif', 'Bodoni MT'],
    ['Rockwell, "Courier New", serif', 'Rockwell'],
    ['"Courier New", Courier, monospace', 'Courier New'],
    ['Consolas, "Lucida Console", monospace', 'Consolas'],
    ['"Lucida Console", Monaco, monospace', 'Lucida Console'],
    ['Monaco, Consolas, monospace', 'Monaco'],
    ['"Comic Sans MS", "Comic Sans", cursive', 'Comic Sans'],
    ['Impact, Charcoal, sans-serif', 'Impact'],
    ['"Brush Script MT", "Segoe Script", cursive', 'Brush Script'],
    ['"Lucida Handwriting", "Segoe Script", cursive', 'Lucida Handwriting'],
    ['Copperplate, "Copperplate Gothic Light", fantasy', 'Copperplate'],
  ];

  // Picker del font: dropdown custom (stile coerente con gli altri menu a
  // tendina di Filo, classi .sn-select-*) con campo di ricerca per filtrare i
  // font scrivendo. Sotto resta un <select> nativo NASCOSTO come sorgente di
  // verità: serve all'accessibilità e ai test (Playwright `selectOption`), e
  // applica il font tramite il suo handler `change` (condiviso con la UI custom).
  function renderFont(cell, m) {
    cell.classList.add('ed-fmt-mod');
    const pad = document.createElement('div');
    pad.className = 'ed-mod-pad ed-fmt ed-font';

    const wrap = document.createElement('div');
    wrap.className = 'sn-select-wrap ed-font-wrap';

    const sel = document.createElement('select');
    sel.className = 'ed-font-select';
    sel.title = 'Font del testo selezionato';
    sel.setAttribute('aria-label', 'Font del testo selezionato');
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = 'Font…';
    sel.appendChild(ph);
    for (const [val, label] of FONT_LIST) {
      const o = document.createElement('option');
      o.value = val; o.textContent = label;
      o.style.fontFamily = val;
      sel.appendChild(o);
    }
    wrap.appendChild(sel);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sn-select-button ed-font-button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', 'Font del testo selezionato');
    const valueEl = document.createElement('span');
    valueEl.className = 'sn-select-value';
    valueEl.textContent = 'Font…';
    const chevron = document.createElement('span');
    chevron.className = 'sn-select-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '▾';
    button.appendChild(valueEl);
    button.appendChild(chevron);
    wrap.appendChild(button);

    const pop = document.createElement('div');
    pop.className = 'sn-select-pop ed-font-pop';
    pop.setAttribute('role', 'listbox');
    pop.hidden = true;
    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'ed-font-search';
    search.placeholder = 'Cerca un font…';
    search.setAttribute('aria-label', 'Cerca un font');
    const list = document.createElement('div');
    list.className = 'ed-font-list';
    pop.appendChild(search);
    pop.appendChild(list);
    wrap.appendChild(pop);

    const optionEls = [];
    let hoverEl = null;
    const setHover = (o) => {
      if (hoverEl === o) return;
      if (hoverEl) hoverEl.classList.remove('sn-hover');
      hoverEl = o || null;
      if (hoverEl) { hoverEl.classList.add('sn-hover'); hoverEl.scrollIntoView({ block: 'nearest' }); }
    };
    for (const [val, label] of FONT_LIST) {
      const o = document.createElement('div');
      o.className = 'sn-select-option';
      o.setAttribute('role', 'option');
      o.dataset.value = val;
      o.textContent = label;
      o.style.fontFamily = val;
      o.addEventListener('mousemove', () => setHover(o));
      // Non rubare il focus/selezione del documento cliccando un'opzione.
      o.addEventListener('mousedown', (e) => e.preventDefault());
      o.addEventListener('click', () => choose(val));
      list.appendChild(o);
      optionEls.push(o);
    }
    const visibleOptions = () => optionEls.filter((o) => o.style.display !== 'none');
    const applyFilter = (q) => {
      const s = (q || '').trim().toLowerCase();
      for (const o of optionEls) {
        o.style.display = (!s || o.textContent.toLowerCase().includes(s)) ? '' : 'none';
      }
      const vis = visibleOptions();
      if (!vis.includes(hoverEl)) setHover(vis[0] || null);
    };
    const moveHover = (dir) => {
      const vis = visibleOptions();
      if (!vis.length) return;
      let i = vis.indexOf(hoverEl);
      i = (i + dir + vis.length) % vis.length;
      setHover(vis[i]);
    };

    function choose(val) {
      if (val) {
        sel.value = val;
        sel.dispatchEvent(new Event('change', { bubbles: true })); // → applica il font
      }
      close();
      button.focus();
    }
    const onDocDown = (e) => { if (!wrap.contains(e.target)) close(); };
    function placePop() {
      const r = button.getBoundingClientRect();
      pop.style.left = `${r.left}px`;
      pop.style.width = `${r.width}px`;
      // Sotto al bottone; se non c'è spazio in basso, ribalta sopra.
      const below = window.innerHeight - r.bottom;
      if (below < 200 && r.top > below) {
        pop.style.top = 'auto';
        pop.style.bottom = `${window.innerHeight - r.top + 4}px`;
      } else {
        pop.style.bottom = 'auto';
        pop.style.top = `${r.bottom + 4}px`;
      }
    }
    function open() {
      if (!pop.hidden) return;
      saveDocSelection(); // prima che il focus passi al popup
      pop.hidden = false;
      placePop();
      wrap.classList.add('sn-open');
      button.setAttribute('aria-expanded', 'true');
      search.value = '';
      applyFilter('');
      setHover(visibleOptions()[0] || null);
      document.addEventListener('mousedown', onDocDown, true);
      window.addEventListener('scroll', close, true);
      setTimeout(() => search.focus(), 0);
    }
    function close() {
      if (pop.hidden) return;
      pop.hidden = true;
      wrap.classList.remove('sn-open');
      button.setAttribute('aria-expanded', 'false');
      setHover(null);
      document.removeEventListener('mousedown', onDocDown, true);
      window.removeEventListener('scroll', close, true);
    }

    button.addEventListener('mousedown', (e) => {
      if (settingsMode) { e.preventDefault(); e.stopPropagation(); openModuleConfig(m); return; }
      saveDocSelection();
    });
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      if (settingsMode) return;
      pop.hidden ? open() : close();
    });
    search.addEventListener('input', () => applyFilter(search.value));
    search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveHover(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveHover(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (hoverEl) choose(hoverEl.dataset.value); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); button.focus(); }
    });

    // In modalità modifica moduli il click apre la configurazione (parità con gli
    // altri moduli); altrimenti salva la selezione prima che il menu la perda.
    sel.addEventListener('mousedown', (e) => {
      if (settingsMode) { e.preventDefault(); e.stopPropagation(); openModuleConfig(m); return; }
      saveDocSelection();
    });
    sel.addEventListener('change', (e) => {
      if (settingsMode) return;
      e.stopPropagation();
      const font = sel.value;
      sel.selectedIndex = 0; // torna al placeholder "Font…"
      valueEl.textContent = 'Font…';
      if (!font) return;
      restoreDocSelection();
      execCss('fontName', font);
    });

    pad.appendChild(wrap);
    cell.appendChild(pad);
  }

  // ── Shortcut markdown a livello blocco ──────────────────────────────
  function handleMarkdownBlock() {
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || !sel.anchorNode) return false;
    let block = sel.anchorNode;
    while (block && block !== docEl && !/^(P|DIV|H1|H2|H3|LI|BLOCKQUOTE)$/.test(block.tagName || '')) block = block.parentNode;
    if (!block || block === docEl) return false;
    const text = block.textContent;
    const map = [
      [/^#\s$/, () => exec('formatBlock', 'H1')],
      [/^##\s$/, () => exec('formatBlock', 'H2')],
      [/^###\s$/, () => exec('formatBlock', 'H3')],
      [/^>\s$/, () => exec('formatBlock', 'BLOCKQUOTE')],
      [/^[-*]\s$/, () => exec('insertUnorderedList')],
      [/^1\.\s$/, () => exec('insertOrderedList')],
    ];
    for (const [re, fn] of map) {
      if (re.test(text)) {
        block.textContent = '';
        fn();
        return true;
      }
    }
    return false;
  }

  // ── Titoli collassabili ──────────────────────────────────────────────
  function headingLevel(el) {
    return /^H([1-3])$/.test(el.tagName) ? Number(el.tagName[1]) : 0;
  }
  function refreshCollapseToggles() {
    docEl.querySelectorAll('.ed-collapse-toggle').forEach((b) => b.remove());
    docEl.querySelectorAll('h1, h2, h3').forEach((h) => {
      const btn = document.createElement('button');
      btn.className = 'ed-collapse-toggle';
      btn.contentEditable = 'false';
      btn.innerHTML = ICONS.caretDown ? ICONS.caretDown(14) : '▾';
      btn.addEventListener('click', (e) => { e.preventDefault(); toggleCollapse(h, btn); });
      h.insertBefore(btn, h.firstChild);
    });
  }
  function toggleCollapse(h, btn) {
    const lvl = headingLevel(h);
    const collapsing = !btn.classList.contains('is-collapsed');
    btn.classList.toggle('is-collapsed', collapsing);
    let sib = h.nextElementSibling;
    while (sib) {
      const sl = headingLevel(sib);
      if (sl > 0 && sl <= lvl) break;
      sib.classList.toggle('ed-hidden-by-collapse', collapsing);
      sib = sib.nextElementSibling;
    }
  }

  function onDocInput() {
    refreshCollapseToggles();
    markDirty();
    updateWordCountModules();
  }

  docEl.addEventListener('input', () => {
    // markdown block shortcut (dopo lo spazio)
    handleMarkdownBlock();
    onDocInput();
  });
  docEl.addEventListener('keydown', (e) => {
    const meta = e.ctrlKey || e.metaKey;
    if (!meta) return;
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); exec('bold'); }
    else if (k === 'i') { e.preventDefault(); exec('italic'); }
    else if (k === 'u') { e.preventDefault(); exec('underline'); }
  });

  // ── Incolla come testo semplice ─────────────────────────────────────
  // Di default il foglio è un documento "pulito": incollare da una pagina web
  // portava dietro sfondi/colori/font della sorgente (la lamentela: il testo
  // incollato aveva uno sfondo colorato). Intercettiamo il paste e inseriamo
  // solo il testo. `insertText` passa per il normale stack di undo e dispatcha
  // un input event, così onDocInput()/markDirty() partono da soli.
  docEl.addEventListener('paste', (e) => {
    const cd = e.clipboardData || window.clipboardData;
    if (!cd) return;
    // Se negli appunti c'è un'immagine (nessun testo), lascia il default:
    // non vogliamo bloccare l'incolla di immagini.
    const text = cd.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    document.execCommand('insertText', false, text);
  });

  // ── Zoom del foglio ─────────────────────────────────────────────────
  // Pinch sul trackpad e Ctrl+rotella generano wheel events con ctrlKey=true;
  // da tastiera Ctrl+= / Ctrl+- / Ctrl+0. Lo zoom scala l'intero documento
  // (testo e immagini) via la proprietà CSS `zoom`, senza toccare il modello
  // salvato. (Vedi handleZoomKey() nel keydown globale per le scorciatoie.)
  const ZOOM_MIN = 0.5, ZOOM_MAX = 3;
  let zoomLevel = 1;
  function applyZoom() {
    zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(zoomLevel * 100) / 100));
    docEl.style.zoom = zoomLevel === 1 ? '' : String(zoomLevel);
  }
  function handleZoomKey(e) {
    const k = e.key;
    if (k === '+' || k === '=') { e.preventDefault(); zoomLevel += 0.1; applyZoom(); return true; }
    if (k === '-' || k === '_') { e.preventDefault(); zoomLevel -= 0.1; applyZoom(); return true; }
    if (k === '0') { e.preventDefault(); zoomLevel = 1; applyZoom(); return true; }
    return false;
  }
  docWrap.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    // deltaY<0 (pinch-out / scroll su) → ingrandisci. Passo proporzionale al
    // delta così il pinch del trackpad (incrementi piccoli) resta fluido.
    e.preventDefault();
    zoomLevel *= Math.exp(-e.deltaY * 0.0015);
    applyZoom();
  }, { passive: false });

  // ════════════════════════════════════════════════════════════════════
  //  GRIGLIA & MODULI
  // ════════════════════════════════════════════════════════════════════

  function getSwitch() { return doc.modules.find((m) => m.type === 'switch') || null; }
  function getPages() {
    const sw = getSwitch();
    if (sw && Array.isArray(sw.data.pages) && sw.data.pages.length) return sw.data.pages;
    return [{ z: 0, name: 'Pagina 1', icon: '1' }];
  }
  function activePage() {
    const sw = getSwitch();
    return sw ? (sw.data.activePage || 0) : 0;
  }
  function setActivePage(z) {
    const sw = getSwitch();
    if (sw) sw.data.activePage = z;
    renderGrid();
    markDirty();
  }

  function moduleAt(x, y, z) {
    return doc.modules.find((m) => m.z === z && x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h) || null;
  }
  function fits(rect, z, ignoreId) {
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > GRID_COLS || rect.y + rect.h > GRID_ROWS) return false;
    for (const m of doc.modules) {
      if (m.id === ignoreId) continue;
      // I moduli appuntati (impostazioni, switch) vivono su tutte le pagine:
      // la loro cella va riservata su qualunque z.
      if (m.z !== z && !isPinned(m)) continue;
      const overlap = rect.x < m.x + m.w && rect.x + rect.w > m.x && rect.y < m.y + m.h && rect.y + rect.h > m.y;
      if (overlap) return false;
    }
    return true;
  }
  // Verifica che un rettangolo entri su TUTTE le pagine esistenti. Serve per i
  // moduli appuntati (lo switch): per spostarli o allargarli deve esserci spazio
  // su ogni pagina, non solo su quella attiva.
  function fitsAllPages(rect, ignoreId) {
    for (const p of getPages()) {
      if (!fits(rect, p.z, ignoreId)) return false;
    }
    return true;
  }
  // Sceglie il controllo di collisione giusto per il modulo: i moduli appuntati
  // devono entrare su tutte le pagine, gli altri solo sulla pagina indicata.
  function fitsFor(m, rect, z) {
    return isPinned(m) ? fitsAllPages(rect, m.id) : fits(rect, z, m.id);
  }

  // La griglia CSS ha 7×10 come default nel CSS; quando l'utente cambia la
  // dimensione applichiamo i template inline così la griglia segue il modello.
  function applyGridTemplate() {
    gridEl.style.gridTemplateColumns = `repeat(${GRID_COLS}, 1fr)`;
    gridEl.style.gridTemplateRows = `repeat(${GRID_ROWS}, 1fr)`;
  }

  // Cambia la dimensione della griglia (clamp nei limiti). I moduli che
  // finirebbero fuori dai nuovi confini vengono riportati dentro (clamp di
  // posizione/dimensione) così non spariscono.
  function setGridSize(cols, rows) {
    cols = Math.max(GRID_MIN_COLS, Math.min(GRID_MAX_COLS, Math.round(cols)));
    rows = Math.max(GRID_MIN_ROWS, Math.min(GRID_MAX_ROWS, Math.round(rows)));
    if (cols === GRID_COLS && rows === GRID_ROWS) return;
    GRID_COLS = cols;
    GRID_ROWS = rows;
    for (const m of doc.modules) {
      if (m.w > GRID_COLS) m.w = GRID_COLS;
      if (m.h > GRID_ROWS) m.h = GRID_ROWS;
      if (m.x + m.w > GRID_COLS) m.x = Math.max(0, GRID_COLS - m.w);
      if (m.y + m.h > GRID_ROWS) m.y = Math.max(0, GRID_ROWS - m.h);
    }
    if (!doc.meta) doc.meta = {};
    doc.meta.grid = { cols: GRID_COLS, rows: GRID_ROWS };
    applyGridTemplate();
    renderGrid();
    renderGridControls();
    markDirty();
  }

  // Controllo "Dimensione griglia" mostrato nella vista moduli, sopra la palette.
  function renderGridControls() {
    const host = $('gridSize');
    if (!host) return;
    host.innerHTML = `
      <div class="ed-gs-title">Dimensione griglia</div>
      <div class="ed-gs-row">
        <span class="ed-gs-cap">Colonne</span>
        <button class="ed-gs-btn" data-gs="cols-" aria-label="Meno colonne">−</button>
        <span class="ed-gs-val" id="gsCols">${GRID_COLS}</span>
        <button class="ed-gs-btn" data-gs="cols+" aria-label="Più colonne">+</button>
        <span class="ed-gs-sep"></span>
        <span class="ed-gs-cap">Righe</span>
        <button class="ed-gs-btn" data-gs="rows-" aria-label="Meno righe">−</button>
        <span class="ed-gs-val" id="gsRows">${GRID_ROWS}</span>
        <button class="ed-gs-btn" data-gs="rows+" aria-label="Più righe">+</button>
      </div>`;
    const on = (sel, fn) => { const b = host.querySelector(sel); if (b) b.addEventListener('click', fn); };
    on('[data-gs="cols-"]', () => setGridSize(GRID_COLS - 1, GRID_ROWS));
    on('[data-gs="cols+"]', () => setGridSize(GRID_COLS + 1, GRID_ROWS));
    on('[data-gs="rows-"]', () => setGridSize(GRID_COLS, GRID_ROWS - 1));
    on('[data-gs="rows+"]', () => setGridSize(GRID_COLS, GRID_ROWS + 1));
  }

  function renderGrid() {
    const z = activePage();
    applyGridTemplate();
    gridEl.innerHTML = '';

    const occupied = new Set();
    // Moduli della pagina corrente + moduli appuntati (impostazioni e switch,
    // visibili su ogni pagina).
    const onPage = doc.modules.filter((m) => (m.z === z && !isPinned(m)) || isPinned(m));
    for (const m of onPage) {
      const cell = document.createElement('div');
      cell.className = 'ed-module';
      cell.dataset.type = m.type;
      cell.dataset.id = m.id;
      cell.style.gridColumn = `${m.x + 1} / span ${m.w}`;
      cell.style.gridRow = `${m.y + 1} / span ${m.h}`;
      renderModuleBody(cell, m);
      attachModuleDrag(cell, m);
      if (!isFixed(m)) attachModuleResize(cell, m);
      cell.addEventListener('click', (e) => {
        // I moduli fissi gestiscono il click internamente (es. ingranaggio →
        // toggle modalità modifica); non aprono il pannello di configurazione.
        if (settingsMode && !isFixed(m)) { e.stopPropagation(); openModuleConfig(m); }
      });
      gridEl.appendChild(cell);
      for (let dy = 0; dy < m.h; dy++) for (let dx = 0; dx < m.w; dx++) occupied.add(`${m.x + dx},${m.y + dy}`);
    }
    // celle vuote
    for (let y = 0; y < GRID_ROWS; y++) {
      for (let x = 0; x < GRID_COLS; x++) {
        if (occupied.has(`${x},${y}`)) continue;
        const empty = document.createElement('div');
        empty.className = 'ed-cell-empty';
        empty.style.gridColumn = `${x + 1}`;
        empty.style.gridRow = `${y + 1}`;
        empty.innerHTML = ICONS.plus ? ICONS.plus(16) : '+';
        empty.addEventListener('click', () => openAddModule(x, y, z));
        attachCellDrop(empty, x, y, z);
        gridEl.appendChild(empty);
      }
    }
  }

  // ── Drag & drop ──────────────────────────────────────────────────────
  // Trascinamento moduli: pointer-based (mousedown sull'handle ⠿). Più
  // affidabile e scopribile del drag&drop nativo HTML5 (che non dava feedback di
  // cursore e falliva silenziosamente), e mantiene selezionabile il testo dei
  // moduli chat perché il drag parte SOLO dall'handle. Mentre trascini, il
  // cursore diventa una "mano che afferra" (classe .ed-dragging in editor.css).
  function attachModuleDrag(cell, m) {
    if (isFixed(m)) return; // moduli fissi (es. ingranaggio): non si spostano
    const handle = cell.querySelector('.ed-mod-drag');
    if (handle) {
      // Dall'handle ⠿ il drag parte subito (scorciatoia sempre disponibile).
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startModuleDrag(cell, m);
      });
    }

    // Drag da QUALSIASI punto del modulo "tenendo premuto" (feedback alpha:
    // afferrare il modulo da ovunque, non solo dalla maniglia). Per non rubare i
    // click sui controlli né la selezione del testo, il drag si "arma" solo se il
    // pulsante resta premuto ~220ms restando fermo: un click rapido o un
    // trascinamento immediato (selezione testo) annullano l'arming.
    cell.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      // I controlli interattivi e la maniglia/resize gestiscono già il proprio
      // mousedown: lì un long-press non deve trasformarsi in drag.
      if (e.target.closest('.ed-mod-drag, .ed-mod-resize, .ed-mod-resize-h, button, input, textarea, select, a, [contenteditable="true"]')) return;
      const startX = e.clientX, startY = e.clientY;
      const HOLD_MS = 220, MOVE_TOL = 6;
      let timer = 0;
      const cleanup = () => {
        clearTimeout(timer);
        document.removeEventListener('mousemove', onPreMove, true);
        document.removeEventListener('mouseup', onPreUp, true);
        cell.classList.remove('ed-arming');
      };
      const onPreMove = (ev) => {
        // Movimento prima dell'arming = interazione normale (selezione/scroll):
        // lascia perdere il drag.
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > MOVE_TOL) cleanup();
      };
      const onPreUp = () => cleanup();
      timer = setTimeout(() => {
        cleanup();
        window.getSelection && window.getSelection().removeAllRanges();
        startModuleDrag(cell, m);
      }, HOLD_MS);
      cell.classList.add('ed-arming');
      document.addEventListener('mousemove', onPreMove, true);
      document.addEventListener('mouseup', onPreUp, true);
    });
  }

  function startModuleDrag(cell, m) {
    const z = activePage();
    cell.classList.add('dragging');
    document.body.classList.add('ed-dragging');
    let target = null;     // {x, y} cella valida sotto il puntatore
    let targetEl = null;   // elemento .ed-cell-empty evidenziato
    // Anteprima fantasma: un riquadro a opacità ridotta che occupa l'intera
    // impronta (w×h) del modulo nella posizione dove finirà al rilascio, così
    // l'utente vede dove atterrerà mentre trascina.
    let ghost = null;
    const meta = MODULE_TYPES[m.type] || {};
    const ghostLabel = meta.glyph || (ICONS[meta.icon] ? ICONS[meta.icon](20) : escapeHtml(meta.label || ''));
    const showGhost = (x, y) => {
      if (!ghost) {
        ghost = document.createElement('div');
        ghost.className = 'ed-drag-ghost';
        ghost.innerHTML = `<span>${ghostLabel}</span>`;
        gridEl.appendChild(ghost);
      }
      ghost.style.gridColumn = `${x + 1} / span ${m.w}`;
      ghost.style.gridRow = `${y + 1} / span ${m.h}`;
      ghost.style.display = '';
    };
    const hideGhost = () => { if (ghost) ghost.style.display = 'none'; };
    const removeGhost = () => { if (ghost) { ghost.remove(); ghost = null; } };
    const clearHighlight = () => {
      if (targetEl) { targetEl.classList.remove('drop-target'); targetEl = null; }
    };
    const onMove = (ev) => {
      // La cella in drag ha pointer-events:none, così elementFromPoint vede la
      // cella vuota sottostante.
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const empty = el && el.closest ? el.closest('.ed-cell-empty') : null;
      clearHighlight();
      target = null;
      if (empty && gridEl.contains(empty)) {
        const x = parseInt(empty.style.gridColumnStart || empty.style.gridColumn, 10) - 1;
        const y = parseInt(empty.style.gridRowStart || empty.style.gridRow, 10) - 1;
        if (Number.isFinite(x) && Number.isFinite(y) && fitsFor(m, { x, y, w: m.w, h: m.h }, z)) {
          empty.classList.add('drop-target');
          targetEl = empty;
          target = { x, y };
          showGhost(x, y);
        } else {
          hideGhost();
        }
      } else {
        hideGhost();
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      document.body.classList.remove('ed-dragging');
      cell.classList.remove('dragging');
      clearHighlight();
      removeGhost();
      if (target) { m.x = target.x; m.y = target.y; m.z = z; renderGrid(); markDirty(); }
    };
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
  }
  function attachCellDrop(empty, x, y, z) {
    empty.addEventListener('dragover', (e) => { e.preventDefault(); empty.classList.add('drop-target'); });
    empty.addEventListener('dragleave', () => empty.classList.remove('drop-target'));
    empty.addEventListener('drop', (e) => {
      e.preventDefault();
      empty.classList.remove('drop-target');
      let payload;
      try { payload = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (_) { return; }
      if (payload.move) {
        const m = doc.modules.find((mm) => mm.id === payload.move);
        if (!m) return;
        const target = { x, y, w: m.w, h: m.h };
        if (fitsFor(m, target, z)) { m.x = x; m.y = y; m.z = z; renderGrid(); markDirty(); }
      } else if (payload.add) {
        addModule(payload.add, x, y, z);
      }
    });
  }

  function addModule(type, x, y, z) {
    const meta = MODULE_TYPES[type];
    if (!meta || meta.fixed) return;
    let w = meta.defaultW, h = meta.defaultH;
    // riduci se non entra
    while (w > meta.minW && !fits({ x, y, w, h }, z)) w--;
    while (h > meta.minH && !fits({ x, y, w, h }, z)) h--;
    if (!fits({ x, y, w, h }, z)) { flashOverlayMsg('Spazio insufficiente per questo modulo.'); return; }
    const data = type === 'switch'
      ? { activePage: 0, pages: [{ z: 0, name: 'Pagina 1', icon: '1' }, { z: 1, name: 'Pagina 2', icon: '2' }] }
      : (type === 'word-count' ? { count: 'words' } : {});
    doc.modules.push(mkModule(type, x, y, w, h, z, data));
    renderGrid();
    markDirty();
  }

  function openAddModule(x, y, z) {
    const items = Object.entries(MODULE_TYPES).filter(([, meta]) => !meta.fixed).map(([type, meta]) => `
      <button class="ed-btn" data-add="${type}" style="display:flex;justify-content:flex-start;gap:10px;width:100%;margin-bottom:6px">
        <span style="color:var(--sn-accent);display:inline-flex">${meta.glyph || (ICONS[meta.icon] ? ICONS[meta.icon](18) : '')}</span>
        <span>${meta.label} <span style="color:var(--sn-muted);font-size:11px">${meta.defaultW}×${meta.defaultH}</span></span>
      </button>`).join('');
    openOverlay(`<h3>Aggiungi modulo</h3>${items}`);
    overlayBox.querySelectorAll('[data-add]').forEach((b) => {
      b.addEventListener('click', () => { closeOverlay(); addModule(b.dataset.add, x, y, z); });
    });
  }

  // ── Render contenuto moduli ───────────────────────────────────────────
  function renderModuleBody(cell, m) {
    const handle = document.createElement('span');
    handle.className = 'ed-mod-drag';
    handle.textContent = '⠿';
    cell.appendChild(handle);
    switch (m.type) {
      case 'switch': return renderSwitch(cell, m);
      case 'word-count': return renderWordCount(cell, m);
      case 'search-replace': return renderSearchReplace(cell, m);
      case 'comment': return renderCommentModule(cell, m);
      case 'chat': return renderChat(cell, m);
      case 'settings': return renderSettingsModule(cell, m);
      case 'bold':
      case 'italic':
      case 'underline':
      case 'undo':
      case 'redo': return renderSimpleFormat(cell, m);
      case 'text-size': return renderTextSize(cell, m);
      case 'align': return renderAlign(cell, m);
      case 'font': return renderFont(cell, m);
    }
  }

  // ── Modulo: impostazioni (ingranaggio, fisso) ──────────────────────────
  function renderSettingsModule(cell, _m) {
    cell.classList.add('ed-settings-mod');
    cell.title = 'Impostazioni moduli';
    cell.innerHTML = (ICONS.options ? ICONS.options(18) : '⚙');
    // Click sull'ingranaggio: apre/chiude la modalità modifica moduli. Va in
    // capture/stopPropagation così non scatta il click generico della cella.
    cell.addEventListener('click', (e) => { e.stopPropagation(); toggleSettingsMode(); });
  }

  // ── Modulo: switch / workspace ─────────────────────────────────────────
  function renderSwitch(cell, m) {
    cell.classList.add('ed-switch');
    const pages = m.data.pages || [];
    const left = document.createElement('div');
    left.className = 'ed-switch-arrow' + (pages.length <= (MODULE_TYPES.switch.minW) ? ' disabled' : '');
    left.textContent = '‹';
    left.title = 'Rimuovi pagina';
    left.addEventListener('click', (e) => { e.stopPropagation(); shrinkSwitch(m); });

    const right = document.createElement('div');
    right.className = 'ed-switch-arrow' + (pages.length >= 4 ? ' disabled' : '');
    right.textContent = '›';
    right.title = 'Aggiungi pagina';
    right.addEventListener('click', (e) => { e.stopPropagation(); growSwitch(m); });

    const icons = document.createElement('div');
    icons.className = 'ed-switch-icons';
    pages.forEach((p, idx) => {
      const ic = document.createElement('div');
      ic.className = 'ed-switch-icon' + ((m.data.activePage || 0) === p.z ? ' active' : '');
      ic.title = p.name;
      ic.innerHTML = switchIconHtml(p.icon, idx);
      ic.addEventListener('click', (e) => { if (!settingsMode) { e.stopPropagation(); setActivePage(p.z); } });
      icons.appendChild(ic);
    });
    cell.appendChild(left);
    cell.appendChild(icons);
    cell.appendChild(right);
  }
  function switchIconHtml(icon, idx) {
    if (icon === 'pen' && ICONS.editor) return ICONS.editor(16);
    if (icon === 'chat' && ICONS.filoLogo) return ICONS.filoLogo(16);
    if (icon === 'serif') return '<span style="font-family:Georgia,serif;font-size:15px">A</span>';
    return escapeHtml(icon || String(idx + 1));
  }
  const MAX_PAGES = 4;

  // La larghezza dello switch (in colonne) È il numero di pagine: 2 colonne → 2
  // pagine, 3 → 3, ecc. Allargare crea pagine, rimpicciolire ne elimina.

  // Una pagina è "vuota" se non contiene moduli oltre a quelli appuntati (lo
  // switch stesso e l'ingranaggio impostazioni, presenti su ogni pagina).
  function pageHasModules(z, switchId) {
    return doc.modules.some((mm) => mm.id !== switchId && !isPinned(mm) && mm.z === z);
  }

  // Aggiunge UNA pagina allargando lo switch di una colonna. Ritorna true se è
  // riuscita; se non c'è spazio su tutte le pagine (o si è al massimo) mostra un
  // toast discreto in basso a destra e ritorna false senza modificare nulla.
  function growSwitch(m) {
    const pages = m.data.pages;
    if (pages.length >= MAX_PAGES) {
      showEditorToast(`Lo switch può avere al massimo ${MAX_PAGES} pagine.`);
      return false;
    }
    const newW = pages.length + 1;
    if (m.x + newW > GRID_COLS || !fitsAllPages({ x: m.x, y: m.y, w: newW, h: m.h }, m.id)) {
      showEditorToast('Spazio insufficiente in tutte le pagine: lo switch non può allargarsi.');
      return false;
    }
    const usedZ = pages.map((p) => p.z);
    let z = 0; while (usedZ.includes(z)) z++;
    pages.push({ z, name: `Pagina ${pages.length + 1}`, icon: String(pages.length + 1) });
    m.w = newW;
    renderGrid();
    markDirty();
    return true;
  }

  // Rimpicciolire lo switch = eliminare una pagina. Apre un box che avverte e fa
  // scegliere QUALE pagina eliminare (le pagine con moduli vanno svuotate prima).
  function shrinkSwitch(m) {
    if (m.data.pages.length <= MODULE_TYPES.switch.minW) {
      showEditorToast(`Lo switch deve avere almeno ${MODULE_TYPES.switch.minW} pagine.`);
      return;
    }
    openDeletePageDialog(m);
  }

  // Elimina la pagina con z = `z` (se vuota) e accorcia lo switch di una colonna.
  function deletePage(m, z) {
    const pages = m.data.pages;
    if (pages.length <= MODULE_TYPES.switch.minW) return false;
    const idx = pages.findIndex((p) => p.z === z);
    if (idx < 0) return false;
    if (pageHasModules(z, m.id)) {
      showEditorToast('La pagina contiene moduli: spostali o eliminali prima.');
      return false;
    }
    pages.splice(idx, 1);
    if ((m.data.activePage || 0) === z) m.data.activePage = pages[0].z;
    m.w = Math.max(MODULE_TYPES.switch.minW, pages.length);
    renderGrid();
    markDirty();
    return true;
  }

  function openDeletePageDialog(m) {
    const pages = m.data.pages;
    const rows = pages.map((p, idx) => {
      const occupied = pageHasModules(p.z, m.id);
      const name = escapeHtml(p.name || `Pagina ${idx + 1}`);
      return `<div class="ed-stat-row">
        <span>${name}${occupied ? ' <em style="color:var(--sn-muted);font-style:normal">· contiene moduli</em>' : ''}</span>
        <button class="ed-btn danger" data-del-z="${p.z}"${occupied ? ' disabled title="Svuota la pagina prima"' : ''}>Elimina</button>
      </div>`;
    }).join('');
    openOverlay(`<h3>Rimpicciolire lo switch elimina una pagina</h3>
      <p style="font-size:13px;color:var(--sn-muted);margin:0 0 14px">Quale pagina vuoi eliminare? Le pagine che contengono moduli vanno svuotate prima.</p>
      ${rows}
      <div class="ed-overlay-actions"><button class="ed-btn" id="cancelDelPage">Annulla</button></div>`);
    const cancel = overlayBox.querySelector('#cancelDelPage');
    if (cancel) cancel.addEventListener('click', closeOverlay);
    overlayBox.querySelectorAll('button[data-del-z]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ok = deletePage(m, Number(btn.dataset.delZ));
        if (ok) closeOverlay();
      });
    });
  }

  // Porta lo switch a `targetLen` pagine: allarga (crea) o rimpicciolisce
  // (chiede quale eliminare). Usata dal ridimensionamento a trascinamento.
  function reconcileSwitchPages(m, targetLen) {
    const cur = m.data.pages.length;
    if (targetLen > cur) {
      while (m.data.pages.length < targetLen) {
        if (!growSwitch(m)) break; // niente spazio / max raggiunto: toast già mostrato
      }
      renderGrid(); // ripristina la larghezza visiva se l'aggiunta è stata rifiutata
    } else if (targetLen < cur) {
      renderGrid();            // ripristina la larghezza reale prima di chiedere
      openDeletePageDialog(m); // l'eliminazione effettiva avviene dopo la scelta
    } else {
      renderGrid();
    }
  }

  // ── Modulo: conteggio parole ───────────────────────────────────────────
  function textStats() {
    const text = (docEl.textContent || '').replace(/ /g, ' ').trim();
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const chars = (docEl.textContent || '').length;
    const sentences = text ? (text.match(/[.!?]+(\s|$)/g) || []).length || (text ? 1 : 0) : 0;
    const paragraphs = docEl.querySelectorAll('p, h1, h2, h3, li, blockquote').length;
    const readingMin = Math.max(1, Math.round(words / 200));
    return { words, chars, sentences, paragraphs, readingMin };
  }
  function renderWordCount(cell, m) {
    cell.classList.add('ed-wc');
    const pad = document.createElement('div');
    pad.className = 'ed-mod-pad ed-wc';
    const num = document.createElement('div'); num.className = 'wc-num';
    const cap = document.createElement('div'); cap.className = 'wc-cap';
    pad.appendChild(num); pad.appendChild(cap);
    cell.appendChild(pad);
    const metric = m.data.count || 'words';
    const fill = () => {
      const s = textStats();
      const v = { words: s.words, chars: s.chars, sentences: s.sentences, paragraphs: s.paragraphs }[metric];
      num.textContent = v;
      cap.textContent = { words: 'parole', chars: 'caratteri', sentences: 'frasi', paragraphs: 'paragrafi' }[metric];
    };
    fill();
    cell._wcFill = fill;
    pad.addEventListener('click', (e) => { if (settingsMode) return; e.stopPropagation(); showStatsOverlay(); });
  }
  function updateWordCountModules() {
    gridEl.querySelectorAll('.ed-module[data-type="word-count"]').forEach((c) => { if (c._wcFill) c._wcFill(); });
  }
  function showStatsOverlay() {
    const s = textStats();
    openOverlay(`<h3>Statistiche documento</h3>
      <div class="ed-stat-row"><span>Parole</span><span class="v">${s.words}</span></div>
      <div class="ed-stat-row"><span>Caratteri</span><span class="v">${s.chars}</span></div>
      <div class="ed-stat-row"><span>Frasi</span><span class="v">${s.sentences}</span></div>
      <div class="ed-stat-row"><span>Paragrafi</span><span class="v">${s.paragraphs}</span></div>
      <div class="ed-stat-row"><span>Tempo di lettura</span><span class="v">~${s.readingMin} min</span></div>
      <div class="ed-overlay-actions"><button class="ed-btn primary" id="ovClose">Chiudi</button></div>`);
    $('ovClose').addEventListener('click', closeOverlay);
  }

  // ── Modulo: cerca e sostituisci ────────────────────────────────────────
  let findState = { hits: [], idx: -1, term: '' };
  function renderSearchReplace(cell, m) {
    const pad = document.createElement('div');
    pad.className = 'ed-mod-pad ed-sr';
    pad.innerHTML = `
      <input type="text" placeholder="Cerca" data-sr="find" />
      <input type="text" placeholder="Sostituisci" data-sr="repl" />
      <div class="ed-sr-count" data-sr="count"></div>
      <div class="ed-sr-row">
        <button data-sr="prev">‹ Prec</button>
        <button data-sr="next">Succ ›</button>
      </div>
      <div class="ed-sr-row">
        <button data-sr="one">Sostituisci</button>
        <button data-sr="all">Tutto</button>
      </div>`;
    cell.appendChild(pad);
    const findInput = pad.querySelector('[data-sr="find"]');
    const replInput = pad.querySelector('[data-sr="repl"]');
    const countEl = pad.querySelector('[data-sr="count"]');
    cell._srFocus = () => findInput.focus();
    const run = () => { runFind(findInput.value); countEl.textContent = findState.hits.length ? `${findState.idx + 1}/${findState.hits.length}` : (findInput.value ? 'nessun risultato' : ''); };
    findInput.addEventListener('input', run);
    findInput.addEventListener('click', (e) => e.stopPropagation());
    replInput.addEventListener('click', (e) => e.stopPropagation());
    pad.querySelector('[data-sr="next"]').addEventListener('click', (e) => { e.stopPropagation(); stepFind(1); countEl.textContent = `${findState.idx + 1}/${findState.hits.length}`; });
    pad.querySelector('[data-sr="prev"]').addEventListener('click', (e) => { e.stopPropagation(); stepFind(-1); countEl.textContent = `${findState.idx + 1}/${findState.hits.length}`; });
    pad.querySelector('[data-sr="one"]').addEventListener('click', (e) => { e.stopPropagation(); replaceOne(replInput.value); run(); });
    pad.querySelector('[data-sr="all"]').addEventListener('click', (e) => { e.stopPropagation(); replaceAll(findInput.value, replInput.value); run(); });
  }
  function clearFind() {
    docEl.querySelectorAll('mark.ed-find-hit').forEach((mk) => {
      const parent = mk.parentNode;
      while (mk.firstChild) parent.insertBefore(mk.firstChild, mk);
      parent.removeChild(mk);
      parent.normalize();
    });
    findState = { hits: [], idx: -1, term: '' };
  }
  function runFind(term) {
    clearFind();
    if (!term) return;
    findState.term = term;
    const walker = document.createTreeWalker(docEl, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => n.parentElement.closest('.ed-collapse-toggle') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const textNodes = [];
    let n; while ((n = walker.nextNode())) textNodes.push(n);
    const lc = term.toLowerCase();
    for (const tn of textNodes) {
      const txt = tn.nodeValue;
      let i = txt.toLowerCase().indexOf(lc);
      if (i < 0) continue;
      const frag = document.createDocumentFragment();
      let last = 0;
      while (i >= 0) {
        if (i > last) frag.appendChild(document.createTextNode(txt.slice(last, i)));
        const mk = document.createElement('mark');
        mk.className = 'ed-find-hit';
        mk.textContent = txt.slice(i, i + term.length);
        frag.appendChild(mk);
        findState.hits.push(mk);
        last = i + term.length;
        i = txt.toLowerCase().indexOf(lc, last);
      }
      if (last < txt.length) frag.appendChild(document.createTextNode(txt.slice(last)));
      tn.parentNode.replaceChild(frag, tn);
    }
    if (findState.hits.length) { findState.idx = 0; highlightCurrent(); }
  }
  function highlightCurrent() {
    findState.hits.forEach((h, i) => h.classList.toggle('current', i === findState.idx));
    const cur = findState.hits[findState.idx];
    if (cur) cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function stepFind(dir) {
    if (!findState.hits.length) return;
    findState.idx = (findState.idx + dir + findState.hits.length) % findState.hits.length;
    highlightCurrent();
  }
  function replaceOne(replacement) {
    const cur = findState.hits[findState.idx];
    if (!cur) return;
    cur.replaceWith(document.createTextNode(replacement));
    onDocInput();
    runFind(findState.term);
  }
  function replaceAll(term, replacement) {
    if (!term) return;
    runFind(term);
    findState.hits.forEach((mk) => mk.replaceWith(document.createTextNode(replacement)));
    clearFind();
    onDocInput();
  }

  // ── Modulo: commenta ───────────────────────────────────────────────────
  function renderCommentModule(cell, m) {
    cell.classList.add('ed-comment-mod');
    const pad = document.createElement('div');
    pad.className = 'ed-mod-pad ed-comment-mod';
    pad.innerHTML = `<div class="cm-count">${doc.comments.filter((c) => !c.resolved).length}</div><div class="wc-cap">commenti</div>`;
    cell.appendChild(pad);
    pad.addEventListener('click', (e) => {
      if (settingsMode) return;
      e.stopPropagation();
      if (doc.comments.length) showCommentsList();
      else startCommenting();
    });
  }
  function startCommenting() {
    commenting = true;
    root.classList.add('commenting');
    flashOverlayMsg('Seleziona il testo da commentare…', 1200);
  }
  docEl.addEventListener('mouseup', () => {
    if (!commenting) return;
    const sel = window.getSelection();
    const text = sel ? sel.toString() : '';
    if (!text.trim()) return;
    commenting = false;
    root.classList.remove('commenting');
    promptComment(sel);
  });
  function promptComment(sel) {
    const selectedText = sel.toString();
    openOverlay(`<h3>Nuovo commento</h3>
      <div class="ed-field"><label>Testo selezionato</label>
        <div style="font-size:13px;color:var(--sn-muted);max-height:80px;overflow:auto">"${escapeHtml(selectedText)}"</div></div>
      <div class="ed-field"><label>Commento</label><textarea id="cmText" rows="3"></textarea></div>
      <div class="ed-overlay-actions">
        <button class="ed-btn" id="cmCancel">Annulla</button>
        <button class="ed-btn primary" id="cmSave">Aggiungi</button>
      </div>`);
    // avvolgi la selezione in uno span commentato
    const range = sel.getRangeAt(0);
    const id = newId('comment');
    $('cmCancel').addEventListener('click', closeOverlay);
    $('cmSave').addEventListener('click', () => {
      const text = $('cmText').value.trim();
      if (!text) { closeOverlay(); return; }
      try {
        const span = document.createElement('span');
        span.className = 'ed-commented';
        span.dataset.commentId = id;
        span.title = text;
        range.surroundContents(span);
        span.addEventListener('click', () => showCommentsList(id));
      } catch (_) { /* selezione su più blocchi: salva comunque */ }
      const offsets = pmOffsets(range);
      doc.comments.push({ id, text, anchor: offsets, created: new Date().toISOString(), resolved: false });
      closeOverlay();
      onDocInput();
      renderGrid();
    });
  }
  function pmOffsets() {
    // offset approssimativi sul testo grezzo (le ancore precise PM richiedono
    // un mapping completo; per il prototipo salviamo l'indice nel testo).
    return { from: 0, to: 0 };
  }
  function applyCommentHighlights() {
    // i commenti vengono riassociati al testo solo durante la sessione di
    // creazione; alla ricarica restano nel JSON ma non sono ri-ancorati.
  }
  function showCommentsList(focusId) {
    if (!doc.comments.length) { flashOverlayMsg('Nessun commento.'); return; }
    const rows = doc.comments.map((c) => `
      <div class="ed-stat-row" style="flex-direction:column;align-items:stretch;gap:6px;${c.id === focusId ? 'background:rgba(var(--sn-accent-rgb),0.1)' : ''}">
        <div style="font-size:13px${c.resolved ? ';text-decoration:line-through;color:var(--sn-muted)' : ''}">${escapeHtml(c.text)}</div>
        <div style="display:flex;gap:6px;justify-content:flex-end">
          <button class="ed-btn" data-resolve="${c.id}">${c.resolved ? 'Riapri' : 'Risolvi'}</button>
          <button class="ed-btn danger" data-del="${c.id}">Elimina</button>
        </div>
      </div>`).join('');
    openOverlay(`<h3>Commenti</h3>${rows}
      <div class="ed-overlay-actions"><button class="ed-btn primary" id="ovClose">Chiudi</button></div>`);
    $('ovClose').addEventListener('click', closeOverlay);
    overlayBox.querySelectorAll('[data-resolve]').forEach((b) => b.addEventListener('click', () => {
      const c = doc.comments.find((x) => x.id === b.dataset.resolve); if (c) c.resolved = !c.resolved;
      markDirty(); renderGrid(); showCommentsList();
    }));
    overlayBox.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      doc.comments = doc.comments.filter((x) => x.id !== b.dataset.del);
      const span = docEl.querySelector(`[data-comment-id="${b.dataset.del}"]`);
      if (span) { while (span.firstChild) span.parentNode.insertBefore(span.firstChild, span); span.remove(); }
      markDirty(); renderGrid();
      if (doc.comments.length) showCommentsList(); else closeOverlay();
    }));
  }

  // ════════════════════════════════════════════════════════════════════
  //  Formattazione guidata dalla chat (comandi tipo "scrivi in grassetto
  //  tutti i titoli"). La chat può rispondere con un blocco JSON di "azioni"
  //  che applichiamo direttamente al documento, oltre alla risposta testuale.
  // ════════════════════════════════════════════════════════════════════

  // Stile inline → tag canonico (per applicare) + tag equivalenti (da togliere).
  const STYLE_TAGS = {
    bold:      { wrap: 'strong', unwrap: ['strong', 'b'] },
    italic:    { wrap: 'em', unwrap: ['em', 'i'] },
    underline: { wrap: 'u', unwrap: ['u'] },
    strike:    { wrap: 's', unwrap: ['s', 'strike', 'del'] },
  };

  // Normalizza il nome dello stile (accetta sinonimi italiani/inglesi che il
  // modello potrebbe restituire).
  function normalizeStyle(s) {
    const k = String(s || '').toLowerCase().trim();
    const map = {
      bold: 'bold', grassetto: 'bold', bolded: 'bold', strong: 'bold',
      italic: 'italic', corsivo: 'italic', italics: 'italic', em: 'italic',
      underline: 'underline', sottolineato: 'underline', sottolineatura: 'underline', underlined: 'underline',
      strike: 'strike', strikethrough: 'strike', barrato: 'strike', 'line-through': 'strike',
      fontsize: 'fontSize', size: 'fontSize', dimensione: 'fontSize', 'font-size': 'fontSize',
      fontfamily: 'fontFamily', font: 'fontFamily', carattere: 'fontFamily', 'font-family': 'fontFamily',
    };
    return map[k] || k;
  }

  // Normalizza il target (stringa o oggetto {contains}).
  function normalizeTarget(t) {
    if (t && typeof t === 'object') {
      const sub = t.contains || t.text || t.match || t.value;
      if (sub) return { contains: String(sub) };
      return 'all';
    }
    const k = String(t == null ? 'all' : t).toLowerCase().trim();
    if (['headings', 'heading', 'titoli', 'titolo', 'titles', 'title'].includes(k)) return 'headings';
    if (['all', 'tutto', 'documento', 'document', 'everything', 'whole'].includes(k)) return 'all';
    if (['paragraphs', 'paragraph', 'paragrafi', 'paragrafo'].includes(k)) return 'paragraphs';
    if (['selection', 'selezione', 'selected', 'selezionato'].includes(k)) return 'selection';
    if (['lists', 'list', 'elenchi', 'liste'].includes(k)) return 'lists';
    if (/^h[1-6]$/.test(k)) return k.replace(/^h([4-6])$/, 'h3'); // h4-6 → h3 (max livello)
    return k;
  }

  // Elementi-blocco di primo livello del documento.
  function blockEls() {
    return Array.from(docEl.children).filter((n) => n.nodeType === Node.ELEMENT_NODE && n.tagName !== 'BR');
  }

  // Risolve un target in lista di blocchi del documento.
  function resolveTargets(target) {
    const t = normalizeTarget(target);
    const all = blockEls();
    if (t === 'all') return all;
    if (t === 'headings') return all.filter((el) => /^H[1-3]$/.test(el.tagName));
    if (/^h[1-3]$/.test(t)) return all.filter((el) => el.tagName === t.toUpperCase());
    if (t === 'paragraphs') return all.filter((el) => el.tagName === 'P' || el.tagName === 'DIV');
    if (t === 'lists') return all.filter((el) => el.tagName === 'UL' || el.tagName === 'OL');
    if (t === 'selection') {
      const sel = window.getSelection();
      let range = (sel && sel.rangeCount && !sel.isCollapsed && docEl.contains(sel.anchorNode)) ? sel.getRangeAt(0) : savedDocRange;
      if (!range) return [];
      return all.filter((el) => range.intersectsNode(el));
    }
    if (t && typeof t === 'object' && t.contains) {
      const sub = t.contains.toLowerCase();
      return all.filter((el) => (el.textContent || '').toLowerCase().includes(sub));
    }
    return [];
  }

  // Il contenitore "inline" di un blocco: per le liste è ogni <li>, altrimenti il
  // blocco stesso (heading/paragrafo/citazione).
  function inlineHosts(blockEl) {
    if (blockEl.tagName === 'UL' || blockEl.tagName === 'OL') {
      return Array.from(blockEl.querySelectorAll(':scope > li'));
    }
    return [blockEl];
  }

  // Avvolge i figli "di contenuto" di host (escluso il toggle di collasso) in un
  // nuovo elemento creato da makeWrapper(). Ritorna il wrapper (o null se vuoto).
  function wrapChildren(host, makeWrapper) {
    const toggle = host.querySelector(':scope > .ed-collapse-toggle');
    const kids = Array.from(host.childNodes).filter((n) => n !== toggle);
    if (!kids.length) return null;
    const wrapper = makeWrapper();
    kids.forEach((k) => wrapper.appendChild(k));
    if (toggle) host.insertBefore(wrapper, toggle.nextSibling);
    else host.appendChild(wrapper);
    return wrapper;
  }

  // Toglie (scarta) tutti gli elementi con quel tag dentro host, preservandone i
  // figli. Serve sia per rimuovere uno stile sia per evitare wrapping duplicati.
  function unwrapTag(host, tagName) {
    host.querySelectorAll(tagName).forEach((el) => {
      const parent = el.parentNode;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    });
  }
  // Rimuove gli <span>/<font> che portano una certa proprietà di stile inline.
  function unwrapStyledSpans(host, prop) {
    Array.from(host.querySelectorAll('span, font')).forEach((el) => {
      if (el.style && el.style[prop]) {
        el.style[prop] = '';
        if (!el.getAttribute('style')) {
          const parent = el.parentNode;
          while (el.firstChild) parent.insertBefore(el.firstChild, el);
          parent.removeChild(el);
        }
      }
    });
  }

  function normalizeFontSize(value) {
    const v = String(value == null ? '' : value).toLowerCase().trim();
    if (!v || v === 'normal' || v === 'normale' || v === 'default') return '';
    const kw = {
      huge: '2em', enorme: '2em', xl: '1.7em',
      large: '1.4em', grande: '1.4em', big: '1.4em', larger: '1.25em', 'più grande': '1.25em',
      small: '0.85em', piccolo: '0.85em', smaller: '0.85em', 'più piccolo': '0.85em',
      tiny: '0.7em', piccolissimo: '0.7em',
    };
    if (kw[v]) return kw[v];
    if (/^\d+(\.\d+)?(px|pt|em|rem|%)$/.test(v)) return v;
    if (/^\d+(\.\d+)?$/.test(v)) return `${v}px`;
    return '';
  }
  function normalizeFontFamily(value) {
    const v = String(value == null ? '' : value).trim();
    if (!v) return '';
    const k = v.toLowerCase();
    const map = {
      georgia: 'Georgia, serif',
      times: '"Times New Roman", serif', 'times new roman': '"Times New Roman", serif',
      arial: 'Arial, sans-serif',
      verdana: 'Verdana, sans-serif',
      courier: '"Courier New", monospace', 'courier new': '"Courier New", monospace', monospace: '"Courier New", monospace',
      comic: '"Comic Sans MS", cursive', 'comic sans': '"Comic Sans MS", cursive',
    };
    return map[k] || v;
  }

  // Applica uno stile inline al contenuto di un host (heading/paragrafo/li).
  function applyInlineStyle(host, style, value) {
    const s = normalizeStyle(style);
    const off = value === false || value === 'false' || value === 'off' || value === 'no' || value === 0;
    if (STYLE_TAGS[s]) {
      const cfg = STYLE_TAGS[s];
      cfg.unwrap.forEach((t) => unwrapTag(host, t)); // sempre: evita duplicati / rimuove
      if (!off) wrapChildren(host, () => document.createElement(cfg.wrap));
      return true;
    }
    if (s === 'fontSize') {
      unwrapStyledSpans(host, 'fontSize');
      const css = off ? '' : normalizeFontSize(value);
      if (css) { const span = wrapChildren(host, () => document.createElement('span')); if (span) span.style.fontSize = css; }
      return true;
    }
    if (s === 'fontFamily') {
      unwrapStyledSpans(host, 'fontFamily');
      const fam = off ? '' : normalizeFontFamily(value);
      if (fam) { const span = wrapChildren(host, () => document.createElement('span')); if (span) span.style.fontFamily = fam; }
      return true;
    }
    return false;
  }

  function applyBlockAlign(blockEl, value) {
    const v = String(value || '').toLowerCase().trim();
    if (['left', 'center', 'right', 'justify'].includes(v)) { blockEl.style.textAlign = v; return true; }
    if (['sinistra'].includes(v)) { blockEl.style.textAlign = 'left'; return true; }
    if (['centro', 'centrato', 'centra'].includes(v)) { blockEl.style.textAlign = 'center'; return true; }
    if (['destra'].includes(v)) { blockEl.style.textAlign = 'right'; return true; }
    if (['giustificato', 'giustifica'].includes(v)) { blockEl.style.textAlign = 'justify'; return true; }
    return false;
  }

  // Applica una lista di azioni di formattazione al documento. Ritorna il numero
  // di blocchi toccati (0 = niente da fare, es. target senza corrispondenze).
  function applyFormatActions(actions) {
    if (!Array.isArray(actions)) return 0;
    let touched = 0;
    for (const a of actions) {
      if (!a || typeof a !== 'object') continue;
      const style = a.style || a.format || a.mark;
      const isAlign = a.op === 'align' || (!style && (a.align !== undefined));
      const targets = resolveTargets(a.target);
      if (isAlign) {
        const v = a.value !== undefined ? a.value : a.align;
        for (const b of targets) if (applyBlockAlign(b, v)) touched++;
      } else {
        if (!style) continue;
        for (const b of targets) {
          let any = false;
          for (const host of inlineHosts(b)) any = applyInlineStyle(host, style, a.value) || any;
          if (any) touched++;
        }
      }
    }
    if (touched) { refreshCollapseToggles(); onDocInput(); }
    return touched;
  }

  // Estrae { actions, reply } da una risposta della chat. Cerca un blocco
  // ```json … ``` o, in mancanza, un oggetto JSON con campo "actions".
  // Ritorna null se la risposta non contiene azioni (→ va mostrata come testo).
  function parseFormatActions(text) {
    if (!text || typeof text !== 'string') return null;
    let jsonStr = null;
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) jsonStr = fence[1].trim();
    if (!jsonStr) {
      const t = text.trim();
      if (t.startsWith('{') && t.endsWith('}')) jsonStr = t;
    }
    if (!jsonStr) {
      const m = text.match(/\{[\s\S]*?"actions"[\s\S]*\}/);
      if (m) jsonStr = m[0];
    }
    if (!jsonStr) return null;
    try {
      const obj = JSON.parse(jsonStr);
      if (obj && Array.isArray(obj.actions)) return { actions: obj.actions, reply: typeof obj.reply === 'string' ? obj.reply : '' };
    } catch (_) { /* non era JSON valido → trattalo come testo */ }
    return null;
  }

  // Istruzioni date al modello: come e quando emettere le azioni di formattazione.
  const CHAT_FORMAT_INSTRUCTIONS = [
    'Sei un assistente di scrittura dentro un editor di testo. Oltre a rispondere a domande, puoi MODIFICARE la formattazione del documento quando l\'utente lo chiede.',
    '',
    'Quando l\'utente chiede di cambiare l\'estetica o la formattazione del testo (grassetto, corsivo, sottolineato, barrato, dimensione, font, allineamento), rispondi SOLO con un oggetto JSON dentro un blocco ```json con questa forma:',
    '{"actions":[{"op":"format","target":"headings","style":"bold","value":true}],"reply":"Ho messo in grassetto tutti i titoli."}',
    '',
    'Campi:',
    '- op: "format" (stile inline) oppure "align" (allineamento del blocco)',
    '- target: "all" (tutto il documento), "headings" (tutti i titoli), "h1"/"h2"/"h3" (un livello di titolo), "paragraphs" (i paragrafi), "selection" (il testo selezionato), oppure {"contains":"testo"} per i blocchi che contengono quel testo',
    '- style (solo per op "format"): "bold" | "italic" | "underline" | "strike" | "fontSize" | "fontFamily"',
    '- value: per bold/italic/underline/strike usa true (applica) o false (rimuovi); per fontSize una dimensione CSS come "1.4em" o "20px" (o "large"/"small"); per fontFamily il nome del font ("Georgia","Arial","Times New Roman",...); per op "align" usa "left"|"center"|"right"|"justify"',
    '- reply: una frase breve in italiano che conferma cosa hai fatto',
    '',
    'Puoi includere più operazioni in "actions". Esempio: "scrivi in grassetto tutti i titoli" → {"actions":[{"op":"format","target":"headings","style":"bold","value":true}],"reply":"Fatto: titoli in grassetto."}',
    '',
    'Se invece l\'utente fa una domanda o chiede un\'analisi (non una modifica di formattazione), rispondi normalmente in testo, SENZA JSON.',
    '',
    'Documento corrente:',
    '',
  ].join('\n');

  // Espone i motori di parsing/applicazione per i test (e per debug).
  window.__filoEditorFormat = { parseFormatActions, applyFormatActions, resolveTargets };

  // ── Modulo: chat LLM ───────────────────────────────────────────────────
  function renderChat(cell, m) {
    if (!Array.isArray(m.data.messages)) m.data.messages = [];
    const pad = document.createElement('div');
    pad.className = 'ed-mod-pad ed-chat';
    pad.innerHTML = `
      <div class="ed-chat-log" data-chat="log"></div>
      <div class="ed-chat-input">
        <textarea data-chat="input" placeholder="Chiedi al documento…"></textarea>
        <button data-chat="send">↑</button>
      </div>`;
    cell.appendChild(pad);
    const log = pad.querySelector('[data-chat="log"]');
    const input = pad.querySelector('[data-chat="input"]');
    const sendBtn = pad.querySelector('[data-chat="send"]');
    const renderLog = () => {
      log.innerHTML = '';
      for (const msg of m.data.messages) {
        const b = document.createElement('div');
        b.className = 'ed-chat-msg ' + (msg.role === 'user' ? 'user' : 'assistant');
        b.textContent = msg.content;
        log.appendChild(b);
      }
      log.scrollTop = log.scrollHeight;
    };
    renderLog();
    const send = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      m.data.messages.push({ role: 'user', content: text });
      renderLog();
      const thinking = { role: 'assistant', content: '…' };
      m.data.messages.push(thinking);
      renderLog();
      const docText = (docEl.textContent || '').slice(0, 6000);
      const messages = [
        { role: 'system', content: CHAT_FORMAT_INSTRUCTIONS + docText },
        ...m.data.messages.filter((x) => x !== thinking).map((x) => ({ role: x.role, content: x.content })),
      ];
      try {
        const r = await sendMessage({ type: MSG.AI_REQUEST, action: ACTIONS.EXPLAIN || 'explain', payload: { messages } });
        const raw = (r && r.ok && typeof r.text === 'string') ? r.text : null;
        if (raw == null) {
          thinking.content = 'Errore: ' + ((r && r.error) || 'nessuna risposta');
        } else {
          // Se la risposta contiene azioni di formattazione, applicale al
          // documento e mostra in chat la conferma; altrimenti è testo normale.
          const parsed = parseFormatActions(raw);
          if (parsed && parsed.actions.length) {
            const n = applyFormatActions(parsed.actions);
            thinking.content = parsed.reply
              || (n ? 'Fatto.' : 'Non ho trovato testo a cui applicare la formattazione.');
            if (!n && !parsed.reply) {
              thinking.content = 'Non ho trovato testo a cui applicare la formattazione.';
            }
          } else {
            thinking.content = raw;
          }
        }
      } catch (e) {
        thinking.content = 'Errore: ' + e.message;
      }
      renderLog();
      markDirty();
    };
    sendBtn.addEventListener('click', (e) => { e.stopPropagation(); send(); });
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      try { chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, error: 'no response' })); }
      catch (e) { resolve({ ok: false, error: e.message }); }
    });
  }

  // ════════════════════════════════════════════════════════════════════
  //  IMPOSTAZIONI (modulo 0) & customizzazione
  // ════════════════════════════════════════════════════════════════════
  function toggleSettingsMode(on) {
    settingsMode = on != null ? on : !settingsMode;
    root.classList.toggle('settings-mode', settingsMode);
    settingsView.hidden = !settingsMode;
    docWrap.hidden = settingsMode;
    if (settingsMode) { renderGridControls(); renderPalette(); }
  }
  function renderPalette() {
    paletteEl.innerHTML = '';
    for (const [type, meta] of Object.entries(MODULE_TYPES)) {
      if (meta.fixed) continue;
      const item = document.createElement('div');
      item.className = 'ed-palette-item';
      item.setAttribute('draggable', 'true');
      item.innerHTML = `
        <div class="pi-title"><span class="pi-ico">${meta.glyph || (ICONS[meta.icon] ? ICONS[meta.icon](18) : '')}</span>${meta.label}</div>
        <div class="pi-desc">${meta.desc}</div>
        <div class="pi-size">Dimensione ${meta.defaultW}×${meta.defaultH}</div>`;
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({ add: type }));
        e.dataTransfer.effectAllowed = 'copy';
      });
      paletteEl.appendChild(item);
    }
  }

  function openModuleConfig(m) {
    const meta = MODULE_TYPES[m.type];
    let specific = '';
    if (m.type === 'word-count') {
      const cur = m.data.count || 'words';
      specific = `<div class="ed-field"><label>Conta</label><select id="cfgCount">
        ${['words', 'chars', 'sentences', 'paragraphs'].map((v) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${({ words: 'Parole', chars: 'Caratteri', sentences: 'Frasi', paragraphs: 'Paragrafi' })[v]}</option>`).join('')}
      </select></div>`;
    } else if (m.type === 'switch') {
      specific = '<div class="ed-field"><label>Pagine</label>' + (m.data.pages || []).map((p, i) => `
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <input type="text" value="${escapeHtml(p.name)}" data-pname="${i}" />
          <select data-picon="${i}" style="flex:0 0 90px">
            ${['1', '2', '3', '4', 'pen', 'chat', 'serif'].map((ic) => `<option value="${ic}" ${p.icon === ic ? 'selected' : ''}>${({ pen: '✎ Penna', chat: '◌ Chat', serif: 'A Serif' })[ic] || ic}</option>`).join('')}
          </select>
        </div>`).join('') + '</div>';
    }
    openOverlay(`<h3>${meta.label}</h3>
      <div class="ed-field"><label>Scorciatoia da tastiera</label>
        <input type="text" id="cfgShortcut" placeholder="es. Ctrl+Shift+1" value="${escapeHtml(m.data.shortcut || '')}" /></div>
      ${specific}
      <div class="ed-overlay-actions">
        <button class="ed-btn danger" id="cfgDelete">Elimina</button>
        <button class="ed-btn" id="cfgCancel">Annulla</button>
        <button class="ed-btn primary" id="cfgSave">Salva</button>
      </div>`);
    $('cfgCancel').addEventListener('click', closeOverlay);
    $('cfgDelete').addEventListener('click', () => {
      doc.modules = doc.modules.filter((x) => x.id !== m.id);
      closeOverlay(); renderGrid(); markDirty();
    });
    $('cfgSave').addEventListener('click', () => {
      m.data.shortcut = $('cfgShortcut').value.trim();
      if (m.type === 'word-count') m.data.count = $('cfgCount').value;
      if (m.type === 'switch') {
        overlayBox.querySelectorAll('[data-pname]').forEach((inp) => { m.data.pages[Number(inp.dataset.pname)].name = inp.value; });
        overlayBox.querySelectorAll('[data-picon]').forEach((sel) => { m.data.pages[Number(sel.dataset.picon)].icon = sel.value; });
      }
      closeOverlay(); renderGrid(); markDirty();
    });
  }

  // ── Scorciatoie modulo personalizzate ──────────────────────────────────
  function matchShortcut(e, sc) {
    if (!sc) return false;
    const parts = sc.toLowerCase().split('+').map((s) => s.trim());
    const need = { ctrl: parts.includes('ctrl'), shift: parts.includes('shift'), alt: parts.includes('alt') };
    const key = parts[parts.length - 1];
    return (e.ctrlKey || e.metaKey) === need.ctrl && e.shiftKey === need.shift && e.altKey === need.alt && e.key.toLowerCase() === key;
  }
  function triggerModuleShortcut(m) {
    setActivePage(m.z);
    const cell = gridEl.querySelector(`.ed-module[data-id="${m.id}"]`);
    if (!cell) return;
    if (m.type === 'search-replace' && cell._srFocus) cell._srFocus();
    else if (m.type === 'word-count') showStatsOverlay();
    else if (m.type === 'comment') startCommenting();
    else cell.scrollIntoView({ block: 'center' });
  }

  // ════════════════════════════════════════════════════════════════════
  //  OVERLAY helpers
  // ════════════════════════════════════════════════════════════════════
  function openOverlay(html) { overlayBox.innerHTML = html; overlay.hidden = false; }
  function closeOverlay() { overlay.hidden = true; overlayBox.innerHTML = ''; }
  function flashOverlayMsg(text, ms) {
    openOverlay(`<div style="text-align:center;padding:8px 4px">${escapeHtml(text)}</div>`);
    setTimeout(closeOverlay, ms || 1400);
  }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });

  // Toast discreto in basso a destra per i fallimenti "non bloccanti" (es. uno
  // switch che non si può allargare per mancanza di spazio). Stile coerente con
  // le notifiche d'errore (bordo accent rosso), come il fallimento di un'azione.
  let edToastTimer = null;
  function showEditorToast(text) {
    let el = document.getElementById('edToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'edToast';
      el.className = 'ed-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = text;
    // Forza un reflow così la transizione riparte anche se il toast è già visibile.
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(edToastTimer);
    edToastTimer = setTimeout(() => el.classList.remove('show'), 3400);
  }

  // ════════════════════════════════════════════════════════════════════
  //  Resize moduli nella griglia
  // ════════════════════════════════════════════════════════════════════
  function attachModuleResize(cell, m) {
    const meta = MODULE_TYPES[m.type];
    if (!meta) return;
    if (m.type === 'switch') {
      // Ridimensionare lo switch = cambiare il numero di pagine (larghezza in
      // colonne == numero di pagine). Durante il drag mostriamo solo un'anteprima
      // della larghezza; al rilascio riconciliamo le pagine (crea/elimina).
      const handle = document.createElement('div');
      handle.className = 'ed-mod-resize-h';
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startLen = m.data.pages.length;
        const colWidth = gridEl.clientWidth / GRID_COLS;
        let targetLen = startLen;
        const onMove = (ev) => {
          const delta = Math.round((ev.clientX - startX) / colWidth);
          targetLen = Math.max(meta.minW, Math.min(MAX_PAGES, GRID_COLS - m.x, startLen + delta));
          cell.style.gridColumn = `${m.x + 1} / span ${targetLen}`;
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          reconcileSwitchPages(m, targetLen);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      cell.appendChild(handle);
    } else {
      const handle = document.createElement('div');
      handle.className = 'ed-mod-resize';
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const startW = m.w;
        const startH = m.h;
        const colWidth = gridEl.clientWidth / GRID_COLS;
        const rowHeight = gridEl.clientHeight / GRID_ROWS;
        const onMove = (ev) => {
          const dw = Math.round((ev.clientX - startX) / colWidth);
          const dh = Math.round((ev.clientY - startY) / rowHeight);
          const newW = Math.max(meta.minW, Math.min(GRID_COLS - m.x, startW + dw));
          const newH = Math.max(meta.minH, Math.min(GRID_ROWS - m.y, startH + dh));
          if ((newW !== m.w || newH !== m.h) && fits({ x: m.x, y: m.y, w: newW, h: newH }, m.z, m.id)) {
            m.w = newW;
            m.h = newH;
            cell.style.gridColumn = `${m.x + 1} / span ${m.w}`;
            cell.style.gridRow = `${m.y + 1} / span ${m.h}`;
          }
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          renderGrid();
          markDirty();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      cell.appendChild(handle);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  Splitter text-pane ↔ sidebar
  // ════════════════════════════════════════════════════════════════════
  const splitterEl = $('splitter');
  const sidebarEl = $('sidebar');
  const textPaneEl = $('textPane');
  if (splitterEl) {
    splitterEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      splitterEl.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      const onMove = (ev) => {
        const rootRect = root.getBoundingClientRect();
        const pct = ((rootRect.right - ev.clientX) / rootRect.width) * 100;
        const clamped = Math.max(20, Math.min(60, pct));
        sidebarEl.style.flex = `0 0 ${clamped}%`;
        sidebarEl.style.maxWidth = `${clamped}%`;
        textPaneEl.style.flex = `1 1 ${100 - clamped}%`;
      };
      const onUp = () => {
        splitterEl.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ════════════════════════════════════════════════════════════════════
  //  Toggle sidebar, scorciatoie globali, bootstrap
  // ════════════════════════════════════════════════════════════════════
  function toggleSidebar() { root.classList.toggle('sidebar-hidden'); }

  sidebarToggle.addEventListener('click', toggleSidebar);

  if (ICONS.apps) sidebarToggle.innerHTML = ICONS.apps(16);

  window.addEventListener('keydown', (e) => {
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); save(true); return; }
    if (meta && handleZoomKey(e)) return;
    if (meta && e.key === '\\') { e.preventDefault(); toggleSidebar(); return; }
    if (meta && e.key.toLowerCase() === 'f') {
      const sr = doc.modules.find((m) => m.type === 'search-replace');
      if (sr) { e.preventDefault(); triggerModuleShortcut(sr); return; }
    }
    // scorciatoie personalizzate dei moduli
    for (const m of doc.modules) {
      if (m.data && m.data.shortcut && matchShortcut(e, m.data.shortcut)) { e.preventDefault(); triggerModuleShortcut(m); return; }
    }
  });

  window.addEventListener('beforeunload', () => { if (dirty) save(false); });

  // ── Tema ────────────────────────────────────────────────────────────
  // pageBootstrap applica solo il tema di SISTEMA; come le altre pagine
  // (dashboard/options/…), l'editor deve rispettare il tema SALVATO, altrimenti
  // passando dalla dashboard all'editor il tema cambia in modo incoerente.
  async function applySavedTheme() {
    try {
      const settings = await (window.SN_STORAGE?.getSettings?.());
      if (!settings) return;
      window.SN_PAGE_THEME = settings.theme || 'system';
      let theme = settings.theme || 'system';
      if (theme === 'system') theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      document.documentElement.dataset.snTheme = theme;
    } catch (_) {}
  }
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === MSG.SETTINGS_UPDATED) applySavedTheme();
    });
  } catch (_) {}

  // Boot
  applySavedTheme();
  loadDoc();
  ensureSettingsModule(); // garantisce l'ingranaggio anche su documenti pre-esistenti
  renderDocBody();
  renderGrid();
  updateWordCountModules();
})();
