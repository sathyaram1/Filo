// Overlay di evidenziazione per la sidebar Aiuto. Cornice colorata + tooltip
// sopra l'elemento individuato via CSS selector. Due modalità:
// - action="click": il tooltip mostra "text"; clic sul target → onAction()
// - action="fill":  il tooltip mostra "text" + valore proposto + bottone
//                   "✓ Accetta"; clic sul bottone → inserisce il valore nel
//                   target (senza Invio) e poi → onAction()
//
// Il telaio della cornice resta sempre pointer-events:none così non blocca
// l'utente; il bottone Accetta è invece interattivo (pointer-events:auto).

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
    // NB: il force-hover NON viene pulito qui: deve sopravvivere tra turni
    // perché l'agente, dopo aver fatto hover su un menu, vorrà evidenziare
    // una voce interna con un "click". Lo puliamo solo a fine sessione o
    // dopo un click utente reale (vedi clearForceHover esposto).
  }

  function safeQuery(selector) {
    try { return document.querySelector(selector); }
    catch (_) { return null; }
  }

  // ---------------------------------------------------------------------------
  // Azioni "auto" eseguite dall'agente senza interazione utente.
  // - reveal: apre un <details> o un disclosure aria-expanded=false con
  //   aria-controls. Whitelist stretta lato SN_EXTRACT.canRevealElement per
  //   evitare di cliccare link/submit/elementi di form. NB: l'unica via
  //   programmatica affidabile per il pattern aria-expanded è .click()
  //   sull'elemento; la whitelist garantisce che il click non navighi né
  //   submitta.
  // - hover: simula mouseenter/over per aprire menu JS-driven; in fallback
  //   inietta una regola CSS che forza la visibilità del menu figlio.
  // ---------------------------------------------------------------------------

  const forceHoverTargets = new Set();
  function ensureForceHoverSheet() {
    if (document.getElementById('sn-force-hover-sheet')) return;
    const s = document.createElement('style');
    s.id = 'sn-force-hover-sheet';
    global.SN_FILO_UI?.mark(s);
    // Regola "best effort": copre i pattern dropdown più comuni. Non
    // garantita su markup esotici, ma il dispatch di mouseenter copre
    // il 90% dei casi reali; questo è il fallback per :hover puro CSS.
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
      // aria-expanded pattern: safe per whitelist (no nav, no submit)
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

  // Esegue un'azione auto (reveal | hover) e ritorna un descrittore
  // sintetico {ok, action, label} che la sidebar usa per il follow-up.
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

  // Inserisce text in input/textarea/contenteditable senza simulare Invio.
  // Usa il setter del prototype per essere compatibile con framework reattivi
  // (React, Vue, Svelte) che intercettano le modifiche dirette di .value.
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
        // Selezione totale del contenuto, poi sostituzione tramite execCommand
        // (così gli editor con paste/input handlers — Slate, Lexical, ProseMirror —
        // ricevono l'evento correttamente).
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

  // opts: { note?, action?: 'click'|'fill', value?: string, onAction?: () => void }
  // Backward-compat: se opts è una stringa, viene trattato come opts.note.
  function show(selector, opts, legacyOnClick) {
    clear();
    const target = safeQuery(selector);
    if (!target) return false;
    activeTarget = target;

    // Normalizza signature: legacy = show(selector, noteString, onClickFn)
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
      // Sposta la sidebar di lato se sta coprendo il target (idempotente: se
      // non si sovrappone, non fa nulla).
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

    // Solo per action="click": il clic sul target stesso conferma il passo.
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
