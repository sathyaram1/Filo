// Pannello «Invia attacco» del canale Red-team (spec §8.1): dal tasto destro (chi ha un codice) e dalla pagina Red Team.
// Due campi separati: l'attacco va ai 4 giudici, la descrizione solo al giudice di validità.
// Il backend può mancare: un REDTEAM_SUBMIT in errore diventa un messaggio, non un crash.

(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;
  const Popup = global.SN_POPUP;
  const Icons = global.SN_ICONS || {};

  const COST = 50; // crediti per tentativo (spec §8.1 / §11). Non rimborsabili.
  // Le bozze restano al sito dove sono nate, come quella del feedback (#1071).
  const bozza = (nome) => (global.SN_FILO_UI?.chiaveDiBozza ? global.SN_FILO_UI.chiaveDiBozza(nome) : null);
  const DRAFT_ATTACK_KEY = bozza('sn_redteam_attack_draft');
  const DRAFT_DESC_KEY = bozza('sn_redteam_desc_draft');

  let activeRoot = null;
  let activeStack = null;
  // Stacca ciò che l'apertura ha agganciato fuori dal pannello (#1096).
  let pulizia = null;

  function icon(name, size) {
    try { return typeof Icons[name] === 'function' ? Icons[name](size) : ''; }
    catch (_) { return ''; }
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
      case 'paused':
        // La frase del server, così com'è (#896): mai l'errore di trasporto.
        return { ok: false, paused: true, text: String(r.error || 'Il Red Team è in pausa: tornerà dopo il rilascio') };
      case 'not_signed_in':
        return { ok: false, needLogin: true, text: 'Accedi al tuo account per inviare un attacco.' };
      case 'empty':
        return { ok: false, text: 'Scrivi il testo dell’attacco prima di inviare.' };
      case 'error':
      default:
        return { ok: false, text: 'Canale non ancora attivo. Riprova più tardi.' };
    }
  }

  // Su un sito il pannello sta nello strato sopra la scheda, mai nel suo documento (#1509.1).
  function open() {
    if (activeRoot) return;
    if (global.SN_RIQUADRI_SOPRA?.apri('redteam', {}, apriQui)) return;
    apriQui();
  }

  function apriQui() {
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
          <p class="sn-rt-avviso" hidden>Ogni tentativo costa ${COST} crediti, e senza un codice Red Team il risultato non lo vedi.</p>
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
    document.documentElement.appendChild(Popup?.riquadro ? Popup.riquadro(root) : root);
    activeRoot = root;
    // La compensazione zoom ascolta window e visualViewport: senza staccarla ogni apertura resta in memoria (#1096).
    const staccaZoom = Popup?.attachZoomCompensation?.(root);
    activeStack = Popup?.registerStack?.(root) || null;

    const modal = root.querySelector('.sn-rt-modal');
    const dragHandle = root.querySelector('.sn-rt-drag');
    const attackEl = root.querySelector('.sn-rt-attack');
    const descEl = root.querySelector('.sn-rt-desc');
    const statusEl = root.querySelector('.sn-rt-status');
    const sendBtn = root.querySelector('.sn-rt-send');
    const cancelBtn = root.querySelector('.sn-rt-cancel');
    const avvisoEl = root.querySelector('.sn-rt-avviso');

    let signedIn = false;
    let balance = null; // null = sconosciuto (non blocchiamo finché non lo sappiamo)
    // Chi non ha un codice (#991) legge prima il prezzo e che il risultato non lo vede. null = non ancora saputo.
    let verificato = null;

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

    // Abilita/disabilita il bottone d'invio in base a stato login, saldo e testo.
    // Solo chi scrive cancella un errore: un rifiuto appena arrivato (la pausa del server) deve restare leggibile.
    function refreshSendState({ daInput = false } = {}) {
      sendBtn.textContent = sendLabel();
      const hasText = !!attackEl.value.trim();
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
      if (daInput && statusEl.classList.contains('sn-rt-status--err') && hasText) setStatus('');
    }

    // Bozze persistenti: sopravvivono a chiusura e riapertura.
    let saveTimer = null;
    pulizia = () => {
      try { if (typeof staccaZoom === 'function') staccaZoom(); } catch (_) {}
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; saveDraft(); }
    };
    function saveDraft() {
      if (!DRAFT_ATTACK_KEY) return;
      try {
        chrome.storage.local.set({
          [DRAFT_ATTACK_KEY]: attackEl.value,
          [DRAFT_DESC_KEY]: descEl.value,
        });
      } catch (_) {}
    }
    function clearDraft() {
      if (!DRAFT_ATTACK_KEY) return;
      try { chrome.storage.local.remove([DRAFT_ATTACK_KEY, DRAFT_DESC_KEY]); } catch (_) {}
    }
    const onInput = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { saveTimer = null; saveDraft(); }, 250);
      refreshSendState({ daInput: true });
    };
    attackEl.addEventListener('input', onInput);
    descEl.addEventListener('input', onInput);
    try {
      if (DRAFT_ATTACK_KEY) chrome.storage.local.get([DRAFT_ATTACK_KEY, DRAFT_DESC_KEY]).then((r) => {
        if (activeRoot !== root) return;
        if (r?.[DRAFT_ATTACK_KEY] && !attackEl.value) attackEl.value = r[DRAFT_ATTACK_KEY];
        if (r?.[DRAFT_DESC_KEY] && !descEl.value) descEl.value = r[DRAFT_DESC_KEY];
        refreshSendState();
      }).catch(() => {});
    } catch (_) {}

    (async function loadVerificato() {
      try {
        const r = await chrome.runtime.sendMessage({ type: MSG.REDTEAM_VISIBILITY, attendi: true });
        if (r && r.ok && typeof r.verificato === 'boolean') verificato = r.verificato;
      } catch (_) {}
      if (activeRoot === root) avvisoEl.hidden = verificato !== false;
    })();

    async function leggiSaldo() {
      if (!signedIn) return;
      try {
        const c = await chrome.runtime.sendMessage({ type: MSG.GET_CREDITS });
        if (c && Number.isFinite(Number(c.credits))) balance = Number(c.credits);
      } catch (_) {}
    }

    (async function loadAuthAndBalance() {
      try {
        const a = await chrome.runtime.sendMessage({ type: MSG.AUTH_STATUS });
        signedIn = !!(a && a.signedIn);
      } catch (_) { signedIn = false; }
      await leggiSaldo();
      if (activeRoot === root) refreshSendState();
    })();

    // L'esito dell'accesso cambia il pannello aperto (#810.15) e un fallimento dice il perché (#678.5). Sopra un sito
    // l'accesso passa solo col clic che l'ha chiesto (#1132).
    async function accedi() {
      setStatus('Completa l’accesso nella pagina di Google che si è aperta.');
      let r = null;
      try { r = await chrome.runtime.sendMessage({ type: MSG.AUTH_SIGNIN_CLIC }); } catch (_) { r = null; }
      if (activeRoot !== root) return;
      if (r && r.ok && (r.signedIn || r.profile)) {
        signedIn = true;
        await leggiSaldo();
        if (activeRoot !== root) return;
        setStatus('');
        refreshSendState();
        if (!sendBtn.disabled) setStatus('Sei dentro: premi Invia per mandare l’attacco.', 'ok');
        return;
      }
      setStatus((r && typeof r.error === 'string' && r.error.trim()) || 'Accesso non riuscito: riprova.', 'err');
    }

    // ---- invio: costa crediti, parte solo dal clic dell'utente (#1071) ----
    sendBtn.addEventListener('click', async (e) => {
      if (!e.isTrusted) return;
      if (!signedIn) {
        accedi();
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
      if (msg.ok && res && res.attemptId && verificato === false) {
        // Senza codice non c'è una pagina del risultato da aprire: il pannello resta, pronto per un altro.
        clearTimeout(saveTimer);
        saveTimer = null;
        clearDraft();
        attackEl.value = '';
        descEl.value = '';
        cancelBtn.disabled = false;
        refreshSendState();
        setStatus('Attacco inviato.', 'ok');
        return;
      }
      if (msg.ok && res && res.attemptId) {
        clearTimeout(saveTimer);
        saveTimer = null;
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
