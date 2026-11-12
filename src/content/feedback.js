// Modale «Invia feedback»: testo persistito fra aperture, annotazione a mano libera,
// immagini incollate o trascinate, altri allegati dal selettore.
// Immagini e record vanno a Firebase instradati dal main (il perché è più sotto).

(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;
  const Popup = global.SN_POPUP;
  const Feedback = global.SN_FEEDBACK;
  const Icons = global.SN_ICONS || {};
  // Allowlist condivisa dei tipi di allegato: decide qui, prima della cifratura.
  const AttachTypes = global.SN_FEEDBACK_ATTACH;

  // Vale sia per «Allega» sia per il drag & drop.
  const ATTACH_REJECT_MSG = (AttachTypes && AttachTypes.MESSAGGIO_TIPO)
    || 'Tipo di file non supportato. Ammessi: immagini, PDF, testo, markdown, CSV e JSON.';

  // Fallback prudente se il modulo condiviso non fosse caricato: si consentono solo le immagini
  // raster note.
  function classifyAttachment(file) {
    if (AttachTypes && typeof AttachTypes.classify === 'function') {
      return AttachTypes.classify(file);
    }
    const t = String(file?.type || '').toLowerCase();
    return /^image\/(png|jpe?g|gif|webp|bmp)$/.test(t) ? 'image' : null;
  }

  // La bozza sopravvive a chiusura/riapertura del box e al riavvio di Filo, ma resta al sito dove è nata (#1071).
  const DRAFT_KEY = global.SN_FILO_UI?.chiaveDiBozza ? global.SN_FILO_UI.chiaveDiBozza('sn_feedback_draft_text') : null;
  // Colore/tratto del disegno di annotazione.
  const STROKE_COLOR = '#ff3b30';
  const STROKE_WIDTH = 3;

  let activeRoot = null;
  let activeStack = null;
  // Stacca ciò che l'apertura ha agganciato fuori dal riquadro (#1096).
  let pulizia = null;
  let clientIdCache = null;
  // I testi in viaggio verso il server: un riquadro riaperto mentre aspettano non li ripropone come bozza (#1681).
  const inVolo = new Set();
  let daRiaprire = null;
  // L0 (#1403): la rilettura del testo parte dopo questa pausa nello scrivere, così all'invio è già pronta.
  const ANTICIPO_MS = 1500;

  // Avvisa la shell dell'ingresso in annotazione, così l'ombra copre TUTTO Filo e non la sola area
  // pagina.
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
    const stacca = pulizia;
    pulizia = null;
    try { stacca?.(); } catch (_) {}
    try { activeStack?.unregister?.(); } catch (_) {}
    activeStack = null;
    if (Popup?.togliRiquadro) Popup.togliRiquadro(activeRoot);
    else activeRoot.remove();
    activeRoot = null;
    setShellDim(false);
    // Un feedback che L0 rimanda indietro mentre è aperto un altro riquadro si riapre quando quello si chiude.
    if (daRiaprire) {
      const d = daRiaprire;
      daRiaprire = null;
      setTimeout(() => { if (!activeRoot) apriQui(d); else daRiaprire = d; }, 0);
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  // La schermata esce dal computer: la copre il main come la foto per un modello. `{ segreti: true, motivo }` se
  // coprirla non riesce, e allora la pagina non parte.
  async function captureScreenshot() {
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.CAPTURE_VISIBLE_TAB, coperta: true });
      if (r?.ok && r.dataUrl) return { dataUrl: r.dataUrl };
      if (r?.code === 'coperture') return { segreti: true, motivo: String(r.motivo || '') };
    } catch (_) {}
    return null;
  }

  // Object URL invece di dataUrl perché le CSP delle pagine ospiti bloccano img-src data:. Va
  // revocato quando l'immagine viene rimossa.
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
  // volano dalla posizione del box verso l'angolo in basso a sinistra — il
  // profilo, in fondo alla barra laterale — con una piccola etichetta "+N".
  // Vive nel content overlay (la barra in alto della shell è coperta dalla
  // WebContentsView nativa, quindi un'animazione disegnata dalla shell sarebbe
  // occlusa). Puramente decorativa: best-effort, non blocca, si auto-rimuove.
  // Rispetta prefers-reduced-motion (niente volo, solo l'etichetta).
  function flyCredits(originRect, amount) {
    try {
      const n = Math.max(1, Math.round(Number(amount) || 0));
      const reduce = !!(global.matchMedia &&
        global.matchMedia('(prefers-reduced-motion: reduce)').matches);
      // Token `motion`: moltiplica le durate; a 0 l'etichetta resta ferma il tempo di leggerla.
      const k = global.SN_THEME_TOKENS ? global.SN_THEME_TOKENS.motionFactor(document) : 1;

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
      // Bersaglio: il profilo, in fondo alla barra laterale sul bordo sinistro (#871).
      const tx = 24;
      const ty = Math.max(26, window.innerHeight - 64);
      const GOLD = '#e0a93f';

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
      const count = reduce || !k ? 0 : Math.min(7, Math.max(4, n));
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

      let maxEnd = 900 * k;
      coins.forEach((c, i) => {
        const sx = ox + (Math.random() - 0.5) * 80;
        const sy = oy + (Math.random() - 0.5) * 30;
        // Punto intermedio: si alza in un arco prima di puntare in alto a destra.
        const mx = (sx + tx) / 2 + (Math.random() - 0.5) * 60;
        const my = Math.min(sy, ty) - 40 - Math.random() * 40;
        const delay = i * 40 * k;
        const dur = (650 + i * 50 + Math.random() * 120) * k;
        maxEnd = Math.max(maxEnd, delay + dur);
        c.animate([
          { transform: `translate(${sx}px,${sy}px) scale(.6)`, opacity: 0 },
          { transform: `translate(${sx}px,${sy}px) scale(1)`, opacity: 1, offset: 0.12 },
          { transform: `translate(${mx}px,${my}px) scale(1.05)`, opacity: 1, offset: 0.55 },
          { transform: `translate(${tx}px,${ty}px) scale(.35)`, opacity: 0 },
        ], { duration: dur, delay, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards' });
      });

      if (k) {
        label.animate([
          { transform: 'translate(-50%,-50%) scale(.7)', opacity: 0 },
          { transform: 'translate(-50%,-110%) scale(1)', opacity: 1, offset: 0.25 },
          { transform: 'translate(-50%,-200%) scale(1)', opacity: 0 },
        ], { duration: reduce ? 900 * k : Math.max(900 * k, maxEnd), easing: 'ease-out', fill: 'forwards' });
      } else {
        label.style.transform = 'translate(-50%,-110%)';
      }

      const total = k ? (reduce ? 900 * k : maxEnd) + 120 : 1200;
      setTimeout(() => { try { layer.remove(); } catch (_) {} }, total);
    } catch (_) {}
  }

  // `testo`: una segnalazione già scritta da Filo (il falso allarme dal tasto destro sull'avviso di un sito, #813.5).
  // Su un sito il box sta nello strato sopra la scheda, mai nel suo documento (#1509.1).
  function open({ testo = '' } = {}) {
    if (activeRoot) return;
    const qui = () => apriQui({ testo });
    if (global.SN_RIQUADRI_SOPRA?.apri('feedback', { testo: String(testo || '') }, qui)) return;
    qui();
  }

  // `ripresa`: il feedback che torna indietro dall'invio (L0 o un errore), con testo, allegati e avviso intatti.
  function apriQui({ testo: proposta = '', ripresa = null } = {}) {
    if (activeRoot) return;
    const root = document.createElement('div');
    root.className = 'sn-fb-overlay';
    global.SN_FILO_UI?.mark(root);
    root.dataset.snTheme = document.documentElement.dataset.snTheme || '';
    // Solo il box e quattro bottoni; «Cancella disegno» c'è solo quando c'è qualcosa da
    // cancellare.
    root.innerHTML = `
      <canvas class="sn-fb-canvas"></canvas>
      <div class="sn-fb-modal" role="dialog" aria-modal="true" aria-label="Invia feedback">
        <div class="sn-fb-drag" title="Trascina per spostare il box"><span class="sn-fb-grip"></span></div>
        <div class="sn-fb-body">
          <div class="sn-fb-l0" role="alert" hidden></div>
          <div class="sn-fb-campo">
            <div class="sn-fb-evidenze" aria-hidden="true"></div>
            <textarea class="sn-fb-text" rows="4" placeholder="Descrivi il bug o la feature che vorresti. Puoi trascinare qui documenti o immagini."></textarea>
          </div>
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
    document.documentElement.appendChild(Popup?.riquadro ? Popup.riquadro(root) : root);
    activeRoot = root;
    // Ciò che si aggancia fuori dal riquadro (window, documento, messaggi) si stacca alla chiusura (#1096): un
    // ascoltatore rimasto tiene in memoria tela, immagini e allegati di ogni apertura, e lo strato sopra un sito vive a lungo.
    const stacchi = [];
    const aggancia = (bersaglio, tipo, fn, opz) => {
      bersaglio.addEventListener(tipo, fn, opz);
      stacchi.push(() => bersaglio.removeEventListener(tipo, fn, opz));
    };
    pulizia = () => { for (const s of stacchi.splice(0).reverse()) { try { s(); } catch (_) {} } };
    setShellDim(true);
    // Abbandonando la pagina senza close() il content script muore e il velo della shell resterebbe
    // appeso: va chiesto di toglierlo.
    aggancia(window, 'pagehide', () => setShellDim(false), { once: true });
    const staccaZoom = Popup?.attachZoomCompensation?.(root);
    if (typeof staccaZoom === 'function') stacchi.push(staccaZoom);
    // Stacking dei popup: sopra i box aperti prima, sotto quelli dopo. Il menu del tasto destro ha
    // z-index più alto e resta sempre sopra.
    activeStack = Popup?.registerStack?.(root) || null;

    const modal = root.querySelector('.sn-fb-modal');
    const dragHandle = root.querySelector('.sn-fb-drag');
    const textEl = root.querySelector('.sn-fb-text');
    const avvisoEl = root.querySelector('.sn-fb-l0');
    const evidenzeEl = root.querySelector('.sn-fb-evidenze');
    const thumbsEl = root.querySelector('.sn-fb-thumbs');
    const statusEl = root.querySelector('.sn-fb-status');
    const sendBtn = root.querySelector('.sn-fb-send');
    const attachBtn = root.querySelector('.sn-fb-attach');
    const clearBtn = root.querySelector('.sn-fb-clear');
    const cancelBtn = root.querySelector('.sn-fb-cancel');
    const canvas = root.querySelector('.sn-fb-canvas');
    const fileInput = root.querySelector('.sn-fb-file');
    if (AttachTypes && AttachTypes.ACCEPT) fileInput.accept = AttachTypes.ACCEPT;

    const LIMITI = (AttachTypes && AttachTypes.LIMITI) || { immagini: 5, file: 5, byte: 4 * 1024 * 1024 };
    const images = [];
    const MAX_IMAGES = LIMITI.immagini;
    // Allegati NON immagine (pdf, txt, md, json, …): { name, type, size, dataUrl }
    const files = [];
    const MAX_FILES = LIMITI.file;
    const MAX_ATTACH_BYTES = LIMITI.byte;
    // Quello che L0 ha segnato: i pezzi di testo da evidenziare e le immagini da ricontrollare.
    let pezziSegnati = [];
    const immaginiSegnate = new Set();

    // Id STABILE della composizione, condiviso da tutti i tentativi: se l'invio va in timeout
    // ma riesce sul server, ripremere «Invia» non duplica (#370). Cambia col contenuto.
    function newSubmissionId() {
      try {
        if (global.crypto?.randomUUID) return global.crypto.randomUUID();
      } catch (_) {}
      return 'sub-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    }
    let submissionId = newSubmissionId();
    function bumpSubmissionId() { submissionId = newSubmissionId(); }

    let saveTimer = null;
    // Chiudendo entro i 250 ms la bozza si scrive subito, non da un timer che sopravvive al riquadro.
    stacchi.push(() => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; saveDraft(); } });
    function saveDraft() {
      if (!DRAFT_KEY) return;
      try { chrome.storage.local.set({ [DRAFT_KEY]: textEl.value }); } catch (_) {}
    }
    // Solo se la bozza è ancora quella partita: un riquadro riaperto intanto può averne scritta un'altra (#1681).
    function clearDraft(inviata) {
      if (!DRAFT_KEY) return;
      try {
        if (inviata === undefined) { chrome.storage.local.remove([DRAFT_KEY]); return; }
        chrome.storage.local.get([DRAFT_KEY]).then((r) => {
          if (r?.[DRAFT_KEY] === inviata) chrome.storage.local.remove([DRAFT_KEY]);
        }).catch(() => {});
      } catch (_) {}
    }
    // L0: una rilettura per pausa, pagata da un gesto vero nella casella (patterns/una-chiamata-che-spende-parte-da-un-gesto-vero.md).
    let anticipoTimer = null;
    let gestoPerAnticipo = false;
    let anticipato = '';
    stacchi.push(() => { clearTimeout(anticipoTimer); anticipoTimer = null; });
    function preparaAnticipo(e) {
      const G = global.SN_GESTO;
      const vero = G && typeof G.prendi === 'function'
        ? G.prendi('feedback-l0', undefined, (l) => !!(l && l.el && (l.el === textEl || textEl.contains(l.el))))
        : !!(e && e.isTrusted);
      if (vero) gestoPerAnticipo = true;
      clearTimeout(anticipoTimer);
      anticipoTimer = setTimeout(() => {
        anticipoTimer = null;
        const t = textEl.value.trim();
        if (!gestoPerAnticipo || !t || t === anticipato) return;
        gestoPerAnticipo = false;
        anticipato = t;
        try { chrome.runtime.sendMessage({ type: MSG.FEEDBACK_L0_ANTICIPA, testo: t })?.catch?.(() => {}); } catch (_) {}
      }, ANTICIPO_MS);
    }
    textEl.addEventListener('input', (e) => {
      // Contenuto cambiato → composizione nuova, id di invio fresco.
      bumpSubmissionId();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { saveTimer = null; saveDraft(); }, 250);
      aggiornaEvidenze();
      preparaAnticipo(e);
    });
    // Ripristina l'eventuale bozza salvata (solo se l'utente non ha già scritto). Il testo proposto da Filo si
    // aggiunge alla bozza, non la sostituisce: la bozza è dell'utente.
    const inFondo = () => { try { textEl.setSelectionRange(textEl.value.length, textEl.value.length); } catch (_) {} };
    if (ripresa) {
      textEl.value = String(ripresa.testo || '');
      for (const im of ripresa.images || []) images.push(im);
      for (const f of ripresa.files || []) files.push(f);
      if (ripresa.submissionId) submissionId = ripresa.submissionId;
      saveDraft();
    } else if (typeof proposta === 'string' && proposta) { textEl.value = proposta; inFondo(); }
    try {
      if (DRAFT_KEY && !ripresa) chrome.storage.local.get([DRAFT_KEY]).then((r) => {
        const saved = inVolo.has(r?.[DRAFT_KEY]) ? '' : r?.[DRAFT_KEY];
        if (activeRoot !== root) return;
        if (saved && !textEl.value) textEl.value = saved;
        else if (saved && proposta && textEl.value === proposta && !saved.includes(proposta)) {
          textEl.value = `${saved}\n\n${proposta}`;
          inFondo();
        }
        if (proposta) saveDraft();
      }).catch(() => {});
    } catch (_) {}

    const ctx = canvas.getContext('2d');
    const strokes = []; // [{ color, width, points: [{x,y}] }] in coordinate viewport CSS
    let drawing = false;
    let curStroke = null;
    // La barra in alto vive in un altro processo: se ci si è disegnato sopra lo sappiamo solo via
    // broadcast FEEDBACK_DRAW_STATE.
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
        // Un punto solo: il micro-scostamento disegna un puntino invece di niente.
        if (s.points.length === 1) { ctx.lineTo(s.points[0].x + 0.1, s.points[0].y + 0.1); }
        ctx.stroke();
      }
    }
    function hasPageDrawing() { return strokes.some((s) => s.points.length > 0); }
    function hasAnyDrawing() { return hasPageDrawing() || topbarHasDrawing; }

    // Un bottone, due stati: «Allega screenshot» (all'invio si allega lo scatto anche senza
    // disegnare), e appena si disegna diventa «Cancella».
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
      refreshClear();
    }
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);
    aggancia(window, 'resize', sizeCanvas);
    sizeCanvas();
    // La tela a tutto schermo pesa larghezza × altezza × dpr²: si libera alla chiusura, non quando passa il GC.
    stacchi.push(() => { canvas.width = 0; canvas.height = 0; });

    // «Cancella disegno» pulisce i tratti della pagina E quelli della barra in alto, che vivono
    // nella shell: un bottone solo cancella tutto.
    clearBtn.addEventListener('click', () => {
      if (hasAnyDrawing()) {
        strokes.length = 0;
        redraw();
        try { chrome.runtime.sendMessage({ type: MSG.FEEDBACK_CLEAR_DRAW }); } catch (_) {}
        topbarHasDrawing = false;
        shotArmed = false;
      } else {
        shotArmed = !shotArmed;
      }
      updateClearBtn();
    });

    // La shell dice se c'è o non c'è più un disegno sulla barra, così «Cancella disegno» compare
    // anche quando si è disegnato SOLO lassù.
    function onBroadcast(message) {
      if (activeRoot !== root) return;
      if (message?.type === MSG.FEEDBACK_DRAW_STATE) {
        topbarHasDrawing = !!message.topbar;
        refreshClear();
      }
    }
    try {
      chrome.runtime.onMessage.addListener(onBroadcast);
      stacchi.push(() => chrome.runtime.onMessage.removeListener(onBroadcast));
    } catch (_) {}

    function revocaMiniature() {
      thumbsEl.querySelectorAll('img[data-sn-objurl="1"]').forEach((img) => {
        try { URL.revokeObjectURL(img.src); } catch (_) {}
      });
    }
    stacchi.push(revocaMiniature);
    function renderThumbs() {
      revocaMiniature();
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
      files.forEach((f, i) => {
        const chip = document.createElement('div');
        chip.className = 'sn-fb-file-chip';
        chip.title = f.name;
        const ic = document.createElement('span');
        ic.className = 'sn-fb-file-ic';
        // Icona documento in linea: nel set condiviso non c'è un'icona 'file'.
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

    // Un allegato lasciato fuori si dice col suo nome e il perché, anche in mezzo ad altri entrati (#1681). Ritornano
    // null se l'allegato è entrato, sennò { name, reason }.
    const TIPO_NO = 'tipo non supportato';
    const scarto = (f, reason, ripiego) => ({ name: String(f?.name || ripiego), reason });
    async function addImageFromBlob(blob) {
      // Solo immagini raster note: esclude image/svg+xml, che è un documento attivo, e ogni altro
      // tipo che si spacci per immagine.
      if (!blob) return null;
      if (classifyAttachment(blob) !== 'image') return scarto(blob, TIPO_NO, 'immagine');
      if (images.length >= MAX_IMAGES) return scarto(blob, `oltre le ${MAX_IMAGES} immagini ammesse`, 'immagine incollata');
      if (blob.size > MAX_ATTACH_BYTES) return scarto(blob, 'troppo grande (max 4 MB)', 'immagine incollata');
      const dataUrl = await blobToDataUrl(blob);
      // Il nome resta sul computer: lo leggono l'avviso degli allegati non partiti e l'elenco delle segnalazioni.
      images.push({ dataUrl, name: String(blob.name || '') });
      bumpSubmissionId();
      renderThumbs();
      return null;
    }

    async function addAttachment(file) {
      if (!file) return null;
      // Stesso filtro per «Allega» e per il drop: `accept` non vincola né il drop né la scelta
      // «Tutti i file», quindi la whitelist va applicata qui, sul tipo reale.
      const kind = classifyAttachment(file);
      if (!kind) return scarto(file, TIPO_NO, 'allegato');
      if (kind === 'image') return addImageFromBlob(file);
      if (files.length >= MAX_FILES) return scarto(file, `oltre i ${MAX_FILES} file ammessi`, 'allegato');
      if (file.size > MAX_ATTACH_BYTES) return scarto(file, 'troppo grande (max 4 MB)', 'allegato');
      const dataUrl = await blobToDataUrl(file);
      files.push({
        name: file.name || 'allegato',
        type: file.type || 'application/octet-stream',
        size: file.size || 0,
        dataUrl,
      });
      bumpSubmissionId();
      renderThumbs();
      return null;
    }

    // Tutti gli allegati di un gesto (una scelta, un rilascio, un incolla), poi un messaggio solo per quelli rimasti fuori.
    async function allega(lista, aggiungi = addAttachment) {
      const fuori = [];
      for (const f of lista) {
        const no = await aggiungi(f);
        if (no) fuori.push(no);
      }
      if (!fuori.length) { if (lista.length) statusEl.textContent = ''; return; }
      const elenco = Feedback?.fraseAllegatiSaltati ? Feedback.fraseAllegatiSaltati(fuori)
        : fuori.map((f) => `«${f.name}»: ${f.reason}`).join('; ');
      const tipi = fuori.some((f) => f.reason === TIPO_NO)
        ? ` ${(AttachTypes && AttachTypes.AMMESSI) ? `Ammessi: ${AttachTypes.AMMESSI}.` : ATTACH_REJECT_MSG}` : '';
      statusEl.textContent = `${fuori.length === 1 ? 'Non allegato' : 'Non allegati'} ${elenco}.${tipi}`;
    }

    function caricaImmagine(src) {
      return new Promise((resolve) => {
        if (!src) { resolve(null); return; }
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => resolve(null);
        im.src = src;
      });
    }

    // La schermata sale solo sotto il tetto degli allegati (#1667): PNG se ci sta, poi WebP più leggero, poi più
    // piccola. Un PNG di uno schermo grande ad alta densità passa facilmente i 4 MB, e il deposito lo rifiuterebbe.
    function entroIlTetto(c) {
      const sotto = (u) => Feedback.byteDiDataUrl(u) < MAX_ATTACH_BYTES;
      let u = c.toDataURL('image/png');
      if (sotto(u)) return u;
      for (const q of [0.92, 0.8, 0.65]) {
        u = c.toDataURL('image/webp', q);
        if (sotto(u)) return u;
      }
      let w = c.width;
      let h = c.height;
      for (let i = 0; i < 8 && w > 64 && h > 64; i++) {
        w = Math.round(w * 0.75);
        h = Math.round(h * 0.75);
        const r = document.createElement('canvas');
        r.width = w; r.height = h;
        r.getContext('2d').drawImage(c, 0, 0, w, h);
        u = r.toDataURL('image/webp', 0.8);
        r.width = 0; r.height = 0;
        if (sotto(u)) return u;
      }
      return null;
    }

    // Un'immagine sola di tutta l'app: la barra in alto (se ci si è disegnato) sopra la pagina coi suoi tratti.
    async function schermataAnnotata(shotDataUrl, topbarDataUrl) {
      const [pagina, barra] = await Promise.all([caricaImmagine(shotDataUrl), caricaImmagine(topbarDataUrl)]);
      if (!pagina && !barra) return null;
      const c = document.createElement('canvas');
      try {
        const w = pagina ? (pagina.naturalWidth || window.innerWidth) : barra.naturalWidth;
        const barH = barra ? Math.round(barra.naturalHeight * (w / Math.max(1, barra.naturalWidth))) : 0;
        const pagH = pagina ? (pagina.naturalHeight || window.innerHeight) : 0;
        c.width = w; c.height = barH + pagH;
        const cx = c.getContext('2d');
        if (barra) cx.drawImage(barra, 0, 0, w, barH);
        if (pagina) {
          cx.drawImage(pagina, 0, barH, w, pagH);
          const sx = w / Math.max(1, window.innerWidth);
          const sy = pagH / Math.max(1, window.innerHeight);
          cx.lineCap = 'round';
          cx.lineJoin = 'round';
          for (const s of strokes) {
            if (s.points.length < 1) continue;
            cx.strokeStyle = s.color;
            cx.lineWidth = s.width * Math.max(sx, sy);
            cx.beginPath();
            s.points.forEach((p, i) => (i ? cx.lineTo(p.x * sx, barH + p.y * sy) : cx.moveTo(p.x * sx, barH + p.y * sy)));
            if (s.points.length === 1) cx.lineTo(s.points[0].x * sx + 0.1, barH + s.points[0].y * sy + 0.1);
            cx.stroke();
          }
        }
        return entroIlTetto(c);
      } catch (_) {
        return null;
      } finally {
        c.width = 0; c.height = 0;
      }
    }

    cancelBtn.addEventListener('click', close);
    // Il click sul velo non chiude: si esce solo dal bottone o con Esc.
    function closeLightbox(lb) {
      const im = lb.querySelector('img');
      if (im) { try { URL.revokeObjectURL(im.src); } catch (_) {} }
      lb.remove();
    }
    function openLightbox(dataUrl) {
      const prev = root.querySelector('.sn-fb-lightbox');
      if (prev) closeLightbox(prev);
      const lb = document.createElement('div');
      lb.className = 'sn-fb-lightbox';
      const im = document.createElement('img');
      im.src = dataUrlToBlobUrl(dataUrl);
      im.alt = '';
      lb.appendChild(im);
      lb.addEventListener('click', () => closeLightbox(lb));
      root.appendChild(lb);
    }
    stacchi.push(() => { const lb = root.querySelector('.sn-fb-lightbox'); if (lb) closeLightbox(lb); });

    aggancia(document, 'keydown', (e) => {
      if (activeRoot !== root || e.key !== 'Escape') return;
      // Se è aperta la lightbox di uno screenshot, ESC chiude prima quella.
      const lb = root.querySelector('.sn-fb-lightbox');
      // Evita che lo stesso ESC inneschi anche la chiusura del topmost gestita dal modulo Popup.
      e.stopImmediatePropagation();
      if (lb) closeLightbox(lb);
      else close();
    }, true);

    // Paste immagini nel modal. Allegare è dell'utente: un incolla fabbricato non porta niente (il trascinamento
    // fabbricato lo ferma soloGestiVeri, sui siti).
    modal.addEventListener('paste', async (e) => {
      if (!e.isTrusted) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const blobs = Array.from(items).filter((it) => it.type?.startsWith('image/')).map((it) => it.getAsFile()).filter(Boolean);
      if (blobs.length) await allega(blobs, addImageFromBlob);
    });

    // Immagini incollate col tasto destro: evento su misura da content.js.
    modal.addEventListener('filo:paste-image', async (e) => {
      if (!global.SN_FILO_UI?.veroONostro?.(e)) return;
      if (e.detail?.blob) {
        e.preventDefault();
        await allega([e.detail.blob], addImageFromBlob);
      }
    });

    // Si può trascinare un'immagine OVUNQUE dentro il box, non in un riquadro dedicato.
    ['dragenter', 'dragover'].forEach((ev) => modal.addEventListener(ev, (e) => {
      e.preventDefault(); modal.classList.add('sn-fb-drop-hover');
    }));
    ['dragleave', 'drop'].forEach((ev) => modal.addEventListener(ev, (e) => {
      e.preventDefault(); modal.classList.remove('sn-fb-drop-hover');
    }));
    modal.addEventListener('drop', async (e) => {
      const dropped = e.dataTransfer?.files;
      // Qui servono solo i file: un testo lasciato nel riquadro non va da nessuna parte (#1471).
      if (e.isTrusted) try { Popup?.conta?.(global.SN_GESTI?.rilascio(e.dataTransfer, 'campo_feedback', !!(dropped && dropped.length))); } catch (_) {}
      if (!dropped || !dropped.length) return;
      await allega(Array.from(dropped));
    });

    // "Allega": apre il selettore file. Si possono allegare immagini E altri
    // file (pdf, txt, md, json…), oltre a incolla/trascina. Parità tra i
    // cammini equivalenti.
    attachBtn.addEventListener('click', (e) => { if (e.isTrusted) { try { fileInput.click(); } catch (_) {} } });
    fileInput.addEventListener('change', async () => {
      const picked = Array.from(fileInput.files || []);
      fileInput.value = '';
      await allega(picked);
    });

    // Invio: solo dal clic dell'utente sul tasto (#1071).
    sendBtn.addEventListener('click', async (e) => {
      if (!e.isTrusted) return;
      const text = textEl.value.trim();
      const wantShot = shotArmed || hasAnyDrawing();
      if (!text && images.length === 0 && files.length === 0 && !wantShot) {
        statusEl.textContent = 'Scrivi qualcosa, allega un file/immagine o annota lo schermo.';
        return;
      }
      // Un esito che arriva col riquadro già chiuso (Esc durante l'invio) si legge in un avviso.
      const dici = (testo) => {
        statusEl.classList.remove('sn-fb-status--attesa');
        if (activeRoot === root) statusEl.textContent = testo;
        else Popup?.showToast?.(testo, { duration: 6000 });
      };
      const riprova = (testo) => { dici(testo); sendBtn.disabled = false; cancelBtn.disabled = false; };
      const testoInviato = textEl.value;
      inVolo.add(testoInviato);
      sendBtn.disabled = true;
      cancelBtn.disabled = true;
      statusEl.textContent = 'Invio in corso…';
      statusEl.classList.add('sn-fb-status--attesa');
      try {
        const clientId = await getClientId();
        // S1.F2.2: hash deterministico del clientId per il match C5. Il confronto lo fa il main,
        // che qui non ha la chiave privata.
        const clientIdHash = await (async () => {
          try {
            const H = global.SN_FEEDBACK_CLIENT_ID_HASH;
            if (H && H.hashClientId) return await H.hashClientId(clientId);
            // Fallback: WebCrypto diretto, il modulo potrebbe non essere caricato nel preload.
            const enc = new TextEncoder();
            const buf = enc.encode(String(clientId || ''));
            const hashBuf = await global.crypto.subtle.digest('SHA-256', buf);
            const bytes = new Uint8Array(hashBuf);
            let hex = '';
            for (let i = 0; i < 16; i++) hex += bytes[i].toString(16).padStart(2, '0');
            return hex;
          } catch (_) { return ''; }
        })();
        const outImages = images.slice();
        let senzaSchermata = '';
        // Il deposito tiene cinque immagini: la schermata che non ci sta si dice, non sparisce (#1681).
        if (wantShot && outImages.length >= MAX_IMAGES) {
          senzaSchermata = `La schermata annotata non è partita: c'erano già ${MAX_IMAGES} immagini, il massimo.`;
        } else if (wantShot) {
          // Overlay nascosto (box + ombra) per non finire dentro lo scatto.
          root.style.visibility = 'hidden';
          await new Promise((r) => setTimeout(r, 60));
          const foto = await captureScreenshot();
          const shot = foto?.dataUrl || null;
          // Lo scatto annotato della barra in alto si chiede solo se ci si ha disegnato sopra.
          let topbarShot = null;
          if (topbarHasDrawing) {
            try {
              const r = await chrome.runtime.sendMessage({ type: MSG.CAPTURE_FEEDBACK_TOPBAR });
              if (r?.ok && r.dataUrl) topbarShot = r.dataUrl;
            } catch (_) {}
          }
          root.style.visibility = '';
          const full = (shot || topbarShot) ? await schermataAnnotata(shot, topbarShot) : null;
          const perche = foto?.motivo === 'misura'
            ? 'la pagina non ha risposto in tempo, e senza sapere dove sono i campi password o carta non la mando.'
            : foto?.motivo === 'riquadri'
              ? 'nella pagina c’è un riquadro di un altro sito che non sono riuscito a coprire.'
              : 'nella pagina c’è un campo riservato (password o carta) che non sono riuscito a coprire.';
          if (full) {
            outImages.push({ dataUrl: full, name: 'schermata annotata' });
            if (foto?.segreti) senzaSchermata = `Della schermata è partita solo la barra in alto: ${perche}`;
          } else if (foto?.segreti) {
            senzaSchermata = `La schermata non è partita: ${perche}`;
          } else {
            senzaSchermata = (shot || topbarShot)
              ? 'Non sono riuscito a preparare la schermata annotata.'
              : 'Screenshot non disponibile su questa pagina.';
          }
        }
        // Senza testo né allegati partirebbe un feedback vuoto (#1667): il riquadro resta aperto e dice perché.
        if (!text && outImages.length === 0 && files.length === 0) {
          riprova(senzaSchermata || 'Scrivi qualcosa, allega un file/immagine o annota lo schermo.');
          return;
        }
        // Instradato dal main perché la CSP della pagina ospite blocca i fetch verso firestore e
        // firebasestorage dal preload; il main usa undici (Node) e non è soggetto a quella CSP.
        // Nello strato la pagina è quella sotto, non il documento dello strato.
        const sotto = global.SN_FILO_UI?.nelloStrato ? global.SN_PAGINA_SOTTO : null;
        const payload = {
          text,
          url: sotto ? String(sotto.url || '') : location.href,
          title: sotto ? String(sotto.titolo || '') : document.title,
          userAgent: navigator.userAgent,
          clientId,
          clientIdHash,
          images: outImages,
          files: files.slice(),
          submissionId,
        };
        const res = await chrome.runtime.sendMessage({ type: MSG.SUBMIT_FEEDBACK, payload });
        if (!res?.ok) {
          const err = new Error(res?.error || 'invio fallito');
          // #602 — quando il no arriva dalla cifratura (o è un feedback che partirebbe vuoto), il main manda già
          // la frase intera per chi legge: mostrarla così com'è.
          err.fraseGiaPronta = !!(res?.cifratura || res?.frase);
          throw err;
        }
        statusEl.textContent = '';
        statusEl.classList.remove('sn-fb-status--attesa');
        // Posizione del box PRIMA di chiuderlo: da lì partono le monete.
        const originRect = modal.getBoundingClientRect();
        // Chiuso con Esc durante l'attesa, il riquadro aperto adesso è un altro, con un altro testo: resta (#1681).
        if (activeRoot === root) {
          clearTimeout(saveTimer);
          saveTimer = null;
          clearDraft();
          close();
        } else {
          clearDraft(testoInviato);
        }
        // Ricompensa C3: +5 crediti subito all'invio. Best-effort, non blocca;
        // l'importo effettivo lo decide il main (CREDIT.FEEDBACK_SEND). Con un
        // portafoglio (#816) il premio lo dà il server dopo i controlli: qui
        // niente cifra e niente monete, perché adesso non arriva niente.
        let awarded = 5;
        let premio = null;
        try {
          const ar = await chrome.runtime.sendMessage({ type: MSG.CREDITS_AWARD_FEEDBACK, ref: res.id || null });
          if (ar?.ok && ar.wallet) premio = { inArrivo: !!ar.inArrivo, senzaPremio: String(ar.senzaPremio || '') };
          else if (ar?.ok && Number(ar.credits) > 0) awarded = Number(ar.credits);
        } catch (_) {}
        if (!premio) flyCredits(originRect, awarded);
        // «Inviato» solo a consegna avvenuta (#1667); gli allegati saltati li dice l'avviso nella finestra.
        const detto = res.consegnato ? 'Grazie! Feedback inviato.' : 'Feedback in partenza: arriva da solo appena c’è rete.';
        const dopo = premio?.inArrivo ? ' Il premio arriva sul tuo saldo dopo i controlli.'
          : (premio?.senzaPremio ? ` ${premio.senzaPremio}` : '');
        const conSchermata = senzaSchermata ? ` ${senzaSchermata}` : '';
        Popup?.showToast?.(premio ? `${detto}${dopo}${conSchermata}` : `${detto} +${awarded} crediti.${conSchermata}`,
          { duration: (premio?.senzaPremio || senzaSchermata) ? 5500 : (premio || !res.consegnato ? 4000 : 2800) });
      } catch (e) {
        console.error('[SN feedback] submit', e);
        root.style.visibility = '';
        riprova(e?.fraseGiaPronta ? String(e.message) : ('Errore invio: ' + (e?.message || e)));
      } finally {
        inVolo.delete(testoInviato);
      }
    });

    // Centra orizzontalmente con `left` INTERO: translateX(-50%) su display HiDPI cadrebbe su un
    // pixel frazionario e sfocherebbe il testo.
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
    if (proposta) inFondo();
  }

  global.SN_FEEDBACK_UI = { open, close };
})(typeof globalThis !== 'undefined' ? globalThis : self);
