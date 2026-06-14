// Box di raffinamento estetico (#146.4).
//
// Quando Filo cambia un token estetico su richiesta in chat ("rendi i bottoni
// verdi"), applica SUBITO un valore ragionevole; poi la bolla mostra un bottone
// che apre QUESTO box in sovrimpressione per scegliere il valore esatto, con
// anteprima LIVE. Il tipo di controllo deriva dal tipo del token nel registro
// (themeTokens.js): colore → color picker, opacità → slider, raggio → slider,
// font → menu di famiglie.
//
// È un modulo condiviso (IIFE su globalThis) ma puramente DOM: lo usa la
// dashboard, e si testa in isolamento passando callback-spia (applyLive /
// persist). Le dipendenze arrivano da fuori (Tokens, tema corrente, override
// correnti, applyLive, persist), così il box non sa nulla di IPC o storage.
//
// deps = {
//   Tokens,                 // SN_THEME_TOKENS
//   theme,                  // 'light' | 'dark'
//   overrides,              // mappa { token: valore } corrente (include il
//                           //   valore appena messo da Filo)
//   applyLive(overrides),   // applica live alle superfici, SENZA persistere
//   persist(overrides),     // persiste (il chiamante può debouncare)
//   doc,                    // document (default: globalThis.document)
// }

