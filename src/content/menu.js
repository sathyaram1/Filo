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
    try { hideTooltip?.(); } catch (_) {}
    clearSubCloseTimer();
    // #445 — il menu di questo frame può essere disegnato dalla pagina che lo
    // ospita: chiuderlo significa chiudere anche quello.
    try { global.SN_MENU_REMOTE?.closeProjected?.(); } catch (_) {}
    if (activeMenu) {
      activeMenu.root.remove();
      try { activeMenu.subRoot?.remove(); } catch (_) {}
      document.removeEventListener('mousedown', activeMenu.onDocClick, true);
      document.removeEventListener('keydown', activeMenu.onKey, true);
      window.removeEventListener('scroll', activeMenu.onScroll, true);
      window.removeEventListener('resize', activeMenu.onScroll, true);
      try { activeMenu.cleanupZoom?.(); } catch (_) {}
      try { activeMenu.cleanups?.forEach((fn) => { try { fn(); } catch (_) {} }); } catch (_) {}
      const notify = activeMenu.onClose;
      activeMenu = null;
      if (typeof notify === 'function') { try { notify(); } catch (_) {} }
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

  // Sezione inline (spiegazione AI, anteprima di un link, descrizione di
  // un'immagine): il contenuto arriva dopo, e chi lo produce lo consegna come
  // DATI — { state, text, markdown, warn, remove } — non come nodi del DOM.
  // Il disegno sta tutto qui, in un posto solo, e per questo la stessa sezione
  // può essere disegnata da un frame diverso da quello che la produce: fra i
  // due passa testo, mai HTML (#445).
  function renderInline(el, item, props) {
    if (props.remove) {
      const prev = el.previousElementSibling;
      if (prev && prev.classList.contains('sn-menu-sep')) prev.remove();
      el.remove();
      return;
    }
    const variant = item.variant || 'plain';
    el.className = 'sn-menu-inline';
    if (variant === 'explain') el.classList.add('sn-menu-inline-explain');
    if (props.state === 'loading') el.classList.add('sn-menu-inline-loading');
    if (props.state === 'error') el.classList.add('sn-menu-inline-error');
    el.textContent = '';

    if (props.warn) {
      const w = document.createElement('div');
      w.className = 'sn-menu-link-warn';
      w.textContent = props.warn;
      el.appendChild(w);
    }

    const text = props.text == null ? '' : String(props.text);
    if (variant === 'plain') {
      // Nessun corpo separato: il testo sta direttamente nella sezione (è la
      // forma che aveva la descrizione dell'immagine, e il CSS la assume).
      el.appendChild(document.createTextNode(text));
    } else {
      const body = document.createElement('div');
      body.className = variant === 'link' ? 'sn-menu-link-body' : 'sn-menu-inline-body';
      if (props.markdown) {
        const md = global.SN_POPUP?.renderMarkdown;
        if (md) body.innerHTML = md(text);
        else body.textContent = text;
      } else {
        body.textContent = text;
      }
      el.appendChild(body);
    }

    if (item.arrow) {
      const arrow = document.createElement('button');
      arrow.type = 'button';
      arrow.className = 'sn-menu-inline-arrow';
      arrow.title = item.arrowTitle || '';
      arrow.textContent = '▸';
      arrow.addEventListener('click', (e) => {
        e.stopPropagation();
        close();
        try { item.onArrow && item.onArrow(); } catch (err) { console.error(err); }
      });
      el.appendChild(arrow);
    }
  }

  // items: array di { type: 'item'|'separator'|'row'|'inline'|'paste', label, shortcut, disabled, onClick, items? }
  // - 'inline': sezione con contenuto che arriva dopo (spiegazione AI).
  //   { content?, variant?, arrow?, onArrow?, onMount?: (el, update) => cleanup }
  // - 'paste': come 'item' ma con freccetta a destra che apre il sotto-menu della cronologia
  //
  // Opzioni #445 (menu disegnato per conto di un riquadro incorporato):
  // - noProject: non delegare alla pagina, disegna qui comunque;
  // - keepFocus: nessuna voce ruba il fuoco al campo su cui si sta scrivendo
  //   (il campo è in un ALTRO frame: perderlo significherebbe perdere il punto
  //   in cui incollare o la parola da correggere);
  // - onClose: chiamata quando il menu si chiude.
  function open({ x, y, items, keepOnScroll, noProject, keepFocus, onClose }) {
    close();
    const root = document.createElement('div');
    root.className = 'sn-menu';
    root.setAttribute('role', 'menu');
    root.dataset.snTheme = document.documentElement.dataset.snTheme || '';

    const cleanups = [];
    // Il montaggio delle sezioni dinamiche (che possono far partire una chiamata
    // al modello) è rimandato a dopo la misura: se il menu non ci sta e va
    // disegnato dalla pagina, qui non deve partire niente — altrimenti la
    // spiegazione verrebbe chiesta due volte, e pagata due volte.
    const mounts = [];

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
        renderInline(el, it, { state: 'loading', text: it.content || '' });
        root.appendChild(el);
        if (typeof it.onMount === 'function') {
          mounts.push(() => {
            const update = (props) => {
              if (!el.parentElement) return;
              renderInline(el, it, props || {});
            };
            try {
              const cleanup = it.onMount(el, update);
              if (typeof cleanup === 'function') cleanups.push(cleanup);
            } catch (e) { console.error(e); }
          });
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
          mounts.push(() => {
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
            try {
              const cleanup = it.onMount(wrap, update);
              if (typeof cleanup === 'function') cleanups.push(cleanup);
            } catch (e) { console.error(e); }
          });
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

    if (keepFocus) keepPageFocus(root);
    menuHost().appendChild(root);

    // #405 — su una pagina con riquadri incorporati il menu può nascere dentro
    // il riquadro o fuori, e i clic non attraversano quel confine: chi ha un
    // menu aperto dall'altra parte non si accorgerebbe mai di doverlo chiudere.
    // Un avviso agli altri frame della scheda tiene la regola di sempre — un
    // solo menu alla volta. Nessun costo sulle pagine senza riquadri.
    // Parte PRIMA della proiezione (#445): se il menu lo disegnerà la pagina,
    // questo è ciò che le fa chiudere il suo prima di aprire quello nuovo.
    try {
      const nested = window.top !== window.self || (window.frames && window.frames.length > 0);
      const T = global.SN_MSG?.MSG?.CLOSE_OTHER_MENUS;
      if (nested && T && !noProject) Promise.resolve(chrome.runtime.sendMessage({ type: T })).catch(() => {});
    } catch (_) {}

    // Misura prima di decidere: è l'altezza vera del menu a dire se ci sta.
    let h = root.offsetHeight;
    const w = root.offsetWidth;
    const vw = window.innerWidth, vh = window.innerHeight;
    const tooTall = h + 16 > vh;
    const tooWide = w + 16 > vw;

    // #445 — dentro un riquadro incorporato il menu non può uscire dai bordi del
    // riquadro: in un player o in un banner alti poche centinaia di pixel
    // diventa una fessura da scorrere. Quando non ci sta, lo fa disegnare alla
    // PAGINA, sopra al riquadro, dove c'è tutta l'altezza della finestra — le
    // azioni restano quelle dell'elemento cliccato qui dentro. Se la pagina non
    // può (non sappiamo dove siamo nella finestra, o siamo a tutto schermo),
    // si ricade sul menu scorrevole di prima.
    const Remote = global.SN_MENU_REMOTE;
    if (!noProject && (tooTall || tooWide) && Remote?.canProject?.()) {
      root.remove();
      const projected = Remote.project({
        items, x, y, keepOnScroll,
        onFallback: () => open({ x, y, items, keepOnScroll, noProject: true }),
      });
      if (projected) return;
      menuHost().appendChild(root);
    }

    // Compensazione zoom (così il menu non scala con Ctrl+/-)
    const cleanupZoom = (global.SN_POPUP?.attachZoomCompensation || (() => () => {}))(root);

    for (const m of mounts) { try { m(); } catch (e) { console.error(e); } }

    // #405 — se lo spazio verticale è meno dell'altezza del menu (una finestra
    // bassa, o un riquadro che non ha potuto delegare alla pagina): scorrevole
    // invece che tagliato, così le voci in fondo — feedback, aiuto — restano
    // raggiungibili. Sopra una finestra normale la condizione è falsa.
    if (tooTall) {
      root.style.maxHeight = `${Math.max(96, vh - 16)}px`;
      root.style.overflowY = 'auto';
      h = root.offsetHeight;
    }
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

    activeMenu = { root, onDocClick, onKey, onScroll, cleanupZoom, cleanups, subRoot: null, onClose };
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

    menuHost().appendChild(sub);
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
        try { hideTooltip?.(); } catch (_) {}
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
    openGenericSubmenu,
    openIconGridSubmenu,
    refreshIconRow,
    refreshIconGrid,
    isSubMenuOpen,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
