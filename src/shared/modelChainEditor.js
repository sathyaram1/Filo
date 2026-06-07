// Editor "a segmenti" per la catena di modelli di un'azione.
//
// Ogni azione può usare PIÙ modelli in ordine di priorità: il primo è il
// modello principale, gli altri sono fallback provati in ordine se quello
// prima fallisce. Internamente la catena resta una stringa di nickname
// separati da virgola (es. "flash, flash-or"), così lo storage e la
// risoluzione lato main (parseModelRefs) non cambiano. Questo modulo fornisce
// solo l'editor visuale: una "pillola" con un segmento per modello, separati
// da un divisore, con un pulsante per aggiungerne e uno per rimuoverli.
//
// Convenzione IIFE su globalThis come gli altri moduli shared/*.

(function (global) {
  'use strict';

  function t(key, ...args) {
    return global.SN_I18N ? global.SN_I18N.t(key, ...args) : key;
  }

  // Le azioni esposte nell'editor (sottoinsieme di ACTIONS) con la rispettiva
  // chiave i18n per l'etichetta. Calcolate al volo così SN_CONST è già caricato.
  function actionLabels() {
    const A = global.SN_CONST.ACTIONS;
    return [
      [A.EXPLAIN, 'options_action_explain'],
      [A.EXPLAIN_DEEP, 'options_action_explain_deep'],
      [A.TRANSLATE_SELECTION, 'options_action_translate_sel'],
      [A.TRANSLATE_PAGE, 'options_action_translate_page'],
      [A.HELP, 'options_action_help'],
      [A.CATEGORIZE, 'options_action_categorize'],
      [A.DESCRIBE_IMAGE, 'options_action_describe_image'],
      [A.TRANSCRIBE_IMAGE, 'options_action_transcribe_image'],
      [A.TRANSCRIBE_AUDIO, 'options_action_transcribe_audio'],
      [A.SPELLCHECK_SEMANTIC, 'spell_action_semantic_label'],
      [A.SPELLCHECK_WORD, 'spell_action_word_label'],
      [A.HELP_INTENT_GUESS, 'options_action_help_intent_guess'],
      [A.HELP_INTENT_JUDGE, 'options_action_help_intent_judge'],
    ];
  }

  function splitRefs(value) {
    return String(value == null ? '' : value)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function fit(inp) {
    inp.size = Math.max((inp.value || '').length + 1, 6);
  }

  // Sorgente delle opzioni per il dropdown: i nickname del registry, esposti
  // nella <datalist id="nicknames-list"> da entrambe le pagine (Opzioni e
  // Modelli predefiniti). Restano l'unica sorgente di verità: il dropdown
  // custom la legge, non la duplica.
  function readNicknameOptions() {
    const dl = document.getElementById('nicknames-list');
    if (!dl) return [];
    return Array.from(dl.options).map((o) => ({
      value: o.value,
      label: o.label && o.label !== o.value ? o.label : '',
    }));
  }

  // Collega un dropdown custom (stile .sn-select-* coerente col resto di Filo)
  // a un input di segmento, al posto del popup nativo della <datalist> (che usa
  // i colori di sistema, fuori palette). L'input resta editabile: si può sia
  // scrivere a mano un nickname sia sceglierlo dalla lista; scrivendo, la lista
  // si filtra. Ritorna una funzione per chiudere il popup.
  function attachDropdown(seg, inp, onPick) {
    const pop = document.createElement('div');
    pop.className = 'sn-select-pop sn-chain-pop';
    pop.setAttribute('role', 'listbox');
    pop.hidden = true;
    seg.appendChild(pop);

    let optionEls = [];
    let hoverEl = null;
    // Filtro applicato alla lista: vuoto = mostra tutto. Si popola solo quando
    // l'utente DIGITA (non al semplice focus), così aprendo un campo già
    // compilato si vedono comunque tutti i modelli per cambiarlo.
    let filterText = '';

    function setHover(o) {
      if (hoverEl === o) return;
      if (hoverEl) hoverEl.classList.remove('sn-hover');
      hoverEl = o || null;
      if (hoverEl) {
        hoverEl.classList.add('sn-hover');
        hoverEl.scrollIntoView({ block: 'nearest' });
      }
    }

    function build() {
      const filter = filterText.trim().toLowerCase();
      const all = readNicknameOptions();
      const shown = filter
        ? all.filter((o) => o.value.toLowerCase().includes(filter) || o.label.toLowerCase().includes(filter))
        : all;
      pop.textContent = '';
      optionEls = [];
      hoverEl = null;
      const list = shown.length ? shown : all; // se il filtro non matcha, mostra tutto
      for (const opt of list) {
        const o = document.createElement('div');
        o.className = 'sn-select-option';
        o.setAttribute('role', 'option');
        o.dataset.value = opt.value;
        if (opt.label) {
          const v = document.createElement('span');
          v.className = 'sn-chain-opt-nick';
          v.textContent = opt.value;
          const l = document.createElement('span');
          l.className = 'sn-chain-opt-label';
          l.textContent = opt.label;
          o.appendChild(v);
          o.appendChild(l);
        } else {
          o.textContent = opt.value;
        }
        if (opt.value === (inp.value || '').trim()) {
          o.classList.add('sn-selected');
          o.setAttribute('aria-selected', 'true');
        }
        o.addEventListener('mousemove', () => setHover(o));
        // mousedown (non click) così avviene prima del blur dell'input.
        o.addEventListener('mousedown', (e) => {
          e.preventDefault();
          pick(opt.value);
        });
        pop.appendChild(o);
        optionEls.push(o);
      }
      return optionEls.length;
    }

    function pick(value) {
      inp.value = value;
      fit(inp);
      onPick(value);
      close();
      inp.focus();
    }

    function moveHover(dir) {
      if (!optionEls.length) return;
      let i = optionEls.indexOf(hoverEl);
      i = (i + dir + optionEls.length) % optionEls.length;
      setHover(optionEls[i]);
    }

    function open() {
      if (!pop.hidden) return;
      if (!build()) return; // niente nickname nel registry → niente popup
      pop.hidden = false;
      seg.classList.add('sn-chain-open');
      const sel = optionEls.find((o) => o.classList.contains('sn-selected'));
      setHover(sel || optionEls[0] || null);
    }
    function close() {
      if (pop.hidden) return;
      pop.hidden = true;
      seg.classList.remove('sn-chain-open');
      if (hoverEl) hoverEl.classList.remove('sn-hover');
      hoverEl = null;
    }

    inp.addEventListener('focus', open);
    inp.addEventListener('input', () => { if (pop.hidden) open(); else build(); });
    inp.addEventListener('keydown', (e) => {
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
    inp.addEventListener('blur', () => { setTimeout(close, 120); });

    return close;
  }

  // Costruisce l'editor a segmenti per UNA azione.
  // Ritorna { el, getValue } dove getValue() torna la stringa "a, b, c".
  function buildChain(value, onChange) {
    const el = document.createElement('div');
    el.className = 'sn-chain';
    let refs = splitRefs(value);
    if (!refs.length) refs = [''];

    function emit() { if (typeof onChange === 'function') onChange(); }
    function getValue() { return refs.map((s) => s.trim()).filter(Boolean).join(', '); }

    function render(focusIdx) {
      el.innerHTML = '';
      refs.forEach((ref, i) => {
        if (i > 0) {
          const sep = document.createElement('span');
          sep.className = 'sn-chain-sep';
          el.appendChild(sep);
        }
        const seg = document.createElement('span');
        seg.className = 'sn-chain-seg';

        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'sn-chain-input';
        // Niente più `list="nicknames-list"`: il popup nativo della datalist usa
        // i colori di sistema, fuori palette. Lo sostituiamo con un dropdown
        // custom .sn-select-* coerente con gli altri menu a tendina di Filo.
        inp.setAttribute('autocomplete', 'off');
        inp.value = ref;
        inp.placeholder = i === 0 ? t('options_chain_primary') : t('options_chain_fallback');
        fit(inp);
        inp.addEventListener('input', () => { refs[i] = inp.value; fit(inp); emit(); });
        inp.addEventListener('change', () => { refs[i] = inp.value; emit(); });
        seg.appendChild(inp);
        attachDropdown(seg, inp, (value) => { refs[i] = value; emit(); });

        // Il pulsante di rimozione c'è solo se ci sono più segmenti: l'ultimo
        // rimasto non si può rimuovere (resterebbe l'azione senza modello).
        if (refs.length > 1) {
          const rm = document.createElement('button');
          rm.type = 'button';
          rm.className = 'sn-chain-rm';
          rm.textContent = '×';
          rm.title = t('options_chain_remove');
          rm.addEventListener('click', () => {
            refs.splice(i, 1);
            if (!refs.length) refs = [''];
            render(Math.max(0, i - 1));
            emit();
          });
          seg.appendChild(rm);
        }
        el.appendChild(seg);
      });

      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'sn-chain-add';
      add.textContent = '+';
      add.title = t('options_chain_add');
      add.addEventListener('click', () => {
        refs.push('');
        render(refs.length - 1);
        emit();
      });
      el.appendChild(add);

      if (focusIdx != null) {
        const inputs = el.querySelectorAll('.sn-chain-input');
        if (inputs[focusIdx]) inputs[focusIdx].focus();
      }
    }

    render();
    return { el, getValue };
  }

  // Popola un host (.sn-grid-2) con una cella per azione: etichetta + editor a
  // segmenti. Ritorna una mappa { action: chain } per leggere i valori dopo.
  function renderGrid(host, opts) {
    const o = opts || {};
    const models = o.models || {};
    host.innerHTML = '';
    const chains = {};
    for (const [action, key] of actionLabels()) {
      const cell = document.createElement('div');
      const label = document.createElement('label');
      label.textContent = t(key);
      const chain = buildChain(models[action] || '', o.onChange);
      cell.appendChild(label);
      cell.appendChild(chain.el);
      host.appendChild(cell);
      chains[action] = chain;
    }
    return chains;
  }

  function collect(chains) {
    const out = {};
    for (const action of Object.keys(chains || {})) out[action] = chains[action].getValue();
    return out;
  }

  global.SN_MODEL_CHAIN = { buildChain, renderGrid, collect, actionLabels };
})(typeof globalThis !== 'undefined' ? globalThis : self);
