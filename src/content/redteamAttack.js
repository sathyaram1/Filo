// Pannello "Invia attacco" del canale Red-team (spec §8.1), aperto dal tasto destro su qualsiasi pagina.
// I due campi sono separati apposta: il testo dell'attacco va ai 4 giudici del panel, la descrizione solo al giudice di validità.
// Il backend può non esserci: un REDTEAM_SUBMIT in errore deve diventare un messaggio, mai un pannello che crasha.

(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;
  const Popup = global.SN_POPUP;
  const Icons = global.SN_ICONS || {};

  const COST = 50; // crediti per tentativo (spec §8.1 / §11). Non rimborsabili.
  const DRAFT_ATTACK_KEY = 'sn_redteam_attack_draft';
  const DRAFT_DESC_KEY = 'sn_redteam_desc_draft';

  let activeRoot = null;
  let activeStack = null;

  function icon(name, size) {
    try { return typeof Icons[name] === 'function' ? Icons[name](size) : ''; }
    catch (_) { return ''; }
  }

  function close() {
    if (!activeRoot) return;
    try { activeStack?.unregister?.(); } catch (_) {}
    activeStack = null;
    activeRoot.remove();
    activeRoot = null;
  }

  // Pura ed esposta apposta per i test (tests/redteam-attack.spec.mjs).
  function submitStatusMessage(res) {
    const r = res || {};
    switch (r.status) {
      case 'ok':
        return { ok: true, text: 'Attacco inviato! Apro i risultati…' };
      case 'insufficient_credits': {
        const have = Number.isFinite(r.have) ? r.have : null;
        const needed = Number.isFinite(r.needed) ? r.needed : COST;
        const detail = have != null ? ` (hai ${have}, ne servono ${needed})` : '';
        return { ok: false, text: `Crediti insufficienti${detail}.` };
      }
      case 'dormant':
        return { ok: false, text: 'Canale non ancora attivo. Riprova più tardi.' };
      case 'not_signed_in':
        return { ok: false, needLogin: true, text: 'Accedi al tuo account per inviare un attacco.' };
      case 'empty':
        return { ok: false, text: 'Scrivi il testo dell’attacco prima di inviare.' };
      case 'error':
      default:
        return { ok: false, text: 'Canale non ancora attivo. Riprova più tardi.' };
    }
  }

  function open() {
    if (activeRoot) return;
    const root = document.createElement('div');
    root.className = 'sn-rt-overlay';
    global.SN_FILO_UI?.mark(root);
    root.dataset.snTheme = document.documentElement.dataset.snTheme || '';
    root.innerHTML = `
      <div class="sn-rt-modal" role="dialog" aria-modal="true" aria-label="Invia attacco red-team">
        <div class="sn-rt-drag" title="Trascina per spostare il box"><span class="sn-rt-grip"></span></div>
        <div class="sn-rt-body">
          <div class="sn-rt-head">
            <span class="sn-rt-head-icon">${icon('redteam', 18)}</span>
            <span class="sn-rt-head-title">Invia un attacco</span>
          </div>
          <label class="sn-rt-field">
            <span class="sn-rt-label">Testo dell’attacco</span>
            <textarea class="sn-rt-attack" rows="4" placeholder="Il prompt che prova a ingannare i giudici di sicurezza."></textarea>
          </label>
          <label class="sn-rt-field">
            <span class="sn-rt-label">Descrizione <span class="sn-rt-hint">(cosa fa e perché — non la vedono i giudici)</span></span>
            <textarea class="sn-rt-desc" rows="3" placeholder="Spiega come dovrebbe funzionare il tuo attacco."></textarea>
          </label>
          <div class="sn-rt-status" aria-live="polite"></div>
        </div>
        <div class="sn-rt-actions">
          <button type="button" class="sn-rt-btn-secondary sn-rt-cancel">Chiudi</button>
          <button type="button" class="sn-rt-btn sn-rt-send"></button>
        </div>
      </div>
    `;
    document.documentElement.appendChild(root);
    activeRoot = root;
    Popup?.attachZoomCompensation?.(root);
    activeStack = Popup?.registerStack?.(root) || null;

    const modal = root.querySelector('.sn-rt-modal');
    const dragHandle = root.querySelector('.sn-rt-drag');
    const attackEl = root.querySelector('.sn-rt-attack');
    const descEl = root.querySelector('.sn-rt-desc');
    const statusEl = root.querySelector('.sn-rt-status');
    const sendBtn = root.querySelector('.sn-rt-send');
    const cancelBtn = root.querySelector('.sn-rt-cancel');

    let signedIn = false;
    let balance = null; // null = sconosciuto (non blocchiamo finché non lo sappiamo)

    function sendLabel() {
      // Mostra SEMPRE il costo (spec §8.1, punto 3).
      if (!signedIn) return 'Accedi per inviare';
      return `Invia attacco · ${COST} cr`;
    }

    function setStatus(text, kind) {
      statusEl.textContent = text || '';
      statusEl.classList.toggle('sn-rt-status--err', kind === 'err');
      statusEl.classList.toggle('sn-rt-status--ok', kind === 'ok');
    }

    function refreshSendState() {
      sendBtn.textContent = sendLabel();
      const hasText = !!attackEl.value.trim();
      // Crediti insufficienti noti → disabilita con messaggio (spec §8.1 punto 4).
      if (signedIn && balance != null && balance < COST) {
        sendBtn.disabled = true;
        setStatus(`Crediti insufficienti: hai ${balance}, ne servono ${COST}.`, 'err');
        return;
      }
      // Non loggato: il bottone resta cliccabile ma porta al login.
      if (!signedIn) {
        sendBtn.disabled = false;
        return;
      }
      sendBtn.disabled = !hasText;
      if (statusEl.classList.contains('sn-rt-status--err') && hasText) setStatus('');
    }

    // Bozze persistenti: sopravvivono a chiusura e riapertura.
    let saveTimer = null;
    function saveDraft() {
      try {
        chrome.storage.local.set({
          [DRAFT_ATTACK_KEY]: attackEl.value,
          [DRAFT_DESC_KEY]: descEl.value,
        });
      } catch (_) {}
    }
    function clearDraft() {
      try { chrome.storage.local.remove([DRAFT_ATTACK_KEY, DRAFT_DESC_KEY]); } catch (_) {}
    }
    const onInput = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveDraft, 250);
      refreshSendState();
    };
    attackEl.addEventListener('input', onInput);
    descEl.addEventListener('input', onInput);
    try {
      chrome.storage.local.get([DRAFT_ATTACK_KEY, DRAFT_DESC_KEY]).then((r) => {
        if (activeRoot !== root) return;
        if (r?.[DRAFT_ATTACK_KEY] && !attackEl.value) attackEl.value = r[DRAFT_ATTACK_KEY];
        if (r?.[DRAFT_DESC_KEY] && !descEl.value) descEl.value = r[DRAFT_DESC_KEY];
        refreshSendState();
      }).catch(() => {});
    } catch (_) {}

    (async function loadAuthAndBalance() {
      try {
        const a = await chrome.runtime.sendMessage({ type: MSG.AUTH_STATUS });
        signedIn = !!(a && a.signedIn);
      } catch (_) { signedIn = false; }
      if (signedIn) {
        try {
          const c = await chrome.runtime.sendMessage({ type: MSG.GET_CREDITS });
          if (c && Number.isFinite(Number(c.credits))) balance = Number(c.credits);
        } catch (_) {}
      }
      if (activeRoot === root) refreshSendState();
    })();

    sendBtn.addEventListener('click', async () => {
      if (!signedIn) {
        setStatus('Accedi al tuo account per inviare un attacco.', 'err');
        try { chrome.runtime.sendMessage({ type: MSG.AUTH_SIGNIN }); } catch (_) {}
        return;
      }
      const attackText = attackEl.value.trim();
      const description = descEl.value.trim();
      if (!attackText) { setStatus('Scrivi il testo dell’attacco prima di inviare.', 'err'); return; }

      sendBtn.disabled = true;
      cancelBtn.disabled = true;
      setStatus('Invio…');
      let res;
      try {
        res = await chrome.runtime.sendMessage({
          type: MSG.REDTEAM_SUBMIT, attackText, description,
        });
      } catch (_) {
        res = { status: 'error' };
      }
      const msg = submitStatusMessage(res);
      if (msg.ok && res && res.attemptId) {
        clearDraft();
        setStatus(msg.text, 'ok');
        // Naviga alla pagina red-team sul tentativo: lì parte la rivelazione live.
        const url = 'filo://redteam/redteam.html?attempt=' + encodeURIComponent(String(res.attemptId));
        try { chrome.runtime.sendMessage({ type: MSG.OPEN_URL, url }); } catch (_) {}
        close();
        return;
      }
      setStatus(msg.text, 'err');
      if (msg.needLogin) {
        try { chrome.runtime.sendMessage({ type: MSG.AUTH_SIGNIN }); } catch (_) {}
      }
      cancelBtn.disabled = false;
      sendBtn.disabled = false;
      refreshSendState();
    });

    cancelBtn.addEventListener('click', () => close());

    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    function centerModal() {
      const w = modal.offsetWidth || 520;
      modal.style.left = Math.max(8, Math.round((window.innerWidth - w) / 2)) + 'px';
    }
    centerModal();

    let dragState = null;
    dragHandle.addEventListener('pointerdown', (e) => {
      const rect = modal.getBoundingClientRect();
      dragState = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, w: rect.width, h: rect.height };
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

    refreshSendState();
    attackEl.focus();
  }

  global.SN_REDTEAM_ATTACK_UI = { open, close, submitStatusMessage };
})(typeof globalThis !== 'undefined' ? globalThis : self);
