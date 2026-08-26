// Modale "Invia feedback" per l'alpha test.
// Aperta dalla voce di menu omonima. Permette:
//   - testo libero (persistito tra aperture e riavvii)
//   - annotare lo schermo a mano libera (disegno) e allegare lo screenshot
//     annotato in un colpo solo (il pulsante "Annota e allega" fa da toggle)
//   - incollare/trascinare immagini (Ctrl+V o drop ovunque dentro il box)
// Invio → upload immagini su Firebase Storage + record su Firestore.

(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;
  const Popup = global.SN_POPUP;
  const Feedback = global.SN_FEEDBACK;
  const Icons = global.SN_ICONS || {};
  // Allowlist condivisa dei tipi di allegato (stessa lista di storage.rules).
  const AttachTypes = global.SN_FEEDBACK_ATTACH;

  // Testo del rifiuto quando un file non è tra i tipi ammessi (immagini raster,
  // PDF, testo, markdown, CSV, JSON). Vale sia per "Allega" sia per drag & drop.
  const ATTACH_REJECT_MSG =
    'Tipo di file non supportato. Ammessi: immagini, PDF, testo, markdown, CSV e JSON.';

  // Classifica un file secondo l'allowlist condivisa. Fallback prudente se il
  // modulo shared non fosse caricato: consenti solo le immagini raster note.
  function classifyAttachment(file) {
    if (AttachTypes && typeof AttachTypes.classify === 'function') {
      return AttachTypes.classify(file);
    }
    const t = String(file?.type || '').toLowerCase();
    return /^image\/(png|jpe?g|gif|webp|bmp)$/.test(t) ? 'image' : null;
  }

  // Chiave storage per la bozza di testo: sopravvive a chiusura/riapertura del
  // box e al riavvio di Filo (chrome.storage.local → storage.json).
  const DRAFT_KEY = 'sn_feedback_draft_text';
  // Colore/tratto del disegno di annotazione.
  const STROKE_COLOR = '#ff3b30';
  const STROKE_WIDTH = 3;

  let activeRoot = null;
  let activeStack = null;
  let clientIdCache = null;

  // Avvisa la shell (barra in alto di Filo) che si entra/esce dalla modalità
  // annotazione, così l'ombra copre TUTTO Filo e non solo l'area pagina dove
  // vive questo content script.
  function setShellDim(on) {
    try { chrome.runtime.sendMessage({ type: MSG.FEEDBACK_ANNOTATE, on: !!on }); } catch (_) {}
  }

  async function getClientId() {
    if (clientIdCache) return clientIdCache;
    try {
      // Lo shim chrome.storage in Filo ritorna una Promise (no callback).
      const r = await chrome.storage.local.get(['sn_feedback_client_id']);
      let id = r?.sn_feedback_client_id;
      if (!id) {
        id = (global.crypto?.randomUUID?.() || String(Date.now() + Math.random()));
        await chrome.storage.local.set({ sn_feedback_client_id: id });
      }
      clientIdCache = id;
      return id;
    } catch (_) {
      clientIdCache = 'anon-' + Math.random().toString(36).slice(2);
      return clientIdCache;
    }
  }

  function close() {
    if (!activeRoot) return;
    try { activeStack?.unregister?.(); } catch (_) {}
    activeStack = null;
    activeRoot.remove();
    activeRoot = null;
    setShellDim(false);
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  async function captureScreenshot() {
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.CAPTURE_VISIBLE_TAB });
      if (r?.ok && r.dataUrl) return r.dataUrl;
    } catch (_) {}
    return null;
  }

  // Converte un dataUrl in un object URL (blob:) per aggirare le CSP delle pagine
  // ospitanti che bloccano img-src data:. L'object URL va revocato quando l'immagine
  // viene rimossa.
  function dataUrlToBlobUrl(dataUrl) {
    try {
      const m = /^data:([^;,]+)(;base64)?,(.*)$/.exec(dataUrl);
      if (!m) return dataUrl;
      const mime = m[1] || 'application/octet-stream';
      const isB64 = !!m[2];
      const raw = isB64 ? atob(m[3]) : decodeURIComponent(m[3]);
      const buf = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
      return URL.createObjectURL(new Blob([buf], { type: mime }));
    } catch (_) {
      return dataUrl;
    }
  }

  function icon(name, size) {
    try { return typeof Icons[name] === 'function' ? Icons[name](size) : ''; }
    catch (_) { return ''; }
  }

  // Animazione ricompensa (C3): alla chiusura del box, alcune "monete credito"
  // volano dalla posizione del box verso l'angolo in alto a destra — la
  // direzione dell'icona profilo/account — con una piccola etichetta "+N".
  // Vive nel content overlay (la barra in alto della shell è coperta dalla
  // WebContentsView nativa, quindi un'animazione disegnata dalla shell sarebbe
  // occlusa). Puramente decorativa: best-effort, non blocca, si auto-rimuove.
  // Rispetta prefers-reduced-motion (niente volo, solo l'etichetta).
  function flyCredits(originRect, amount) {
    try {
      const n = Math.max(1, Math.round(Number(amount) || 0));
      const reduce = !!(global.matchMedia &&
        global.matchMedia('(prefers-reduced-motion: reduce)').matches);

      const layer = document.createElement('div');
      layer.className = 'sn-fb-credit-fly';
      global.SN_FILO_UI?.mark(layer);
      layer.setAttribute('aria-hidden', 'true');
      Object.assign(layer.style, {
        position: 'fixed', inset: '0', zIndex: '2147483647',
        pointerEvents: 'none', overflow: 'hidden',
      });
      document.documentElement.appendChild(layer);

      const r = originRect && originRect.width
        ? originRect
        : { left: window.innerWidth / 2 - 20, top: window.innerHeight - 80, width: 40, height: 40 };
      const ox = r.left + r.width / 2;
      const oy = r.top + r.height / 2;
      // Bersaglio: angolo in alto a destra, dove vive l'icona profilo/account.
      const tx = Math.max(24, window.innerWidth - 26);
      const ty = 26;
      const GOLD = '#e0a93f';

      // Etichetta "+N" che sale e svanisce sopra l'origine.
      const label = document.createElement('div');
      label.className = 'sn-fb-credit-label';
      label.textContent = `+${n}`;
      Object.assign(label.style, {
        position: 'fixed', left: ox + 'px', top: (oy - 8) + 'px',
        font: '700 16px system-ui, sans-serif', color: GOLD,
        textShadow: '0 1px 3px rgba(0,0,0,.45)', whiteSpace: 'nowrap',
      });
      layer.appendChild(label);

      const coinSvg = icon('credits', 22) || '●';
      const coins = [];
      const count = reduce ? 0 : Math.min(7, Math.max(4, n));
      for (let i = 0; i < count; i++) {
        const c = document.createElement('div');
        c.className = 'sn-fb-coin';
        c.innerHTML = coinSvg;
        Object.assign(c.style, {
          position: 'fixed', left: '0', top: '0', width: '22px', height: '22px',
          color: GOLD, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.4))',
          willChange: 'transform, opacity',
        });
        layer.appendChild(c);
        coins.push(c);
      }

      let maxEnd = 900;
      coins.forEach((c, i) => {
        const sx = ox + (Math.random() - 0.5) * 80;
        const sy = oy + (Math.random() - 0.5) * 30;
        // Punto intermedio: si alza in un arco prima di puntare in alto a destra.
        const mx = (sx + tx) / 2 + (Math.random() - 0.5) * 60;
        const my = Math.min(sy, ty) - 40 - Math.random() * 40;
        const delay = i * 40;
        const dur = 650 + i * 50 + Math.random() * 120;
        maxEnd = Math.max(maxEnd, delay + dur);
        c.animate([
          { transform: `translate(${sx}px,${sy}px) scale(.6)`, opacity: 0 },
          { transform: `translate(${sx}px,${sy}px) scale(1)`, opacity: 1, offset: 0.12 },
          { transform: `translate(${mx}px,${my}px) scale(1.05)`, opacity: 1, offset: 0.55 },
          { transform: `translate(${tx}px,${ty}px) scale(.35)`, opacity: 0 },
        ], { duration: dur, delay, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards' });
      });

      label.animate([
        { transform: 'translate(-50%,-50%) scale(.7)', opacity: 0 },
        { transform: 'translate(-50%,-110%) scale(1)', opacity: 1, offset: 0.25 },
        { transform: 'translate(-50%,-200%) scale(1)', opacity: 0 },
      ], { duration: reduce ? 900 : Math.max(900, maxEnd), easing: 'ease-out', fill: 'forwards' });

      const total = (reduce ? 900 : maxEnd) + 120;
      setTimeout(() => { try { layer.remove(); } catch (_) {} }, total);
    } catch (_) {}
  }

  function open() {
    if (activeRoot) return;
    const root = document.createElement('div');
    root.className = 'sn-fb-overlay';
    global.SN_FILO_UI?.mark(root);
    root.dataset.snTheme = document.documentElement.dataset.snTheme || '';
    // Layout richiesto dall'utente: solo il box per scrivere + 4 bottoni
    // (Allega, Chiudi, Invia, e "Cancella disegno" che compare solo quando c'è
    // qualcosa da cancellare). Si può trascinare/incollare/allegare immagini e
    // disegnare a mano libera su TUTTA l'app (pagina + barra in alto).
    root.innerHTML = `
      <canvas class="sn-fb-canvas"></canvas>
      <div class="sn-fb-modal" role="dialog" aria-modal="true" aria-label="Invia feedback">
        <div class="sn-fb-drag" title="Trascina per spostare il box"><span class="sn-fb-grip"></span></div>
        <div class="sn-fb-body">
          <textarea class="sn-fb-text" rows="4" placeholder="Descrivi il bug o la feature che vorresti. Puoi trascinare qui documenti o immagini."></textarea>
          <div class="sn-fb-thumbs"></div>
          <div class="sn-fb-status" aria-live="polite"></div>
        </div>
        <div class="sn-fb-actions">
          <button type="button" class="sn-fb-btn-secondary sn-fb-cancel">Chiudi</button>
          <button type="button" class="sn-fb-btn-secondary sn-fb-attach">${icon('screenshot', 16)}<span>Allega</span></button>
          <button type="button" class="sn-fb-clear" aria-pressed="false">Allega screenshot</button>
          <button type="button" class="sn-fb-btn sn-fb-send">Invia</button>
        </div>
        <input type="file" class="sn-fb-file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,application/pdf,application/json,text/plain,text/markdown,text/csv,.png,.jpg,.jpeg,.gif,.webp,.bmp,.pdf,.txt,.md,.markdown,.json,.csv,.log,.yml,.yaml" multiple hidden />
      </div>
    `;
    document.documentElement.appendChild(root);
    activeRoot = root;
    // Entra in modalità annotazione: oscura anche la barra in alto di Filo.
    setShellDim(true);
    // Se la pagina viene abbandonata (navigazione o chiusura tab) senza passare
    // da close(), il content script muore ma il velo della shell resterebbe
    // appeso: avvisiamo esplicitamente di toglierlo.
    window.addEventListener('pagehide', () => setShellDim(false), { once: true });
    Popup?.attachZoomCompensation?.(root);
    // Partecipa allo stacking dei popup: sopra ai box aperti prima, sotto a
    // quelli aperti dopo. Il menu contestuale (right-click) ha un proprio
    // z-index più alto, quindi resta sempre visibile sopra il modale.
    activeStack = Popup?.registerStack?.(root) || null;

    const modal = root.querySelector('.sn-fb-modal');
    const dragHandle = root.querySelector('.sn-fb-drag');
    const textEl = root.querySelector('.sn-fb-text');
    const thumbsEl = root.querySelector('.sn-fb-thumbs');
    const statusEl = root.querySelector('.sn-fb-status');
    const sendBtn = root.querySelector('.sn-fb-send');
    const attachBtn = root.querySelector('.sn-fb-attach');
    const clearBtn = root.querySelector('.sn-fb-clear');
    const cancelBtn = root.querySelector('.sn-fb-cancel');
    const canvas = root.querySelector('.sn-fb-canvas');
    const fileInput = root.querySelector('.sn-fb-file');

    // stato locale: data URLs delle immagini incollate/trascinate
    const images = [];
    const MAX_IMAGES = 5;
    // Allegati NON immagine (pdf, txt, md, json, …): { name, type, size, dataUrl }
    const files = [];
    const MAX_FILES = 5;
    const MAX_ATTACH_BYTES = 4 * 1024 * 1024;

    // Anti-duplicati (#370): id STABILE di questa composizione. Tutti i tentativi
    // di invio della stessa bozza condividono l'id, così se un invio va in timeout
    // lato UI ma riesce comunque sul server, ripremere "Invia" NON crea un
    // duplicato (il server rifiuta un secondo doc con lo stesso id). Cambia solo
    // quando l'utente modifica il contenuto (testo o allegati): un messaggio
    // diverso è un feedback diverso e deve poter essere inviato a parte.
    function newSubmissionId() {
      try {
        if (global.crypto?.randomUUID) return global.crypto.randomUUID();
      } catch (_) {}
      return 'sub-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    }
    let submissionId = newSubmissionId();
    function bumpSubmissionId() { submissionId = newSubmissionId(); }

    // ---- bozza di testo persistente ----
    let saveTimer = null;
    function saveDraft() {
      try { chrome.storage.local.set({ [DRAFT_KEY]: textEl.value }); } catch (_) {}
    }
    function clearDraft() {
      try { chrome.storage.local.remove([DRAFT_KEY]); } catch (_) {}
    }
    textEl.addEventListener('input', () => {
      // Contenuto cambiato → nuova composizione (id di invio fresco).
      bumpSubmissionId();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveDraft, 250);
    });
    // Ripristina l'eventuale bozza salvata (solo se l'utente non ha già scritto).
    try {
      chrome.storage.local.get([DRAFT_KEY]).then((r) => {
        const saved = r?.[DRAFT_KEY];
        if (saved && activeRoot === root && !textEl.value) textEl.value = saved;
      }).catch(() => {});
    } catch (_) {}

    // ---- disegno (annotazione a mano libera sullo schermo) ----
    const ctx = canvas.getContext('2d');
    const strokes = []; // [{ color, width, points: [{x,y}] }] in coordinate viewport CSS
    let drawing = false;
    let curStroke = null;
    // C'è un disegno sulla barra in alto di Filo (shell)? La barra vive in un
    // altro processo: lo sappiamo via broadcast FEEDBACK_DRAW_STATE.
    let topbarHasDrawing = false;

    function sizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    }
    function redraw() {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const s of strokes) {
        if (s.points.length < 1) continue;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.beginPath();
        s.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        // Un singolo punto: disegna un puntino.
        if (s.points.length === 1) { ctx.lineTo(s.points[0].x + 0.1, s.points[0].y + 0.1); }
        ctx.stroke();
      }
    }
    function hasPageDrawing() { return strokes.some((s) => s.points.length > 0); }
    // C'è un disegno da cancellare ovunque nell'app? (pagina O barra in alto)
    function hasAnyDrawing() { return hasPageDrawing() || topbarHasDrawing; }

    // Il bottone è sempre presente: di default "Allega screenshot" (premuto =
    // selezionato → all'invio si allega lo scatto della pagina anche senza
    // disegnare). Appena si disegna diventa "Cancella" (stesso colore selezionato)
    // e cliccarlo cancella il disegno.
    let shotArmed = false;
    function updateClearBtn() {
      const drawing = hasAnyDrawing();
      const selected = shotArmed || drawing;
      clearBtn.textContent = drawing ? 'Cancella' : 'Allega screenshot';
      clearBtn.classList.toggle('sn-fb-clear--on', selected);
      clearBtn.setAttribute('aria-pressed', String(selected));
    }
    const refreshClear = updateClearBtn;

    canvas.addEventListener('pointerdown', (e) => {
      drawing = true;
      curStroke = { color: STROKE_COLOR, width: STROKE_WIDTH, points: [{ x: e.clientX, y: e.clientY }] };
      strokes.push(curStroke);
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing || !curStroke) return;
      curStroke.points.push({ x: e.clientX, y: e.clientY });
      redraw();
    });
    function endStroke() {
      if (!drawing) return;
      drawing = false;
      curStroke = null;
      // Appena c'è un disegno, all'invio allegheremo automaticamente lo
      // screenshot annotato (niente più toggle): basta che ci sia un tratto.
      refreshClear();
    }
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);
    window.addEventListener('resize', sizeCanvas);
    sizeCanvas();

    // "Cancella disegno": pulisce i tratti sulla pagina E quelli sulla barra in
    // alto di Filo (che vivono nella shell), così un solo bottone cancella tutto.
    clearBtn.addEventListener('click', () => {
      if (hasAnyDrawing()) {
        // Stato "Cancella": pulisce i tratti (pagina + barra in alto) e disarma.
        strokes.length = 0;
        redraw();
        try { chrome.runtime.sendMessage({ type: MSG.FEEDBACK_CLEAR_DRAW }); } catch (_) {}
        topbarHasDrawing = false;
        shotArmed = false;
      } else {
        // Stato "Allega screenshot": toggle dell'allega-screenshot.
        shotArmed = !shotArmed;
      }
      updateClearBtn();
    });

    // La shell ci dice se c'è (o non c'è più) un disegno sulla barra in alto,
    // così "Cancella disegno" compare anche quando si è disegnato SOLO lassù.
    function onBroadcast(message) {
      // Auto-rimozione quando il box non è più questo (chiuso/riaperto).
      if (activeRoot !== root) {
        try { chrome.runtime.onMessage.removeListener(onBroadcast); } catch (_) {}
        return;
      }
      if (message?.type === MSG.FEEDBACK_DRAW_STATE) {
        topbarHasDrawing = !!message.topbar;
        refreshClear();
      }
    }
    try { chrome.runtime.onMessage.addListener(onBroadcast); } catch (_) {}

    function renderThumbs() {
      // Revoca eventuali object URL precedenti per evitare leak
      thumbsEl.querySelectorAll('img[data-sn-objurl="1"]').forEach((img) => {
        try { URL.revokeObjectURL(img.src); } catch (_) {}
      });
      thumbsEl.innerHTML = '';
      images.forEach((img, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'sn-fb-thumb';
        const imEl = document.createElement('img');
        imEl.src = dataUrlToBlobUrl(img.dataUrl);
        imEl.dataset.snObjurl = '1';
        imEl.alt = '';
        imEl.title = 'Clicca per ingrandire';
        imEl.addEventListener('click', () => openLightbox(img.dataUrl));
        const xBtn = document.createElement('button');
        xBtn.type = 'button';
        xBtn.className = 'sn-fb-thumb-x';
        xBtn.setAttribute('aria-label', 'Rimuovi');
        xBtn.textContent = '×';
        xBtn.addEventListener('click', () => { images.splice(i, 1); bumpSubmissionId(); renderThumbs(); });
        wrap.appendChild(imEl);
        wrap.appendChild(xBtn);
        thumbsEl.appendChild(wrap);
      });
      // Allegati non-immagine: una "pillola" con icona, nome e dimensione.
      files.forEach((f, i) => {
        const chip = document.createElement('div');
        chip.className = 'sn-fb-file-chip';
        chip.title = f.name;
        const ic = document.createElement('span');
        ic.className = 'sn-fb-file-ic';
        // Icona documento in linea (coerente con lo stile a tratto di Filo):
        // non esiste un'icona 'file' nel set condiviso.
        ic.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';
        const nameEl = document.createElement('span');
        nameEl.className = 'sn-fb-file-name';
        nameEl.textContent = f.name;
        const sizeEl = document.createElement('span');
        sizeEl.className = 'sn-fb-file-size';
        sizeEl.textContent = humanSize(f.size);
        const xBtn = document.createElement('button');
        xBtn.type = 'button';
        xBtn.className = 'sn-fb-file-x';
        xBtn.setAttribute('aria-label', 'Rimuovi');
        xBtn.textContent = '×';
        xBtn.addEventListener('click', () => { files.splice(i, 1); bumpSubmissionId(); renderThumbs(); });
        chip.appendChild(ic);
        chip.appendChild(nameEl);
        chip.appendChild(sizeEl);
        chip.appendChild(xBtn);
        thumbsEl.appendChild(chip);
      });
    }

    function humanSize(n) {
      const b = Number(n) || 0;
      if (b < 1024) return `${b} B`;
      if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
      return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    }

    async function addImageFromBlob(blob) {
      // Solo immagini raster note: esclude image/svg+xml (documento attivo) e
      // qualsiasi altro tipo che si spacci per immagine.
      if (!blob || classifyAttachment(blob) !== 'image') return;
      if (images.length >= MAX_IMAGES) {
        statusEl.textContent = `Massimo ${MAX_IMAGES} immagini.`;
        return;
      }
      if (blob.size > 4 * 1024 * 1024) {
        statusEl.textContent = 'Immagine troppo grande (max 4 MB).';
        return;
      }
      const dataUrl = await blobToDataUrl(blob);
      images.push({ dataUrl });
      bumpSubmissionId();
      renderThumbs();
    }

    // Smista un file: le immagini seguono il percorso esistente (anteprima +
    // annotazione), gli altri tipi (pdf, txt, md, json…) diventano allegati.
    async function addAttachment(file) {
      if (!file) return;
      // Gate condiviso: stesso filtro per "Allega" e per drag & drop. L'attributo
      // `accept` del picker NON vincola il drop (né la scelta "Tutti i file"),
      // quindi la whitelist va applicata qui, sul tipo reale del file.
      const kind = classifyAttachment(file);
      if (!kind) {
        statusEl.textContent = ATTACH_REJECT_MSG;
        return;
      }
      if (kind === 'image') { await addImageFromBlob(file); return; }
      if (files.length >= MAX_FILES) {
        statusEl.textContent = `Massimo ${MAX_FILES} file.`;
        return;
      }
      if (file.size > MAX_ATTACH_BYTES) {
        statusEl.textContent = 'File troppo grande (max 4 MB).';
        return;
      }
      const dataUrl = await blobToDataUrl(file);
      files.push({
        name: file.name || 'allegato',
        type: file.type || 'application/octet-stream',
        size: file.size || 0,
        dataUrl,
      });
      bumpSubmissionId();
      statusEl.textContent = '';
      renderThumbs();
    }

    // Compone lo screenshot della tab con sopra i tratti disegnati, in scala.
    function composeAnnotated(shotDataUrl) {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            const w = img.naturalWidth || window.innerWidth;
            const h = img.naturalHeight || window.innerHeight;
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const cx = c.getContext('2d');
            cx.drawImage(img, 0, 0, w, h);
            const sx = w / Math.max(1, window.innerWidth);
            const sy = h / Math.max(1, window.innerHeight);
            cx.lineCap = 'round';
            cx.lineJoin = 'round';
            for (const s of strokes) {
              if (s.points.length < 1) continue;
              cx.strokeStyle = s.color;
              cx.lineWidth = s.width * Math.max(sx, sy);
              cx.beginPath();
              s.points.forEach((p, i) => (i ? cx.lineTo(p.x * sx, p.y * sy) : cx.moveTo(p.x * sx, p.y * sy)));
              if (s.points.length === 1) cx.lineTo(s.points[0].x * sx + 0.1, s.points[0].y * sy + 0.1);
              cx.stroke();
            }
            resolve(c.toDataURL('image/png'));
          } catch (_) {
            resolve(shotDataUrl);
          }
        };
        img.onerror = () => resolve(shotDataUrl);
        img.src = shotDataUrl;
      });
    }

    // Impila lo scatto annotato della barra in alto (shell) SOPRA lo screenshot
    // della pagina: il risultato è un'unica immagine di tutta l'app Filo con
    // sopra i tratti disegnati sia sulla pagina sia sulla barra. Se manca lo
    // scatto della barra, ritorna lo screenshot della sola pagina (fallback).
    function stackTopbar(pageDataUrl, topbarDataUrl) {
      return new Promise((resolve) => {
        if (!topbarDataUrl) { resolve(pageDataUrl); return; }
        const pageImg = new Image();
        pageImg.onload = () => {
          const barImg = new Image();
          barImg.onload = () => {
            try {
              const w = pageImg.naturalWidth;
              const barH = Math.round(barImg.naturalHeight * (w / Math.max(1, barImg.naturalWidth)));
              const c = document.createElement('canvas');
              c.width = w;
              c.height = barH + pageImg.naturalHeight;
              const cx = c.getContext('2d');
              cx.drawImage(barImg, 0, 0, w, barH);
              cx.drawImage(pageImg, 0, barH, w, pageImg.naturalHeight);
              resolve(c.toDataURL('image/png'));
            } catch (_) { resolve(pageDataUrl); }
          };
          barImg.onerror = () => resolve(pageDataUrl);
          barImg.src = topbarDataUrl;
        };
        pageImg.onerror = () => resolve(pageDataUrl);
        pageImg.src = pageDataUrl;
      });
    }

    // Chiusura (il bottone "Chiudi" sostituisce la vecchia × e "Annulla")
    cancelBtn.addEventListener('click', close);
    // Niente chiusura su click backdrop: si chiude solo con × o Annulla
    // (Esc resta disponibile come scorciatoia).
    function closeLightbox(lb) {
      const im = lb.querySelector('img');
      if (im) { try { URL.revokeObjectURL(im.src); } catch (_) {} }
      lb.remove();
    }
    function openLightbox(dataUrl) {
      const prev = activeRoot.querySelector('.sn-fb-lightbox');
      if (prev) closeLightbox(prev);
      const lb = document.createElement('div');
      lb.className = 'sn-fb-lightbox';
      const im = document.createElement('img');
      im.src = dataUrlToBlobUrl(dataUrl);
      im.alt = '';
      lb.appendChild(im);
      lb.addEventListener('click', () => closeLightbox(lb));
      activeRoot.appendChild(lb);
    }

    document.addEventListener('keydown', function onKey(e) {
      if (!activeRoot) { document.removeEventListener('keydown', onKey, true); return; }
      if (e.key === 'Escape') {
        // Se è aperta la lightbox di uno screenshot, ESC chiude prima quella.
        const lb = activeRoot.querySelector('.sn-fb-lightbox');
        if (lb) {
          e.stopImmediatePropagation();
          closeLightbox(lb);
          return;
        }
        // Evita che lo stesso ESC inneschi anche la chiusura del topmost
        // gestita dal modulo Popup.
        e.stopImmediatePropagation();
        close();
        document.removeEventListener('keydown', onKey, true);
      }
    }, true);

    // Paste immagini nel modal
    modal.addEventListener('paste', async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.type?.startsWith('image/')) {
          const blob = it.getAsFile();
          if (blob) await addImageFromBlob(blob);
        }
      }
    });

    // Accetta immagini incollate via tasto destro (custom event da content.js)
    modal.addEventListener('filo:paste-image', async (e) => {
      if (e.detail?.blob) {
        e.preventDefault();
        await addImageFromBlob(e.detail.blob);
      }
    });

    // Drag & drop: si può trascinare un'immagine OVUNQUE dentro il box (niente
    // più riquadro dedicato).
    ['dragenter', 'dragover'].forEach((ev) => modal.addEventListener(ev, (e) => {
      e.preventDefault(); modal.classList.add('sn-fb-drop-hover');
    }));
    ['dragleave', 'drop'].forEach((ev) => modal.addEventListener(ev, (e) => {
      e.preventDefault(); modal.classList.remove('sn-fb-drop-hover');
    }));
    modal.addEventListener('drop', async (e) => {
      const dropped = e.dataTransfer?.files;
      if (!dropped || !dropped.length) return;
      for (const f of dropped) await addAttachment(f);
    });

    // "Allega": apre il selettore file. Si possono allegare immagini E altri
    // file (pdf, txt, md, json…), oltre a incolla/trascina. Parità tra i
    // cammini equivalenti.
    attachBtn.addEventListener('click', () => { try { fileInput.click(); } catch (_) {} });
    fileInput.addEventListener('change', async () => {
      const picked = Array.from(fileInput.files || []);
      for (const f of picked) await addAttachment(f);
      fileInput.value = '';
    });

    // Invio
    sendBtn.addEventListener('click', async () => {
      const text = textEl.value.trim();
      // Allega lo screenshot quando c'è un disegno (annotato) OPPURE quando
      // l'utente ha premuto "Allega screenshot" (scatto della pagina senza disegno).
      const wantShot = shotArmed || hasAnyDrawing();
      if (!text && images.length === 0 && files.length === 0 && !wantShot) {
        statusEl.textContent = 'Scrivi qualcosa, allega un file/immagine o annota lo schermo.';
        return;
      }
      sendBtn.disabled = true;
      cancelBtn.disabled = true;
      statusEl.textContent = 'Invio in corso…';
      try {
        const clientId = await getClientId();
        // S1.F2.2: hash deterministico del clientId per il match C5 sulla macchina utente.
        // Il main process userà questo hash per il confronto (la macchina non ha la privata).
        const clientIdHash = await (async () => {
          try {
            const H = global.SN_FEEDBACK_CLIENT_ID_HASH;
            if (H && H.hashClientId) return await H.hashClientId(clientId);
            // Fallback: WebCrypto diretto (il modulo potrebbe non essere caricato nel preload)
            const enc = new TextEncoder();
            const buf = enc.encode(String(clientId || ''));
            const hashBuf = await global.crypto.subtle.digest('SHA-256', buf);
            const bytes = new Uint8Array(hashBuf);
            let hex = '';
            for (let i = 0; i < 16; i++) hex += bytes[i].toString(16).padStart(2, '0');
            return hex;
          } catch (_) { return ''; }
        })();
        // Costruisce la lista immagini: incollate/trascinate/allegate + (se c'è
        // un disegno) lo screenshot di tutta l'app con sopra l'annotazione.
        const outImages = images.slice();
        if (wantShot) {
          // Nascondiamo l'overlay (box + ombra) per non includerlo nello scatto.
          root.style.visibility = 'hidden';
          await new Promise((r) => setTimeout(r, 60));
          const shot = await captureScreenshot();
          // Scatto annotato della barra in alto di Filo (vive nella shell): lo
          // chiediamo solo se ci si ha disegnato sopra.
          let topbarShot = null;
          if (topbarHasDrawing) {
            try {
              const r = await chrome.runtime.sendMessage({ type: MSG.CAPTURE_FEEDBACK_TOPBAR });
              if (r?.ok && r.dataUrl) topbarShot = r.dataUrl;
            } catch (_) {}
          }
          root.style.visibility = '';
          if (shot) {
            const annotated = await composeAnnotated(shot);
            const full = await stackTopbar(annotated, topbarShot);
            if (outImages.length < MAX_IMAGES) outImages.push({ dataUrl: full });
          } else if (topbarShot) {
            // La pagina non si lascia catturare ma la barra sì: allega almeno quella.
            if (outImages.length < MAX_IMAGES) outImages.push({ dataUrl: topbarShot });
          } else {
            statusEl.textContent = 'Screenshot non disponibile su questa pagina.';
          }
        }
        // Routing via main process: la CSP della pagina ospite blocca fetch
        // diretti verso firestore/firebasestorage dal preload. Il main usa
        // undici (Node) e non è soggetto alla CSP della pagina.
        const payload = {
          text,
          url: location.href,
          title: document.title,
          userAgent: navigator.userAgent,
          clientId,
          clientIdHash, // S1.F2.2: hash deterministico in chiaro per match C5
          images: outImages,
          files: files.slice(), // allegati non-immagine (pdf, txt, md, json…)
          submissionId, // #370: id stabile → il server deduplica i re-invii
        };
        const res = await chrome.runtime.sendMessage({ type: MSG.SUBMIT_FEEDBACK, payload });
        if (!res?.ok) throw new Error(res?.error || 'invio fallito');
        statusEl.textContent = '';
        clearDraft();
        // Posizione del box PRIMA di chiuderlo: da lì partono le monete.
        const originRect = modal.getBoundingClientRect();
        close();
        // Ricompensa C3: +5 crediti subito all'invio. Best-effort, non blocca;
        // l'importo effettivo lo decide il main (CREDIT.FEEDBACK_SEND).
        let awarded = 5;
        try {
          const ar = await chrome.runtime.sendMessage({ type: MSG.CREDITS_AWARD_FEEDBACK });
          if (ar?.ok && Number(ar.credits) > 0) awarded = Number(ar.credits);
        } catch (_) {}
        flyCredits(originRect, awarded);
        // Se qualche allegato non è riuscito a caricarsi, il feedback parte
        // comunque (testo + allegati ok) ma avvisiamo l'utente di QUALI file
        // sono andati persi, così non resta convinto che siano stati inviati.
        const failed = Array.isArray(res.failed) ? res.failed : [];
        if (failed.length) {
          const names = failed.map((f) => f?.name || 'allegato').join(', ');
          Popup?.showToast?.(`Feedback inviato (+${awarded} crediti), ma non sono riuscito a caricare: ${names}`, { duration: 6000 });
        } else {
          Popup?.showToast?.(`Grazie! Feedback inviato. +${awarded} crediti.`, { duration: 2800 });
        }
      } catch (e) {
        console.error('[SN feedback] submit', e);
        statusEl.textContent = 'Errore invio: ' + (e?.message || e);
        sendBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    });

    // ---- posizione iniziale + trascinamento ----
    // Centra orizzontalmente con `left` INTERO (niente translateX(-50%): su
    // display HiDPI cadrebbe su un pixel frazionario → testo sfocato).
    function centerModal() {
      const w = modal.offsetWidth || 540;
      modal.style.left = Math.max(8, Math.round((window.innerWidth - w) / 2)) + 'px';
    }
    centerModal();

    let dragState = null;
    dragHandle.addEventListener('pointerdown', (e) => {
      const rect = modal.getBoundingClientRect();
      dragState = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, w: rect.width, h: rect.height };
      // Passa da ancoraggio `bottom` a `top` per poter spostare liberamente.
      modal.style.bottom = 'auto';
      modal.style.top = Math.round(rect.top) + 'px';
      modal.style.left = Math.round(rect.left) + 'px';
      try { dragHandle.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    dragHandle.addEventListener('pointermove', (e) => {
      if (!dragState) return;
      const maxL = Math.max(4, window.innerWidth - dragState.w - 4);
      const maxT = Math.max(4, window.innerHeight - dragState.h - 4);
      const left = Math.min(Math.max(4, Math.round(e.clientX - dragState.dx)), maxL);
      const top = Math.min(Math.max(4, Math.round(e.clientY - dragState.dy)), maxT);
      modal.style.left = left + 'px';
      modal.style.top = top + 'px';
    });
    function endDrag(e) {
      if (!dragState) return;
      dragState = null;
      try { dragHandle.releasePointerCapture(e.pointerId); } catch (_) {}
    }
    dragHandle.addEventListener('pointerup', endDrag);
    dragHandle.addEventListener('pointercancel', endDrag);

    updateClearBtn();
    textEl.focus();
  }

  global.SN_FEEDBACK_UI = { open, close };
})(typeof globalThis !== 'undefined' ? globalThis : self);
