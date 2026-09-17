// Evidenziazione per la sidebar Aiuto: cornice e tooltip sull'elemento di un selettore.
// Modalità «click» (il clic conferma il passo) e «fill» (propone un valore e lo inserisce).
// La cornice è pointer-events:none: solo il bottone Accetta è interattivo.

(function (global) {
  'use strict';

  let activeOverlay = null;
  let activeTarget = null;
  let scrollListener = null;
  let clickListener = null;
  let onTargetClick = null;

  function clear() {
    if (activeOverlay) {
      activeOverlay.remove();
      activeOverlay = null;
    }
    if (scrollListener) {
      window.removeEventListener('scroll', scrollListener, true);
      window.removeEventListener('resize', scrollListener);
      scrollListener = null;
    }
    if (clickListener) {
      document.removeEventListener('click', clickListener, true);
      clickListener = null;
    }
    onTargetClick = null;
    activeTarget = null;
    // Il force-hover sopravvive fra un turno e l'altro: dopo un hover su un menu l'agente
    // vorrà evidenziare una voce interna. Lo tolgono la fine sessione o un click vero.
  }

  function safeQuery(selector) {
    try { return document.querySelector(selector); }
    catch (_) { return null; }
  }

  // reveal: per aria-expanded l'unica via affidabile è .click(), e a garantire che non
  // navighi è la whitelist di SN_EXTRACT.canRevealElement. hover: mouseenter/over.

  const forceHoverTargets = new Set();
  function ensureForceHoverSheet() {
    if (document.getElementById('sn-force-hover-sheet')) return;
    const s = document.createElement('style');
    s.id = 'sn-force-hover-sheet';
    global.SN_FILO_UI?.mark(s);
    // Best effort sui pattern dropdown più comuni: il dispatch di mouseenter copre quasi tutti i
    // casi veri, questa regola serve ai menu che vivono solo su :hover CSS.
    s.textContent =
      '[data-sn-force-hover] > [role="menu"],'
      + '[data-sn-force-hover] + [role="menu"],'
      + '[data-sn-force-hover] ~ [role="menu"],'
      + '[data-sn-force-hover] ul,'
      + '[data-sn-force-hover] [class*="menu"],'
      + '[data-sn-force-hover] [class*="dropdown"],'
      + '[data-sn-force-hover] [class*="submenu"],'
      + '[data-sn-force-hover] [class*="popover"],'
      + '[data-sn-force-hover] [class*="flyout"]'
      + '{ display: block !important; visibility: visible !important;'
      + ' opacity: 1 !important; pointer-events: auto !important; }';
    document.documentElement.appendChild(s);
  }

  function clearForceHover() {
    forceHoverTargets.forEach((el) => {
      try { el.removeAttribute('data-sn-force-hover'); } catch (_) {}
    });
    forceHoverTargets.clear();
  }

  function dispatchHover(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const opts = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window };
    ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove']
      .forEach((t) => {
        try {
          const Evt = t.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
          el.dispatchEvent(new Evt(t, opts));
        } catch (_) {}
      });
  }

  function doReveal(el) {
    if (!el) return false;
    const Extract = global.SN_EXTRACT;
    if (!Extract?.canRevealElement?.(el)) return false;
    try {
      if (el.tagName === 'DETAILS') { el.open = true; return true; }
      if (el.tagName === 'SUMMARY' && el.parentElement?.tagName === 'DETAILS') {
        el.parentElement.open = true;
        return true;
      }
      el.click();
      return true;
    } catch (_) { return false; }
  }

  function doHover(el) {
    if (!el) return false;
    try {
      dispatchHover(el);
      ensureForceHoverSheet();
      el.setAttribute('data-sn-force-hover', '');
      forceHoverTargets.add(el);
      // Estendi anche all'antenato immediato se il target è un'icona/span
      // dentro un trigger più ampio (es. <a class="trigger"><img/></a>).
      const parent = el.parentElement;
      if (parent && parent !== document.documentElement) {
        parent.setAttribute('data-sn-force-hover', '');
        forceHoverTargets.add(parent);
      }
      return true;
    } catch (_) { return false; }
  }

  // Ritorna un descrittore {ok, action, label} che la sidebar usa per il follow-up.
  function autoAction(selector, action) {
    const target = safeQuery(selector);
    if (!target) return { ok: false, action, reason: 'selector-not-found' };
    if (action === 'reveal') {
      const ok = doReveal(target);
      return { ok, action, target, reason: ok ? '' : 'reveal-rejected' };
    }
    if (action === 'hover') {
      const ok = doHover(target);
      return { ok, action, target, reason: ok ? '' : 'hover-failed' };
    }
    return { ok: false, action, reason: 'unknown-action' };
  }

  // Inserisce il testo senza simulare Invio, e passa dal setter del prototype perché i framework
  // reattivi (React, Vue, Svelte) intercettano le scritture dirette di .value.
  function fillElement(el, text) {
    if (!el) return false;
    try {
      if (el.matches && el.matches('input, textarea')) {
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        const setter = desc && desc.set;
        if (setter) setter.call(el, text);
        else el.value = text;
        el.focus();
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      if (el.isContentEditable) {
        el.focus();
        // Selezione totale e sostituzione via execCommand: gli editor con handler di paste/input
        // (Slate, Lexical, ProseMirror) ricevono l'evento solo così.
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
        try { document.execCommand('insertText', false, text); }
        catch (_) { el.textContent = text; }
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
        return true;
      }
    } catch (_) {}
    return false;
  }

  // Se `opts` è una stringa vale come opts.note.
  function show(selector, opts, legacyOnClick) {
    clear();
    const target = safeQuery(selector);
    if (!target) return false;
    activeTarget = target;

    let options = opts;
    if (typeof opts === 'string' || opts == null) {
      options = { note: opts || '', action: 'click', onAction: legacyOnClick };
    }
    const action = options.action === 'fill' ? 'fill' : 'click';
    const note = options.note || '';
    const fillValue = action === 'fill' ? (options.value || '') : '';
    const onAction = typeof options.onAction === 'function' ? options.onAction : null;
    onTargetClick = action === 'click' ? onAction : null;

    try { global.SN_EXTRACT?.expandAncestors?.(target); } catch (_) {}

    const overlay = document.createElement('div');
    overlay.className = 'sn-highlight';
    global.SN_FILO_UI?.mark(overlay);
    if (action === 'fill') overlay.classList.add('sn-highlight-fill');
    const frame = document.createElement('div');
    frame.className = 'sn-highlight-frame';
    overlay.appendChild(frame);

    let tip = null;
    if (note || fillValue) {
      tip = document.createElement('div');
      tip.className = 'sn-highlight-tip';
      if (note) {
        const noteEl = document.createElement('div');
        noteEl.className = 'sn-highlight-note';
        noteEl.textContent = note;
        tip.appendChild(noteEl);
      }
      if (action === 'fill') {
        const valueEl = document.createElement('div');
        valueEl.className = 'sn-highlight-value';
        valueEl.textContent = fillValue ? `«${fillValue}»` : '';
        tip.appendChild(valueEl);

        const acceptBtn = document.createElement('button');
        acceptBtn.type = 'button';
        acceptBtn.className = 'sn-highlight-accept';
        acceptBtn.textContent = '✓ Accetta';
        acceptBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!activeTarget) return;
          fillElement(activeTarget, fillValue);
          const cb = onAction;
          // Disattiva subito per evitare doppi trigger su doppio click.
          if (onTargetClick === cb) onTargetClick = null;
          try { cb && cb(); } catch (_) {}
        });
        tip.appendChild(acceptBtn);
      }
      overlay.appendChild(tip);
    }

    document.documentElement.appendChild(overlay);
    activeOverlay = overlay;

    function reposition() {
      if (!activeTarget || !document.contains(activeTarget)) {
        clear();
        return;
      }
      const r = activeTarget.getBoundingClientRect();
      try { global.SN_SIDEBAR?.ensureNotOverTarget?.(r); } catch (_) {}
      frame.style.left = `${r.left}px`;
      frame.style.top = `${r.top}px`;
      frame.style.width = `${r.width}px`;
      frame.style.height = `${r.height}px`;
      if (tip) {
        const tipH = tip.offsetHeight || 24;
        let tipTop = r.top - tipH - 6;
        if (tipTop < 4) tipTop = r.bottom + 6;
        tip.style.left = `${Math.max(4, r.left)}px`;
        tip.style.top = `${tipTop}px`;
        tip.style.maxWidth = `${Math.min(360, window.innerWidth - 16)}px`;
      }
    }

    reposition();
    try { activeTarget.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}

    scrollListener = reposition;
    window.addEventListener('scroll', scrollListener, true);
    window.addEventListener('resize', scrollListener);
    setTimeout(reposition, 350);

    if (action === 'click' && onTargetClick) {
      clickListener = (e) => {
        if (!activeTarget) return;
        const path = e.composedPath ? e.composedPath() : null;
        const hit = path
          ? path.includes(activeTarget)
          : (e.target === activeTarget || activeTarget.contains(e.target));
        if (!hit) return;
        const cb = onTargetClick;
        onTargetClick = null;
        try { cb(); } catch (_) {}
      };
      document.addEventListener('click', clickListener, true);
    }

    return true;
  }

  global.SN_HIGHLIGHT = { show, clear, fillElement, autoAction, clearForceHover };
})(typeof globalThis !== 'undefined' ? globalThis : self);
