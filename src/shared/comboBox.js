// Combobox custom in stile Filo: input editabile + dropdown tematizzato, al
// posto del popup NATIVO della <datalist> (che usa i colori di sistema, fuori
// palette). Riusa le classi .sn-select-pop / .sn-select-option (theme.css) così
// ogni menu a tendina di Filo si vede e si comporta allo stesso modo.
//
// PERCHÉ ESISTE
//   Nasce estraendo la logica che viveva in modelChainEditor.js (dropdown dei
//   nickname per-azione): lo stesso comportamento serviva anche al campo
//   "stringa modello" del registry (Opzioni), che invece usava ancora la
//   <datalist> nativa — incoerente con il resto. Un'unica sorgente evita due
//   dropdown che divergono.
//
// Convenzione IIFE su globalThis come gli altri moduli shared/*.

(function (global) {
  'use strict';

  // Attacca un dropdown custom a `input`, ancorato dentro `host` (che deve
  // essere position:relative). L'input resta editabile: si può scrivere a mano
  // o scegliere dalla lista; digitando, la lista si filtra. Ritorna close().
  //
  // opts:
  //   readOptions: () => [{ value, label }]   sorgente di verità (letta a ogni build)
  //   onPick:      (value) => void            invocata alla scelta dalla tendina
  //   validate:    (value) => { ok, reason }  opzionale: opzioni non valide disabilitate
  //   popClass:    string                     classe extra sul popup (posizionamento)
  //   valueClass:  string                     classe dello span del valore (default .sn-combo-opt-name)
  //   labelClass:  string                     classe dello span dell'etichetta (default .sn-combo-opt-label)
  //   sizeInput:   bool                        tieni input.size = lunghezza testo (pillole catena)
  function attach(host, input, opts) {
    const o = opts || {};
    const readOptions = typeof o.readOptions === 'function' ? o.readOptions : () => [];
    const onPick = typeof o.onPick === 'function' ? o.onPick : () => {};
    const validate = typeof o.validate === 'function' ? o.validate : null;
    const valueClass = o.valueClass || 'sn-combo-opt-name';
    const labelClass = o.labelClass || 'sn-combo-opt-label';

    const pop = document.createElement('div');
    pop.className = 'sn-select-pop' + (o.popClass ? ` ${o.popClass}` : '');
    pop.setAttribute('role', 'listbox');
    pop.hidden = true;
    host.appendChild(pop);

    let optionEls = [];
    let hoverEl = null;
    // Filtro applicato alla lista: vuoto = mostra tutto. Si popola solo quando
    // l'utente DIGITA (non al semplice focus), così aprendo un campo già
    // compilato si vedono comunque tutte le opzioni per cambiarlo.
    let filterText = '';

    function fit() {
      if (o.sizeInput) input.size = Math.max((input.value || '').length + 1, 6);
    }

    function setHover(el) {
      if (hoverEl === el) return;
      if (hoverEl) hoverEl.classList.remove('sn-hover');
      hoverEl = el || null;
      if (hoverEl) {
        hoverEl.classList.add('sn-hover');
        hoverEl.scrollIntoView({ block: 'nearest' });
      }
    }

    function build() {
      const filter = filterText.trim().toLowerCase();
      const all = readOptions() || [];
      const shown = filter
        ? all.filter((it) => String(it.value).toLowerCase().includes(filter)
          || String(it.label || '').toLowerCase().includes(filter))
        : all;
      pop.textContent = '';
      optionEls = [];
      hoverEl = null;
      const list = shown.length ? shown : all; // se il filtro non matcha, mostra tutto
      const current = (input.value || '').trim();
      for (const opt of list) {
        const el = document.createElement('div');
        el.className = 'sn-select-option';
        el.setAttribute('role', 'option');
        el.dataset.value = opt.value;
        if (opt.label) {
          const v = document.createElement('span');
          v.className = valueClass;
          v.textContent = opt.value;
          const l = document.createElement('span');
          l.className = labelClass;
          l.textContent = opt.label;
          el.appendChild(v);
          el.appendChild(l);
        } else {
          el.textContent = opt.value;
        }
        if (opt.value === current) {
          el.classList.add('sn-selected');
          el.setAttribute('aria-selected', 'true');
        }
        // Opzione non valida → visibile ma non selezionabile, col motivo come tooltip.
        const check = validate ? validate(opt.value) : { ok: true };
        if (!check.ok) {
          el.classList.add('sn-disabled');
          el.setAttribute('aria-disabled', 'true');
          el.style.opacity = '0.45';
          el.style.cursor = 'not-allowed';
          el.title = check.reason || '';
        }
        el.addEventListener('mousemove', () => setHover(el));
        // mousedown (non click) così avviene prima del blur dell'input.
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          if (!check.ok) return;
          pick(opt.value);
        });
        pop.appendChild(el);
        optionEls.push(el);
      }
      return optionEls.length;
    }

    function pick(value) {
      if (validate) { const v = validate(value); if (!v.ok) return; }
      input.value = value;
      fit();
      onPick(value);
      close();
      input.focus();
    }

    function moveHover(dir) {
      if (!optionEls.length) return;
      let i = optionEls.indexOf(hoverEl);
      i = (i + dir + optionEls.length) % optionEls.length;
      setHover(optionEls[i]);
    }

    function open() {
      if (!pop.hidden) return;
      if (!build()) return; // niente opzioni → niente popup
      pop.hidden = false;
      host.classList.add('sn-combo-open');
      const sel = optionEls.find((el) => el.classList.contains('sn-selected'));
      setHover(sel || optionEls[0] || null);
    }
    function close() {
      if (pop.hidden) return;
      pop.hidden = true;
      host.classList.remove('sn-combo-open');
      if (hoverEl) hoverEl.classList.remove('sn-hover');
      hoverEl = null;
    }

    input.addEventListener('focus', () => { filterText = ''; open(); });
    input.addEventListener('input', () => {
      filterText = input.value || '';
      if (pop.hidden) open(); else build();
    });
    input.addEventListener('keydown', (e) => {
      if (pop.hidden) {
        if (e.key === 'ArrowDown') { e.preventDefault(); open(); }
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); moveHover(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveHover(-1); }
      else if (e.key === 'Enter') {
        if (hoverEl) { e.preventDefault(); pick(hoverEl.dataset.value); }
      } else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    input.addEventListener('blur', () => { setTimeout(close, 120); });

    return close;
  }

  global.SN_COMBOBOX = { attach };
})(typeof globalThis !== 'undefined' ? globalThis : self);