(function (global) {
  'use strict';

  function deepGetDoc(deps) {
    return (deps && deps.doc) || (typeof document !== 'undefined' ? document : null);
  }

  // Tipo di controllo per un token: deriva dal tipo nel registro.
  function controlTypeFor(name, Tokens) {
    const t = Tokens && Tokens.get && Tokens.get(name);
    const type = t && t.type;
    if (type === 'color' || type === 'opacity' || type === 'size' || type === 'font') return type;
    return 'color';
  }

  // Etichetta del bottone che apre il box, in base al tipo di controllo.
  function triggerLabel(name, Tokens) {
    switch (controlTypeFor(name, Tokens)) {
      case 'opacity': return 'Regola l’opacità';
      case 'size': return 'Regola la dimensione';
      case 'font': return 'Cambia il font';
      case 'color':
      default: return 'Scegli il colore esatto';
    }
  }

  // Converte un valore colore valido (#rgb, #rrggbb, rgb()/rgba()) nel formato
  // #rrggbb richiesto da <input type="color">. Ritorna '#000000' se non
  // interpretabile (non dovrebbe capitare per i token colore).
  function toHexColor(value, Tokens) {
    const triplet = Tokens && Tokens.toRgbTriplet ? Tokens.toRgbTriplet(value) : null;
    if (!triplet) return '#000000';
    const [r, g, b] = triplet.split(',').map((x) => Math.max(0, Math.min(255, parseInt(x, 10) || 0)));
    const h = (n) => n.toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  }

  // Famiglie di font proposte (tutte passano la whitelist di themeTokens.validate).
  const FONT_CHOICES = [
    { label: 'Sistema (predefinito)', value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
    { label: 'Serif (Georgia)', value: "Georgia, 'Times New Roman', serif" },
    { label: 'Sans (Verdana)', value: 'Verdana, Geneva, sans-serif' },
    { label: 'Monospazio', value: "'Courier New', ui-monospace, monospace" },
    { label: 'Tondo (Trebuchet)', value: "'Trebuchet MS', Tahoma, sans-serif" },
  ];

  let openEl = null; // un solo box alla volta

  function close() {
    if (openEl && openEl.parentNode) openEl.parentNode.removeChild(openEl);
    if (openEl && openEl._onKey) global.removeEventListener('keydown', openEl._onKey, true);
    openEl = null;
  }

  // Apre il box di raffinamento per l'azione IMPOSTA_ESTETICA. Ritorna
  // l'elemento overlay (utile ai test) o null se manca il contesto.
  function openOverlay(action, deps) {
    const doc = deepGetDoc(deps);
    const Tokens = deps && deps.Tokens;
    if (!doc || !Tokens) return null;
    const name = action.token ?? action.nome ?? action.name ?? action.chiave ?? action.elemento;
    const t = Tokens.get && Tokens.get(name);
    if (!t) return null;

    close(); // mai due box insieme

    const theme = deps.theme === 'dark' ? 'dark' : 'light';
    const type = controlTypeFor(name, Tokens);
    // Stato di partenza = override correnti (includono il valore già messo da
    // Filo). "Annulla" ci ritorna; ogni modifica parte da una copia di lavoro.
    const startOverrides = { ...(deps.overrides || {}) };
    const working = { ...startOverrides };

    const apply = () => { try { deps.applyLive && deps.applyLive({ ...working }); } catch (_) {} };
    const save = () => { try { deps.persist && deps.persist({ ...working }); } catch (_) {} };

    function setValue(rawVal) {
      const v = String(rawVal == null ? '' : rawVal).trim();
      if (v === '' || v === Tokens.defaultValue(name, theme)) delete working[name];
      else if (Tokens.validate(name, v)) working[name] = v;
      else return; // valore non valido: ignora (i controlli nativi non li producono)
      updateSample();
      apply();
      save();
    }

    // ── overlay + pannello ──────────────────────────────────────────────────
    const overlay = doc.createElement('div');
    overlay.className = 'sn-refine-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const panel = doc.createElement('div');
    panel.className = 'sn-refine-panel';
    overlay.appendChild(panel);

    const title = doc.createElement('div');
    title.className = 'sn-refine-title';
    title.textContent = `Regola: ${t.label || name}`;
    panel.appendChild(title);

    // Anteprima: riflette il valore di lavoro (oltre alle superfici dietro, che
    // applyLive aggiorna comunque).
    const sample = doc.createElement('div');
    sample.className = 'sn-refine-sample';
    panel.appendChild(sample);

    function updateSample() {
      const eff = Tokens.effectiveValue(name, working, theme) || '';
      const bg = Tokens.effectiveValue('background', working, theme);
      const fg = Tokens.effectiveValue('text', working, theme);
      sample.style.background = bg;
      sample.style.color = fg;
      sample.textContent = '';
      if (type === 'color') {
        const sw = doc.createElement('span');
        sw.className = 'sn-refine-swatch';
        sw.style.background = eff;
        sample.appendChild(sw);
        const btn = doc.createElement('span');
        btn.className = 'sn-refine-sample-btn';
        // Mostra il colore scelto come sfondo del "bottone" se è un token bottone,
        // altrimenti come testo/accento.
        if (name === 'button.bg' || name === 'background') { btn.style.background = eff; btn.style.color = Tokens.effectiveValue('button.fg', working, theme); }
        else if (name === 'button.fg' || name === 'text') { btn.style.color = eff; }
        else { btn.style.background = Tokens.effectiveValue('button.bg', working, theme); btn.style.color = eff; }
        btn.textContent = 'Bottone';
        sample.appendChild(btn);
        const txt = doc.createElement('span');
        txt.className = 'sn-refine-sample-text';
        if (name === 'link.color' || name === 'accent' || name === 'selection.color') txt.style.color = eff;
        txt.textContent = 'Testo di esempio';
        sample.appendChild(txt);
      } else if (type === 'opacity') {
        const mark = doc.createElement('span');
        mark.className = 'sn-refine-sample-text';
        const selColor = Tokens.effectiveValue('selection.color', working, theme);
        const rgb = Tokens.toRgbTriplet(selColor) || '196, 90, 59';
        mark.style.background = `rgba(${rgb}, ${eff})`;
        mark.textContent = 'Testo selezionato';
        sample.appendChild(mark);
      } else if (type === 'size') {
        const box = doc.createElement('span');
        box.className = 'sn-refine-sample-box';
        box.style.borderRadius = eff;
        box.style.background = Tokens.effectiveValue('accent', working, theme);
        sample.appendChild(box);
        const lbl = doc.createElement('span');
        lbl.className = 'sn-refine-sample-text';
        lbl.textContent = eff;
        sample.appendChild(lbl);
      } else if (type === 'font') {
        const txt = doc.createElement('span');
        txt.className = 'sn-refine-sample-text';
        txt.style.fontFamily = eff;
        txt.textContent = 'Aa — Testo di esempio 123';
        sample.appendChild(txt);
      }
    }

    // ── controllo per tipo ────────────────────────────────────────────────────
    const controlWrap = doc.createElement('div');
    controlWrap.className = 'sn-refine-control';
    panel.appendChild(controlWrap);

    const startEff = Tokens.effectiveValue(name, working, theme) || '';
    let control;
    if (type === 'color') {
      control = doc.createElement('input');
      control.type = 'color';
      control.className = 'sn-refine-input sn-refine-color';
      control.value = toHexColor(startEff, Tokens);
      control.setAttribute('aria-label', t.label || name);
      control.addEventListener('input', () => setValue(control.value));
    } else if (type === 'opacity') {
      control = doc.createElement('input');
      control.type = 'range';
      control.className = 'sn-refine-input sn-refine-range';
      control.min = '0'; control.max = '1'; control.step = '0.05';
      control.value = String(parseFloat(startEff) || 0);
      control.setAttribute('aria-label', t.label || name);
      control.addEventListener('input', () => {
        const n = Math.round((parseFloat(control.value) || 0) * 20) / 20;
        setValue(String(n));
      });
    } else if (type === 'size') {
      control = doc.createElement('input');
      control.type = 'range';
      control.className = 'sn-refine-input sn-refine-range';
      control.min = '0'; control.max = '24'; control.step = '1';
      control.value = String(parseInt(startEff, 10) || 0);
      control.setAttribute('aria-label', t.label || name);
      control.addEventListener('input', () => setValue(`${parseInt(control.value, 10) || 0}px`));
    } else { // font
      control = doc.createElement('select');
      control.className = 'sn-refine-input sn-refine-select';
      control.setAttribute('aria-label', t.label || name);
      let matched = false;
      for (const f of FONT_CHOICES) {
        const o = doc.createElement('option');
        o.value = f.value; o.textContent = f.label;
        if (f.value === startEff) { o.selected = true; matched = true; }
        control.appendChild(o);
      }
      if (!matched) {
        const o = doc.createElement('option');
        o.value = startEff; o.textContent = 'Attuale'; o.selected = true;
        control.insertBefore(o, control.firstChild);
      }
      control.addEventListener('change', () => setValue(control.value));
    }
    controlWrap.appendChild(control);

    // ── footer ────────────────────────────────────────────────────────────────
    const footer = doc.createElement('div');
    footer.className = 'sn-refine-footer';

    const cancel = doc.createElement('button');
    cancel.type = 'button';
    cancel.className = 'sn-refine-btn sn-refine-cancel';
    cancel.textContent = 'Annulla';
    cancel.addEventListener('click', () => {
      // Ripristina lo stato di apertura (= valore messo da Filo) e persiste.
      try { deps.applyLive && deps.applyLive({ ...startOverrides }); } catch (_) {}
      try { deps.persist && deps.persist({ ...startOverrides }); } catch (_) {}
      close();
    });
    footer.appendChild(cancel);

    const done = doc.createElement('button');
    done.type = 'button';
    done.className = 'sn-refine-btn sn-refine-done';
    done.textContent = 'Fatto';
    done.addEventListener('click', () => { save(); close(); });
    footer.appendChild(done);

    panel.appendChild(footer);

    // Click fuori dal pannello = chiudi tenendo il valore (già persistito).
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) { save(); close(); } });
    // Esc = chiudi tenendo il valore.
    const onKey = (e) => { if (e.key === 'Escape') { save(); close(); } };
    global.addEventListener('keydown', onKey, true);
    overlay._onKey = onKey;

    updateSample();
    (doc.body || doc.documentElement).appendChild(overlay);
    openEl = overlay;
    try { control.focus(); } catch (_) {}
    return overlay;
  }

  // Bottone "trigger" da inserire nella bolla: apre il box al click.
  function buildButton(action, deps) {
    const doc = deepGetDoc(deps);
    const Tokens = deps && deps.Tokens;
    if (!doc || !Tokens) return null;
    const name = action.token ?? action.nome ?? action.name ?? action.chiave ?? action.elemento;
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'dash-action-btn sn-refine-trigger';
    btn.textContent = `🎨 ${triggerLabel(name, Tokens)}`;
    btn.addEventListener('click', () => {
      // Le dipendenze possono essere risolte pigramente (deps.resolve) per
      // leggere gli override più freschi al momento del click.
      const resolved = typeof deps.resolve === 'function' ? deps.resolve() : deps;
      Promise.resolve(resolved).then((d) => openOverlay(action, d || deps));
    });
    return btn;
  }

  global.SN_AESTHETIC_REFINER = {
    controlTypeFor,
    triggerLabel,
    toHexColor,
    buildButton,
    openOverlay,
    close,
    FONT_CHOICES,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
