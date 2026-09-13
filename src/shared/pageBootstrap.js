// Bootstrap comune per le pagine interne di Filo (dashboard/options/history/…).
// Imposta tema e dimensione del testo su <html> prima del rendering per evitare
// flash. La dimensione testo è un moltiplicatore di zoom salvato nelle
// impostazioni (vedi pagina Preferenze).

(function () {
  'use strict';

  function applyTheme(theme) {
    let resolved = theme;
    if (theme === 'system' || !theme) {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.dataset.snTheme = resolved;
  }

  // Scala la UI di Filo. Usiamo `zoom` (Chromium) perché ridimensiona testo e
  // layout in modo uniforme indipendentemente dal fatto che i font siano in
  // px o rem. `scale` è un moltiplicatore (1 = 100%), clampato a un range sano.
  function applyTextScale(scale) {
    const n = Number(scale);
    const clamped = Number.isFinite(n) ? Math.min(2, Math.max(0.8, n)) : 1;
    document.documentElement.style.zoom = clamped === 1 ? '' : String(clamped);
    // Esponiamo il fattore di zoom come variabile CSS così le pagine che
    // riempiono la viewport (es. la home/newtab) possono compensare le altezze
    // basate su `vh`: senza, `zoom > 1` magnifica un layout `100vh` oltre la
    // viewport e fa comparire uno scrollbar che sposta gli elementi
    // (feedback alpha). Vedi `calc(100vh / var(--sn-zoom))` in dashboard.css.
    document.documentElement.style.setProperty('--sn-zoom', String(clamped));
  }

  // Override dei token estetici (#146.1): inietta/aggiorna lo <style> con le
  // variabili sovrascritte dall'utente. Il registro (themeTokens.js) è caricato
  // via <script> prima di questo file; guardia se una pagina non lo include.
  function applyThemeTokens(tokens) {
    const reg = window.SN_THEME_TOKENS;
    if (reg) reg.applyToDocument(document, tokens || {});
  }

  // Tema/scala iniziali "best effort" prima che le impostazioni siano caricate.
  applyTheme('system');

  // Carica le impostazioni reali appena possibile (lo shim chrome.storage è già
  // disponibile via preload) e applica tema + dimensione testo.
  (async function loadAndApply() {
    try {
      const r = await chrome.storage.local.get('settings');
      const s = (r && r.settings) || {};
      if (s.theme) { window.SN_PAGE_THEME = s.theme; applyTheme(s.theme); }
      applyTextScale(s.textScale);
      applyThemeTokens(s.themeTokens);
    } catch (_) {}
  })();

  // Aggiorna su preferenza sistema cambiata
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', () => {
      const t = window.SN_PAGE_THEME || 'system';
      if (t === 'system') applyTheme(t);
    });
  }

  // Riapplica live se le impostazioni cambiano (es. salvataggio dalla pagina
  // Preferenze in un altro tab). Il canale affidabile cross-tab è il broadcast
  // `settings_updated` (vedi handlers.js → broadcastToTabs): `chrome.storage.
  // onChanged` NON viene propagato fra i WebContentsView, quindi da solo non
  // aggiornava le tab già aperte (feedback alpha: il cambio dimensione testo
  // non si applicava alle schede aperte).
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
  // Manteniamo anche il listener storage.onChanged per compatibilità con
  // eventuali futuri bridge che lo propaghino: oggi è un no-op innocuo.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings) return;
      applyFromSettings(changes.settings.newValue || {});
    });
  } catch (_) {}

  // ───────────────────────────────────────────────────────────────────────
  // Dropdown custom per i <select> (feedback alpha).
  //
  // Il popup nativo di <select> usa l'highlight blu di sistema e NON rispetta
  // `option:hover` in Chromium: impossibile renderlo arancione coerente con la
  // palette Filo. Sostituiamo quindi il popup nativo con uno custom (div) che
  // controlliamo a CSS, mantenendo però il <select> nativo nel DOM (nascosto)
  // come sorgente di verità: chi legge `.value`, ascolta `change` o usa
  // Playwright `selectOption` continua a funzionare senza modifiche.
  //
  // Colori (richiesta esplicita dell'utente): l'opzione SELEZIONATA e quella in
  // HOVER usano lo stesso arancione (--sn-accent) a due opacità diverse
  // (maggiore per la selezionata); quando un'opzione è insieme selezionata e in
  // hover le due opacità si SOMMANO, così l'hover sull'opzione già selezionata
  // dà comunque una risposta visiva. Mai il blu di sistema. (Vedi theme.css.)
  //
  // L'editor è escluso: il suo <select> del font ha una gestione speciale del
  // focus/selezione del documento e si resetta a un placeholder (nessuna
  // opzione persistente da evidenziare).
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
      // Passa dal setter nativo (l'override più sotto risincronizza la UI) e
      // notifica i listener esistenti del <select>.
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

    // Override del setter `value`/`selectedIndex` di QUESTA istanza così che i
    // set programmatici fatti dal codice di pagina (es. preferences.js applica
    // il tema salvato) risincronizzino la UI custom. I cambi via `selectOption`
    // di Playwright o via UI nativa passano invece dall'evento `change`.
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

    // Se le <option> cambiano dopo l'enhancement (es. preset popolati a runtime),
    // ricostruiamo il popup. Debounce su microtask per non rifare il lavoro a
    // ogni singola <option> aggiunta in loop.
    let rebuildQueued = false;
    const mo = new MutationObserver(() => {
      if (rebuildQueued) return;
      rebuildQueued = true;
      queueMicrotask(() => {
        rebuildQueued = false;
        if (pop.hidden) syncFromSelect(); else buildOptions();
        // syncFromSelect legge le option correnti per l'etichetta; se il popup è
        // chiuso non serve ricostruire i div finché non si riapre.
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

  // L'editor ha select speciali (font picker con preservazione della selezione
  // del documento, config moduli): lo escludiamo per intero. Nelle URL filo://
  // la pagina è l'hostname (es. filo://editor/editor.html → host "editor").
  const IS_EDITOR = (location.hostname || '') === 'editor';

  if (!IS_EDITOR) {
    const start = () => {
      enhanceSelects(document);
      // Osserva i <select> aggiunti dinamicamente dopo il primo render.
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

  // ── Rilettura di una pagina di impostazioni ────────────────────────────────
  //
  // Una pagina di impostazioni si rilegge quando qualcosa cambia altrove, così
  // non mostra un valore che non è più vero (#592, giro 3: prima la rilettura
  // si saltava se il cursore era dentro un campo, e il cursore ci resta
  // appiccicato anche mentre sei in un'altra scheda).
  //
  // Rileggere però riscrive tutti i campi con quello che c'è in memoria, e
  // sullo schermo c'è anche roba che in memoria NON c'è: è quella che la pagina
  // si tiene apposta perché l'utente la sistemi. Uno stile più lungo del tetto,
  // che il tetto promette di non accorciare da sé; una misura scritta senza
  // unità, tenuta lì perché tu ci aggiunga il «px»; una riga della lista dei
  // siti bloccati scritta male, segnalata e conservata. Rileggendo spariva
  // tutto, insieme all'avviso che diceva perché (#592, giro 4: cinque porte).
  //
  // Quindi la rilettura rimette al loro posto i campi che l'utente ha toccato e
  // che la pagina non ha salvato. Come li riconosce: dopo ogni rilettura
  // `segnaCampi` scrive in ogni campo di testo il valore che la pagina gli ha
  // appena messo. Se al giro dopo il campo mostra qualcosa di diverso da quel
  // valore, l'ha scritto l'utente; e se dopo la rilettura in memoria c'è ancora
  // lo stesso valore di prima, per quel campo non è cambiato niente altrove e
  // non c'è nessuna ragione di riscriverci sopra. Quando invece il valore in
  // memoria è cambiato davvero, vince la memoria: è il motivo per cui la
  // rilettura esiste.
  const TIPI_TESTO = ['text', 'password', 'search', 'url', 'email', 'tel', 'number'];

  function campiDiTesto() {
    const out = [];
    for (const el of document.querySelectorAll('input[id], textarea[id]')) {
      if (el.tagName === 'TEXTAREA'
        || TIPI_TESTO.includes(String(el.type || 'text').toLowerCase())) out.push(el);
    }
    return out;
  }

  // Da chiamare in fondo al `load()` di ogni pagina di impostazioni: fotografa
  // quello che la pagina ha appena scritto nei campi di testo.
  function segnaCampi() {
    for (const el of campiDiTesto()) el.dataset.snReso = el.value;
  }

  async function ricaricaSenzaDisturbare(load, dopo) {
    const attivo = document.activeElement;
    const fuoco = (attivo && attivo.id && campiDiTesto().includes(attivo))
      ? { id: attivo.id, start: attivo.selectionStart, end: attivo.selectionEnd }
      : null;

    const prima = new Map();
    for (const el of campiDiTesto()) prima.set(el.id, { valore: el.value, reso: el.dataset.snReso });

    await load();

    const rimessi = [];
    for (const [id, p] of prima) {
      // Un campo mai fotografato (la pagina non chiama segnaCampi) non si
      // giudica: si lascia alla rilettura, come prima.
      if (p.reso === undefined) continue;
      const toccatoDallUtente = p.valore !== p.reso;
      const el = document.getElementById(id);
      if (!el) continue;
      const memoriaFerma = el.value === p.reso;
      if (!toccatoDallUtente || !memoriaFerma) continue;
      el.value = p.valore;
      // Resta "toccato": se arriva un'altra rilettura, il testo va rimesso
      // di nuovo finché l'utente non lo sistema.
      el.dataset.snReso = p.reso;
      rimessi.push(el);
    }

    if (fuoco) {
      const ora = document.getElementById(fuoco.id);
      if (ora) {
        try { ora.focus(); } catch (_) {}
        try { if (fuoco.start != null) ora.setSelectionRange(fuoco.start, fuoco.end); } catch (_) {}
      }
    }
    // La pagina rifà quello che è appeso al testo di quei campi: il conteggio,
    // l'avviso, la tendina che lo segue.
    if (typeof dopo === 'function') for (const el of rimessi) dopo(el);
  }

  window.SN_PAGE_BOOTSTRAP = {
    applyTheme, applyTextScale, applyThemeTokens, enhanceSelect, enhanceSelects,
    ricaricaSenzaDisturbare, segnaCampi,
  };
})();
