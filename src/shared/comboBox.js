// Combobox in stile Filo al posto del popup nativo della <datalist>, che usa i colori di
// sistema e cade fuori palette.
// Riusa .sn-select-pop di theme.css: una sorgente sola invece di due tendine che divergono.

(function (global) {
  'use strict';

  const OPZIONI_ARRIVATE = 'sn-combo-opzioni-arrivate';

  // Attacca un dropdown custom a `input`, ancorato dentro `host` (che deve
  // essere position:relative). L'input resta editabile: si può scrivere a mano
  // o scegliere dalla lista; digitando, la lista si filtra. Ritorna close().
  //
  // opts:
  //   readOptions: () => [{ value, label, extra? }]   sorgente di verità (letta a ogni build); `extra` va in coda
  //   onPick:      (value) => void            invocata alla scelta dalla tendina
  //   validate:    (value) => { ok, reason }  opzionale: opzioni non valide disabilitate
  //   popClass:    string                     classe extra sul popup (posizionamento)
  //   valueClass:  string                     classe dello span del valore (default .sn-combo-opt-name)
  //   labelClass:  string                     classe dello span dell'etichetta (default .sn-combo-opt-label)
  //   extraClass:  string                     classe dello span di `extra` (default .sn-combo-opt-extra)
  //   sizeInput:   bool                        tieni input.size = lunghezza testo (pillole catena)
  function attach(host, input, opts) {
    const o = opts || {};
    const readOptions = typeof o.readOptions === 'function' ? o.readOptions : () => [];
    const onPick = typeof o.onPick === 'function' ? o.onPick : () => {};
    const validate = typeof o.validate === 'function' ? o.validate : null;
    const valueClass = o.valueClass || 'sn-combo-opt-name';
    const labelClass = o.labelClass || 'sn-combo-opt-label';
    const extraClass = o.extraClass || 'sn-combo-opt-extra';

    const pop = document.createElement('div');
    pop.className = 'sn-select-pop' + (o.popClass ? ` ${o.popClass}` : '');
    pop.setAttribute('role', 'listbox');
    pop.hidden = true;
    host.appendChild(pop);

    let optionEls = [];
    let hoverEl = null;
    // Il filtro si popola solo quando l'utente DIGITA, non al focus: aprendo un campo già
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
        if (opt.extra) {
          const x = document.createElement('span');
          x.className = extraClass;
          x.textContent = opt.extra;
          el.appendChild(x);
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

    // La ricerca fra i modelli, per i contatori (#1461): conta da quando si scrive o si sceglie, mai il testo scritto.
    let ricerca = null;
    const contaRicerca = (ev) => {
      try {
        const M = global.SN_MSG && global.SN_MSG.MSG;
        const r = M && global.chrome && global.chrome.runtime
          ? global.chrome.runtime.sendMessage({ type: M.CONTATORI_EVENTO, misura: 'ricerca', pannello: 'modello', ...ev }) : null;
        if (r && typeof r.catch === 'function') r.catch(() => {});
      } catch (_) {}
    };
    const iniziaRicerca = () => {
      if (!ricerca || ricerca.iniziata) return;
      ricerca.iniziata = true;
      contaRicerca({ esito: 'aperta' });
    };

    function pick(value) {
      if (validate) { const v = validate(value); if (!v.ok) return; }
      if (ricerca) {
        iniziaRicerca();
        const i = optionEls.findIndex((el) => el.dataset.value === value);
        contaRicerca({ esito: 'scelta', attesaMs: Date.now() - ricerca.t0, posizione: i >= 0 ? i + 1 : null });
        ricerca.scelto = true;
      }
      input.value = value;
      fit();
      // Scegliere dalla tendina è scrivere: senza questo evento chi ascolta il
      // campo (una misura che vale per quel modello) non si accorge del cambio.
      try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
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

    // Il catalogo si chiede al primo fuoco: un menu rimasto chiuso perché la lista era ancora vuota si apre quando
    // arriva, se il campo ha ancora il fuoco. Uno già aperto non si ricompone sotto il puntatore.
    let aVuoto = false;
    function open() {
      if (!pop.hidden) return;
      aVuoto = !build();
      if (aVuoto) return;
      pop.hidden = false;
      host.classList.add('sn-combo-open');
      const sel = optionEls.find((el) => el.classList.contains('sn-selected'));
      setHover(sel || optionEls[0] || null);
      if (!ricerca) ricerca = { t0: Date.now(), iniziata: false, scelto: false };
    }
    function close() {
      if (pop.hidden) return;
      if (ricerca && ricerca.iniziata && !ricerca.scelto) contaRicerca({ esito: 'vuota' });
      ricerca = null;
      pop.hidden = true;
      host.classList.remove('sn-combo-open');
      if (hoverEl) hoverEl.classList.remove('sn-hover');
      hoverEl = null;
    }

    // Un ritorno a fuoco entro il ritardo del blur annulla la chiusura: altrimenti il menu
    // appena riaperto si chiude sotto un campo a fuoco (#1004.2).
    let blurTimer = null;
    input.addEventListener('focus', () => {
      clearTimeout(blurTimer);
      filterText = '';
      close();
      open();
    });
    // Campo già a fuoco col menu chiuso (dopo una scelta, Esc): il clic lo riapre.
    input.addEventListener('click', () => { if (pop.hidden) { filterText = ''; open(); } });
    input.addEventListener('input', () => {
      filterText = input.value || '';
      if (pop.hidden) open(); else build();
      iniziaRicerca();
    });
    input.addEventListener('keydown', (e) => {
      if (pop.hidden) {
        if (e.key === 'ArrowDown') { e.preventDefault(); open(); }
        else if (e.key === 'Escape') aVuoto = false;
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); moveHover(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveHover(-1); }
      else if (e.key === 'Enter') {
        if (hoverEl) { e.preventDefault(); pick(hoverEl.dataset.value); }
      } else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    input.addEventListener('blur', () => { aVuoto = false; clearTimeout(blurTimer); blurTimer = setTimeout(close, 120); });
    input.addEventListener(OPZIONI_ARRIVATE, () => {
      if (aVuoto && pop.hidden && input.ownerDocument.activeElement === input) open();
    });

    return close;
  }

  // Chi riempie una lista dopo il fuoco lo dice qui: lo sente solo il campo che ha il fuoco.
  function opzioniArrivate() {
    const el = global.document.activeElement;
    if (el) el.dispatchEvent(new CustomEvent(OPZIONI_ARRIVATE));
  }

  global.SN_COMBOBOX = { attach, opzioniArrivate };
})(typeof globalThis !== 'undefined' ? globalThis : self);
