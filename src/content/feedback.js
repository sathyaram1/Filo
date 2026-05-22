// Modale "Invia feedback" per l'alpha test.
// Aperta dalla voce di menu omonima. Permette:
//   - testo libero
//   - allegare screenshot della tab corrente
//   - incollare/trascinare immagini (Ctrl+V o drop)
// Invio → upload immagini su Firebase Storage + record su Firestore.

(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;
  const I18n = global.SN_I18N;
  const Popup = global.SN_POPUP;
  const Feedback = global.SN_FEEDBACK;

  let activeRoot = null;
  let activeStack = null;
  let clientIdCache = null;

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

  function open() {
    if (activeRoot) return;
    const root = document.createElement('div');
    root.className = 'sn-fb-overlay';
    root.dataset.snTheme = document.documentElement.dataset.snTheme || '';
    root.innerHTML = `
      <div class="sn-fb-modal" role="dialog" aria-modal="true">
        <div class="sn-fb-header">
          <span class="sn-fb-title">Invia feedback (alpha)</span>
          <button type="button" class="sn-fb-close" aria-label="Chiudi">×</button>
        </div>
        <div class="sn-fb-body">
          <p class="sn-fb-hint">Descrivi il problema o l'idea. Puoi incollare (Ctrl+V) o trascinare immagini qui sotto.</p>
          <textarea class="sn-fb-text" rows="6" placeholder="Cosa è successo? Cosa ti aspettavi?"></textarea>
          <div class="sn-fb-tools">
            <button type="button" class="sn-fb-btn-secondary sn-fb-attach">📷 Allega screenshot</button>
            <span class="sn-fb-meta"></span>
          </div>
          <div class="sn-fb-drop">Trascina o incolla immagini qui</div>
          <div class="sn-fb-thumbs"></div>
          <div class="sn-fb-status" aria-live="polite"></div>
        </div>
        <div class="sn-fb-footer">
          <button type="button" class="sn-fb-btn-secondary sn-fb-cancel">Annulla</button>
          <button type="button" class="sn-fb-btn sn-fb-send">Invia</button>
        </div>
      </div>
    `;
    document.documentElement.appendChild(root);
    activeRoot = root;
    Popup?.attachZoomCompensation?.(root);
    // Partecipa allo stacking dei popup: sopra ai box aperti prima, sotto a
    // quelli aperti dopo. Il menu contestuale (right-click) ha un proprio
    // z-index più alto, quindi resta sempre visibile sopra il modale.
    activeStack = Popup?.registerStack?.(root) || null;

    const modal = root.querySelector('.sn-fb-modal');
    const textEl = root.querySelector('.sn-fb-text');
    const thumbsEl = root.querySelector('.sn-fb-thumbs');
    const dropEl = root.querySelector('.sn-fb-drop');
    const statusEl = root.querySelector('.sn-fb-status');
    const sendBtn = root.querySelector('.sn-fb-send');
    const attachBtn = root.querySelector('.sn-fb-attach');
    const closeBtn = root.querySelector('.sn-fb-close');
    const cancelBtn = root.querySelector('.sn-fb-cancel');

    // stato locale: data URLs delle immagini selezionate
    const images = [];
    const MAX_IMAGES = 5;

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

    // Chiusura
    closeBtn.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);
    // Niente chiusura su click backdrop: si chiude solo con × o Annulla
    // (Esc resta disponibile come scorciatoia).
    function closeLightbox(lb) {
      const img = lb.querySelector('img');
      if (img) { try { URL.revokeObjectURL(img.src); } catch (_) {} }
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

    // Drag & drop
    ['dragenter', 'dragover'].forEach((ev) => dropEl.addEventListener(ev, (e) => {
      e.preventDefault(); dropEl.classList.add('sn-fb-drop-hover');
    }));
    ['dragleave', 'drop'].forEach((ev) => dropEl.addEventListener(ev, (e) => {
      e.preventDefault(); dropEl.classList.remove('sn-fb-drop-hover');
    }));
    dropEl.addEventListener('drop', async (e) => {
      const files = e.dataTransfer?.files;
      if (!files) return;
      for (const f of files) await addImageFromBlob(f);
    });

    // Screenshot
    attachBtn.addEventListener('click', async () => {
      attachBtn.disabled = true;
      const prev = attachBtn.textContent;
      attachBtn.textContent = '…';
      // Nascondiamo l'intero overlay (modal + backdrop scuro) per non
      // includere l'ombreggiatura nello screenshot.
      root.style.visibility = 'hidden';
      await new Promise((r) => setTimeout(r, 60));
      const dataUrl = await captureScreenshot();
      root.style.visibility = '';
      attachBtn.textContent = prev;
      attachBtn.disabled = false;
      if (!dataUrl) { statusEl.textContent = 'Screenshot non disponibile su questa pagina.'; return; }
      if (images.length >= MAX_IMAGES) { statusEl.textContent = `Massimo ${MAX_IMAGES} immagini.`; return; }
      images.push({ dataUrl });
      renderThumbs();
    });

    // Invio
    sendBtn.addEventListener('click', async () => {
      const text = textEl.value.trim();
      if (!text && images.length === 0) {
        statusEl.textContent = 'Scrivi qualcosa o allega un\'immagine.';
        return;
      }
      sendBtn.disabled = true;
      cancelBtn.disabled = true;
      statusEl.textContent = 'Invio in corso…';
      try {
        const clientId = await getClientId();
        // Routing via main process: la CSP della pagina ospite blocca fetch
        // diretti verso firestore/firebasestorage dal preload. Il main usa
        // undici (Node) e non è soggetto alla CSP della pagina.
        const payload = {
          text,
          url: location.href,
          title: document.title,
          userAgent: navigator.userAgent,
          clientId,
          images,
        };
        const res = await chrome.runtime.sendMessage({ type: MSG.SUBMIT_FEEDBACK, payload });
        if (!res?.ok) throw new Error(res?.error || 'invio fallito');
        statusEl.textContent = '';
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
