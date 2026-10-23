// Sidebar Aiuto: agente vision multi-turn. Espansa mostra la conversazione, collassata la
// sola barra d'input; il click fuori collassa, il fuoco riapre, l'AI può chiedere collapse.
// Le azioni dell'utente diventano una riga di log, non un finto messaggio suo.

(function (global) {
  'use strict';

  const { ACTIONS, PROMPTS } = global.SN_CONST;
  const { MSG } = global.SN_MSG;
  const I18n = global.SN_I18N;
  const Highlight = global.SN_HIGHLIGHT;
  const Extract = global.SN_EXTRACT;
  const Popup = global.SN_POPUP;
  // #593 — la porta unica del contenuto esterno. Qui serve per due cose: la
  // nota di sistema resta una frase di Filo su una riga, e quello che viene
  // da fuori (risultati di ricerca, etichette della pagina) entra in
  // cronologia gia imbustato.
  const Esterno = global.SN_ESTERNO;
  const gestoVero = (e) => !!global.SN_FILO_UI?.gestoVero(e);

  let root = null;
  let stackEntry = null;
  // history per l'AI: { role, content, kind } — kind ∈ 'real'|'action'|null
  let history = [];
  // L'identità di questa conversazione nel filo (#974): nasce a ogni apertura, muore con la chiusura.
  let convFilo = '';
  let collapsed = false;
  // Se true, click fuori dal pannello NON lo collassa (es. AI ha richiesto chat aperta)
  let aiPrefersOpen = false;
  let docClickHandler = null;
  // Chiuso mentre Filo risponde (#1432): il pannello si nasconde invece di sparire, e la risposta resta da aprire.
  let nascosto = false;
  // Ridotto dall'utente (▾, clic fuori): la risposta che arriva non lo riapre da sé, la annuncia la barra laterale.
  let ridottoDallUtente = false;
  let nonLetta = false;
  let inVolo = 0;
  let voce = null;
  let statoVoce = 'pronto';
  let ascoltaCambi = null;

  // Telemetria sessione per la raccolta dei percorsi (pathsCollector.js), che
  // oggi è spenta: il riquadro con pollice su/giù non compare e niente esce.
  // Tutto qui resta locale finché l'utente non clicca pollice su/giù.
  // executedSteps contiene SOLO le azioni effettivamente eseguite dall'utente
  // (o auto-action reveal/hover andate a buon fine), niente value di fill.
  // rawUserMessages serve solo al "judge" lato server come riferimento.
  let session = null;
  let ripiegoDetto = false;
  let ripiegoDaDire = '';
  function diciRipiego() {
    if (!ripiegoDaDire) return;
    const riga = ripiegoDaDire;
    ripiegoDaDire = '';
    appendActionLog(riga)?.classList.add('sn-sidebar-log-intera');
  }
  function newSession() {
    return {
      initialUrl: '',
      executedSteps: [],
      rawUserMessages: [],
      feedbackShown: false,
      webSearchCount: 0,
      documentiCount: 0,
      // Per i contatori (#1467): l'esito dell'ultimo turno (null finché è in corso) e i passi, mai cosa c'era nella pagina.
      esito: null,
      passiDaSolo: 0,
      passiCliccati: 0,
      nonTrovati: 0,
      contata: false,
    };
  }
  // Una sessione si conta una volta, quando finisce: chiusa, o portata via dalla pagina che se ne va.
  function contaSessione() {
    const s = session;
    if (!s || s.contata) return;
    s.contata = true;
    try {
      Popup?.conta?.({
        misura: 'aiuto', esito: s.esito || 'chiusa_prima', passiDaSolo: s.passiDaSolo, passiCliccati: s.passiCliccati,
        nonTrovati: s.nonTrovati, documenti: s.documentiCount,
      });
    } catch (_) {}
  }
  try { window.addEventListener('pagehide', () => { if (isOpen()) contaSessione(); }); } catch (_) {}
  // Cap difensivo: il prompt dice «max 2» ma l'AI può insistere; le ricerche oltre il
  // limite si ignorano in silenzio.
  const MAX_WEB_SEARCHES_PER_SESSION = 2;
  // Ogni passo che l'Aiuto fa da solo è una chiamata pagata, e una pagina può chiederne all'infinito (#1049): oltre il
  // tetto di fila si ferma e chiede. Largo, perché aprire una a una trenta sezioni è un uso vero e costa solo un clic.
  const MAX_PASSI_DA_SOLO = 20;
  let passiDaSolo = 0;
  let continuaAperto = null;

  // Una pagina che si riscrive da capo porta via il pannello: staccato vale chiuso.
  function isOpen() { return !!(root && root.isConnected); }

  // `davvero`: anche con una risposta in arrivo (l'Aiuto spento in Preferenze).
  function close({ davvero = false } = {}) {
    if (!root) return;
    if (!davvero && inVolo > 0) { if (!nascosto) nascondi(); return; }
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
    convFilo = '';
    history = [];
    documenti = null;
    collapsed = false;
    aiPrefersOpen = false;
    contaSessione();
    session = null;
    nascosto = false;
    ridottoDallUtente = false;
    nonLetta = false;
    voce = null;
    statoVoce = 'pronto';
    cambiato();
  }

  function nascondi() {
    nascosto = true;
    Highlight.clear();
    try { Highlight.clearForceHover?.(); } catch (_) {}
    try { voce?.ferma(); } catch (_) {}
    root.classList.add('sn-sidebar-nascosta');
    cambiato();
  }

  // Già lì, ridotto o nascosto: «Aiuto» lo mostra intero, con la risposta arrivata nel frattempo.
  function mostra() {
    nascosto = false;
    root.classList.remove('sn-sidebar-nascosta');
    expand({ ai: false });
    try { root.querySelector('.sn-sidebar-input textarea')?.focus(); } catch (_) {}
    cambiato();
  }

  function open(context) {
    if (isOpen()) { mostra(); return; }
    if (root) close({ davvero: true });
    history = [];
    documenti = null;
    ripiegoDetto = false;
    ripiegoDaDire = '';
    collapsed = false;
    aiPrefersOpen = true;
    passiDaSolo = 0;
    continuaAperto = null;
    session = newSession();
    // Ogni apertura è una conversazione sua anche nel filo.
    convFilo = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    // Ciò che ha letto la conversazione di prima non vale per questa (#530).
    try { chrome.runtime.sendMessage({ type: MSG.FILO_AIUTO_NUOVO }).catch(() => {}); } catch (_) {}
    // L'URL "iniziale" è quello al momento dell'apertura della sidebar — anche
    // se l'utente è arrivato qui da altre pagine, contano solo le azioni che
    // farà DA QUI in avanti.
    session.initialUrl = location.href;
    // Aperta dal tasto destro su una scheda: una riga di storia non mostrata in chat dice
    // all'agente che la richiesta parte da lì.
    if (context && context.source === 'tab') {
      const ctxTitle = context.title || document.title || '';
      const ctxUrl = context.url || location.href;
      history.push({
        role: 'user',
        kind: 'action',
        // #593 — titolo e indirizzo della scheda li scrive il sito: la nota
        // dice cosa ha fatto l'utente (quella è la voce di Filo), la scheda va
        // nella busta. Prima entravano fra virgolette dentro «(Sistema: …)»,
        // cioè nel canale che le istruzioni presentano come fidato.
        content: PROMPTS.turnoAutomaticoAiuto({
          nota: 'l\'utente ha aperto Aiuto col tasto destro sulla scheda descritta qui sotto. Aspetta la sua domanda sulla scheda',
          dati: { scheda: { titolo: ctxTitle, url: ctxUrl } },
          perCronologia: true,
        }),
      });
    }
    root = document.createElement('div');
    root.className = 'sn-sidebar';
    global.SN_FILO_UI?.mark(root);
    // Fonte di invocazione osservabile per i test: c'è solo se aperta dal menu di una scheda.
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
    // Partecipa allo stacking dei popup: sopra quelli aperti prima, sotto quelli aperti dopo.
    // Con uno z-index fisso altissimo finiva sopra al modale feedback, aperto dopo di lei.
    stackEntry = Popup?.registerStack?.(root) || null;

    root.querySelector('.sn-sidebar-close').addEventListener('click', close);
    root.querySelector('.sn-sidebar-collapse').addEventListener('click', () => collapse({ ai: false }));
    makeDraggable(root.querySelector('.sn-sidebar-header'));
    const form = root.querySelector('.sn-sidebar-input');
    const ta = form.querySelector('textarea');
    // Parte solo da un tasto o un clic veri: l'invio del modulo lo fa anche il codice del sito (#592.6).
    const invia = () => {
      const text = ta.value.trim();
      if (!text) return;
      ta.value = '';
      submit({ userMessage: text });
    };
    form.addEventListener('submit', (e) => e.preventDefault());
    form.querySelector('button[type="submit"]').addEventListener('click', (e) => {
      e.preventDefault();
      if (gestoVero(e)) invia();
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (gestoVero(e)) invia();
      }
    });
    // Il tasto microfono: si parla, e la richiesta parte come con l'invio (o resta da correggere). Diretta, non dal
    // modulo: il suo invio non manda più niente (#592.6), e il microfono si accende già solo con un gesto vero.
    voce = global.SN_VOCE_CHAT?.collega({
      campo: ta, contenitore: form, prima: form.querySelector('button[type="submit"]'),
      invia, suStato: (s) => { if (!ta.isConnected) return; statoVoce = s; cambiato(); },
    }) || null;
    // Focus o tasto sull'input → riapri la chat. Ridotto dall'utente lo riapre solo un suo gesto sulla casella: il
    // microfono che ci scrive e ci rimette il cursore no, da qualunque icona l'abbia fermato (#1432).
    ta.addEventListener('focus', () => { if (!ridottoDallUtente) expand({ ai: false }); });
    ta.addEventListener('pointerdown', (e) => { if (e.isTrusted && collapsed) expand({ ai: false }); });
    ta.addEventListener('input', (e) => { if (collapsed && (e.isTrusted || !ridottoDallUtente)) expand({ ai: false }); });

    docClickHandler = (e) => {
      if (!root || collapsed || nascosto) return;
      if (root.contains(e.target)) return;
      if (aiPrefersOpen) return;
      collapse({ ai: false });
    };
    document.addEventListener('mousedown', docClickHandler, true);

    ta.focus();
    cambiato();
  }

  function expand({ ai = false } = {}) {
    if (!root) return;
    // La scelta dell'utente vince su quella del modello: la risposta resta da aprire, e la barra la annuncia.
    if (ai && (ridottoDallUtente || nascosto)) { aiPrefersOpen = true; return; }
    collapsed = false;
    ridottoDallUtente = false;
    root.classList.remove('sn-sidebar-collapsed');
    if (ai) aiPrefersOpen = true;
    if (!nascosto) nonLetta = false;
    cambiato();
  }

  function collapse({ ai = false } = {}) {
    if (!root) return;
    collapsed = true;
    if (!ai) ridottoDallUtente = true;
    root.classList.add('sn-sidebar-collapsed');
    if (ai) aiPrefersOpen = false;
    cambiato();
  }

  // ---------- Lo stato per la barra laterale (#1432) ----------

  function stato() {
    const visibile = isOpen() && !nascosto;
    return {
      pannello: !visibile ? 'chiuso' : collapsed ? 'ridotto' : 'aperto',
      voce: visibile ? statoVoce : 'pronto',
      nonLetta: isOpen() && nonLetta,
    };
  }

  function cambiato() {
    if (typeof ascoltaCambi !== 'function') return;
    try { ascoltaCambi(stato()); } catch (_) {}
  }

  // L'icona Aiuto (barra, riga del tasto destro): il clic fa quello che l'icona mostra, decisi dalla stessa regola.
  function passo(context) {
    const aspetto = global.SN_DISPOSIZIONE_ICONE?.aspettoAiuto?.(stato());
    const detta = aspetto ? aspetto.icona === 'mic' : (isOpen() && !nascosto && !collapsed);
    if (detta && voce) { voce.premi(); return; }
    open(context);
  }

  // ---------- Drag header ----------

  // Anche spostato, nell'angolo degli avvisi della barra (carte larghe al più 392px) il pannello sta sopra di
  // loro (--filo-avvisi-barra, #588.5); altrove resta dove l'hanno messo.
  const ANGOLO_PX = 400;
  const bassoPer = (px, left, w) => (left + w > window.innerWidth - ANGOLO_PX
    ? `max(${Math.round(px)}px, var(--filo-avvisi-barra, 0px))`
    : `${Math.round(px)}px`);

  // Drag dall'header. Mantiene l'ancoraggio al BOTTOM (la barra input resta
  // dov'è quando il pannello si collassa, anche dopo un drag manuale).
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
      root.style.bottom = bassoPer(startBottom, rect.left, rect.width);
      root.style.right = 'auto';
      root.style.top = 'auto';
      root.dataset.spostata = '1';
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
      root.style.bottom = bassoPer(newBottom, newLeft, w);
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  // Sposta la sidebar di lato se copre il rettangolo: cambia solo X, il bottom resta.
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

    // Mantieni l'ancoraggio bottom: se è già fissato in stile inline tengo quella
    // distanza, altrimenti uso il default 16px.
    const fissato = /^(?:max\()?(-?\d+(?:\.\d+)?)px/.exec(root.style.bottom || '');
    const currentBottom = fissato ? Number(fissato[1]) : 16;
    root.style.left = `${newLeft}px`;
    root.style.right = 'auto';
    root.style.top = 'auto';
    root.style.bottom = bassoPer(currentBottom, newLeft, w);
    root.dataset.spostata = '1';
  }

  function convEl() { return root && root.querySelector('.sn-sidebar-conv'); }

  // Ogni messaggio mostrato entra nel filo come parte della riga ripiegata di questa conversazione (#974): una
  // strada nuova che risponde ci passa da sé. Errori e note dell'interfaccia no (`nelFilo: false`).
  function nelFiloAiuto(role, text) {
    if (!convFilo || !String(text || '').trim()) return;
    try {
      chrome.runtime.sendMessage({
        type: MSG.FILO_CONVERSAZIONE_APP, app: 'aiuto', rif: convFilo, soggetto: document.title,
        messaggi: [{ role: role === 'user' ? 'user' : 'filo', text: String(text) }],
      }).catch(() => {});
    } catch (_) {}
  }

  // Filo ha detto qualcosa che l'utente, che ha ridotto o chiuso il pannello, non vede: la barra lo annuncia (#1432).
  function rispostaArrivata() {
    if (nonLetta || !(nascosto || (collapsed && ridottoDallUtente))) return;
    nonLetta = true;
    cambiato();
  }

  function appendChatMessage(role, text, { nelFilo = true } = {}) {
    if (nelFilo) nelFiloAiuto(role, text);
    const conv = convEl();
    if (!conv) return null;
    if (role === 'assistant') rispostaArrivata();
    const msg = document.createElement('div');
    msg.className = `sn-sidebar-msg sn-sidebar-msg-${role}`;
    // #418 — le risposte di Filo hanno la formattazione leggera di popup e chat della home;
    // il testo dell'utente resta letterale.
    if (role === 'assistant' && global.SN_MARKDOWN) {
      msg.innerHTML = global.SN_MARKDOWN.render(text);
    } else {
      msg.textContent = text;
    }
    conv.appendChild(msg);
    conv.scrollTop = conv.scrollHeight;
    if (role === 'assistant') diciRipiego();
    return msg;
  }

  // Il tasto che porta dove si toglie l'ostacolo, sotto il messaggio d'errore.
  // Dove si rimedia lo dice SN_CHAT_ERRORS, non un elenco di casi scritto qui.
  function mostraRimedio(afterEl, err) {
    const CE = globalThis.SN_CHAT_ERRORS;
    const pagina = CE && CE.rimedioPagina ? CE.rimedioPagina(err) : null;
    if (!afterEl || !pagina) return;
    const wrap = document.createElement('div');
    wrap.className = 'sn-sidebar-choices';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sn-sidebar-choice';
    btn.textContent = pagina.label;
    if (pagina.title) btn.title = pagina.title;
    btn.addEventListener('click', (e) => {
      if (!gestoVero(e)) return;
      try { chrome.runtime.sendMessage({ type: MSG.OPEN_URL, url: pagina.url }); } catch (_) {}
    });
    wrap.appendChild(btn);
    afterEl.insertAdjacentElement('afterend', wrap);
    const conv = convEl();
    if (conv) conv.scrollTop = conv.scrollHeight;
  }

  // Render dei bottoni "choices" sotto un messaggio dell'assistente.
  // Click → invia il prompt come messaggio utente e disattiva tutti i bottoni
  // (un solo percorso per turno).
  function renderChoices(afterEl, choices) {
    if (!afterEl || !choices || !choices.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'sn-sidebar-choices';
    choices.forEach((c) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sn-sidebar-choice';
      btn.textContent = c.label;
      btn.addEventListener('click', (e) => {
        if (!gestoVero(e) || wrap.classList.contains('sn-sidebar-choices-used')) return;
        wrap.classList.add('sn-sidebar-choices-used');
        wrap.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        submit({ userMessage: c.prompt, daScelta: true });
      });
      wrap.appendChild(btn);
    });
    afterEl.insertAdjacentElement('afterend', wrap);
    const conv = convEl();
    if (conv) conv.scrollTop = conv.scrollHeight;
  }

  // Non sono il reasoning vero, che non è disponibile: sono varie e specifiche quanto basta
  // a non sembrare uno spinner.
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

  // ---------- Popup feedback fine-task ----------
  //
  // Render del riquadrino "Ha funzionato?" che appare in chat quando l'AI
  // dichiara conclusa la sessione (status:"done") e l'utente ha eseguito
  // almeno un'azione, solo a raccolta accesa (RACCOLTA_ACCESA in
  // pathsCollector.js, oggi spenta). Le risposte partono via SAVE_PATH.
  function renderFeedbackPrompt() {
    const conv = convEl();
    if (!conv) return;
    const wrap = document.createElement('div');
    wrap.className = 'sn-sidebar-feedback';
    const q = document.createElement('div');
    q.className = 'sn-sidebar-feedback-q';
    q.textContent = 'Ha funzionato? Aiutami a migliorare:';
    wrap.appendChild(q);
    // La domanda da sola sembrava un parere privato, e invece il sì pubblica i passi dove li
    // legge chiunque: va detto qui, dove si sceglie, non solo nella pagina sulla privacy (#584).
    const nota = document.createElement('div');
    nota.className = 'sn-sidebar-feedback-nota';
    // La riga dice cosa succede, e dice il vero: dall'indirizzo e dai nomi dei
    // pulsanti Filo toglie quello che ha la forma di un dato personale, e un
    // modello guarda il resto e blocca tutto il percorso se ci riconosce una
    // persona. Prometteva «senza il tuo nome» quando quel modello, di fatto,
    // non vedeva niente di quello che stava per uscire (#584, terzo giro).
    const tutela = 'Filo toglie prima i dati personali e l’ora; se resta qualcosa che dice chi sei, non lo pubblica.';
    nota.textContent = `Rispondendo condividi i passi di questo percorso in una raccolta che chiunque può leggere. ${tutela}`;
    wrap.appendChild(nota);
    // Il riquadro sta nel documento del sito: i bottoni in uno Shadow DOM chiuso, che la pagina non trova né preme,
    // e il sì alla condivisione nel popup di Filo, che su un sito sta fuori dalla sua portata (#592.6).
    const row = document.createElement('div');
    row.className = 'sn-sidebar-feedback-row';
    const bottoni = row.attachShadow({ mode: 'closed' });
    const stile = document.createElement('style');
    stile.textContent = CSS_RISPOSTA;
    bottoni.appendChild(stile);

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

    // Un no nel popup chiude la domanda: niente parte, e non si ripropone.
    async function rispondi(riuscito) {
      disableAll();
      let ok = false;
      try {
        const Ui = global.SN_CONFIRM_UI;
        ok = !!Ui && await Ui.confirm({
          title: 'Condividi questo percorso?',
          text: `Filo condivide i passi di questo percorso con chi lo userà su questo sito. ${tutela}`,
          okLabel: 'Condividi',
          cancelLabel: 'Non condividere',
        });
      } catch (_) { ok = false; }
      if (!ok) { wrap.classList.add('sn-sidebar-feedback-dismissed'); return; }
      saveCurrentPath(riuscito).catch(() => {});
      thanks();
    }
    up.addEventListener('click', (e) => { if (gestoVero(e)) rispondi(true); });
    down.addEventListener('click', (e) => { if (gestoVero(e)) rispondi(false); });
    skip.addEventListener('click', (e) => {
      if (!gestoVero(e)) return;
      // Niente save, solo dismiss visivo.
      disableAll();
      wrap.classList.add('sn-sidebar-feedback-dismissed');
    });

    bottoni.appendChild(up);
    bottoni.appendChild(down);
    bottoni.appendChild(skip);
    wrap.appendChild(row);
    conv.appendChild(wrap);
    conv.scrollTop = conv.scrollHeight;
    rispostaAperta = { up, down, skip };
  }

  let rispostaAperta = null;
  const CSS_RISPOSTA = `
.sn-sidebar-feedback-btn {
  all: unset;
  cursor: pointer;
  padding: 5px 12px;
  background: var(--sn-bg);
  color: var(--sn-fg);
  border: 1px solid var(--sn-border);
  border-radius: 999px;
  font-size: 12px;
  transition: background calc(120ms * var(--sn-motion, 1)) ease, border-color calc(120ms * var(--sn-motion, 1)) ease;
}
.sn-sidebar-feedback-btn:hover {
  background: var(--sn-accent);
  color: #fff;
  border-color: var(--sn-accent);
}
.sn-sidebar-feedback-btn:disabled { cursor: default; opacity: 0.5; }
.sn-sidebar-feedback-btn:disabled:hover {
  background: var(--sn-bg);
  color: var(--sn-fg);
  border-color: var(--sn-border);
}
.sn-sidebar-feedback-skip {
  all: unset;
  cursor: pointer;
  margin-left: auto;
  padding: 0 6px;
  color: var(--sn-muted);
  font-size: 14px;
  line-height: 1;
}
.sn-sidebar-feedback-skip:hover { color: var(--sn-fg); }
.sn-sidebar-feedback-skip:disabled { opacity: 0.5; cursor: default; }
`;

  // Per gli spec: i bottoni stanno in un root chiuso, i locator non ci arrivano. Centro per un clic vero del mouse.
  function puntoRisposta(quale) {
    const b = rispostaAperta && rispostaAperta[quale];
    if (!b || !b.isConnected) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: b.disabled, label: b.textContent };
  }

  // Se da questa pagina un percorso partirebbe davvero lo sa solo il main, ed è la stessa
  // porta che usa la raccolta: una sola, o il riquadro promette ciò che non accade (#584).
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
          // Nessun identificativo del mittente da qui, neanche vuoto: il main allega il token
          // dell'installazione, che il server verifica (#585). Uno locale sarebbe autodichiarato.
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

  // Etichetta breve (≤4 parole) per descrivere un'azione utente: va al modello, quindi passa da
  // `nomeElemento`, che non legge mai il valore di un campo segreto (#810.7).
  function describeElementBriefly(el) {
    if (!el) return '';
    const raw = (() => { try { return Extract?.nomeElemento?.(el) || ''; } catch (_) { return ''; } })();
    if (!raw) return el.tagName.toLowerCase();
    return raw.split(' ').slice(0, 4).join(' ');
  }

  function parseAssistantOutput(text) {
    // Un involucro tagliato a metà (tetto, guasto) si mostra per quello che il modello aveva scritto, non come codice.
    const salvato = String(text || '').includes('{') ? globalThis.SN_CHAT_ERRORS?.campoDaJsonTagliato?.(text, ['text']) : null;
    const fallback = { display: (salvato ?? (text || '')).trim(), highlight: null, choices: [], status: 'done', collapse: false };
    if (!text) return fallback;
    const trimmed = text.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) return fallback;
    try {
      const obj = JSON.parse(trimmed.slice(start, end + 1));
      if (!obj || typeof obj !== 'object') return fallback;
      // Richiesta di ricerca web: scavalca il flusso normale, la processa submit() prima di
      // rendere la risposta in chat.
      if (obj.action === 'web_search' && typeof obj.query === 'string' && obj.query.trim()) {
        return { kind: 'web_search', query: obj.query.trim().slice(0, 300) };
      }
      // Output speciale: un documento dell'utente (#947.3). Anche detto come l'azione della chat della home, che
      // il modello conosce: da qui la cerca il main, col sì dato fuori dalla pagina.
      const cercaDoc = obj.action === 'documenti' ? obj
        : (obj.action === 'filo' && obj.filo && String(obj.filo.type || '').toUpperCase() === 'CERCA_DOCUMENTI' ? obj.filo : null);
      if (cercaDoc) {
        const cosa = cercaDoc.cosa ?? cercaDoc.query ?? cercaDoc.testo;
        if (typeof cosa === 'string' && cosa.trim()) {
          return {
            kind: 'documenti',
            cosa: cosa.trim().slice(0, 500),
            cartella: typeof cercaDoc.cartella === 'string' ? cercaDoc.cartella.trim().slice(0, 2000) : '',
            display: typeof obj.text === 'string' ? obj.text : '',
          };
        }
      }
      // Output speciale: comando della shell di Filo (icone della barra in alto).
      // Eseguito in autonomia, senza coinvolgere l'utente. "close" è escluso.
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
      // Non si esegue qui: passa dal registro dei livelli di sicurezza nel main (vedi submit()).
      if (obj.action === 'filo' && obj.filo && typeof obj.filo === 'object'
        && typeof obj.filo.type === 'string' && obj.filo.type.trim()) {
        return {
          kind: 'filo_action',
          filoAction: obj.filo,
          display: typeof obj.text === 'string' ? obj.text : '',
          status: obj.status === 'continue' ? 'continue' : 'done',
        };
      }
      // La esegue la sidebar con runPageAction(), più sotto.
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
      // Il documento da mostrare dopo una ricerca: il numero del candidato (o più d'uno, al massimo tre).
      const file = (Array.isArray(obj.file) ? obj.file : [obj.file])
        .map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
        .filter((n, i, a) => a.indexOf(n) === i).slice(0, 3);
      return {
        display: typeof obj.text === 'string' ? obj.text : '',
        highlight,
        choices,
        status,
        collapse: collapseFlag,
        file,
      };
    } catch (_) {
      return fallback;
    }
  }

  // Le azioni tipizzate non si eseguono qui: passano da executeFiloAction nel main, che
  // consulta il registro dei livelli. La sidebar non è un canale privilegiato.

  // Etichetta breve per la riga di log in chat (cosa Filo ha fatto/sta facendo).
  function filoActionLabel(action) {
    const type = String(action && action.type || '').toUpperCase();
    if (type === 'INVIA_FEEDBACK') return 'invio feedback agli sviluppatori';
    return `azione Filo: ${type.toLowerCase().replace(/_/g, ' ')}`;
  }

  // #590 — Le aperture chieste da qui, per id: se la pagina aperta finisce più tardi su un sito
  // della lista, il main lo dice con APERTURA_FERMATA e la riga «fatto» diventa il blocco.
  const apertureSeguite = new Map();

  function rigaBloccata(label, { host, reason } = {}) {
    return `${label}: ${host || 'il sito'} è fra i siti ${reason === 'lists' ? 'di pubblicità e tracciamento' : 'bloccati'}`;
  }

  // Il perché del blocco sta in fondo alla riga: va a capo invece di finire nei puntini.
  function scriviRigaBloccata(riga, label, dati) {
    if (!riga) return null;
    riga.textContent = '· ' + rigaBloccata(label, dati);
    riga.classList.add('sn-sidebar-log-intera');
    return riga;
  }

  // La notifica se ne va in pochi secondi, il bottone resta. Sta nel DOM della pagina, e un sito uscito nel
  // frattempo dalla lista si apre subito: va avanti solo per il clic dell'utente (#592.16).
  function bottoneApriComunque(dopo, { host, url } = {}) {
    if (!dopo || !/^https?:\/\//i.test(String(url || ''))) return;
    const wrap = document.createElement('div');
    wrap.className = 'sn-sidebar-choices';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sn-sidebar-choice';
    btn.textContent = `Apri comunque ${host || url}`;
    btn.title = 'Filo ti chiede conferma nella notifica «Sito bloccato»';
    btn.addEventListener('click', (e) => {
      if (!gestoVero(e)) return;
      Promise.resolve().then(() => chrome.runtime.sendMessage({ type: MSG.APRI_COMUNQUE, url })).catch(() => {});
    });
    wrap.appendChild(btn);
    dopo.insertAdjacentElement('afterend', wrap);
    const conv = convEl();
    if (conv) conv.scrollTop = conv.scrollHeight;
  }

  // L'esito di un'azione di Filo nel diario, uguale dopo l'invio diretto e dopo la conferma.
  function scriviEsito(label, action, r) {
    const done = !!(r && r.executed);
    const o = (r && r.output) || null;
    if (!done && o && o.blocked === 'site') {
      bottoneApriComunque(scriviRigaBloccata(appendActionLog(''), label, o), o);
      return false;
    }
    const riga = appendActionLog(esitoAzione(label, done, r));
    if (done && riga && action && action._callId) {
      apertureSeguite.set(action._callId, { riga, label });
      // Il main segue l'apertura per un minuto: oltre, un avviso non arriva più.
      setTimeout(() => apertureSeguite.delete(action._callId), 60_000);
    }
    return done;
  }

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== MSG.APERTURA_FERMATA) return;
      const seguita = apertureSeguite.get(msg.callId);
      if (!seguita) return;
      apertureSeguite.delete(msg.callId);
      bottoneApriComunque(scriviRigaBloccata(seguita.riga, seguita.label, msg), msg);
    });
  } catch (_) {}

  function logFermata(frase) {
    const el = appendActionLog(frase);
    if (el) el.classList.add('sn-sidebar-log-fermata');
  }

  // Un'uscita fermata (#810): oltre alla riga, l'assistente deve saperlo, come per la ricerca fermata. Una volta
  // per domanda con un giro in più, perché lo dica; dopo resta solo nella storia, così un modello che insiste non gira.
  const NOTA_FERMATA = 'l\'azione che avevi chiesto NON è partita, è stata fermata: avrebbe portato fuori un codice, una password, '
    + 'una chiave o dati bancari letti fuori dalla conversazione, e Filo non li lascia uscire a nessun livello. Non riprovarla '
    + 'in un\'altra forma; dillo all\'utente in una riga (se vuole la fa lui a mano)';
  // Un collegamento della risposta fermato al clic: la riga, e la nota nella storia per la domanda dopo. Nessun giro in
  // più, perché l'ha chiesto l'utente e non il modello.
  const NOTA_COLLEGAMENTO = 'l\'utente ha cliccato un collegamento della tua risposta, ma non si è aperto: avrebbe portato '
    + 'fuori un codice, una password, una chiave o dati bancari letti fuori dalla conversazione, e Filo non li lascia uscire '
    + 'a nessun livello. Non riproporlo in un\'altra forma';
  function notaFermata(frase) {
    logFermata(frase);
    history.push({ role: 'user', content: PROMPTS.turnoAutomaticoAiuto({ nota: NOTA_COLLEGAMENTO, perCronologia: true }), kind: 'action' });
  }
  let fermataDetta = false;
  function fermata(frase) {
    logFermata(frase);
    if (fermataDetta) {
      history.push({ role: 'user', content: PROMPTS.turnoAutomaticoAiuto({ nota: NOTA_FERMATA, perCronologia: true }), kind: 'action' });
      return;
    }
    fermataDetta = true;
    setTimeout(() => submit({
      userAction: `${NOTA_FERMATA}. Procedi ora con il JSON normale (highlight / choices / text / status) usando solo ciò che già sai`,
      preActionUrl: location.href,
    }), 50);
  }

  // Quello che l'utente ha scritto qui: il main lascia uscire un codice scritto da lui (#810).
  // Il testo dietro una scelta lo scrive il modello, e una pagina ostile può dettarlo: non conta.
  function paroleUtente() {
    return history.filter((h) => h && h.kind === 'real' && !h.daScelta).map((h) => String(h.content || ''));
  }

  // La frase della porta delle uscite se il testo per un campo della pagina porterebbe fuori un segreto, se no ''.
  // Senza una risposta della porta il testo non esce (#1505): un errore vale come fermato.
  const CAMPO_SENZA_PORTA = 'non ho scritto nel campo: il controllo dei dati in uscita non ha funzionato, e senza quel controllo non lascio uscire niente';
  async function campoFermato(testo) {
    if (!String(testo || '').trim()) return '';
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.CONTROLLA_CAMPO, testo: String(testo), parole: paroleUtente() });
      if (!r || r.ok !== true) return CAMPO_SENZA_PORTA;
      return r.blocca ? String(r.frase || CAMPO_SENZA_PORTA) : '';
    } catch (_) { return CAMPO_SENZA_PORTA; }
  }

  async function runFiloAction(action, { etichetta = '' } = {}) {
    const label = etichetta || filoActionLabel(action);
    if (action && String(action.type || '').toUpperCase() === 'NAVIGA' && !action._callId) {
      action._callId = `assistente-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }
    let res = null;
    try {
      res = await chrome.runtime.sendMessage({ type: MSG.FILO_RUN_ACTION, action, parole: paroleUtente() });
    } catch (_) {}
    if (!res || !res.ok) { appendActionLog(`${label}: non riuscita`); return false; }
    // Un segreto che sarebbe uscito: la riga dice cosa è stato fermato e da dove veniva.
    if (res.output && res.output.blocked === 'segreto') {
      fermata(res.output.frase || `${label}: fermata`);
      return false;
    }

    // Livello ≥ 2: il main non ha eseguito e manda la spiegazione per il popup; solo dopo l'OK
    // l'azione riparte, riclassificata di nuovo nel main.
    if (res.needsConfirm) {
      const Ui = global.SN_CONFIRM_UI;
      const opts = { title: 'Filo chiede conferma', text: res.describe || '', parti: res.parti, avviso: res.avviso || '' };
      let ok = false;
      try {
        ok = Ui
          ? await (res.needsConfirm >= 3 ? Ui.confirmTyped(opts) : Ui.confirm(opts))
          : global.confirm(opts.text);
      } catch (_) { ok = false; }
      if (!ok) {
        try { Promise.resolve(chrome.runtime.sendMessage({ type: MSG.FILO_CONFIRM_RIFIUTATA, action })).catch(() => {}); } catch (_) {}
        appendActionLog(`${label}: annullata`);
        return false;
      }
      let c = null;
      try {
        c = await chrome.runtime.sendMessage({ type: MSG.FILO_CONFIRM_ACTION, action, assistente: true, parole: paroleUtente() });
      } catch (_) {}
      if (c && c.output && c.output.blocked === 'segreto') {
        fermata(c.output.frase || `${label}: fermata`);
        return false;
      }
      return scriviEsito(label, action, c);
    }

    // #590 — un blocco muto sembra un guasto: la lista dei siti bloccati si dice.
    return scriviEsito(label, action, res);
  }

  // ---------- Documenti dell'utente (#947.3) ----------
  // La ricerca la fa il main, su un sito solo dopo il sì nel popup di Filo sopra la scheda. Qui arrivano nomi,
  // cartelle coi nomi di Filo e chiavi a caso: le chiavi restano in questo mondo, nel documento del sito c'è il bottone.
  const MAX_DOCUMENTI_PER_SESSIONE = 4;
  const NOTA_DOCUMENTI = 'ho cercato fra i documenti dell\'utente come avevi chiesto; i candidati te li rimando qui sotto come '
    + 'contenuto esterno, fra le marcature. Procedi ora con il JSON normale e, se uno è quello giusto, aggiungi "file": <il suo numero>';
  let documenti = null;
  let letturaDocumenti = null;

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== MSG.AIUTO_DOCUMENTI_AVANZAMENTO || !letturaDocumenti) return;
      letturaDocumenti(Number(msg.fatti) || 0, Number(msg.totali) || 0);
    });
  } catch (_) {}

  const breve = (t, max) => { const s = String(t || ''); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };

  // La riga che dice quanti documenti nuovi sta leggendo l'indice, con «Ferma»: compare solo se la lettura c'è.
  function rigaLettura() {
    let riga = null;
    let testo = null;
    const aggiorna = (fatti, totali) => {
      if (!totali) return;
      if (!riga) {
        riga = appendActionLog('');
        if (!riga) return;
        riga.classList.add('sn-sidebar-log-intera');
        testo = document.createElement('span');
        const ferma = document.createElement('button');
        ferma.type = 'button';
        ferma.className = 'sn-sidebar-log-ferma';
        ferma.textContent = 'Ferma';
        ferma.title = 'Cerca solo fra quelli già letti';
        ferma.addEventListener('click', (e) => {
          if (!gestoVero(e)) return;
          ferma.disabled = true;
          Promise.resolve().then(() => chrome.runtime.sendMessage({ type: MSG.AIUTO_DOCUMENTI_FERMA })).catch(() => {});
        });
        riga.textContent = '· ';
        riga.append(testo, ' ', ferma);
      }
      testo.textContent = `leggo i documenti nuovi: ${Math.min(fatti, totali)} di ${totali}`;
    };
    return { aggiorna, togli: () => { if (riga) riga.remove(); } };
  }

  // La riga dice cosa cerca; finita la ricerca, la stessa riga dice com'è andata.
  async function cercaDocumenti(p) {
    const riga = appendActionLog(`cerco fra i tuoi documenti «${breve(p.cosa, 80)}»`);
    const lettura = rigaLettura();
    letturaDocumenti = lettura.aggiorna;
    let r = null;
    try {
      r = await chrome.runtime.sendMessage({ type: MSG.AIUTO_CERCA_DOCUMENTI, cosa: p.cosa, cartella: p.cartella || '' });
    } catch (_) { r = null; }
    if (letturaDocumenti === lettura.aggiorna) letturaDocumenti = null;
    lettura.togli();
    const esito = !r || !r.ok
      ? `ricerca fra i documenti ${r && r.annullata ? 'annullata' : 'non riuscita'}`
      : (r.cartellaMancante ? `cartella non trovata: ${breve(r.cartellaMancante, 80)}`
        : r.cartellaDiRete ? `cartella su un altro computer, non ci cerco: ${breve(r.cartellaDiRete, 80)}`
        : `${esitoDocumenti(r)} fra i tuoi documenti «${breve(p.cosa, 60)}»${r.fermata ? ', fermata da te' : ''}`);
    const fatta = riga || appendActionLog('');
    if (fatta) {
      fatta.textContent = `· ${esito}`;
      fatta.classList.add('sn-sidebar-log-intera');
    }
    return r;
  }

  function esitoDocumenti(r) {
    const n = Array.isArray(r.candidati) ? r.candidati.length : 0;
    return n ? (n === 1 ? 'uno trovato' : `${n} trovati`) : 'nessuno trovato';
  }

  // I documenti da mostrare sotto la risposta: quelli che indica col numero; se non ne indica, quelli che nomina.
  function fileDaMostrare(parsed, dopoDocumenti) {
    const candidati = (documenti && documenti.candidati) || [];
    if (!candidati.length) return [];
    if (parsed.file && parsed.file.length) return parsed.file.map((n) => candidati.find((c) => c.n === n)).filter(Boolean);
    if (!dopoDocumenti) return [];
    const detto = String(parsed.display || '').toLowerCase();
    return candidati.filter((c) => c.nome && detto.includes(String(c.nome).toLowerCase())).slice(0, 3);
  }

  async function azioneFile(btn, type, c, fallita) {
    let r = null;
    try { r = await chrome.runtime.sendMessage({ type, chiave: c.chiave }); } catch (_) { r = null; }
    if (r && r.ok) return true;
    const frase = (r && r.frase) || fallita;
    btn.title = frase;
    appendActionLog(`${breve(c.nome, 60)}: ${frase}`)?.classList.add('sn-sidebar-log-intera');
    return false;
  }

  // Il tasto destro sul bottone apre il menu di Filo con queste voci (content.js, fileSotto).
  const azioniDelFile = new WeakMap();
  function fileSotto(el) {
    if (!root || !el || !root.contains(el)) return null;
    const btn = el.closest ? el.closest('.sn-sidebar-file') : null;
    return (btn && azioniDelFile.get(btn)) || null;
  }

  // Un clic lo apre col programma del sistema; trascinato, è il file vero (la pagina lo riceve come da una cartella,
  // per esempio nel campo per caricarlo); col tasto destro, anche «Mostra nella cartella».
  function bottoneFile(c) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sn-sidebar-file';
    btn.draggable = true;
    const icona = document.createElement('span');
    icona.className = 'sn-sidebar-file-icona';
    icona.setAttribute('aria-hidden', 'true');
    const ICONE = global.SN_ICONS;
    if (ICONE && typeof ICONE.readDocument === 'function') icona.innerHTML = ICONE.readDocument(15);
    const nome = document.createElement('span');
    nome.className = 'sn-sidebar-file-nome';
    nome.textContent = c.nome || 'Documento';
    btn.append(icona, nome);
    if (c.dove) {
      const dove = document.createElement('span');
      dove.className = 'sn-sidebar-file-dove';
      dove.textContent = c.dove;
      btn.appendChild(dove);
    }
    btn.title = 'Apri, o trascinalo nella pagina';
    btn.addEventListener('click', (e) => {
      if (!gestoVero(e)) return;
      azioneFile(btn, MSG.AIUTO_APRI_FILE, c, 'Il file non si è aperto');
    });
    btn.addEventListener('dragstart', (e) => {
      // Il trascinamento lo fa il sistema col file vero: quello della pagina porterebbe solo il testo del bottone.
      e.preventDefault();
      if (!gestoVero(e)) return;
      azioneFile(btn, MSG.AIUTO_TRASCINA_FILE, c, 'Non sono riuscito a prendere il file');
    });
    azioniDelFile.set(btn, [
      { label: 'Apri', fn: () => azioneFile(btn, MSG.AIUTO_APRI_FILE, c, 'Il file non si è aperto') },
      { label: 'Mostra nella cartella', fn: () => azioneFile(btn, MSG.AIUTO_MOSTRA_FILE, c, 'La cartella non si è aperta') },
    ]);
    return btn;
  }

  function mostraFile(afterEl, candidati) {
    if (!afterEl || !candidati.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'sn-sidebar-files';
    for (const c of candidati) wrap.appendChild(bottoneFile(c));
    afterEl.insertAdjacentElement('afterend', wrap);
    const conv = convEl();
    if (conv) conv.scrollTop = conv.scrollHeight;
  }

  // Un rifiuto spiegato dal main (uno stile oltre il tetto) arriva all'utente col
  // suo perché, come nel diario della chat: «non riuscita» e basta non dice cosa
  // cambiare (#592).
  function esitoAzione(label, done, r) {
    const o = r && r.output;
    // Una preferenza cambiata si dice col suo nome e il valore («Filo spento su docs.google.com», #843).
    if (done) return o && typeof o.etichetta === 'string' && o.etichetta.trim() ? o.etichetta.trim() : `${label}: fatto`;
    const perche = o && (o.rifiuto || o.invariato) && typeof o.error === 'string' ? o.error.trim() : '';
    return perche ? `${label}: non applicata, ${perche}` : `${label}: non riuscita`;
  }

  // ---------- Azioni SULLA PAGINA (parità col menu tasto destro) ----------
  //
  // L'agente "Aiuto" può eseguire le stesse azioni del menu contestuale su
  // testo/immagine/link. A differenza delle azioni tipizzate di Filo (sopra),
  // queste vivono nel content script (SN_ACTIONS in src/content/actions.js,
  // SN_TTS in tts.js) e operano sull'elemento o sulla selezione corrente. Ognuna
  // dichiara solo il suo COSTO: se parte, chiede o no lo decide il main con la
  // stessa regola del dispatch (#530, MSG.FILO_DECIDI_PAGINA). Uscire verso
  // l'esterno (cercare, condividere) costa 2; il resto resta sul computer e costa 1.
  //
  // SN_ACTIONS/SN_TTS sono caricati DOPO sidebar.js (vedi i preload), quindi li
  // risolviamo al volo dentro la funzione, non al top dell'IIFE.
  const PAGE_ACTIONS = {
    // testo / selezione
    copy:         { target: 'text',  costo: 1, label: 'copia testo' },
    cut:          { target: 'text',  costo: 1, label: 'taglia testo' },
    search_text:  { target: 'text',  costo: 2, label: 'cerca testo sul web', viaFilo: true },
    read_aloud:   { target: 'text',  costo: 1, label: 'leggi ad alta voce' },
    stop_reading: { target: 'none',  costo: 1, label: 'ferma la lettura' },
    edit_text:    { target: 'text',  costo: 1, label: 'modifica testo' },
    // immagini
    copy_image:      { target: 'image', costo: 1, label: 'copia immagine' },
    save_image:      { target: 'image', costo: 1, label: 'salva immagine' },
    copy_image_link: { target: 'image', costo: 1, label: 'copia link immagine' },
    search_image:    { target: 'image', costo: 2, label: 'cerca immagine sul web', viaFilo: true },
    // `viaFilo`: passa da NAVIGA, che il dispatch decide da sé (una ricerca porta `cerca` e costa 2 anche lì).
    // Chiedere anche qui farebbe due domande per la stessa uscita.
    open_link:  { target: 'link', costo: 1, label: 'apri link in nuova scheda', viaFilo: true },
    copy_link:  { target: 'link', costo: 1, label: 'copia link' },
    save_link:  { target: 'link', costo: 1, label: 'salva link per dopo' },
    share_link: { target: 'link', costo: 2, label: 'condividi link' },
    // la pagina intera: la stessa strada di «Salva per dopo» del menu, che poi chiude la scheda (niente passo dopo).
    save_page: { target: 'none', costo: 1, label: 'salva la pagina per dopo', chiude: true },
  };

  // Come Alt+S: le pagine di Filo non si mettono da parte, tranne quella d'errore, che salva il sito non caricato.
  function paginaDaSalvare() {
    try { return location.protocol !== 'filo:' || location.href.startsWith('filo://error/'); } catch (_) { return false; }
  }

  // Testo bersaglio: quello fornito dall'agente, altrimenti la selezione corrente.
  function resolveActionText(page) {
    const provided = String(page.text ?? page.testo ?? page.query ?? page.selection ?? '').trim();
    if (provided) return provided;
    try {
      if (Extract?.selezioneSegreta?.()) return '';
      return (window.getSelection?.()?.toString() || '').trim();
    } catch (_) { return ''; }
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
    let best = null; let bestArea = 0;
    for (const im of imgs) {
      const r = im.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea && r.width > 32 && r.height > 32) { best = im; bestArea = area; }
    }
    return best;
  }

  // Link bersaglio: per selettore (anche su un figlio del link), per URL. Collegamento e indirizzo come li vede il menu.
  function resolveLinkEl(page) {
    const { SELETTORE_COLLEGAMENTO: LINK, indirizzoDelLink: indirizzo } = global.SN_ACTIONS;
    const sel = String(page.selector ?? page.css ?? '').trim();
    if (sel) {
      try {
        const el = document.querySelector(sel);
        const a = el && (el.closest?.(LINK) || el.querySelector?.(LINK));
        if (a && indirizzo(a)) return a;
      } catch (_) {}
    }
    const wanted = String(page.url ?? page.href ?? '').trim();
    if (wanted) {
      const links = Array.from(document.querySelectorAll(LINK));
      const hit = links.find((a) => indirizzo(a) === wanted) || links.find((a) => indirizzo(a).includes(wanted));
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
    } else if (page.op === 'save_page' && !paginaDaSalvare()) {
      appendActionLog(`${label}: le pagine di Filo non si salvano per dopo`);
      return false;
    }

    // Senza risposta dal main si chiede: il caso prudente.
    if (!spec.viaFilo) {
      let d = null;
      try { d = await chrome.runtime.sendMessage({ type: MSG.FILO_DECIDI_PAGINA, costo: spec.costo, campo: 'web' }); } catch (_) {}
      const risposta = d && d.ok ? d.risposta : 'chiede';
      if (risposta === 'no') { appendActionLog(`${label}: non applicata, ${(d && d.no) || 'Filo non la fa da solo'}`); return false; }
      if (risposta !== 'si') {
        const Ui = global.SN_CONFIRM_UI;
        // Il testo intero e nel suo riquadro: si conferma quello che si legge, e il
        // testo non può chiudere le virgolette e parlare come Filo (#592.7).
        let detail = '';
        if (spec.target === 'text') detail = text;
        else if (imgEl) detail = imgEl.currentSrc || imgEl.src || '';
        else if (linkEl) detail = Actions.indirizzoDelLink(linkEl);
        const perche = d && d.perche ? `\n\n${d.perche}` : '';
        const parti = [...(detail ? [`${label}:`, { citazione: detail, nuda: spec.target !== 'text' }] : [label]), ...(perche ? [perche] : [])];
        const opts = { title: 'Filo chiede conferma', text: `${label}${detail ? `:\n“${detail}”` : ''}${perche}`, parti };
        let ok = false;
        try {
          ok = Ui ? await (d && d.digita ? Ui.confirmTyped(opts) : Ui.confirm(opts)) : global.confirm(opts.text);
        } catch (_) { ok = false; }
        if (d && d.conferma) {
          try { global.SN_POPUP?.conta?.({ misura: 'conferma', chiave: String(d.conferma), esito: ok ? 'approvata' : 'rifiutata' }); } catch (_) {}
        }
        if (!ok) { appendActionLog(`${label}: annullata`); return false; }
      }
    }

    try {
      switch (page.op) {
        case 'copy': Actions?.copyToClipboard(text); break;
        case 'cut': Actions?.cutSelection(); break;
        case 'search_text': return await runFiloAction({ type: 'NAVIGA', url: Actions.searchUrlFor(text), cerca: text }, { etichetta: label });
        case 'read_aloud': await Tts?.readAloud(text); break;
        case 'stop_reading': Tts?.stopReading(); break;
        case 'edit_text': global.SN_EDITBOX?.openEditBox(text); break;
        case 'copy_image': await Actions?.copyImage(imgEl); break;
        case 'save_image': Actions?.downloadImage(imgEl); break;
        case 'copy_image_link': Actions?.copyUrlToClipboard(imgEl.currentSrc || imgEl.src); break;
        case 'search_image': return await runFiloAction({
          type: 'NAVIGA', url: Actions.imageSearchUrlFor(imgEl), cerca: imgEl.currentSrc || imgEl.src || 'immagine',
        }, { etichetta: label });
        case 'open_link': {
          // "Apri in nuova scheda" è un'azione di sistema già registrata: la
          // instradiamo via il ponte di #192.1 (NAVIGA → TabManager del main).
          const url = Actions.indirizzoDelLink(linkEl) || String(page.url ?? page.href ?? '').trim();
          return await runFiloAction({ type: 'NAVIGA', url });
        }
        case 'copy_link': Actions?.copyUrlToClipboard(Actions.indirizzoDelLink(linkEl)); break;
        case 'save_link': await Actions?.saveLink(linkEl); break;
        case 'save_page': {
          if (!(await Actions?.savePage())) { appendActionLog(`${label}: non riuscita`); return false; }
          appendActionLog('pagina salvata in «Aperti per dopo»: chiudo la scheda');
          return true;
        }
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

  function buildPayload(userMessage, userAction, esterno) {
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
      // #593 — il contenuto esterno viaggia SEPARATO dalla nota di sistema, e
      // grezzo: a imbustarlo e' il main, quando compone il messaggio. Qui non
      // si manda una busta gia' fatta, cosi' il punto in cui il testo di
      // terzi diventa prompt resta uno solo.
      esterno: esterno || undefined,
      history: aiHistory,
      screenshot,
      outline,
      viewport,
    };
  }

  // #711 — «questa foto è fatta con l'AI?» chiesto qui deve avere la stessa lettura del
  // tasto destro: si leggono le etichette delle immagini che l'utente ha davanti, dalle
  // più grandi. Oltre il tetto il modello sa quante ne sono rimaste fuori.
  const MAX_IMMAGINI_ORIGINE = 12;
  // Un'immagine che non arriva non deve tenere ferma la risposta: conta come non letta.
  const ATTESA_ORIGINE_MS = 3000;
  // Un'immagine letta resta letta: le domande dopo non la riscaricano.
  const origineLetta = new Map();
  function immaginiVisibili() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const viste = new Set();
    const out = [];
    for (const im of Array.from(document.images || [])) {
      if (root && root.contains(im)) continue;
      const src = im.currentSrc || im.src;
      if (!src || viste.has(src) || !im.complete || !im.naturalWidth) continue;
      const r = im.getBoundingClientRect();
      if (r.width < 48 || r.height < 48) continue;
      if (r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) continue;
      viste.add(src);
      out.push({ im, src, r, area: r.width * r.height });
    }
    return out.sort((a, b) => b.area - a.area);
  }
  async function origineImmaginiVisibili() {
    const Actions = global.SN_ACTIONS;
    if (!Actions?.leggiOrigine || !Actions?.scaricaImmagine) return null;
    const tutte = immaginiVisibili();
    if (!tutte.length) return null;
    const esiti = await Promise.all(tutte.slice(0, MAX_IMMAGINI_ORIGINE).map(async ({ im, src, r }, i) => {
      try {
        let lettura = origineLetta.get(src);
        if (!lettura) {
          lettura = (async () => Actions.leggiOrigine(await Actions.scaricaImmagine(src, im)))();
          lettura.then((p) => { if (!p || !p.ok || p.firmatario === 'non_verificato') origineLetta.delete(src); }, () => origineLetta.delete(src));
          if (origineLetta.size >= 500) origineLetta.delete(origineLetta.keys().next().value);
          origineLetta.set(src, lettura);
        }
        const p = await Promise.race([
          lettura,
          new Promise((ok) => setTimeout(() => ok(null), ATTESA_ORIGINE_MS)),
        ]);
        if (!p || !p.ok) return null;
        return {
          n: i + 1,
          alt: String(im.alt || im.title || '').slice(0, 120),
          larghezza: Math.round(r.width),
          altezza: Math.round(r.height),
          frase: p.frase || '',
        };
      } catch (_) { return null; }
    }));
    const lette = esiti.filter(Boolean);
    return { visibili: tutte.length, controllate: lette.length, esiti: lette.filter((e) => e.frase) };
  }

  // I campi segreti leggibili a schermo arrivano al modello coperti dai puntini (#810.7): misurati prima e dopo lo
  // scatto, se la pagina scorre nel frattempo; quelli dei riquadri e dei componenti chiusi li misura il main, che
  // con campi da coprire manda la foto piena: coperta prima di diventare leggera, il JPEG non sparge le cifre attorno.
  // Se coprirli non riesce, l'immagine non parte.
  async function captureScreenshot() {
    try {
      const prima = Extract.campiSegretiInVista();
      const r = await chrome.runtime.sendMessage({
        type: MSG.CAPTURE_VISIBLE_TAB, leggera: true, campiSegreti: true, campiNellaPagina: prima.length,
      });
      if (!r?.ok || !r.dataUrl) return null;
      const campi = prima.concat(Array.isArray(r.campi) ? r.campi : [], Extract.campiSegretiInVista());
      if (!campi.length && !r.fattore) return r.dataUrl;
      // `fattore` e `qualita` dal main quando la foto è arrivata piena: si rimpicciolisce come farebbe lui.
      return await Extract.fotoCoperta(r.dataUrl, campi, r);
    } catch (_) {}
    return null;
  }

  // Le SPA cambiano contenuto e URL in modo asincrono: si esce quando l'URL è cambiato e il
  // DOM è quieto da `quietMs`, oppure dopo `maxMs`.
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

  // Il passo che non parte resta nella cronologia con la fermata, così il modello sa a che punto era anche se l'utente
  // poi scrive altro; «Continua» sta nel documento del sito, e lo preme solo un gesto vero (#592.6).
  function fermaPassiDaSolo(nota, dati, dopoDocumenti) {
    if (continuaAperto) return;
    const fermo = `Poi Filo ti ha fermato: avevi fatto ${MAX_PASSI_DA_SOLO} passi da solo di fila senza che l'utente toccasse niente, `
      + 'e il passo dopo parte solo se te lo chiede lui';
    const prima = String(nota || '').replace(/[\s.]+$/, '');
    history.push({
      role: 'user',
      kind: 'action',
      content: PROMPTS.turnoAutomaticoAiuto({ nota: prima ? `${prima}. ${fermo}` : fermo, dati, perCronologia: true }),
    });
    const riga = appendActionLog('');
    if (!riga) return;
    riga.classList.add('sn-sidebar-log-intera', 'sn-sidebar-log-passi');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sn-sidebar-log-ferma';
    btn.textContent = 'Continua';
    btn.title = `Altri ${MAX_PASSI_DA_SOLO} passi`;
    btn.addEventListener('click', (e) => {
      if (!gestoVero(e) || btn.disabled) return;
      btn.disabled = true;
      if (continuaAperto === btn) continuaAperto = null;
      submit({ userAction: 'l\'utente ha chiesto di proseguire da dove ti eri fermato', preActionUrl: location.href, daGesto: true, dopoDocumenti });
    });
    riga.append(`mi sono fermato dopo ${MAX_PASSI_DA_SOLO} passi fatti da solo `, btn);
    continuaAperto = btn;
    rispostaArrivata();
    expand({ ai: true });
  }

  // submit({ userMessage }) — invio iniziale o domanda dell'utente
  // submit({ userAction }) — proseguimento automatico dopo un'azione utente
  // submit({ userAction, esterno }) — idem, quando la nota deve nominare
  //   qualcosa che viene da fuori: i risultati di una ricerca web, l'etichetta
  //   di un elemento della pagina. Quella roba NON entra nella nota (#593):
  //   viaggia qui e finisce imbustata, dichiarata dati e recintata.
  // Chiudere a metà di un turno nasconde il pannello invece di buttare la risposta; i passi che l'Aiuto farebbe da
  // solo, chiuso, non partono.
  async function submit(op = {}) {
    if (!root || (nascosto && !op.userMessage)) return;
    inVolo += 1;
    try { await turno(op); } finally {
      inVolo -= 1;
      // Chiuso mentre pensava e niente da leggere: allora era chiuso davvero.
      if (nascosto && !inVolo && !nonLetta) close({ davvero: true });
    }
  }

  async function turno({ userMessage = '', userAction = '', esterno = null, preActionUrl = '', daScelta = false, dopoDocumenti = false, daGesto = false } = {}) {
    if (!root) return;
    // Il contatore lo azzera solo un gesto vero: scrivere, una scelta, il clic sul passo indicato, «Continua».
    if (userMessage || daGesto) {
      passiDaSolo = 0;
      if (continuaAperto) { continuaAperto.disabled = true; continuaAperto = null; }
    } else if (++passiDaSolo > MAX_PASSI_DA_SOLO) {
      if (session) session.esito = 'tetto_passi';
      fermaPassiDaSolo(userAction, esterno, dopoDocumenti);
      return;
    } else if (session) {
      session.passiDaSolo += 1;
    }
    if (session) session.esito = null;
    const wasCollapsed = collapsed;
    // Si espande solo se l'utente ha scritto: sui proseguimenti automatici il box non deve
    // riaprirsi mentre il modello elabora.
    if (userMessage) expand({ ai: false });

    if (userMessage) {
      fermataDetta = false;
      appendChatMessage('user', userMessage);
      history.push({ role: 'user', content: userMessage, kind: 'real', ...(daScelta ? { daScelta: true } : {}) });
      // Salva il messaggio raw per il "judge" lato server (vedi pathsCollector).
      // Niente userAction qui: quelli sono note di sistema, non input dell'utente.
      if (session) session.rawUserMessages.push(userMessage);
    }

    const thinking = appendThinking();
    let assistantEl = null;

    // Sui proseguimenti automatici si aspetta la pagina aggiornata prima dello screenshot:
    // senza, l'AI vede quella vecchia e chiede di ripetere il click.
    if (userAction) {
      await waitForPageSettle({ initialUrl: preActionUrl || location.href });
    }
    const [screenshot, origineImmagini] = await Promise.all([
      captureScreenshot(),
      userMessage ? origineImmaginiVisibili().catch(() => null) : Promise.resolve(null),
    ]);
    const payload = buildPayload(userMessage, userAction, esterno);
    payload.screenshot = screenshot || undefined;
    payload.origineImmagini = origineImmagini || undefined;

    try {
      const res = await chrome.runtime.sendMessage({
        type: MSG.AI_REQUEST,
        action: ACTIONS.HELP,
        payload,
        diceRipiego: true,
        // Un passo che l'Aiuto fa da solo è un giro della stessa richiesta, come i giri di strumenti della chat (#969).
        ...(userMessage ? {} : { parteDiUnUso: true }),
      });
      // Col suo codice: senza, la frase già scritta per l'utente («serve un
      // invito») diventava «qualcosa è andato storto» (#663).
      if (!res?.ok) {
        const CE = globalThis.SN_CHAT_ERRORS;
        throw CE ? CE.fromResponse(res, I18n.t('err_provider_failed'))
          : new Error(res?.error || I18n.t('err_provider_failed'));
      }
      // Risposta pagata coi crediti di Filo perché OpenRouter ha rifiutato la chiave (#662): la
      // riga della chat, una volta per serie, non a ogni passo che l'agente fa da solo.
      // Sotto la risposta, come in chat: la scrive il prossimo messaggio di Filo (o la fine del turno).
      if (res.keyFallback && res.keyFallback.line) {
        // La riga è già nella conversazione, o la scrive questo turno: l'avviso non la ripete.
        if (!ripiegoDetto) ripiegoDaDire = res.keyFallback.line;
        Popup?.ripiegoMostrato?.(convEl());
        ripiegoDetto = true;
      } else {
        ripiegoDetto = false;
      }
      const parsed = parseAssistantOutput(res.text);
      // Una ricerca chiesta dal modello è un turno a metà: il seguito lo dice il turno dopo.
      if (session) session.esito = parsed.status === 'done' && !['web_search', 'documenti'].includes(parsed.kind) ? 'fatto' : null;

      // L'AI ha chiesto una ricerca: si esegue e si rilancia un turno coi risultati come nota
      // di sistema, così l'AI può produrre il JSON normale.
      if (parsed.kind === 'web_search') {
        if (thinking) { thinking.stop(); thinking.el.remove(); }
        if (session && session.webSearchCount >= MAX_WEB_SEARCHES_PER_SESSION) {
          appendActionLog('ricerca web: limite raggiunto, ignorata');
          try { Popup?.conta?.({ misura: 'ricerca-web-tetto' }); } catch (_) {}
          setTimeout(() => submit({
            userAction: 'limite di ricerche web raggiunto per questa sessione. Rispondi ora con il JSON normale usando solo ciò che già sai (pagina, llms.txt, percorsi noti).',
            preActionUrl: location.href,
          }), 50);
          return;
        }
        if (session) session.webSearchCount += 1;
        // #593 — I RISULTATI NON SONO UNA NOTA DI FILO.
        //
        // Titolo, indirizzo e riassunto di ogni risultato li scrive chi
        // possiede quella pagina. Finivano impastati in una stringa che il
        // prompt rendeva come «(Sistema: …)», cioè col timbro di Filo: bastava
        // comparire fra i primi risultati per dare ordini all'agente, e senza
        // nemmeno una chiave (il ripiego di ricerca è pubblico). Adesso la
        // nota dice soltanto che la ricerca è stata fatta — quella è la voce
        // di Filo — e i risultati viaggiano a parte, per essere imbustati.
        let ricercaWeb = null;
        let esitoVuoto = '';
        try {
          const r = await chrome.runtime.sendMessage({ type: MSG.WEB_SEARCH, query: parsed.query, parole: paroleUtente() });
          // #810 — la domanda avrebbe portato fuori un segreto: la ricerca non parte, e né la
          // riga né la nota ripetono la domanda.
          if (r && r.blocked === 'segreto') {
            logFermata(r.frase || 'non ho fatto la ricerca');
            esitoVuoto = 'la ricerca web che avevi chiesto NON è partita: la domanda conteneva un codice, una password, una chiave o dati bancari letti fuori dalla conversazione, e Filo non li lascia uscire a nessun livello. Non riprovarla in altra forma; dillo all\'utente in una riga (se vuole la fa lui a mano)';
          } else {
            appendActionLog(`ricerca web: "${parsed.query}"`);
          }
          if (r?.ok && Array.isArray(r.results) && r.results.length) {
            ricercaWeb = { query: parsed.query, provider: r.provider || '', results: r.results };
          } else if (!esitoVuoto) {
            esitoVuoto = 'la ricerca web che avevi chiesto non ha dato nessun risultato';
          }
        } catch (_) {
          esitoVuoto = 'la ricerca web che avevi chiesto è fallita per un errore di rete';
        }
        const note = ricercaWeb
          ? 'ho eseguito la ricerca web che avevi chiesto; i risultati te li rimando qui sotto come contenuto esterno, fra le marcature. Procedi ora con il JSON normale (highlight / choices / text / status)'
          : `${esitoVuoto}. Procedi ora con il JSON normale (highlight / choices / text / status) usando solo ciò che già sai`;
        // Mostra anche un placeholder assistant così l'utente vede che è
        // successo qualcosa (altrimenti la chat sembra "saltare un turno").
        // La query la scrive il modello, spesso ricopiando la pagina: anche qui
        // niente a capo e niente marcature.
        history.push({ role: 'assistant', content: `(ho richiesto una ricerca web: "${Esterno.perCanaleSistema(parsed.query)}")` });
        setTimeout(() => submit({
          userAction: note,
          esterno: ricercaWeb ? { ricercaWeb } : null,
          preActionUrl: location.href,
        }), 50);
        return;
      }

      // Caso speciale: un documento dell'utente (#947.3). La ricerca la fa il main; il turno dopo il modello ha i
      // candidati e ne indica uno col numero.
      if (parsed.kind === 'documenti') {
        if (thinking) { thinking.stop(); thinking.el.remove(); }
        if (parsed.display) {
          appendChatMessage('assistant', parsed.display);
          history.push({ role: 'assistant', content: parsed.display });
        }
        history.push({ role: 'assistant', content: `(ho chiesto di cercare fra i documenti dell'utente: "${Esterno.perCanaleSistema(parsed.cosa)}")` });
        if (session && session.documentiCount >= MAX_DOCUMENTI_PER_SESSIONE) {
          appendActionLog('ricerca fra i documenti: limite raggiunto, ignorata');
          setTimeout(() => submit({
            userAction: 'limite di ricerche fra i documenti raggiunto per questa conversazione. Rispondi ora con il JSON normale usando solo ciò che già sai',
            preActionUrl: location.href,
          }), 50);
          return;
        }
        if (session) session.documentiCount += 1;
        const r = await cercaDocumenti(parsed);
        if (!r || !r.ok) {
          if (r && r.annullata) {
            history.push({
              role: 'user',
              kind: 'action',
              content: PROMPTS.turnoAutomaticoAiuto({ nota: 'l\'utente non ha dato l\'OK alla ricerca fra i suoi documenti: non riproporla se non te la richiede lui', perCronologia: true }),
            });
          }
          expand({ ai: true });
          diciRipiego();
          return;
        }
        documenti = { cercato: r.cercato, candidati: Array.isArray(r.candidati) ? r.candidati : [] };
        // Il main rimette i candidati interi; questi, senza chiavi, sono quelli che la cronologia ricorda.
        const perCronologia = {
          cercato: r.cercato,
          risultati: documenti.candidati.map(({ chiave, ...c }) => c),
          indice: r.indice || null,
          fermata: !!r.fermata,
          cartellaMancante: r.cartellaMancante || '',
          cartellaDiRete: r.cartellaDiRete || '',
        };
        setTimeout(() => submit({ userAction: NOTA_DOCUMENTI, esterno: { documenti: perCronologia }, preActionUrl: location.href, dopoDocumenti: true }), 50);
        return;
      }

      // I bottoni della barra vivono nella shell, non nella pagina: l'utente non potrebbe
      // cliccarli, quindi li eseguiamo noi.
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
        // Le azioni shell non cambiano il DOM che l'agente vede, o sostituiscono la pagina: si
        // prosegue solo su status «continue» e solo se la pagina non è cambiata.
        if (parsed.status === 'continue' && okShell && parsed.command !== 'home') {
          const note = `ho eseguito il comando Filo "${parsed.command}". Valuta lo stato e prosegui, oppure chiudi con status:"done".`;
          setTimeout(() => submit({ userAction: note, preActionUrl: location.href }), 200);
        } else {
          expand({ ai: true });
        }
        diciRipiego();
        return;
      }

      if (parsed.kind === 'filo_action') {
        if (thinking) { thinking.stop(); thinking.el.remove(); }
        if (parsed.display) {
          appendChatMessage('assistant', parsed.display);
          history.push({ role: 'assistant', content: parsed.display });
        }
        await runFiloAction(parsed.filoAction);
        expand({ ai: true });
        diciRipiego();
        return;
      }

      if (parsed.kind === 'page_action') {
        if (thinking) { thinking.stop(); thinking.el.remove(); }
        if (parsed.display) {
          appendChatMessage('assistant', parsed.display);
          history.push({ role: 'assistant', content: parsed.display });
        }
        const ok = await runPageAction(parsed.page);
        // Se l'agente vuole concatenare passi (status:"continue") e l'azione è
        // andata a buon fine, prosegue con una nota di sistema; altrimenti chiude.
        if (parsed.status === 'continue' && ok && !PAGE_ACTIONS[parsed.page.op].chiude) {
          const note = `ho eseguito l'azione di pagina "${parsed.page.op}". Valuta lo stato e prosegui, oppure chiudi con status:"done".`;
          setTimeout(() => submit({ userAction: note, preActionUrl: location.href }), 200);
        } else {
          expand({ ai: true });
        }
        diciRipiego();
        return;
      }

      if (thinking) { thinking.stop(); thinking.el.remove(); }
      // Se il modello non ha messo testo ma c'è solo un highlight di routine,
      // mostriamo comunque una riga discreta in chat (es. "→ passo successivo")
      // così l'utente sa che la chat ha avuto una risposta, anche se silenziosa.
      const daMostrare = fileDaMostrare(parsed, dopoDocumenti);
      const displayText = parsed.display || (parsed.highlight ? '→ passo evidenziato sulla pagina' : (daMostrare.length ? 'Eccolo:' : '(risposta vuota)'));
      assistantEl = appendChatMessage('assistant', displayText, { nelFilo: !!parsed.display });
      // Fermata al tetto di lunghezza (#1097.3): la riga sotto lo dice, e «Continua» chiede il seguito come nelle altre chat.
      const interrotta = globalThis.SN_CHAT_ERRORS?.rispostaInterrotta?.(res.finishReason);
      if (interrotta) appendActionLog(interrotta);
      if (interrotta && !(parsed.choices && parsed.choices.length)) {
        parsed.choices = [{ label: 'Continua', prompt: globalThis.SN_CHAT_ERRORS.CHIEDI_SEGUITO }];
      }

      if (userAction && !userMessage) {
        history.push({
          role: 'user',
          // Stessa funzione che compone il messaggio in partenza (#593): qui
          // cambia solo la coda, perché la cronologia non deve ripetere a ogni
          // turno l'invito a valutare screenshot e outline.
          content: PROMPTS.turnoAutomaticoAiuto({ nota: userAction, dati: esterno, perCronologia: true }),
          kind: 'action',
        });
      }
      history.push({ role: 'assistant', content: parsed.display || res.text });

      if (parsed.choices && parsed.choices.length) {
        renderChoices(assistantEl, parsed.choices);
      }
      // Dopo le scelte: inserito subito sotto il messaggio, il documento resta sopra di loro.
      mostraFile(assistantEl, daMostrare);

      // Il tooltip usa SOLO highlight.note, non il testo della chat, per non duplicare il
      // messaggio; per i fill il riquadro resta comunque (valore + Accetta).
      Highlight.clear();
      // Chiuso dall'utente, la pagina non si tocca: della risposta resta il testo da aprire.
      if (parsed.highlight && !nascosto) {
        const act = parsed.highlight.action;
        if (act === 'reveal' || act === 'hover') {
          // Eseguita da noi, senza l'utente: validazione e whitelist stanno in
          // Highlight.autoAction.
          const result = Highlight.autoAction(parsed.highlight.selector, act);
          const targetLabel = result.target ? describeElementBriefly(result.target) : '';
          if (result.ok) {
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
              // #593 — l'etichetta la scrive il sito e il selettore lo propone
              // il modello leggendo il sito: nessuno dei due è una frase di
              // Filo, quindi nessuno dei due entra nel canale «(Sistema: …)».
              // La nota dice cosa ha fatto Filo; l'elemento va nella busta.
              const aiNote = act === 'reveal'
                ? 'ho eseguito reveal sull\'elemento qui sotto: la sezione è ora aperta. Outline e screenshot sono aggiornati'
                : 'ho eseguito hover sull\'elemento qui sotto: il menu è ora aperto. Outline e screenshot sono aggiornati';
              setTimeout(() => submit({
                userAction: aiNote,
                esterno: { elementoPagina: { etichetta: targetLabel, selettore: parsed.highlight.selector } },
                preActionUrl: location.href,
              }), 150);
            }
          } else {
            // Reveal rifiutato dalla whitelist o bersaglio mancante:
            // si chiede all'AI di correggersi senza toccare la pagina.
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
          // Il testo proposto per un campo esce verso il sito: prima passa dalla porta delle uscite (#810).
          const fermo = act === 'fill' ? await campoFermato(parsed.highlight.value) : '';
          if (fermo) {
            fermata(fermo);
            parsed.highlight = null;
          } else {
            Highlight.show(parsed.highlight.selector, {
              note: parsed.highlight.note || '',
              action: parsed.highlight.action,
              value: parsed.highlight.value,
              onAction: onAct,
            });
          }
        }
      }

      // Collapse: se l'AI ha deciso vale il suo valore; altrimenti le choices vanno cliccate e
      // la chat resta aperta, un highlight silenzioso collassa, negli altri casi resta aperta.
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
        // …e solo se da qui partirebbe davvero qualcosa. Da un server di prova,
        // dall'intranet, dal disco di rete e dalle pagine interne di Filo non
        // si raccoglie niente (#584, sesto giro), e a raccolta spenta da
        // nessuna parte (#897): chiedere lì vuol dire promettere una
        // condivisione che non avviene. La domanda la fa il processo
        // principale, con la stessa porta che usa la raccolta.
        if (await percorsoRaccoglibile()) {
          // Chat sempre aperta quando chiediamo feedback (l'utente deve vederlo).
          expand({ ai: true });
          renderFeedbackPrompt();
        }
      }
    } catch (err) {
      if (thinking) { thinking.stop(); thinking.el.remove(); }
      const raw = err?.message || String(err);
      // #360 — la chat non è un log: «fetch failed» non dice niente all'utente. Stessa
      // traduzione della chat della home e di quella dei mazzi.
      const CE = globalThis.SN_CHAT_ERRORS;
      const errText = /context invalidated/i.test(raw)
        ? 'L\'estensione è stata ricaricata. Aggiorna la pagina (F5) per ricollegare la sidebar.'
        : (CE ? CE.sentence(err) : raw);
      assistantEl = appendChatMessage('assistant', errText, { nelFilo: false });
      assistantEl.classList.add('sn-sidebar-msg-error');
      // La bolla d'errore la legge chi ha chiesto: si conta il tipo, mai la frase (#1461).
      try { global.SN_POPUP?.conta?.({ misura: 'errore-modello', code: String((err && (err.code || err.errorCode)) || ''), status: Number(err && err.status) || 0 }); } catch (_) {}
      // La frase nomina la pagina dove si rimedia; da un sito qualunque
      // l'utente non sa come arrivarci, quindi la strada sta qui sotto (#663).
      mostraRimedio(assistantEl, err);
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
      aiNote = 'l\'utente ha accettato il suggerimento di fill e il testo è stato inserito nel campo qui sotto';
    } else {
      logText = label ? `click su ${label}` : 'click eseguito';
      // #593 — il nome dell'elemento lo scrive il sito: va nella busta, non
      // nella nota. Prima entrava fra parentesi dentro «(Sistema: …)».
      aiNote = 'l\'utente ha cliccato sull\'elemento che avevi indicato, descritto qui sotto';
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

    // URL catturato PRIMA del click, così waitForPageSettle vede il cambio di route e aspetta
    // la pagina nuova prima dello screenshot.
    const preActionUrl = location.href;
    submit({
      userAction: aiNote,
      esterno: { elementoPagina: { etichetta: label, selettore: highlight.selector } },
      preActionUrl,
      daGesto: true,
    });
  }

  global.SN_SIDEBAR = {
    open, close, isOpen, ensureNotOverTarget, paroleUtente, notaFermata, fileSotto, passo, stato,
    suCambio: (fn) => { ascoltaCambi = typeof fn === 'function' ? fn : null; },
  };
  // Hook di test: esercita il ponte azioni-Filo (popup di conferma + dispatch)
  // senza dover passare dal modello. Stesso pattern di window.__filoDashActions.
  global.__filoSidebarTest = {
    runFiloAction, filoActionLabel,
    runPageAction, parseAssistantOutput,
    resolveImageEl, resolveLinkEl, resolveActionText,
    // Il riquadrino «Ha funzionato?»: da lì il percorso finisce in una raccolta
    // che legge chiunque, quindi quello che c'è scritto è una promessa (#584).
    // `renderFeedbackPrompt` lo disegna e basta; chi decide se chiedere è
    // `percorsoRaccoglibile`, ed è quella la porta che vale.
    renderFeedbackPrompt, percorsoRaccoglibile, puntoRisposta,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
