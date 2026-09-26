// Modalità zoom con la rotella, attivata dal click centrale (rotella del mouse).
//
// PERCHÉ ESISTE
//   Il click centrale di Chromium attiva l'autoscroll nativo: compare l'ancora
//   e per scrollare devi spostare il mouse su/giù rispetto al punto cliccato.
//   Un alpha tester l'ha trovato scomodo e ha chiesto di sostituirlo con una
//   "modalità zoom": un click sulla rotella la attiva, mentre è attiva la
//   rotella zooma/dezooma la pagina (invece di scrollare).
//
// COME SI CHIUDE (feedback alpha)
//   Una volta attiva, QUALSIASI interazione la chiude: un altro click (sinistro,
//   destro o centrale) e qualsiasi tasto della tastiera. L'unica eccezione è
//   l'interazione col badge stesso, che ospita la percentuale di zoom editabile.
//
// IL BADGE
//   In alto a destra un badge mostra "zoom 100%, rotella per zoomare". La
//   percentuale è un campo editabile: l'utente può digitare un valore e premere
//   Invio per impostare lo zoom esatto. Niente emoji, niente menzione di Esc.
//   Uscendo NON si azzera lo zoom raggiunto: si torna solo a scrollare.
//
// Gira nel contesto del preload (ha accesso a `webFrame` di Electron), sia sulle
// pagine web (page-preload) sia sulle pagine interne filo:// (internal-preload).
//
// ZOOM CON CTRL (opts.pageZoom)
//   Oltre alla modalità rotella, se `opts.pageZoom` è attivo la pagina zooma
//   anche tenendo Ctrl/Cmd: pizzicando il trackpad, con Ctrl+rotella e da
//   tastiera con Ctrl + / Ctrl - / Ctrl 0. Pinch e Ctrl+rotella arrivano
//   entrambi come `wheel` con ctrlKey=true. È attivo sia sulle pagine web
//   esterne (page-preload) sia sulle pagine interne filo:// (internal-preload):
//   lo zoom deve funzionare allo stesso modo ovunque.
//
//   OPT-OUT PER LE PAGINE CHE ZOOMANO DA SÉ
//   Una pagina di Filo che implementa il proprio zoom (l'editor scala il foglio
//   via CSS invece dell'intera finestra) si tira fuori marcando
//   `document.documentElement.dataset.filoOwnZoom = '1'`. Il controllo avviene
//   al momento dell'evento, quindi il marker può essere messo quando vuole:
//   senza, lo zoom verrebbe applicato due volte. Vale SOLO con `opts.interna`:
//   il marcatore sta nel documento, e su un sito lo scriverebbe il sito.
//
//   LO ZOOM CHIESTO A PAROLE (#686)
//   La chat non zooma da sé: manda `filo:zoom-key` come i tasti, con un verso
//   oppure una percentuale esatta, e riceve indietro su `filo:zoom-applicato`
//   la percentuale che è stata davvero applicata (chi chiede un valore fuori
//   scala deve poterlo dire all'utente). Passo e limiti stanno in
//   src/shared/zoomPagina.js: una regola sola per tasti, rotella, badge e chat.
//
//   QUANDO IL FOCUS È SULLA BARRA DI FILO
//   Se l'utente ha appena cliccato una scheda, i tasti vanno alla barra e non
//   alla pagina: nessun keydown arriva qui. Il main (tabs.js) intercetta lì
//   Ctrl +/-/0 e li inoltra alla scheda attiva come `filo:zoom-key`, che
//   rientra da questo stesso modulo — così la regola su chi zooma resta una
//   sola. Serve `opts.ipcRenderer`.

