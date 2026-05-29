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

  let activeMenu = null;

  function close() {
    try { hideTooltip?.(); } catch (_) {}
    clearSubCloseTimer();
    if (activeMenu) {
      activeMenu.root.remove();
      try { activeMenu.subRoot?.remove(); } catch (_) {}
      document.removeEventListener('mousedown', activeMenu.onDocClick, true);
      document.removeEventListener('keydown', activeMenu.onKey, true);
      window.removeEventListener('scroll', activeMenu.onScroll, true);
      window.removeEventListener('resize', activeMenu.onScroll, true);
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

  // items: array di { type: 'item'|'separator'|'row'|'inline'|'paste', label, shortcut, disabled, onClick, items? }
  // - 'inline': sezione che mostra contenuto dinamico (es. spiegazione AI). { content?: string, onMount?: (el) => cleanup }
  // - 'paste': come 'item' ma con freccetta a destra che apre il sotto-menu della cronologia
  function open({ x, y, items, keepOnScroll }) {
    close();
    const root = document.createElement('div');
    root.className = 'sn-menu';
    root.setAttribute('role', 'menu');
    root.dataset.snTheme = document.documentElement.dataset.snTheme || '';

    const cleanups = [];

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
        if (it.content) el.textContent = it.content;
        root.appendChild(el);
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

        renderCorrection(wrap, it);

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
              renderCorrection(wrap, { ...it, ...newProps });
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
        setupArrowSubmenu(arrow, () => openSubmenu(arrow, it.history || [], it.onPickHistory), cleanups);

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

    document.documentElement.appendChild(root);

    // Compensazione zoom (così il menu non scala con Ctrl+/-)
    const cleanupZoom = (global.SN_POPUP?.attachZoomCompensation || (() => () => {}))(root);

    // Posizionamento: misura, flip se necessario.
    const w = root.offsetWidth, h = root.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = x, top = y;
    if (left + w + 8 > vw) left = vw - w - 8;
    if (top + h + 8 > vh) top = Math.max(8, y - h);
    if (left < 4) left = 4;
    if (top < 4) top = 4;
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;

    const onDocClick = (e) => {
      if (root.contains(e.target)) return;
      if (activeMenu?.subRoot && activeMenu.subRoot.contains(e.target)) return;
      close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    const onScroll = (e) => {
      if (keepOnScroll) return;
      // Lo scroll DENTRO il menu (es. la lista scorrevole della cronologia
      // incolla) NON deve chiudere il menu: il listener è in capture su window,
      // quindi intercetta anche gli scroll dei discendenti. Senza questa guardia
      // girare la rotella sulla lista chiude il box invece di scorrere gli
      // appunti più vecchi (feedback alpha).
      const t = e && e.target;
      if (t && t.nodeType === 1) {
        if (root.contains(t)) return;
        if (activeMenu?.subRoot && activeMenu.subRoot.contains(t)) return;
      }
      close();
    };

    document.addEventListener('mousedown', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll, true);

    activeMenu = { root, onDocClick, onKey, onScroll, cleanupZoom, cleanups, subRoot: null };
  }

  // (Ri)disegna l'item 'correction' in-place.
  function renderCorrection(wrap, props) {
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

    document.documentElement.appendChild(sub);
    const cleanupZoom = (global.SN_POPUP?.attachZoomCompensation || (() => () => {}))(sub);
    activeMenu.cleanups.push(cleanupZoom);
    activeMenu.subRoot = sub;

    const aRect = anchorEl.getBoundingClientRect();
    const w = sub.offsetWidth, h = sub.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = aRect.right + 4;
    let top = aRect.top;
    if (left + w + 8 > vw) left = Math.max(4, aRect.left - w - 4);
    if (top + h + 8 > vh) top = Math.max(8, vh - h - 8);
    sub.style.left = `${left}px`;
    sub.style.top = `${top}px`;
    attachSubmenuHover(sub);
  }

  // Sotto-menu cronologia incolla. Si ancora alla freccetta.
  function openSubmenu(anchorEl, entries, onPick) {
    if (!activeMenu) return;
    if (activeMenu.subRoot) {
      activeMenu.subRoot.remove();
      activeMenu.subRoot = null;
    }
    const sub = document.createElement('div');
    sub.className = 'sn-menu sn-menu-sub';
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

      entries.forEach((entry) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sn-menu-item sn-menu-history-item';
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
        b.dataset.snSearch = searchTextOf(entry).toLowerCase();
        b.addEventListener('click', () => {
          close();
          try { onPick && onPick(entry); } catch (e) { console.error(e); }
        });
        list.appendChild(b);
      });
      sub.appendChild(list);

      // Barra di ricerca in basso: filtra fra le cose incollate.
      const noResults = document.createElement('div');
      noResults.className = 'sn-menu-empty';
      noResults.textContent = I18n.t('menu_paste_no_results');
      noResults.style.display = 'none';
      list.appendChild(noResults);

      const searchWrap = document.createElement('div');
      searchWrap.className = 'sn-menu-history-search';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'sn-menu-history-search-input';
      input.placeholder = I18n.t('menu_paste_search');
      input.setAttribute('aria-label', input.placeholder);
      // Mentre l'utente cerca, non far chiudere il sotto-menu (mouse fuori).
      input.addEventListener('focus', () => {
        if (activeMenu) activeMenu.subLocked = true;
        clearSubCloseTimer();
      });
      input.addEventListener('blur', () => { if (activeMenu) activeMenu.subLocked = false; });
      input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        let visible = 0;
        for (const b of list.querySelectorAll('.sn-menu-history-item')) {
          const match = !q || (b.dataset.snSearch || '').includes(q);
          b.style.display = match ? '' : 'none';
          if (match) visible++;
        }
        noResults.style.display = visible === 0 ? '' : 'none';
      });
      searchWrap.appendChild(input);
      sub.appendChild(searchWrap);
      // Focus immediato così si può digitare subito.
      setTimeout(() => { try { input.focus({ preventScroll: true }); } catch (_) {} }, 0);
    }

    document.documentElement.appendChild(sub);
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
    const mRect = (activeMenu?.root || anchorEl).getBoundingClientRect();
    const aRect = anchorEl.getBoundingClientRect();
    const w = sub.offsetWidth, h = sub.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = mRect.right - 2;
    let top = aRect.top;
    if (left + w + 8 > vw) left = Math.max(4, mRect.left - w + 2);
    if (top + h + 8 > vh) top = Math.max(8, vh - h - 8);
    sub.style.left = `${left}px`;
    sub.style.top = `${top}px`;
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
    sub.dataset.snTheme = document.documentElement.dataset.snTheme || '';
    sub.style.setProperty('--sn-icon-cols', String(cols));
    if (opts.dropTarget) sub.dataset.snDropTarget = opts.dropTarget;

    populateGrid(sub, items, { dropTarget: opts.dropTarget });
    if (opts.dropTarget) attachDropZone(sub, { target: opts.dropTarget, onDrop: opts.onDrop });

    document.documentElement.appendChild(sub);
    const cleanupZoom = (global.SN_POPUP?.attachZoomCompensation || (() => () => {}))(sub);
    activeMenu.cleanups.push(cleanupZoom);
    activeMenu.subRoot = sub;

    const aRect = anchorEl.getBoundingClientRect();
    const w = sub.offsetWidth, h = sub.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = aRect.right + 4;
    let top = aRect.top;
    if (left + w + 8 > vw) left = Math.max(4, aRect.left - w - 4);
    if (top + h + 8 > vh) top = Math.max(8, vh - h - 8);
    sub.style.left = `${left}px`;
    sub.style.top = `${top}px`;
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
    tooltipEl.style.display = 'none';
    document.documentElement.appendChild(tooltipEl);
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
  function attachTooltip(el, text) {
    el.addEventListener('mouseenter', () => {
      clearTimeout(tooltipHideTimer);
      tooltipHideTimer = setTimeout(() => showTooltip(el, text), 250);
    });
    el.addEventListener('mouseleave', () => {
      clearTimeout(tooltipHideTimer);
      hideTooltip();
    });
    el.addEventListener('mousedown', () => {
      clearTimeout(tooltipHideTimer);
      hideTooltip();
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
    if (it.label) attachTooltip(b, it.label);
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
        try { hideTooltip?.(); } catch (_) {}
        el.classList.add('sn-dragging');
        preview = el.cloneNode(true);
        preview.classList.add('sn-drag-preview');
        const r = el.getBoundingClientRect();
        preview.style.width = r.width + 'px';
        preview.style.height = r.height + 'px';
        document.documentElement.appendChild(preview);
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
    openGenericSubmenu,
    openIconGridSubmenu,
    refreshIconRow,
    refreshIconGrid,
    isSubMenuOpen,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
