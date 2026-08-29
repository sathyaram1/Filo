// Menu contestuale custom. Disegnato come elemento HTML nel DOM.
// Posizionamento smart con flip vicino ai bordi.

(function (global) {
  'use strict';

  const I18n = global.SN_I18N;
  const isSvgIcon = global.SN_ICONS_UTIL?.isSvgIcon
    || ((s) => typeof s === 'string' && s.startsWith('<svg'));

  // Imposta il "contenuto icona" di un nodo: stringa SVG → innerHTML (sicuro:
  // le icone sono compilate in src/shared/icons.js, mai dati utente), altrimenti
  // textContent (per glifi unicode come ▸, ▾ o emoji legacy).
  function setIconContent(el, value) {
    if (value == null) { el.textContent = ''; return; }
    if (isSvgIcon(value)) el.innerHTML = value;
    else el.textContent = value;
  }

  // Host dove montare il menu. Quando una pagina è in fullscreen HTML5 (es. il
  // player video di YouTube a tutto schermo) il browser disegna SOLO l'elemento
  // fullscreen e i suoi discendenti (top layer): un menu appeso a <html>
  // resterebbe nascosto dietro al video — ed era il motivo per cui col tasto
  // destro sul video non compariva nulla (e non si poteva mandare feedback).
  // Se c'è un fullscreenElement montiamo lì dentro, così il menu è visibile.
  function menuHost() {
    return document.fullscreenElement || document.documentElement;
  }

  let activeMenu = null;

  function close() {
    try { dismissTooltip?.(); } catch (_) {}
    clearSubCloseTimer();
    if (activeMenu) {
      activeMenu.root.remove();
      try { activeMenu.subRoot?.remove(); } catch (_) {}
      document.removeEventListener('mousedown', activeMenu.onDocClick, true);
      document.removeEventListener('keydown', activeMenu.onKey, true);
      window.removeEventListener('scroll', activeMenu.onScroll, true);
      window.removeEventListener('resize', activeMenu.onResize, true);
      try { activeMenu.cleanupZoom?.(); } catch (_) {}
      try { activeMenu.cleanups?.forEach((fn) => { try { fn(); } catch (_) {} }); } catch (_) {}
      activeMenu = null;
    }
    // Pulisce zone di drop residue (vengono ri-registrate alla prossima apertura).
    dropZones.length = 0;
  }

  function closeSubmenu() {
    if (!activeMenu?.subRoot) return;
    activeMenu.subRoot.remove();
    activeMenu.subRoot = null;
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
      // Se è già aperto un sotto-menu di un altro item (anche se "pinnato"),
      // chiudilo e apri quello di questa freccetta. L'hover su una nuova voce
      // deve far cambiare il sotto-menu — altrimenti l'utente resta bloccato
      // sul pinned senza poter esplorare gli altri (feedback alpha).
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

  // Geometria condivisa col riquadro della risposta di Filo — l'altra
  // superficie che cresce dopo essere stata posata. Vedi
  // `src/shared/overlayPlacement.js`.
  //
  // #405 — il tetto d'altezza serve anche dentro un riquadro incorporato, dove
  // lo spazio verticale può essere meno dell'altezza del menu (un player alto
  // 200px, un blocco commenti stretto): senza, il menu verrebbe tagliato e le
  // voci in fondo — feedback, aiuto — sarebbero irraggiungibili.
  const Place = global.SN_PLACE;

  // Posa il menu misurandolo ADESSO. `keep: true` = il menu è già sullo schermo
  // e ha cambiato altezza: si parte dalla posa corrente invece che dal cursore.
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
    // #500 — se il menu è SCIVOLATO, l'etichetta che spiegava un'icona è
    // rimasta ferma dov'era: adesso parla di un bottone che non è più sotto al
    // puntatore e copre le voci. Stesso trattamento che riceve quando il menu
    // scorre. Solo se si è mosso davvero: un menu che cresce restando fermo non
    // deve far sparire l'etichetta sotto il naso di chi la sta leggendo.
    const mosso = (Number.isFinite(primaTop) && Math.abs(p.top - primaTop) > 0.5)
      || (Number.isFinite(primaLeft) && Math.abs(p.left - primaLeft) > 0.5);
    if (mosso) dismissTooltip();
    repositionSub();
  }

  // Dove posare un pannello ancorato (la griglia "Altro…", la cronologia
  // incolla, i sotto-menu a lista). Pura, come computeOffset.
  //
  // `mode`:
  // - `'anchor'` (predefinito): a fianco della voce che l'ha aperto, con un
  //   filo di stacco; se a destra non ci sta passa a sinistra;
  // - `'edge'`: attaccato al bordo del MENU con un pelo di sovrapposizione, così
  //   le due superfici si toccano e si leggono come un pezzo solo.
  function computeSubOffset({ aTop, aLeft, aRight, mLeft, mRight, w, h, vw, vh, mode }) {
    const edge = mode === 'edge';
    let left = edge ? mRight - 2 : aRight + 4;
    if (left + w + 8 > vw) left = edge ? Math.max(4, mLeft - w + 2) : Math.max(4, aLeft - w - 4);
    let top = aTop;
    if (top + h + 8 > vh) top = Math.max(8, vh - h - 8);
    return { left, top };
  }

  // Posa il pannello aperto da `anchorEl` misurando ADESSO dove si trova
  // l'ancora: chiamabile quante volte serve, anche mentre il menu si muove.
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

  // #500 — un pannello ancorato viene posato una volta e poi il menu si muove
  // sotto di lui: scivola in su perché la spiegazione è arrivata, oppure scorre
  // perché è più alto della finestra. Se il pannello resta fermo si stacca dalla
  // freccetta che l'ha aperto e galleggia a mezz'aria sopra alle voci. Quindi:
  // il pannello SEGUE la sua ancora; se l'ancora è scorsa via oltre il bordo del
  // menu non c'è più niente a cui stare attaccati e il pannello si chiude.
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

  // items: array di { type: 'item'|'separator'|'row'|'inline'|'paste'|'dest', label, shortcut, disabled, onClick, items? }
  // - 'inline': sezione che mostra contenuto dinamico (es. spiegazione AI). { content?: string, onMount?: (el) => cleanup }
  // - 'paste': come 'item' ma con freccetta a destra che apre il sotto-menu della cronologia
  // - 'dest': riga non cliccabile che dice DOVE PORTA il collegamento delle voci
  //   che seguono (#499). { label, rest, full }
  function open({ x, y, items, keepOnScroll }) {
    close();
    const root = document.createElement('div');
    root.className = 'sn-menu';
    // UI nostra dentro la pagina del sito: marcata alla nascita, così chi
    // cammina sulla pagina (la traduzione) la salta senza doverla indovinare
    // dal nome. In pieno schermo il menu finisce DENTRO l'elemento del sito.
    global.SN_FILO_UI?.mark(root);
    root.setAttribute('role', 'menu');
    root.dataset.snTheme = document.documentElement.dataset.snTheme || '';

    const cleanups = [];
    // Le sezioni che si riempiono più tardi: guardate da vicino, così la
    // rimisura parte appena il testo cambia (vedi sotto).
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
      if (it.type === 'dest') {
        // #499 — Dove portano le voci che seguono. Non è un bottone: non fa
        // niente, dice soltanto. L'host non si taglia MAI (è la parte che
        // risponde alla domanda "chi è dall'altra parte"); ad accorciarsi con i
        // puntini è il percorso. `dir=ltr` perché un indirizzo con caratteri di
        // un alfabeto che si scrive da destra a sinistra, lasciato al verso del
        // testo, si riordina davanti agli occhi e mostra un dominio che non è
        // quello vero.
        const dest = document.createElement('div');
        dest.className = 'sn-menu-dest';
        dest.setAttribute('dir', 'ltr');
        if (it.full) {
          dest.title = I18n.t('menu_link_destination', it.full);
          // Leggibile dai test senza fare la corsa con l'impaginazione, e
          // sempre l'indirizzo INTERO, anche quando a schermo è accorciato.
          dest.dataset.dest = it.full;
        }
        if (it.label) {
          const h = document.createElement('span');
          h.className = 'sn-menu-dest-host';
          h.textContent = it.label;
          dest.appendChild(h);
        }
        if (it.rest) {
          const r = document.createElement('span');
          r.className = 'sn-menu-dest-rest';
          r.textContent = it.rest;
          dest.appendChild(r);
        }
        root.appendChild(dest);
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
        // Di cosa parla il riquadro (immagine / collegamento / testo). Sulla
        // stessa scheda deve restare lo STESSO da qualunque punto la si clicchi
        // (#444): scritto qui, l'argomento è leggibile anche prima che la
        // risposta arrivi e sostituisca il testo di attesa.
        if (it.subject) el.dataset.subject = it.subject;
        if (it.content) el.textContent = it.content;
        root.appendChild(el);
        // #500 — è questa sezione che cresce quando la spiegazione arriva. Il
        // `ResizeObserver` sul menu se ne accorge comunque, ma la sua consegna
        // è legata al ciclo di disegno e può tardare; guardare direttamente il
        // contenuto è la via più corta, e non serve che chi lo riempie sappia
        // di doverlo dire.
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
        // Bottone composito: la parte sinistra mostra la parola corretta (clic = applica
        // correzione); a destra una freccetta apre un sotto-menu con azioni (aggiungi al
        // dizionario, correggi automaticamente, gestisci correttore).
        const wrap = document.createElement('div');
        wrap.className = 'sn-menu-correction';
        keepPageFocus(wrap);
        if (it.disabled) wrap.classList.add('sn-disabled');
        if (it.loading) wrap.classList.add('sn-menu-correction-loading');
        if (it.id) wrap.id = it.id;

        // `hidden`: la riga viene inserita ma display:none. Permette al chiamante
        // di "riservare" lo slot e rivelarlo via update() se/quando arriva una
        // correzione asincrona. Usato per evitare il flash "Cerco una correzione…"
        // quando ancora non sappiamo se la parola è davvero sbagliata.
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
        // Bottone generico: corpo cliccabile a sinistra + freccetta a destra che
        // apre un sotto-menu di varianti/opzioni (subItems). Usato per
        // "Spiega ▸ approfondisci", "Detta ▸ scegli modello", ecc.
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
        // Bottone composito: parte sinistra = incolla principale, parte destra = freccetta dropdown
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
      // item
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
      root.appendChild(el);
    }

    menuHost().appendChild(root);

    // #405 — su una pagina con riquadri incorporati il menu può nascere dentro
    // il riquadro o fuori, e i clic non attraversano quel confine: chi ha un
    // menu aperto dall'altra parte non si accorgerebbe mai di doverlo chiudere.
    // Un avviso agli altri frame della scheda tiene la regola di sempre — un
    // solo menu alla volta. Nessun costo sulle pagine senza riquadri.
    try {
      const nested = window.top !== window.self || (window.frames && window.frames.length > 0);
      const T = global.SN_MSG?.MSG?.CLOSE_OTHER_MENUS;
      if (nested && T) Promise.resolve(chrome.runtime.sendMessage({ type: T })).catch(() => {});
    } catch (_) {}

    // Compensazione zoom (così il menu non scala con Ctrl+/-)
    const cleanupZoom = (global.SN_POPUP?.attachZoomCompensation || (() => () => {}))(root);

    // Posizionamento: misura, flip se necessario.
    place(root, x, y);

    // #500 — il menu non ha un'altezza definitiva quando lo si posa: le sezioni
    // dinamiche (la spiegazione AI di una selezione, di un collegamento, di
    // un'immagine) nascono a una riga e diventano tre quando la risposta arriva.
    // Misurando una volta sola il menu cresceva OLTRE il bordo basso della
    // finestra e l'ultima voce restava tagliata a metà, non cliccabile.
    // Rimisurare a ogni cambio d'altezza lo tiene dentro; la posa "keep" scivola
    // del minimo indispensabile invece di ribaltare il menu sotto il cursore.
    const riposa = () => place(root, x, y, { keep: true });
    cleanups.push(Place.observeGrowth(root, riposa));
    // …e le sezioni che si riempiono dopo si guardano anche da vicino: una
    // mutazione del contenuto arriva subito, senza passare dal ciclo di disegno.
    // Le richieste dello stesso fotogramma diventano una misura sola.
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
      if (activeMenu?.subRoot && activeMenu.subRoot.contains(e.target)) return;
      close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    const onScroll = (e) => {
      // Lo scroll DENTRO il menu (es. la lista scorrevole della cronologia
      // incolla, o il menu stesso quando la spiegazione lo fa diventare più alto
      // della finestra) NON deve chiudere il menu: il listener è in capture su
      // window, quindi intercetta anche gli scroll dei discendenti. Senza questa
      // guardia girare la rotella sulla lista chiude il box invece di scorrere
      // gli appunti più vecchi (feedback alpha).
      const t = e && e.target;
      if (t && t.nodeType === 1) {
        if (root.contains(t)) {
          // #500 — il menu ha scorso sotto al pannello ancorato: la freccetta
          // che l'ha aperto si è spostata, e il pannello va con lei (o si
          // chiude, se la freccetta è uscita dal bordo). Anche il tooltip, che
          // parlava di un bottone che ora non è più sotto al cursore.
          try { dismissTooltip?.(); } catch (_) {}
          repositionSub();
          return;
        }
        if (activeMenu?.subRoot && activeMenu.subRoot.contains(t)) return;
      }
      if (keepOnScroll) return;
      close();
    };
    // #500 — la finestra che si accorcia è lo STESSO difetto preso dall'altro
    // verso: prima si allungava il menu sotto una finestra ferma, qui si
    // accorcia la finestra sotto un menu fermo, e in tutti e due i casi il fondo
    // del menu finisce oltre il bordo con le ultime voci irraggiungibili. Quindi
    // il conto di dove sta il menu si rifà anche qui, invece di chiuderlo (o di
    // non fare niente, che è quello che succedeva col menu di una selezione).
    // Capita a chi ridimensiona la finestra mentre legge, e ogni volta che
    // l'area della pagina si accorcia da sola — un riquadro incorporato che
    // cambia misura, una barra che compare.
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
      subRoot: null, subAnchor: null, subMode: null,
    };
  }

  // Impedisce che l'elemento del menu prenda il fuoco quando lo si clicca.
  // Senza questo, premere il tasto del mouse sposta il fuoco dal campo di
  // scrittura al bottone del menu: il punto in cui si stava scrivendo — e la
  // parola che il correttore di sistema aveva selezionato sotto al cursore —
  // sparisce PRIMA che l'azione parta, e la correzione non ha più niente su cui
  // agire. Pesa soprattutto dentro i blocchi "sigillati" (#438), dove riscrivere
  // la selezione è l'UNICA strada per correggere: altrove la correzione ritrova
  // il campo da sé. preventDefault su mousedown non annulla il click.
  function keepPageFocus(el) {
    el.addEventListener('mousedown', (e) => { e.preventDefault(); });
  }

  // (Ri)disegna l'item 'correction' in-place.
  // `cleanups` arriva da open(): renderCorrection è definita a livello di modulo
  // (non chiude sullo scope di open), quindi va passato esplicitamente —
  // altrimenti setupArrowSubmenu sotto solleva "cleanups is not defined" e
  // l'intero menu di correzione fallisce, facendo ricadere sul menu normale
  // senza alcun suggerimento (feedback alpha: "il suggerimento non compare").
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

    if (!props.loading) {
      const arrow = document.createElement('button');
      arrow.type = 'button';
      arrow.className = 'sn-menu-correction-arrow';
      arrow.textContent = '▸';
      setupArrowSubmenu(arrow, () => openGenericSubmenu(arrow, props.subItems || []), cleanups);
      wrap.appendChild(arrow);
    }
  }

  // Sotto-menu generico (lista di {label, onClick}). Si ancora a `anchorEl`.
  function openGenericSubmenu(anchorEl, items) {
    if (!activeMenu) return;
    if (activeMenu.subRoot) {
      activeMenu.subRoot.remove();
      activeMenu.subRoot = null;
    }
    const sub = document.createElement('div');
    sub.className = 'sn-menu sn-menu-sub';
    global.SN_FILO_UI?.mark(sub);
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

    menuHost().appendChild(sub);
    const cleanupZoom = (global.SN_POPUP?.attachZoomCompensation || (() => () => {}))(sub);
    activeMenu.cleanups.push(cleanupZoom);
    activeMenu.subRoot = sub;
    activeMenu.subAnchor = anchorEl;
    activeMenu.subMode = 'anchor';

    placeSub(sub, anchorEl, 'anchor');
    attachSubmenuHover(sub);
  }

  // Sotto-menu cronologia incolla. Si ancora alla freccetta.
  // `handlers` può essere una funzione (retrocompat: solo onPick) o un oggetto
  // { onPick, onRemove, onClear }.
  function openSubmenu(anchorEl, entries, handlers) {
    const onPick = typeof handlers === 'function' ? handlers : (handlers && handlers.onPick);
    const onRemove = handlers && typeof handlers === 'object' ? handlers.onRemove : null;
    const onClear = handlers && typeof handlers === 'object' ? handlers.onClear : null;
    if (!activeMenu) return;
    if (activeMenu.subRoot) {
      activeMenu.subRoot.remove();
      activeMenu.subRoot = null;
    }
    const sub = document.createElement('div');
    sub.className = 'sn-menu sn-menu-sub';
    global.SN_FILO_UI?.mark(sub);
    sub.dataset.snTheme = document.documentElement.dataset.snTheme || '';

    if (!entries || entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sn-menu-empty';
      empty.textContent = I18n.t('toast_clipboard_empty');
      sub.appendChild(empty);
    } else {
      sub.classList.add('sn-menu-history-sub');

      // Lista scorrevole: tutto ciò che è stato incollato, con scroll.
      const list = document.createElement('div');
      list.className = 'sn-menu-history-list';

      const searchTextOf = (entry) =>
        (entry.type === 'image' ? (entry.description || 'Immagine') : (entry.text || ''))
          .replace(/\s+/g, ' ').trim();

      // Messaggi di stato (creati prima così i gestori possono riferirli):
      // - noResults: nessuna corrispondenza nella ricerca;
      // - emptyMsg: l'utente ha rimosso tutte le voci a mano.
      const noResults = document.createElement('div');
      noResults.className = 'sn-menu-empty';
      noResults.textContent = I18n.t('menu_paste_no_results');
      noResults.style.display = 'none';
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'sn-menu-empty';
      emptyMsg.textContent = I18n.t('toast_clipboard_empty');
      emptyMsg.style.display = 'none';

      // Footer: barra di ricerca + (se supportato) svuota cronologia.
      const searchWrap = document.createElement('div');
      searchWrap.className = 'sn-menu-history-search';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'sn-menu-history-search-input';
      input.placeholder = I18n.t('menu_paste_search');
      input.setAttribute('aria-label', input.placeholder);

      let clearWrap = null;

      // Quando l'utente rimuove l'ultima voce: mostra lo stato vuoto e nascondi
      // ricerca/svuota (non c'è più nulla da cercare o svuotare).
      const refreshEmptyState = () => {
        if (list.querySelector('.sn-menu-history-item')) return;
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
      const forgetEntry = (entry) => {
        if (!Array.isArray(entries)) return;
        const i = entries.indexOf(entry);
        if (i >= 0) entries.splice(i, 1);
      };

      // Applica il filtro di ricerca corrente. Serve anche DOPO una rimozione:
      // se stavi cercando "pass" e togli l'unica voce trovata, la lista resta
      // muta senza dire che ora quella ricerca non ha risultati.
      const applyFilter = () => {
        const q = input.value.trim().toLowerCase();
        let visible = 0;
        for (const b of list.querySelectorAll('.sn-menu-history-item')) {
          const match = !q || (b.dataset.snSearch || '').includes(q);
          b.style.display = match ? '' : 'none';
          if (match) visible++;
        }
        noResults.style.display = visible === 0 ? '' : 'none';
      };

      entries.forEach((entry) => {
        // Riga = zona "incolla" (a sinistra) + "×" rimuovi (a destra). Sono due
        // bottoni fratelli, non annidati: il "×" non fa scattare l'incolla.
        const row = document.createElement('div');
        row.className = 'sn-menu-history-item';
        row.dataset.snSearch = searchTextOf(entry).toLowerCase();

        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sn-menu-item sn-menu-history-paste';
        if (entry.type === 'image') {
          const icon = document.createElement('span');
          icon.className = 'sn-menu-history-icon';
          const img = global.SN_ICONS?.image;
          if (img) icon.innerHTML = img(16);
          else icon.textContent = '🖼';
          const desc = document.createElement('span');
          desc.className = 'sn-menu-label';
          desc.textContent = entry.description || 'Immagine';
          b.appendChild(icon);
          b.appendChild(desc);
        } else {
          const lbl = document.createElement('span');
          lbl.className = 'sn-menu-label';
          const text = (entry.text || '').replace(/\s+/g, ' ').trim();
          lbl.textContent = text.length > 40 ? text.slice(0, 40) + '…' : text;
          b.appendChild(lbl);
        }
        b.addEventListener('click', () => {
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
            try { onRemove(entry); } catch (e) { console.error(e); }
            forgetEntry(entry);
            row.remove();
            applyFilter();
            refreshEmptyState();
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
            ok = Ui
              ? await Ui.confirm({ title: I18n.t('menu_paste_clear'), text: I18n.t('menu_paste_clear_confirm') })
              : true;
          } catch (_) { ok = false; }
          if (activeMenu) activeMenu.subLocked = false;
          if (!ok) return;
          try { onClear(); } catch (e) { console.error(e); }
          // Stessa ragione di forgetEntry: la lista in mano al menu non deve
          // sopravvivere allo svuotamento (qui chiudiamo tutto, ma se un domani
          // il menu restasse aperto mostrerebbe voci che non esistono più).
          if (Array.isArray(entries)) entries.length = 0;
          close();
        });
        clearWrap.appendChild(clearBtn);
        sub.appendChild(clearWrap);
      }

      // Focus immediato così si può digitare subito.
      setTimeout(() => { try { input.focus({ preventScroll: true }); } catch (_) {} }, 0);
    }

    menuHost().appendChild(sub);
    // Compensazione zoom anche per il sub-menu
    const cleanupZoom = (global.SN_POPUP?.attachZoomCompensation || (() => () => {}))(sub);
    activeMenu.cleanups.push(cleanupZoom);
    activeMenu.subRoot = sub;

    // Posizionamento: la cronologia incolla deve apparire ATTACCATA al box
    // principale (feedback alpha: "il sotto menu compare separato dal box
    // principale"). Ancoriamo quindi al bordo del menu padre con un leggero
    // overlap (-2px) invece che alla freccetta con un gap di +4px, così le due
    // superfici si toccano e si leggono come un unico menu. Verticale: allineata
    // alla riga "Incolla", ricade verso l'alto se sfora in basso.
    activeMenu.subAnchor = anchorEl;
    activeMenu.subMode = 'edge';
    placeSub(sub, anchorEl, 'edge');
    attachSubmenuHover(sub);
  }

  // ============================================================================
  // Sotto-menu a griglia di icone (per il pannello "Altro…" della riga icone).
  // Si ancora a un bottone del menu principale ma NON chiude il menu padre.
  // Supporta drag-and-drop fra griglia secondaria e riga principale.
  // ============================================================================
  function openIconGridSubmenu(anchorEl, items, opts = {}) {
    if (!activeMenu) return;
    if (activeMenu.subRoot) {
      activeMenu.subRoot.remove();
      activeMenu.subRoot = null;
      return;
    }
    const cols = opts.cols || 4;
    const sub = document.createElement('div');
    sub.className = 'sn-menu sn-menu-sub sn-menu-icon-grid';
    global.SN_FILO_UI?.mark(sub);
    sub.dataset.snTheme = document.documentElement.dataset.snTheme || '';
    sub.style.setProperty('--sn-icon-cols', String(cols));
    if (opts.dropTarget) sub.dataset.snDropTarget = opts.dropTarget;

    populateGrid(sub, items, { dropTarget: opts.dropTarget });
    if (opts.dropTarget) attachDropZone(sub, { target: opts.dropTarget, onDrop: opts.onDrop });

    menuHost().appendChild(sub);
    const cleanupZoom = (global.SN_POPUP?.attachZoomCompensation || (() => () => {}))(sub);
    activeMenu.cleanups.push(cleanupZoom);
    activeMenu.subRoot = sub;
    activeMenu.subAnchor = anchorEl;
    activeMenu.subMode = 'anchor';

    placeSub(sub, anchorEl, 'anchor');
    // Senza questo, il timer di mouseleave sull'ancora (overflow) chiude il
    // sub-menu appena il cursore entra nella griglia (feedback alpha).
    attachSubmenuHover(sub);
  }

  // ============================================================================
  // Tooltip custom (stile coerente col menu). Usa un singleton globale.
  // ============================================================================
  let tooltipEl = null;
  let tooltipHideTimer = null;
  function ensureTooltipEl() {
    if (tooltipEl && document.documentElement.contains(tooltipEl)) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'sn-tooltip';
    global.SN_FILO_UI?.mark(tooltipEl);
    tooltipEl.style.display = 'none';
    menuHost().appendChild(tooltipEl);
    return tooltipEl;
  }
  function showTooltip(target, text) {
    if (!text) return;
    const el = ensureTooltipEl();
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
  // Toglie l'etichetta E l'attesa che sta per farla comparire. Serve quando a
  // muoversi non è il puntatore ma il menu (scivola, scorre, viene trascinato):
  // l'attesa lasciata correre farebbe comparire fra un attimo l'etichetta di un
  // bottone che nel frattempo si è spostato altrove.
  function dismissTooltip() {
    clearTimeout(tooltipHideTimer);
    tooltipHideTimer = null;
    hideTooltip();
  }
  function attachTooltip(el, text) {
    el.addEventListener('mouseenter', () => {
      clearTimeout(tooltipHideTimer);
      tooltipHideTimer = setTimeout(() => showTooltip(el, text), 250);
    });
    el.addEventListener('mouseleave', () => {
      dismissTooltip();
    });
    el.addEventListener('mousedown', () => {
      dismissTooltip();
    });
  }

  // ============================================================================
  // Costruzione bottoni della riga icone / griglia secondaria (estratti per
  // poter rigenerare in-place dopo un drag senza chiudere il menu).
  // ============================================================================
  function makeRowButton(sub, opts = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sn-menu-row-btn';
    if (sub.kind === 'overflow') b.classList.add('sn-menu-row-overflow');
    if (sub.kind === 'empty') b.classList.add('sn-menu-row-empty');
    // Disabilitazione "soft": classe invece dell'attributo nativo `disabled`,
    // che azzera i pointer event e impedirebbe di trascinare l'icona per
    // riordinarla (feedback alpha: avanti/indietro grigi non si potevano
    // spostare). Il click resta neutralizzato dal guard più sotto.
    if (sub.disabled) { b.classList.add('sn-menu-btn-disabled'); b.dataset.snDisabled = '1'; }
    // L'overflow apre subito un sotto-menu su hover: non mostrare il tooltip
    // "Altro…" che altrimenti coprirebbe/preannuncerebbe la stessa cosa.
    if (sub.kind !== 'empty' && sub.kind !== 'overflow' && sub.label) attachTooltip(b, sub.label);
    setIconContent(b, sub.icon || sub.label);
    // Il bottone contiene solo un disegno: senza nome accessibile è un bottone
    // muto per chi legge lo schermo (e invisibile a chi lo cerca per etichetta).
    if (sub.label) b.setAttribute('aria-label', sub.label);
    if (sub.id) b.dataset.snIconId = sub.id;
    if (sub.kind === 'overflow') {
      // L'overflow apre la griglia delle icone secondarie come sotto-menu
      // ancorato, SENZA chiudere il menu principale (feedback alpha). Marcato
      // come hover-target durante drag per aprirsi automaticamente.
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
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        clearSubCloseTimer();
        if (activeMenu?.subRoot && activeMenu.subOwner === b) {
          activeMenu.subLocked = true;
        } else {
          if (activeMenu?.subRoot) closeSubmenu();
          openOverflow();
          if (activeMenu) activeMenu.subLocked = true;
        }
      });
    } else {
      b.addEventListener('click', () => {
        if (sub.kind === 'empty') return;
        if (sub.disabled) return; // greyed: niente azione (ma resta trascinabile)
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
    if (it.label) { b.setAttribute('aria-label', it.label); attachTooltip(b, it.label); }
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (it.disabled) return;
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
  }

  // Aggiorna in-place i bottoni della riga primaria (senza chiudere il menu).
  function refreshIconRow(items) {
    if (!activeMenu) return;
    const row = activeMenu.root.querySelector('.sn-menu-row');
    if (!row) return;
    populateRow(row, items, row.__snRowOpts || {});
  }

  // Aggiorna in-place i bottoni della griglia secondaria, se aperta.
  function refreshIconGrid(items) {
    if (!activeMenu || !activeMenu.subRoot) return;
    populateGrid(activeMenu.subRoot, items, activeMenu.subRoot.__snGridOpts || {});
  }

  function isSubMenuOpen() {
    return !!(activeMenu && activeMenu.subRoot && document.documentElement.contains(activeMenu.subRoot));
  }

  // ============================================================================
  // Drag & drop fra zone (es. riga primaria ↔ griglia secondaria).
  // Implementazione pointer-based: il drag HTML5 nativo non si attiva in modo
  // affidabile quando il menu ha un transform applicato (compensazione zoom)
  // o quando l'elemento è un <button>, e su molte pagine ospite il drag image
  // non risulta visibile. Qui muoviamo un'anteprima clonata che segue il
  // cursore e gestiamo noi la logica di drop.
  // ============================================================================
  const dropZones = [];

  function attachDrag(el, { id, source }) {
    el.dataset.snDraggable = '1';
    el.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
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
        menuHost().appendChild(preview);
        updatePreview(x, y);
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
              try { opener.click(); } catch (_) {}
            }
          }, HOVER_OPEN_DELAY);
        }
      };

      const onMove = (e) => {
        if (!dragging) {
          if (Math.hypot(e.clientX - startX, e.clientY - startY) < THRESHOLD) return;
          startDrag(e.clientX, e.clientY);
        }
        e.preventDefault();
        updatePreview(e.clientX, e.clientY);
        setHover(findZoneAt(e.clientX, e.clientY));
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
      };

      const onUp = (e) => {
        if (!dragging) { cleanup(); return; }
        const zone = findZoneAt(e.clientX, e.clientY);
        cleanup();
        if (zone) {
          const beforeBtn = findInsertBefore(zone.zoneEl, e.clientX, e.clientY, el);
          const beforeId = beforeBtn?.dataset?.snIconId || null;
          try { zone.onDrop && zone.onDrop({ id, source, target: zone.target, beforeId }); } catch (er) { console.error(er); }
        }
        // Sopprime il click che segue il pointerup dopo un drag.
        const swallow = (ce) => { ce.stopPropagation(); ce.preventDefault(); };
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => { try { window.removeEventListener('click', swallow, true); } catch (_) {} }, 50);
      };

      const onCancel = () => cleanup();

      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onCancel, true);
    });
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

  // Trova il bottone davanti al quale inserire l'elemento, in reading order
  // (top→bottom, left→right). Salta l'elemento sorgente per non auto-collidere.
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

  global.SN_MENU = {
    open,
    close,
    computeCap: Place.computeCap,
    computeOffset: Place.computeOffset,
    computeSubOffset,
    openGenericSubmenu,
    openIconGridSubmenu,
    refreshIconRow,
    refreshIconGrid,
    isSubMenuOpen,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