module.exports = function setupWheelZoom(webFrame, opts) {
  if (!webFrame || typeof document === 'undefined') return;
  const pageZoom = !!(opts && opts.pageZoom);
  const ipc = (opts && opts.ipcRenderer) || null;
  // Solo le pagine di Filo possono dire «lo zoom me lo faccio io»: il marcatore
  // sta nel documento, e su un sito lo scriverebbe il sito per rendersi
  // impossibile da ingrandire (#686, primo giro di verifica).
  const interna = !!(opts && opts.interna);

  // Passo e limiti stanno in un posto solo (src/shared/zoomPagina.js): tasti,
  // rotella, badge e chat devono zoomare della stessa quantità e fermarsi dove
  // si ferma Chrome, altrimenti due strade sullo stesso zoom divergono.
  try {
    const path = require('node:path');
    require(path.join(__dirname, '..', 'shared', 'zoomPagina.js'));
  } catch (_) {}
  const Z = (typeof globalThis !== 'undefined' && globalThis.SN_ZOOM) || null;
  const ZOOM_STEP = Z ? Z.PASSO : 0.5;   // come un passo di Ctrl +/- (in "zoom level")
  const MIN_LEVEL = Z ? Z.MIN_LIVELLO : -5;
  const MAX_LEVEL = Z ? Z.MAX_LIVELLO : 5;

  let zoomMode = false;
  let badge = null;
  let percentInput = null;
  let suppressContextMenu = false;

  // Lo zoom si muove per i gesti VERI dell'utente. Un evento che la pagina si
  // scrive da sola arriva identico a questi listener, e un sito lo userebbe per
  // rimettersi la misura che vuole (o per aprire da sé la modalità rotella)
  // quante volte gli pare: #686, secondo giro di verifica.
  function gestoVero(e) { return !!(e && e.isTrusted); }

  // Percentuale di zoom corrente (100 = nessuno zoom).
  function currentPercent() {
    try { return Math.round(webFrame.getZoomFactor() * 100); }
    catch (_) { return 100; }
  }

  // Ciò che l'utente ha BATTUTO nel campo del riquadro. Il campo sta nel
  // documento, dove arriva anche il sito: applicare `input.value` gli
  // basterebbe per rimettersi la pagina come vuole lui, scrivendoci un numero
  // e aspettando un clic qualsiasi (#686, terzo giro di verifica).
  let valoreBattuto = '100';

  function mostraPercentuale() {
    valoreBattuto = String(currentPercent());
    if (percentInput) percentInput.value = valoreBattuto;
  }

  function refreshPercent() {
    // Non sovrascrivere mentre l'utente sta digitando nel campo.
    if (percentInput && document.activeElement !== percentInput) mostraPercentuale();
  }

  // Lo zoom si chiede e si azzera da QUI, non con un evento sul documento: il
  // menu del tasto destro gira nello stesso mondo isolato di questo file,
  // mentre il documento lo condividiamo col sito, che userebbe la stessa porta
  // per rimettersi la pagina come vuole lui (#686, primo giro di verifica).
  // La percentuale è quella che l'utente VEDE: su una pagina che scala il
  // proprio contenuto è la sua, non il 100% fermo della finestra (#686, terzo
  // giro: il tasto destro diceva «tutto normale» su un foglio ingrandito).
  try {
    globalThis.SN_ZOOM_PAGINA = {
      percentuale: () => {
        const p = percentualePropria();
        return p == null ? currentPercent() : p;
      },
      azzera: () => { eseguiZoom({ verso: 'reset' }); },
    };
  } catch (_) {}

  // Applica un livello di zoom dentro i limiti condivisi. Unico punto che
  // scrive lo zoom del webFrame: rotella, badge, tasti e chat passano da qui.
  function setLevel(level) {
    const clamped = Z ? Z.limita(level) : Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level));
    try { webFrame.setZoomLevel(clamped); } catch (_) {}
    refreshPercent();
  }

  // Applica la percentuale BATTUTA nel campo, con gli stessi limiti di ogni
  // altra strada (prima il badge accettava valori che i tasti non sanno
  // reggere: il primo Ctrl+ dopo un 400% riportava indietro di colpo).
  function applyPercentFromInput() {
    if (!percentInput) return;
    const esito = Z ? Z.risolvi(letturaLivello(), { percentuale: valoreBattuto }) : null;
    if (esito) setLevel(esito.livello);
    mostraPercentuale();
  }

  function letturaLivello() {
    try { return webFrame.getZoomLevel(); } catch (_) { return 0; }
  }

  function makeBadge() {
    const el = document.createElement('div');
    el.id = '__filo-zoom-badge';
    el.setAttribute('role', 'status');
    Object.assign(el.style, {
      position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647',
      background: 'rgba(20,20,20,0.88)', color: '#fff',
      font: '12px/1.4 system-ui, -apple-system, sans-serif',
      padding: '6px 10px', borderRadius: '8px', pointerEvents: 'auto',
      boxShadow: '0 2px 8px rgba(0,0,0,0.35)', userSelect: 'none',
      display: 'flex', alignItems: 'center', gap: '0',
    });
    el.appendChild(document.createTextNode('zoom '));

    const input = document.createElement('input');
    input.id = '__filo-zoom-percent';
    input.type = 'text';
    input.inputMode = 'numeric';
    input.setAttribute('aria-label', 'Percentuale zoom');
    Object.assign(input.style, {
      width: '3.4em', textAlign: 'right', background: 'transparent',
      color: '#fff', border: 'none',
      borderBottom: '1px dashed rgba(255,255,255,0.55)',
      font: 'inherit', padding: '0 1px', margin: '0', outline: 'none',
    });
    // Il valore lo segna chi BATTE: un `input.value` scritto dal sito non
    // genera questo evento, e quindi non diventa mai lo zoom della pagina.
    input.addEventListener('input', (e) => { if (gestoVero(e)) valoreBattuto = input.value; });
    input.addEventListener('keydown', (e) => {
      if (!gestoVero(e)) return;
      // Mentre si edita la percentuale, i tasti NON chiudono la modalità.
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        applyPercentFromInput();
        input.blur();
      }
    });
    input.addEventListener('blur', (e) => { if (gestoVero(e)) applyPercentFromInput(); });
    el.appendChild(input);
    percentInput = input;

    el.appendChild(document.createTextNode('%, rotella per zoomare'));
    return el;
  }

  function enter() {
    if (zoomMode) return;
    zoomMode = true;
    try {
      if (!badge) badge = makeBadge();
      (document.body || document.documentElement).appendChild(badge);
      refreshPercent();
      document.documentElement.style.cursor = 'zoom-in';
    } catch (_) {}
    try { document.documentElement.dataset.filoZoomMode = '1'; } catch (_) {}
  }

  function exit() {
    if (!zoomMode) return;
    zoomMode = false;
    try { if (badge && badge.parentNode) badge.parentNode.removeChild(badge); } catch (_) {}
    try { document.documentElement.style.cursor = ''; } catch (_) {}
    try { delete document.documentElement.dataset.filoZoomMode; } catch (_) {}
  }

  function toggle() { if (zoomMode) exit(); else enter(); }

  function isOnLink(target) {
    return !!(target && target.closest && target.closest('a[href], area[href]'));
  }

  // L'interazione col badge (editare la percentuale) non deve chiudere la modalità.
  function isInBadge(target) {
    return !!(badge && target && (target === badge || (badge.contains && badge.contains(target))));
  }

  // Click: il centrale attiva/disattiva la modalità (e blocca l'autoscroll
  // nativo). In modalità zoom, QUALSIASI click (sinistro o destro) fuori dal
  // badge la chiude. Sui link, fuori dalla modalità, il click centrale resta
  // nativo (apre in nuova scheda).
  document.addEventListener('mousedown', (e) => {
    if (!gestoVero(e)) return;
    if (e.button === 1) {
      if (!zoomMode && isOnLink(e.target)) return;
      e.preventDefault();   // niente autoscroll
      e.stopPropagation();
      toggle();
      return;
    }
    if (zoomMode && !isInBadge(e.target)) {
      if (e.button === 2) suppressContextMenu = true; // niente menu sul destro
      e.preventDefault();
      e.stopPropagation();
      exit();
    }
  }, true);

  // Sopprimi il menu contestuale solo quando il click destro è servito a chiudere
  // la modalità zoom (così il destro "chiude e basta", senza aprire il menu).
  document.addEventListener('contextmenu', (e) => {
    if (suppressContextMenu) {
      suppressContextMenu = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // La rotella, in modalità zoom, zooma invece di scrollare.
  document.addEventListener('wheel', (e) => {
    if (!zoomMode || !gestoVero(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const dir = e.deltaY < 0 ? 1 : -1; // rotella su = zoom in
    let next = webFrame.getZoomLevel() + dir * ZOOM_STEP;
    next = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, next));
    webFrame.setZoomLevel(next);
    refreshPercent();
  }, { capture: true, passive: false });

  // Qualsiasi tasto chiude la modalità — tranne mentre si edita la percentuale
  // nel badge (gestito dal listener sull'input, che ferma la propagazione).
  document.addEventListener('keydown', (e) => {
    if (!zoomMode || !gestoVero(e)) return;
    if (isInBadge(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    exit();
  }, true);

  // ── Zoom della pagina con Ctrl/Cmd (solo se opts.pageZoom) ──────────────
  // Indipendente dalla modalità rotella: basta tenere Ctrl (o pizzicare il
  // trackpad). Usa il livello di zoom del webFrame, così scala l'intera pagina
  // (testo + immagini) come il classico zoom del browser.
  if (pageZoom) {
    // La pagina zooma da sé (vedi commento in testa): non ci mettiamo in mezzo.
    function pageHandlesZoom() {
      if (!interna) return false;
      try { return document.documentElement.dataset.filoOwnZoom === '1'; }
      catch (_) { return false; }
    }

    // Quanto è ingrandita una pagina che zooma da sé: il livello della finestra
    // lì resta fermo al 100%, quindi il numero lo deve dire lei.
    function percentualePropria() {
      if (!pageHandlesZoom()) return null;
      try {
        const p = Z ? Z.leggiPercentuale(document.documentElement.dataset.filoOwnZoomPercent) : null;
        return p == null ? null : Math.round(p);
      } catch (_) { return null; }
    }

    // …e lo deve dire anche al main, che altrimenti riferirebbe in chat il
    // 100% della finestra mentre il foglio è al 150% (#686, secondo giro).
    // Non muove niente: è solo il numero che la pagina dichiara di sé.
    if (interna && ipc && typeof ipc.send === 'function') {
      document.addEventListener('filo:zoom-proprio', () => {
        const p = percentualePropria();
        if (p != null) { try { ipc.send('filo:zoom-proprio', p); } catch (_) {} }
      });
    }

    // Pinch del trackpad e Ctrl+rotella → wheel con ctrlKey=true. Passo
    // proporzionale al delta così il pinch (incrementi piccoli) resta fluido.
    // In modalità rotella ci pensa già l'handler sopra: qui ci tiriamo fuori.
    document.addEventListener('wheel', (e) => {
      if (zoomMode || !gestoVero(e)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (pageHandlesZoom()) return;
      e.preventDefault();
      e.stopPropagation();
      // ~0.005/unità: un notch di rotella (deltaY≈100) ≈ un passo di Ctrl +/-
      // (ZOOM_STEP=0.5); il pinch del trackpad (delta piccoli) resta fluido.
      let next;
      try { next = webFrame.getZoomLevel() - e.deltaY * 0.005; }
      catch (_) { return; }
      setLevel(next);
    }, { capture: true, passive: false });

    // Da tastiera: Ctrl + / Ctrl - / Ctrl 0. Accettiamo anche il tastierino
    // numerico via `code` (lì `key` è già '+'/'-'/'0', ma non su tutti i layout).
    document.addEventListener('keydown', (e) => {
      if (zoomMode || !gestoVero(e)) return; // in modalità rotella un tasto qualsiasi esce
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (pageHandlesZoom()) return;
      const k = e.key;
      const c = e.code;
      const isIn = k === '+' || k === '=' || c === 'NumpadAdd';
      const isOut = k === '-' || k === '_' || c === 'NumpadSubtract';
      const isReset = k === '0' || c === 'Numpad0';
      if (isIn) {
        e.preventDefault(); e.stopPropagation();
        try { setLevel(webFrame.getZoomLevel() + ZOOM_STEP); } catch (_) {}
      } else if (isOut) {
        e.preventDefault(); e.stopPropagation();
        try { setLevel(webFrame.getZoomLevel() - ZOOM_STEP); } catch (_) {}
      } else if (isReset) {
        e.preventDefault(); e.stopPropagation();
        setLevel(0); // 100%
      }
    }, true);

    // Stesse scorciatoie, ma premute mentre il focus è sulla barra di Filo
    // (fila delle schede): lì i tasti non arrivano alla pagina, quindi il main
    // li inoltra qui. Passano dallo STESSO punto degli altri, così l'opt-out
    // delle pagine che zoomano da sé vale anche per questa strada.
    //
    // Dalla stessa porta entra anche lo zoom chiesto a parole in chat, che
    // oltre al verso può portare una percentuale esatta e un `rid` a cui
    // rispondere: chi ha chiesto «al 900%» deve poter sapere dove è finito.
    if (ipc && typeof ipc.on === 'function') {
      ipc.on('filo:zoom-key', (_e, payload) => {
        // Il verso da solo (i tasti) o un oggetto {verso|percentuale, rid}.
        const spec = (payload && typeof payload === 'object') ? payload : { verso: payload };
        const rid = spec.rid ? String(spec.rid) : '';
        const rispondi = (esito) => {
          if (!rid || typeof ipc.send !== 'function') return;
          try { ipc.send('filo:zoom-applicato', { rid, ...(esito || { sconosciuto: true }) }); } catch (_) {}
        };
        // La pagina che zooma da sé (l'editor scala il foglio) non deve essere
        // zoomata da qui — ma il tasto va comunque CONSEGNATO, altrimenti su
        // Mac il suo zoom muore in silenzio: là questa è l'unica strada, perché
        // il tasto se lo prende la barra dei menu prima che arrivi alla pagina.
        // Su Windows e Linux il keydown della pagina arriva e basta a sé.
        //
        // Il verso sta nel NOME dell'evento, non in `detail`: fra il mondo
        // isolato del preload e quello della pagina un `detail` non passa. Una
        // percentuale esatta passa dal dataset, che il DOM condivide.
        if (pageHandlesZoom()) {
          const chiesto = Z ? Z.leggiPercentuale(spec.percentuale) : null;
          try {
            if (chiesto != null) {
              document.documentElement.dataset.filoZoomTarget = String(chiesto);
              document.dispatchEvent(new Event('filo:zoom-set'));
            } else {
              const nomi = { in: 'filo:zoom-in', out: 'filo:zoom-out', reset: 'filo:zoom-reset' };
              if (nomi[spec.verso]) document.dispatchEvent(new Event(nomi[spec.verso]));
            }
          } catch (_) {}
          // Il numero lo dichiara la pagina (l'evento qui sopra è sincrono,
          // quindi a questo punto è già aggiornato); se tace, non se ne
          // inventa uno. Il foglio ha limiti suoi, più stretti di quelli della
          // finestra: se ci si ferma prima, chi ha chiesto deve saperlo.
          const p = percentualePropria();
          rispondi(p == null ? null : {
            percentuale: p,
            richiesto: chiesto == null ? null : Math.round(chiesto),
            limitato: chiesto != null && Math.round(chiesto) !== p,
          });
          return;
        }
        const esito = Z ? Z.risolvi(letturaLivello(), spec) : null;
        if (!esito) { rispondi(null); return; }
        setLevel(esito.livello);
        rispondi({ percentuale: currentPercent(), richiesto: esito.richiesto, limitato: esito.limitato, min: esito.min, max: esito.max });
      });
    }
  }
};
