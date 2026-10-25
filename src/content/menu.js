// Menu contestuale custom. Disegnato come elemento HTML nel DOM.
// Posizionamento smart con flip vicino ai bordi.

(function (global) {
  'use strict';

  const I18n = global.SN_I18N;
  const isSvgIcon = global.SN_ICONS_UTIL?.isSvgIcon
    || ((s) => typeof s === 'string' && s.startsWith('<svg'));

  // Le SVG sono compilate in src/shared/icons.js e non contengono mai dati utente: per questo
  // innerHTML qui è sicuro. Glifi unicode ed emoji vanno in textContent.
  function setIconContent(el, value) {
    if (value == null) { el.textContent = ''; return; }
    if (isSvgIcon(value)) el.innerHTML = value;
    else el.textContent = value;
  }

  // In fullscreen HTML5 il browser disegna solo l'elemento a tutto schermo e i suoi
  // discendenti: un menu appeso a <html> resterebbe nascosto dietro al video.
  function menuHost() {
    if (document.fullscreenElement) return document.fullscreenElement;
    const d = dialogoModale();
    return (d && strato(d)) || document.documentElement;
  }

  // Una finestra modale del sito (<dialog> aperta con showModal) sta nello strato più alto e rende inerte tutto il
  // resto: il menu va dentro di lei, in un nostro strato più alto ancora (popover), o resta sotto e non risponde.
  function dialogoModale() {
    let modali = [];
    try { modali = [...document.querySelectorAll('dialog[open]')].filter((d) => d.matches(':modal')); } catch (_) {}
    if (!modali.length) return null;
    const attivo = document.activeElement;
    return modali.find((d) => d.contains(attivo)) || modali[modali.length - 1];
  }
  let stratoEl = null;
  function strato(dialogo) {
    try {
      if (!stratoEl) {
        stratoEl = document.createElement('div');
        global.SN_FILO_UI?.mark(stratoEl);
        stratoEl.setAttribute('popover', 'manual');
        stratoEl.style.cssText = 'all:initial!important;display:block!important;position:fixed!important;inset:0 auto auto 0!important;'
          + 'width:0!important;height:0!important;overflow:visible!important;margin:0!important;padding:0!important;'
          + 'border:0!important;background:transparent!important;';
      }
      const nuovo = stratoEl.parentNode !== dialogo;
      if (nuovo) dialogo.appendChild(stratoEl);
      // Sopra a ciò che il sito ha portato nello strato più alto prima di questo menu.
      if (!activeMenu && stratoEl.matches(':popover-open')) stratoEl.hidePopover();
      if (!stratoEl.matches(':popover-open')) stratoEl.showPopover();
      return stratoEl;
    } catch (_) {
      return null;
    }
  }
  function chiudiStrato() {
    try { if (stratoEl && !activeMenu && stratoEl.matches(':popover-open')) stratoEl.hidePopover(); } catch (_) {}
  }

  // Uno zoom del foglio di stile sul contenitore (html { zoom: 1.5 }) moltiplicherebbe le misure del menu, che sono
  // quelle dello schermo: il pezzo lo annulla.
  function annullaZoom(el, host) {
    const z = Number(host.currentCSSZoom) || 1;
    if (z === 1) el.style.removeProperty('zoom');
    else el.style.setProperty('zoom', String(1 / z), 'important');
  }

  // Ogni pezzo entra nel documento del sito già chiuso ai gesti finti, nodo per nodo (#589.8), e sotto le sonde
  // che dicono se l'utente lo vede (#589.11).
  function monta(el) {
    global.SN_FILO_UI?.soloGestiVeri(el);
    const host = menuHost();
    annullaZoom(el, host);
    return host.insertBefore(el, global.SN_VISTO?.prima(host, el) || null);
  }

  // Un clic su una voce che il sito copriva non parte: il menu si chiude e l'utente sa perché.
  function bloccaMenu() {
    close();
    try { global.SN_POPUP?.showToast?.(I18n.t('menu_click_covered'), { duration: 4000 }); } catch (_) {}
  }
  function sorveglia(pannello, radice) {
    global.SN_VISTO?.sorveglia(pannello, { radice, bloccato: bloccaMenu });
  }

  let activeMenu = null;

  // Shift+F10 e il tasto Menu aprono il menu da tastiera (#1295): si usa con frecce, Tab, Home/Fine, Invio e la prima
  // lettera, e chiuso il fuoco torna dov'era.
  let tastoMenuAlle = 0;
  try {
    document.addEventListener('keydown', (e) => {
      if (e.isTrusted && (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) tastoMenuAlle = Date.now();
    }, true);
  } catch (_) {}
  const daTastiera = () => Date.now() - tastoMenuAlle < 1000;

  const scrivibile = (n) => !!n && n.nodeType === 1 && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName));
  function vociDaTastiera(root) {
    return [...root.querySelectorAll('button')].filter((b) => !b.disabled && !b.classList.contains('sn-disabled')
      && b.getClientRects().length > 0 && getComputedStyle(b).visibility !== 'hidden');
  }
  const etichettaDi = (b) => String(((b.querySelector('.sn-menu-label') || b).textContent) || '').trim()
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Ritorna true se il tasto l'ha usato il menu. Solo i tasti veri: sul sito anche il suo script ne fabbrica.
  function tastoNelMenu(e, m) {
    if (!e.isTrusted) return false;
    const root = m.root;
    const attivo = document.activeElement;
    // La cronologia degli appunti ha il suo campo e le sue frecce: lì il menu non si prende i tasti.
    if (nelSub(attivo)) return false;
    const dentro = root.contains(attivo);
    if (dentro && scrivibile(attivo)) return false;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const voci = vociDaTastiera(root);
    if (!voci.length) return false;
    const i = dentro ? voci.indexOf(attivo) : -1;
    const vai = (j) => { const b = voci[(j + voci.length) % voci.length]; try { b.focus({ preventScroll: false }); } catch (_) { b.focus(); } };
    const k = e.key;
    if (k === 'ArrowDown') { vai(i < 0 ? 0 : i + 1); return true; }
    if (k === 'ArrowUp') { vai(i < 0 ? voci.length - 1 : i - 1); return true; }
    if (!dentro && !m.tastiera) return false;
    if (k === 'Home') { vai(0); return true; }
    if (k === 'End') { vai(voci.length - 1); return true; }
    if (k === 'Tab') { vai(e.shiftKey ? (i < 0 ? voci.length - 1 : i - 1) : i + 1); return true; }
    if (k.length === 1 && k.trim()) {
      const c = k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      for (let n = 1; n <= voci.length; n++) {
        const j = ((i < 0 ? -1 : i) + n) % voci.length;
        if (etichettaDi(voci[j]).startsWith(c)) { vai(j); return true; }
      }
      return true;
    }
    return false;
  }

  // ── Il box come pannello in cui si cerca una voce, per i contatori (#1461) ──────────────────────────────────────
  // Dall'apertura alla prima scelta, a che posto era la voce fra quelle in vista (prima il pannello, poi il
  // sottomenu), o chiuso senza scegliere. Escono solo esiti e numeri, nella pagina e nello strato.
  const VOCI = '.sn-menu-item, .sn-menu-split-main, .sn-menu-paste-main, .sn-menu-correction-main, .sn-menu-row-btn, '
    + '.sn-menu-icon-btn, .sn-menu-history-item';
  function contaNelMenu(evento) {
    try {
      if (global.SN_POPUP && typeof global.SN_POPUP.conta === 'function') global.SN_POPUP.conta(evento);
      else if (typeof global.SN_MENU_CONTA === 'function') global.SN_MENU_CONTA(evento);
    } catch (_) {}
  }
  const contaBox = (ev) => contaNelMenu({ misura: 'ricerca', pannello: 'tasto-destro', ...ev });
  // I gesti del menu (#1471): il nome letto su un'icona, il riquadro «Altro…», un'icona trascinata e lasciata nel vuoto.
  const contaGesto = (gesto, campi) => contaNelMenu({ misura: 'gesto', gesto, ...campi });
  const lettura = global.SN_GESTI ? global.SN_GESTI.lettore((ev) => contaNelMenu(ev)) : { mostrato() {}, clic() {}, via() {} };
  // Una voce che fa un'azione del catalogo delle capacità la nomina con `azione` (#1461): si misura qui, dal clic alla
  // fine del suo lavoro, per ogni menu che passa da open, nella pagina e nello strato. Una voce non si misura due volte.
  const MISURATE = new WeakSet();
  let azioneInCorso = null;
  function misuraLeAzioni(items) {
    for (const it of Array.isArray(items) ? items : []) {
      if (!it || typeof it !== 'object' || MISURATE.has(it)) continue;
      MISURATE.add(it);
      for (const k of ['items', 'subItems']) if (Array.isArray(it[k])) misuraLeAzioni(it[k]);
      if (typeof it.azione !== 'string' || !it.azione) continue;
      for (const campo of ['onClick', 'onPickHistory']) {
        const fa = it[campo];
        if (typeof fa !== 'function') continue;
        it[campo] = function (...args) {
          const voce = { id: it.azione, t0: Date.now(), apre: false };
          // Una voce che apre una scheda la passa al main con l'azione (`apre`): lì finisce a pagina caricata.
          const fine = () => { if (!voce.apre) contaNelMenu({ misura: 'azione', id: it.azione, fineMs: Date.now() - voce.t0 }); };
          const prima = azioneInCorso;
          azioneInCorso = voce;
          let r;
          try { r = fa.apply(this, args); } catch (e) { fine(); throw e; } finally { azioneInCorso = prima; }
          if (r && typeof r.then === 'function') r.then(fine, fine); else fine();
          return r;
        };
      }
    }
    return items;
  }
  function vociInVista(pannello) {
    if (!pannello) return [];
    return [...pannello.querySelectorAll(VOCI)].filter((b) => !b.classList.contains('sn-menu-row-overflow')
      && !b.classList.contains('sn-menu-row-empty') && !b.classList.contains('sn-menu-history-gone')
      && b.getClientRects().length > 0);
  }
  function sceltaNelMenu(voce) {
    const r = activeMenu && activeMenu.ricerca;
    if (!r || r.scelta) return;
    r.scelta = true;
    const principali = vociInVista(activeMenu.root);
    let i = principali.indexOf(voce);
    if (i < 0 && activeMenu.subRoot && activeMenu.subRoot.contains(voce)) {
      const j = vociInVista(activeMenu.subRoot).indexOf(voce);
      i = j < 0 ? -1 : principali.length + j;
    }
    contaBox({ esito: 'scelta', attesaMs: Date.now() - r.t0, posizione: i >= 0 ? i + 1 : null });
  }
  // In cattura, prima che la voce chiuda il menu. La cronologia degli appunti sta in un'ombra chiusa: lì la scelta la
  // segna la riga stessa.
  function sceltaDalClic(e) {
    if (!e.isTrusted || !activeMenu) return;
    const percorso = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
    const voce = percorso.find((n) => n && n.nodeType === 1 && typeof n.matches === 'function' && n.matches(VOCI));
    if (!voce || voce.matches('.sn-menu-history-item')) return;
    if (voce.disabled || voce.dataset.snDisabled === '1' || voce.closest('.sn-disabled')) return;
    if (voce.classList.contains('sn-menu-row-overflow') || voce.classList.contains('sn-menu-row-empty')) return;
    if (!activeMenu.root.contains(voce) && !(activeMenu.subRoot && activeMenu.subRoot.contains(voce))) return;
    sceltaNelMenu(voce);
  }

  function close() {
    try { dismissTooltip?.(); } catch (_) {}
    lettura.via();
    clearSubCloseTimer();
    if (activeMenu) {
      if (activeMenu.ricerca && !activeMenu.ricerca.scelta) contaBox({ esito: 'vuota' });
      activeMenu.ricerca = null;
      document.removeEventListener('click', sceltaDalClic, true);
      const torna = activeMenu.opener;
      const eraDentro = activeMenu.root.contains(document.activeElement);
      activeMenu.root.remove();
      if (eraDentro && torna && torna.isConnected && typeof torna.focus === 'function') {
        try { torna.focus({ preventScroll: true }); } catch (_) {}
      }
      staccaSub();
      document.removeEventListener('mousedown', activeMenu.onDocClick, true);
      document.removeEventListener('keydown', activeMenu.onKey, true);
      window.removeEventListener('scroll', activeMenu.onScroll, true);
      window.removeEventListener('resize', activeMenu.onResize, true);
      try { activeMenu.cleanupZoom?.(); } catch (_) {}
      try { activeMenu.cleanups?.forEach((fn) => { try { fn(); } catch (_) {} }); } catch (_) {}
      activeMenu = null;
      chiudiStrato();
      try { allaChiusura?.(); } catch (_) {}
    }
    try { global.SN_POPUP?.sottoIlMenu?.(false); } catch (_) {}
    // Pulisce zone di drop residue (vengono ri-registrate alla prossima apertura).
    dropZones.length = 0;
  }

  // Lo strato sopra la scheda (#1054) sa così che il menu si è chiuso da sé: una voce, un clic fuori, Esc.
  let allaChiusura = null;

  // La cronologia degli appunti non sta nel documento ma dentro un host suo (`subHost`): si stacca quello.
  function staccaSub() {
    if (!activeMenu) return;
    const allaChiusuraSub = activeMenu.subAllaChiusura;
    activeMenu.subAllaChiusura = null;
    try { if (typeof allaChiusuraSub === 'function') allaChiusuraSub(); } catch (_) {}
    try { (activeMenu.subHost || activeMenu.subRoot)?.remove(); } catch (_) {}
    activeMenu.subRoot = null;
    activeMenu.subHost = null;
  }

  // Gli eventi di dentro uno shadow root arrivano al documento col suo host come bersaglio.
  function nelSub(t) {
    const s = activeMenu && (activeMenu.subHost || activeMenu.subRoot);
    return !!(s && t && s.contains(t));
  }

  function closeSubmenu() {
    if (!activeMenu?.subRoot) return;
    staccaSub();
    activeMenu.subAnchor = null;
    activeMenu.subMode = null;
    activeMenu.subLocked = false;
    activeMenu.subOwner = null;
  }

  let subCloseTimer = null;
  function clearSubCloseTimer() { if (subCloseTimer) { clearTimeout(subCloseTimer); subCloseTimer = null; } }

  function setupArrowSubmenu(arrow, openFn, cleanups) {
    const openHere = () => {
      openFn();
      if (activeMenu) activeMenu.subOwner = arrow;
    };
    arrow.addEventListener('mouseenter', () => {
      clearSubCloseTimer();
      // L'hover su una nuova freccetta chiude il sotto-menu già aperto, anche se «pinnato»:
      // altrimenti si resta bloccati su quello senza poter esplorare gli altri.
      if (activeMenu?.subRoot && activeMenu.subOwner !== arrow) {
        activeMenu.subLocked = false;
        closeSubmenu();
      }
      if (!activeMenu?.subRoot) openHere();
    });
    arrow.addEventListener('mouseleave', () => {
      if (activeMenu?.subLocked) return;
      clearSubCloseTimer();
      subCloseTimer = setTimeout(() => closeSubmenu(), 500);
    });
    arrow.addEventListener('click', (e) => {
      e.stopPropagation();
      clearSubCloseTimer();
      if (activeMenu?.subRoot && activeMenu.subOwner === arrow) {
        activeMenu.subLocked = true;
      } else {
        if (activeMenu?.subRoot) closeSubmenu();
        openHere();
        if (activeMenu) activeMenu.subLocked = true;
      }
    });
    cleanups.push(() => clearSubCloseTimer());
  }

  function attachSubmenuHover(sub) {
    sub.addEventListener('mouseenter', () => clearSubCloseTimer());
    sub.addEventListener('mouseleave', () => {
      if (activeMenu?.subLocked) return;
      clearSubCloseTimer();
      subCloseTimer = setTimeout(() => closeSubmenu(), 500);
    });
  }

  // Geometria condivisa col riquadro della risposta (src/shared/overlayPlacement.js). Il
  // tetto d'altezza serve anche dentro un riquadro, o le voci in fondo restano tagliate.
  const Place = global.SN_PLACE;

  // `keep: true` = il menu è già a schermo e ha cambiato altezza: si parte dalla posa corrente, non
  // dal cursore.
  function place(root, x, y, opts) {
    const keep = !!(opts && opts.keep);
    const { scale } = Place.applyCap(root);
    const vw = window.innerWidth, vh = window.innerHeight;

    let from = null;
    if (keep) {
      const l = parseFloat(root.style.left);
      const t = parseFloat(root.style.top);
      if (Number.isFinite(l) && Number.isFinite(t)) from = { left: l, top: t };
    }
    const p = Place.computeOffset({
      x, y,
      visW: root.offsetWidth * scale,
      visH: root.offsetHeight * scale,
      vw, vh, from,
    });
    const primaLeft = parseFloat(root.style.left);
    const primaTop = parseFloat(root.style.top);
    root.style.left = `${p.left}px`;
    root.style.top = `${p.top}px`;
    // L'etichetta si toglie solo se il menu si è mosso davvero: un menu che cresce restando
    // fermo non deve farla sparire a chi la sta leggendo (#500).
    const mosso = (Number.isFinite(primaTop) && Math.abs(p.top - primaTop) > 0.5)
      || (Number.isFinite(primaLeft) && Math.abs(p.left - primaLeft) > 0.5);
    if (mosso) dismissTooltip();
    repositionSub();
  }

  // 'anchor': a fianco della voce che l'ha aperto, a sinistra se a destra non ci sta.
  // 'edge': attaccato al bordo del menu, così si leggono come un pezzo solo.
  function computeSubOffset({ aTop, aLeft, aRight, mLeft, mRight, w, h, vw, vh, mode }) {
    const edge = mode === 'edge';
    let left = edge ? mRight - 2 : aRight + 4;
    if (left + w + 8 > vw) left = edge ? Math.max(4, mLeft - w + 2) : Math.max(4, aLeft - w - 4);
    let top = aTop;
    if (top + h + 8 > vh) top = Math.max(8, vh - h - 8);
    return { left, top };
  }

  // Misura ADESSO dove si trova l'ancora: chiamabile quante volte serve, anche mentre il menu si
  // muove.
  function placeSub(sub, anchorEl, mode) {
    const a = anchorEl.getBoundingClientRect();
    const m = ((activeMenu && activeMenu.root) || anchorEl).getBoundingClientRect();
    const p = computeSubOffset({
      aTop: a.top, aLeft: a.left, aRight: a.right,
      mLeft: m.left, mRight: m.right,
      w: sub.offsetWidth, h: sub.offsetHeight,
      vw: window.innerWidth, vh: window.innerHeight,
      mode,
    });
    sub.style.left = `${p.left}px`;
    sub.style.top = `${p.top}px`;
  }

  // Il menu si muove sotto un pannello già posato: se il pannello resta fermo si stacca
  // dalla freccetta. Segue la sua ancora e si chiude quando esce dal bordo (#500).
  function repositionSub() {
    if (!activeMenu || !activeMenu.subRoot || !activeMenu.subAnchor) return;
    const sub = activeMenu.subRoot;
    const anchor = activeMenu.subAnchor;
    const root = activeMenu.root;
    if (root && root.contains(anchor)) {
      const a = anchor.getBoundingClientRect();
      const r = root.getBoundingClientRect();
      // Metà ancora fuori = ancora persa: meglio chiudere che appendersi a una
      // scheggia di bottone mezza tagliata dal bordo.
      const centro = a.top + a.height / 2;
      if (centro < r.top || centro > r.bottom) { closeSubmenu(); return; }
    }
    placeSub(sub, anchor, activeMenu.subMode);
  }

  // items: { type: 'item'|'separator'|'row'|'inline'|'paste', label, shortcut, disabled,
  // onClick, items? }. 'inline' mostra contenuto dinamico, 'paste' apre la cronologia.
  // `alChiudere`: chi ha aperto il menu vuole sapere quando si chiude, da sé o con una voce.
  function open({ x, y, items, keepOnScroll, alChiudere }) {
    misuraLeAzioni(items);
    close();
    const tastiera = daTastiera();
    tastoMenuAlle = 0;
    const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    // Da tastiera il punto può mancare: il menu nasce sotto l'elemento che ha il fuoco.
    if (tastiera && opener && !(x > 0 || y > 0)) {
      try { const r = opener.getBoundingClientRect(); x = r.left + 8; y = r.bottom; } catch (_) {}
    }
    const root = document.createElement('div');
    root.className = 'sn-menu';
    // UI di Filo dentro la pagina del sito, marcata alla nascita: la traduzione la salta senza
    // indovinarla dal nome. In pieno schermo il menu finisce DENTRO l'elemento del sito.
    global.SN_FILO_UI?.mark(root);
    global.SN_FILO_UI?.soloGestiVeri(root);
    root.setAttribute('role', 'menu');
    root.dataset.snTheme = document.documentElement.dataset.snTheme || '';

    const cleanups = [];
    if (typeof alChiudere === 'function') cleanups.push(alChiudere);
    // Le sezioni che si riempiono più tardi si guardano da vicino, così la rimisura parte appena il
    // testo cambia.
    const crescite = [];

    for (const it of items) {
      if (it.type === 'separator') {
        const sep = document.createElement('div');
        sep.className = 'sn-menu-sep';
        // `hidden` permette al chiamante di nascondere il separatore in tandem
        // con una correction nascosta (vedi gestione 'correction' hidden).
        if (it.hidden) {
          sep.style.display = 'none';
          sep.dataset.snHiddenSep = '1';
        }
        root.appendChild(sep);
        continue;
      }
      if (it.type === 'row') {
        const row = document.createElement('div');
        row.className = 'sn-menu-row';
        if (it.dropTarget) row.dataset.snDropTarget = it.dropTarget;
        populateRow(row, it.items, { dropTarget: it.dropTarget });
        if (it.dropTarget) attachDropZone(row, { target: it.dropTarget, onDrop: it.onDrop });
        root.appendChild(row);
        continue;
      }
      if (it.type === 'inline') {
        const el = document.createElement('div');
        el.className = 'sn-menu-inline';
        // Di cosa parla il riquadro deve restare lo stesso da qualunque punto della scheda lo si
        // apra (#444), ed è leggibile già prima che arrivi la risposta.
        if (it.subject) el.dataset.subject = it.subject;
        if (it.content) el.textContent = it.content;
        root.appendChild(el);
        // Questa sezione cresce quando arriva la spiegazione: guardare il contenuto è più corto
        // del ResizeObserver, e chi la riempie non deve saperlo (#500).
        crescite.push(el);
        if (typeof it.onMount === 'function') {
          try {
            const cleanup = it.onMount(el);
            if (typeof cleanup === 'function') cleanups.push(cleanup);
          } catch (e) { console.error(e); }
        }
        continue;
      }
      if (it.type === 'correction') {
        // Bottone composito: a sinistra la parola corretta (clic = applica), a destra una freccetta
        // col sotto-menu (dizionario, correggi automaticamente, gestisci correttore).
        const wrap = document.createElement('div');
        wrap.className = 'sn-menu-correction';
        keepPageFocus(wrap);
        if (it.disabled) wrap.classList.add('sn-disabled');
        if (it.loading) wrap.classList.add('sn-menu-correction-loading');
        if (it.id) wrap.id = it.id;

        // `hidden`: riga in display:none per riservare lo slot e rivelarlo con update(). Evita
        // il flash «Cerco una correzione…» prima di sapere se la parola è sbagliata.
        if (it.hidden) {
          wrap.style.display = 'none';
        }

        renderCorrection(wrap, it, cleanups);

        // Espone un updater al chiamante (per quando la correzione arriva async).
        if (typeof it.onMount === 'function') {
          try {
            const update = (newProps) => {
              if (!wrap.parentElement) return;
              if (newProps.remove) {
                const next = wrap.nextElementSibling;
                if (next?.classList.contains('sn-menu-sep')) next.remove();
                wrap.remove();
                return;
              }
              if (Object.prototype.hasOwnProperty.call(newProps, 'hidden')) {
                const hide = !!newProps.hidden;
                wrap.style.display = hide ? 'none' : '';
                // Solidale con il separatore successivo se è stato a sua volta
                // inserito come hidden (data-sn-hidden-sep).
                const sib = wrap.nextElementSibling;
                if (sib?.dataset?.snHiddenSep === '1') {
                  sib.style.display = hide ? 'none' : '';
                }
              }
              renderCorrection(wrap, { ...it, ...newProps }, cleanups);
            };
            const cleanup = it.onMount(wrap, update);
            if (typeof cleanup === 'function') cleanups.push(cleanup);
          } catch (e) { console.error(e); }
        }

        root.appendChild(wrap);
        continue;
      }
      if (it.type === 'split') {
        // Bottone generico: corpo cliccabile più freccetta col sotto-menu di varianti (subItems) —
        // «Spiega ▸ approfondisci», «Detta ▸ scegli modello».
        const wrap = document.createElement('div');
        wrap.className = 'sn-menu-split';
        if (it.disabled) wrap.classList.add('sn-disabled');

        const main = document.createElement('button');
        main.type = 'button';
        main.className = 'sn-menu-split-main';
        main.disabled = !!it.disabled;
        if (it.icon) {
          const ic = document.createElement('span');
          ic.className = 'sn-menu-split-icon';
          setIconContent(ic, it.icon);
          main.appendChild(ic);
        }
        const lbl = document.createElement('span');
        lbl.className = 'sn-menu-label';
        lbl.textContent = it.label;
        main.appendChild(lbl);
        if (it.shortcut) {
          const sc = document.createElement('span');
          sc.className = 'sn-menu-shortcut';
          sc.textContent = it.shortcut;
          main.appendChild(sc);
        }
        if (!it.disabled) {
          main.addEventListener('click', () => {
            close();
            try { it.onClick && it.onClick(); } catch (e) { console.error(e); }
          });
        }

        const arrow = document.createElement('button');
        arrow.type = 'button';
        arrow.className = 'sn-menu-split-arrow';
        arrow.title = it.arrowTitle || '';
        arrow.textContent = '▸';
        setupArrowSubmenu(arrow, () => openGenericSubmenu(arrow, it.subItems || []), cleanups);

        wrap.appendChild(main);
        wrap.appendChild(arrow);
        root.appendChild(wrap);
        continue;
      }
      if (it.type === 'paste') {
        const wrap = document.createElement('div');
        wrap.className = 'sn-menu-paste';
        if (it.disabled) wrap.classList.add('sn-disabled');

        const main = document.createElement('button');
        main.type = 'button';
        main.className = 'sn-menu-paste-main';
        main.disabled = !!it.disabled;
        const lbl = document.createElement('span');
        lbl.className = 'sn-menu-label';
        lbl.textContent = it.label;
        main.appendChild(lbl);
        if (it.shortcut) {
          const sc = document.createElement('span');
          sc.className = 'sn-menu-shortcut';
          sc.textContent = it.shortcut;
          main.appendChild(sc);
        }
        if (!it.disabled) {
          main.addEventListener('click', () => {
            close();
            try { it.onClick && it.onClick(); } catch (e) { console.error(e); }
          });
        }

        const arrow = document.createElement('button');
        arrow.type = 'button';
        arrow.className = 'sn-menu-paste-arrow';
        arrow.title = I18n.t('menu_paste_history');
        arrow.textContent = '▾';
        setupArrowSubmenu(arrow, () => openSubmenu(arrow, it.history || [], {
          onPick: it.onPickHistory,
          onRemove: it.onRemoveHistory,
          onClear: it.onClearHistory,
        }), cleanups);

        wrap.appendChild(main);
        wrap.appendChild(arrow);
        root.appendChild(wrap);
        continue;
      }
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'sn-menu-item';
      if (it.disabled) el.classList.add('sn-disabled');
      // Icona opzionale a sinistra dell'etichetta (stringa SVG dalle icone Filo).
      if (it.icon) {
        const ic = document.createElement('span');
        ic.className = 'sn-menu-item-icon';
        setIconContent(ic, it.icon);
        el.appendChild(ic);
        el.classList.add('sn-has-icon');
      }
      const lbl = document.createElement('span');
      lbl.className = 'sn-menu-label';
      lbl.textContent = it.label;
      el.appendChild(lbl);
      if (it.shortcut) {
        const sc = document.createElement('span');
        sc.className = 'sn-menu-shortcut';
        sc.textContent = it.shortcut;
        el.appendChild(sc);
      }
      if (it.tag) {
        const tag = document.createElement('span');
        tag.className = 'sn-menu-tag';
        tag.textContent = it.tag;
        el.appendChild(tag);
      }
      if (!it.disabled) {
        el.addEventListener('click', () => {
          close();
          try { it.onClick && it.onClick(); } catch (e) { console.error(e); }
        });
      }
      if (it.primaDaTastiera) el.dataset.snPrima = '1';
      root.appendChild(el);
    }

    monta(root);
    try { global.SN_POPUP?.sottoIlMenu?.(true); } catch (_) {}

    // I clic non attraversano il confine di un riquadro: chi ha un menu aperto dall'altra
    // parte non saprebbe di doverlo chiudere, e la regola è un menu solo (#405).
    try {
      const nested = window.top !== window.self || (window.frames && window.frames.length > 0);
      const T = global.SN_MSG?.MSG?.CLOSE_OTHER_MENUS;
      if (nested && T) Promise.resolve(chrome.runtime.sendMessage({ type: T })).catch(() => {});
    } catch (_) {}

    // Compensazione zoom (così il menu non scala con Ctrl+/-)
    const cleanupZoom = (global.SN_POPUP?.attachZoomCompensation || (() => () => {}))(root);

    place(root, x, y);
    sorveglia(root);

    // Posato, il menu non ha l'altezza definitiva: le sezioni dinamiche crescono quando
    // arriva la spiegazione, e misurando una volta sola l'ultima voce finiva tagliata (#500).
    const riposa = () => place(root, x, y, { keep: true });
    cleanups.push(Place.observeGrowth(root, riposa));
    // Le sezioni che si riempiono dopo si guardano da vicino: la mutazione arriva subito,
    // senza il ciclo di disegno; più richieste nello stesso fotogramma fanno una misura sola.
    if (crescite.length && typeof MutationObserver === 'function') {
      let inAttesa = false;
      const mo = new MutationObserver(() => {
        if (inAttesa) return;
        inAttesa = true;
        const giro = () => { inAttesa = false; if (root.isConnected) riposa(); };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(giro);
        else setTimeout(giro, 16);
      });
      for (const el of crescite) mo.observe(el, { childList: true, subtree: true, characterData: true });
      cleanups.push(() => { try { mo.disconnect(); } catch (_) {} });
    }

    const onDocClick = (e) => {
      if (root.contains(e.target)) return;
      if (nelSub(e.target)) return;
      close();
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') {
        if (activeMenu && activeMenu.root === root && tastoNelMenu(e, activeMenu)) { e.preventDefault(); e.stopPropagation(); }
        return;
      }
      close();
      // Quel tasto l'abbiamo usato noi: dichiararlo è ciò che tiene lo schermo
      // intero acceso mentre il menu si chiude (#514).
      e.preventDefault();
      e.stopPropagation();
    };
    const onScroll = (e) => {
      // Lo scroll DENTRO il menu non deve chiuderlo: il listener è in capture su window e vede
      // anche i discendenti, quindi la rotella sulla cronologia chiudeva il box.
      const t = e && e.target;
      if (t && t.nodeType === 1) {
        if (root.contains(t)) {
          // Il menu ha scorso sotto al pannello ancorato: la freccetta si è spostata e il pannello
          // va con lei, o si chiude se è uscita dal bordo (#500).
          try { dismissTooltip?.(); } catch (_) {}
          repositionSub();
          return;
        }
        if (nelSub(t)) return;
      }
      if (keepOnScroll) return;
      close();
    };
    // La finestra che si accorcia è lo stesso difetto dall'altro verso: il fondo del menu
    // finisce oltre il bordo. Si rifà il conto della posa invece di chiuderlo (#500).
    const onResize = () => {
      if (!root.isConnected) return;
      riposa();
    };

    document.addEventListener('mousedown', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize, true);

    activeMenu = {
      root, onDocClick, onKey, onScroll, onResize, cleanupZoom, cleanups,
      subRoot: null, subHost: null, subAnchor: null, subMode: null, opener, tastiera,
      ricerca: { t0: Date.now(), scelta: false },
    };
    document.addEventListener('click', sceltaDalClic, true);
    contaBox({ esito: 'aperta' });
    if (tastiera) {
      const voci = vociDaTastiera(root);
      const prima = voci.find((b) => b.dataset.snPrima === '1') || voci[0];
      if (prima) { try { prima.focus({ preventScroll: true }); } catch (_) {} }
    }
  }

  // Il mousedown non deve spostare il fuoco dal campo al bottone: il punto in cui si
  // scriveva, e la parola selezionata dal correttore, sparirebbero prima dell'azione.
  function keepPageFocus(el) {
    el.addEventListener('mousedown', (e) => { e.preventDefault(); });
  }

  // `cleanups` va passato esplicitamente: renderCorrection sta a livello di modulo e non
  // chiude sullo scope di open, o il menu di correzione solleva un errore.
  function renderCorrection(wrap, props, cleanups = []) {
    wrap.innerHTML = '';
    wrap.classList.toggle('sn-menu-correction-loading', !!props.loading);
    wrap.classList.toggle('sn-disabled', !!props.disabled);

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'sn-menu-correction-main';
    main.disabled = !!(props.disabled || props.loading);
    const lbl = document.createElement('span');
    lbl.className = 'sn-menu-label';
    lbl.textContent = props.label || '';
    main.appendChild(lbl);
    if (!props.loading && !props.disabled && typeof props.onClick === 'function') {
      main.addEventListener('click', () => {
        close();
        try { props.onClick(); } catch (e) { console.error(e); }
      });
    }
    wrap.appendChild(main);

    // `senzaFreccia`: una riga che non ha niente da approfondire non apre un riquadro vuoto.
    if (!props.loading && !props.senzaFreccia) {
      const arrow = document.createElement('button');
      arrow.type = 'button';
      arrow.className = 'sn-menu-correction-arrow';
      arrow.textContent = '▸';
      setupArrowSubmenu(arrow, () => openGenericSubmenu(arrow, props.subItems || []), cleanups);
      wrap.appendChild(arrow);
    }
    global.SN_FILO_UI?.soloGestiVeri(wrap);
  }

  // Sotto-menu generico (lista di {label, onClick}). Si ancora a `anchorEl`.
  function openGenericSubmenu(anchorEl, items) {
    if (!activeMenu) return;
    if (activeMenu.subRoot) staccaSub();
    const sub = document.createElement('div');
    sub.className = 'sn-menu sn-menu-sub';
    global.SN_FILO_UI?.mark(sub);
    global.SN_FILO_UI?.soloGestiVeri(sub);
    sub.dataset.snTheme = document.documentElement.dataset.snTheme || '';

    if (!items || items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sn-menu-empty';
      empty.textContent = '—';
      sub.appendChild(empty);
    } else {
      for (const sit of items) {
        if (sit.type === 'separator') {
          const sep = document.createElement('div');
          sep.className = 'sn-menu-sep';
          sub.appendChild(sep);
          continue;
        }
        if (sit.type === 'info') {
          // Riga informativa: testo non cliccabile (es. spiegazione di un errore blu).
          const info = document.createElement('div');
          info.className = 'sn-menu-info';
          info.textContent = sit.label || '';
          sub.appendChild(info);
          continue;
        }
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sn-menu-item';
        // Come per la riga di correzione: agire da qui non deve togliere il
        // fuoco (e quindi il punto in cui si scriveva) al campo sottostante.
        keepPageFocus(b);
        if (sit.disabled) b.classList.add('sn-disabled');
        const lbl = document.createElement('span');
        lbl.className = 'sn-menu-label';
        lbl.textContent = sit.label || '';
        b.appendChild(lbl);
        if (!sit.disabled) {
          b.addEventListener('click', () => {
            close();
            try { sit.onClick && sit.onClick(); } catch (e) { console.error(e); }
          });
        }
        sub.appendChild(b);
      }
    }

    monta(sub);
    const cleanupZoom = (global.SN_POPUP?.attachZoomCompensation || (() => () => {}))(sub);
    activeMenu.cleanups.push(cleanupZoom);
    activeMenu.subRoot = sub;
    activeMenu.subAnchor = anchorEl;
    activeMenu.subMode = 'anchor';

    placeSub(sub, anchorEl, 'anchor');
    sorveglia(sub);
    attachSubmenuHover(sub);
  }

  // La cronologia degli appunti arriva da altri siti e da altre app, password comprese: nel documento del sito
  // entra solo un host vuoto, il pannello sta in uno shadow root chiuso che lo script della pagina non
  // attraversa (#589.8). I fogli di stile del documento lì dentro non arrivano: si portano i nostri.
  const HOST_CHIUSO = 'all:initial!important;display:block!important;position:fixed!important;'
    + 'top:0!important;left:0!important;width:0!important;height:0!important;z-index:2147483646!important;';
  // Un font chiamato per nome il sito lo ridefinisce col suo, e dai pezzi che il browser carica sa quali caratteri
  // ha disegnato il pannello (#589.8): sui siti solo famiglie generiche, che nessun @font-face rimpiazza.
  const PAGINA_DI_FILO = (() => { try { return location.protocol === 'filo:'; } catch (_) { return false; } })();
  const FONT_SOLO_GENERICO = '\n.sn-menu, .sn-menu *, .sn-menu ::before, .sn-menu ::after, .sn-menu ::placeholder'
    + ' { font-family: system-ui, sans-serif !important; }\n';
  let fogli = null;
  function fogliDelMenu() {
    if (fogli) return fogli;
    let testo = '';
    try {
      const fs = require('node:fs');
      const path = require('node:path');
      testo = ['theme.css', 'menu.css']
        .map((f) => fs.readFileSync(path.join(__dirname, '..', 'styles', f), 'utf8')).join('\n');
    } catch (_) {}
    if (!PAGINA_DI_FILO) testo += FONT_SOLO_GENERICO;
    const foglio = new CSSStyleSheet();
    try { foglio.replaceSync(testo); } catch (_) {}
    fogli = [foglio];
    return fogli;
  }
  // Nello strato di Filo sopra la scheda (#1054) non c'è un sito da cui chiuderla: il pannello sta nel documento.
  const NELLO_STRATO = (() => { try { return location.href.startsWith('filo://menu/'); } catch (_) { return false; } })();
  function pannelloChiuso(contenuto) {
    if (NELLO_STRATO) return contenuto;
    const host = document.createElement('div');
    global.SN_FILO_UI?.mark(host);
    host.style.cssText = HOST_CHIUSO;
    const ombra = global.SN_FILO_UI?.ombra ? global.SN_FILO_UI.ombra(host) : host.attachShadow({ mode: 'closed' });
    try { ombra.adoptedStyleSheets = fogliDelMenu(); } catch (_) {}
    ombra.appendChild(contenuto);
    return host;
  }

  // Il testo di una voce della cronologia (password e testi di altri siti) non diventa MAI un nodo di testo nel
  // documento del sito: la ricerca del browser (window.find) attraversa anche lo shadow chiuso e leggerebbe un
  // nodo lettera per lettera (#589.8). Lo rendiamo come contenuto generato da una proprietà posata sull'elemento
  // dentro lo shadow chiuso — glifi, non testo cercabile — e il nome accessibile sta in un attributo, che la
  // ricerca non trova e che il sito non legge oltre il confine dello shadow chiuso.
  function cssString(s) {
    let out = '"';
    for (const ch of String(s)) {
      const c = ch.codePointAt(0);
      if (ch === '"' || ch === '\\') out += '\\' + ch;
      else if (c < 0x20 || c === 0x7f) out += '\\' + c.toString(16) + ' ';
      else out += ch;
    }
    return out + '"';
  }
  function testoNascosto(labelEl, btnEl, s) {
    labelEl.classList.add('sn-menu-gentesto');
    labelEl.style.setProperty('--sn-gentesto', cssString(s));
    if (btnEl) btnEl.setAttribute('aria-label', s);
  }

  // Sotto-menu cronologia incolla. Si ancora alla freccetta.
  // `handlers` può essere una funzione (retrocompat: solo onPick) o un oggetto
  // { onPick, onRemove, onClear }.
  function openSubmenu(anchorEl, entries, handlers) {
    const onPick = typeof handlers === 'function' ? handlers : (handlers && handlers.onPick);
    const onRemove = handlers && typeof handlers === 'object' ? handlers.onRemove : null;
    const onClear = handlers && typeof handlers === 'object' ? handlers.onClear : null;
    if (!activeMenu) return;
    if (activeMenu.subRoot) staccaSub();
    const sub = document.createElement('div');
    sub.className = 'sn-menu sn-menu-sub';
    global.SN_FILO_UI?.soloGestiVeri(sub);
    sub.dataset.snTheme = document.documentElement.dataset.snTheme || '';

    if (!entries || entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sn-menu-empty';
      empty.textContent = I18n.t('toast_clipboard_empty');
      sub.appendChild(empty);
    } else {
      sub.classList.add('sn-menu-history-sub');

      const list = document.createElement('div');
      list.className = 'sn-menu-history-list';

      // Come si legge una voce: la decide il modulo condiviso della cronologia
      // appunti, così menu e pagina della Sicurezza non divergono.
      const Clip = global.SN_CLIPBOARD;
      const searchTextOf = (entry) => Clip.etichetta(entry).replace(/\s+/g, ' ').trim();

      // noResults = nessuna corrispondenza nella ricerca; emptyMsg = l'utente ha rimosso tutte le
      // voci. Creati prima così i gestori possono riferirli.
      const noResults = document.createElement('div');
      noResults.className = 'sn-menu-empty';
      noResults.textContent = I18n.t('menu_paste_no_results');
      noResults.style.display = 'none';
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'sn-menu-empty';
      emptyMsg.textContent = I18n.t('toast_clipboard_empty');
      emptyMsg.style.display = 'none';

      const searchWrap = document.createElement('div');
      searchWrap.className = 'sn-menu-history-search';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'sn-menu-history-search-input';
      input.placeholder = I18n.t('menu_paste_search');
      input.setAttribute('aria-label', input.placeholder);

      let clearWrap = null;

      // La ricerca nella cronologia, per i contatori (#1461): conta da quando ci si scrive o si sceglie una voce, con
      // l'attesa dall'apertura e la posizione fra le voci in vista; chiusa senza scelta, è una ricerca a vuoto.
      const ricerca = { t0: Date.now(), iniziata: false, scelta: false };
      const contaRicerca = (ev) => contaNelMenu({ misura: 'ricerca', pannello: 'incolla', ...ev });
      const iniziaRicerca = () => {
        if (ricerca.iniziata) return;
        ricerca.iniziata = true;
        contaRicerca({ esito: 'aperta' });
      };
      const sceltaFatta = (row) => {
        iniziaRicerca();
        ricerca.scelta = true;
        const vive = [...list.querySelectorAll('.sn-menu-history-item')]
          .filter((r) => r.style.display !== 'none' && !r.classList.contains('sn-menu-history-gone'));
        const i = vive.indexOf(row);
        contaRicerca({ esito: 'scelta', attesaMs: Date.now() - ricerca.t0, posizione: i >= 0 ? i + 1 : null });
        sceltaNelMenu(row);
      };
      activeMenu.subAllaChiusura = () => { if (ricerca.iniziata && !ricerca.scelta) contaRicerca({ esito: 'vuota' }); };

      // Quando l'utente rimuove l'ultima voce: mostra lo stato vuoto e nascondi
      // ricerca/svuota (non c'è più nulla da cercare o svuotare). Le righe già
      // tolte restano a schermo barrate, quindi non contano.
      const refreshEmptyState = () => {
        if (list.querySelector('.sn-menu-history-item:not(.sn-menu-history-gone)')) return;
        noResults.style.display = 'none';
        emptyMsg.style.display = '';
        searchWrap.style.display = 'none';
        if (clearWrap) clearWrap.style.display = 'none';
      };

      // La rimozione deve valere anche per la LISTA che il menu tiene in mano,
      // non solo per la riga a schermo. `entries` è lo stesso array che il menu
      // padre ripassa a ogni riapertura del sotto-menu (la cronologia viene
      // letta una volta sola, quando si apre il menu del tasto destro): se
      // togliamo solo il nodo dal DOM, basta che il sotto-menu si richiuda
      // (mouse fuori) e si riapra perché la voce appena rimossa RICOMPAIA — la
      // rimozione è avvenuta davvero sul disco, ma la UI dice il contrario, e su
      // una password copiata è la bugia peggiore possibile. Quindi la togliamo
      // anche di lì, così le due viste restano d'accordo.
      // Si dimenticano tutte le voci con la stessa chiave: chi tiene la
      // cronologia su disco le toglie tutte insieme (le gemelle che lascia
      // «Importa dati»), e il menu deve dire lo stesso.
      const forgetEntry = (entry) => {
        if (!Array.isArray(entries)) return;
        const k = Clip.chiave(entry);
        for (let i = entries.length - 1; i >= 0; i--) {
          if (Clip.chiave(entries[i]) === k) entries.splice(i, 1);
        }
      };

      // Quante voci VIVE la ricerca sta mostrando IN QUESTO MOMENTO: le righe
      // già tolte restano a schermo barrate ma non contano più. Si conta
      // guardando la lista invece di tenere un numero a parte che qualcuno deve
      // ricordarsi di aggiornare: quel numero partiva da zero e nessuno lo
      // toccava finché non scrivevi nel campo di ricerca, così la conferma
      // dello svuotamento parlava di una ricerca mai scritta (#256).
      // Ritorna null quando NON c'è nessuna ricerca in corso: è il modo di dire
      // "della ricerca non parlarne".
      const visibiliVive = () => {
        if (!input.value.trim()) return null;
        let n = 0;
        for (const b of list.querySelectorAll('.sn-menu-history-item')) {
          if (b.style.display === 'none') continue;
          if (b.classList.contains('sn-menu-history-gone')) continue;
          n++;
        }
        return n;
      };

      // Il filtro si riapplica dopo una rimozione: togliendo l'unica voce trovata la lista
      // resterebbe muta invece di dire che quella ricerca non ha più risultati.
      const applyFilter = () => {
        const q = input.value.trim().toLowerCase();
        let visible = 0;
        for (const b of list.querySelectorAll('.sn-menu-history-item')) {
          const match = !q || (b.dataset.snSearch || '').includes(q);
          b.style.display = match ? '' : 'none';
          if (match && !b.classList.contains('sn-menu-history-gone')) visible++;
        }
        noResults.style.display = visible === 0 ? '' : 'none';
      };

      // Dove va il fuoco dopo aver tolto una voce col tasto Invio: sulla "×"
      // della prima voce ancora viva DOPO quella tolta (a scorrere in giù, poi
      // in su), e se non ne resta nessuna sul campo di ricerca. Le righe tolte
      // e quelle nascoste dal filtro si saltano: non sono cose che si possono
      // premere.
      const fuocoDopoRimozione = (rowTolta) => {
        const righe = [...list.querySelectorAll('.sn-menu-history-item')];
        const i = righe.indexOf(rowTolta);
        const utile = (r) => r
          && r.style.display !== 'none'
          && !r.classList.contains('sn-menu-history-gone')
          && r.querySelector('.sn-menu-history-remove');
        const candidate = [...righe.slice(i + 1), ...righe.slice(0, Math.max(i, 0)).reverse()];
        const prossima = candidate.find(utile);
        const target = prossima
          ? prossima.querySelector('.sn-menu-history-remove')
          : input;
        try { target.focus({ preventScroll: true }); } catch (_) { try { target.focus(); } catch (__) {} }
      };

      entries.forEach((entry) => {
        // Riga = zona "incolla" (a sinistra) + "×" rimuovi (a destra). Sono due
        // bottoni fratelli, non annidati: il "×" non fa scattare l'incolla.
        const row = document.createElement('div');
        row.className = 'sn-menu-history-item';
        row.dataset.snSearch = searchTextOf(entry).toLowerCase();
        row.dataset.snKey = Clip.chiave(entry);

        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sn-menu-item sn-menu-history-paste';
        if (entry.type === 'image') {
          const icon = document.createElement('span');
          icon.className = 'sn-menu-history-icon';
          const iconaGenerica = () => {
            const img = global.SN_ICONS?.image;
            if (img) icon.innerHTML = img(16);
            else icon.textContent = '🖼';
          };
          // Due immagini copiate diverse con la stessa iconcina e la stessa
          // parola "Immagine" si leggono uguali: con la "×" accanto, che
          // cancella per sempre, non si sa quale delle due si sta buttando. La
          // miniatura c'è già nella pagina della Sicurezza ed è quella che
          // toglie il dubbio. Se la pagina ospite vieta le immagini `data:`
          // (CSP), l'`onerror` rimette l'iconcina di prima.
          if (entry.dataUrl) {
            const thumb = document.createElement('img');
            thumb.className = 'sn-menu-history-thumb';
            thumb.alt = '';
            thumb.addEventListener('error', () => { thumb.remove(); iconaGenerica(); });
            thumb.src = entry.dataUrl;
            icon.appendChild(thumb);
          } else {
            iconaGenerica();
          }
          const desc = document.createElement('span');
          desc.className = 'sn-menu-label';
          testoNascosto(desc, b, Clip.etichetta(entry));
          b.appendChild(icon);
          b.appendChild(desc);
        } else {
          const lbl = document.createElement('span');
          lbl.className = 'sn-menu-label';
          const mostrato = Clip.etichetta(entry);
          testoNascosto(lbl, b, mostrato.length > 40 ? mostrato.slice(0, 40) + '…' : mostrato);
          b.appendChild(lbl);
        }
        b.addEventListener('click', () => {
          sceltaFatta(row);
          close();
          try { onPick && onPick(entry); } catch (e) { console.error(e); }
        });
        row.appendChild(b);

        if (onRemove) {
          const rm = document.createElement('button');
          rm.type = 'button';
          rm.className = 'sn-menu-history-remove';
          rm.textContent = '×';
          rm.title = I18n.t('menu_paste_remove');
          rm.setAttribute('aria-label', I18n.t('menu_paste_remove'));
          rm.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (row.classList.contains('sn-menu-history-gone')) return;
            try { onRemove(entry); } catch (e) { console.error(e); }
            forgetEntry(entry);
            // La riga NON sparisce: resta al suo posto barrata finché il
            // sotto-menu è aperto. Toglierla ricompattava la lista e faceva
            // salire di una posizione tutte quelle sotto, così il secondo clic
            // di un doppio clic colpiva la voce vicina e la cancellava anche
            // lei, per sempre e senza dirlo.
            // Chi ha premuto col TASTO INVIO non deve restare senza niente
            // sotto le dita: disabilitare il bottone che ha il fuoco lo
            // rimanda al corpo della pagina, e per togliere la voce dopo
            // toccherebbe ricominciare il giro col tabulatore. Il fuoco passa
            // alla "×" della prima voce ancora viva dopo questa, o al campo di
            // ricerca se non ne resta nessuna.
            // `detail === 0` distingue Invio/Barra dal clic del mouse: col
            // mouse il fuoco non si sposta, o comparirebbe un anello di fuoco
            // sulla riga vicina a ogni clic.
            // Nello shadow chiuso (#589.8) il documento vede solo l'ospite: il fuoco si chiede alla radice del bottone.
            const avevaFuoco = ev.detail === 0 && rm.getRootNode().activeElement === rm;
            for (const gemella of list.querySelectorAll('.sn-menu-history-item')) {
              if (gemella.dataset.snKey !== row.dataset.snKey) continue;
              gemella.classList.add('sn-menu-history-gone');
              gemella.querySelectorAll('button').forEach((x) => { x.disabled = true; });
              const x = gemella.querySelector('.sn-menu-history-remove');
              if (x) {
                x.title = I18n.t('menu_paste_removed');
                x.setAttribute('aria-label', I18n.t('menu_paste_removed'));
              }
            }
            applyFilter();
            refreshEmptyState();
            if (avevaFuoco) fuocoDopoRimozione(row);
          });
          row.appendChild(rm);
        }
        list.appendChild(row);
      });
      list.appendChild(noResults);
      list.appendChild(emptyMsg);
      sub.appendChild(list);

      // Mentre l'utente cerca, non far chiudere il sotto-menu (mouse fuori).
      input.addEventListener('focus', () => {
        if (activeMenu) activeMenu.subLocked = true;
        clearSubCloseTimer();
      });
      input.addEventListener('blur', () => { if (activeMenu) activeMenu.subLocked = false; });
      input.addEventListener('input', applyFilter);
      input.addEventListener('input', iniziaRicerca);
      searchWrap.appendChild(input);
      sub.appendChild(searchWrap);

      // Svuota cronologia: azione distruttiva → conferma prima di eseguire.
      if (onClear) {
        clearWrap = document.createElement('div');
        clearWrap.className = 'sn-menu-history-clear';
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'sn-menu-item sn-menu-history-clear-btn';
        const cl = document.createElement('span');
        cl.className = 'sn-menu-label';
        cl.textContent = I18n.t('menu_paste_clear');
        clearBtn.appendChild(cl);
        // Non chiudere il sotto-menu mentre è aperto il popup di conferma.
        clearBtn.addEventListener('mousedown', () => {
          if (activeMenu) activeMenu.subLocked = true;
          clearSubCloseTimer();
        });
        clearBtn.addEventListener('click', async () => {
          const Ui = global.SN_CONFIRM_UI;
          let ok = true;
          try {
            // La conferma dice QUANTE voci spariscono, e se la ricerca ne sta
            // nascondendo una parte lo dichiara: con un filtro attivo la lista
            // ne mostrava una e lo svuotamento le portava via tutte.
            const testo = Clip.testoConferma(
              Array.isArray(entries) ? entries.length : 0,
              visibiliVive(),
            );
            ok = Ui
              ? await Ui.confirm({ title: I18n.t('menu_paste_clear'), text: testo })
              : true;
          } catch (_) { ok = false; }
          if (activeMenu) activeMenu.subLocked = false;
          if (!ok) return;
          try { onClear(); } catch (e) { console.error(e); }
          // Come in forgetEntry: la lista in mano al menu non deve sopravvivere allo svuotamento.
          if (Array.isArray(entries)) entries.length = 0;
          close();
        });
        clearWrap.appendChild(clearBtn);
        sub.appendChild(clearWrap);
      }

      setTimeout(() => { try { input.focus({ preventScroll: true }); } catch (_) {} }, 0);
    }

    const host = pannelloChiuso(sub);
    monta(host);
    // Compensazione zoom anche per il sub-menu
    const cleanupZoom = (global.SN_POPUP?.attachZoomCompensation || (() => () => {}))(sub);
    activeMenu.cleanups.push(cleanupZoom);
    activeMenu.subRoot = sub;
    activeMenu.subHost = host;

    // La cronologia incolla è ATTACCATA al bordo del menu con un leggero overlap, non
    // ancorata alla freccetta con un gap: si leggono come un pezzo solo.
    activeMenu.subAnchor = anchorEl;
    activeMenu.subMode = 'edge';
    placeSub(sub, anchorEl, 'edge');
    sorveglia(sub, host);
    attachSubmenuHover(sub);
  }

  // Griglia del pannello «Altro…»: ancorata a un bottone ma NON chiude il menu padre, e
  // regge il drag fra griglia secondaria e riga principale.
  function openIconGridSubmenu(anchorEl, items, opts = {}) {
    if (!activeMenu) return;
    if (activeMenu.subRoot) {
      staccaSub();
      return;
    }
    contaGesto('altro_del_menu', { aperto: true });
    const cols = opts.cols || 4;
    const sub = document.createElement('div');
    sub.className = 'sn-menu sn-menu-sub sn-menu-icon-grid';
    global.SN_FILO_UI?.mark(sub);
    global.SN_FILO_UI?.soloGestiVeri(sub);
    sub.dataset.snTheme = document.documentElement.dataset.snTheme || '';
    sub.style.setProperty('--sn-icon-cols', String(cols));
    if (opts.dropTarget) sub.dataset.snDropTarget = opts.dropTarget;

    populateGrid(sub, items, { dropTarget: opts.dropTarget });
    if (opts.dropTarget) attachDropZone(sub, { target: opts.dropTarget, onDrop: opts.onDrop });

    monta(sub);
    const cleanupZoom = (global.SN_POPUP?.attachZoomCompensation || (() => () => {}))(sub);
    activeMenu.cleanups.push(cleanupZoom);
    activeMenu.subRoot = sub;
    activeMenu.subAnchor = anchorEl;
    activeMenu.subMode = 'anchor';

    placeSub(sub, anchorEl, 'anchor');
    sorveglia(sub);
    // Senza questo, il timer di mouseleave sull'ancora (overflow) chiude il
    // sub-menu appena il cursore entra nella griglia (feedback alpha).
    attachSubmenuHover(sub);
  }

  // Tooltip custom in stile menu, singleton globale.
  let tooltipEl = null;
  let tooltipHideTimer = null;
  function ensureTooltipEl() {
    if (tooltipEl && document.documentElement.contains(tooltipEl)) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'sn-tooltip';
    global.SN_FILO_UI?.mark(tooltipEl);
    tooltipEl.style.display = 'none';
    monta(tooltipEl);
    return tooltipEl;
  }
  function showTooltip(target, text) {
    if (!text) return;
    const el = ensureTooltipEl();
    // Sopra i pannelli aperti dopo di lei (stesso piano: vale l'ordine), sotto le sonde (#589.11).
    const host = menuHost();
    annullaZoom(el, host);
    host.insertBefore(el, global.SN_VISTO?.prima(host, el) || null);
    el.dataset.snTheme = document.documentElement.dataset.snTheme || '';
    el.textContent = text;
    el.style.display = '';
    const r = target.getBoundingClientRect();
    const tw = el.offsetWidth, th = el.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    let top = r.bottom + 6;
    if (top + th + 8 > window.innerHeight) top = r.top - th - 6;
    if (left + tw + 4 > window.innerWidth) left = window.innerWidth - tw - 4;
    if (left < 4) left = 4;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }
  function hideTooltip() {
    if (!tooltipEl) return;
    tooltipEl.style.display = 'none';
  }
  // Toglie l'etichetta e l'attesa che sta per farla comparire: se a muoversi è il menu,
  // comparirebbe l'etichetta di un bottone che nel frattempo è altrove.
  function dismissTooltip() {
    clearTimeout(tooltipHideTimer);
    tooltipHideTimer = null;
    hideTooltip();
  }
  function attachTooltip(el, text) {
    el.addEventListener('mouseenter', () => {
      clearTimeout(tooltipHideTimer);
      tooltipHideTimer = setTimeout(() => {
        showTooltip(el, text);
        if (el.dataset.snIconId) lettura.mostrato(el.dataset.snIconId, 'menu');
      }, 250);
    });
    el.addEventListener('mouseleave', () => {
      dismissTooltip();
      lettura.via();
    });
    el.addEventListener('mousedown', () => {
      dismissTooltip();
    });
  }

  // ============================================================================
  // Costruzione bottoni della riga icone / griglia secondaria (estratti per
  // poter rigenerare in-place dopo un drag senza chiudere il menu).
  // ============================================================================
  // Chi apre un pannello sostando sopra durante un trascinamento: chiamato da qui, perché un clic
  // fabbricato da codice non passerebbe da `soloGestiVeri`.
  const apritori = new WeakMap();

  // Il suggerimento di un'icona nomina anche il suo tasto, se ne ha uno (`tasto`, chiesto a SN_TASTI).
  function conTasto(it) { return it.tasto ? `${it.label} (${it.tasto})` : it.label; }

  function makeRowButton(sub, opts = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sn-menu-row-btn';
    if (sub.kind === 'overflow') b.classList.add('sn-menu-row-overflow');
    if (sub.kind === 'empty') b.classList.add('sn-menu-row-empty');
    // Disabilitazione «soft» con una classe: l'attributo `disabled` azzera i pointer event e
    // impedirebbe di trascinare l'icona. Il click lo neutralizza il guard più sotto.
    if (sub.disabled) { b.classList.add('sn-menu-btn-disabled'); b.dataset.snDisabled = '1'; }
    // L'overflow apre subito un sotto-menu su hover: non mostrare il tooltip
    // "Altro…" che altrimenti coprirebbe/preannuncerebbe la stessa cosa.
    if (sub.kind !== 'empty' && sub.kind !== 'overflow' && sub.label) attachTooltip(b, conTasto(sub));
    setIconContent(b, sub.icon || sub.label);
    // Il bottone contiene solo un disegno: senza nome accessibile è un bottone
    // muto per chi legge lo schermo (e invisibile a chi lo cerca per etichetta).
    if (sub.label) b.setAttribute('aria-label', sub.label);
    if (sub.id) b.dataset.snIconId = sub.id;
    if (sub.kind === 'overflow') {
      // L'overflow apre la griglia secondaria come sotto-menu ancorato, senza chiudere il menu
      // principale; durante un drag è hover-target e si apre da sé.
      b.dataset.snDragHoverOpen = '1';
      const openOverflow = () => {
        if (sub.disabled) return;
        try { sub.onClick && sub.onClick(b); } catch (er) { console.error(er); }
        if (activeMenu) activeMenu.subOwner = b;
      };
      b.addEventListener('mouseenter', () => {
        clearSubCloseTimer();
        if (activeMenu?.subRoot && activeMenu.subOwner !== b) {
          activeMenu.subLocked = false;
          closeSubmenu();
        }
        if (!activeMenu?.subRoot) openOverflow();
      });
      b.addEventListener('mouseleave', () => {
        if (activeMenu?.subLocked) return;
        clearSubCloseTimer();
        subCloseTimer = setTimeout(() => closeSubmenu(), 500);
      });
      const apriFermo = () => {
        clearSubCloseTimer();
        if (activeMenu?.subRoot && activeMenu.subOwner === b) {
          activeMenu.subLocked = true;
        } else {
          if (activeMenu?.subRoot) closeSubmenu();
          openOverflow();
          if (activeMenu) activeMenu.subLocked = true;
        }
      };
      apritori.set(b, apriFermo);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        apriFermo();
      });
    } else {
      b.addEventListener('click', () => {
        if (sub.kind === 'empty') return;
        if (sub.disabled) return; // greyed: niente azione (ma resta trascinabile)
        if (sub.id) lettura.clic(sub.id);
        close();
        try { sub.onClick && sub.onClick(); } catch (er) { console.error(er); }
      });
    }
    if (sub.draggable && sub.id) attachDrag(b, { id: sub.id, source: opts.dropTarget || 'row' });
    return b;
  }

  function populateRow(row, items, opts = {}) {
    row.innerHTML = '';
    row.__snRowOpts = opts;
    for (const sub of items) row.appendChild(makeRowButton(sub, opts));
    global.SN_FILO_UI?.soloGestiVeri(row);
  }

  function makeGridButton(it, opts = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sn-menu-icon-btn';
    // Vedi makeRowButton: disabilitazione via classe per restare trascinabile.
    if (it.disabled) { b.classList.add('sn-menu-btn-disabled'); b.dataset.snDisabled = '1'; }
    setIconContent(b, it.icon || it.label || '');
    if (it.id) b.dataset.snIconId = it.id;
    // Vedi makeRowButton: nome accessibile su un bottone di sola icona.
    if (it.label) { b.setAttribute('aria-label', it.label); attachTooltip(b, conTasto(it)); }
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (it.disabled) return;
      if (it.id) { lettura.clic(it.id); contaGesto('altro_del_menu', { icona: it.id }); }
      close();
      try { it.onClick && it.onClick(); } catch (er) { console.error(er); }
    });
    if (it.draggable !== false && it.id) attachDrag(b, { id: it.id, source: opts.dropTarget || 'grid' });
    return b;
  }

  function populateGrid(sub, items, opts = {}) {
    sub.innerHTML = '';
    sub.__snGridOpts = opts;
    if (!items || items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sn-menu-empty';
      empty.textContent = '—';
      sub.appendChild(empty);
    } else {
      for (const it of items) sub.appendChild(makeGridButton(it, opts));
    }
    global.SN_FILO_UI?.soloGestiVeri(sub);
  }

  function refreshIconRow(items) {
    if (!activeMenu) return;
    const row = activeMenu.root.querySelector('.sn-menu-row');
    if (!row) return;
    populateRow(row, items, row.__snRowOpts || {});
  }

  function refreshIconGrid(items) {
    if (!activeMenu || !activeMenu.subRoot) return;
    populateGrid(activeMenu.subRoot, items, activeMenu.subRoot.__snGridOpts || {});
  }

  function isSubMenuOpen() {
    return !!(activeMenu && activeMenu.subRoot && activeMenu.subRoot.isConnected);
  }

  // Drag pointer-based: quello HTML5 non parte in modo affidabile con un transform sul
  // menu o su un <button>, e l'immagine di trascinamento spesso non si vede.
  const dropZones = [];

  // La barra laterale come zona in più (#871): la installa menuIcons.js. Il puntatore resta della
  // pagina per tutto il gesto, anche sopra la barra, quindi è da qui che si dice dove cade.
  let ponteBarra = null;
  function setPonteBarra(p) { ponteBarra = p || null; }
  // Dove comincia il menu aperto: se sta dove si apre la barra, lei aspetta che il puntatore vada al bordo.
  function sinistraDelMenu() {
    const els = [activeMenu?.root, activeMenu?.subRoot].filter((e) => e && e.isConnected);
    return els.length ? Math.min(...els.map((e) => e.getBoundingClientRect().left)) : null;
  }

  function attachDrag(el, { id, source }) {
    el.dataset.snDraggable = '1';
    el.addEventListener('pointerdown', (ev) => {
      // Solo gesti veri: un trascinamento finto aprirebbe la barra a comando di un sito.
      if (!ev.isTrusted || ev.button !== 0) return;
      if (el.disabled) return;
      const startX = ev.clientX, startY = ev.clientY;
      let dragging = false;
      let preview = null;
      let lastHoverZone = null;
      let lastHoverOpener = null;
      let hoverOpenTimer = null;
      const THRESHOLD = 4;
      const HOVER_OPEN_DELAY = 350;

      const updatePreview = (x, y) => {
        if (!preview) return;
        const w = preview.offsetWidth || 0;
        const h = preview.offsetHeight || 0;
        preview.style.left = (x - w / 2) + 'px';
        preview.style.top = (y - h / 2) + 'px';
      };

      const setHover = (zone) => {
        if (lastHoverZone === zone) return;
        if (lastHoverZone) lastHoverZone.zoneEl.classList.remove('sn-drop-hover');
        lastHoverZone = zone;
        if (zone) zone.zoneEl.classList.add('sn-drop-hover');
      };

      const startDrag = (x, y) => {
        dragging = true;
        try { dismissTooltip?.(); } catch (_) {}
        el.classList.add('sn-dragging');
        preview = el.cloneNode(true);
        preview.classList.add('sn-drag-preview');
        const r = el.getBoundingClientRect();
        preview.style.width = r.width + 'px';
        preview.style.height = r.height + 'px';
        monta(preview);
        updatePreview(x, y);
        try { ponteBarra?.inizio(id, sinistraDelMenu()); } catch (_) {}
      };

      const checkHoverOpen = (x, y) => {
        // Apre automaticamente l'overflow (e simili) se l'utente sosta sopra
        // il loro bottone durante un drag.
        if (preview) preview.style.visibility = 'hidden';
        const elAt = document.elementFromPoint(x, y);
        if (preview) preview.style.visibility = '';
        const opener = elAt && elAt.closest ? elAt.closest('[data-sn-drag-hover-open="1"]') : null;
        if (opener === lastHoverOpener) return;
        lastHoverOpener = opener;
        if (hoverOpenTimer) { clearTimeout(hoverOpenTimer); hoverOpenTimer = null; }
        if (opener && !isSubMenuOpen()) {
          hoverOpenTimer = setTimeout(() => {
            if (lastHoverOpener === opener && !isSubMenuOpen()) {
              try { apritori.get(opener)?.(); } catch (_) {}
            }
          }, HOVER_OPEN_DELAY);
        }
      };

      const onMove = (e) => {
        if (!e.isTrusted) return;
        if (!dragging) {
          if (Math.hypot(e.clientX - startX, e.clientY - startY) < THRESHOLD) return;
          startDrag(e.clientX, e.clientY);
        }
        e.preventDefault();
        updatePreview(e.clientX, e.clientY);
        let sopraBarra = false;
        try { sopraBarra = !!ponteBarra?.sopra(e.clientX, e.clientY); } catch (_) {}
        setHover(sopraBarra ? null : findZoneAt(e.clientX, e.clientY));
        checkHoverOpen(e.clientX, e.clientY);
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('pointercancel', onCancel, true);
        if (hoverOpenTimer) { clearTimeout(hoverOpenTimer); hoverOpenTimer = null; }
        el.classList.remove('sn-dragging');
        setHover(null);
        if (preview) { try { preview.remove(); } catch (_) {} preview = null; }
        if (dragging) { try { ponteBarra?.fine(); } catch (_) {} }
      };

      const onUp = (e) => {
        if (!e.isTrusted) return;
        if (!dragging) { cleanup(); return; }
        let inBarra = false;
        try { inBarra = !!ponteBarra?.posa(id, e.clientX, e.clientY); } catch (_) {}
        const zone = inBarra ? null : findZoneAt(e.clientX, e.clientY);
        cleanup();
        if (zone) {
          const beforeBtn = findInsertBefore(zone.zoneEl, e.clientX, e.clientY, el);
          const beforeId = beforeBtn?.dataset?.snIconId || null;
          try { zone.onDrop && zone.onDrop({ id, source, target: zone.target, beforeId }); } catch (er) { console.error(er); }
        } else if (!inBarra) contaGesto('trascinamento', { da: 'icona_menu', a: 'nessuna', esito: 'annullato' });
        // Sopprime il click che segue il pointerup dopo un drag.
        const swallow = (ce) => { ce.stopPropagation(); ce.preventDefault(); };
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => { try { window.removeEventListener('click', swallow, true); } catch (_) {} }, 50);
      };

      const onCancel = () => {
        if (dragging) contaGesto('trascinamento', { da: 'icona_menu', a: 'nessuna', esito: 'annullato' });
        cleanup();
      };

      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onCancel, true);
    });
  }

  // Un'icona trascinata fuori dalla barra laterale, sopra questa pagina: il gesto è della barra,
  // qui arrivano solo le coordinate. Se il menu è aperto, cade nelle sue zone.
  let esterno = null;
  function trascinaDaFuori({ fase, id, x, y, icon }) {
    const via = () => {
      if (!esterno) return;
      if (esterno.zona) esterno.zona.zoneEl.classList.remove('sn-drop-hover');
      try { esterno.preview.remove(); } catch (_) {}
      esterno = null;
    };
    if (fase === 'muovi') {
      if (!esterno || esterno.id !== id) {
        via();
        const preview = document.createElement('div');
        preview.className = 'sn-drag-preview';
        preview.style.width = '36px';
        preview.style.height = '36px';
        preview.innerHTML = icon || '';
        monta(preview);
        esterno = { id, preview, zona: null };
      }
      esterno.preview.style.left = (x - 18) + 'px';
      esterno.preview.style.top = (y - 18) + 'px';
      const zona = findZoneAt(x, y);
      if (zona !== esterno.zona) {
        if (esterno.zona) esterno.zona.zoneEl.classList.remove('sn-drop-hover');
        if (zona) zona.zoneEl.classList.add('sn-drop-hover');
        esterno.zona = zona;
      }
      return true;
    }
    if (fase === 'rilascia') {
      const zona = findZoneAt(x, y);
      via();
      if (!zona) { contaGesto('trascinamento', { da: 'icona_barra', a: 'nessuna', esito: 'annullato' }); return false; }
      const prima = findInsertBefore(zona.zoneEl, x, y, null);
      try { zona.onDrop && zona.onDrop({ id, source: 'bar', target: zona.target, beforeId: prima?.dataset?.snIconId || null }); } catch (er) { console.error(er); }
      return true;
    }
    via();
    return false;
  }

  function attachDropZone(zoneEl, { target, onDrop }) {
    dropZones.push({ zoneEl, target, onDrop });
  }

  function findZoneAt(x, y) {
    for (let i = dropZones.length - 1; i >= 0; i--) {
      const z = dropZones[i];
      if (!document.documentElement.contains(z.zoneEl)) {
        dropZones.splice(i, 1);
        continue;
      }
      const r = z.zoneEl.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return z;
    }
    return null;
  }

  // Trova il bottone davanti al quale inserire, in reading order (alto→basso, sinistra→destra).
  // Salta l'elemento sorgente per non auto-collidere.
  function findInsertBefore(zoneEl, x, y, skipEl) {
    const btns = Array.from(zoneEl.querySelectorAll('[data-sn-icon-id]'))
      .filter((b) => b !== skipEl);
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (y < r.top) return b;
      if (y >= r.top && y <= r.bottom && x < r.left + r.width / 2) return b;
    }
    return null;
  }

  // Per gli spec: lo shadow root chiuso della cronologia non lo attraversa nessun locator. Sui siti SN_MENU
  // vive nel mondo isolato dei content script, quindi la pagina da qui non passa.
  function statoCronologia() {
    const sub = activeMenu && activeMenu.subHost ? activeMenu.subRoot : null;
    if (!sub || !sub.isConnected) return null;
    const visibile = (el) => !!el && el.getClientRects().length > 0;
    const centro = (el) => {
      if (!visibile(el)) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const r = sub.getBoundingClientRect();
    const lista = sub.querySelector('.sn-menu-history-list');
    const cerca = sub.querySelector('.sn-menu-history-search-input');
    // Un clic conta solo su una voce che il browser ha già visto scoperta (#589.11): gli spec aspettano questo.
    const pronta = (el) => !el || !global.SN_VISTO || global.SN_VISTO._test.pronta(el);
    // Una voce scorsa fuori dalla lista non ha niente da dire: null. Con la guardia accesa decide lei cosa è a
    // schermo, così una riga tagliata dal bordo sotto il pixel non resta «da aspettare» per sempre.
    const nellaLista = (el) => {
      if (global.SN_VISTO?.ATTIVO) return global.SN_VISTO._test.aSchermo(el);
      if (!lista) return true;
      const a = el.getBoundingClientRect(), b = lista.getBoundingClientRect();
      return a.bottom > b.top && a.top < b.bottom;
    };
    const svuota = sub.querySelector('.sn-menu-history-clear-btn');
    return {
      voci: [...sub.querySelectorAll('.sn-menu-history-item')].filter(visibile).map((riga) => ({
        testo: riga.querySelector('.sn-menu-history-paste')?.getAttribute('aria-label') || '',
        incolla: centro(riga.querySelector('.sn-menu-history-paste')),
        rimuovi: centro(riga.querySelector('.sn-menu-history-remove')),
        pronta: ((bottoni) => (bottoni.length ? bottoni.every(pronta) : null))(
          [riga.querySelector('.sn-menu-history-paste'), riga.querySelector('.sn-menu-history-remove')]
            .filter((b) => b && nellaLista(b))),
        libera: !global.SN_VISTO || !!global.SN_VISTO._test.libera(riga.querySelector('.sn-menu-history-paste')),
        tolta: riga.classList.contains('sn-menu-history-gone'),
        miniatura: riga.querySelector('.sn-menu-history-thumb')?.getAttribute('src') || null,
        fuocoRimuovi: sub.getRootNode().activeElement === riga.querySelector('.sn-menu-history-remove'),
      })),
      svuotaPronta: pronta(svuota),
      vuoto: [...sub.querySelectorAll('.sn-menu-empty')].filter(visibile).map((e) => e.textContent).join(' '),
      cerca: cerca ? {
        centro: centro(cerca), valore: cerca.value, segnaposto: cerca.placeholder, fuoco: sub.getRootNode().activeElement === cerca,
      } : null,
      svuota: centro(svuota),
      riquadro: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      lista: lista ? {
        centro: centro(lista), scrollTop: lista.scrollTop, scrollHeight: lista.scrollHeight, clientHeight: lista.clientHeight,
      } : null,
      sfondo: getComputedStyle(sub).backgroundColor,
    };
  }

  global.SN_MENU = {
    _test: { cronologia: statoCronologia },
    daTastiera,
    open,
    misuraLeAzioni,
    azioneInCorso: () => azioneInCorso,
    close,
    computeCap: Place.computeCap,
    computeOffset: Place.computeOffset,
    computeSubOffset,
    openGenericSubmenu,
    openIconGridSubmenu,
    closeSubmenu,
    allaChiusura: (fn) => { allaChiusura = typeof fn === 'function' ? fn : null; },
    refreshIconRow,
    refreshIconGrid,
    isSubMenuOpen,
    setPonteBarra,
    trascinaDaFuori,
    testoNascosto,
    // C'è un menu aperto adesso? Lo chiede content.js per decidere di chi è
    // l'Esc quando si è a tutto schermo (#514).
    isOpen: () => !!activeMenu,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
