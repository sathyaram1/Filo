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

  function open() {
    if (activeRoot) return;
    const root = document.createElement('div');
    root.className = 'sn-fb-overlay';
    root.dataset.snTheme = document.documentElement.dataset.snTheme || '';
    // Layout richiesto dall'utente: solo il box per scrivere + 4 bottoni
    // (Allega, Chiudi, Invia, e "Cancella disegno" che compare solo quando c'è
    // qualcosa da cancellare). Si può trascinare/incollare/allegare immagini e
    // disegnare a mano libera su TUTTA l'app (pagina + barra in alto).
    root.innerHTML = `
      <canvas class="sn-fb-canvas"></canvas>
      <div class="sn-fb-modal" role="dialog" aria-modal="true" aria-label="Invia feedback">
        <div class="sn-fb-body">
          <textarea class="sn-fb-text" rows="4" placeholder="Descrivi il bug o la feature che vorresti. Puoi trascinare qui documenti o immagini."></textarea>
          <div class="sn-fb-thumbs"></div>
          <div class="sn-fb-status" aria-live="polite"></div>
        </div>
        <div class="sn-fb-actions">
          <button type="button" class="sn-fb-btn-secondary sn-fb-attach">${icon('screenshot', 16)}<span>Allega</span></button>
          <button type="button" class="sn-fb-btn-secondary sn-fb-cancel">Chiudi</button>
          <button type="button" class="sn-fb-btn sn-fb-send">Invia</button>
          <button type="button" class="sn-fb-clear" hidden>Cancella disegno</button>
        </div>
        <input type="file" class="sn-fb-file" accept="image/*" multiple hidden />
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

    // ---- bozza di testo persistente ----
    let saveTimer = null;
    function saveDraft() {
      try { chrome.storage.local.set({ [DRAFT_KEY]: textEl.value }); } catch (_) {}
    }
    function clearDraft() {
      try { chrome.storage.local.remove([DRAFT_KEY]); } catch (_) {}
    }
    textEl.addEventListener('input', () => {
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
    function refreshClear() {
      // Il pulsante tratteggiato "Cancella disegno" compare SOLO se c'è davvero
      // qualcosa da cancellare.
      clearBtn.hidden = !hasAnyDrawing();
    }

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
      strokes.length = 0;
      redraw();
      try { chrome.runtime.sendMessage({ type: MSG.FEEDBACK_CLEAR_DRAW }); } catch (_) {}
      topbarHasDrawing = false;
      refreshClear();
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
        xBtn.addEventListener('click', () => { images.splice(i, 1); renderThumbs(); });
        wrap.appendChild(imEl);
        wrap.appendChild(xBtn);
        thumbsEl.appendChild(wrap);
      });
    }

    async function addImageFromBlob(blob) {
      if (!blob || !blob.type?.startsWith('image/')) return;
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
      const files = e.dataTransfer?.files;
      if (!files || !files.length) return;
      for (const f of files) await addImageFromBlob(f);
    });

    // "Annota e allega": toggle che decide se allegare lo screenshot annotato.
    attachBtn.addEventListener('click', () => setInclude(!includeShot));

    // Invio
    sendBtn.addEventListener('click', async () => {
      const text = textEl.value.trim();
      if (!text && images.length === 0 && !includeShot) {
        statusEl.textContent = 'Scrivi qualcosa, allega un\'immagine o annota lo schermo.';
        return;
      }
      sendBtn.disabled = true;
      cancelBtn.disabled = true;
      statusEl.textContent = 'Invio in corso…';
      try {
        const clientId = await getClientId();
        // Costruisce la lista immagini: incollate/trascinate + (se selezionato)
        // lo screenshot della pagina con sopra il disegno.
        const outImages = images.slice();
        if (includeShot) {
          // Nascondiamo l'overlay (box + ombra) per non includerlo nello scatto.
          root.style.visibility = 'hidden';
          await new Promise((r) => setTimeout(r, 60));
          const shot = await captureScreenshot();
          root.style.visibility = '';
          if (shot) {
            const annotated = await composeAnnotated(shot);
            if (outImages.length < MAX_IMAGES) outImages.push({ dataUrl: annotated });
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
          images: outImages,
        };
        const res = await chrome.runtime.sendMessage({ type: MSG.SUBMIT_FEEDBACK, payload });
        if (!res?.ok) throw new Error(res?.error || 'invio fallito');
        statusEl.textContent = '';
        clearDraft();
        close();
        Popup?.showToast?.('Grazie! Feedback inviato.', { duration: 2500 });
      } catch (e) {
        console.error('[SN feedback] submit', e);
        statusEl.textContent = 'Errore invio: ' + (e?.message || e);
        sendBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    });

    textEl.focus();
  }

  global.SN_FEEDBACK_UI = { open, close };
})(typeof globalThis !== 'undefined' ? globalThis : self);
