// Bootstrap comune delle pagine interne di Filo: tema e dimensione del testo su <html>
// PRIMA del rendering, per evitare il flash. La dimensione è un moltiplicatore di zoom
// salvato nelle impostazioni (pagina Preferenze).

(function () {
  'use strict';

  function applyTheme(theme) {
    let resolved = theme;
    if (theme === 'system' || !theme) {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.dataset.snTheme = resolved;
  }

  // `zoom` di Chromium e non `scale`: ridimensiona testo e layout in modo uniforme che i font
  // siano in px o in rem. Il moltiplicatore è clampato a un range sano.
  function applyTextScale(scale) {
    const n = Number(scale);
    const clamped = Number.isFinite(n) ? Math.min(2, Math.max(0.8, n)) : 1;
    document.documentElement.style.zoom = clamped === 1 ? '' : String(clamped);
    // Il fattore esce anche come variabile CSS perché le pagine che riempiono la viewport
    // possano compensare le altezze in `vh`: con `zoom > 1` un layout `100vh` sfora e fa
    // comparire una barra di scorrimento che sposta gli elementi (`calc(100vh / var(--sn-zoom))`).
    document.documentElement.style.setProperty('--sn-zoom', String(clamped));
  }

  // Override dei token estetici (#146.1). Il registro (themeTokens.js) è caricato prima di
  // questo file: guardia se una pagina non lo include.
  function applyThemeTokens(tokens) {
    const reg = window.SN_THEME_TOKENS;
    if (reg) reg.applyToDocument(document, tokens || {});
  }

  // Tema/scala iniziali "best effort" prima che le impostazioni siano caricate.
  applyTheme('system');

  // Le impostazioni reali appena possibile (lo shim chrome.storage arriva dal preload).
  (async function loadAndApply() {
    try {
      const r = await chrome.storage.local.get('settings');
      const s = (r && r.settings) || {};
      if (s.theme) { window.SN_PAGE_THEME = s.theme; applyTheme(s.theme); }
      applyTextScale(s.textScale);
      applyThemeTokens(s.themeTokens);
    } catch (_) {}
  })();

  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', () => {
      const t = window.SN_PAGE_THEME || 'system';
      if (t === 'system') applyTheme(t);
    });
  }

  // Il canale affidabile fra schede è il broadcast `settings_updated`: `chrome.storage.
  // onChanged` NON viene propagato fra i WebContentsView, quindi da solo non aggiornava le
  // tab già aperte (il cambio dimensione testo non ci arrivava).
  function applyFromSettings(s) {
    if (!s) return;
    if (s.theme) { window.SN_PAGE_THEME = s.theme; applyTheme(s.theme); }
    applyTextScale(s.textScale);
    applyThemeTokens(s.themeTokens);
  }
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'settings_updated') applyFromSettings(msg.settings);
    });
  } catch (_) {}
  // storage.onChanged resta per un eventuale bridge futuro che lo propaghi: oggi è un no-op.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings) return;
      applyFromSettings(changes.settings.newValue || {});
    });
  } catch (_) {}

  // Dropdown custom per i <select>: il popup nativo usa l'highlight blu di sistema e in
  // Chromium non rispetta `option:hover`, quindi non si può rendere coerente con la palette.
  // Il <select> nativo resta nel DOM (nascosto) come sorgente di verità, così `.value`,
  // `change` e `selectOption` di Playwright continuano a funzionare. Selezionata e hover
  // usano lo stesso arancione a due opacità che si SOMMANO, così l'hover sull'opzione già
  // selezionata risponde comunque. L'editor è escluso: il suo <select> del font ha una
  // gestione speciale del focus.
  function enhanceSelect(select) {
    if (!select || select.dataset.snEnhanced) return;
    if (select.multiple || select.size > 1) return;
    if (select.hasAttribute('data-sn-no-enhance')) return;
    select.dataset.snEnhanced = '1';

    const wrap = document.createElement('div');
    wrap.className = 'sn-select-wrap';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sn-select-button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    const aria = select.getAttribute('aria-label') || select.getAttribute('title');
    if (aria) button.setAttribute('aria-label', aria);
    const valueEl = document.createElement('span');
    valueEl.className = 'sn-select-value';
    button.appendChild(valueEl);
    const chevron = document.createElement('span');
    chevron.className = 'sn-select-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '▾';
    button.appendChild(chevron);
    wrap.appendChild(button);

    const pop = document.createElement('div');
    pop.className = 'sn-select-pop';
    pop.setAttribute('role', 'listbox');
    pop.hidden = true;
    wrap.appendChild(pop);

    let optionEls = [];
    let hoverEl = null;

    function setHover(o) {
      if (hoverEl === o) return;
      if (hoverEl) hoverEl.classList.remove('sn-hover');
      hoverEl = o || null;
      if (hoverEl) hoverEl.classList.add('sn-hover');
    }

    function syncFromSelect() {
      const cur = select.options[select.selectedIndex];
      valueEl.textContent = cur ? cur.textContent : '';
      for (const o of optionEls) {
        const isSel = !!cur && o.dataset.value === cur.value;
        o.classList.toggle('sn-selected', isSel);
        o.setAttribute('aria-selected', isSel ? 'true' : 'false');
      }
    }

    function buildOptions() {
      pop.textContent = '';
      optionEls = [];
      hoverEl = null;
      for (const opt of Array.from(select.options)) {
        const o = document.createElement('div');
        o.className = 'sn-select-option';
        o.setAttribute('role', 'option');
        o.dataset.value = opt.value;
        o.textContent = opt.textContent;
        if (opt.disabled) o.setAttribute('aria-disabled', 'true');
        o.addEventListener('mousemove', () => setHover(o));
        o.addEventListener('click', () => {
          if (opt.disabled) return;
          pick(opt.value);
          close();
          button.focus();
        });
        pop.appendChild(o);
        optionEls.push(o);
      }
      syncFromSelect();
    }

    function pick(value) {
      // Dal setter nativo (l'override più sotto risincronizza la UI), e si notificano i listener.
      select.value = value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function moveHover(dir) {
      if (!optionEls.length) return;
      let i = optionEls.indexOf(hoverEl);
      for (let n = 0; n < optionEls.length; n++) {
        i = (i + dir + optionEls.length) % optionEls.length;
        if (optionEls[i].getAttribute('aria-disabled') !== 'true') break;
      }
      setHover(optionEls[i]);
      hoverEl.scrollIntoView({ block: 'nearest' });
    }

    function onDocDown(e) { if (!wrap.contains(e.target)) close(); }
    function onKey(e) {
      if (pop.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); moveHover(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveHover(-1); }
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (hoverEl) { pick(hoverEl.dataset.value); close(); button.focus(); }
      } else if (e.key === 'Escape' || e.key === 'Tab') {
        if (e.key === 'Escape') e.preventDefault();
        close();
      }
    }

    function open() {
      if (!pop.hidden) return;
      buildOptions();
      pop.hidden = false;
      wrap.classList.add('sn-open');
      button.setAttribute('aria-expanded', 'true');
      const selEl = optionEls.find((o) => o.classList.contains('sn-selected'));
      setHover(selEl || optionEls[0] || null);
      if (hoverEl) hoverEl.scrollIntoView({ block: 'nearest' });
      document.addEventListener('mousedown', onDocDown, true);
      document.addEventListener('keydown', onKey, true);
    }
    function close() {
      if (pop.hidden) return;
      pop.hidden = true;
      wrap.classList.remove('sn-open');
      button.setAttribute('aria-expanded', 'false');
      setHover(null);
      document.removeEventListener('mousedown', onDocDown, true);
      document.removeEventListener('keydown', onKey, true);
    }

    button.addEventListener('click', () => { pop.hidden ? open() : close(); });
    button.addEventListener('keydown', (e) => {
      if (pop.hidden && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        open();
      }
    });

    // Override di `value`/`selectedIndex` su QUESTA istanza, così i set programmatici del
    // codice di pagina risincronizzano la UI custom; i cambi via `selectOption` o dalla UI
    // nativa passano invece dall'evento `change`.
    const sproto = Object.getPrototypeOf(select);
    for (const prop of ['value', 'selectedIndex']) {
      const d = Object.getOwnPropertyDescriptor(sproto, prop);
      if (!d || !d.set || !d.get) continue;
      Object.defineProperty(select, prop, {
        configurable: true,
        get() { return d.get.call(this); },
        set(v) { d.set.call(this, v); syncFromSelect(); },
      });
    }
    select.addEventListener('change', syncFromSelect);

    // Se le <option> cambiano dopo l'enhancement (preset popolati a runtime) si ricostruisce il
    // popup. Debounce su microtask per non rifare il lavoro a ogni <option> aggiunta in loop.
    let rebuildQueued = false;
    const mo = new MutationObserver(() => {
      if (rebuildQueued) return;
      rebuildQueued = true;
      queueMicrotask(() => {
        rebuildQueued = false;
        if (pop.hidden) syncFromSelect(); else buildOptions();
        // A popup chiuso non serve ricostruire i div finché non si riapre.
      });
    });
    mo.observe(select, { childList: true });

    buildOptions();
  }

  function enhanceSelects(root) {
    const scope = root && root.querySelectorAll ? root : document;
    const list = scope.querySelectorAll
      ? scope.querySelectorAll('select')
      : [];
    list.forEach(enhanceSelect);
  }

  // L'editor ha select speciali (font picker, config moduli): escluso per intero. Nelle URL
  // filo:// la pagina è l'hostname (filo://editor/editor.html → host «editor»).
  const IS_EDITOR = (location.hostname || '') === 'editor';

  if (!IS_EDITOR) {
    const start = () => {
      enhanceSelects(document);
      const obs = new MutationObserver((records) => {
        for (const rec of records) {
          for (const node of rec.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.tagName === 'SELECT') enhanceSelect(node);
            else if (node.querySelectorAll) enhanceSelects(node);
          }
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }

  window.SN_PAGE_BOOTSTRAP = { applyTheme, applyTextScale, applyThemeTokens, enhanceSelect, enhanceSelects };
})();
