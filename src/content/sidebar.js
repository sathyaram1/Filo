// Sidebar Aiuto: agente vision multi-turn. Espansa è pannello, conversazione e input; collassata è la sola barra d'input. Il click fuori collassa, il focus riapre, e l'AI può chiedere `collapse` dopo la sua risposta.
// Le azioni dell'utente diventano una riga grigia di log, non un finto messaggio suo; nella cronologia mandata all'AI restano come marcatore testuale, così l'agente sa cos'è successo.

(function (global) {
  'use strict';

  const { ACTIONS } = global.SN_CONST;
  const { MSG } = global.SN_MSG;
  const I18n = global.SN_I18N;
  const Highlight = global.SN_HIGHLIGHT;
  const Extract = global.SN_EXTRACT;
  const Popup = global.SN_POPUP;

  let root = null;
  let stackEntry = null;
  // history per l'AI: { role, content, kind } — kind ∈ 'real'|'action'|null
  let history = [];
  let collapsed = false;
  // Se true, click fuori dal pannello NON lo collassa (es. AI ha richiesto chat aperta)
  let aiPrefersOpen = false;
  let docClickHandler = null;

  // Telemetria di sessione: resta locale finché l'utente non clicca 👍/👎, e parte solo a fine task per arricchire il database dei percorsi (pathsCollector.js).
  // executedSteps tiene SOLO le azioni davvero eseguite e mai il value di un fill; rawUserMessages serve al judge lato server.
  let session = null;
  function newSession() {
    return {
      initialUrl: '',
      executedSteps: [],
      rawUserMessages: [],
      feedbackShown: false,
      webSearchCount: 0,
    };
  }
  // Cap difensivo: il prompt dice «max 2» ma l'AI può insistere, e le ricerche oltre il limite si ignorano in silenzio.
  const MAX_WEB_SEARCHES_PER_SESSION = 2;

  function isOpen() { return !!root; }

  function close() {
    if (!root) return;
    Highlight.clear();
    try { Highlight.clearForceHover?.(); } catch (_) {}
    if (docClickHandler) {
      document.removeEventListener('mousedown', docClickHandler, true);
      docClickHandler = null;
    }
    try { stackEntry?.unregister?.(); } catch (_) {}
    stackEntry = null;
    root.remove();
    root = null;
    history = [];
    collapsed = false;
    aiPrefersOpen = false;
    session = null;
  }

  function open(context) {
    if (root) return;
    history = [];
    collapsed = false;
    aiPrefersOpen = true;
    session = newSession();
    // L'URL iniziale è quello all'apertura della sidebar: contano solo le azioni fatte da qui in avanti.
    session.initialUrl = location.href;
    // Aperta dal tasto destro su una scheda: una riga di storia non mostrata in chat fa sapere all'agente che la richiesta parte da lì.
    if (context && context.source === 'tab') {
      const ctxTitle = context.title || document.title || '';
      const ctxUrl = context.url || location.href;
      history.push({
        role: 'user',
        kind: 'action',
        content: `(Sistema: l'utente ha aperto Aiuto col tasto destro sulla scheda «${ctxTitle}» (${ctxUrl}). Aspetta la sua domanda sulla scheda.)`,
      });
    }
    root = document.createElement('div');
    root.className = 'sn-sidebar';
    global.SN_FILO_UI?.mark(root);
    // Traccia osservabile della fonte di invocazione, per test e debug: c'è solo se aperta dal menu di una tab.
    if (context && context.source) root.dataset.invokedFrom = context.source;
    root.innerHTML = `
      <div class="sn-sidebar-header">
        <span class="sn-sidebar-title">${I18n.t('menu_help')}</span>
        <div class="sn-sidebar-actions">
          <button class="sn-sidebar-collapse" type="button" title="Collassa">▾</button>
          <button class="sn-sidebar-close" type="button" aria-label="${I18n.t('popup_close')}">×</button>
        </div>
      </div>
      <div class="sn-sidebar-conv"></div>
      <div class="sn-sidebar-meta"></div>
      <form class="sn-sidebar-input" autocomplete="off">
        <textarea rows="1" placeholder="Dimmi cosa vuoi fare sulla pagina…"></textarea>
        <button type="submit">↵</button>
      </form>
    `;
    document.documentElement.appendChild(root);
    // Partecipa allo stacking dei popup: sopra i box aperti prima, sotto quelli aperti dopo. Uno z-index fisso altissimo la faceva finire sopra al modale feedback, aperto dopo di lei.
    stackEntry = Popup?.registerStack?.(root) || null;

    root.querySelector('.sn-sidebar-close').addEventListener('click', close);
    root.querySelector('.sn-sidebar-collapse').addEventListener('click', () => collapse({ ai: false }));
    makeDraggable(root.querySelector('.sn-sidebar-header'));
    const form = root.querySelector('.sn-sidebar-input');
    const ta = form.querySelector('textarea');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) return;
      ta.value = '';
      submit({ userMessage: text });
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    ta.addEventListener('focus', () => expand({ ai: false }));
    ta.addEventListener('input', () => { if (collapsed) expand({ ai: false }); });

    docClickHandler = (e) => {
      if (!root || collapsed) return;
      if (root.contains(e.target)) return;
      if (aiPrefersOpen) return;
      collapse({ ai: false });
    };
    document.addEventListener('mousedown', docClickHandler, true);

    ta.focus();
  }

  function expand({ ai = false } = {}) {
    if (!root) return;
    collapsed = false;
    root.classList.remove('sn-sidebar-collapsed');
    if (ai) aiPrefersOpen = true;
  }

  function collapse({ ai = false } = {}) {
    if (!root) return;
    collapsed = true;
    root.classList.add('sn-sidebar-collapsed');
    if (ai) aiPrefersOpen = false;
  }

  // Il drag mantiene l'ancoraggio al BOTTOM, così la barra input resta dov'è quando il pannello si collassa.
  function makeDraggable(handleEl) {
    if (!handleEl || !root) return;
    handleEl.classList.add('sn-sidebar-drag');
    let dragging = false;
    let startX = 0, startY = 0, startLeft = 0, startBottom = 0;
    handleEl.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      const rect = root.getBoundingClientRect();
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left;
      startBottom = window.innerHeight - rect.bottom;
      root.style.left = `${rect.left}px`;
      root.style.bottom = `${startBottom}px`;
      root.style.right = 'auto';
      root.style.top = 'auto';
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const w = root.offsetWidth, h = root.offsetHeight;
      const maxLeft = Math.max(0, window.innerWidth - w);
      const maxBottom = Math.max(0, window.innerHeight - h);
      const newLeft = Math.min(maxLeft, Math.max(0, startLeft + dx));
      // muovendo il mouse in basso (dy > 0) il bottom deve diminuire.
      const newBottom = Math.min(maxBottom, Math.max(0, startBottom - dy));
      root.style.left = `${newLeft}px`;
      root.style.bottom = `${newBottom}px`;
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  // Sposta la sidebar di lato se copre il rettangolo dato: cambia solo l'asse X, l'ancoraggio al bottom resta.
  function ensureNotOverTarget(rect) {
    if (!root || !rect) return;
    const sr = root.getBoundingClientRect();
    const intersects = !(rect.right <= sr.left || rect.left >= sr.right
                       || rect.bottom <= sr.top || rect.top >= sr.bottom);
    if (!intersects) return;

    const w = root.offsetWidth;
    const margin = 16;
    const targetCenter = (rect.left + rect.right) / 2;
    const newLeft = targetCenter > window.innerWidth / 2
      ? margin
      : Math.max(0, window.innerWidth - w - margin);

    // Ancoraggio bottom: se è già fissato in stile inline si lascia com'è, altrimenti vale il default 16px.
    const currentBottom = root.style.bottom && root.style.bottom !== 'auto'
      ? root.style.bottom
      : '16px';
    root.style.left = `${newLeft}px`;
    root.style.right = 'auto';
    root.style.top = 'auto';
    root.style.bottom = currentBottom;
  }

  function convEl() { return root && root.querySelector('.sn-sidebar-conv'); }

  function appendChatMessage(role, text) {
    const conv = convEl();
    if (!conv) return null;
    const msg = document.createElement('div');
    msg.className = `sn-sidebar-msg sn-sidebar-msg-${role}`;
    // #418 — le risposte di Filo si rendono con la formattazione leggera di popup e chat della home (grassetto, corsivo, codice, elenchi, link cliccabili); il testo dell'utente resta letterale.
    if (role === 'assistant' && global.SN_MARKDOWN) {
      msg.innerHTML = global.SN_MARKDOWN.render(text);
    } else {
      msg.textContent = text;
    }
    conv.appendChild(msg);
    conv.scrollTop = conv.scrollHeight;
    return msg;
  }

  // Click su una choice: manda il prompt come messaggio utente e disattiva i bottoni — un solo percorso per turno.
  function renderChoices(afterEl, choices) {
    if (!afterEl || !choices || !choices.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'sn-sidebar-choices';
    choices.forEach((c) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sn-sidebar-choice';
      btn.textContent = c.label;
      btn.addEventListener('click', () => {
        if (wrap.classList.contains('sn-sidebar-choices-used')) return;
        wrap.classList.add('sn-sidebar-choices-used');
        wrap.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        submit({ userMessage: c.prompt });
      });
      wrap.appendChild(btn);
    });
    afterEl.insertAdjacentElement('afterend', wrap);
    const conv = convEl();
    if (conv) conv.scrollTop = conv.scrollHeight;
  }

  // Le frasi non sono il reasoning vero, che non è disponibile: sono una prova di funzionamento, varie e specifiche quanto basta a non sembrare uno spinner.
  const THINKING_PHRASES = [
    'Leggo la pagina…',
    'Analizzo lo screenshot…',
    'Identifico gli elementi interattivi…',
    'Confronto con la tua richiesta…',
    'Cerco il menu giusto…',
    'Valuto il prossimo passo…',
    'Controllo la struttura del DOM…',
    'Capisco il contesto…',
    'Scelgo il target migliore…',
    'Verifico che la pagina sia cambiata…',
    'Compongo la risposta…',
    'Riconosco i pattern noti…',
    'Stimo cosa serve all\'utente…',
  ];

  function appendThinking() {
    const conv = convEl();
    if (!conv) return null;
    const wrap = document.createElement('div');
    wrap.className = 'sn-sidebar-thinking';
    const lines = [];
    for (let i = 0; i < 3; i++) {
      const ln = document.createElement('div');
      ln.className = 'sn-sidebar-thinking-line';
      ln.dataset.slot = String(i); // 0=top fading out, 1=mid, 2=bottom fresh
      wrap.appendChild(ln);
      lines.push(ln);
    }
    conv.appendChild(wrap);
    conv.scrollTop = conv.scrollHeight;

    const pool = THINKING_PHRASES.slice();
    let recent = [];
    function nextPhrase() {
      const candidates = pool.filter((p) => !recent.includes(p));
      const src = candidates.length ? candidates : pool;
      const phrase = src[Math.floor(Math.random() * src.length)];
      recent.push(phrase);
      if (recent.length > 4) recent.shift();
      return phrase;
    }

    lines[0].textContent = nextPhrase();
    lines[1].textContent = nextPhrase();
    lines[2].textContent = nextPhrase();

    let stopped = false;
    const tick = () => {
      if (stopped || !wrap.isConnected) return;
      lines[0].textContent = lines[1].textContent;
      lines[1].textContent = lines[2].textContent;
      lines[2].textContent = nextPhrase();
      lines[2].classList.remove('sn-sidebar-thinking-enter');
      void lines[2].offsetWidth;
      lines[2].classList.add('sn-sidebar-thinking-enter');
    };
    const interval = setInterval(tick, 900);
    lines[2].classList.add('sn-sidebar-thinking-enter');

    return {
      el: wrap,
      stop() { stopped = true; clearInterval(interval); },
    };
  }

  function appendActionLog(text) {
    const conv = convEl();
    if (!conv) return null;
    const log = document.createElement('div');
    log.className = 'sn-sidebar-log';
    log.textContent = '· ' + text;
    conv.appendChild(log);
    conv.scrollTop = conv.scrollHeight;
    return log;
  }

  // Riquadro «Ha funzionato?»: compare quando l'AI dichiara conclusa la sessione e l'utente ha eseguito almeno un'azione.
  // Le risposte alimentano la collection `paths` via SAVE_PATH; la sanitizzazione a due LLM sta in pathsCollector.js.
  function renderFeedbackPrompt() {
    const conv = convEl();
    if (!conv) return;
    const wrap = document.createElement('div');
    wrap.className = 'sn-sidebar-feedback';
    const q = document.createElement('div');
    q.className = 'sn-sidebar-feedback-q';
    q.textContent = 'Ha funzionato? Aiutami a migliorare:';
    wrap.appendChild(q);
    // La domanda da sola sembrava un parere privato a chi scrive Filo, e
    // invece il sì pubblica i passi dove li legge chiunque: dirlo dove si
    // sceglie, non solo nella pagina che spiega la privacy (#584).
    const nota = document.createElement('div');
    nota.className = 'sn-sidebar-feedback-nota';
    // La riga dice il vero e va tenuta vera: da indirizzo e nomi dei pulsanti Filo toglie ciò che ha la forma di un dato personale, e un modello guarda il resto e blocca l'intero percorso se ci riconosce una persona.
    // Non promettere più di quanto quel modello veda davvero (#584): prometteva «senza il tuo nome» quando di fatto non vedeva niente di quello che stava per uscire.
    nota.textContent = 'Rispondendo condividi i passi di questo percorso con chi userà Filo su questo sito. Filo toglie prima i dati personali e l’ora; se resta qualcosa che dice chi sei, non lo pubblica.';
    wrap.appendChild(nota);
    const row = document.createElement('div');
    row.className = 'sn-sidebar-feedback-row';

    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'sn-sidebar-feedback-btn';
    up.textContent = '👍 Sì';
    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'sn-sidebar-feedback-btn';
    down.textContent = '👎 No';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'sn-sidebar-feedback-skip';
    skip.textContent = '✕';
    skip.title = 'Salta';

    function disableAll() {
      up.disabled = true; down.disabled = true; skip.disabled = true;
    }
    function thanks() {
      const t = document.createElement('div');
      t.className = 'sn-sidebar-feedback-thanks';
      t.textContent = 'Grazie!';
      wrap.appendChild(t);
    }

    up.addEventListener('click', () => {
      disableAll();
      saveCurrentPath(true).catch(() => {});
      thanks();
    });
    down.addEventListener('click', () => {
      disableAll();
      saveCurrentPath(false).catch(() => {});
      thanks();
    });
    skip.addEventListener('click', () => {
      // Niente save, solo dismiss visivo.
      disableAll();
      wrap.classList.add('sn-sidebar-feedback-dismissed');
    });

    row.appendChild(up);
    row.appendChild(down);
    row.appendChild(skip);
    wrap.appendChild(row);
    conv.appendChild(wrap);
    conv.scrollTop = conv.scrollHeight;
  }

  // Se da questa pagina un percorso partirebbe davvero lo sa solo il processo principale (protocollo, sito, spazio in coda): si chiede a lui, la stessa porta che usa la raccolta,
  // o il riquadro promette una cosa e la raccolta ne fa un'altra (#584). Se la domanda non arriva a destinazione non si promette niente.
  async function percorsoRaccoglibile() {
    try {
      const r = await chrome.runtime.sendMessage({
        type: MSG.PATH_COLLECTABLE,
        payload: { url: (session && session.initialUrl) || location.href },
      });
      return !!(r && r.raccoglibile);
    } catch (_) { return false; }
  }

  async function saveCurrentPath(success) {
    if (!session) return;
    try {
      await chrome.runtime.sendMessage({
        type: MSG.SAVE_PATH,
        payload: {
          // Qui non parte NESSUN identificativo del mittente, neanche vuoto: chi manda si presenta al server col token dell'identità dell'installazione, che il server verifica e che il processo principale allega all'invio (#585).
          // Un identificativo generato in questa pagina sarebbe autodichiarato, e chi attacca ne scriverebbe uno diverso a ogni invio; un campo vuoto che si porta dietro il nome è l'invito a riempirlo.
          session: {
            rawUrl: session.initialUrl,
            rawSteps: session.executedSteps,
            rawUserMessages: session.rawUserMessages,
            success: !!success,
          },
        },
      });
    } catch (_) { /* fail silently — è telemetria best-effort */ }
  }

  // Etichetta breve (≤4 parole) per descrivere un'azione utente.
  // Preferenza: testo dell'elemento → aria-label → tag.
  function describeElementBriefly(el) {
    if (!el) return '';
    const raw = (
      el.getAttribute?.('aria-label')
      || (el.innerText || el.textContent || '').trim()
      || el.getAttribute?.('alt')
      || el.getAttribute?.('placeholder')
      || el.value
      || el.tagName.toLowerCase()
    ).replace(/\s+/g, ' ').trim();
    if (!raw) return el.tagName.toLowerCase();
    const words = raw.split(' ');
    return words.slice(0, 4).join(' ');
  }

  function parseAssistantOutput(text) {
    const fallback = { display: (text || '').trim(), highlight: null, choices: [], status: 'done', collapse: false };
    if (!text) return fallback;
    const trimmed = text.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) return fallback;
    try {
      const obj = JSON.parse(trimmed.slice(start, end + 1));
      if (!obj || typeof obj !== 'object') return fallback;
      // Richiesta di ricerca web: scavalca il flusso normale, la processa submit() prima di rendere la risposta in chat.
      if (obj.action === 'web_search' && typeof obj.query === 'string' && obj.query.trim()) {
        return { kind: 'web_search', query: obj.query.trim().slice(0, 300) };
      }
      // Comando della shell di Filo (icone della barra in alto), eseguito in autonomia senza coinvolgere l'utente. "close" è escluso.
      if (obj.action === 'shell' && typeof obj.command === 'string') {
        const allowed = ['home', 'settings', 'apps', 'account', 'fullscreen', 'minimize'];
        const cmd = obj.command.trim().toLowerCase();
        if (allowed.includes(cmd)) {
          return {
            kind: 'shell',
            command: cmd,
            display: typeof obj.text === 'string' ? obj.text : '',
            status: obj.status === 'continue' ? 'continue' : 'done',
          };
        }
      }
      // Azione tipizzata di Filo, le stesse che può emettere la chat della dashboard. NON si esegue qui: passa dal registro dei livelli di sicurezza nel main e, se serve, dal popup di conferma (vedi submit()).
      if (obj.action === 'filo' && obj.filo && typeof obj.filo === 'object'
        && typeof obj.filo.type === 'string' && obj.filo.type.trim()) {
        return {
          kind: 'filo_action',
          filoAction: obj.filo,
          display: typeof obj.text === 'string' ? obj.text : '',
          status: obj.status === 'continue' ? 'continue' : 'done',
        };
      }
      // Azione SULLA PAGINA, le stesse del menu tasto destro su testo, immagine e link. Non sono azioni del main: vivono in actions.js e tts.js e le esegue la sidebar con runPageAction(),
      // col popup di conferma di Filo quando l'azione esce verso l'esterno. Vedi PROMPTS.help().
      if (obj.action === 'page' && obj.page && typeof obj.page === 'object'
        && typeof obj.page.op === 'string' && PAGE_ACTIONS[obj.page.op]) {
        return {
          kind: 'page_action',
          page: obj.page,
          display: typeof obj.text === 'string' ? obj.text : '',
          status: obj.status === 'continue' ? 'continue' : 'done',
        };
      }
      const status = obj.status === 'continue' ? 'continue' : 'done';
      const collapseFlag = typeof obj.collapse === 'boolean' ? obj.collapse : null;
      let highlight = null;
      if (obj.highlight && typeof obj.highlight.selector === 'string') {
        const rawAction = obj.highlight.action;
        const action = (rawAction === 'fill' || rawAction === 'reveal' || rawAction === 'hover')
          ? rawAction : 'click';
        highlight = {
          selector: obj.highlight.selector,
          action,
          value: action === 'fill' ? (obj.highlight.value || '') : '',
          note: typeof obj.highlight.note === 'string' ? obj.highlight.note.trim() : '',
        };
      }
      let choices = [];
      if (Array.isArray(obj.choices)) {
        choices = obj.choices
          .filter((c) => c && typeof c.label === 'string' && typeof c.prompt === 'string'
            && c.label.trim() && c.prompt.trim())
          .slice(0, 5)
          .map((c) => ({ label: c.label.trim(), prompt: c.prompt.trim() }));
      }
      return {
        display: typeof obj.text === 'string' ? obj.text : '',
        highlight,
        choices,
        status,
        collapse: collapseFlag,
      };
    } catch (_) {
      return fallback;
    }
  }

  // Le azioni tipizzate non si eseguono localmente: passano da executeFiloAction nel main, che consulta il registro dei livelli di sicurezza (src/shared/actionLevels.js) e, per i livelli ≥ 2, rimanda una spiegazione da mostrare nel popup di conferma (SN_CONFIRM_UI).
  // È lo stesso popup della chat della dashboard: la sidebar non è un canale privilegiato — stesso registro, stesse conferme, stesse regole.

  // Etichetta breve per la riga di log in chat (cosa Filo ha fatto/sta facendo).
  function filoActionLabel(action) {
    const type = String(action && action.type || '').toUpperCase();
    if (type === 'INVIA_FEEDBACK') return 'invio feedback agli sviluppatori';
    return `azione Filo: ${type.toLowerCase().replace(/_/g, ' ')}`;
  }

  async function runFiloAction(action) {
    const label = filoActionLabel(action);
    let res = null;
    try {
      res = await chrome.runtime.sendMessage({ type: MSG.FILO_RUN_ACTION, action });
    } catch (_) {}
    if (!res || !res.ok) { appendActionLog(`${label}: non riuscita`); return false; }

    // Livello ≥ 2: il main non ha eseguito e manda la spiegazione per il popup; solo dopo l'OK l'azione riparte via FILO_CONFIRM_ACTION, riclassificata di nuovo nel main.
    if (res.needsConfirm) {
      const Ui = global.SN_CONFIRM_UI;
      const opts = { title: 'Filo chiede conferma', text: res.describe || '' };
      let ok = false;
      try {
        ok = Ui
          ? await (res.needsConfirm >= 3 ? Ui.confirmTyped(opts) : Ui.confirm(opts))
          : global.confirm(opts.text);
      } catch (_) { ok = false; }
      if (!ok) { appendActionLog(`${label}: annullata`); return false; }
      let c = null;
      try {
        c = await chrome.runtime.sendMessage({ type: MSG.FILO_CONFIRM_ACTION, action });
      } catch (_) {}
      const done = !!(c && c.executed);
      appendActionLog(done ? `${label}: fatto` : `${label}: non riuscita`);
      return done;
    }

    const done = !!res.executed;
    appendActionLog(done ? `${label}: fatto` : `${label}: non riuscita`);
    return done;
  }

  // Azioni sulla pagina: a differenza di quelle tipizzate non passano dal main, vivono nel content script (SN_ACTIONS, SN_TTS) e operano sull'elemento o sulla selezione corrente.
  // Quelle che escono verso l'esterno (cerca sul web, condividi) chiedono conferma con lo stesso popup di Filo; copia, leggi e salva-per-dopo sono locali e immediate.
  // SN_ACTIONS e SN_TTS sono caricati DOPO sidebar.js, quindi si risolvono al volo dentro la funzione e non in cima all'IIFE.
  const PAGE_ACTIONS = {
    copy:         { target: 'text',  confirm: false, label: 'copia testo' },
    cut:          { target: 'text',  confirm: false, label: 'taglia testo' },
    search_text:  { target: 'text',  confirm: true,  label: 'cerca testo sul web' },
    read_aloud:   { target: 'text',  confirm: false, label: 'leggi ad alta voce' },
    stop_reading: { target: 'none',  confirm: false, label: 'ferma la lettura' },
    edit_text:    { target: 'text',  confirm: false, label: 'modifica testo' },
    copy_image:      { target: 'image', confirm: false, label: 'copia immagine' },
    save_image:      { target: 'image', confirm: false, label: 'salva immagine' },
    copy_image_link: { target: 'image', confirm: false, label: 'copia link immagine' },
    search_image:    { target: 'image', confirm: true,  label: 'cerca immagine sul web' },
    open_link:  { target: 'link', confirm: false, label: 'apri link in nuova scheda' },
    copy_link:  { target: 'link', confirm: false, label: 'copia link' },
    save_link:  { target: 'link', confirm: false, label: 'salva link per dopo' },
    share_link: { target: 'link', confirm: true,  label: 'condividi link' },
  };

  // Testo bersaglio: quello fornito dall'agente, altrimenti la selezione corrente.
  function resolveActionText(page) {
    const provided = String(page.text ?? page.testo ?? page.query ?? page.selection ?? '').trim();
    if (provided) return provided;
    try { return (window.getSelection?.()?.toString() || '').trim(); } catch (_) { return ''; }
  }

  // Immagine bersaglio: per selettore, per src, altrimenti la più grande visibile.
  function resolveImageEl(page) {
    const sel = String(page.selector ?? page.css ?? '').trim();
    if (sel) {
      try {
        const el = document.querySelector(sel);
        if (el) return el.tagName === 'IMG' ? el : el.querySelector('img');
      } catch (_) {}
    }
    const wanted = String(page.src ?? page.url ?? page.href ?? '').trim();
    const imgs = Array.from(document.images || []);
    if (wanted) {
      const hit = imgs.find((im) => (im.currentSrc || im.src || '') === wanted)
        || imgs.find((im) => (im.currentSrc || im.src || '').includes(wanted));
      if (hit) return hit;
    }
    // Fallback: l'immagine visibile più grande (di norma l'immagine "principale").
    let best = null; let bestArea = 0;
    for (const im of imgs) {
      const r = im.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea && r.width > 32 && r.height > 32) { best = im; bestArea = area; }
    }
    return best;
  }

  // Link bersaglio: per selettore (anche su un figlio del link), per URL.
  function resolveLinkEl(page) {
    const sel = String(page.selector ?? page.css ?? '').trim();
    if (sel) {
      try {
        const el = document.querySelector(sel);
        const a = el && (el.tagName === 'A' ? el : (el.closest?.('a[href]') || el.querySelector?.('a[href]')));
        if (a && a.href) return a;
      } catch (_) {}
    }
    const wanted = String(page.url ?? page.href ?? '').trim();
    if (wanted) {
      const links = Array.from(document.querySelectorAll('a[href]'));
      const hit = links.find((a) => a.href === wanted) || links.find((a) => a.href.includes(wanted));
      if (hit) return hit;
    }
    return null;
  }

  async function runPageAction(page) {
    const spec = PAGE_ACTIONS[page.op];
    if (!spec) return false;
    const Actions = global.SN_ACTIONS;
    const Tts = global.SN_TTS;
    const label = spec.label;

    // Risolvi il bersaglio in anticipo: se manca, niente popup né esecuzione.
    let text = '';
    let imgEl = null;
    let linkEl = null;
    if (spec.target === 'text') {
      text = resolveActionText(page);
      if (!text && page.op !== 'edit_text') {
        appendActionLog(`${label}: nessun testo selezionato`);
        return false;
      }
    } else if (spec.target === 'image') {
      imgEl = resolveImageEl(page);
      if (!imgEl) { appendActionLog(`${label}: immagine non trovata`); return false; }
    } else if (spec.target === 'link') {
      linkEl = resolveLinkEl(page);
      const fallbackUrl = String(page.url ?? page.href ?? '').trim();
      if (!linkEl && !(page.op === 'open_link' && fallbackUrl)) {
        appendActionLog(`${label}: link non trovato`);
        return false;
      }
    }

    // Conferma per le azioni che escono verso l'esterno (stesso popup di Filo).
    if (spec.confirm) {
      const Ui = global.SN_CONFIRM_UI;
      let detail = '';
      if (spec.target === 'text') detail = text.length > 80 ? `${text.slice(0, 80)}…` : text;
      else if (imgEl) detail = imgEl.currentSrc || imgEl.src || '';
      else if (linkEl) detail = linkEl.href || '';
      const describe = `${label}${detail ? `:\n“${detail}”` : ''}`;
      let ok = false;
      try {
        ok = Ui ? await Ui.confirm({ title: 'Filo chiede conferma', text: describe }) : global.confirm(describe);
      } catch (_) { ok = false; }
      if (!ok) { appendActionLog(`${label}: annullata`); return false; }
    }

    try {
      switch (page.op) {
        case 'copy': Actions?.copyToClipboard(text); break;
        case 'cut': Actions?.cutSelection(); break;
        case 'search_text': Actions?.searchTextOnWeb(text); break;
        case 'read_aloud': await Tts?.readAloud(text); break;
        case 'stop_reading': Tts?.stopReading(); break;
        case 'edit_text': global.SN_EDITBOX?.openEditBox(text); break;
        case 'copy_image': await Actions?.copyImage(imgEl); break;
        case 'save_image': Actions?.downloadImage(imgEl); break;
        case 'copy_image_link': Actions?.copyUrlToClipboard(imgEl.currentSrc || imgEl.src); break;
        case 'search_image': Actions?.searchImageOnWeb(imgEl); break;
        case 'open_link': {
          // "Apri in nuova scheda" è un'azione di sistema già registrata: la
          // instradiamo via il ponte di #192.1 (NAVIGA → TabManager del main).
          const url = (linkEl && linkEl.href) || String(page.url ?? page.href ?? '').trim();
          return await runFiloAction({ type: 'NAVIGA', url });
        }
        case 'copy_link': Actions?.copyUrlToClipboard(linkEl.href); break;
        case 'save_link': await Actions?.saveLink(linkEl); break;
        case 'share_link': await Actions?.shareLink(linkEl); break;
        default: appendActionLog(`${label}: non riuscita`); return false;
      }
    } catch (_) {
      appendActionLog(`${label}: non riuscita`);
      return false;
    }
    appendActionLog(`${label}: fatto`);
    return true;
  }

  // ---------- Submit / loop ----------

  function buildPayload(userMessage, userAction) {
    const screenshot = null; // riempito dopo
    const outline = (() => { try { return Extract?.extractInteractiveOutline?.() || ''; } catch (_) { return ''; } })();
    const viewport = (() => { try { return Extract?.viewportInfo?.() || null; } catch (_) { return null; } })();
    // history per l'AI: solo {role, content}, niente metadati UI.
    const aiHistory = history.map(({ role, content }) => ({ role, content }));
    return {
      url: location.href,
      title: document.title,
      userMessage: userMessage || undefined,
      userAction: userAction || undefined,
      history: aiHistory,
      screenshot,
      outline,
      viewport,
    };
  }

  async function captureScreenshot() {
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.CAPTURE_VISIBLE_TAB });
      if (r?.ok && r.dataUrl) return r.dataUrl;
    } catch (_) {}
    return null;
  }

  // Aspetta che la pagina si stabilizzi dopo un'azione: le SPA cambiano contenuto e URL in modo asincrono. Esce quando l'URL è cambiato E il DOM è quieto da `quietMs`, oppure dopo `maxMs`.
  function waitForPageSettle({ initialUrl, minMs = 250, quietMs = 350, maxMs = 2500 } = {}) {
    return new Promise((resolve) => {
      const start = Date.now();
      let lastMutation = Date.now();
      let urlChanged = !initialUrl || location.href !== initialUrl;

      const observer = new MutationObserver(() => {
        lastMutation = Date.now();
        if (!urlChanged && location.href !== initialUrl) urlChanged = true;
      });
      try {
        observer.observe(document.documentElement, {
          childList: true, subtree: true, attributes: true, characterData: true,
        });
      } catch (_) {}

      const tick = () => {
        const now = Date.now();
        const elapsed = now - start;
        const sinceMutation = now - lastMutation;
        const ready = document.readyState === 'complete';
        const longEnough = elapsed >= minMs;
        const quiet = sinceMutation >= quietMs;
        const enoughEvidence = urlChanged || elapsed >= maxMs / 2;
        if ((longEnough && quiet && ready && enoughEvidence) || elapsed >= maxMs) {
          observer.disconnect();
          resolve();
          return;
        }
        setTimeout(tick, 80);
      };
      tick();
    });
  }

  // submit({ userMessage }) — invio iniziale o domanda dell'utente
  // submit({ userAction }) — proseguimento automatico dopo un'azione utente
  async function submit({ userMessage = '', userAction = '', preActionUrl = '' } = {}) {
    if (!root) return;
    const wasCollapsed = collapsed;
    // Espandi solo se l'utente ha scritto qualcosa: sui proseguimenti automatici il box non deve riaprirsi mentre il modello elabora.
    if (userMessage) expand({ ai: false });

    if (userMessage) {
      appendChatMessage('user', userMessage);
      history.push({ role: 'user', content: userMessage, kind: 'real' });
      // Il messaggio grezzo serve al judge lato server (pathsCollector). Niente userAction: quelle sono note di sistema, non input dell'utente.
      if (session) session.rawUserMessages.push(userMessage);
    }

    const thinking = appendThinking();
    let assistantEl = null;

    // Sui proseguimenti automatici si aspetta che la pagina si sia aggiornata prima dello screenshot: senza, l'AI vede la pagina vecchia e chiede di ripetere il click.
    if (userAction) {
      await waitForPageSettle({ initialUrl: preActionUrl || location.href });
    }
    const screenshot = await captureScreenshot();
    const payload = buildPayload(userMessage, userAction);
    payload.screenshot = screenshot || undefined;

    try {
      const res = await chrome.runtime.sendMessage({
        type: MSG.AI_REQUEST,
        action: ACTIONS.HELP,
        payload,
      });
      if (!res?.ok) throw new Error(res?.error || I18n.t('err_provider_failed'));
      const parsed = parseAssistantOutput(res.text);

      // L'AI ha chiesto una ricerca: si esegue, si logga in chat, e si rilancia un turno coi risultati come nota di sistema, così l'AI può produrre il JSON normale.
      if (parsed.kind === 'web_search') {
        if (thinking) { thinking.stop(); thinking.el.remove(); }
        if (session && session.webSearchCount >= MAX_WEB_SEARCHES_PER_SESSION) {
          appendActionLog('ricerca web: limite raggiunto, ignorata');
          setTimeout(() => submit({
            userAction: 'limite di ricerche web raggiunto per questa sessione. Rispondi ora con il JSON normale usando solo ciò che già sai (pagina, llms.txt, percorsi noti).',
            preActionUrl: location.href,
          }), 50);
          return;
        }
        if (session) session.webSearchCount += 1;
        appendActionLog(`ricerca web: "${parsed.query}"`);
        let resultsText = '';
        let provider = '';
        try {
          const r = await chrome.runtime.sendMessage({ type: MSG.WEB_SEARCH, query: parsed.query });
          if (r?.ok && Array.isArray(r.results) && r.results.length) {
            provider = r.provider || '';
            resultsText = r.results.map((x, i) =>
              `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.snippet || ''}`
            ).join('\n');
          } else {
            resultsText = '(nessun risultato)';
          }
        } catch (_) {
          resultsText = '(errore di rete durante la ricerca)';
        }
        const note = `risultati ricerca web (${provider || 'n/a'}) per "${parsed.query}":\n${resultsText}\n\nProcedi ora con il JSON normale (highlight / choices / text / status).`;
        // Un placeholder assistant fa vedere che qualcosa è successo: altrimenti la chat sembra saltare un turno.
        history.push({ role: 'assistant', content: `(ho richiesto una ricerca web: "${parsed.query}")` });
        setTimeout(() => submit({ userAction: note, preActionUrl: location.href }), 50);
        return;
      }

      // I comandi rapidi della barra di Filo li eseguiamo in autonomia, come reveal e hover: quei bottoni vivono nella shell, non nella pagina, e l'utente non potrebbe cliccarli nel flusso normale.
      if (parsed.kind === 'shell') {
        if (thinking) { thinking.stop(); thinking.el.remove(); }
        const human = {
          home: 'home', settings: 'impostazioni', apps: 'app',
          account: 'account', fullscreen: 'schermo intero', minimize: 'riduci a icona',
        }[parsed.command] || parsed.command;
        let okShell = false;
        try {
          const r = await chrome.runtime.sendMessage({ type: MSG.SHELL_ACTION, command: parsed.command });
          okShell = !!(r && r.ok);
        } catch (_) {}
        appendActionLog(okShell ? `comando Filo: ${human}` : `comando Filo non riuscito: ${human}`);
        if (okShell && session) {
          session.executedSteps.push({ selector: `shell:${parsed.command}`, action: 'shell', retracted: false });
        }
        if (parsed.display) {
          appendChatMessage('assistant', parsed.display);
          history.push({ role: 'assistant', content: parsed.display });
        }
        // Le azioni shell non cambiano il DOM che l'agente vede, o sostituiscono la pagina del tutto: si prosegue solo su status:"continue" e solo se la pagina non è cambiata, così l'AI può concatenare passi.
        if (parsed.status === 'continue' && okShell && parsed.command !== 'home') {
          const note = `ho eseguito il comando Filo "${parsed.command}". Valuta lo stato e prosegui, oppure chiudi con status:"done".`;
          setTimeout(() => submit({ userAction: note, preActionUrl: location.href }), 200);
        } else {
          expand({ ai: true });
        }
        return;
      }

      // Azione tipizzata di Filo: si passa dal registro dei livelli di sicurezza del main e, quando serve, dal popup di conferma — nessun canale privilegiato per la sidebar.
      if (parsed.kind === 'filo_action') {
        if (thinking) { thinking.stop(); thinking.el.remove(); }
        if (parsed.display) {
          appendChatMessage('assistant', parsed.display);
          history.push({ role: 'assistant', content: parsed.display });
        }
        await runFiloAction(parsed.filoAction);
        expand({ ai: true });
        return;
      }

      // Azione SULLA PAGINA: le stesse del menu tasto destro, eseguite dal content script.
      if (parsed.kind === 'page_action') {
        if (thinking) { thinking.stop(); thinking.el.remove(); }
        if (parsed.display) {
          appendChatMessage('assistant', parsed.display);
          history.push({ role: 'assistant', content: parsed.display });
        }
        const ok = await runPageAction(parsed.page);
        // Se l'agente vuole concatenare passi (status:"continue") e l'azione è
        // andata a buon fine, prosegue con una nota di sistema; altrimenti chiude.
        if (parsed.status === 'continue' && ok) {
          const note = `ho eseguito l'azione di pagina "${parsed.page.op}". Valuta lo stato e prosegui, oppure chiudi con status:"done".`;
          setTimeout(() => submit({ userAction: note, preActionUrl: location.href }), 200);
        } else {
          expand({ ai: true });
        }
        return;
      }

      if (thinking) { thinking.stop(); thinking.el.remove(); }
      // Senza testo del modello ma con un highlight di routine, una riga discreta in chat («→ passo successivo») dice all'utente che una risposta c'è stata.
      const displayText = parsed.display || (parsed.highlight ? '→ passo evidenziato sulla pagina' : '(risposta vuota)');
      assistantEl = appendChatMessage('assistant', displayText);

      if (userAction && !userMessage) {
        history.push({ role: 'user', content: `(Sistema: ${userAction}. Stato pagina aggiornato.)`, kind: 'action' });
      }
      history.push({ role: 'assistant', content: parsed.display || res.text });

      if (parsed.choices && parsed.choices.length) {
        renderChoices(assistantEl, parsed.choices);
      }

      // Il tooltip on-page usa SOLO highlight.note, non il testo della chat, per non duplicare il messaggio nel riquadrino. Per i fill il riquadro c'è comunque: contiene valore e bottone Accetta.
      Highlight.clear();
      if (parsed.highlight) {
        const act = parsed.highlight.action;
        if (act === 'reveal' || act === 'hover') {
          // Auto-action eseguita da noi, senza l'utente: validazione e whitelist stanno dentro Highlight.autoAction.
          const result = Highlight.autoAction(parsed.highlight.selector, act);
          const targetLabel = result.target ? describeElementBriefly(result.target) : '';
          if (result.ok) {
            // Traccia lo step per la telemetria a fine sessione.
            if (session) session.executedSteps.push({
              selector: parsed.highlight.selector,
              action: act,
              retracted: false,
            });
            const msg = act === 'reveal'
              ? (targetLabel ? `sezione aperta: ${targetLabel}` : 'sezione aperta')
              : (targetLabel ? `menu aperto su ${targetLabel}` : 'menu aperto');
            appendActionLog(msg);
            if (parsed.status === 'continue') {
              const aiNote = act === 'reveal'
                ? `ho eseguito reveal su ${targetLabel || parsed.highlight.selector}: la sezione è ora aperta. Outline e screenshot sono aggiornati.`
                : `ho eseguito hover su ${targetLabel || parsed.highlight.selector}: il menu è ora aperto. Outline e screenshot sono aggiornati.`;
              setTimeout(() => submit({ userAction: aiNote, preActionUrl: location.href }), 150);
            }
          } else {
            // Reveal rifiutato dalla whitelist o target mancante: si chiede all'AI di correggersi senza toccare la pagina.
            const aiNote = act === 'reveal'
              ? `reveal rifiutato (motivo: ${result.reason}). L'elemento non è un disclosure sicuro (details/aria-expanded+aria-controls non-link non-submit). Usa "click" con highlight per chiedere conferma all'utente, oppure scegli un altro target.`
              : `hover non eseguibile (motivo: ${result.reason}). Selector non trovato o azione fallita.`;
            appendActionLog(act === 'reveal' ? 'reveal rifiutato' : 'hover fallito');
            if (parsed.status === 'continue') {
              setTimeout(() => submit({ userAction: aiNote, preActionUrl: location.href }), 50);
            }
          }
        } else {
          const onAct = parsed.status === 'continue'
            ? () => onUserAction(parsed.highlight)
            : null;
          Highlight.show(parsed.highlight.selector, {
            note: parsed.highlight.note || '',
            action: parsed.highlight.action,
            value: parsed.highlight.value,
            onAction: onAct,
          });
        }
      }

      // Collapse: se l'AI ha deciso vale il suo valore. Altrimenti choices → resta aperta (vanno cliccate), highlight click silenzioso senza note né choices → collassa, negli altri casi resta aperta.
      const isAutoHighlight = !!(parsed.highlight
        && (parsed.highlight.action === 'reveal' || parsed.highlight.action === 'hover'));
      let shouldCollapse;
      if (parsed.collapse !== null) shouldCollapse = parsed.collapse;
      else if (parsed.choices && parsed.choices.length) shouldCollapse = false;
      else if (isAutoHighlight) shouldCollapse = collapsed; // mantieni stato: il turno successivo decide
      else shouldCollapse = !!parsed.highlight;

      if (shouldCollapse) collapse({ ai: true });
      else expand({ ai: true });

      const meta = root.querySelector('.sn-sidebar-meta');
      if (meta) {
        const eur = res.costEur ? ` • €${res.costEur.toFixed(4)}` : '';
        const prov = res.provider ? ` • ${res.provider}` : '';
        meta.textContent = `${I18n.t('popup_model')}: ${res.model}${prov}${eur}`;
      }

      // Popup feedback 👍/👎 a fine task: solo se l'AI dice "done", c'è almeno
      // un'azione realmente eseguita, e non l'abbiamo già mostrato nella sessione.
      if (parsed.status === 'done'
          && session && !session.feedbackShown
          && session.executedSteps.length > 0) {
        session.feedbackShown = true;
        // …e solo se da qui partirebbe davvero qualcosa: da un server di prova, dall'intranet, da un disco di rete e dalle pagine interne non si raccoglie niente (#584).
        // Chiedere lì promette una condivisione che non avviene e ringrazia per una risposta che non serve; a rispondere è il processo principale, con la stessa porta della raccolta.
        if (await percorsoRaccoglibile()) {
          // Chat sempre aperta quando chiediamo feedback (l'utente deve vederlo).
          expand({ ai: true });
          renderFeedbackPrompt();
        }
      }
    } catch (err) {
      if (thinking) { thinking.stop(); thinking.el.remove(); }
      const raw = err?.message || String(err);
      // #360 — la chat non è un log: «fetch failed» o «OpenRouter 400» non dicono niente all'utente. Stessa traduzione della chat della home e di quella dei mazzi.
      const CE = globalThis.SN_CHAT_ERRORS;
      const errText = /context invalidated/i.test(raw)
        ? 'L\'estensione è stata ricaricata. Aggiorna la pagina (F5) per ricollegare la sidebar.'
        : (CE ? CE.sentence(err) : raw);
      assistantEl = appendChatMessage('assistant', errText);
      assistantEl.classList.add('sn-sidebar-msg-error');
      // In caso d'errore, se l'utente aveva la chat collassata e questo è
      // un proseguimento automatico, ripristina lo stato precedente.
      if (wasCollapsed && !userMessage) collapse({ ai: false });
    }
  }

  // L'utente ha eseguito l'azione che l'AI aveva indicato (click sul target
  // o accept di un fill). Logghiamo l'azione e chiediamo il passo successivo.
  function onUserAction(highlight) {
    if (!root) return;
    const el = (() => { try { return document.querySelector(highlight.selector); } catch (_) { return null; } })();
    const label = describeElementBriefly(el);
    let logText, aiNote;
    if (highlight.action === 'fill') {
      logText = label ? `testo inserito in ${label}` : 'testo inserito';
      aiNote = `l'utente ha accettato il suggerimento di fill e il testo è stato inserito nel campo`;
    } else {
      logText = label ? `click su ${label}` : 'click eseguito';
      aiNote = `l'utente ha cliccato sull'elemento che avevi indicato (${label || highlight.selector})`;
    }
    // Telemetria: niente value, anche per un fill — il contenuto dei campi può essere sensibile.
    if (session) session.executedSteps.push({
      selector: highlight.selector,
      action: highlight.action,
      retracted: false,
    });
    appendActionLog(logText);
    Highlight.clear();
    // Dopo un click utente "vero" il menu hover-forced non serve più: il
    // browser gestirà gli hover successivi naturalmente.
    try { Highlight.clearForceHover?.(); } catch (_) {}

    // URL catturato PRIMA del click, così waitForPageSettle può accorgersi del cambio di route e aspettare la pagina nuova prima dello screenshot.
    const preActionUrl = location.href;
    submit({ userAction: aiNote, preActionUrl });
  }

  global.SN_SIDEBAR = { open, close, isOpen, ensureNotOverTarget };
  // Hook di test: esercita il ponte azioni-Filo (conferma + dispatch) senza passare dal modello. Stesso pattern di window.__filoDashActions.
  global.__filoSidebarTest = {
    runFiloAction, filoActionLabel,
    runPageAction, parseAssistantOutput,
    resolveImageEl, resolveLinkEl, resolveActionText,
    // Il riquadrino «Ha funzionato?» disegna e basta: chi decide se chiedere è `percorsoRaccoglibile`, ed è quella la porta che vale (#584).
    renderFeedbackPrompt, percorsoRaccoglibile,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
