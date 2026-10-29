// Editor di Filo: testo contenteditable serializzato in JSON compatibile ProseMirror, a tutta larghezza; gli
// strumenti stanno nel pannello di destra (#1433, src/shared/pannelloDestro.js) e la chat è l'Aiuto.
// Formato di salvataggio in editor-spec.md.

(() => {
  'use strict';

  // Documento singolo di migrazione: si legge una volta, non si scrive mai.
  const STORAGE_KEY = 'filo.editor.doc';
  // La COLLEZIONE su localStorage: l'autosalvataggio dev'essere sincrono e scrivere anche su
  // `beforeunload`, dove un archivio asincrono non fa in tempo.
  const COLLECTION_KEY = 'filo.editor.collection';
  // Storico versioni: dati freddi, fuori da localStorage — vivono sull'archivio dell'app così
  // possono crescere senza saturare la persistenza calda. Vedi editorVersions.js.
  const VERSIONS_KEY = 'filo.editor.versions';
  const STORE = window.SN_EDITOR_STORE;
  const VERS = window.SN_EDITOR_VERSIONS;
  const MSG = (window.SN_MSG && window.SN_MSG.MSG) || {};
  const ACTIONS = (window.SN_CONST && window.SN_CONST.ACTIONS) || {};
  const ICONS = window.SN_ICONS || {};
  // Il nome di un tasto si chiede a SN_TASTI, mai scritto a mano (CLAUDE.md § Mac).
  const TASTI = window.SN_TASTI;
  const tasto = (accel) => (TASTI ? TASTI.etichetta(accel) : accel);
  const conTasto = (testo, accel) => `${testo} (${tasto(accel)})`;

  // Riferimenti DOM
  const $ = (id) => document.getElementById(id);
  const root = $('root');
  const docEl = $('doc');
  const saveStateEl = $('saveState');
  const docWrap = $('docWrap');
  const overlay = $('overlay');
  const overlayBox = $('overlayBox');
  const docbarEl = $('docbar');
  const docSwitchBtn = $('docSwitch');
  const docTitleEl = $('docTitle');
  const docPopEl = $('docPop');

  // Gli strumenti del pannello: quali sono e come si chiamano lo dice il catalogo (SN_PANNELLI_APP), qui come si
  // disegnano. `desc` è il suggerimento.
  const PANNELLI = window.SN_PANNELLI_APP;
  const nomeElemento = (id) => (PANNELLI && PANNELLI.nome('editor', id)) || id;
  const ELEMENTO_META = {
    'word-count':     { icon: 'transcribe', desc: 'Numero di parole, aggiornato in tempo reale.' },
    'search-replace': { icon: 'reload', desc: 'Trova ed evidenzia, sostituisci nel testo.' },
    comment:          { icon: 'share', desc: 'Seleziona testo e aggiungi commenti.' },
    bold:             { glyph: '<b>B</b>', desc: conTasto('Grassetto sul testo selezionato', 'Ctrl+B') + '.' },
    italic:           { glyph: '<i>I</i>', desc: conTasto('Corsivo sul testo selezionato', 'Ctrl+I') + '.' },
    underline:        { glyph: '<u>U</u>', desc: conTasto('Sottolineato sul testo selezionato', 'Ctrl+U') + '.' },
    undo:             { icon: 'back', desc: 'Annulla l\'ultima modifica.' },
    redo:             { icon: 'forward', desc: 'Ripeti la modifica annullata.' },
    'text-size':      { glyph: 'A±', desc: 'Aumenta o riduci la dimensione del testo selezionato.' },
    align:            { glyph: '≡', desc: 'Allinea il testo a sinistra, centro, destra o giustificato.' },
    font:             { glyph: '<span style="font-family:Georgia,serif">F</span>', desc: 'Cambia il tipo di carattere del testo selezionato.' },
    settings:         { icon: 'options', desc: 'Scorciatoie e regolazioni degli strumenti.' },
  };
  const iconaElemento = (id, size = 16) => {
    const m = ELEMENTO_META[id] || {};
    return m.glyph ? `<span class="ed-glifo">${m.glyph}</span>` : (ICONS[m.icon] ? ICONS[m.icon](size) : '');
  };
  // Il pannello di destra, creato all'avvio (più sotto).
  let pannello = null;

  let collection = null; // { version, activeId, files:[...] } — vedi editorStore.js
  let versions = {};     // { [fileId]: { versions:[...] } } — storico, su archivio app
  let versionsReady = Promise.resolve(); // risolta quando lo storico è caricato
  let trash = [];        // documenti eliminati recuperabili (più recenti in cima)
  let doc = null;        // documento ATTIVO in memoria (vedi activateFile/blankDoc)
  let dirty = false;
  let commenting = false;
  // Snapshot manuali: `manualBaseline` è lo stato di riferimento (contenuto
  // serializzato) da cui misurare quanto l'utente ha scritto/cancellato a mano
  // prima di decidere se salvare un punto di ripristino. `manualSnapTimer` è la
  // pausa di scrittura oltre cui si valuta lo snapshot (vedi maybeRecordManualVersion).
  let manualBaseline = null;
  let manualSnapTimer = null;
  // Pausa (ms) prima di valutare uno snapshot manuale. Più lunga dell'autosalvataggio: uno
  // snapshot è un checkpoint, e deve scattare solo quando ci si ferma davvero.
  const MANUAL_SNAPSHOT_IDLE = 3500;
  let uid = 0;
  const newId = (p) => `${p}-${Date.now().toString(36)}-${(uid++).toString(36)}`;

  // DOCUMENTO: modello & persistenza

  function blankDoc() {
    const now = new Date().toISOString();
    return {
      meta: { title: 'Documento senza titolo', created: now, modified: now, version: 1 },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
      comments: [],
      modules: [],
    };
  }


  // Serializza un MODELLO senza toccare il DOM (file vuoti, snapshot); il file attivo passa da
  // serialize(). COPIA PROFONDA: uno snapshot che cambia col documento non è uno snapshot.
  function serializeDocModel(d) {
    const meta = { ...(d.meta || {}) };
    if (!meta.title) meta.title = 'Documento senza titolo';
    // La griglia dei moduli non c'è più (#1433): la sua misura e i moduli del documento si buttano.
    delete meta.grid;
    return cloneJson({
      id: d.id,
      meta,
      content: d.content || { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
      comments: Array.isArray(d.comments) ? d.comments : [],
      modules: [],
    });
  }

  function serialize() {
    // Il titolo si rinomina dal menu documenti, non dall'UI dell'editor: qui si conserva.
    if (!doc.meta.title) doc.meta.title = 'Documento senza titolo';
    doc.meta.modified = new Date().toISOString();
    refreshCommentAnchors(); // ancore allineate al testo corrente prima del persist
    doc.content = htmlToPM(docEl);
    return serializeDocModel(doc);
  }

  // Costruisce il modello doc in memoria (moduli come rettangoli) da un file serializzato.
  function parseStoredDoc(raw) {
    if (!raw || !raw.meta) return null;
    return {
      id: raw.id,
      meta: raw.meta,
      content: raw.content || { type: 'doc', content: [] },
      comments: Array.isArray(raw.comments) ? raw.comments : [],
      modules: [],
    };
  }

  // localStorage è la persistenza calda (sincrona, scrivibile su beforeunload); in PIÙ si
  // rispecchia sull'archivio, da cui Filo vede i file. Il mirror è fire-and-forget.
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
  // meta.modified è ISO ovunque; fallback a 0.
  function fileTs(f) {
    const m = f && f.meta && f.meta.modified;
    const d = m != null ? Date.parse(m) : NaN;
    return Number.isFinite(d) ? d : (typeof m === 'number' ? m : 0);
  }
  // Unione per id; per gli id in comune vince il più recente, così un appunto scritto da Filo a
  // editor chiuso non va perso. `keepLocalId` forza la versione locale (il file attivo).
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

  // Caricamento SINCRONO: il primo render è immediato e deterministico, i file scritti da Filo
  // si fondono dopo. NON rispecchia: scrivere il foglio bianco cancellerebbe i suoi appunti.
  function loadCollection() {
    collection = STORE.migrateToCollection({
      collection: readCollectionRaw(),
      legacyDoc: readLegacyDoc(),
      idFactory: () => newId('file'),
      blankFactory: blankFileSerialized,
    });
    localStorage.setItem(COLLECTION_KEY, JSON.stringify(collection));
  }

  // Ricarica dall'archivio quando Filo ci ha scritto: fonde senza perdere le modifiche locali
  // in corso. Se l'utente stava modificando vince lui; l'appunto resta nello storico.
  async function reloadFromArchive() {
    const remoteRaw = await readArchivedCollection();
    const remoteFiles = (remoteRaw && Array.isArray(remoteRaw.files)) ? remoteRaw.files : null;
    if (!remoteFiles || !remoteFiles.length) {
      // Archivio vuoto: è il locale a doverlo seminare, o Filo non vedrebbe i documenti
      // dell'utente finché non salva a mano.
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

  // La data di modifica si muove solo se il documento è cambiato: aprirlo, lasciarlo o salvarlo uguale non è
  // scriverlo, e il filo conta le scritture da lei (#1561).
  function syncActiveIntoCollection() {
    if (!doc) return;
    const senzaData = (f) => { try { return JSON.stringify({ ...f, meta: { ...(f.meta || {}), modified: null } }); } catch (_) { return null; } };
    const prima = STORE.findFile(collection, doc.id);
    const eraDel = prima && prima.meta ? prima.meta.modified : undefined;
    const com = prima ? senzaData(prima) : null;
    STORE.replaceFile(collection, doc.id, serialize());
    collection.activeId = doc.id;
    const dopo = STORE.findFile(collection, doc.id);
    if (com && eraDel && dopo && dopo.meta && senzaData(dopo) === com) {
      dopo.meta.modified = eraDel;
      if (doc.meta) doc.meta.modified = eraDel;
    }
  }

  // Il documento parte dopo la pausa e prima che la scheda, la finestra o Filo si chiudano: la regola delle caselle.
  const documentoAlSicuro = window.SN_CASELLE.crea();
  documentoAlSicuro.registra('doc', () => save(false));

  // Gli errori che si leggono nell'Editor si contano per tipo, mai col testo (#1461).
  function contaErroreVisto(ev) {
    try {
      const r = chrome.runtime.sendMessage({ type: globalThis.SN_MSG.MSG.CONTATORI_EVENTO, ...ev });
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch (_) {}
  }
  const contaModello = (r) => contaErroreVisto({ misura: 'errore-modello', code: String((r && (r.code || r.errorCode)) || ''), status: Number(r && r.status) || 0 });
  // Gli strumenti del pannello (#1471, #1433): per tipo cosa gli succede, e i trascinamenti.
  // Mai il testo del documento, né quello che si scrive in uno strumento.
  const contaGesto = (campi) => contaErroreVisto({ misura: 'gesto', ...campi });
  // Il titolo automatico e la chat del documento (#1465): esiti e fasce, mai il titolo né il testo.
  const contaRiquadro = (cosa, campi) => contaErroreVisto({ misura: 'riquadro', cosa, ...campi });
  const contaModulo = (m, evento) => { if (m && m.type) contaGesto({ gesto: 'modulo_editor', modulo: m.type, evento }); };
  const contaTrascinamento = (ev) => { if (ev) contaErroreVisto(ev); };

  function save(flash) {
    documentoAlSicuro.spedita('doc');
    try {
      syncActiveIntoCollection();
      writeCollection();
      dirty = false;
      saveStateEl.textContent = flash ? 'Salvato' : '';
      saveStateEl.classList.remove('dirty');
      if (flash) setTimeout(() => { if (!dirty) saveStateEl.textContent = ''; }, 1500);
    } catch (e) {
      saveStateEl.textContent = 'Errore';
      contaErroreVisto({ misura: 'avviso', chiave: 'editor_non_salvato' });
      console.error('[Filo editor] save', e);
    }
  }
  // Il nome del documento si conferma quando il cursore lascia il campo:
  // registrato qui, si conferma anche se la scheda si chiude prima.
  const campoAlVolo = window.SN_CASELLE.alVolo();

  function markDirty() {
    dirty = true;
    saveStateEl.textContent = 'Non salvato';
    saveStateEl.classList.add('dirty');
    documentoAlSicuro.cambiato('doc', null, { pausa: 1200 });
    // Snapshot manuale "a pausa": dopo che l'utente smette di scrivere, valuta
    // se la deriva è abbastanza grande da meritare un punto di ripristino.
    clearTimeout(manualSnapTimer);
    manualSnapTimer = setTimeout(() => maybeRecordManualVersion(), MANUAL_SNAPSHOT_IDLE);
  }

  // Asincrono e tollerante: se lo storico manca o è corrotto si parte da vuoto, e la prima
  // modifica di Filo ne creerà una.
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
  // Scrittura fredda, fire-and-forget: lo storico cresce piano, quindi riscrivere l'intero blob
  // a ogni versione è sostenibile.
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

  // Il punto di ripristino porta il contenuto PRE-modifica: ripristinandolo si torna a com'era
  // prima che l'AI lo toccasse. Null se identica all'ultima → nessun rumore.
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

  // Le modifiche di Filo creano sempre un punto di ripristino, quelle a mano no: versionare a
  // ogni battuta è rumore. Si valuta dopo una pausa, e al cambio o alla chiusura del file.

  // Riallinea il riferimento: dopo, serve nuova deriva significativa per un altro snapshot.
  function setManualBaseline(content) {
    manualBaseline = content || (doc ? serializeDocModel(doc) : null);
  }

  // Snapshot 'manual' se la deriva supera la soglia. Silenzioso: il versionamento manuale è
  // invisibile finché non serve.
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

  // Prima salva lo stato corrente come versione, così anche il ripristino è annullabile. Torna
  // indietro il solo CORPO: il nome è del documento di adesso.
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
    // Lo stato di prima è già salvato, quindi l'avviso lo offre subito indietro — come le
    // modifiche automatiche di Filo, sempre annullabili.
    showEditorToast('Versione ripristinata.', {
      label: 'Annulla',
      onClick: () => {
        if (!restoreVersion(fileId, cres.version.id)) return;
        if (isVersionHistoryOpen()) renderVersionHistory(fileId);
      },
    });
    return true;
  }

  // Invariante minima: una modifica di Filo è SEMPRE annullabile sul posto. Lo storico
  // sfogliabile è una feature a parte.
  function offerUndoFilo(versionId, fileId) {
    showEditorToast('Filo ha modificato il documento.', {
      label: 'Annulla',
      onClick: () => restoreVersion(fileId, versionId),
    });
  }

  // Pannello «Storico versioni»: il toast «Annulla» copre solo l'ultima modifica di Filo, qui
  // c'è tutto (se salviamo N versioni, si devono poter vedere tutte). Dalla più recente.

  // Delega alla logica pura in editorVersions.js — la stessa estrazione della soglia degli
  // snapshot: una sorgente sola.
  function versionPlainText(v) {
    return VERS && v ? VERS.plainText(v.content) : '';
  }

  function versionSourceMeta(v) {
    const src = v && v.source;
    if (src === 'filo') return { tag: 'Modifica di Filo', cls: 'filo' };
    if (src === 'restore') return { tag: 'Prima di un ripristino', cls: 'restore' };
    return { tag: 'Modifica manuale', cls: 'manual' };
  }

  function versionPreviewShort(v) {
    const text = versionPlainText(v);
    if (!text) return '';
    const line = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' · ');
    return line.length > 180 ? line.slice(0, 179).trimEnd() + '…' : line;
  }

  // Paginazione anti-raffica per storie molto lunghe: si parte da un lotto e si carica il
  // resto su richiesta.
  const VERS_HISTORY_BATCH = 40;
  let versHistoryShown = VERS_HISTORY_BATCH;

  // Che cosa tocca un ripristino: il pannello mostra solo l'anteprima del testo, quindi il
  // confine va detto prima di premere.
  const VH_SCOPE_NOTE = 'Il ripristino riporta indietro il testo e i commenti. '
    + 'Il nome del documento resta com\'è adesso.';

  // Serve a tenerlo allineato quando lo stato cambia da fuori (per esempio annullando un
  // ripristino dall'avviso).
  function isVersionHistoryOpen() {
    return !overlay.hidden && !!overlayBox.querySelector('.ed-vh-list, .ed-vh-empty');
  }

  // Coda di gesto: il secondo colpo di un doppio clic cade su ciò che ha preso il posto del
  // comando premuto (`detail > 1`) e va ignorato. Guardia UNA SOLA, e sulla FINESTRA.
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
    // Click/Invio sulla riga (fuori dal bottone): apre l'anteprima ampia, così «Ripristina» non
    // è mai una sorpresa a scatola chiusa.
    overlayBox.querySelectorAll('.ed-vh-item').forEach((it) => {
      const open = (e) => { if (e.target.closest('.ed-vh-restore')) return; showVersionPreview(fileId, it.dataset.id); };
      it.addEventListener('click', open);
      it.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
    });
    staleClick.arm();
  }

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

  // COLLEZIONE DI FILE: attiva/crea/elimina/rinomina + menu documenti

  // Rende attivo un file serializzato. NON persiste: chi chiama decide quando scrivere.
  function activateFile(raw) {
    doc = parseStoredDoc(raw) || parseStoredDoc(blankFileSerialized());
    collection.activeId = doc.id;
    // Stato di vista che non deve trascinarsi da un file all'altro.
    commenting = false;
    root.classList.remove('commenting');
    renderDocBody();
    aggiornaElementi();
    renderDocSwitcher();
    // Nuovo file attivo → nuovo riferimento per gli snapshot manuali: il testo già presente al
    // caricamento non è una modifica a mano.
    clearTimeout(manualSnapTimer);
    setManualBaseline(serializeDocModel(doc));
  }

  function switchToFile(id) {
    if (!doc || id === doc.id) { closeDocPop(); return; }
    const target = STORE.findFile(collection, id);
    if (!target) return;
    // Confine naturale: lasciando il file, se l'utente ha scritto a mano abbastanza si salva un
    // punto di ripristino.
    maybeRecordManualVersion();
    syncActiveIntoCollection();
    activateFile(target);
    segnaAperto();
    closeDocPop();
  }

  // Il documento che l'utente mette davanti si salva con l'ora: il filo segna così i documenti aperti, anche solo
  // letti, e la distingue da due editor che si rubano il documento a ogni salvataggio (src/shared/filoAccaduti.js).
  function segnaAperto() {
    collection.apertoAlle = new Date().toISOString();
    writeCollection();
  }

  function createFile() {
    if (doc) { maybeRecordManualVersion(); syncActiveIntoCollection(); }
    const file = STORE.addFile(collection, blankFileSerialized(), () => newId('file'));
    activateFile(file);
    writeCollection();
    closeDocPop();
  }

  function cloneJson(v) {
    try { return v == null ? v : JSON.parse(JSON.stringify(v)); }
    catch (_) { return v; }
  }
  function ellipsize(s, max) {
    const t = String(s == null ? '' : s);
    return t.length > max ? t.slice(0, Math.max(0, max - 1)).trimEnd() + '…' : t;
  }

  // Cestino dei documenti eliminati: l'avviso «Annulla» copre pochi secondi e non può essere
  // l'unica rete. Ogni eliminazione resta recuperabile finché non esce dagli ultimi TRASH_MAX.
  const TRASH_KEY = 'filo.editor.trash';
  const TRASH_MAX = 12;
  // Tetto di dimensione: il cestino vive nella persistenza calda insieme alla collezione, che
  // non va saturata.
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
  // Via anche il suo storico versioni, che finché il documento resta nel cestino va invece
  // conservato: un ripristino deve riportare indietro anche quello.
  function purgeTrashEntry(entryId) {
    const i = trash.findIndex((e) => e.id === entryId);
    if (i < 0) return null;
    const [entry] = trash.splice(i, 1);
    if (entry && entry.file && entry.file.id) dimenticaNelFilo({ prefisso: `${entry.file.id}:` });
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
  // Serve a non buttare il foglio bianco creato al posto dell'ultimo documento eliminato se nel
  // frattempo ci è stato scritto.
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

  // Invariante: resta sempre almeno un file — cancellando l'ultimo se ne crea uno vuoto.
  // Nessuna conferma (l'attrito su un'azione frequente) ma reversibile: avviso e cestino.
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

    // Nel cestino i più recenti per primi; lo storico resta (vedi sotto, purgeTrashEntry).
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

  // Ripristina un file eliminato: posizione, storico e, se era aperto, riapertura. Idempotente:
  // premere due volte non duplica nulla.
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
    // Si toglie solo se è rimasto vuoto: se ci è stato scritto è un documento vero, e buttarlo
    // sarebbe la perdita che vogliamo evitare.
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

  // Invariante UX: se l'app conserva N documenti eliminati, li si deve poter vedere tutti — e
  // anche buttare davvero.
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
      <p class="ed-vh-scope">I documenti eliminati restano qui (gli ultimi ${TRASH_MAX}) con testo, commenti e storico versioni. Ripristinandone uno torna al suo posto nell'elenco.</p>
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
    // Eliminare per sempre è l'UNICA azione irreversibile qui, e la conferma sul posto è a sua
    // volta un elemento che compare SOTTO il cursore: senza guardia bastava un doppio clic.
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
    // Il cestino si ridisegna dopo ogni eliminazione definitiva: stessa guardia sul secondo colpo
    // di un doppio clic.
    staleClick.arm();
  }

  // `manual` (default true) segna che il titolo l'ha scelto l'utente: il titolo automatico non
  // lo sovrascrive. Vale solo se il nome finale è vero: il flag segue il titolo risultante.
  function renameFileAction(id, title, { manual = true } = {}) {
    const prima = STORE.findFile(collection, id);
    const diFilo = manual && titoloDiFilo(prima) ? { ...prima.meta } : null;
    STORE.renameFile(collection, id, title);
    const f = STORE.findFile(collection, id);
    // Il titolo che Filo aveva scritto, riscritto a mano: quanto dopo (#1465).
    if (diFilo && f && f.meta && f.meta.title !== diFilo.title) {
      contaRiquadro('editor_titolo', { via: diFilo.titleAutoVia, riscrittoDopoMs: Math.max(0, Date.now() - diFilo.titleAutoAt) });
    }
    const named = !!(f && f.meta && f.meta.title && f.meta.title !== STORE.DEFAULT_TITLE);
    if (f && f.meta && manual) f.meta.titleManual = named;
    if (doc && doc.id === id && doc.meta && f && f.meta) {
      doc.meta.title = f.meta.title;
      if (manual) doc.meta.titleManual = named;
    }
    writeCollection();
    renderDocSwitcher();
    rinominaNelFilo(id, f && f.meta && f.meta.title);
  }

  // Titolo automatico (#379.4): a ~100 parole un documento senza nome ne riceve UNO SOLO, da
  // testo + chat + memoria. Resta modificabile a mano e rigenerabile dal tasto destro.
  const AUTO_TITLE_WORDS = 100;
  let autoTitleBusy = false;

  const TITLE_SYSTEM_PROMPT =
    'Sei l\'assistente di Filo. Genera un TITOLO molto breve (2-6 parole) per il '
    + 'documento qui sotto, nella STESSA lingua del testo. Il titolo deve '
    + 'descrivere il contenuto del documento. Usa l\'eventuale conversazione e la '
    + 'memoria SOLO come contesto per capire meglio l\'argomento, non come oggetto '
    + 'del titolo. Rispondi SOLO col titolo: niente virgolette, niente punto '
    + 'finale, niente spiegazioni.';

  function cleanTitle(raw) {
    let t = String(raw == null ? '' : raw).trim();
    t = t.split(/\r?\n/)[0].trim();
    t = t.replace(/^["'«»“”`]+|["'«»“”`]+$/g, '').trim();
    t = t.replace(/^titolo\s*[:\-–—]\s*/i, '').trim();
    t = t.replace(/[.。·]+$/, '').trim();
    if (t.length > 80) t = t.slice(0, 80).trim();
    return t;
  }

  // La memoria arriva al modello recintata come nella chat: la scrive Filo da
  // conversazioni che possono aver letto una pagina ostile (#592).
  function memoriaImbustata(testo) {
    const E = window.SN_ESTERNO;
    return E ? E.imbusta({ tipo: 'MEMORIA_FILO', testo, conIntestazione: true }) : '';
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

  // Il titolo in vista l'ha scritto Filo, con la via e l'ora: quelli di prima dei contatori (#1465) non le hanno.
  function titoloDiFilo(f) {
    const m = f && f.meta;
    return !!(m && m.titleAuto && !m.titleManual && m.title && m.title !== STORE.DEFAULT_TITLE
      && Number.isFinite(m.titleAutoAt) && ['automatico', 'rigenerato'].includes(m.titleAutoVia));
  }

  // Titolo automatico: conta come «già generato» e toglie il flag manuale.
  function applyGeneratedTitle(id, raw, via = 'automatico') {
    const clean = cleanTitle(raw);
    if (!clean) return false;
    STORE.renameFile(collection, id, clean);
    const f = STORE.findFile(collection, id);
    const segno = { titleAuto: true, titleManual: false, titleAutoAt: Date.now(), titleAutoVia: via };
    if (f && f.meta) Object.assign(f.meta, segno);
    if (doc && doc.id === id && doc.meta) {
      doc.meta.title = f.meta.title;
      Object.assign(doc.meta, segno);
    }
    writeCollection();
    renderDocSwitcher();
    rinominaNelFilo(id, f && f.meta && f.meta.title);
    return true;
  }

  // auto:true → tiro automatico a 100 parole, silenzioso, UNA VOLTA SOLA.
  // auto:false → rigenerazione esplicita dal menu, con feedback a video.
  async function generateTitleForActive({ auto } = {}) {
    if (!doc || !doc.meta) return false;
    const id = doc.id;
    if (auto) {
      // Segna SUBITO come «già tentato»: la generazione automatica è una sola. In caso di errore
      // resta «Rigenera titolo» nel menu.
      doc.meta.titleAuto = true;
      const f0 = STORE.findFile(collection, id);
      if (f0 && f0.meta) f0.meta.titleAuto = true;
      writeCollection();
    }
    if (!docPerIlModello().testo) { if (!auto) showEditorToast('Scrivi qualcosa prima di generare un titolo.'); return false; }
    const contesto = contestoDelDocumento(await filoMemoryText());
    const conDocumento = (letto) => [
      { role: 'system', content: TITLE_SYSTEM_PROMPT },
      { role: 'user', content: [bloccoDocumento(letto), ...contesto].join('\n\n') },
    ];
    if (!auto && docSwitchBtn) docSwitchBtn.classList.add('ed-doc-generating');
    const via = auto ? 'automatico' : 'rigenerato';
    const esito = (e) => contaRiquadro('editor_titolo', { via, esito: e });
    try {
      // Rifatto a mano chiede una risposta nuova: la stessa domanda tornerebbe uguale dalla cache.
      const { r, letto } = await chiediSulDocumento(ACTIONS.EDITOR_TITLE || 'editor_title', conDocumento, auto ? {} : { rigenera: true });
      const rawText = (r && r.ok && typeof r.text === 'string') ? r.text : null;
      if (rawText == null) { esito('fallito'); if (!auto) { contaModello(r); avvisoNonGenerato('il titolo', r); } return false; }
      const ok = applyGeneratedTitle(id, rawText, via);
      esito(ok ? 'applicato' : 'vuoto');
      if (!ok && !auto) { contaErroreVisto({ misura: 'avviso', chiave: 'titolo_non_generato' }); showEditorToast('Non sono riuscito a generare il titolo.'); }
      if (ok && !auto && letto.tagliato) showEditorToast(notaTaglio(letto, 'per il titolo'));
      return ok;
    } catch (e) {
      esito('fallito');
      if (!auto) { contaErroreVisto({ misura: 'avviso', chiave: 'titolo_non_generato' }); avvisoNonGenerato('il titolo', { error: e && e.message, code: e && e.code }); }
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

  // Riassunto per file (#379.5): stesso canale AI del titolo, ma si RIGENERA quando il file
  // cambia molto. Entra nel contesto di Filo al posto del testo integrale.
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

  // La «firma» (parole di adesso) dice in futuro se il file è cambiato abbastanza da meritare
  // una rigenerazione.
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

  // Con `manuale` chi ha chiesto il riassunto sa com'è andata.
  async function generateSummaryForActive({ manuale = false } = {}) {
    if (!doc || !doc.meta) return false;
    syncActiveIntoCollection();
    const id = doc.id;
    if (!docPerIlModello().testo) { if (manuale) showEditorToast('Scrivi qualcosa prima di generare un riassunto.'); return false; }
    const contesto = contestoDelDocumento(await filoMemoryText());
    const conDocumento = (letto) => [
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: [bloccoDocumento(letto), ...contesto].join('\n\n') },
    ];
    try {
      const { r, letto } = await chiediSulDocumento(ACTIONS.EDITOR_SUMMARY || 'editor_summary', conDocumento, manuale ? { rigenera: true } : {});
      const rawText = (r && r.ok && typeof r.text === 'string') ? r.text : null;
      if (rawText == null) { if (manuale) avvisoNonGenerato('il riassunto', r); return false; }
      const ok = applyGeneratedSummary(id, rawText);
      if (manuale && !ok) showEditorToast('Non sono riuscito a generare il riassunto.');
      if (manuale && ok && letto.tagliato) showEditorToast(notaTaglio(letto, 'per il riassunto'));
      return ok;
    } catch (e) {
      if (manuale) avvisoNonGenerato('il riassunto', { error: e && e.message, code: e && e.code });
      return false;
    }
  }

  // Titolo o riassunto chiesti a mano che non arrivano: il perché, come nelle chat, e il tasto per la pagina dove si
  // toglie l'ostacolo (Crediti, Opzioni). «Non sono riuscito» da solo lasciava senza motivo e senza strada (#1344.1).
  function avvisoNonGenerato(cosa, r) {
    const CE = window.SN_CHAT_ERRORS;
    const frase = CE ? CE.sentence(CE.fromResponse(r, '')) : '';
    const pagina = CE?.rimedioPagina?.(r) || null;
    const via = pagina
      ? { label: pagina.label, title: pagina.title, durata: 15000, onClick: () => sendMessage({ type: MSG.OPEN_URL, url: pagina.url }) }
      : undefined;
    showEditorToast(`Non sono riuscito a generare ${cosa}.${frase ? ` ${frase}` : ''}`, via);
  }

  // Il debounce evita chiamate a ogni battitura, la firma evita rigenerazioni quando il contenuto
  // è cambiato poco.
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

  // Il titolo derivato è segnato «a mano» così non viene rigenerato in automatico.
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

  // Menu contestuale proprio, con preventDefault e le classi .sn-select-*. Pattern in
  // patterns/menu-contestuale-proprio-nelle-pagine-filo-preventdefault.md.
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
      Promise.resolve(generateSummaryForActive({ manuale: true }))
        .finally(() => { autoSummaryBusy = false; });
    });
    add('Storico versioni', () => openVersionHistory());
    // Parità di cammini col menu documenti: il cestino si raggiunge anche col tasto destro sul
    // titolo.
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
    document.addEventListener('keydown', onTitleMenuKeydown, true);
    setTimeout(() => {
      if (titleMenuEl !== menu) return;
      document.addEventListener('mousedown', onTitleMenuOutside, true);
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
      campoAlVolo.confermato();
      const val = input.value;
      if (docSwitchBtn) docSwitchBtn.style.display = '';
      input.remove();
      if (save) renameFileAction(doc.id, val, { manual: true });
      else renderDocSwitcher();
    };
    input.addEventListener('input', () => campoAlVolo.scrivendo(() => finish(true)));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  // Menu documenti (selettore in alto a sinistra)
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
    // Storico del documento attivo anche dal menu in alto a sinistra, oltre che dal tasto destro
    // sul foglio: parità di cammini.
    const hist = document.createElement('button');
    hist.type = 'button';
    hist.className = 'ed-doc-new ed-doc-history';
    hist.id = 'docHistory';
    hist.innerHTML = `${ICONS.history ? ICONS.history(14) : '⟲'}<span>Storico versioni</span>`;
    hist.addEventListener('click', () => { closeDocPop(); openVersionHistory(); });
    docPopEl.appendChild(hist);
    // Il cestino compare solo quando c'è qualcosa da recuperare: una voce sempre vuota sarebbe
    // rumore.
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
    // Il menu si ricostruisce anche mentre è aperto (le righe salgono): stessa coda di gesto, qui
    // col prezzo più alto — il colpo di coda cadeva sulla × del documento sotto.
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
    // «Documento senza titolo» non è un nome, è l'assenza di un nome: va come segnaposto, non
    // come testo già scritto da riscrivere.
    const curName = (f.meta && f.meta.title) || '';
    input.value = curName === STORE.DEFAULT_TITLE ? '' : curName;
    input.placeholder = STORE.DEFAULT_TITLE;
    input.setAttribute('aria-label', 'Nuovo nome del documento');
    let done = false;
    const commit = (save) => {
      if (done) return;
      done = true;
      campoAlVolo.confermato();
      if (save) renameFileAction(f.id, input.value);
      else renderDocSwitcher();
    };
    input.addEventListener('input', () => campoAlVolo.scrivendo(() => commit(true)));
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
    // Tastiera, parità col tasto destro: Shift+F10 / tasto Menu apre lo stesso menu.
    docSwitchBtn.addEventListener('keydown', (e) => {
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const r = docSwitchBtn.getBoundingClientRect();
        openTitleMenu(r.left, r.bottom);
      }
    });
  }
  if (docbarEl) {
    docbarEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openTitleMenu(e.clientX, e.clientY);
    });
  }

  // EDITOR DI TESTO (contenteditable ↔ JSON ProseMirror)

  const MARK_TAGS = { B: 'bold', STRONG: 'bold', I: 'italic', EM: 'italic', U: 'underline', S: 'strike', STRIKE: 'strike', DEL: 'strike' };

  // Un <img> senza nodo sparisce al salvataggio: diventa un nodo inline `image` con solo
  // src (+ alt), così nessun handler sopravvive al round-trip. Src: data:, http(s), blob:.
  const IMG_SRC_OK = /^(data:image\/|https?:|blob:)/i;
  function imgToPM(el) {
    const src = (el.getAttribute('src') || '').trim();
    if (!IMG_SRC_OK.test(src)) return null;
    const alt = el.getAttribute('alt') || '';
    return { type: 'image', attrs: { src, ...(alt ? { alt } : {}) } };
  }

  // Le marche sono { type, attrs? }: i tag B/I/U/S danno marche semplici; il font-size, che è
  // stile inline, diventa una marca con attrs.size così sopravvive al round-trip.
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
      // Il font arriva come <span style> o, in alcune build, come <font face>: entrambi diventano
      // una marca fontFamily, così sopravvivono al round-trip.
      const ff = (el.style && el.style.fontFamily) || (el.tagName === 'FONT' ? el.getAttribute('face') : '');
      if (ff) next = [...next.filter((m) => m.type !== 'fontFamily'), { type: 'fontFamily', attrs: { family: ff } }];
      out.push(...inlineToPM(el, next));
    });
    return out;
  }

  // '' se non impostato o non valido.
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
        // contenteditable lascia spesso l'immagine incollata fuori da qualsiasi paragrafo:
        // incapsularla dà al modello un blocco che la contiene.
        const img = imgToPM(el);
        if (img) content.push({ type: 'paragraph', content: [img] });
      }
    });
    if (!content.length) content.push({ type: 'paragraph', content: [] });
    return { type: 'doc', content };
  }

  // Escapa anche le virgolette: escapeHtml è usata dentro attributi delimitati da virgolette, e
  // i nomi di font composti ne contengono — senza &quot; l'attributo si chiuderebbe alla prima.
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
    // Documento vuoto → paragrafo con <br> così il caret ha dove posarsi. Un foglio con la sola
    // immagine NON è vuoto: senza il controllo sull'<img> verrebbe azzerato e l'immagine persa.
    if (!docEl.firstChild || (!docEl.textContent.trim() && !docEl.querySelector('img'))) docEl.innerHTML = '<p><br></p>';
    refreshCollapseToggles();
    applyCommentHighlights();
  }

  // Cliccare nello spazio vuoto del foglio deve dare il focus e posare il caret in fondo: senza,
  // l'area editabile coincide col solo testo e il foglio sembra non scrivibile.
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

  // Formattazione
  function exec(cmd, val) {
    docEl.focus();
    document.execCommand(cmd, false, val);
    onDocInput();
  }
  // Forza il CSS inline per i comandi che vogliamo serializzare puliti (allineamento,
  // dimensione), poi torna false: grassetto e corsivo restano <b>/<i>, che il serializzatore sa.
  function execCss(cmd, val) {
    docEl.focus();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(cmd, false, val);
    document.execCommand('styleWithCSS', false, false);
    onDocInput();
  }
  // Dimensione testo: indice 1..7 (3 = normale).
  let fontSizeIdx = 3;
  function stepFontSize(dir) {
    fontSizeIdx = Math.max(1, Math.min(7, fontSizeIdx + dir));
    execCss('fontSize', String(fontSizeIdx));
  }
  // 4 righe la cui posizione comunica sinistra/centro/destra/giustificato.
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
  // Il preventDefault sul mousedown è intenzionale: il default farebbe perdere la selezione e il
  // comando non agirebbe sul testo voluto.
  function fmtButton(label, title, onAct) {
    const b = document.createElement('button');
    b.className = 'ed-fmt-btn';
    b.type = 'button';
    b.innerHTML = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      onAct();
    });
    b.addEventListener('click', (e) => e.stopPropagation());
    return b;
  }
  const SIMPLE_FORMATS = {
    bold:      { glyph: '<b>B</b>', title: conTasto('Grassetto', 'Ctrl+B'), act: () => exec('bold') },
    italic:    { glyph: '<i>I</i>', title: conTasto('Corsivo', 'Ctrl+I'), act: () => exec('italic') },
    underline: { glyph: '<u>U</u>', title: conTasto('Sottolineato', 'Ctrl+U'), act: () => exec('underline') },
    undo:      { glyph: ICONS.back ? ICONS.back(16) : '↶', title: 'Indietro (annulla)', act: () => exec('undo') },
    redo:      { glyph: ICONS.forward ? ICONS.forward(16) : '↷', title: 'Avanti (ripeti)', act: () => exec('redo') },
  };
  function renderSimpleFormat(host, type) {
    const pad = document.createElement('div');
    pad.className = 'ed-mod-pad ed-fmt';
    const cfg = SIMPLE_FORMATS[type];
    const b = fmtButton(`<span class="ed-fmt-glifo">${cfg.glyph}</span><span class="ed-fmt-nome">${escapeHtml(nomeElemento(type))}</span>`, cfg.title, () => { contaModulo({ type }, 'usato'); cfg.act(); });
    b.classList.add('ed-fmt-largo');
    pad.appendChild(b);
    host.appendChild(pad);
  }
  function renderTextSize(host) {
    const pad = document.createElement('div');
    pad.className = 'ed-mod-pad ed-fmt ed-fmt-row';
    const minus = fmtButton('A<small>−</small>', 'Riduci dimensione testo', () => { contaModulo({ type: 'text-size' }, 'usato'); stepFontSize(-1); });
    const plus = fmtButton('A<big>+</big>', 'Aumenta dimensione testo', () => { contaModulo({ type: 'text-size' }, 'usato'); stepFontSize(1); });
    minus.dataset.size = 'down';
    plus.dataset.size = 'up';
    pad.appendChild(minus);
    pad.appendChild(plus);
    host.appendChild(pad);
  }
  function renderAlign(host) {
    const pad = document.createElement('div');
    pad.className = 'ed-mod-pad ed-fmt ed-fmt-row ed-align';
    const defs = [
      ['left', 'Allinea a sinistra', 'justifyLeft'],
      ['center', 'Allinea al centro', 'justifyCenter'],
      ['right', 'Allinea a destra', 'justifyRight'],
      ['justify', 'Giustifica', 'justifyFull'],
    ];
    for (const [kind, title, cmd] of defs) {
      const b = fmtButton(alignSvg(kind), title, () => { contaModulo({ type: 'align' }, 'usato'); execCss(cmd); });
      b.dataset.align = kind;
      pad.appendChild(b);
    }
    host.appendChild(pad);
  }

  // I menu nativi (il <select> del font) rubano il focus e collassano la selezione: si salva il
  // range prima che il menu si apra e lo si ripristina prima del comando.
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
  // ~30 famiglie comuni, con stack di fallback sicuri così l'applicazione regge anche dove il
  // font esatto non è installato.
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

  // Dropdown custom (classi .sn-select-*) con ricerca; sotto resta un <select> nativo nascosto
  // come sorgente di verità, per l'accessibilità e per i test, che applica il font col `change`.
  function renderFont(host) {
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

    // La ricerca fra i font, per i contatori (#1461): dall'apertura alla scelta, la posizione del font, o niente.
    let ricerca = null;
    const contaRicerca = (ev) => {
      try {
        const r = chrome.runtime.sendMessage({ type: globalThis.SN_MSG.MSG.CONTATORI_EVENTO, misura: 'ricerca', pannello: 'font', ...ev });
        if (r && typeof r.catch === 'function') r.catch(() => {});
      } catch (_) {}
    };
    function choose(val) {
      if (val && ricerca) {
        const i = visibleOptions().findIndex((o) => o.dataset.value === val);
        contaRicerca({ esito: 'scelta', attesaMs: Date.now() - ricerca.t0, posizione: i >= 0 ? i + 1 : null });
        ricerca.scelto = true;
      }
      if (val) {
        sel.value = val;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
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
      // …e dentro la finestra. La tendina ha min-width 180px e i moduli stanno a destra: allineata
      // al bordo sinistro del bottone sporgerebbe fuori. Si misura la larghezza VERA e si rientra.
      const MARGINE = 8;
      const largh = pop.getBoundingClientRect().width || r.width;
      const massimo = window.innerWidth - largh - MARGINE;
      pop.style.left = `${Math.max(MARGINE, Math.min(r.left, massimo))}px`;
    }
    // La finestra non sta ferma mentre la tendina è aperta (e in Filo si zooma di continuo): posare
    // solo all'apertura calcola il rientro su uno spazio che un istante dopo non c'è più.
    const riposa = () => { if (!pop.hidden) placePop(); };
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
      window.addEventListener('resize', riposa);
      // Lo zoom della pagina muove il riquadro visuale senza sempre cambiare la
      // finestra: è una misura a sé, e va ascoltata a sé.
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', riposa);
        window.visualViewport.addEventListener('scroll', riposa);
      }
      setTimeout(() => search.focus(), 0);
      ricerca = { t0: Date.now(), scelto: false };
      contaRicerca({ esito: 'aperta' });
    }
    function close() {
      if (pop.hidden) return;
      if (ricerca && !ricerca.scelto) contaRicerca({ esito: 'vuota' });
      ricerca = null;
      pop.hidden = true;
      wrap.classList.remove('sn-open');
      button.setAttribute('aria-expanded', 'false');
      setHover(null);
      document.removeEventListener('mousedown', onDocDown, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', riposa);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', riposa);
        window.visualViewport.removeEventListener('scroll', riposa);
      }
    }

    button.addEventListener('mousedown', () => saveDocSelection());
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      pop.hidden ? open() : close();
    });
    search.addEventListener('input', () => applyFilter(search.value));
    search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveHover(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveHover(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (hoverEl) choose(hoverEl.dataset.value); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); button.focus(); }
    });

    // Salva la selezione prima che il menu la perda.
    sel.addEventListener('mousedown', () => saveDocSelection());
    sel.addEventListener('change', (e) => {
      e.stopPropagation();
      const font = sel.value;
      sel.selectedIndex = 0; // torna al placeholder "Font…"
      valueEl.textContent = 'Font…';
      if (!font) return;
      contaModulo({ type: 'font' }, 'usato');
      restoreDocSelection();
      execCss('fontName', font);
    });

    pad.appendChild(wrap);
    host.appendChild(pad);
  }

  // Shortcut markdown a livello blocco
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

  // Titoli collassabili
  function headingLevel(el) {
    return /^H([1-3])$/.test(el.tagName) ? Number(el.tagName[1]) : 0;
  }
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
  // Ricalcola DA CAPO partendo solo da `data-collapsed` sui titoli (unica fonte di verità): è
  // ciò che rende corretto l'annidamento — le sotto-sezioni chiuse restano chiuse.
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
    // Lo stato di collasso vive sul titolo, non sul bottone: ogni digitazione ricrea i bottoni, il
    // titolo sopravvive. Una sezione chiusa resta chiusa, e il contenuto nuovo nasce nascosto.
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
  function topLevelBlockOf(node) {
    let el = node && node.nodeType === 1 ? node : (node && node.parentElement);
    while (el && el.parentElement && el.parentElement !== docEl) el = el.parentElement;
    return el && el.parentElement === docEl ? el : null;
  }
  // Solo i titoli di livello più alto possono nascondere un blocco: risalendo i fratelli
  // precedenti si tiene la catena scendendo di livello, e ci si ferma al primo H1.
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
  // Riapre le sezioni che nascondono `node`: ogni cosa avviene sotto gli occhi dell'utente.
  // `opts.temporary` = PRESTITO della ricerca: si richiude appena la ricerca si sposta (#385).
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
  // Le sezioni diventano dell'utente: aperte per una ragione che resta valida anche quando la
  // ricerca se ne va (ci ha scritto dentro, o ci è stata sostituita una parola).
  function keepRevealedFor(node) {
    governingHeadings(node).forEach((h) => { delete h.dataset.searchOpened; });
  }
  // Se il cursore è dentro una sezione in prestito, quella smette di esserlo: nessun testo
  // sparisce da sotto il cursore mentre ci si lavora.
  function keepRevealedAtCaret() {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode || !docEl.contains(sel.anchorNode)) return;
    keepRevealedFor(sel.anchorNode);
  }
  // Richiude le sezioni in prestito tranne quella che mostra `keepNode`. Quelle aperte a mano
  // non hanno il marchio e non si toccano.
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
    aggiornaElementi();
    maybeAutoTitle();
    maybeAutoSummary();
  }

  docEl.addEventListener('input', () => {
    handleMarkdownBlock();
    onDocInput();
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
    const righe = text.split(/\r\n?|\n/);
    if (righe.length < INCOLLA_A_RIGHE) document.execCommand('insertText', false, text);
    else incollaLungo(righe);
  });
  // insertText paga ogni a capo e mille righe fermavano la pagina per minuti (#1475); insertHTML è lento uguale in un
  // blocco vuoto, per questo la prima riga entra da insertText e il suo ultimo carattere torna col resto, nel suo tag.
  const INCOLLA_A_RIGHE = 50;
  const BLOCCO = /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|PRE|TD|TH)$/;
  function incollaLungo(righe) {
    const [prima, ...resto] = righe;
    document.execCommand('insertText', false, prima);
    const sel = window.getSelection();
    let blocco = sel && sel.anchorNode;
    while (blocco && blocco !== docEl && !(blocco.nodeType === 1 && BLOCCO.test(blocco.tagName))) blocco = blocco.parentNode;
    if (!blocco || blocco === docEl || !/^(P|DIV|H[1-6])$/.test(blocco.tagName) || (blocco.textContent || '').length < 2) {
      document.execCommand('insertText', false, `\n${resto.join('\n')}`);
      return;
    }
    sel.modify('extend', 'backward', 'character');
    let pezzo = spaziVisibili(sel.toString());
    for (let n = sel.getRangeAt(0).startContainer.parentNode; n && n !== blocco; n = n.parentNode) {
      const vuoto = n.cloneNode(false).outerHTML;
      const chiude = vuoto.lastIndexOf('</');
      pezzo = chiude > 0 ? vuoto.slice(0, chiude) + pezzo + vuoto.slice(chiude) : pezzo;
    }
    const tag = blocco.tagName.toLowerCase();
    document.execCommand('insertHTML', false, `<${tag}>${pezzo}</${tag}>`
      + resto.map((r) => `<p>${r ? spaziVisibili(r) : '<br>'}</p>`).join(''));
  }
  // L'HTML stringe gli spazi: quelli in fila e in testa restano visibili come li vedeva chi ha copiato.
  function spaziVisibili(s) {
    const esc = s.replace(/\t/g, '    ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc.replace(/ {2,}/g, (m) => ` ${'&nbsp;'.repeat(m.length - 1)}`).replace(/^ /, '&nbsp;');
  }

  // ── Zoom del foglio ─────────────────────────────────────────────────
  // Pinch sul trackpad e Ctrl+rotella generano wheel events con ctrlKey=true;
  // da tastiera Ctrl+= / Ctrl+- / Ctrl+0. Lo zoom scala l'intero documento
  // (testo e immagini) via la proprietà CSS `zoom`, senza toccare il modello
  // salvato.
  const ZOOM_MIN = 0.5, ZOOM_MAX = 3;
  let zoomLevel = 1;
  // L'editor zooma il foglio, non la finestra: il preload deve stare fuori
  // (altrimenti Ctrl+rotella e Ctrl+/- zoomerebbero due volte).
  try { document.documentElement.dataset.filoOwnZoom = '1'; } catch (_) {}
  function applyZoom() {
    zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(zoomLevel * 100) / 100));
    docEl.style.zoom = zoomLevel === 1 ? '' : String(zoomLevel);
    // Chi zooma da sé deve DIRE a quanto sta: il livello della finestra qui
    // resta fermo al 100%, e senza questo Filo risponderebbe 100% mentre il
    // foglio è ingrandito (#686, secondo giro di verifica).
    try {
      document.documentElement.dataset.filoOwnZoomPercent = String(Math.round(zoomLevel * 100));
      document.dispatchEvent(new Event('filo:zoom-proprio'));
    } catch (_) {}
  }
  function zoomVerso(dir) {
    if (dir === 'in') zoomLevel += 0.1;
    else if (dir === 'out') zoomLevel -= 0.1;
    else if (dir === 'reset') zoomLevel = 1;
    else return;
    applyZoom();
  }
  const ZOOM_TASTI = { '+': 'in', '=': 'in', '-': 'out', '_': 'out', 0: 'reset' };
  // Il tasto dello zoom non lo legge questa pagina: lo prende Filo prima di
  // tutti (src/preload/wheel-zoom.js) e lo consegna qui come evento, perché
  // l'editor scala il FOGLIO e non la finestra. Una strada sola su tutti i
  // sistemi: su Mac il tasto se lo prende comunque la barra dei menu.
  for (const [evento, dir] of [['filo:zoom-in', 'in'], ['filo:zoom-out', 'out'], ['filo:zoom-reset', 'reset']]) {
    document.addEventListener(evento, () => zoomVerso(dir));
  }
  // #686 — «zoom al 150%» chiesto in chat. La percentuale arriva nel dataset e
  // non in `detail`: fra il mondo del preload e questo un `detail` non passa.
  document.addEventListener('filo:zoom-set', () => {
    const grezzo = parseFloat(document.documentElement.dataset.filoZoomTarget || '');
    if (!Number.isFinite(grezzo) || grezzo <= 0) return;
    zoomLevel = grezzo / 100;
    applyZoom();
  });
  docWrap.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    // Passo proporzionale al delta, così il pinch del trackpad resta fluido.
    e.preventDefault();
    zoomLevel *= Math.exp(-e.deltaY * 0.0015);
    applyZoom();
  }, { passive: false });

  // GRIGLIA & MODULI

  // Ctrl+Z dato a un elemento del pannello: fuori dai campi il tasto va a lui, e il preload lo deve sapere.
  function dichiaraCtrlZ() {
    const annulla = TASTI_EDITOR.find((t) => t.suo === 'undo');
    const preso = elementiConScorciatoia().some(({ c }) => prendeIlTasto(annulla, pressioneDi(c) || {}));
    if (preso) document.documentElement.dataset.filoCtrlZ = 'pagina';
    else delete document.documentElement.dataset.filoCtrlZ;
  }

  // Gli strumenti del pannello che stanno disegnati: si riempiono di nuovo quando cambia il testo o il documento.
  function aggiornaElementi() {
    if (!pannello) return;
    const wc = pannello.host('word-count');
    if (wc && wc._wcFill) wc._wcFill();
    const cm = pannello.host('comment');
    if (cm && cm._cmFill) cm._cmFill();
  }

  // Impostazioni (l'ingranaggio): uno per strumento, le sue regolazioni e la sua scorciatoia.
  function openStrumentiConfig() {
    const ids = (PANNELLI ? PANNELLI.catalogo('editor').elementi.map((e) => e.id) : []).filter((id) => id !== 'settings');
    const righe = ids.map((id) => {
      const c = candidatoDi(pannello ? pannello.config(id) : {});
      const dentro = pannello && pannello.elementi().includes(id);
      const nota = [c ? nomeMostrato(c) : '', dentro ? '' : 'non nel pannello'].filter(Boolean).join(' · ');
      return `<button class="ed-btn ed-strumento" data-strumento="${id}">
        <span class="ed-strumento-icona">${iconaElemento(id, 16)}</span>
        <span class="ed-strumento-nome">${escapeHtml(nomeElemento(id))}</span>
        <span class="ed-strumento-nota">${escapeHtml(nota)}</span></button>`;
    }).join('');
    openOverlay(`<h3>Strumenti</h3>${righe}
      <div class="ed-overlay-actions"><button class="ed-btn primary" id="ovClose">Chiudi</button></div>`);
    $('ovClose').addEventListener('click', closeOverlay);
    overlayBox.querySelectorAll('[data-strumento]').forEach((b) => b.addEventListener('click', () => openModuleConfig(b.dataset.strumento)));
  }
  // La stessa cornice degli altri strumenti (renderSimpleFormat): un pulsante dentro la sua scheda.
  function renderSettingsModule(host) {
    const pad = document.createElement('div');
    pad.className = 'ed-mod-pad ed-fmt';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ed-fmt-btn ed-fmt-largo ed-strumenti-btn';
    b.innerHTML = `<span class="ed-fmt-glifo">${ICONS.options ? ICONS.options(16) : '⚙'}</span><span class="ed-fmt-nome">Impostazioni degli strumenti</span>`;
    b.title = 'Scorciatoie e regolazioni degli strumenti';
    b.addEventListener('click', (e) => { e.stopPropagation(); openStrumentiConfig(); });
    pad.appendChild(b);
    host.appendChild(pad);
  }


  // docEl.textContent concatena i blocchi SENZA separatore: l'ultima parola di un blocco e la
  // prima del successivo si fondono e i conteggi calano. Si ricostruisce il testo a mano.
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
  // Quello che chat, titolo e riassunto mandano al modello: intero fino al tetto, oltre col taglio detto (#1475).
  function docPerIlModello() {
    return window.SN_EDITOR_SUMMARY.testoAlModello(docPlainText());
  }
  // `costruisci(letto)` dà i messaggi; se il modello rifiuta il documento perché non gli sta nella finestra, si
  // rimanda più corto e `letto` dice il taglio a chi lo mostra.
  async function chiediSulDocumento(action, costruisci, extra = {}) {
    const testo = docPlainText();
    let letto = window.SN_EDITOR_SUMMARY.testoAlModello(testo);
    let r = null;
    for (let giro = 0; giro < 4; giro++) {
      const messages = costruisci(letto);
      r = await sendMessage({ type: MSG.AI_REQUEST, action, payload: { messages }, ...extra });
      if (r && r.ok) break;
      const caratteri = window.SN_FILO_CONTESTO ? window.SN_FILO_CONTESTO.caratteriDi(messages) : 0;
      const corto = window.SN_EDITOR_SUMMARY.rilettoDopoRifiuto(testo, letto, r, caratteri);
      if (!corto) break;
      letto = corto;
    }
    return { r, letto };
  }
  function notaTaglio(letto, perCosa) {
    return window.SN_EDITOR_SUMMARY.notaTaglio(letto, perCosa);
  }
  function contestoDelDocumento(memory) {
    const parts = [];
    if (memory) parts.push('MEMORIA DI FILO (contesto su chi scrive):\n' + memoriaImbustata(memory));
    return parts;
  }
  function bloccoDocumento(letto) {
    const avviso = window.SN_EDITOR_SUMMARY.avvisoTaglio(letto);
    return `DOCUMENTO:\n${avviso ? `${avviso}\n` : ''}${letto.testo}`;
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
  // Cosa conta lo scelgono le impostazioni dell'elemento, e si rilegge a ogni giro.
  function renderWordCount(host) {
    const pad = document.createElement('button');
    pad.type = 'button';
    pad.className = 'ed-mod-pad ed-wc';
    pad.title = 'Statistiche del documento';
    const num = document.createElement('span'); num.className = 'wc-num';
    const cap = document.createElement('span'); cap.className = 'wc-cap';
    pad.appendChild(num); pad.appendChild(cap);
    host.appendChild(pad);
    const fill = () => {
      const scelto = pannello ? pannello.config('word-count').count : '';
      const metric = PANNELLI && PANNELLI.CONTI.includes(scelto) ? scelto : 'words';
      const s = textStats();
      const v = { words: s.words, chars: s.chars, sentences: s.sentences, paragraphs: s.paragraphs }[metric];
      num.textContent = v;
      cap.textContent = { words: v === 1 ? 'parola' : 'parole', chars: v === 1 ? 'carattere' : 'caratteri', sentences: v === 1 ? 'frase' : 'frasi', paragraphs: v === 1 ? 'paragrafo' : 'paragrafi' }[metric];
    };
    fill();
    host._wcFill = fill;
    pad.addEventListener('click', (e) => { e.stopPropagation(); contaModulo({ type: 'word-count' }, 'usato'); showStatsOverlay(); });
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

  // Modulo: cerca e sostituisci
  let findState = { hits: [], idx: -1, term: '' };
  // Quanto la ricerca aspetta prima di andare sulla corrispondenza: scrivendo lettera per
  // lettera, senza pausa inseguirebbe le corrispondenze intermedie aprendo sezioni a caso.
  const FIND_REVEAL_DELAY_MS = 350;
  let findRevealTimer = null;
  function cancelFindReveal() {
    if (!findRevealTimer) return false;
    clearTimeout(findRevealTimer); findRevealTimer = null;
    return true;
  }
  function renderSearchReplace(host) {
    const pad = document.createElement('div');
    pad.className = 'ed-mod-pad ed-sr';
    pad.innerHTML = `
      <div class="ed-sr-campo"><input type="text" placeholder="Cerca" data-sr="find" /><span class="ed-sr-count" data-sr="count"></span></div>
      <input type="text" placeholder="Sostituisci" data-sr="repl" />
      <div class="ed-sr-row">
        <button data-sr="prev">‹ Prec</button>
        <button data-sr="next">Succ ›</button>
      </div>
      <div class="ed-sr-row">
        <button data-sr="one">Sostituisci</button>
        <button data-sr="all">Tutto</button>
      </div>`;
    host.appendChild(pad);
    const findInput = pad.querySelector('[data-sr="find"]');
    const replInput = pad.querySelector('[data-sr="repl"]');
    const countEl = pad.querySelector('[data-sr="count"]');
    host._srFocus = () => { findInput.focus(); findInput.select(); };
    const updateCount = () => { countEl.textContent = findState.hits.length ? `${findState.idx + 1}/${findState.hits.length}` : (findInput.value ? 'nessun risultato' : ''); };
    const run = () => { runFind(findInput.value); updateCount(); };
    // Un uso è una ricerca, non ogni tasto né ogni sostituzione: uno per volta che il campo prende il fuoco.
    let usato = false;
    const contaUnaVolta = () => { if (!usato) { usato = true; contaModulo({ type: 'search-replace' }, 'usato'); } };
    findInput.addEventListener('input', contaUnaVolta);
    findInput.addEventListener('focus', () => { usato = false; });
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
      if (e.key === 'Escape') { e.preventDefault(); finitoDiCercare(); }
    });
    // Esc = "ho finito di cercare": via le evidenziazioni e le sezioni aperte solo per i risultati, e si torna a
    // scrivere nel foglio, dopo la corrispondenza su cui ci si era fermati; il pannello aperto per cercare si chiude.
    function finitoDiCercare() {
      const dopo = puntoDopoCorrispondenza();
      findInput.value = '';
      runFind('', { immediate: true });
      updateCount();
      if (pannello && !pannello.bloccato()) pannello.chiudi();
      docEl.focus();
      const r = (dopo && dopo()) || (ultimaSelezioneFoglio && ultimaSelezioneFoglio.startContainer.isConnected ? ultimaSelezioneFoglio : null);
      if (!r) { focusDocAtEnd(); return; }
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
    replInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); finitoDiCercare(); } });
    replInput.addEventListener('click', (e) => e.stopPropagation());
    pad.querySelector('[data-sr="next"]').addEventListener('click', (e) => { e.stopPropagation(); stepFind(1); updateCount(); });
    pad.querySelector('[data-sr="prev"]').addEventListener('click', (e) => { e.stopPropagation(); stepFind(-1); updateCount(); });
    // Dopo replaceOne NON si rilancia run(): una ri-scansione azzererebbe l'indice e ri-matcherebbe
    // dentro il testo appena inserito (#310). replaceOne avanza da sé.
    pad.querySelector('[data-sr="one"]').addEventListener('click', (e) => { e.stopPropagation(); contaUnaVolta(); replaceOne(replInput.value); updateCount(); });
    pad.querySelector('[data-sr="all"]').addEventListener('click', (e) => { e.stopPropagation(); contaUnaVolta(); replaceAll(findInput.value, replInput.value); run(); });
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
  // La ricerca lavora sul testo CONCATENATO di un blocco, non nodo per nodo: trova le parole
  // spezzate da un tag inline senza matchare a cavallo di due paragrafi (#228).
  function findBlockOf(node) {
    let el = node.parentElement;
    while (el && el !== docEl) {
      if (/^(P|DIV|H1|H2|H3|LI|BLOCKQUOTE)$/.test(el.tagName)) return el;
      el = el.parentElement;
    }
    return docEl;
  }
  // Esclusi: i toggle di collasso (UI iniettata), il testo già dentro un mark (per non
  // ri-matcharlo) e quello di un blocco annidato (processato a parte).
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
  // Una singola occorrenza può vivere in più mark (parte normale + parte in grassetto): il
  // chiamante li raggruppa in UN hit.
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
      // Campo svuotato: le sezioni in prestito tornano chiuse come le aveva lasciate l'utente.
      highlightCurrent(opts);
      return;
    }
    findState.term = term;
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
      // I nodi già avvolti escono dall'haystack alla passata dopo, così il match successivo si
      // trova e gli offset restano validi.
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
  // Evidenziazione e contatore sono SEMPRE immediati: si deve vedere subito che la ricerca
  // risponde. Ad aspettare è solo lo spostamento, e solo mentre si scrive.
  function highlightCurrent(opts) {
    findState.hits.forEach((h, i) => h.marks.forEach((mk) => mk.classList.toggle('current', i === findState.idx)));
    cancelFindReveal();
    const cur = findState.hits[findState.idx];
    const node = cur && cur.marks[0] ? cur.marks[0] : null;
    const go = () => {
      findRevealTimer = null;
      // Prima si richiudono le sezioni in prestito delle corrispondenze di prima: resta aperta solo
      // quella dove ci si è fermati. Campo svuotato → si richiudono tutte.
      closeBorrowedSectionsExcept(node);
      if (!node) return;
      // Una corrispondenza dentro una sezione chiusa è invisibile: il contatore direbbe «1/1»
      // mentre sul foglio non si illumina niente (#385).
      revealCollapsedFor(node, { temporary: true });
      node.scrollIntoView({ block: 'center', behavior: window.SN_THEME_TOKENS?.scrollBehavior(document) || 'smooth' });
    };
    if (opts && opts.immediate) go();
    else findRevealTimer = setTimeout(go, FIND_REVEAL_DELAY_MS);
  }
  function stepFind(dir) {
    if (!findState.hits.length) return;
    findState.idx = (findState.idx + dir + findState.hits.length) % findState.hits.length;
    highlightCurrent({ immediate: true });
  }
  // Invio = portami sulla corrispondenza: se lo spostamento era in attesa della pausa lo esegue
  // subito, altrimenti passa alla successiva (Shift+Invio: la precedente).
  function jumpFind(dir) {
    if (!findState.hits.length) return;
    if (cancelFindReveal() && dir > 0) { highlightCurrent({ immediate: true }); return; }
    stepFind(dir);
  }
  // Gli altri mark — le altre porzioni di una parola formattata — si rimuovono insieme ai wrapper
  // di formattazione rimasti vuoti.
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
    // Niente sostituzioni invisibili: la sezione chiusa si apre PRIMA di toccare il testo. E NON
    // in prestito: lì il testo è cambiato, deve restare aperta.
    cancelFindReveal();
    revealCollapsedFor(cur.marks[0]);
    keepRevealedFor(cur.marks[0]);
    // Avanza senza ri-eseguire la ricerca: vedi sopra, il bottone «sostituisci» (#310).
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
    // Prima si riaprono tutte le sezioni con una corrispondenza, così si vede cosa è cambiato
    // invece di scoprirlo per caso (#385). Anche qui l'apertura resta.
    findState.hits.forEach((hit) => { revealCollapsedFor(hit.marks[0]); keepRevealedFor(hit.marks[0]); });
    findState.hits.forEach((hit) => replaceHitMarks(hit, replacement));
    clearFind();
    onDocInput();
  }

  // Modulo: commenta
  function renderCommentModule(host) {
    const pad = document.createElement('div');
    pad.className = 'ed-mod-pad ed-comment-mod';
    pad.innerHTML = `<button type="button" class="ed-cm-nuovo" title="Seleziona il testo da commentare">${ICONS.share ? ICONS.share(14) : ''}<span>Commenta</span></button>
      <button type="button" class="ed-cm-elenco" title="Tutti i commenti"><span class="cm-count"></span><span class="wc-cap"></span></button>`;
    host.appendChild(pad);
    const fill = () => {
      const n = doc ? doc.comments.filter((c) => !c.resolved).length : 0;
      pad.querySelector('.cm-count').textContent = n;
      pad.querySelector('.wc-cap').textContent = n === 1 ? 'aperto' : 'aperti';
      pad.querySelector('.ed-cm-elenco').hidden = !(doc && doc.comments.length);
    };
    fill();
    host._cmFill = fill;
    pad.querySelector('.ed-cm-nuovo').addEventListener('click', (e) => { e.stopPropagation(); contaModulo({ type: 'comment' }, 'usato'); startCommenting(); });
    pad.querySelector('.ed-cm-elenco').addEventListener('click', (e) => { e.stopPropagation(); contaModulo({ type: 'comment' }, 'usato'); showCommentsList(); });
  }
  // Chi ha già selezionato il testo commenta quello: l'invito a selezionare è per chi non l'ha fatto.
  function startCommenting() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && sel.toString().trim() && docEl.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      commenting = false;
      root.classList.remove('commenting');
      promptComment(sel);
      return;
    }
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
    // Selection.toString() mette interruzioni di riga fra i blocchi, il testo puro no: senza
    // normalizzare, una selezione multi-paragrafo sarebbe orfana fin dalla creazione.
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
      // Stesso cammino del re-ancoraggio al reload, multi-blocco compreso (wrapCommentRange).
      highlightComment(c);
      closeOverlay();
      onDocInput();
    });
  }
  // Ancoraggio commenti { from, to, text }: offset sul testo puro più il testo scelto come
  // fallback. Al reload gli offset reggono; se il testo è cambiato si cerca `text`.
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
  // Null se i confini non cadono in nodi testo del documento: in quel caso l'ancora vive solo di
  // `text`.
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
  // Uno span per nodo testo intersecato: funziona anche su selezioni multi-blocco, dove
  // surroundContents fallirebbe.
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
  // Preferisce gli offset se il testo lì sotto coincide ancora, altrimenti cerca il testo.
  function highlightComment(c) {
    const a = c.anchor;
    if (!a || !a.text) return false;
    // Un'ancora può contenere le interruzioni di riga di una selezione multi-paragrafo: si
    // confronta sempre la forma normalizzata, e la lunghezza si riprende da lì, non da `a.to`.
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
  // Ri-calcola le ancore dagli span nel DOM: se l'utente ha editato il testo attorno, gli offset
  // salvati restano allineati.
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
    // Invariante UX: se dal modulo si crea il PRIMO commento con un click, dalla lista si deve
    // poter avviare anche il secondo.
    $('ovNew').addEventListener('click', startCommenting);
    overlayBox.querySelectorAll('[data-resolve]').forEach((b) => b.addEventListener('click', () => {
      const c = doc.comments.find((x) => x.id === b.dataset.resolve); if (c) c.resolved = !c.resolved;
      markDirty(); aggiornaElementi(); showCommentsList();
    }));
    overlayBox.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      doc.comments = doc.comments.filter((x) => x.id !== b.dataset.del);
      removeCommentSpans(b.dataset.del); // tutti gli span (multi-blocco compreso)
      markDirty(); aggiornaElementi();
      if (doc.comments.length) showCommentsList(); else closeOverlay();
    }));
  }

  // Formattazione guidata dalla chat: la chat può rispondere con un blocco JSON di «azioni» che
  // applichiamo al documento, oltre alla risposta testuale.

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

  function blockEls() {
    return Array.from(docEl.children).filter((n) => n.nodeType === Node.ELEMENT_NODE && n.tagName !== 'BR');
  }

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

  // Ritorna il wrapper (o null se vuoto).
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

  // Serve sia per rimuovere uno stile sia per evitare wrapping duplicati.
  function unwrapTag(host, tagName) {
    host.querySelectorAll(tagName).forEach((el) => {
      const parent = el.parentNode;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    });
  }
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

  // Ritorna il numero di blocchi toccati (0 = niente da fare, es. target senza corrispondenze).
  function applyFormatActions(actions) {
    if (!Array.isArray(actions)) return 0;
    // Cattura lo stato PRIMA di mutare il DOM: se la modifica di Filo cambia davvero qualcosa,
    // questo diventa il punto di ripristino annullabile.
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

  // Cerca un blocco ```json … ``` o un oggetto JSON con campo «actions». Null se la risposta non
  // contiene azioni (→ va mostrata come testo).
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

  // Espone i motori di parsing/applicazione per i test (e per debug).
  window.__filoEditorFormat = { parseFormatActions, applyFormatActions, resolveTargets };

  // Il documento rinominato (a mano o dal titolo automatico): le righe delle sue chat dicono il nome nuovo.
  function rinominaNelFilo(id, title) {
    if (!id) return;
    sendMessage({ type: MSG.FILO_CONVERSAZIONE_APP_RINOMINA, app: 'editor', prefisso: `${id}:`, soggetto: title || STORE.DEFAULT_TITLE });
  }
  // Una chat che l'Editor butta via davvero se ne va anche dal filo.
  function dimenticaNelFilo(campi) {
    sendMessage({ type: MSG.FILO_CONVERSAZIONE_APP_DIMENTICA, app: 'editor', ...campi });
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      try { chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, error: 'no response' })); }
      catch (e) { resolve({ ok: false, error: e.message }); }
    });
  }

  // Le regolazioni di uno strumento del pannello: la sua scorciatoia, e cosa conta il conteggio.
  function openModuleConfig(id) {
    if (!pannello || !PANNELLI || !PANNELLI.noto('editor', id)) return;
    const m = { type: id, id, data: pannello.config(id) };
    const meta = { label: nomeElemento(id) };
    const nelPannello = pannello.elementi().includes(id);
    let specific = '';
    if (m.type === 'word-count') {
      const cur = m.data.count || 'words';
      specific = `<div class="ed-field"><label>Conta</label><select id="cfgCount">
        ${['words', 'chars', 'sentences', 'paragraphs'].map((v) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${({ words: 'Parole', chars: 'Caratteri', sentences: 'Frasi', paragraphs: 'Paragrafi' })[v]}</option>`).join('')}
      </select></div>`;
    }
    const libera = scorciatoiaLibera(m);
    const senzaAzione = !AZIONE_SCORCIATOIA[m.type];
    const giaSalvata = candidatoDi(m.data);
    const mostrata = nomeMostrato(giaSalvata);
    openOverlay(`<h3>${meta.label}</h3>
      <div class="ed-field"${senzaAzione && !giaSalvata ? ' hidden' : ''}><label for="cfgShortcut">Scorciatoia da tastiera</label>
        <input type="text" id="cfgShortcut" autocomplete="off" spellcheck="false" placeholder="Premi i tasti${libera ? `, es. ${escapeHtml(libera)}` : ''}" value="${escapeHtml(mostrata)}" />
        <div class="ed-field-hint" id="cfgShortcutHint" hidden>Usa almeno un modificatore (${escapeHtml(tasto('Ctrl'))} o Alt)${libera ? `, es. ${escapeHtml(libera)}` : ''}, così non ruba una lettera mentre scrivi.</div>
        <div class="ed-field-hint" id="cfgShortcutTaken" hidden></div>
        <div class="ed-field-hint ed-field-nota" id="cfgShortcutNota" hidden></div></div>
      ${specific}
      <div class="ed-overlay-actions">
        <button class="ed-btn" id="cfgPannello">${nelPannello ? 'Togli dal pannello' : 'Metti nel pannello'}</button>
        <button class="ed-btn" id="cfgCancel">Annulla</button>
        <button class="ed-btn primary" id="cfgSave">Salva</button>
      </div>`);
    $('cfgCancel').addEventListener('click', closeOverlay);
    $('cfgPannello').addEventListener('click', () => {
      closeOverlay();
      if (nelPannello) pannello.togli(id);
      else pannello.aggiungi(id);
      contaModulo(m, nelPannello ? 'tolto' : 'aggiunto');
    });
    const cfgShortcut = $('cfgShortcut');
    const cfgShortcutHint = $('cfgShortcutHint');
    const cfgShortcutTaken = $('cfgShortcutTaken');
    const cfgShortcutNota = $('cfgShortcutNota');
    // L'ultima combinazione premuta nel campo: { mostrata, c }. Riscrivere a mano il campo la lascia.
    let registrata = null;
    let primaDellAttesa = null;
    function pulisci() {
      cfgShortcut.classList.remove('ed-field-invalid');
      cfgShortcutHint.hidden = true;
      cfgShortcutTaken.hidden = true;
      cfgShortcutNota.hidden = true;
    }
    cfgShortcut.addEventListener('input', () => { registrata = null; primaDellAttesa = null; pulisci(); });
    // Una combinazione premuta (o quella salvata) è un pezzo solo: Backspace e Canc la tolgono tutta.
    cfgShortcut.addEventListener('keydown', (e) => {
      if ((e.key !== 'Backspace' && e.key !== 'Delete') || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const v = cfgShortcut.value;
      if (!v || !((registrata && v === registrata.mostrata) || (giaSalvata && v === mostrata))) return;
      e.preventDefault();
      cfgShortcut.value = '';
      registrata = null;
      pulisci();
    });
    function mostraAvviso(testo) {
      cfgShortcut.classList.add('ed-field-invalid');
      cfgShortcutTaken.textContent = testo;
      cfgShortcutTaken.hidden = false;
    }
    function mostraRifiuto(r) {
      if (r.tipo !== 'senzaModificatore') { mostraAvviso(testoRifiuto(r, m)); return; }
      cfgShortcut.classList.add('ed-field-invalid');
      cfgShortcutHint.hidden = false;
    }
    const AVVISO_SENZA_AZIONE = `«${meta.label}» non ha un'azione unica da far partire con un tasto: svuota il campo e salva.`;
    // Col fuoco nel campo una combinazione con Ctrl, Cmd o Alt si registra invece di fare la sua cosa (#893);
    // le lettere si scrivono, perché una scorciatoia si può anche scrivere a mano.
    cfgShortcut.addEventListener('focus', () => avviaAscolto(cfgShortcut, {
      premuto(e) {
        const plat = TASTI.piattaforma();
        const r = TASTI.tastoFisicoDaEvento(e, layoutTastiera, plat);
        if (!r) return;
        if (r.attesa) {
          if (primaDellAttesa == null) primaDellAttesa = cfgShortcut.value;
          const mac = plat === 'darwin';
          const tenuti = [(e.ctrlKey || (e.metaKey && mac)) && 'Ctrl', e.metaKey && !mac && 'Win', e.altKey && 'Alt', e.shiftKey && 'Shift', '…'].filter(Boolean);
          cfgShortcut.value = TASTI.etichettaScritta(tenuti.join('+'), plat);
          return;
        }
        if (primaDellAttesa != null) cfgShortcut.value = primaDellAttesa;
        primaDellAttesa = null;
        pulisci();
        if (r.rifiuto) { mostraRifiuto(r.rifiuto); return; }
        const c = { nome: r.nome, tasto: r.tasto, car: r.car };
        registrata = { mostrata: TASTI.etichettaScritta(r.nome, plat), c };
        cfgShortcut.value = registrata.mostrata;
        const no = senzaAzione ? null : rifiuto(c, m);
        if (no) mostraRifiuto(no);
      },
      lasciato(e) {
        if (primaDellAttesa == null || e.ctrlKey || e.metaKey || e.altKey) return;
        cfgShortcut.value = primaDellAttesa;
        primaDellAttesa = null;
      },
    }));
    cfgShortcut.addEventListener('blur', () => {
      if (primaDellAttesa != null) cfgShortcut.value = primaDellAttesa;
      primaDellAttesa = null;
      fermaAscolto();
    });
    // Una scorciatoia salvata prima di questi controlli può essere già morta:
    // lo si dice all'apertura, non solo quando la si riscrive.
    const rifiutoGiaSalvata = rifiuto(giaSalvata, m);
    if (giaSalvata && senzaAzione) mostraAvviso(AVVISO_SENZA_AZIONE);
    else if (rifiutoGiaSalvata) mostraRifiuto(rifiutoGiaSalvata);
    else if (giaSalvata && !giaSalvata.tasto) {
      cfgShortcutNota.textContent = `Non so ancora quale tasto è ${mostrata} su questa tastiera: premi la combinazione per fissarla. Intanto parte come prima.`;
      cfgShortcutNota.hidden = false;
    }
    $('cfgSave').addEventListener('click', () => {
      const scritta = cfgShortcut.value.trim();
      if (scritta && senzaAzione) { mostraAvviso(AVVISO_SENZA_AZIONE); cfgShortcut.focus(); return; }
      let c = null;
      if (scritta && registrata && scritta === registrata.mostrata) c = registrata.c;
      else if (scritta && giaSalvata && scritta === mostrata) c = giaSalvata;
      else if (scritta) {
        const v = daScritta(scritta, m);
        if (v.rifiuto) { mostraRifiuto(v.rifiuto); cfgShortcut.focus(); return; }
        c = v.c;
      }
      const r = rifiuto(c, m);
      if (r) { mostraRifiuto(r); cfgShortcut.focus(); return; }
      // La configurazione la conserva il main: le scorciatoie di Filo la confrontano subito con le loro (#842).
      const config = {};
      if (c) { config.shortcut = c.nome; if (c.tasto) config.tasto = c.tasto; }
      if (m.type === 'word-count') config.count = $('cfgCount').value;
      const nuovaScorciatoia = `${m.data.shortcut || ''}|${m.data.tasto || ''}` !== `${config.shortcut || ''}|${config.tasto || ''}`;
      closeOverlay();
      pannello.configura(id, config).then(() => { dichiaraCtrlZ(); aggiornaElementi(); });
      contaModulo(m, 'configurato');
      if (nuovaScorciatoia) contaModulo(m, c ? 'scorciatoia_si' : 'scorciatoia_no');
    });
    // Invio in un campo conferma come «Salva», come Esc annulla (#545).
    overlayBox.querySelectorAll('input[type="text"]').forEach((inp) => inp.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      e.preventDefault();
      $('cfgSave').click();
    }));
  }

  // ── Scorciatoie modulo personalizzate ──────────────────────────────────
  // Nome scritto, tasto premuto e controlli comuni (tasti di Filo e del sistema, nomi sconosciuti, simboli che
  // cambiano) stanno in SN_TASTI, la stessa regola delle scorciatoie di Filo: qui solo l'Editor e i suoi moduli (#545, #842).
  // Si salva il tasto fisico (m.data.tasto, #893); m.data.shortcut ne tiene il nome, e da solo è una scorciatoia
  // salvata come testo prima, che parte come allora.

  // Cosa scrive ogni tasto lo dice il sistema, e cambia se l'utente cambia tastiera: si richiede a ogni campo.
  let layoutTastiera = null;
  function leggiLayout() {
    try {
      const k = navigator.keyboard;
      if (!k || typeof k.getLayoutMap !== 'function') return Promise.resolve(layoutTastiera);
      return Promise.resolve(k.getLayoutMap()).then((mappa) => {
        const o = {};
        mappa.forEach((v, c) => { o[c] = v; });
        layoutTastiera = o;
        return o;
      }, () => layoutTastiera);
    } catch (_) { return Promise.resolve(layoutTastiera); }
  }

  // Una scorciatoia di modulo: { nome } in forma Windows, `tasto` se è legata al tasto fisico, `car` il carattere
  // uscito premendola (solo appena premuta: serve ai confronti coi tasti scritti a nome, come «Ctrl+?»).
  function candidatoDi(data) {
    const nome = data && typeof data.shortcut === 'string' ? data.shortcut.trim() : '';
    if (!nome) return null;
    return TASTI.tastoValido(data.tasto) ? { nome, tasto: data.tasto } : { nome };
  }
  function nomeMostrato(c) {
    if (!c) return '';
    if (!c.tasto) return c.nome;
    return TASTI.etichettaScritta((layoutTastiera && TASTI.nomeTastoFisico(c.tasto, layoutTastiera)) || c.nome, TASTI.piattaforma());
  }
  function pressioneDi(c) {
    if (!c) return null;
    return c.tasto ? TASTI.pressioneFisica(c.tasto, layoutTastiera, TASTI.piattaforma(), c.car) : TASTI.pressioneScritta(c.nome);
  }
  function colpisce(c, e) {
    return !!c && !!e && (c.tasto ? TASTI.combaciaFisico(e, c.tasto) : matchShortcut(e, c.nome));
  }
  // Due scorciatoie partono dallo stesso tasto? Quella scritta si prova sulla pressione dell'altra, come farebbe il tasto vero.
  function stessoTasto(a, b) {
    if (a.tasto && b.tasto) return a.tasto === b.tasto;
    const [fisica, altra] = b.tasto ? [b, a] : [a, b];
    return colpisce(altra, pressioneDi(fisica));
  }
  // Scritta a mano: { c } o { rifiuto }. Senza sapere com'è fatta la tastiera, una lettera o un simbolo restano testo.
  function daScritta(sc, m) {
    const r = TASTI.tastoFisicoDaScritta(sc, layoutTastiera, TASTI.piattaforma());
    // Un simbolo da premere che però Filo o l'Editor si prendono comunque («Ctrl+_» è lo zoom): meglio dire quello.
    if (r && r.rifiuto && m && (r.rifiuto.tipo === 'senzaTastoProprio' || r.rifiuto.tipo === 'simbolo')) {
      const comeTesto = rifiuto({ nome: String(sc).trim() }, m);
      if (comeTesto && (comeTesto.tipo === 'presa' || comeTesto.tipo === 'sistema')) return { rifiuto: comeTesto };
    }
    if (r && r.rifiuto) return { rifiuto: r.rifiuto };
    return { c: r ? { nome: r.nome, tasto: r.tasto } : { nome: String(sc).trim() } };
  }

  // Le scorciatoie salvate come testo si legano al tasto appena si sa com'è fatta la tastiera; quelle che non si
  // convertono (un simbolo senza un tasto suo) restano testo, e il pannello dello strumento lo dice.
  function convertiPannello() {
    if (!pannello || !PANNELLI) return;
    for (const { id } of PANNELLI.catalogo('editor').elementi) {
      const d = pannello.config(id);
      if (typeof d.shortcut !== 'string' || !d.shortcut.trim() || TASTI.tastoValido(d.tasto)) continue;
      const r = TASTI.tastoFisicoDaScritta(d.shortcut, layoutTastiera, TASTI.piattaforma());
      if (!r || !r.tasto) continue;
      pannello.configura(id, { ...d, shortcut: r.nome, tasto: r.tasto });
    }
    dichiaraCtrlZ();
  }

  // I vecchi moduli (#1433) si leggono all'apertura, prima che il primo salvataggio li butti, e passano agli strumenti;
  // senza risposta dal main restano nei documenti, e la prossima apertura ci riprova.
  let moduliVecchi = [];
  const conModuli = (f) => !!(f && Array.isArray(f.modules) && f.modules.length);
  function ricordaModuli() {
    moduliVecchi = ((collection && collection.files) || []).filter(conModuli)
      .map((f) => ({ id: f.id, meta: { modified: f.meta && f.meta.modified }, modules: cloneJson(f.modules) }));
  }
  async function migraModuli() {
    const files = (collection && collection.files) || [];
    const fonte = { activeId: collection.activeId, files: [...moduliVecchi, ...files.filter((f) => conModuli(f) && !moduliVecchi.some((v) => v.id === f.id))] };
    if (!fonte.files.length && !files.some((f) => f && f.meta && f.meta.grid)) return;
    const config = PANNELLI ? PANNELLI.configDaModuli('editor', fonte) : {};
    const r = await sendMessage({ type: MSG.PANNELLO_APP_MODIFICA, app: 'editor', op: 'migra', config });
    if (!r || !r.ok) return;
    moduliVecchi = [];
    for (const f of files) { if (f) { f.modules = []; if (f.meta) delete f.meta.grid; } }
    writeCollection();
  }

  // Gli strumenti con una scorciatoia, dentro o fuori dal pannello: la scorciatoia è dello strumento, come Ctrl+B è del
  // Grassetto anche fuori dal pannello (#1433). Sentinella: tests/editor-scorciatoie-strumenti.spec.mjs.
  function elementiConScorciatoia() {
    if (!pannello || !PANNELLI) return [];
    const ids = PANNELLI.catalogo('editor').elementi.map((e) => e.id);
    return ids.filter((id) => AZIONE_SCORCIATOIA[id])
      .map((id) => ({ id, c: candidatoDi(pannello.config(id)) }))
      .filter((x) => x.c);
  }

  // Il campo che sta registrando una combinazione: il main gli lascia anche i tasti che si prende prima della
  // pagina (patterns/chi-registra-una-combinazione-riceve-anche-i-tasti-che-filo.md), e li rinnova finché ascolta.
  let ascolto = null;
  function chiediTasti(attivo) {
    try { Promise.resolve(chrome.runtime.sendMessage({ type: MSG.REGISTRA_TASTI, attivo })).catch(() => {}); } catch (_) {}
  }
  function avviaAscolto(el, gestori) {
    if (ascolto && ascolto.el === el) return;
    fermaAscolto();
    const html = document.documentElement;
    ascolto = { el, ...gestori, ctrlZ: html.dataset.filoCtrlZ, rinnovo: setInterval(() => chiediTasti(true), 20000) };
    // Ctrl+Z qui è un tasto da registrare, non «torna alla pagina di prima».
    html.dataset.filoCtrlZ = 'pagina';
    chiediTasti(true);
    leggiLayout();
  }
  function fermaAscolto() {
    if (!ascolto) return;
    const a = ascolto;
    ascolto = null;
    clearInterval(a.rinnovo);
    if (a.ctrlZ === undefined) delete document.documentElement.dataset.filoCtrlZ;
    else document.documentElement.dataset.filoCtrlZ = a.ctrlZ;
    chiediTasti(false);
  }
  window.addEventListener('keydown', (e) => {
    if (!ascolto || e.target !== ascolto.el || !(e.ctrlKey || e.metaKey || e.altKey)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.isComposing || e.repeat) return;
    ascolto.premuto(e);
  }, true);
  window.addEventListener('keyup', (e) => { if (ascolto && e.target === ascolto.el) ascolto.lasciato(e); }, true);

  // Un modificatore "reale" cambia il carattere prodotto: Ctrl/Cmd/Alt. Shift da
  // solo NON basta (Shift+b digita comunque "B"), quindi non conta come reale.
  function shortcutHasRealModifier(sc) {
    const p = TASTI.pressioneScritta(sc);
    return !!p && (p.ctrlKey || p.metaKey || p.altKey);
  }
  function isEditableTarget(t) {
    if (!t) return false;
    if (t.isContentEditable) return true;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }
  function matchShortcut(e, sc) {
    return !!sc && TASTI.combacia(e, sc);
  }
  // I tasti che l'Editor serve PRIMA dei moduli: il keydown li legge da qui e il
  // salvataggio di una scorciatoia li rifiuta da qui, così non possono divergere.
  // `suo`: il modulo per cui quel tasto fa già la sua cosa, e può averlo.
  const TASTI_EDITOR = [
    { tasti: ['s'], cosa: 'salva il documento', fa: () => save(true) },
    { tasti: ['\\'], cosa: 'apre e chiude il pannello degli strumenti', fa: () => { if (pannello) pannello.commuta('tasto'); } },
    { tasti: ['f'], cosa: 'porta alla ricerca', suo: 'search-replace', attivo: () => !!pannello,
      fa: () => triggerModuleShortcut('search-replace') },
    // Shift indifferente: su molte tastiere il "+" si fa con Shift. Il tasto lo
    // prende Filo prima di questa pagina (fa: null): qui non va dato a un modulo.
    { cosa: 'zooma il foglio', prende: (e) => !e.altKey && !!ZOOM_TASTI[e.key], fa: null },
    { tasti: ['b'], cosa: 'mette il grassetto', suo: 'bold', nelFoglio: true, fa: () => exec('bold') },
    { tasti: ['i'], cosa: 'mette il corsivo', suo: 'italic', nelFoglio: true, fa: () => exec('italic') },
    { tasti: ['u'], cosa: 'sottolinea', suo: 'underline', nelFoglio: true, fa: () => exec('underline') },
    // Li serve il browser (fa: null): un modulo li toglierebbe al foglio. Su Mac il browser non
    // li fa: quelli che esistono sono della barra dei menu (già riservati), Cmd+Y non fa niente.
    { tasti: ['z'], cosa: 'annulla l\'ultima modifica', suo: 'undo', delBrowser: true, fa: null },
    { tasti: ['y'], cosa: 'ripete la modifica annullata', suo: 'redo', delBrowser: true, fa: null },
    { tasti: ['z'], shift: true, cosa: 'ripete la modifica annullata', suo: 'redo', delBrowser: true, fa: null },
    { tasti: ['x'], cosa: 'taglia', delBrowser: true, fa: null },
    { tasti: ['c'], cosa: 'copia', delBrowser: true, fa: null },
    { tasti: ['v'], cosa: 'incolla', delBrowser: true, fa: null },
    { tasti: ['v'], shift: true, cosa: 'incolla senza formattazione', delBrowser: true, fa: null },
    { tasti: ['a'], cosa: 'seleziona tutto', delBrowser: true, fa: null },
    // Cancellare e muoversi per parole, o fino all'inizio e alla fine: un modulo li toglierebbe a chi scrive.
    { cosa: 'serve a cancellare e a muoversi nel testo', scrittura: true, fa: null },
  ];
  const TASTI_SCRITTURA = ['Backspace', 'Canc', '←', '→', '↑', '↓', 'Inizio', 'Fine'];
  // Su Mac per parole si va con Opzione; Cmd vale Ctrl come ovunque.
  function tastoDiScrittura(e) {
    const mod = TASTI.suMac() && e.altKey && !e.ctrlKey && !e.metaKey ? 'Alt' : (e.ctrlKey || e.metaKey) ? 'Ctrl' : '';
    return !!mod && TASTI_SCRITTURA.some((k) => TASTI.combacia(e, `${mod}+${k}`) || TASTI.combacia(e, `${mod}+Shift+${k}`));
  }
  function prendeIlTasto(t, e) {
    if (t.scrittura) return tastoDiScrittura(e);
    if (!(e.ctrlKey || e.metaKey)) return false;
    if (t.delBrowser && TASTI.suMac()) return false;
    if (t.prende) return t.prende(e);
    return t.tasti.some((k) => TASTI.combacia(e, ['Ctrl', ...(t.shift ? ['Shift'] : []), k].join('+')));
  }
  // Perché una scorciatoia non partirebbe mai su questo modulo per i tasti dell'Editor o di un altro modulo ('' = va bene).
  // Il tasto si prova con la pressione che fa su questa tastiera: sulla francese Ctrl+6 scrive «-», ed è lo zoom.
  function motivoScorciatoiaPresa(c, m) {
    const e = pressioneDi(c);
    if (!e) return '';
    const nome = TASTI.etichettaScritta(c.nome, TASTI.piattaforma());
    const t = TASTI_EDITOR.find((x) => prendeIlTasto(x, e));
    if (t && t.suo !== m.type) return `${nome} nell'Editor ${t.cosa}, quindi questo strumento non partirebbe mai`;
    const altro = elementiConScorciatoia().find((x) => x.id !== m.type && stessoTasto(c, x.c));
    if (altro) return `${nome} è già la scorciatoia di «${nomeElemento(altro.id)}», e partirebbe solo quello`;
    return '';
  }
  // Perché una scorciatoia (un candidato, vedi `candidatoDi`) non si salva su questo modulo, o null. La
  // stessa regola rifiuta al salvataggio, avvisa all'apertura e sceglie gli
  // esempi degli avvisi: un esempio che poi si rifiuta non esce (#545).
  function rifiuto(c, m) {
    if (!c) return null;
    const plat = TASTI.piattaforma();
    const comune = c.tasto
      ? TASTI.rifiutoFisico(c.tasto, layoutTastiera, plat, { car: c.car, nome: TASTI.etichettaScritta(c.nome, plat) })
      : TASTI.rifiutoScritta(c.nome, plat);
    if (comune) return comune;
    const motivo = motivoScorciatoiaPresa(c, m);
    return motivo ? { tipo: 'presa', motivo } : null;
  }
  function testoRifiuto(r, m) {
    const libera = scorciatoiaLibera(m);
    const perEsempio = libera ? `, per esempio ${libera}` : '';
    if (r.tipo === 'senzaTastoProprio') return `Su questa tastiera «${r.nome}» non ha un tasto suo: premi la combinazione invece di scriverla.`;
    if (r.tipo === 'macControl') return `Su Mac le scorciatoie dei moduli si fanno con ${tasto('Ctrl')}, non con Control.`;
    if (r.tipo === 'win') return `Il tasto ${TASTI.piattaforma() === 'linux' ? 'Super' : 'Windows'} lo usa il sistema: usa Ctrl o Alt.`;
    if (r.tipo === 'modificatore') {
      return `Non riconosco «${r.nome}» come tasto da tenere premuto: usa ${tasto('Ctrl')}, Alt o Shift (Maiusc)${libera ? `, es. ${libera}` : ''}.`;
    }
    if (r.tipo === 'senzaTasto') return `Manca il tasto da premere insieme a ${r.nome}: aggiungi una lettera o una cifra${libera ? `, es. ${libera}` : ''}.`;
    if (r.tipo === 'tasto') {
      const conNome = primaLibera(ESEMPI_CON_NOME, m);
      return `Non riconosco il tasto «${r.nome}»: usa una lettera, una cifra o un nome come Spazio, Invio, Esc, Tab, Su, Giù, F1…${conNome ? ` (es. ${conNome})` : ''}.`;
    }
    if (r.tipo === 'sistema') return `${r.nome} se la prende il sistema operativo e non arriverebbe mai a questo modulo: scegline un'altra${perEsempio}.`;
    if (r.tipo === 'altgr') return `${r.nome} su Windows è anche AltGr, che scrive caratteri come € e @: scegline un'altra${perEsempio}.`;
    if (r.tipo === 'simbolo') {
      return r.modificatore === 'Shift'
        ? `Con Shift il simbolo cambia, quindi ${r.nome} scritta così non partirebbe mai: premi la combinazione invece di scriverla, o scegline un'altra${perEsempio}.`
        : `Con ${tasto(r.modificatore)} il simbolo cambia, quindi ${r.nome} non partirebbe mai: scegline un'altra${perEsempio}.`;
    }
    const motivo = r.cosa ? `${r.nome} è già di Filo (${r.cosa}) e non arriverebbe mai a questo modulo` : r.motivo;
    return `${motivo}: scegline un'altra${perEsempio}.`;
  }
  // Gli esempi escono coi nomi dei tasti di chi legge; '' se sono tutti presi.
  const ESEMPI_LIBERI = ['Ctrl+Shift', 'Ctrl+Alt+Shift'].flatMap((mods) => [...'123456789'].map((d) => tasto(`${mods}+${d}`)));
  const ESEMPI_CON_NOME = ['Ctrl+Shift+Spazio', 'Ctrl+Alt+Spazio', 'Ctrl+Shift+Invio', 'Ctrl+Alt+Invio'].map((a) => tasto(a));
  function primaLibera(candidati, m) {
    return candidati.find((sc) => { const v = daScritta(sc, m); return !!v.c && !rifiuto(v.c, m); }) || '';
  }
  function scorciatoiaLibera(m) { return primaLibera(ESEMPI_LIBERI, m); }

  // La scorciatoia di uno strumento fa quello che fa il suo clic. Uno che qui non
  // c'è ha più azioni (o nessuna): il campo non gli offre una scorciatoia (#545).
  const AZIONE_SCORCIATOIA = {
    'word-count': () => showStatsOverlay(),
    'search-replace': (host) => host && host._srFocus && host._srFocus(),
    comment: () => startCommenting(),
    bold: () => SIMPLE_FORMATS.bold.act(),
    italic: () => SIMPLE_FORMATS.italic.act(),
    underline: () => SIMPLE_FORMATS.underline.act(),
    undo: () => SIMPLE_FORMATS.undo.act(),
    redo: () => SIMPLE_FORMATS.redo.act(),
  };
  function triggerModuleShortcut(id) {
    const fa = AZIONE_SCORCIATOIA[id];
    if (!fa) return;
    // La ricerca prende solo il fuoco: l'uso lo conta la ricerca scritta.
    if (id !== 'search-replace') { contaModulo({ type: id }, 'usato'); fa(pannello ? pannello.host(id) : null); return; }
    if (!pannello) return;
    // Cerca e sostituisci vuole il suo campo: il tasto apre il pannello, come farebbe chi ci va col mouse, e se lo
    // strumento era stato tolto ce lo rimette, perché chi preme il tasto vuole cercare adesso.
    if (!pannello.aperto()) pannello.apri('tasto');
    if (pannello.host(id)) { fa(pannello.host(id)); return; }
    Promise.resolve(pannello.aggiungi(id)).then(() => fa(pannello.host(id)));
  }

  // ════════════════════════════════════════════════════════════════════
  //  OVERLAY helpers
  // ════════════════════════════════════════════════════════════════════
  // Aprire e CHIUDERE un pannello sono entrambi cambi sotto il cursore: aperto,
  // il colpo di coda cade su un comando del pannello nuovo; chiuso, cade sul
  // foglio dietro (che apre "Aggiungi modulo"). Armano tutti e due.
  let overlayGen = 0;
  // Un campo tolto col fuoco dentro non sempre manda il blur: l'ascolto dei tasti si chiude qui.
  function openOverlay(html) { fermaAscolto(); staleClick.arm(); overlayGen++; overlayBox.innerHTML = html; overlay.hidden = false; }
  function closeOverlay() { fermaAscolto(); staleClick.arm(); overlay.hidden = true; overlayBox.innerHTML = ''; }
  // Allo scadere chiude solo sé stesso: chiudeva qualunque pannello ci fosse, compreso il commento aperto nel frattempo.
  function flashOverlayMsg(text, ms) {
    openOverlay(`<div style="text-align:center;padding:8px 4px">${escapeHtml(text)}</div>`);
    const mio = overlayGen;
    setTimeout(() => { if (overlayGen === mio && !overlay.hidden) closeOverlay(); }, ms || 1400);
  }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });

  // Gli avvisi si IMPILANO, uno per evento col suo timer: con uno solo riusato il nuovo
  // distruggeva l'«Annulla» del precedente. Due argini, numero e altezza (PATTERNS.md).
  const ED_TOAST_MAX = 4;
  let edToastHost = null;
  // Col puntatore su un avviso i tempi di tutta la pila aspettano (regola in avvisiTempo.js).
  const edToastTempi = window.SN_AVVISI.orologio();
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
  // Oltre il tetto si tengono le più recenti. Nessun rischio di perdita: l'undo di
  // un'eliminazione resta comunque nel cestino.
  function enforceEdToastCap() {
    const host = edToastHostEl();
    const live = Array.from(host.children).filter((c) => c.dataset.closing !== '1');
    for (let i = 0; i < live.length - ED_TOAST_MAX; i++) removeEdToast(live[i], true);
  }
  // Va misurato a transizione FINITA: durante l'entrata la card è traslata, e in un contenitore
  // scrollabile ciò allarga l'area scrollabile — la barra resterebbe lì per sempre.
  let edToastOverflowTimer = null;
  const motionMs = (ms) => (window.SN_THEME_TOKENS ? window.SN_THEME_TOKENS.motionMs(ms) : ms);
  function syncEdToastOverflow() {
    clearTimeout(edToastOverflowTimer);
    edToastOverflowTimer = setTimeout(() => {
      const host = edToastHostEl();
      const scrollable = host.scrollHeight - host.clientHeight > 2;
      host.classList.toggle('scrolling', scrollable);
      if (scrollable) host.scrollTop = host.scrollHeight;
    }, motionMs(260)); // > della transizione di entrata/uscita (0.18s / 0.22s)
  }
  function removeEdToast(el, immediate) {
    if (!el || el.dataset.closing === '1') return;
    el.dataset.closing = '1';
    if (el._tempo) el._tempo.annulla();
    // Via un avviso, quelli sopra scivolano giù al suo posto: la pila si è
    // ridisegnata sotto il cursore.
    staleClick.arm();
    el.classList.remove('show');
    const via = () => { try { el.remove(); } catch (_) {} edToastTempi.lascia(el); syncEdToastOverflow(); };
    if (immediate) { via(); return; }
    setTimeout(via, motionMs(220));
  }
  // `action` opzionale = { label, onClick, title?, durata? }: aggiunge un bottone cliccabile nel
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
      if (action.title) btn.title = action.title;
      btn.addEventListener('click', () => {
        removeEdToast(el);
        try { action.onClick(); } catch (_) {}
      });
      el.appendChild(btn);
    }
    // Il clic sull'avviso (fuori dal suo pulsante) lo chiude: è l'unica strada con la durata a 0.
    el.addEventListener('click', (e) => {
      if (e.target.closest('.ed-toast-action')) return;
      const sel = document.getSelection();
      if (sel && !sel.isCollapsed && el.contains(sel.anchorNode)) return;
      removeEdToast(el);
    });
    edToastTempi.segui(el);
    window.SN_AVVISI.chiudibile(el, () => removeEdToast(el));
    const host = edToastHostEl();
    host.appendChild(el);
    edToastTempi.ripulisci();
    // Un avviso nuovo prende il posto in fondo alla pila — proprio dove poteva
    // esserci il bottone appena premuto.
    staleClick.arm();
    enforceEdToastCap();
    // Forza un reflow così la transizione d'ingresso parte.
    void el.offsetWidth;
    el.classList.add('show');
    syncEdToastOverflow();
    // Con un'azione lascio più tempo per cliccarla; col tasto per un'altra pagina ancora di più, come sulle pagine web.
    const base = hasAction ? Math.max(7000, Number(action.durata) || 0) : 3400;
    el._tempo = edToastTempi.avvia(window.SN_AVVISI.durata(base), () => removeEdToast(el));
    return el;
  }

  // Tasti globali, bootstrap
  window.addEventListener('keydown', (e) => {
    // A pannello aperto la tastiera è del pannello: Esc lo chiude, e nessun tasto
    // agisce sul foglio o sui moduli che stanno dietro (#545).
    if (!overlay.hidden) {
      if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); closeOverlay(); }
      return;
    }
    for (const t of TASTI_EDITOR) {
      if (!prendeIlTasto(t, e)) continue;
      if (t.attivo && !t.attivo()) continue;
      if (t.nelFoglio && !docEl.contains(e.target)) continue;
      if (t.fa) { e.preventDefault(); t.fa(e); return; }
      // Il browser annulla e ripete solo in un campo di testo: fuori, il tasto va
      // al modulo che l'ha salvato, come il suo clic.
      if (t.suo && !isEditableTarget(e.target)) break;
      return;
    }
    for (const { id, c } of elementiConScorciatoia()) {
      if (colpisce(c, e)) {
        // Difesa per le scorciatoie senza modificatore già salvate (prima della
        // validazione): mentre si scrive nel documento o in un campo di testo NON
        // devono rubare il tasto — lascia digitare normalmente la lettera.
        if (!c.tasto && !shortcutHasRealModifier(c.nome) && isEditableTarget(e.target)) continue;
        e.preventDefault(); triggerModuleShortcut(id); return;
      }
    }
  });

  window.addEventListener('beforeunload', () => {
    // Ultimo confine: un punto di ripristino se si chiude senza pausa. Best-effort, la scrittura è
    // asincrona; i confini affidabili sono la pausa e il cambio documento.
    maybeRecordManualVersion();
    if (dirty) save(false);
  });

  // pageBootstrap applica solo il tema di SISTEMA; come le altre pagine l'editor deve rispettare
  // il tema SALVATO, o passando dalla dashboard il tema cambierebbe.
  async function applySavedTheme() {
    try {
      const settings = await (window.SN_STORAGE?.getSettings?.());
      if (!settings) return;
      // I tasti di Spiega, Traduci, Salva e Aiuto li sceglie l'utente: la vecchia si libera per i moduli, la nuova è presa (#842).
      TASTI.usaScorciatoieFilo(settings.scorciatoie);
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

  // Hook di test per lo storico versioni: lista e ripristino.
  window.__filoEditorVersions = {
    list: (fileId) => (VERS ? VERS.listFor(versions, fileId || (doc && doc.id)) : []),
    restore: (fileId, versionId) => restoreVersion(fileId, versionId),
    activeId: () => (doc && doc.id),
    ready: () => versionsReady,
    flush: () => persistVersions(),
    openHistory: () => openVersionHistory(),
    // Valuta subito uno snapshot manuale senza aspettare il debounce: usato dagli spec.
    snapshotManual: () => maybeRecordManualVersion(),
  };

  // Gli strumenti del pannello di destra: quali ci sono lo sceglie l'utente, come si disegnano lo dice l'Editor.
  const RENDER = {
    'word-count': renderWordCount,
    'search-replace': renderSearchReplace,
    comment: renderCommentModule,
    'text-size': renderTextSize,
    align: renderAlign,
    font: renderFont,
    settings: renderSettingsModule,
    bold: (h) => renderSimpleFormat(h, 'bold'),
    italic: (h) => renderSimpleFormat(h, 'italic'),
    underline: (h) => renderSimpleFormat(h, 'underline'),
    undo: (h) => renderSimpleFormat(h, 'undo'),
    redo: (h) => renderSimpleFormat(h, 'redo'),
  };
  const ELEMENTI = {};
  for (const id of Object.keys(RENDER)) {
    ELEMENTI[id] = {
      disegna: RENDER[id],
      icona: (n) => iconaElemento(id, n),
      voci: () => (id === 'settings' ? [] : [{ etichetta: `Impostazioni di «${nomeElemento(id)}»…`, fa: () => openModuleConfig(id) }]),
    };
  }
  pannello = window.SN_PANNELLO_DESTRO ? window.SN_PANNELLO_DESTRO.crea({
    app: 'editor',
    elementi: ELEMENTI,
    scorrimento: () => docWrap,
    // Il pannello aperto da uno strumento (impostazioni, commento) e la tendina dei font sono suoi: non lo chiudono.
    appartiene: (t) => !!(t.closest && t.closest('#overlay, .ed-font-pop, .ed-toasts')),
    riquadroAperto: () => !overlay.hidden,
    suCambio: () => { aggiornaElementi(); dichiaraCtrlZ(); },
    mossa: (evento, id) => contaModulo({ type: id }, evento),
  }) : null;

  // L'Aiuto in questa pagina è la chat del documento (#1433): lo legge intero, e ne cambia la formattazione con le
  // azioni che la chat dell'Editor sapeva già fare (applyFormatActions, che crea il punto di ripristino).
  window.SN_AIUTO_APP = Object.freeze({
    app: 'editor',
    segnaposto: 'Chiedi al documento…',
    documento: (prima = null, rifiuto = null, caratteri = 0) => {
      const S = window.SN_EDITOR_SUMMARY;
      const testo = docPlainText();
      const letto = prima ? S.rilettoDopoRifiuto(testo, prima, rifiuto, caratteri) : S.testoAlModello(testo);
      if (!letto) return null;
      return { ...letto, id: doc ? doc.id : '', titolo: (doc && doc.meta && doc.meta.title) || STORE.DEFAULT_TITLE, avviso: S.avvisoTaglio(letto), nota: S.notaTaglio(letto) };
    },
    // `perId`: il documento letto quando è partita la domanda. Se nel frattempo ne è aperto un altro la modifica non
    // tocca quello (null): era chiesta per l'altro.
    applica: (azioni, perId = '') => (perId && (!doc || doc.id !== perId) ? null : applyFormatActions(azioni)),
    // Per i contatori (#1465): il documento letto intero o no, e quante azioni di formato sono andate a segno.
    conta: (campi) => contaRiquadro('editor_chat', { ...campi }),
    conversazione: (rif) => (doc ? {
      app: 'editor',
      rif: `${doc.id}:aiuto-${String(rif || '').slice(0, 80)}`,
      soggetto: (doc.meta && doc.meta.title) || STORE.DEFAULT_TITLE,
      dove: `filo://editor/editor.html?file=${encodeURIComponent(doc.id)}`,
    } : null),
  });

  applySavedTheme();
  loadVersions();                           // storico dall'archivio app (async)
  loadTrash();
  loadCollection();                         // da localStorage (sincrono)
  ricordaModuli();
  // ?file=<id>: un documento scelto da fuori (la carta dell'Editor nella home, #870). Può stare solo
  // nell'archivio (un appunto scritto da Filo a editor chiuso): lo si cerca di nuovo dopo la fusione.
  const fileChiesto = (() => { try { return new URLSearchParams(location.search).get('file') || ''; } catch (_) { return ''; } })();
  activateFile((fileChiesto && STORE.findFile(collection, fileChiesto)) || STORE.activeFile(collection));
  const archivioLetto = reloadFromArchive().then(() => {
    if (fileChiesto && STORE.findFile(collection, fileChiesto) && (!doc || doc.id !== fileChiesto)) switchToFile(fileChiesto);
    else if (doc && STORE.findFile(collection, doc.id)) segnaAperto();
  });
  // Dopo la fusione con l'archivio: scrivere prima cancellerebbe gli appunti che Filo ci ha messo (vedi loadCollection).
  Promise.all([archivioLetto, leggiLayout()]).then(migraModuli).then(convertiPannello, () => {});
})();
