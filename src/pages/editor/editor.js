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
  const GRID_DEFAULT_COLS = 7, GRID_DEFAULT_ROWS = 10;
  // Chiave legacy: il vecchio documento singolo. Resta come sorgente di
  // migrazione (letta una volta) e come backup; non viene più scritta.
  const STORAGE_KEY = 'filo.editor.doc';
  // Nuova chiave: la COLLEZIONE di file { version, activeId, files:[...] }.
  // Scelta di storage (vedi report): la collezione resta su localStorage — l'I/O
  // di autosalvataggio dev'essere sincrono e veloce (ogni ~1.2s mentre si scrive)
  // e deve poter scrivere anche su `beforeunload`, dove un archivio asincrono
  // (storage.json) non farebbe in tempo a scaricare. Quando il versionamento
  // illimitato (feedback fratello) farà crescere i dati, saranno gli SNAPSHOT di
  // versione — dati "freddi", scritti di rado — a spostarsi su storage.json/file
  // dedicati, tenendo su localStorage solo l'indice e il file corrente ("caldi").
  const COLLECTION_KEY = 'filo.editor.collection';
  // Storico versioni: dati "freddi" (scritti solo a ogni modifica automatica di
  // Filo o snapshot), tenuti FUORI da localStorage — vivono sull'archivio file
  // dell'app (storage.json, via chrome.storage.local) così possono crescere
  // illimitati senza saturare la persistenza calda. Vedi editorVersions.js.
  const VERSIONS_KEY = 'filo.editor.versions';
  const STORE = window.SN_EDITOR_STORE;
  const VERS = window.SN_EDITOR_VERSIONS;
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
  const docbarEl = $('docbar');
  const docSwitchBtn = $('docSwitch');
  const docTitleEl = $('docTitle');
  const docPopEl = $('docPop');

  // ── Metadati tipi di modulo ───────────────────────────────────────────
  const MODULE_TYPES = {
    switch:           { label: 'Switch', icon: 'apps', defaultW: 2, defaultH: 1, minW: 2, minH: 1, desc: 'Cambia pagina/workspace della griglia.', singleton: true },
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

  // Un tipo "singleton" può esistere in una sola copia (lo switch: è l'UNICO
  // modo per navigare le pagine, averne due lascia un doppione ingombrante e non
  // eliminabile — dato che lo switch è protetto dalla cancellazione). Un tipo è
  // aggiungibile dalla palette / dal box "Aggiungi modulo" solo se non è fisso e,
  // se singleton, non ne esiste già uno.
  const canAddType = (type) => {
    const meta = MODULE_TYPES[type];
    if (!meta || meta.fixed) return false;
    if (meta.singleton && doc.modules.some((mm) => mm.type === type)) return false;
    return true;
  };

  // Icone-preset per lo switch (estetiche, non vincolano i moduli).
  const SWITCH_PRESETS = {
    pen:  ICONS.editor,
    chat: ICONS.filoLogo,
    serif: null, // reso come "A" testuale
  };

  // ── Stato ─────────────────────────────────────────────────────────────
  let collection = null; // { version, activeId, files:[...] } — vedi editorStore.js
  let versions = {};     // { [fileId]: { versions:[...] } } — storico, su archivio app
  let versionsReady = Promise.resolve(); // risolta quando lo storico è caricato
  let trash = [];        // documenti eliminati recuperabili (più recenti in cima)
  let doc = null;        // documento ATTIVO in memoria (vedi activateFile/blankDoc)
  let dirty = false;
  let settingsMode = false;
  let commenting = false;
  let saveTimer = null;
  // Snapshot manuali: `manualBaseline` è lo stato di riferimento (contenuto
  // serializzato) da cui misurare quanto l'utente ha scritto/cancellato a mano
  // prima di decidere se salvare un punto di ripristino. `manualSnapTimer` è la
  // pausa di scrittura oltre cui si valuta lo snapshot (vedi maybeRecordManualVersion).
  let manualBaseline = null;
  let manualSnapTimer = null;
  // Pausa di scrittura (ms) dopo l'ultima battuta prima di valutare uno snapshot
  // manuale. Più lunga dell'autosalvataggio (1.2s): uno snapshot è un checkpoint,
  // non un salvataggio, e deve scattare solo quando ci si ferma davvero.
  const MANUAL_SNAPSHOT_IDLE = 3500;
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
        // Un doc vuoto è sempre alla griglia di default (non ha meta.grid): usa
        // le costanti di default, non GRID_COLS/ROWS correnti (che potrebbero
        // riflettere un ALTRO file più grande aperto un attimo prima).
        mkModule('settings', GRID_DEFAULT_COLS - 1, GRID_DEFAULT_ROWS - 1, 1, 1, 0, {}),
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

  // Serializza un MODELLO doc (in memoria) nel formato di storage, SENZA toccare
  // il DOM: usato per creare file vuoti e per snapshot generici. Il file attivo
  // passa da serialize(), che prima allinea il modello al DOM.
  //
  // Il risultato è una COPIA PROFONDA, mai un alias del modello vivo: questo
  // serializzato finisce sia nella collezione sia negli snapshot dello storico
  // versioni, e uno snapshot che continua a cambiare insieme al documento non è
  // uno snapshot (era la causa dell'incoerenza prima/dopo il riavvio: in memoria
  // la chat di un modulo "seguiva" le modifiche, su disco no).
  function serializeDocModel(d) {
    const meta = { ...(d.meta || {}) };
    if (!meta.title) meta.title = 'Documento senza titolo';
    return cloneJson({
      id: d.id,
      meta,
      content: d.content || { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
      comments: Array.isArray(d.comments) ? d.comments : [],
      modules: (d.modules || []).map((m) => ({
        id: m.id, type: m.type, cells: rectToCells(m), data: m.data,
      })),
    });
  }

  function serialize() {
    // Il titolo non è più editabile dall'UI dell'editor: si conserva quello del
    // modello (la rinomina avviene dal menu documenti).
    if (!doc.meta.title) doc.meta.title = 'Documento senza titolo';
    doc.meta.modified = new Date().toISOString();
    refreshCommentAnchors(); // ancore allineate al testo corrente prima del persist
    doc.content = htmlToPM(docEl);
    return serializeDocModel(doc);
  }

  // Applica al modello la dimensione griglia salvata (clamp nei limiti). Riparte
  // SEMPRE dal default 7×10 e poi applica l'eventuale `meta.grid`: così passando
  // da un file con griglia grande a uno senza, la griglia torna al default (con
  // un solo documento non capitava mai, ora sì).
  function loadGridSize() {
    GRID_COLS = GRID_DEFAULT_COLS;
    GRID_ROWS = GRID_DEFAULT_ROWS;
    const g = doc && doc.meta && doc.meta.grid;
    if (g && Number.isFinite(g.cols) && Number.isFinite(g.rows)) {
      GRID_COLS = Math.max(GRID_MIN_COLS, Math.min(GRID_MAX_COLS, g.cols));
      GRID_ROWS = Math.max(GRID_MIN_ROWS, Math.min(GRID_MAX_ROWS, g.rows));
    }
  }

  // Costruisce il modello doc in memoria (moduli come rettangoli) da un file
  // serializzato della collezione. Era il corpo del vecchio loadDoc().
  function parseStoredDoc(raw) {
    if (!raw || !raw.meta) return null;
    return {
      id: raw.id,
      meta: raw.meta,
      content: raw.content || { type: 'doc', content: [] },
      comments: Array.isArray(raw.comments) ? raw.comments : [],
      modules: (raw.modules || []).map((m) => {
        const rect = Array.isArray(m.cells) && m.cells.length ? cellsToRect(m.cells) : { x: 0, y: 0, w: 1, h: 1, z: 0 };
        return { id: m.id || newId('mod'), type: m.type, ...rect, data: m.data || {} };
      }),
    };
  }

  // ── Collezione: persistenza ───────────────────────────────────────────
  // localStorage resta la persistenza "calda" (sincrona, scrivibile anche su
  // beforeunload). In PIÙ rispecchiamo la collezione sull'archivio dell'app
  // (storage.json, via chrome.storage.local): è così che Filo, dal main, vede i
  // file dell'editor e ci scrive gli appunti in autonomia. Il mirror è
  // fire-and-forget: non deve rallentare la digitazione.
  function readCollectionRaw() {
    try { return JSON.parse(localStorage.getItem(COLLECTION_KEY)); } catch (_) { return null; }
  }
  function readArchivedCollection() {
    try {
      if (window.chrome && chrome.storage && chrome.storage.local) {
        return Promise.resolve(chrome.storage.local.get(COLLECTION_KEY))
          .then((r) => (r && r[COLLECTION_KEY]) || null)
          .catch(() => null);
      }
    } catch (_) { /* archivio non disponibile */ }
    return Promise.resolve(null);
  }
  function writeCollection() {
    localStorage.setItem(COLLECTION_KEY, JSON.stringify(collection));
    try {
      if (window.chrome && chrome.storage && chrome.storage.local) {
        Promise.resolve(chrome.storage.local.set({ [COLLECTION_KEY]: collection })).catch(() => {});
      }
    } catch (_) { /* mirror best-effort */ }
  }
  // Confronto "chi è più fresco" fra due versioni dello stesso file (per il
  // merge locale↔archivio). meta.modified è ISO ovunque; fallback a 0.
  function fileTs(f) {
    const m = f && f.meta && f.meta.modified;
    const d = m != null ? Date.parse(m) : NaN;
    return Number.isFinite(d) ? d : (typeof m === 'number' ? m : 0);
  }
  // Fonde due collezioni: unione dei file per id, tenendo per gli id in comune
  // quello più recente (così un appunto scritto da Filo mentre l'editor era
  // chiuso non va perso, e un'eventuale modifica locale più recente vince).
  // `keepLocalId` forza a tenere la versione LOCALE di quel file (usato per il
  // file attivo con modifiche non ancora salvate).
  function mergeCollections(local, remote, keepLocalId) {
    const byId = new Map();
    for (const f of (remote && remote.files) || []) byId.set(f.id, f);
    for (const f of (local && local.files) || []) {
      if (f.id === keepLocalId) { byId.set(f.id, f); continue; }
      const other = byId.get(f.id);
      byId.set(f.id, other ? (fileTs(f) >= fileTs(other) ? f : other) : f);
    }
    const files = Array.from(byId.values());
    let activeId = (local && local.activeId) || null;
    if (!files.some((f) => f.id === activeId)) activeId = (remote && remote.activeId) || null;
    if (!files.some((f) => f.id === activeId)) activeId = files[0] && files[0].id;
    return { version: STORE.COLLECTION_VERSION, activeId, files };
  }
  // Un file vuoto pronto per la collezione (formato serializzato).
  function blankFileSerialized() {
    const model = blankDoc();
    model.id = newId('file');
    return serializeDocModel(model);
  }

  // Carica (o migra) la collezione da localStorage (persistenza calda), come
  // sempre e in modo SINCRONO: così il primo render è immediato e deterministico
  // (nessun cambio di timing rispetto a prima). I file che Filo ha scritto
  // nell'archivio dell'app (appunti, migrazione) vengono fusi subito dopo, in
  // modo asincrono, da `reloadFromArchive()`.
  //
  // NON rispecchia sull'archivio: al primo avvio su un profilo la collezione qui
  // è un foglio bianco appena inventato, e scriverlo nell'archivio CANCELLEREBBE
  // i file che Filo ci ha già messo (gli appunti storici migrati all'avvio del
  // main) prima che `reloadFromArchive()` faccia in tempo a leggerli. Il mirror
  // lo fa `reloadFromArchive()`, che è l'unico punto che conosce entrambi i lati.
  function loadCollection() {
    collection = STORE.migrateToCollection({
      collection: readCollectionRaw(),
      legacyDoc: readLegacyDoc(),
      idFactory: () => newId('file'),
      blankFactory: blankFileSerialized,
    });
    localStorage.setItem(COLLECTION_KEY, JSON.stringify(collection));
  }

  // Ricarica la collezione dall'archivio quando Filo (main) ci ha scritto un
  // appunto: fonde i file nuovi/aggiornati senza perdere le modifiche locali in
  // corso, aggiorna il selettore documenti e, se il file attivo è cambiato sotto
  // e non ci sono modifiche in sospeso, lo riapre per mostrare il nuovo testo.
  // Nota: se l'utente sta modificando PROPRIO il file su cui Filo scrive senza
  // aver salvato, vincono le modifiche locali; l'appunto di Filo resta comunque
  // nello storico versioni del file (source "filo"), quindi è recuperabile.
  async function reloadFromArchive() {
    const remoteRaw = await readArchivedCollection();
    const remoteFiles = (remoteRaw && Array.isArray(remoteRaw.files)) ? remoteRaw.files : null;
    if (!remoteFiles || !remoteFiles.length) {
      // Archivio vuoto (o assente): è il locale a doverlo seminare, altrimenti
      // Filo non vedrebbe i documenti dell'utente finché non salva a mano.
      // (Prima questo mirror lo faceva `loadCollection()`, ma da lì cancellava
      // l'archivio invece di seminarlo — vedi il commento lassù.)
      writeCollection();
      return;
    }
    if (doc) syncActiveIntoCollection();
    const remoteCol = STORE.migrateToCollection({ collection: remoteRaw });
    collection = mergeCollections(collection, remoteCol, dirty ? (doc && doc.id) : null);
    const activeStored = STORE.findFile(collection, doc && doc.id) || STORE.activeFile(collection);
    if (activeStored && !dirty && doc
      && JSON.stringify(activeStored.content) !== JSON.stringify(doc.content)) {
      activateFile(activeStored);
    } else {
      renderDocSwitcher();
    }
    writeCollection();
    // Ricarica anche lo storico versioni: Filo vi ha aggiunto i punti di
    // ripristino della sua scrittura (così l'utente può annullarla).
    loadVersions();
  }
  function readLegacyDoc() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (_) { return null; }
  }

  // Copia lo stato del file attivo (dal DOM/modello) dentro la collezione.
  function syncActiveIntoCollection() {
    if (!doc) return;
    STORE.replaceFile(collection, doc.id, serialize());
    collection.activeId = doc.id;
  }

  function save(flash) {
    try {
      syncActiveIntoCollection();
      writeCollection();
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
    // Snapshot manuale "a pausa": dopo che l'utente smette di scrivere, valuta
    // se la deriva è abbastanza grande da meritare un punto di ripristino.
    clearTimeout(manualSnapTimer);
    manualSnapTimer = setTimeout(() => maybeRecordManualVersion(), MANUAL_SNAPSHOT_IDLE);
  }

  // ── Storico versioni: persistenza sull'archivio app (storage.json) ────────
  // Carica lo storico all'avvio. Asincrono e tollerante: se manca o è corrotto,
  // si parte da uno storico vuoto (nessuna versione = nessun ripristino, ma la
  // prima modifica di Filo ne creerà una).
  function loadVersions() {
    versionsReady = Promise.resolve()
      .then(() => (window.chrome && chrome.storage && chrome.storage.local
        ? chrome.storage.local.get(VERSIONS_KEY) : {}))
      .then((r) => {
        const v = r && r[VERSIONS_KEY];
        versions = (v && typeof v === 'object') ? v : {};
      })
      .catch(() => { versions = {}; });
    return versionsReady;
  }
  // Scrittura "fredda": fire-and-forget, non blocca la digitazione. Lo storico è
  // testo e cresce piano, quindi riscrivere l'intero blob a ogni versione è
  // sostenibile (le versioni si creano solo alle modifiche di Filo/agli snapshot).
  function persistVersions() {
    try {
      if (window.chrome && chrome.storage && chrome.storage.local) {
        return Promise.resolve(chrome.storage.local.set({ [VERSIONS_KEY]: versions })).catch(() => {});
      }
    } catch (_) { /* archivio non disponibile: lo storico resta in memoria */ }
    return Promise.resolve();
  }

  function fmtVersionWhen(ts) {
    try {
      const d = new Date(ts);
      const day = d.toLocaleDateString('it-IT');
      const time = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      return `${day} ${time}`;
    } catch (_) { return ''; }
  }

  // Registra un punto di ripristino con il contenuto PRE-modifica di Filo: così
  // ripristinandolo si torna a com'era il file prima che l'AI lo toccasse.
  // Ritorna la versione creata (o null se identica all'ultima → nessun rumore).
  function recordFiloVersion(preContent) {
    if (!doc || !VERS) return null;
    const ts = Date.now();
    const res = VERS.record(versions, doc.id, {
      content: preContent,
      source: 'filo',
      label: `Modifica di Filo · ${fmtVersionWhen(ts)}`,
      ts,
    }, () => newId('ver'));
    versions = res.store;
    if (res.created) persistVersions();
    return res.created ? res.version : null;
  }

  // ── Snapshot MANUALI: versionare anche le modifiche a mano significative ──
  // Le modifiche di Filo creano sempre un punto di ripristino; quelle a mano no
  // — versionare a ogni battuta sarebbe rumore. Politica (invisibile all'utente):
  //   • soglia — snapshot solo se, dall'ultimo riferimento, l'utente ha
  //     scritto/cancellato abbastanza testo (logica pura in editorVersions.js);
  //   • pausa — si valuta dopo che l'utente smette di scrivere (debounce), non
  //     durante la digitazione;
  //   • confine — si valuta anche quando si cambia/chiude documento (punto
  //     naturale in cui il file si sincronizza), così un blocco scritto e poi
  //     abbandonato senza pausa non va perso.
  // `manualBaseline` è lo stato da cui si misura la deriva; ogni snapshot (o
  // modifica di Filo, o ripristino) lo riallinea allo stato corrente.

  // Riallinea il riferimento: dopo, serve nuova deriva significativa per un altro
  // snapshot. Passa un contenuto esplicito, o lascia che lo prenda dal modello.
  function setManualBaseline(content) {
    manualBaseline = content || (doc ? serializeDocModel(doc) : null);
  }

  // Crea uno snapshot 'manual' del documento CORRENTE se la deriva dall'ultimo
  // riferimento supera la soglia. Silenzioso (nessun toast: il versionamento
  // manuale è invisibile finché non serve). Ritorna la versione creata o null.
  function maybeRecordManualVersion() {
    clearTimeout(manualSnapTimer);
    if (!doc || !VERS) return null;
    const cur = serialize();
    if (!manualBaseline) { manualBaseline = cur; return null; } // primo riferimento
    if (!VERS.isSignificantManualChange(manualBaseline, cur)) return null;
    const ts = Date.now();
    const res = VERS.record(versions, doc.id, {
      content: cur,
      source: 'manual',
      label: `Modifica manuale · ${fmtVersionWhen(ts)}`,
      ts,
    }, () => newId('ver'));
    versions = res.store;
    if (res.created) { persistVersions(); manualBaseline = cur; }
    return res.created ? res.version : null;
  }

  // Ripristina una versione: prima salva lo stato corrente come versione (così
  // anche il ripristino è annullabile e non si perde nulla), poi riporta il
  // CORPO del documento (testo + commenti) a quello scelto e ri-renderizza se è
  // il file attivo. Nome del documento, conversazione con Filo e disposizione
  // dei riquadri NON tornano indietro: appartengono al documento di adesso, non
  // al testo di allora (vedi SN_EDITOR_VERSIONS.composeRestored).
  function restoreVersion(fileId, versionId) {
    if (!VERS) return false;
    const v = VERS.get(versions, fileId, versionId);
    if (!v) return false;
    const target = STORE.findFile(collection, fileId);
    if (!target) return false;
    // Snapshot dello stato ATTUALE (mai un alias del file vivo: dev'essere una
    // fotografia, non un puntatore che continua a cambiare).
    const curContent = (doc && doc.id === fileId) ? serialize() : cloneJson(target);
    const cres = VERS.record(versions, fileId, {
      content: curContent,
      source: 'restore',
      label: `Prima del ripristino · ${fmtVersionWhen(Date.now())}`,
      ts: Date.now(),
    }, () => newId('ver'));
    versions = cres.store;
    persistVersions();
    const restored = VERS.composeRestored(curContent, v.content);
    restored.id = fileId;
    if (restored.meta) restored.meta.modified = new Date().toISOString();
    STORE.replaceFile(collection, fileId, restored);
    if (doc && doc.id === fileId) {
      activateFile(STORE.findFile(collection, fileId));
    }
    writeCollection();
    // Il ripristino è un gesto delicato: lo stato di prima è già salvato qui
    // sopra, quindi l'avviso lo offre subito indietro — stessa simmetria delle
    // modifiche automatiche di Filo, che sono sempre annullabili sul posto.
    showEditorToast('Versione ripristinata.', {
      label: 'Annulla',
      onClick: () => {
        if (!restoreVersion(fileId, cres.version.id)) return;
        if (isVersionHistoryOpen()) renderVersionHistory(fileId);
      },
    });
    return true;
  }

  // Offre l'annullamento immediato dell'ultima modifica automatica di Filo con un
  // toast "Annulla". Lo storico completo (sfogliabile) è una feature a parte; qui
  // garantiamo l'invariante minima: una modifica di Filo è SEMPRE annullabile.
  function offerUndoFilo(versionId, fileId) {
    showEditorToast('Filo ha modificato il documento.', {
      label: 'Annulla',
      onClick: () => restoreVersion(fileId, versionId),
    });
  }

  // ── Pannello "Storico versioni": sfoglia e ripristina QUALSIASI versione ──
  // Il toast "Annulla" copre solo l'ultima modifica di Filo; questo pannello dà
  // accesso all'intero storico (invariante UX: se salviamo N versioni, l'utente
  // deve poterle vedere tutte). Le versioni stanno sull'archivio app e
  // sopravvivono al reload; qui le mostriamo dalla più recente alla più vecchia.

  // Testo semplice da una versione (il contenuto ProseMirror serializzato), per
  // l'anteprima. Delega alla logica pura in editorVersions.js — stessa estrazione
  // usata dalla soglia degli snapshot manuali: una sorgente sola, niente deriva.
  function versionPlainText(v) {
    return VERS && v ? VERS.plainText(v.content) : '';
  }

  // Etichetta + classe del badge in base alla sorgente della versione.
  function versionSourceMeta(v) {
    const src = v && v.source;
    if (src === 'filo') return { tag: 'Modifica di Filo', cls: 'filo' };
    if (src === 'restore') return { tag: 'Prima di un ripristino', cls: 'restore' };
    return { tag: 'Modifica manuale', cls: 'manual' };
  }

  // Anteprima corta (prime righe non vuote) per la riga della lista.
  function versionPreviewShort(v) {
    const text = versionPlainText(v);
    if (!text) return '';
    const line = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' · ');
    return line.length > 180 ? line.slice(0, 179).trimEnd() + '…' : line;
  }

  // Quante versioni sono renderizzate al momento (paginazione anti-raffica per
  // storie molto lunghe: si parte da un lotto e si carica il resto su richiesta).
  const VERS_HISTORY_BATCH = 40;
  let versHistoryShown = VERS_HISTORY_BATCH;

  // Che cosa tocca un ripristino: il pannello mostra solo l'anteprima del testo,
  // quindi il confine va detto una volta, in chiaro, prima di premere.
  const VH_SCOPE_NOTE = 'Il ripristino riporta indietro il testo e i commenti. '
    + 'Nome del documento, conversazione con Filo e disposizione dei riquadri restano come sono adesso.';

  // Il pannello è a schermo? (serve a tenerlo allineato quando lo stato cambia
  // da fuori, per esempio annullando un ripristino dall'avviso.)
  function isVersionHistoryOpen() {
    return !overlay.hidden && !!overlayBox.querySelector('.ed-vh-list, .ed-vh-empty');
  }

  // ── Coda di gesto (guardia anti secondo-colpo) ──────────────────────────
  // Quando un clic CAMBIA ciò che sta sotto il cursore, il colpo di coda di un
  // doppio clic non trova più il comando premuto ma quello che ne ha preso il
  // posto, e fa una cosa che l'utente non ha chiesto:
  //   • pannello versioni → apriva l'anteprima di un'altra versione, o peggio
  //     ne ripristinava una sbagliata;
  //   • pannello che si chiude → il colpo cadeva sul foglio dietro e apriva da
  //     solo "Aggiungi modulo";
  //   • menu documenti → la × di un documento ne eliminava DUE, perché la lista
  //     si accorciava e sotto il cursore arrivava la × di quello dopo;
  //   • avvisi in basso a destra → premeva l'"Annulla" dell'avviso appena
  //     comparso al posto di quello vecchio, disfacendo l'annullamento stesso;
  //   • cestino → bruciava la conferma "Confermi?" comparsa sul posto e
  //     cancellava un documento per sempre in un colpo solo.
  // Quel colpo non è una nuova intenzione: è la coda del gesto precedente (il
  // browser lo marca con `detail > 1`, cioè "clic ravvicinati sullo stesso
  // punto"), e va ignorato.
  //
  // La guardia è UNA SOLA e sta sulla FINESTRA, non sul contenitore che si è
  // ridisegnato: il colpo di coda atterra spesso FUORI da quella zona (il foglio
  // dietro a un pannello chiuso, la riga scivolata su in una lista più corta),
  // dove un ascoltatore locale non lo vedrebbe passare.
  // Scatta in due modi, e il primo non deve ricordarselo nessuno:
  //   1. DA SÉ — sotto il cursore c'è ora un elemento diverso da quello appena
  //      premuto (o lo stesso con un'altra etichetta): la pagina è cambiata
  //      sotto il gesto, comunque sia successo. Vale anche per le zone scritte
  //      domani, che non devono armare niente per essere protette.
  //   2. ARMATA a mano — per i cambi che il confronto non può vedere: un
  //      elemento che sta uscendo di scena ma è ancora lì mentre sfuma (gli
  //      avvisi), o un bottone che cambia significato restando lo stesso nodo
  //      ("Elimina definitivamente" → "Confermi?").
  const STALE_CLICK_MS = 1000;
  let staleArmedAt = 0;
  let lastClickEl = null;
  let lastClickLabel = '';
  let lastClickAt = 0;
  const staleClick = { arm() { staleArmedAt = Date.now(); } };
  function clickLabel(el) {
    const t = el && typeof el.textContent === 'string' ? el.textContent : '';
    return t.trim().slice(0, 160);
  }
  window.addEventListener('click', (e) => {
    const now = Date.now();
    if (e.detail > 1) {
      const armed = !!staleArmedAt && now - staleArmedAt <= STALE_CLICK_MS;
      const swapped = !!lastClickEl && now - lastClickAt <= STALE_CLICK_MS
        && (e.target !== lastClickEl || !e.target.isConnected || clickLabel(e.target) !== lastClickLabel);
      if (armed || swapped) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }
    }
    lastClickEl = e.target;
    lastClickLabel = clickLabel(e.target);
    lastClickAt = now;
  }, true);

  function openVersionHistory() {
    closeDocPop();
    closeTitleMenu();
    if (!doc) return;
    versHistoryShown = VERS_HISTORY_BATCH;
    renderVersionHistory(doc.id);
  }

  function renderVersionHistory(fileId) {
    const all = VERS ? VERS.listFor(versions, fileId).slice().reverse() : []; // recente → vecchia
    if (!all.length) {
      openOverlay(`<h3>Storico versioni</h3>
        <p class="ed-vh-empty">Nessuna versione ancora. Filo salva un punto di ripristino ogni volta che modifica il documento; da lì potrai tornare indietro.</p>
        <div class="ed-overlay-actions"><button class="ed-btn primary" id="ovClose">Chiudi</button></div>`);
      $('ovClose').addEventListener('click', closeOverlay);
      staleClick.arm();
      return;
    }
    const shown = all.slice(0, versHistoryShown);
    const rows = shown.map((v) => {
      const meta = versionSourceMeta(v);
      const prev = versionPreviewShort(v);
      const prevHtml = prev ? escapeHtml(prev) : '<span class="ed-vh-noprev">(documento vuoto)</span>';
      return `<div class="ed-vh-item" data-id="${escapeHtml(v.id)}" role="button" tabindex="0" title="Vedi l'anteprima di questa versione">
        <div class="ed-vh-head">
          <span class="ed-vh-badge ${meta.cls}">${escapeHtml(meta.tag)}</span>
          <span class="ed-vh-when">${escapeHtml(fmtVersionWhen(v.ts))}</span>
        </div>
        <div class="ed-vh-prev">${prevHtml}</div>
        <div class="ed-vh-actions">
          <button class="ed-btn ed-vh-restore" data-id="${escapeHtml(v.id)}">Ripristina</button>
        </div>
      </div>`;
    }).join('');
    const more = all.length > versHistoryShown
      ? `<button class="ed-btn ed-vh-more" id="vhMore">Mostra le versioni più vecchie (${all.length - versHistoryShown})</button>`
      : '';
    openOverlay(`<h3>Storico versioni</h3>
      <p class="ed-vh-scope">${VH_SCOPE_NOTE}</p>
      <div class="ed-vh-list">${rows}</div>
      ${more}
      <div class="ed-overlay-actions"><button class="ed-btn primary" id="ovClose">Chiudi</button></div>`);
    $('ovClose').addEventListener('click', closeOverlay);
    const moreBtn = $('vhMore');
    if (moreBtn) moreBtn.addEventListener('click', () => { versHistoryShown += VERS_HISTORY_BATCH; renderVersionHistory(fileId); });
    overlayBox.querySelectorAll('.ed-vh-restore').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (restoreVersion(fileId, b.dataset.id)) renderVersionHistory(fileId);
    }));
    // Click/Invio sulla riga (fuori dal bottone): apri l'anteprima ampia prima
    // di decidere, così "Ripristina" non è mai una sorpresa a scatola chiusa.
    overlayBox.querySelectorAll('.ed-vh-item').forEach((it) => {
      const open = (e) => { if (e.target.closest('.ed-vh-restore')) return; showVersionPreview(fileId, it.dataset.id); };
      it.addEventListener('click', open);
      it.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
    });
    staleClick.arm();
  }

  // Anteprima ampia di una singola versione, con conferma di ripristino.
  function showVersionPreview(fileId, versionId) {
    const v = VERS ? VERS.get(versions, fileId, versionId) : null;
    if (!v) return;
    const meta = versionSourceMeta(v);
    const full = versionPlainText(v);
    const body = full ? escapeHtml(full).replace(/\n/g, '<br>') : '<span class="ed-vh-noprev">(documento vuoto)</span>';
    openOverlay(`<h3>Anteprima versione</h3>
      <div class="ed-vh-head">
        <span class="ed-vh-badge ${meta.cls}">${escapeHtml(meta.tag)}</span>
        <span class="ed-vh-when">${escapeHtml(fmtVersionWhen(v.ts))}</span>
      </div>
      <div class="ed-vh-fulltext">${body}</div>
      <p class="ed-vh-scope">${VH_SCOPE_NOTE}</p>
      <div class="ed-overlay-actions">
        <button class="ed-btn" id="vhBack">Indietro</button>
        <button class="ed-btn primary" id="vhRestore">Ripristina questa versione</button>
      </div>`);
    $('vhBack').addEventListener('click', () => renderVersionHistory(fileId));
    $('vhRestore').addEventListener('click', () => {
      if (restoreVersion(fileId, versionId)) renderVersionHistory(fileId);
    });
    staleClick.arm();
  }

  // ════════════════════════════════════════════════════════════════════
  //  COLLEZIONE DI FILE: attiva/crea/elimina/rinomina + menu documenti
  // ════════════════════════════════════════════════════════════════════

  // Rende attivo un file serializzato: costruisce il modello, azzera lo stato
  // transitorio della vista e ri-renderizza tutto. NON persiste (chi chiama
  // decide quando scrivere).
  function activateFile(raw) {
    doc = parseStoredDoc(raw) || parseStoredDoc(blankFileSerialized());
    collection.activeId = doc.id;
    // Stato di vista che non deve "trascinarsi" da un file all'altro: torna
    // sempre alla vista testo (fuori dalla modalità modifica moduli).
    commenting = false;
    toggleSettingsMode(false);
    ensureSettingsModule();
    loadGridSize();
    renderDocBody();
    renderGrid();
    updateWordCountModules();
    renderDocSwitcher();
    // Nuovo file attivo → nuovo riferimento per gli snapshot manuali: il testo
    // già presente al caricamento non conta come "modifica a mano" (misuriamo la
    // deriva DA QUI). Annulla anche l'eventuale valutazione in sospeso del vecchio.
    clearTimeout(manualSnapTimer);
    setManualBaseline(serializeDocModel(doc));
  }

  // Passa a un altro file: salva prima quello corrente, poi attiva il target.
  function switchToFile(id) {
    if (!doc || id === doc.id) { closeDocPop(); return; }
    const target = STORE.findFile(collection, id);
    if (!target) return;
    // Confine naturale: se lasciando il file l'utente ha scritto a mano
    // abbastanza, salva un punto di ripristino prima di cambiare documento.
    maybeRecordManualVersion();
    syncActiveIntoCollection();
    activateFile(target);
    writeCollection();
    closeDocPop();
  }

  // Crea un nuovo documento vuoto e lo apre.
  function createFile() {
    if (doc) { maybeRecordManualVersion(); syncActiveIntoCollection(); }
    const file = STORE.addFile(collection, blankFileSerialized(), () => newId('file'));
    activateFile(file);
    writeCollection();
    closeDocPop();
  }

  // Clone profondo JSON-safe (i file/serializzati sono già JSON puri).
  function cloneJson(v) {
    try { return v == null ? v : JSON.parse(JSON.stringify(v)); }
    catch (_) { return v; }
  }
  // Accorcia un testo aggiungendo un'ellissi (per il nome nel toast).
  function ellipsize(s, max) {
    const t = String(s == null ? '' : s);
    return t.length > max ? t.slice(0, Math.max(0, max - 1)).trimEnd() + '…' : t;
  }

  // ── Cestino dei documenti eliminati ──────────────────────────────────────
  // L'avviso "Annulla" copre solo i secondi immediatamente successivi: è comodo
  // ma non può essere l'UNICA rete (basta chiudere la pagina, o lasciar passare
  // il tempo, e il documento sarebbe perso per sempre). Ogni eliminazione
  // finisce quindi anche qui, con il suo testo, i commenti, i riquadri e lo
  // storico versioni, e resta recuperabile dal menu documenti finché non la si
  // butta a mano o non esce dagli ultimi TRASH_MAX documenti eliminati.
  const TRASH_KEY = 'filo.editor.trash';
  const TRASH_MAX = 12;
  // Tetto di dimensione: il cestino vive nella persistenza "calda" insieme alla
  // collezione, che non va saturata. Oltre la soglia si buttano i più vecchi.
  const TRASH_MAX_BYTES = 1_500_000;

  function readTrashRaw() {
    try {
      const v = JSON.parse(localStorage.getItem(TRASH_KEY));
      return Array.isArray(v) ? v : [];
    } catch (_) { return []; }
  }
  function loadTrash() {
    trash = readTrashRaw().filter((e) => e && e.file && e.file.id);
  }
  function writeTrash() {
    try { localStorage.setItem(TRASH_KEY, JSON.stringify(trash)); }
    catch (_) {
      // Spazio esaurito: tieni solo i più recenti e riprova una volta sola.
      trash = trash.slice(0, Math.max(1, Math.floor(trash.length / 2)));
      try { localStorage.setItem(TRASH_KEY, JSON.stringify(trash)); } catch (__) {}
    }
  }
  // Butta davvero via un documento cestinato: via anche il suo storico versioni,
  // che finché resta nel cestino invece va conservato (un ripristino deve
  // riportare indietro anche i punti di ripristino).
  function purgeTrashEntry(entryId) {
    const i = trash.findIndex((e) => e.id === entryId);
    if (i < 0) return null;
    const [entry] = trash.splice(i, 1);
    // Lo storico arriva dall'archivio in modo asincrono: aspetta che sia
    // caricato, altrimenti una pulizia fatta troppo presto verrebbe riscritta
    // dal caricamento e lascerebbe lo storico di un file che non esiste più.
    if (VERS && entry && entry.file) {
      const fid = entry.file.id;
      Promise.resolve(versionsReady).then(() => {
        if (!versions[fid]) return;
        versions = VERS.dropFile(versions, fid);
        persistVersions();
      }).catch(() => {});
    }
    return entry;
  }
  // Applica i due tetti (numero e dimensione) buttando i più vecchi.
  function enforceTrashLimits() {
    while (trash.length > TRASH_MAX) purgeTrashEntry(trash[trash.length - 1].id);
    let guard = 0;
    while (trash.length > 1 && guard++ < TRASH_MAX) {
      let size = 0;
      try { size = JSON.stringify(trash).length; } catch (_) { break; }
      if (size <= TRASH_MAX_BYTES) break;
      purgeTrashEntry(trash[trash.length - 1].id);
    }
  }
  // Un file è "ancora vuoto"? Serve a non buttare via il foglio bianco creato al
  // posto dell'ultimo documento eliminato se nel frattempo ci è stato scritto.
  function fileIsEmpty(file) {
    if (!file) return false;
    const txt = VERS ? VERS.plainText(file) : '';
    if (txt && txt.trim()) return false;
    if (Array.isArray(file.comments) && file.comments.length) return false;
    // Un foglio con solo un'immagine non ha testo ma NON è vuoto: senza questo
    // controllo verrebbe scartato come "foglio bianco mai usato".
    if (contentHasImage(file.content)) return false;
    return true;
  }

  // Il modello del documento contiene almeno un nodo immagine?
  function contentHasImage(content) {
    const root = content && content.content ? content.content : content;
    let found = false;
    const walk = (n) => {
      if (found || !n || typeof n !== 'object') return;
      if (n.type === 'image') { found = true; return; }
      if (Array.isArray(n.content)) n.content.forEach(walk);
    };
    walk(root);
    return found;
  }

  // Elimina un documento. Invariante: resta sempre almeno un file — se si
  // cancella l'ultimo, se ne crea uno vuoto al suo posto.
  //
  // L'eliminazione è ISTANTANEA (nessuna conferma: l'attrito su un'azione
  // frequente è negativo) ma REVERSIBILE — coerente col principio di Filo "il
  // software deve poter essere usato male": un tocco per sbaglio non deve poter
  // cancellare per sempre un documento. Subito dopo compare un avviso "…
  // eliminato" con "Annulla" (ripristina file, posizione e storico) e, in ogni
  // caso, il documento resta nel cestino: l'avviso è la scorciatoia, il cestino
  // è la rete di sicurezza che sopravvive anche alla chiusura della pagina.
  function deleteFile(id) {
    const target = STORE.findFile(collection, id);
    if (!target) return;
    const wasActive = doc && doc.id === id;
    // Se cancello il file ATTIVO catturo la sua versione FRESCA (con le
    // modifiche in memoria non ancora salvate), non quella su disco.
    if (wasActive) syncActiveIntoCollection();
    const idx = collection.files.findIndex((f) => f.id === id);
    const snapFile = cloneJson(STORE.findFile(collection, id));
    const title = (snapFile && snapFile.meta && snapFile.meta.title) || STORE.DEFAULT_TITLE;

    const res = STORE.removeFile(collection, id);
    if (!res.removed) return;
    let createdBlankId = null;
    if (res.emptied) {
      const file = STORE.addFile(collection, blankFileSerialized(), () => newId('file'));
      createdBlankId = file.id; // il foglio vuoto va tolto se l'utente annulla
      activateFile(file);
    } else if (wasActive) {
      activateFile(STORE.activeFile(collection));
    } else {
      renderDocSwitcher(); // era un altro file: la lista basta aggiornarla
    }
    writeCollection();

    // Nel cestino (in cima: i più recenti per primi). Lo storico versioni NON
    // viene buttato: resta nell'archivio finché il documento è recuperabile.
    const entry = {
      id: newId('trash'),
      file: snapFile,
      index: idx,
      wasActive,
      createdBlankId,
      deletedAt: Date.now(),
    };
    trash.unshift(entry);
    enforceTrashLimits();
    writeTrash();
    renderDocSwitcher();

    showEditorToast(`"${ellipsize(title, 40)}" eliminato.`, {
      label: 'Annulla',
      onClick: () => restoreDeletedFile(entry),
    });
  }

  // Ripristina un file eliminato (dall'avviso "Annulla" o dal cestino): lo
  // reinserisce alla sua posizione, ne ripristina lo storico e, se era il file
  // aperto, lo riapre. Idempotente: premere due volte non duplica nulla.
  function restoreDeletedFile(entry) {
    if (!entry || !entry.file || !entry.file.id) return false;
    const file = entry.file;
    if (STORE.findFile(collection, file.id)) { // già rientrato: solo pulizia
      const i = trash.findIndex((e) => e.id === entry.id);
      if (i >= 0) { trash.splice(i, 1); writeTrash(); renderDocSwitcher(); }
      return false;
    }
    // Non perdere ciò che l'utente sta scrivendo su un ALTRO file nel frattempo.
    syncActiveIntoCollection();
    // Se avevo creato un foglio vuoto perché era l'ultimo file, toglilo — ma
    // SOLO se è rimasto vuoto: se nel frattempo l'utente ci ha scritto, quel
    // foglio è un documento vero e buttarlo sarebbe la perdita che vogliamo
    // evitare (resterebbe comunque nel cestino, ma sparirebbe senza motivo).
    if (entry.createdBlankId) {
      const blank = STORE.findFile(collection, entry.createdBlankId);
      const blankLive = (doc && doc.id === entry.createdBlankId) ? serialize() : blank;
      if (blank && fileIsEmpty(blankLive)) STORE.removeFile(collection, entry.createdBlankId);
    }
    const at = Math.max(0, Math.min(Number.isFinite(entry.index) ? entry.index : collection.files.length, collection.files.length));
    collection.files.splice(at, 0, cloneJson(file));
    if (entry.wasActive || !STORE.activeFile(collection)) {
      collection.activeId = file.id;
      activateFile(STORE.findFile(collection, file.id));
    }
    writeCollection();
    const i = trash.findIndex((e) => e.id === entry.id);
    if (i >= 0) { trash.splice(i, 1); writeTrash(); }
    renderDocSwitcher();
    showEditorToast('Documento ripristinato.');
    return true;
  }

  // ── Pannello "Cestino": vedi e recupera i documenti eliminati ─────────────
  // Invariante UX: se l'app conserva N documenti eliminati, l'utente deve
  // poterli vedere tutti — e poterli anche buttare davvero, se vuole.
  function trashEntryTitle(entry) {
    const f = entry && entry.file;
    return (f && f.meta && f.meta.title) || STORE.DEFAULT_TITLE;
  }
  function trashEntryPreview(entry) {
    const text = (VERS && entry && entry.file) ? VERS.plainText(entry.file) : '';
    if (!text) return '';
    const line = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' · ');
    return line.length > 180 ? line.slice(0, 179).trimEnd() + '…' : line;
  }
  function openTrashPanel() {
    closeDocPop();
    closeTitleMenu();
    renderTrashPanel();
  }
  function renderTrashPanel() {
    if (!trash.length) {
      openOverlay(`<h3>Cestino</h3>
        <p class="ed-vh-empty">Nessun documento eliminato. Quando ne elimini uno resta qui, con il suo testo e il suo storico, finché non lo butti davvero.</p>
        <div class="ed-overlay-actions"><button class="ed-btn primary" id="ovClose">Chiudi</button></div>`);
      $('ovClose').addEventListener('click', closeOverlay);
      staleClick.arm();
      return;
    }
    const rows = trash.map((e) => {
      const prev = trashEntryPreview(e);
      const prevHtml = prev ? escapeHtml(prev) : '<span class="ed-vh-noprev">(documento vuoto)</span>';
      const nVers = (VERS && versions[e.file.id] && Array.isArray(versions[e.file.id].versions))
        ? versions[e.file.id].versions.length : 0;
      const versNote = nVers ? ` · ${nVers} version${nVers === 1 ? 'e' : 'i'} nello storico` : '';
      return `<div class="ed-vh-item ed-tr-item" data-id="${escapeHtml(e.id)}">
        <div class="ed-vh-head">
          <span class="ed-tr-name">${escapeHtml(ellipsize(trashEntryTitle(e), 60))}</span>
          <span class="ed-vh-when">${escapeHtml(fmtVersionWhen(e.deletedAt))}${versNote}</span>
        </div>
        <div class="ed-vh-prev">${prevHtml}</div>
        <div class="ed-vh-actions">
          <button class="ed-btn ed-tr-restore" data-id="${escapeHtml(e.id)}">Ripristina</button>
          <button class="ed-btn ed-tr-purge" data-id="${escapeHtml(e.id)}">Elimina definitivamente</button>
        </div>
      </div>`;
    }).join('');
    openOverlay(`<h3>Cestino</h3>
      <p class="ed-vh-scope">I documenti eliminati restano qui (gli ultimi ${TRASH_MAX}) con testo, commenti, riquadri e storico versioni. Ripristinandone uno torna al suo posto nell'elenco.</p>
      <div class="ed-vh-list">${rows}</div>
      <div class="ed-overlay-actions">
        <button class="ed-btn ed-tr-empty" id="trEmpty">Svuota cestino</button>
        <button class="ed-btn primary" id="ovClose">Chiudi</button>
      </div>`);
    $('ovClose').addEventListener('click', closeOverlay);
    overlayBox.querySelectorAll('.ed-tr-restore').forEach((b) => b.addEventListener('click', () => {
      const entry = trash.find((e) => e.id === b.dataset.id);
      if (entry && restoreDeletedFile(entry)) closeOverlay();
    }));
    // Eliminare per sempre è l'UNICA azione irreversibile qui: chiede conferma
    // sul posto (il bottone diventa "Confermi?"), senza finestre di mezzo.
    // La conferma sul posto è a sua volta un elemento che compare SOTTO il
    // cursore: senza guardia bastava un doppio clic per bruciarla e cancellare
    // il documento per sempre in un colpo solo, che è il contrario di ciò che
    // una conferma serve a garantire.
    overlayBox.querySelectorAll('.ed-tr-purge').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.confirm !== '1') {
        b.dataset.confirm = '1';
        b.textContent = 'Confermi?';
        b.classList.add('danger');
        staleClick.arm();
        setTimeout(() => {
          if (!b.isConnected || b.dataset.confirm !== '1') return;
          b.dataset.confirm = '';
          b.textContent = 'Elimina definitivamente';
          b.classList.remove('danger');
        }, 4000);
        return;
      }
      purgeTrashEntry(b.dataset.id);
      writeTrash();
      renderTrashPanel();
      renderDocSwitcher();
    }));
    const emptyBtn = $('trEmpty');
    if (emptyBtn) emptyBtn.addEventListener('click', () => {
      if (emptyBtn.dataset.confirm !== '1') {
        emptyBtn.dataset.confirm = '1';
        emptyBtn.textContent = `Confermi? Elimini ${trash.length} document${trash.length === 1 ? 'o' : 'i'} per sempre`;
        emptyBtn.classList.add('danger');
        staleClick.arm();
        return;
      }
      for (const e of trash.slice()) purgeTrashEntry(e.id);
      writeTrash();
      renderTrashPanel();
      renderDocSwitcher();
    });
    // Il cestino si ridisegna dopo ogni eliminazione definitiva: stessa guardia
    // del pannello versioni sul secondo colpo di un doppio clic.
    staleClick.arm();
  }

  // Rinomina un documento (il nome mostrato nel menu e nel selettore).
  // `manual` (default true) segna che il titolo l'ha scelto l'utente: così la
  // generazione automatica del titolo (a ~100 parole) non lo sovrascrive mai.
  //
  // ATTENZIONE: il marchio "l'ha scelto l'utente" vale SOLO se il nome finale è
  // un nome vero. Aprire la rinomina e confermarla a vuoto (Invio su campo
  // vuoto, blur, o conferma del titolo di default) lascia il documento SENZA
  // nome: marcarlo comunque come manuale spegneva per sempre il titolo
  // automatico di quel documento. Il flag segue quindi il titolo risultante:
  // nome vero → true, documento di nuovo senza nome → false (auto-titolo di
  // nuovo possibile).
  function renameFileAction(id, title, { manual = true } = {}) {
    STORE.renameFile(collection, id, title);
    const f = STORE.findFile(collection, id);
    const named = !!(f && f.meta && f.meta.title && f.meta.title !== STORE.DEFAULT_TITLE);
    if (f && f.meta && manual) f.meta.titleManual = named;
    if (doc && doc.id === id && doc.meta && f && f.meta) {
      doc.meta.title = f.meta.title;
      if (manual) doc.meta.titleManual = named;
    }
    writeCollection();
    renderDocSwitcher();
  }

  // ── Titolo automatico dal contenuto (#379.4) ──────────────────────────
  // Quando un documento senza nome raggiunge ~100 parole, Filo gli propone UNA
  // VOLTA SOLA un titolo generato dal contenuto (più la conversazione del modulo
  // chat e la memoria di Filo come contesto). Il titolo resta modificabile a
  // mano e rigenerabile dal menu contestuale (tasto destro sul titolo).
  const AUTO_TITLE_WORDS = 100;
  let autoTitleBusy = false;

  const TITLE_SYSTEM_PROMPT =
    'Sei l\'assistente di Filo. Genera un TITOLO molto breve (2-6 parole) per il '
    + 'documento qui sotto, nella STESSA lingua del testo. Il titolo deve '
    + 'descrivere il contenuto del documento. Usa l\'eventuale conversazione e la '
    + 'memoria SOLO come contesto per capire meglio l\'argomento, non come oggetto '
    + 'del titolo. Rispondi SOLO col titolo: niente virgolette, niente punto '
    + 'finale, niente spiegazioni.';

  // Normalizza l'output del modello in un titolo pulito (prima riga, senza
  // virgolette/punteggiatura di contorno, lunghezza limitata).
  function cleanTitle(raw) {
    let t = String(raw == null ? '' : raw).trim();
    t = t.split(/\r?\n/)[0].trim();
    t = t.replace(/^["'«»“”`]+|["'«»“”`]+$/g, '').trim();
    t = t.replace(/^titolo\s*[:\-–—]\s*/i, '').trim();
    t = t.replace(/[.。·]+$/, '').trim();
    if (t.length > 80) t = t.slice(0, 80).trim();
    return t;
  }

  // Messaggi della/e chat dell'editor del file attivo (contesto per il titolo).
  function editorChatMessages() {
    const out = [];
    if (!doc || !Array.isArray(doc.modules)) return out;
    for (const m of doc.modules) {
      if (m.type !== 'chat' || !m.data || !Array.isArray(m.data.messages)) continue;
      for (const msg of m.data.messages) {
        const c = msg && typeof msg.content === 'string' ? msg.content.trim() : '';
        if (!c || c === '…') continue;
        out.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: c.slice(0, 1000) });
      }
    }
    return out.slice(-12);
  }

  // Estratto della memoria di Filo (profilo + preferenze) come contesto.
  async function filoMemoryText() {
    try {
      const r = await sendMessage({ type: MSG.FILO_GET_MEMORY });
      const mem = r && r.ok ? r.memory : null;
      if (!mem || typeof mem !== 'object') return '';
      const parts = [];
      if (mem.PROFILO && String(mem.PROFILO).trim()) parts.push('Profilo: ' + String(mem.PROFILO).trim());
      if (mem.PREFERENZE && String(mem.PREFERENZE).trim()) parts.push('Preferenze: ' + String(mem.PREFERENZE).trim());
      return parts.join('\n').slice(0, 1500);
    } catch (_) { return ''; }
  }

  // Applica un titolo generato dall'AI al file `id`: segna che è automatico (così
  // conta come "già generato" e non viene più riproposto in automatico) e toglie
  // il flag manuale (ora il titolo è dell'AI).
  function applyGeneratedTitle(id, raw) {
    const clean = cleanTitle(raw);
    if (!clean) return false;
    STORE.renameFile(collection, id, clean);
    const f = STORE.findFile(collection, id);
    if (f && f.meta) { f.meta.titleAuto = true; f.meta.titleManual = false; }
    if (doc && doc.id === id && doc.meta) {
      doc.meta.title = f.meta.title;
      doc.meta.titleAuto = true;
      doc.meta.titleManual = false;
    }
    writeCollection();
    renderDocSwitcher();
    return true;
  }

  // Genera (o rigenera) il titolo del file ATTIVO via il canale AI della chat.
  //  - auto:true  → tiro automatico a 100 parole, silenzioso, UNA VOLTA SOLA.
  //  - auto:false → rigenerazione esplicita dal menu (con feedback a video).
  async function generateTitleForActive({ auto } = {}) {
    if (!doc || !doc.meta) return false;
    const id = doc.id;
    if (auto) {
      // Segna SUBITO come "già tentato" così non si ripete a ogni battitura né si
      // moltiplicano le chiamate: la generazione automatica è una sola. In caso
      // di errore l'utente ha comunque "Rigenera titolo" nel menu contestuale.
      doc.meta.titleAuto = true;
      const f0 = STORE.findFile(collection, id);
      if (f0 && f0.meta) f0.meta.titleAuto = true;
      writeCollection();
    }
    const text = (docPlainText() || '').trim().slice(0, 6000);
    if (!text) { if (!auto) showEditorToast('Scrivi qualcosa prima di generare un titolo.'); return false; }
    const chat = editorChatMessages();
    const memory = await filoMemoryText();
    const parts = [`DOCUMENTO:\n${text}`];
    if (chat.length) {
      parts.push('CONVERSAZIONE COL DOCUMENTO (contesto):\n'
        + chat.map((m) => `${m.role === 'user' ? 'Utente' : 'Filo'}: ${m.content}`).join('\n'));
    }
    if (memory) parts.push('MEMORIA DI FILO (contesto su chi scrive):\n' + memory);
    const messages = [
      { role: 'system', content: TITLE_SYSTEM_PROMPT },
      { role: 'user', content: parts.join('\n\n') },
    ];
    if (!auto && docSwitchBtn) docSwitchBtn.classList.add('ed-doc-generating');
    try {
      const r = await sendMessage({
        type: MSG.AI_REQUEST, action: ACTIONS.EDITOR_TITLE || 'editor_title', payload: { messages },
      });
      const rawText = (r && r.ok && typeof r.text === 'string') ? r.text : null;
      if (rawText == null) { if (!auto) showEditorToast('Non sono riuscito a generare il titolo.'); return false; }
      const ok = applyGeneratedTitle(id, rawText);
      if (!ok && !auto) showEditorToast('Non sono riuscito a generare il titolo.');
      return ok;
    } catch (_) {
      if (!auto) showEditorToast('Non sono riuscito a generare il titolo.');
      return false;
    } finally {
      if (docSwitchBtn) docSwitchBtn.classList.remove('ed-doc-generating');
    }
  }

  // Tiro automatico: parte dall'input del testo, una sola volta, e solo se il
  // file non ha già un titolo scelto a mano.
  function maybeAutoTitle() {
    if (!doc || !doc.meta) return;
    if (doc.meta.titleAuto || doc.meta.titleManual) return;
    if (autoTitleBusy) return;
    if (textStats().words < AUTO_TITLE_WORDS) return;
    autoTitleBusy = true;
    Promise.resolve(generateTitleForActive({ auto: true })).finally(() => { autoTitleBusy = false; });
  }

  // ── Riassunto per file, mantenuto aggiornato (#379.5) ─────────────────────
  // Ogni file porta un RIASSUNTO di un paio di righe (`meta.summary`), generato
  // dallo stesso canale AI del titolo (testo + chat del documento + memoria).
  // A differenza del titolo (una-tantum) il riassunto si RIGENERA quando il file
  // cambia in modo significativo. Il riassunto entra nel contesto di Filo al
  // posto del testo integrale (lato main): qui lo produciamo e lo salviamo nella
  // collezione (rispecchiata su storage.json), così il main lo legge.
  const SUMMARY = window.SN_EDITOR_SUMMARY || null;
  const SUMMARY_DEBOUNCE_MS = 7000;
  let autoSummaryBusy = false;
  let summaryTimer = null;

  const SUMMARY_SYSTEM_PROMPT =
    'Sei l\'assistente di Filo. Scrivi un RIASSUNTO di 1-2 frasi (massimo due '
    + 'righe) che spieghi COSA CONTIENE il documento qui sotto, nella STESSA '
    + 'lingua del testo. Serve a orientarsi tra più file senza aprirli: descrivi '
    + 'l\'argomento e il tipo di contenuto, non i dettagli. Usa l\'eventuale '
    + 'conversazione e la memoria SOLO come contesto. Rispondi SOLO col riassunto: '
    + 'niente virgolette, niente preamboli, niente elenco.';

  function cleanSummary(raw) {
    let t = String(raw == null ? '' : raw).trim();
    t = t.replace(/^["'«»“”`]+|["'«»“”`]+$/g, '').trim();
    t = t.replace(/^riassunto\s*[:\-–—]\s*/i, '').trim();
    if (t.length > 400) t = t.slice(0, 400).trim() + '…';
    return t;
  }

  // Applica un riassunto generato al file `id`: lo salva e registra la "firma"
  // (numero di parole di adesso) per capire in futuro se il file è cambiato
  // abbastanza da giustificare una rigenerazione.
  function applyGeneratedSummary(id, raw) {
    const clean = cleanSummary(raw);
    if (!clean) return false;
    const f = STORE.findFile(collection, id);
    if (!f) return false;
    if (!f.meta) f.meta = {};
    f.meta.summary = clean;
    f.meta.summarySig = SUMMARY ? SUMMARY.makeSig(f) : { words: 0, at: Date.now() };
    f.meta.summaryAt = new Date().toISOString();
    if (doc && doc.id === id && doc.meta) {
      doc.meta.summary = clean;
      doc.meta.summarySig = f.meta.summarySig;
      doc.meta.summaryAt = f.meta.summaryAt;
    }
    writeCollection();
    return true;
  }

  // Genera (o rigenera) il riassunto del file ATTIVO via il canale AI della chat.
  async function generateSummaryForActive() {
    if (!doc || !doc.meta) return false;
    syncActiveIntoCollection();
    const id = doc.id;
    const text = (docPlainText() || '').trim().slice(0, 6000);
    if (!text) return false;
    const chat = editorChatMessages();
    const memory = await filoMemoryText();
    const parts = [`DOCUMENTO:\n${text}`];
    if (chat.length) {
      parts.push('CONVERSAZIONE COL DOCUMENTO (contesto):\n'
        + chat.map((m) => `${m.role === 'user' ? 'Utente' : 'Filo'}: ${m.content}`).join('\n'));
    }
    if (memory) parts.push('MEMORIA DI FILO (contesto su chi scrive):\n' + memory);
    const messages = [
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: parts.join('\n\n') },
    ];
    try {
      const r = await sendMessage({
        type: MSG.AI_REQUEST, action: ACTIONS.EDITOR_SUMMARY || 'editor_summary', payload: { messages },
      });
      const rawText = (r && r.ok && typeof r.text === 'string') ? r.text : null;
      if (rawText == null) return false;
      return applyGeneratedSummary(id, rawText);
    } catch (_) {
      return false;
    }
  }

  // Tiro automatico: dopo una pausa nella scrittura, (ri)genera il riassunto del
  // file attivo se serve (abbastanza testo e riassunto assente o stantìo). Il
  // debounce evita chiamate a ogni battitura; la firma evita rigenerazioni
  // inutili quando il contenuto è cambiato poco.
  function maybeAutoSummary() {
    if (!SUMMARY || !doc) return;
    if (summaryTimer) { clearTimeout(summaryTimer); summaryTimer = null; }
    summaryTimer = setTimeout(() => {
      summaryTimer = null;
      if (autoSummaryBusy || !doc) return;
      syncActiveIntoCollection();
      const f = STORE.findFile(collection, doc.id);
      if (!f || !SUMMARY.needsSummary(f)) return;
      autoSummaryBusy = true;
      Promise.resolve(generateSummaryForActive()).finally(() => { autoSummaryBusy = false; });
    }, SUMMARY_DEBOUNCE_MS);
  }

  // Duplica il file attivo (contenuto, moduli e commenti); il titolo derivato è
  // segnato come "a mano" così non viene rigenerato in automatico.
  function duplicateActiveFile() {
    if (!doc) return;
    syncActiveIntoCollection();
    const src = STORE.findFile(collection, doc.id);
    if (!src) return;
    const copy = JSON.parse(JSON.stringify(src));
    delete copy.id;
    if (!copy.meta) copy.meta = {};
    copy.meta.title = ((src.meta && src.meta.title) || STORE.DEFAULT_TITLE) + ' (copia)';
    copy.meta.titleManual = true;
    copy.meta.titleAuto = true;
    const file = STORE.addFile(collection, copy, () => newId('file'));
    activateFile(file);
    writeCollection();
    closeDocPop();
  }

  // ── Menu contestuale sul titolo (tasto destro) ────────────────────────
  // Coerente con PATTERNS.md § "Menu contestuale proprio nelle pagine filo://":
  // preventDefault + popup con le classi .sn-select-pop/.sn-select-option.
  let titleMenuEl = null;
  function closeTitleMenu() {
    if (!titleMenuEl) return;
    titleMenuEl.remove();
    titleMenuEl = null;
    staleClick.arm(); // il menu sparisce da sotto il cursore
    document.removeEventListener('mousedown', onTitleMenuOutside, true);
    document.removeEventListener('keydown', onTitleMenuKeydown, true);
    window.removeEventListener('scroll', closeTitleMenu, true);
    window.removeEventListener('resize', closeTitleMenu);
  }
  function onTitleMenuOutside(e) {
    if (titleMenuEl && !titleMenuEl.contains(e.target)) closeTitleMenu();
  }
  function onTitleMenuKeydown(e) {
    if (e.key === 'Escape') closeTitleMenu();
  }
  function openTitleMenu(x, y) {
    closeTitleMenu();
    closeDocPop();
    const menu = document.createElement('div');
    menu.className = 'sn-select-pop ed-title-ctxmenu';
    menu.setAttribute('role', 'menu');
    const add = (label, onClick) => {
      const o = document.createElement('div');
      o.className = 'sn-select-option';
      o.setAttribute('role', 'menuitem');
      o.textContent = label;
      o.addEventListener('click', () => { closeTitleMenu(); onClick(); });
      menu.appendChild(o);
    };
    add('Rigenera titolo', () => generateTitleForActive({ auto: false }));
    add('Rigenera riassunto', () => {
      if (autoSummaryBusy) return;
      autoSummaryBusy = true;
      Promise.resolve(generateSummaryForActive())
        .then((ok) => { if (!ok) showEditorToast('Scrivi qualcosa prima di generare un riassunto.'); })
        .finally(() => { autoSummaryBusy = false; });
    });
    add('Storico versioni', () => openVersionHistory());
    // Parità di cammini col menu documenti: se c'è qualcosa nel cestino lo si
    // raggiunge anche col tasto destro sul titolo.
    if (trash.length) add(`Cestino (${trash.length})`, () => openTrashPanel());
    add('Rinomina', () => startDocTitleRename());
    add('Duplica file', () => duplicateActiveFile());
    add('Elimina file', () => { if (doc) deleteFile(doc.id); });
    document.body.appendChild(menu);
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = `${Math.max(4, Math.min(x, vw - w - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, vh - h - 4))}px`;
    titleMenuEl = menu;
    setTimeout(() => {
      document.addEventListener('mousedown', onTitleMenuOutside, true);
      document.addEventListener('keydown', onTitleMenuKeydown, true);
      window.addEventListener('scroll', closeTitleMenu, true);
      window.addEventListener('resize', closeTitleMenu);
    }, 0);
  }

  // Rinomina inline dalla docbar (senza aprire il menu documenti): mostra un
  // input al posto del titolo e conferma su Invio/blur.
  function startDocTitleRename() {
    if (!doc || !docbarEl) return;
    closeDocPop();
    if (docbarEl.querySelector('.ed-doc-title-input')) return;
    const cur = (doc.meta && doc.meta.title && doc.meta.title !== STORE.DEFAULT_TITLE) ? doc.meta.title : '';
    const input = document.createElement('input');
    input.className = 'ed-doc-title-input';
    input.type = 'text';
    input.value = cur;
    input.placeholder = STORE.DEFAULT_TITLE;
    input.setAttribute('aria-label', 'Nuovo nome del documento');
    if (docSwitchBtn) docSwitchBtn.style.display = 'none';
    docbarEl.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const val = input.value;
      if (docSwitchBtn) docSwitchBtn.style.display = '';
      input.remove();
      if (save) renameFileAction(doc.id, val, { manual: true });
      else renderDocSwitcher();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  // ── Menu documenti (selettore in alto a sinistra) ─────────────────────
  function activeTitle() {
    const f = STORE.activeFile(collection);
    return (f && f.meta && f.meta.title) || 'Documento senza titolo';
  }

  function renderDocSwitcher() {
    if (docTitleEl) docTitleEl.textContent = activeTitle();
    if (docSwitchBtn) docSwitchBtn.title = activeTitle();
    if (!docPopEl || docPopEl.hidden) return;
    buildDocPop();
  }

  function buildDocPop() {
    docPopEl.innerHTML = '';
    for (const f of collection.files) {
      const item = document.createElement('div');
      item.className = 'ed-doc-item' + (f.id === collection.activeId ? ' active' : '');
      item.setAttribute('role', 'option');
      item.dataset.id = f.id;

      const name = document.createElement('span');
      name.className = 'ed-doc-item-name';
      name.textContent = (f.meta && f.meta.title) || 'Documento senza titolo';
      item.appendChild(name);

      // Apri il file cliccando la riga (ma non le azioni).
      item.addEventListener('click', (e) => {
        if (e.target.closest('.ed-doc-act') || e.target.closest('.ed-doc-item-input')) return;
        switchToFile(f.id);
      });

      // Rinomina (matita). Doppio click sul nome apre lo stesso editor inline.
      const renBtn = actButton('✎', 'Rinomina', () => startInlineRename(item, f));
      renBtn.classList.add('ed-doc-rename');
      name.addEventListener('dblclick', (e) => { e.stopPropagation(); startInlineRename(item, f); });
      item.appendChild(renBtn);

      // Elimina (×). Con un solo file l'elimina crea un nuovo foglio vuoto.
      const delBtn = actButton(ICONS.close ? ICONS.close(14) : '×', 'Elimina', () => deleteFile(f.id));
      delBtn.classList.add('ed-doc-del');
      item.appendChild(delBtn);

      docPopEl.appendChild(item);
    }
    const sep = document.createElement('div');
    sep.className = 'ed-doc-sep';
    docPopEl.appendChild(sep);
    const nu = document.createElement('button');
    nu.type = 'button';
    nu.className = 'ed-doc-new';
    nu.id = 'docNew';
    nu.innerHTML = `${ICONS.plus ? ICONS.plus(14) : '+'}<span>Nuovo documento</span>`;
    nu.addEventListener('click', createFile);
    docPopEl.appendChild(nu);
    // Storico versioni del documento attivo: stessa affordance del "Nuovo
    // documento", così la si trova dal menu in alto a sinistra (oltre che dal
    // tasto destro sul foglio). Parità di cammini.
    const hist = document.createElement('button');
    hist.type = 'button';
    hist.className = 'ed-doc-new ed-doc-history';
    hist.id = 'docHistory';
    hist.innerHTML = `${ICONS.history ? ICONS.history(14) : '⟲'}<span>Storico versioni</span>`;
    hist.addEventListener('click', () => { closeDocPop(); openVersionHistory(); });
    docPopEl.appendChild(hist);
    // Cestino: compare solo quando c'è qualcosa da recuperare (una voce sempre
    // presente e sempre vuota sarebbe solo rumore nel menu).
    if (trash.length) {
      const bin = document.createElement('button');
      bin.type = 'button';
      bin.className = 'ed-doc-new ed-doc-trash';
      bin.id = 'docTrash';
      bin.title = 'Recupera un documento eliminato';
      bin.innerHTML = `${ICONS.reload ? ICONS.reload(14) : '⟲'}<span>Cestino (${trash.length})</span>`;
      bin.addEventListener('click', openTrashPanel);
      docPopEl.appendChild(bin);
    }
    // Il menu si ricostruisce anche mentre è aperto (eliminando un documento la
    // lista si accorcia e le righe salgono di un posto): stessa coda di gesto
    // del pannello versioni, qui col prezzo più alto — il colpo di coda cadeva
    // sulla × del documento sotto e ne eliminava due invece di uno.
    staleClick.arm();
  }

  function actButton(glyph, title, onAct) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ed-doc-act';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = glyph;
    b.addEventListener('click', (e) => { e.stopPropagation(); onAct(); });
    return b;
  }

  function startInlineRename(item, f) {
    const name = item.querySelector('.ed-doc-item-name');
    if (!name) return;
    const input = document.createElement('input');
    input.className = 'ed-doc-item-input';
    input.type = 'text';
    // Stessa regola della rinomina dalla docbar: "Documento senza titolo" non è
    // un nome, è l'assenza di un nome — quindi va come segnaposto, non come
    // testo già scritto da riscrivere.
    const curName = (f.meta && f.meta.title) || '';
    input.value = curName === STORE.DEFAULT_TITLE ? '' : curName;
    input.placeholder = STORE.DEFAULT_TITLE;
    input.setAttribute('aria-label', 'Nuovo nome del documento');
    let done = false;
    const commit = (save) => {
      if (done) return;
      done = true;
      if (save) renameFileAction(f.id, input.value);
      else renderDocSwitcher();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    input.addEventListener('blur', () => commit(true));
    name.replaceWith(input);
    input.focus();
    input.select();
  }

  function openDocPop() {
    if (!docPopEl || !docPopEl.hidden) return;
    buildDocPop();
    docPopEl.hidden = false;
    docSwitchBtn.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', onDocPopOutside, true);
  }
  function closeDocPop() {
    if (!docPopEl || docPopEl.hidden) return;
    docPopEl.hidden = true;
    staleClick.arm(); // il menu sparisce: sotto il cursore resta il foglio
    if (docSwitchBtn) docSwitchBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onDocPopOutside, true);
  }
  function onDocPopOutside(e) {
    if (docbarEl && !docbarEl.contains(e.target)) closeDocPop();
  }
  if (docSwitchBtn) {
    docSwitchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      docPopEl.hidden ? openDocPop() : closeDocPop();
    });
    // Tastiera, parità col tasto destro: Shift+F10 / tasto Menu apre il menu
    // contestuale del titolo ancorato alla docbar.
    docSwitchBtn.addEventListener('keydown', (e) => {
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const r = docSwitchBtn.getBoundingClientRect();
        openTitleMenu(r.left, r.bottom);
      }
    });
  }
  // Tasto destro sul titolo (o su tutta la docbar): menu contestuale del file.
  if (docbarEl) {
    docbarEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openTitleMenu(e.clientX, e.clientY);
    });
  }

  // ════════════════════════════════════════════════════════════════════
  //  EDITOR DI TESTO (contenteditable ↔ JSON ProseMirror)
  // ════════════════════════════════════════════════════════════════════

  const MARK_TAGS = { B: 'bold', STRONG: 'bold', I: 'italic', EM: 'italic', U: 'underline', S: 'strike', STRIKE: 'strike', DEL: 'strike' };

  // Immagini incollate nel foglio. Il documento è un modello JSON che riconosce
  // solo blocchi/marche di testo: un <img> senza nodo corrispondente veniva
  // scartato al primo salvataggio, così l'immagine spariva al reload. Le
  // trattiamo come nodo inline `image` con solo src (+ alt): nessun handler
  // (onerror…) né altro attributo sopravvive al round-trip, quindi un <img>
  // ostile incollato non può eseguire codice quando il foglio si ricostruisce.
  // Src ammesse: data:image/… (il caso dell'incolla), http(s) e blob:.
  const IMG_SRC_OK = /^(data:image\/|https?:|blob:)/i;
  function imgToPM(el) {
    const src = (el.getAttribute('src') || '').trim();
    if (!IMG_SRC_OK.test(src)) return null;
    const alt = el.getAttribute('alt') || '';
    return { type: 'image', attrs: { src, ...(alt ? { alt } : {}) } };
  }

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
      if (el.tagName === 'IMG') { const img = imgToPM(el); if (img) out.push(img); return; }
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
      } else if (tag === 'IMG') {
        // Immagine incollata come figlia diretta del foglio (contenteditable la
        // lascia spesso fuori da qualsiasi paragrafo): incapsulala in un
        // paragrafo così ha un blocco che la contiene nel modello.
        const img = imgToPM(el);
        if (img) content.push({ type: 'paragraph', content: [img] });
      }
    });
    if (!content.length) content.push({ type: 'paragraph', content: [] });
    return { type: 'doc', content };
  }

  // Escapa anche le virgolette (doppie e singole): escapeHtml è usata pure
  // dentro attributi delimitati da virgolette (style="font-family:…",
  // value="…"). I nomi di font composti ("Times New Roman", Times, serif)
  // contengono virgolette doppie letterali: senza &quot; l'attributo style si
  // chiuderebbe alla prima virgoletta e la formattazione andrebbe persa al
  // round-trip salva→render.
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function inlineToHtml(nodes) {
    if (!Array.isArray(nodes)) return '';
    return nodes.map((n) => {
      if (n.type === 'hardBreak') return '<br>';
      if (n.type === 'image' && n.attrs && IMG_SRC_OK.test(String(n.attrs.src || '').trim())) {
        const alt = n.attrs.alt ? ` alt="${escapeHtml(n.attrs.alt)}"` : '';
        return `<img src="${escapeHtml(String(n.attrs.src).trim())}"${alt}>`;
      }
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
      const alignStyle = b.attrs?.align ? ` style="text-align:${escapeHtml(b.attrs.align)}"` : '';
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
    // Documento vuoto → paragrafo con <br> così il caret ha dove posarsi. Un
    // foglio con la sola immagine (nessun testo) NON è vuoto: senza il controllo
    // sull'<img> verrebbe azzerato e l'immagine persa al reload.
    if (!docEl.firstChild || (!docEl.textContent.trim() && !docEl.querySelector('img'))) docEl.innerHTML = '<p><br></p>';
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
  // Nasconde/mostra i fratelli di un titolo fino al prossimo titolo di pari o
  // superiore livello.
  function applyCollapseToSiblings(h, collapsing) {
    const lvl = headingLevel(h);
    let sib = h.nextElementSibling;
    while (sib) {
      const sl = headingLevel(sib);
      if (sl > 0 && sl <= lvl) break;
      sib.classList.toggle('ed-hidden-by-collapse', collapsing);
      sib = sib.nextElementSibling;
    }
  }
  // Ricalcola DA CAPO chi è nascosto, partendo solo da `data-collapsed` sui
  // titoli (l'unica fonte di verità dello stato di collasso) e riallinea le
  // frecce. Ricalcolare invece di "togglare in loco" è ciò che rende corretto
  // il caso annidato: riaprendo un titolo di livello alto, le sotto-sezioni
  // ancora chiuse restano chiuse invece di sbucare tutte insieme.
  function reapplyCollapseState() {
    docEl.querySelectorAll('.ed-hidden-by-collapse').forEach((el) => el.classList.remove('ed-hidden-by-collapse'));
    docEl.querySelectorAll('h1, h2, h3').forEach((h) => {
      const collapsed = h.dataset.collapsed === '1';
      const btn = h.querySelector('.ed-collapse-toggle');
      if (btn) btn.classList.toggle('is-collapsed', collapsed);
      if (collapsed) applyCollapseToSiblings(h, true);
    });
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
    // Lo stato di collasso vive sul titolo (`data-collapsed`), non sul bottone:
    // ogni digitazione ricrea i bottoni, ma il titolo sopravvive. Ripristina le
    // frecce e ri-nascondi i fratelli, così una sezione chiusa resta chiusa e
    // coerente anche dopo aver scritto un carattere (e nuovo contenuto in una
    // sezione chiusa nasce nascosto, non "sbucato").
    reapplyCollapseState();
  }
  function toggleCollapse(h, btn) {
    const collapsing = !btn.classList.contains('is-collapsed');
    if (collapsing) h.dataset.collapsed = '1';
    else delete h.dataset.collapsed;
    // Toccata la freccia, quella sezione è dell'utente: la ricerca non la
    // richiude più da sé (né la considera più roba sua).
    delete h.dataset.searchOpened;
    reapplyCollapseState();
  }
  // Blocco di primo livello (figlio diretto del foglio) che contiene `node`.
  function topLevelBlockOf(node) {
    let el = node && node.nodeType === 1 ? node : (node && node.parentElement);
    while (el && el.parentElement && el.parentElement !== docEl) el = el.parentElement;
    return el && el.parentElement === docEl ? el : null;
  }
  // Catena dei titoli che GOVERNANO il blocco di `node`, dal più vicino al più
  // esterno. Solo i titoli di livello più alto (numero minore) possono
  // nasconderlo: risalendo i fratelli precedenti si tiene la catena scendendo
  // di livello, e ci si ferma al primo H1.
  function governingHeadings(node) {
    const chain = [];
    const el = topLevelBlockOf(node);
    if (!el) return chain;
    let minLvl = headingLevel(el) || Infinity;
    let sib = el.previousElementSibling;
    while (sib) {
      const lvl = headingLevel(sib);
      if (lvl > 0 && lvl < minLvl) {
        minLvl = lvl;
        chain.push(sib);
        if (lvl === 1) break;
      }
      sib = sib.previousElementSibling;
    }
    return chain;
  }
  // Riapre le sezioni chiuse che stanno nascondendo `node`, così qualsiasi cosa
  // ci si voglia fare (portarci la vista, sostituire una parola) avvenga sotto
  // gli occhi dell'utente. Ritorna true se ha davvero riaperto qualcosa.
  //
  // `opts.temporary` marca l'apertura come PRESTITO della ricerca: è
  // un'apertura di passaggio, non una scelta dell'utente, e si richiude da sé
  // appena la ricerca si sposta altrove o finisce (feedback #385 bis: cercando
  // lettera per lettera restavano aperte le sezioni delle corrispondenze
  // intermedie, e l'impaginazione costruita a mano andava rifatta).
  function revealCollapsedFor(node, opts) {
    const el = topLevelBlockOf(node);
    if (!el || !el.classList.contains('ed-hidden-by-collapse')) return false;
    let opened = false;
    for (const h of governingHeadings(node)) {
      if (h.dataset.collapsed !== '1') continue;
      delete h.dataset.collapsed;
      if (opts && opts.temporary) h.dataset.searchOpened = '1';
      opened = true;
    }
    if (opened) reapplyCollapseState();
    return opened;
  }
  // Le sezioni che nascondevano `node` diventano dell'utente: aperte per una
  // ragione che resta valida anche quando la ricerca se ne va (ci ha scritto
  // dentro, o ci è stata sostituita una parola e deve poterla vedere).
  function keepRevealedFor(node) {
    governingHeadings(node).forEach((h) => { delete h.dataset.searchOpened; });
  }
  // Se il cursore è dentro una sezione aperta in prestito dalla ricerca, quella
  // sezione smette di essere in prestito: nessun testo sparisce da sotto il
  // cursore mentre l'utente ci sta lavorando.
  function keepRevealedAtCaret() {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode || !docEl.contains(sel.anchorNode)) return;
    keepRevealedFor(sel.anchorNode);
  }
  // Richiude tutte le sezioni aperte in prestito dalla ricerca, tranne quelle
  // che stanno mostrando `keepNode` (la corrispondenza su cui si è adesso).
  // Le sezioni aperte a mano dall'utente non hanno il marchio e non si toccano.
  function closeBorrowedSectionsExcept(keepNode) {
    keepRevealedAtCaret();
    const keep = new Set(keepNode ? governingHeadings(keepNode) : []);
    let changed = false;
    docEl.querySelectorAll('h1[data-search-opened], h2[data-search-opened], h3[data-search-opened]').forEach((h) => {
      if (keep.has(h)) return;
      delete h.dataset.searchOpened;
      h.dataset.collapsed = '1';
      changed = true;
    });
    if (changed) reapplyCollapseState();
    return changed;
  }

  function onDocInput() {
    // Scrivere dentro una sezione che aveva aperto la ricerca la rende
    // dell'utente: non gli si richiuderà sotto le mani.
    keepRevealedAtCaret();
    refreshCollapseToggles();
    markDirty();
    updateWordCountModules();
    maybeAutoTitle();
    maybeAutoSummary();
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
  // L'editor zooma il foglio, non la finestra: il preload deve stare fuori
  // (altrimenti Ctrl+rotella e Ctrl+/- zoomerebbero due volte).
  try { document.documentElement.dataset.filoOwnZoom = '1'; } catch (_) {}
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
    // Guardia difensiva: non si aggiunge un modulo fisso né un secondo singleton
    // (es. un secondo switch), anche se un payload di drag arrivasse comunque qui.
    if (!meta || !canAddType(type)) return;
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
    const items = Object.entries(MODULE_TYPES).filter(([type]) => canAddType(type)).map(([type, meta]) => `
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
  // Estrae il testo del documento inserendo un separatore ai confini di blocco.
  // docEl.textContent concatena i blocchi (p/div/li/h…) SENZA separatore, così
  // l'ultima parola di un blocco e la prima del successivo si fondono (es.
  // "Hello world" + "Foo bar" → "Hello worldFoo bar") e parole/caratteri/frasi
  // risultano sottostimati su più righe. Ricostruiamo il testo a mano — niente
  // dipendenza dal layout come innerText — aggiungendo "\n" dopo ogni blocco e
  // per ogni <br>.
  function docPlainText() {
    const BLOCK = /^(P|DIV|LI|H[1-6]|BLOCKQUOTE|PRE|UL|OL|SECTION|ARTICLE|FIGURE|FIGCAPTION|TABLE|TR|HR)$/;
    let out = '';
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          out += child.nodeValue;
        } else if (child.nodeType === 1) {
          if (child.tagName === 'BR') { out += '\n'; continue; }
          const block = BLOCK.test(child.tagName);
          walk(child);
          if (block && !out.endsWith('\n')) out += '\n';
        }
      }
    };
    walk(docEl);
    return out;
  }
  function textStats() {
    const text = (docPlainText() || '').replace(/ /g, ' ').trim();
    // Una "parola" ha almeno un carattere alfanumerico: i token di sola
    // punteggiatura (",,,", "...") non contano come parole.
    const words = text ? text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length : 0;
    const chars = text.length;
    // Le frasi hanno senso solo se c'è almeno una parola reale.
    const sentences = words ? (text.match(/[.!?]+(\s|$)/g) || []).length || 1 : 0;
    // Conta solo i blocchi con contenuto reale: il <p> vuoto iniziale del
    // contenteditable non è un paragrafo.
    const paragraphs = Array.from(docEl.querySelectorAll('p, h1, h2, h3, li, blockquote'))
      .filter((el) => (el.textContent || '').trim()).length;
    // Nessuna parola → nessun tempo di lettura (niente minimo forzato a 1 min).
    const readingMin = words ? Math.max(1, Math.round(words / 200)) : 0;
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
  // Quanto la ricerca aspetta, dopo l'ultimo tasto premuto, prima di "andare"
  // sulla corrispondenza (aprire la sezione chiusa che la nasconde e portarci
  // la vista). Scrivendo "ornitorinco" lettera per lettera le corrispondenze
  // intermedie ("o" → ottimo, "or" → orso) sono di passaggio: senza pausa la
  // ricerca inseguirebbe ognuna di esse aprendo sezioni che non c'entrano.
  const FIND_REVEAL_DELAY_MS = 350;
  let findRevealTimer = null;
  function cancelFindReveal() {
    if (!findRevealTimer) return false;
    clearTimeout(findRevealTimer); findRevealTimer = null;
    return true;
  }
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
    const updateCount = () => { countEl.textContent = findState.hits.length ? `${findState.idx + 1}/${findState.hits.length}` : (findInput.value ? 'nessun risultato' : ''); };
    const run = () => { runFind(findInput.value); updateCount(); };
    findInput.addEventListener('input', run);
    findInput.addEventListener('click', (e) => e.stopPropagation());
    // Invio = "vai lì" (Shift+Invio: indietro), come in qualsiasi campo di
    // ricerca: è il modo esplicito di spostarsi senza aspettare la pausa.
    findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        jumpFind(e.shiftKey ? -1 : 1);
        updateCount();
        return;
      }
      // Esc = "ho finito di cercare": via le evidenziazioni e via le sezioni
      // aperte solo per mostrare i risultati, il foglio torna com'era.
      if (e.key === 'Escape') {
        e.preventDefault();
        findInput.value = '';
        runFind('', { immediate: true });
        updateCount();
      }
    });
    replInput.addEventListener('click', (e) => e.stopPropagation());
    pad.querySelector('[data-sr="next"]').addEventListener('click', (e) => { e.stopPropagation(); stepFind(1); updateCount(); });
    pad.querySelector('[data-sr="prev"]').addEventListener('click', (e) => { e.stopPropagation(); stepFind(-1); updateCount(); });
    // NB: dopo replaceOne NON si rilancia run(): ri-eseguire la ricerca
    // azzererebbe l'indice alla prima corrispondenza e ri-matcherebbe dentro
    // il testo appena inserito (feedback #310). replaceOne avanza da sé.
    pad.querySelector('[data-sr="one"]').addEventListener('click', (e) => { e.stopPropagation(); replaceOne(replInput.value); updateCount(); });
    pad.querySelector('[data-sr="all"]').addEventListener('click', (e) => { e.stopPropagation(); replaceAll(findInput.value, replInput.value); run(); });
  }
  function clearFind() {
    // Uno spostamento ancora in attesa punterebbe a evidenziazioni che stiamo
    // per smontare: si annulla qui e lo ripianifica chi rilancia la ricerca.
    cancelFindReveal();
    docEl.querySelectorAll('mark.ed-find-hit').forEach((mk) => {
      const parent = mk.parentNode;
      while (mk.firstChild) parent.insertBefore(mk.firstChild, mk);
      parent.removeChild(mk);
      parent.normalize();
    });
    findState = { hits: [], idx: -1, term: '' };
  }
  // Blocco (p/div/h/li/blockquote) più interno che contiene un nodo testo, o
  // docEl come fallback. La ricerca lavora sul testo CONCATENATO di un blocco,
  // non nodo per nodo: così trova le parole spezzate da un tag inline
  // (grassetto/corsivo/sottolineato) — che il browser rappresenta come più nodi
  // testo ("al" + "fa") — senza però matchare a cavallo di due paragrafi
  // (feedback #228).
  function findBlockOf(node) {
    let el = node.parentElement;
    while (el && el !== docEl) {
      if (/^(P|DIV|H1|H2|H3|LI|BLOCKQUOTE)$/.test(el.tagName)) return el;
      el = el.parentElement;
    }
    return docEl;
  }
  // Nodi testo del blocco `block`, in ordine, escludendo: i toggle di collasso
  // (UI iniettata), il testo già dentro un mark di ricerca (per non ri-matcharlo)
  // e il testo appartenente a un blocco annidato (processato a parte).
  function findTextNodesOfBlock(block) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if (!n.parentElement) return NodeFilter.FILTER_REJECT;
        if (n.parentElement.closest('.ed-collapse-toggle')) return NodeFilter.FILTER_REJECT;
        if (n.parentElement.closest('mark.ed-find-hit')) return NodeFilter.FILTER_REJECT;
        if (findBlockOf(n) !== block) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    let n; while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }
  // Avvolge l'intervallo [from,to) del testo concatenato di un blocco (dato come
  // lista ordinata di nodi testo) in uno o più <mark.ed-find-hit> — uno per nodo
  // testo intersecato. Una singola occorrenza può quindi vivere in più mark
  // (parte normale + parte in grassetto): il chiamante li raggruppa in UN hit.
  function wrapFindRange(nodes, from, to) {
    const marks = [];
    let cum = 0;
    for (const tn of nodes) {
      const len = tn.nodeValue.length;
      const s = Math.max(from - cum, 0);
      const e = Math.min(to - cum, len);
      cum += len;
      if (e <= s) { if (cum >= to) break; continue; }
      let target = tn;
      if (s > 0) target = target.splitText(s);
      if (e - s < target.nodeValue.length) target.splitText(e - s);
      const mk = document.createElement('mark');
      mk.className = 'ed-find-hit';
      const parent = target.parentNode;
      parent.insertBefore(mk, target);
      mk.appendChild(target);
      marks.push(mk);
      if (cum >= to) break;
    }
    return marks;
  }
  function runFind(term, opts) {
    clearFind();
    if (!term) {
      // Campo svuotato: nessuna corrispondenza da mostrare, e le sezioni che la
      // ricerca aveva aperto in prestito tornano chiuse come le aveva lasciate
      // l'utente.
      highlightCurrent(opts);
      return;
    }
    findState.term = term;
    // Elenco (in ordine documento) dei blocchi che contengono testo cercabile.
    const walker = document.createTreeWalker(docEl, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => n.parentElement && n.parentElement.closest('.ed-collapse-toggle') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const blocks = [];
    const seen = new Set();
    let n; while ((n = walker.nextNode())) {
      const b = findBlockOf(n);
      if (!seen.has(b)) { seen.add(b); blocks.push(b); }
    }
    const lc = term.toLowerCase();
    for (const block of blocks) {
      // Cerca sul testo concatenato del blocco; a ogni match lo avvolge (i suoi
      // nodi escono dall'haystack alla passata dopo, perché già dentro un mark),
      // così il match successivo si trova e gli offset restano validi.
      while (true) {
        const nodes = findTextNodesOfBlock(block);
        const text = nodes.map((t) => t.nodeValue).join('');
        const i = text.toLowerCase().indexOf(lc);
        if (i < 0) break;
        const marks = wrapFindRange(nodes, i, i + term.length);
        if (!marks.length) break; // difesa: mai loop infinito
        findState.hits.push({ marks });
      }
    }
    if (findState.hits.length) findState.idx = 0;
    // Anche senza risultati si passa di qui: è il momento in cui si richiudono
    // le sezioni aperte per la ricerca di prima.
    highlightCurrent(opts);
  }
  // Evidenzia la corrispondenza corrente e programma l'"andarci sopra".
  //
  // Evidenziazione e contatore sono SEMPRE immediati (l'utente vede subito che
  // la ricerca risponde). Ciò che aspetta è lo spostamento: aprire la sezione
  // chiusa che nasconde la corrispondenza e scorrere fin lì. Mentre si scrive
  // aspetta una pausa (`FIND_REVEAL_DELAY_MS`); quando la navigazione è
  // esplicita (Prec/Succ, Invio, Sostituisci) avviene subito.
  function highlightCurrent(opts) {
    findState.hits.forEach((h, i) => h.marks.forEach((mk) => mk.classList.toggle('current', i === findState.idx)));
    cancelFindReveal();
    const cur = findState.hits[findState.idx];
    const node = cur && cur.marks[0] ? cur.marks[0] : null;
    const go = () => {
      findRevealTimer = null;
      // Prima si richiudono le sezioni aperte in prestito per le corrispondenze
      // di prima: resta aperta solo quella dove ci si è davvero fermati. Se il
      // campo è stato svuotato (nessuna corrispondenza) si richiudono tutte, e
      // l'impaginazione dell'utente torna com'era.
      closeBorrowedSectionsExcept(node);
      if (!node) return;
      // Una corrispondenza dentro una sezione chiusa è invisibile: il contatore
      // direbbe "1/1" mentre sul foglio non si illumina niente e Prec/Succ non
      // portano da nessuna parte. La sezione si riapre da sé, poi la vista ci
      // arriva sopra (feedback #385).
      revealCollapsedFor(node, { temporary: true });
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    if (opts && opts.immediate) go();
    else findRevealTimer = setTimeout(go, FIND_REVEAL_DELAY_MS);
  }
  function stepFind(dir) {
    if (!findState.hits.length) return;
    findState.idx = (findState.idx + dir + findState.hits.length) % findState.hits.length;
    highlightCurrent({ immediate: true });
  }
  // Invio nel campo Cerca = "portami sulla corrispondenza". Se lo spostamento
  // era ancora in attesa della pausa di scrittura lo esegue subito su quella
  // corrente; altrimenti passa alla successiva (Shift+Invio: la precedente).
  function jumpFind(dir) {
    if (!findState.hits.length) return;
    if (cancelFindReveal() && dir > 0) { highlightCurrent({ immediate: true }); return; }
    stepFind(dir);
  }
  // Rimpiazza tutti i mark di un hit col testo di sostituzione (nel primo mark;
  // gli altri — le altre porzioni di una parola formattata — vengono rimossi,
  // insieme ai wrapper di formattazione rimasti vuoti, es. <strong></strong>).
  function replaceHitMarks(hit, replacement) {
    const marks = hit.marks;
    const first = marks[0];
    const firstParent = first.parentNode;
    first.replaceWith(document.createTextNode(replacement));
    for (let k = marks.length - 1; k >= 1; k--) {
      const p = marks[k].parentNode;
      marks[k].remove();
      let anc = p;
      while (anc && anc !== docEl && anc.nodeType === 1 && !anc.textContent && /^(STRONG|B|EM|I|U|S|SPAN)$/.test(anc.tagName)) {
        const up = anc.parentNode; anc.remove(); anc = up;
      }
      if (p && p.isConnected) p.normalize();
    }
    if (firstParent) firstParent.normalize();
  }
  function replaceOne(replacement) {
    const cur = findState.hits[findState.idx];
    if (!cur) return;
    // Niente sostituzioni invisibili: se la corrispondenza è ancora in una
    // sezione chiusa (lo spostamento poteva essere in attesa della pausa) la si
    // apre PRIMA di toccare il testo. Questa apertura NON è in prestito: lì il
    // testo è cambiato, l'utente deve poterlo vedere e restare aperta.
    cancelFindReveal();
    revealCollapsedFor(cur.marks[0]);
    keepRevealedFor(cur.marks[0]);
    // Sostituisce SOLO la corrispondenza corrente e avanza alla successiva
    // senza ri-eseguire la ricerca: una ri-scansione ripartirebbe dalla prima
    // corrispondenza e ri-troverebbe il termine dentro il testo appena
    // inserito (es. cerca "cat", sostituisci "cats" → loop sulla stessa parola).
    replaceHitMarks(cur, replacement);
    findState.hits.splice(findState.idx, 1);
    if (!findState.hits.length) {
      findState.idx = -1;
    } else {
      findState.idx = findState.idx % findState.hits.length; // wrap se era l'ultima
      highlightCurrent({ immediate: true });
    }
    onDocInput();
  }
  function replaceAll(term, replacement) {
    if (!term) return;
    runFind(term, { immediate: true });
    // Nessuna sostituzione invisibile: prima si riaprono tutte le sezioni chiuse
    // che contengono una corrispondenza, così l'utente vede cosa è stato
    // cambiato invece di scoprirlo per caso più tardi (feedback #385). Anche
    // qui l'apertura resta: dentro quelle sezioni il testo è cambiato.
    findState.hits.forEach((hit) => { revealCollapsedFor(hit.marks[0]); keepRevealedFor(hit.marks[0]); });
    findState.hits.forEach((hit) => replaceHitMarks(hit, replacement));
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
    // calcola subito l'ancora (il range può invalidarsi mentre l'overlay è aperto)
    const range = sel.getRangeAt(0);
    const offsets = pmOffsets(range);
    // Il testo dell'ancora vive nello spazio del "testo puro" del documento:
    // Selection.toString() inserisce interruzioni di riga tra i blocchi, ma il
    // testo puro (concatenazione dei nodi testo) non ne contiene mai — senza
    // questa normalizzazione una selezione multi-paragrafo non matcherebbe mai
    // (commento orfano fin dalla creazione).
    const anchorText = offsets
      ? commentDocText().slice(offsets.from, offsets.to)
      : selectedText.replace(/\r?\n/g, '');
    const id = newId('comment');
    $('cmCancel').addEventListener('click', closeOverlay);
    $('cmSave').addEventListener('click', () => {
      const text = $('cmText').value.trim();
      if (!text) { closeOverlay(); return; }
      const anchor = { from: offsets ? offsets.from : -1, to: offsets ? offsets.to : -1, text: anchorText };
      const c = { id, text, anchor, created: new Date().toISOString(), resolved: false };
      doc.comments.push(c);
      // Stesso cammino del re-ancoraggio al reload: evidenzia anche selezioni
      // multi-blocco (dove surroundContents fallirebbe).
      highlightComment(c);
      closeOverlay();
      onDocInput();
      renderGrid();
    });
  }
  // ── Ancoraggio commenti ────────────────────────────────────────────────
  // L'ancora di un commento è { from, to, text }: offset sul testo puro del
  // documento (concatenazione dei nodi testo, esclusi i toggle di collasso che
  // sono UI iniettata) + il testo selezionato come fallback. Al reload il
  // documento viene ri-renderizzato da JSON: gli offset restano validi perché
  // il testo puro è identico; se il testo è cambiato (edit senza ri-salvataggio
  // dell'ancora) si ripiega sulla ricerca di `text`.
  function commentTextNodes() {
    const walker = document.createTreeWalker(docEl, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => n.parentElement && n.parentElement.closest('.ed-collapse-toggle') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const nodes = [];
    let n; while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }
  function commentDocText(nodes) {
    return (nodes || commentTextNodes()).map((n) => n.nodeValue).join('');
  }
  // Offset {from,to} di un Range sul testo puro. Ritorna null se i confini non
  // cadono in nodi testo del documento (es. selezione anomala): in quel caso
  // l'ancora vive solo di `text`.
  function pmOffsets(range) {
    if (!range) return null;
    let cum = 0, from = -1, to = -1;
    for (const tn of commentTextNodes()) {
      if (from < 0 && tn === range.startContainer) from = cum + range.startOffset;
      if (to < 0 && tn === range.endContainer) to = cum + range.endOffset;
      cum += tn.nodeValue.length;
      if (from >= 0 && to >= 0) break;
    }
    return (from >= 0 && to >= 0 && to > from) ? { from, to } : null;
  }
  // Avvolge l'intervallo [from,to) del testo puro in span .ed-commented (uno
  // per nodo testo intersecato: funziona anche su selezioni multi-blocco, dove
  // surroundContents fallirebbe). Ritorna true se ha evidenziato qualcosa.
  function wrapCommentRange(c, from, to) {
    const nodes = commentTextNodes();
    let cum = 0, wrapped = false;
    for (const tn of nodes) {
      const len = tn.nodeValue.length;
      const s = Math.max(from - cum, 0);
      const e = Math.min(to - cum, len);
      cum += len;
      if (e <= s) continue;
      let target = tn;
      if (s > 0) target = target.splitText(s);
      if (e - s < target.nodeValue.length) target.splitText(e - s);
      const span = document.createElement('span');
      span.className = 'ed-commented';
      span.dataset.commentId = c.id;
      span.title = c.text;
      target.parentNode.insertBefore(span, target);
      span.appendChild(target);
      span.addEventListener('click', () => showCommentsList(c.id));
      wrapped = true;
      if (cum >= to) break;
    }
    return wrapped;
  }
  // Evidenzia un singolo commento a partire dalla sua ancora. Preferisce gli
  // offset (se il testo lì sotto coincide ancora), altrimenti cerca il testo.
  function highlightComment(c) {
    const a = c.anchor;
    if (!a || !a.text) return false;
    // Ancore salvate da versioni precedenti possono contenere le interruzioni
    // di riga della selezione multi-paragrafo: il testo puro del documento non
    // ne ha mai, quindi si confronta sempre la forma normalizzata. `a.from`
    // resta valido (pmOffsets lavora già sul testo puro); la lunghezza si
    // riprende dal testo normalizzato, non da `a.to` (che per le ancore legacy
    // contava anche i newline).
    const aText = String(a.text).replace(/\r?\n/g, '');
    if (!aText) return false;
    const text = commentDocText();
    let from = -1, to = -1;
    if (Number.isFinite(a.from) && a.from >= 0 && text.slice(a.from, a.from + aText.length) === aText) {
      from = a.from; to = a.from + aText.length;
    } else {
      const i = text.indexOf(aText);
      if (i >= 0) { from = i; to = i + aText.length; }
    }
    if (from < 0 || to <= from) return false;
    return wrapCommentRange(c, from, to);
  }
  function removeCommentSpans(id) {
    const sel = id ? `[data-comment-id="${id}"]` : '.ed-commented';
    docEl.querySelectorAll(sel).forEach((span) => {
      const parent = span.parentNode;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      span.remove();
      parent.normalize();
    });
  }
  function applyCommentHighlights() {
    removeCommentSpans();
    doc.comments.forEach((c) => highlightComment(c));
  }
  // Prima del salvataggio ri-calcola le ancore dagli span presenti nel DOM: se
  // l'utente ha editato il testo attorno, gli offset salvati restano allineati.
  function refreshCommentAnchors() {
    const nodes = commentTextNodes();
    const starts = new Map();
    let cum = 0;
    for (const tn of nodes) { starts.set(tn, cum); cum += tn.nodeValue.length; }
    doc.comments.forEach((c) => {
      const spans = docEl.querySelectorAll(`[data-comment-id="${c.id}"]`);
      if (!spans.length) return; // span perso (es. testo cancellato): tieni l'ancora vecchia
      let from = Infinity, to = -Infinity, text = '';
      spans.forEach((span) => {
        const inner = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
        let n; while ((n = inner.nextNode())) {
          const s = starts.get(n);
          if (s == null) continue;
          from = Math.min(from, s);
          to = Math.max(to, s + n.nodeValue.length);
        }
        text += span.textContent;
      });
      if (from < to && text) c.anchor = { from, to, text };
    });
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
      <div class="ed-overlay-actions">
        <button class="ed-btn" id="ovNew">Nuovo commento</button>
        <button class="ed-btn primary" id="ovClose">Chiudi</button>
      </div>`);
    $('ovClose').addEventListener('click', closeOverlay);
    // Invariante UX: se dal modulo si crea il PRIMO commento con un click, dalla
    // lista si deve poter avviare anche il secondo (prima l'unica via era la
    // scorciatoia, di default non impostata, o svuotare tutti i commenti).
    // startCommenting() rimpiazza l'overlay con l'invito a selezionare il testo.
    $('ovNew').addEventListener('click', startCommenting);
    overlayBox.querySelectorAll('[data-resolve]').forEach((b) => b.addEventListener('click', () => {
      const c = doc.comments.find((x) => x.id === b.dataset.resolve); if (c) c.resolved = !c.resolved;
      markDirty(); renderGrid(); showCommentsList();
    }));
    overlayBox.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      doc.comments = doc.comments.filter((x) => x.id !== b.dataset.del);
      removeCommentSpans(b.dataset.del); // tutti gli span (multi-blocco compreso)
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
    // Cattura lo stato PRIMA di mutare il DOM: se la modifica automatica di Filo
    // cambia davvero qualcosa, questo diventa il punto di ripristino annullabile.
    const preContent = doc ? serialize() : null;
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
    if (touched) {
      const v = preContent ? recordFiloVersion(preContent) : null;
      refreshCollapseToggles();
      onDocInput();
      // Filo ha appena creato il suo punto di ripristino: da qui la deriva
      // manuale riparte dallo stato POST-modifica, non da prima.
      setManualBaseline(serialize());
      if (v) offerUndoFilo(v.id, doc.id);
    }
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
      const docText = docPlainText().slice(0, 6000);
      const messages = [
        { role: 'system', content: CHAT_FORMAT_INSTRUCTIONS + docText },
        ...m.data.messages.filter((x) => x !== thinking).map((x) => ({ role: x.role, content: x.content })),
      ];
      try {
        const r = await sendMessage({
          type: MSG.AI_REQUEST, action: ACTIONS.EDITOR_CHAT || 'editor_chat', payload: { messages },
        });
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
      if (!canAddType(type)) continue;
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
    // Lo switch è un modulo di sistema (appuntato): è l'UNICO modo per navigare
    // fra le pagine della griglia. Eliminarlo lascerebbe l'utente bloccato sulla
    // prima pagina, con i moduli delle altre pagine irraggiungibili. Come
    // l'ingranaggio impostazioni, non offriamo il bottone "Elimina" — per ridurre
    // le pagine si rimpicciolisce lo switch (che avverte pagina per pagina).
    const deletable = !isPinned(m);
    openOverlay(`<h3>${meta.label}</h3>
      <div class="ed-field"><label>Scorciatoia da tastiera</label>
        <input type="text" id="cfgShortcut" placeholder="es. Ctrl+Shift+1" value="${escapeHtml(m.data.shortcut || '')}" />
        <div class="ed-field-hint" id="cfgShortcutHint" hidden>Usa almeno un modificatore (Ctrl o Alt), es. Ctrl+Shift+1 — così non ruba una lettera mentre scrivi.</div></div>
      ${specific}
      <div class="ed-overlay-actions">
        ${deletable ? '<button class="ed-btn danger" id="cfgDelete">Elimina</button>' : ''}
        <button class="ed-btn" id="cfgCancel">Annulla</button>
        <button class="ed-btn primary" id="cfgSave">Salva</button>
      </div>`);
    $('cfgCancel').addEventListener('click', closeOverlay);
    if (deletable) $('cfgDelete').addEventListener('click', () => {
      // Guardia difensiva: un modulo appuntato non è mai eliminabile.
      if (isPinned(m)) { closeOverlay(); return; }
      doc.modules = doc.modules.filter((x) => x.id !== m.id);
      closeOverlay(); renderGrid(); markDirty();
    });
    const cfgShortcut = $('cfgShortcut');
    const cfgShortcutHint = $('cfgShortcutHint');
    cfgShortcut.addEventListener('input', () => {
      cfgShortcut.classList.remove('ed-field-invalid');
      cfgShortcutHint.hidden = true;
    });
    $('cfgSave').addEventListener('click', () => {
      const rawShortcut = cfgShortcut.value.trim();
      // Una scorciatoia senza modificatore (es. la lettera "b") verrebbe premuta
      // di continuo mentre si scrive: la rifiutiamo e mostriamo come correggerla,
      // invece di salvarla e rubare quel tasto in tutto l'editor.
      if (rawShortcut && !isValidShortcut(rawShortcut)) {
        cfgShortcut.classList.add('ed-field-invalid');
        cfgShortcutHint.hidden = false;
        cfgShortcut.focus();
        return;
      }
      m.data.shortcut = rawShortcut;
      if (m.type === 'word-count') m.data.count = $('cfgCount').value;
      if (m.type === 'switch') {
        overlayBox.querySelectorAll('[data-pname]').forEach((inp) => { m.data.pages[Number(inp.dataset.pname)].name = inp.value; });
        overlayBox.querySelectorAll('[data-picon]').forEach((sel) => { m.data.pages[Number(sel.dataset.picon)].icon = sel.value; });
      }
      closeOverlay(); renderGrid(); markDirty();
    });
  }

  // ── Scorciatoie modulo personalizzate ──────────────────────────────────
  const SHORTCUT_MODIFIERS = ['ctrl', 'cmd', 'meta', 'alt', 'shift'];
  function shortcutParts(sc) {
    return String(sc || '').toLowerCase().split('+').map((s) => s.trim()).filter(Boolean);
  }
  // Un modificatore "reale" cambia il carattere prodotto: Ctrl/Cmd/Alt. Shift da
  // solo NON basta (Shift+b digita comunque "B"), quindi non conta come reale.
  function shortcutHasRealModifier(sc) {
    const parts = shortcutParts(sc);
    return parts.includes('ctrl') || parts.includes('cmd') || parts.includes('meta') || parts.includes('alt');
  }
  // Una scorciatoia è valida solo se ha un modificatore reale + un tasto finale:
  // così non può coincidere con la normale digitazione di una lettera.
  function isValidShortcut(sc) {
    const parts = shortcutParts(sc);
    if (parts.length < 2) return false;
    const key = parts[parts.length - 1];
    if (SHORTCUT_MODIFIERS.includes(key)) return false; // manca il tasto finale
    return shortcutHasRealModifier(sc);
  }
  function isEditableTarget(t) {
    if (!t) return false;
    if (t.isContentEditable) return true;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }
  // Il tasto finale premuto può presentarsi in più forme: `e.key` è il carattere
  // PRODOTTO (con Shift+1 diventa "!", non "1"), mentre `e.code` è il tasto FISICO
  // (Digit1, KeyB) indipendente da Shift e dal layout. Confrontiamo la scorciatoia
  // contro entrambe le forme, così "Ctrl+Shift+1" combacia anche se il layout
  // trasforma Shift+1 in un simbolo. Fallback su `e.key` per i tasti non
  // alfanumerici (frecce, ecc.).
  function eventKeyCandidates(e) {
    const out = new Set();
    if (e.key) out.add(e.key.toLowerCase());
    const code = e.code || '';
    let m;
    if ((m = /^Digit(\d)$/.exec(code))) out.add(m[1]);
    else if ((m = /^Numpad(\d)$/.exec(code))) out.add(m[1]);
    else if ((m = /^Key([A-Z])$/.exec(code))) out.add(m[1].toLowerCase());
    return out;
  }
  function matchShortcut(e, sc) {
    if (!sc) return false;
    const parts = sc.toLowerCase().split('+').map((s) => s.trim());
    const need = { ctrl: parts.includes('ctrl'), shift: parts.includes('shift'), alt: parts.includes('alt') };
    const key = parts[parts.length - 1];
    return (e.ctrlKey || e.metaKey) === need.ctrl && e.shiftKey === need.shift && e.altKey === need.alt && eventKeyCandidates(e).has(key);
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
  // Aprire e CHIUDERE un pannello sono entrambi cambi sotto il cursore: aperto,
  // il colpo di coda cade su un comando del pannello nuovo; chiuso, cade sul
  // foglio dietro (che apre "Aggiungi modulo"). Armano tutti e due.
  function openOverlay(html) { staleClick.arm(); overlayBox.innerHTML = html; overlay.hidden = false; }
  function closeOverlay() { staleClick.arm(); overlay.hidden = true; overlayBox.innerHTML = ''; }
  function flashOverlayMsg(text, ms) {
    openOverlay(`<div style="text-align:center;padding:8px 4px">${escapeHtml(text)}</div>`);
    setTimeout(closeOverlay, ms || 1400);
  }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });

  // Toast discreto in basso a destra per i fallimenti "non bloccanti" (es. uno
  // switch che non si può allargare per mancanza di spazio). Stile coerente con
  // le notifiche d'errore (bordo accent rosso), come il fallimento di un'azione.
  //
  // Gli avvisi si IMPILANO (uno per evento, ciascuno col suo timer): prima ce
  // n'era uno solo, riusato, e il nuovo avviso distruggeva il precedente insieme
  // al suo bottone — quindi un "Annulla" poteva sparire prima che l'utente
  // riuscisse a premerlo, anche a causa di un avviso che arrivava da solo.
  // Impilandoli l'azione resta raggiungibile finché non scade il SUO tempo.
  // Come ogni stack nell'angolo (vedi PATTERNS.md § "Stack di overlay
  // impilati") ha due argini: un tetto al numero di card vive e un tetto
  // all'altezza col contenitore che scorre.
  const ED_TOAST_MAX = 4;
  let edToastHost = null;
  function edToastHostEl() {
    if (!edToastHost || !edToastHost.isConnected) {
      edToastHost = document.getElementById('edToasts');
      if (!edToastHost) {
        edToastHost = document.createElement('div');
        edToastHost.id = 'edToasts';
        edToastHost.className = 'ed-toasts';
        edToastHost.setAttribute('role', 'status');
        edToastHost.setAttribute('aria-live', 'polite');
        document.body.appendChild(edToastHost);
      }
    }
    return edToastHost;
  }
  // Rimuove le card più vecchie oltre il tetto: teniamo le più recenti, come lo
  // stack di notifiche della shell. Nessun rischio di perdita dati: l'undo di
  // un'eliminazione resta comunque nel cestino dei documenti.
  function enforceEdToastCap() {
    const host = edToastHostEl();
    const live = Array.from(host.children).filter((c) => c.dataset.closing !== '1');
    for (let i = 0; i < live.length - ED_TOAST_MAX; i++) removeEdToast(live[i], true);
  }
  // Attenzione: va misurato a transizione FINITA. Durante l'entrata la card è
  // traslata verso il basso di qualche pixel, e in un contenitore scrollabile
  // una traslazione allarga l'area scrollabile: misurando subito il contenitore
  // si crederebbe in overflow e resterebbe con la barra di scorrimento addosso
  // per sempre (due soli avvisi mostravano la scrollbar).
  let edToastOverflowTimer = null;
  function syncEdToastOverflow() {
    clearTimeout(edToastOverflowTimer);
    edToastOverflowTimer = setTimeout(() => {
      const host = edToastHostEl();
      const scrollable = host.scrollHeight - host.clientHeight > 2;
      host.classList.toggle('scrolling', scrollable);
      if (scrollable) host.scrollTop = host.scrollHeight;
    }, 260); // > della transizione di entrata/uscita (0.18s / 0.22s)
  }
  function removeEdToast(el, immediate) {
    if (!el || el.dataset.closing === '1') return;
    el.dataset.closing = '1';
    if (el._timer) clearTimeout(el._timer);
    // Via un avviso, quelli sopra scivolano giù al suo posto: la pila si è
    // ridisegnata sotto il cursore.
    staleClick.arm();
    el.classList.remove('show');
    if (immediate) { try { el.remove(); } catch (_) {} syncEdToastOverflow(); return; }
    setTimeout(() => { try { el.remove(); } catch (_) {} syncEdToastOverflow(); }, 220);
  }
  // `action` opzionale = { label, onClick }: aggiunge un bottone cliccabile nel
  // toast (es. "Annulla" dopo una modifica automatica di Filo).
  function showEditorToast(text, action) {
    const el = document.createElement('div');
    el.className = 'ed-toast';
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    const hasAction = action && action.label && typeof action.onClick === 'function';
    if (hasAction) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ed-toast-action';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        removeEdToast(el);
        try { action.onClick(); } catch (_) {}
      });
      el.appendChild(btn);
    }
    const host = edToastHostEl();
    host.appendChild(el);
    // Un avviso nuovo prende il posto in fondo alla pila — proprio dove poteva
    // esserci il bottone appena premuto.
    staleClick.arm();
    enforceEdToastCap();
    // Forza un reflow così la transizione d'ingresso parte.
    void el.offsetWidth;
    el.classList.add('show');
    syncEdToastOverflow();
    // Con un'azione lascio più tempo per cliccarla.
    el._timer = setTimeout(() => removeEdToast(el), hasAction ? 7000 : 3400);
    return el;
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
      if (m.data && m.data.shortcut && matchShortcut(e, m.data.shortcut)) {
        // Difesa per le scorciatoie senza modificatore già salvate (prima della
        // validazione): mentre si scrive nel documento o in un campo di testo NON
        // devono rubare il tasto — lascia digitare normalmente la lettera.
        if (!shortcutHasRealModifier(m.data.shortcut) && isEditableTarget(e.target)) continue;
        e.preventDefault(); triggerModuleShortcut(m); return;
      }
    }
  });

  window.addEventListener('beforeunload', () => {
    // Ultimo confine "chiusura": prova a fissare un punto di ripristino se
    // l'utente ha scritto molto e sta chiudendo senza pausa. Best-effort — la
    // scrittura dello storico è asincrona, quindi su una chiusura brusca può non
    // fare in tempo; i confini affidabili sono la pausa e il cambio documento.
    maybeRecordManualVersion();
    if (dirty) save(false);
  });

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
      if (!msg) return;
      if (msg.type === MSG.SETTINGS_UPDATED) applySavedTheme();
      // Filo ha aggiornato dati vivi (fra cui gli appunti scritti nell'editor):
      // ricarica la collezione dall'archivio per mostrare subito il nuovo file.
      else if (msg.type === MSG.FILO_LIVE_UPDATED) { reloadFromArchive(); }
    });
  } catch (_) {}

  // #442 — un'importazione da backup ha rimesso dentro i documenti: stessa
  // rilettura dell'aggiornamento live. `reloadFromArchive` fonde e rispetta il
  // documento aperto con modifiche non salvate, quindi non porta via niente di
  // ciò che si sta scrivendo.
  try {
    window.SN_PAGE_BOOTSTRAP.onDataImported(
      () => { reloadFromArchive(); },
      [COLLECTION_KEY, VERSIONS_KEY], // il cestino vive solo su localStorage: non passa dall'export
    );
  } catch (_) {}

  // Hook di test/integrazione per lo storico versioni (usato dagli spec e da chi
  // costruirà la UI di storico sopra a questo). Espone la lista e il ripristino.
  window.__filoEditorVersions = {
    list: (fileId) => (VERS ? VERS.listFor(versions, fileId || (doc && doc.id)) : []),
    restore: (fileId, versionId) => restoreVersion(fileId, versionId),
    activeId: () => (doc && doc.id),
    ready: () => versionsReady,
    flush: () => persistVersions(),
    openHistory: () => openVersionHistory(),
    // Valuta subito uno snapshot manuale (stesso codice della pausa di scrittura
    // e del cambio documento), senza aspettare il debounce: usato dagli spec.
    snapshotManual: () => maybeRecordManualVersion(),
  };

  // Boot
  applySavedTheme();
  loadVersions();                           // storico dall'archivio app (async)
  loadTrash();                              // documenti eliminati recuperabili
  loadCollection();                         // da localStorage (sincrono)
  activateFile(STORE.activeFile(collection)); // apre l'ultimo file attivo
  reloadFromArchive();                      // fonde i file scritti da Filo (appunti/migrazione)
})();
