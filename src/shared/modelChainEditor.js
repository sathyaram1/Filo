// Editor «a segmenti» per la catena di modelli di un'azione: il primo è il principale, gli
// altri i fallback provati in ordine se quello prima fallisce. La catena resta una stringa
// di nickname separati da virgola, così storage e risoluzione lato main non cambiano.

(function (global) {
  'use strict';

  function t(key, ...args) {
    return global.SN_I18N ? global.SN_I18N.t(key, ...args) : key;
  }

  // Qui stanno SOLO le etichette (chiavi i18n): l'ELENCO delle funzioni viene dal censimento
  // (modelUsage.js), sorgente di verità. Quando erano due liste scritte a mano potevano
  // divergere, e una funzione dimenticata qui restava senza un posto dove impostarla. Una
  // funzione senza etichetta ricade sul nome del censimento invece di sparire.
  function labelKeys() {
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
      [A.TTS, 'options_action_tts'],
      [A.SPELLCHECK_SEMANTIC, 'spell_action_semantic_label'],
      [A.SPELLCHECK_WORD, 'spell_action_word_label'],
      [A.HELP_INTENT_GUESS, 'options_action_help_intent_guess'],
      [A.HELP_INTENT_JUDGE, 'options_action_help_intent_judge'],
      [A.FILO_TAB_TRIAGE, 'options_action_tab_triage'],
      [A.FILO_TAB_SUMMARY, 'options_action_tab_summary'],
      [A.FILO_TAB_SEARCH, 'options_action_tab_search'],
      [A.FILO_DASHBOARD, 'options_action_filo_dashboard'],
      [A.FILO_CHAT, 'options_action_filo_chat'],
      [A.DECKS_CHAT, 'options_action_decks_chat'],
      [A.DECKS_OPINION, 'options_action_decks_opinion'],
      [A.DECKS_AUTOTAG, 'options_action_decks_autotag'],
      [A.DECKS_SEARCH_FILTER, 'options_action_decks_search_filter'],
      // Una funzione senza modello si ferma e lo dice, quindi DEVE esistere il posto dove
      // impostarlo: questo elenco è quel posto e va tenuto completo.
      [A.EDIT_TEXT, 'options_action_edit_text'],
      [A.EXPLAIN_LINK, 'options_action_explain_link'],
      [A.FILO_LESSON, 'options_action_filo_lesson'],
      [A.FILO_COMPACT, 'options_action_filo_compact'],
      [A.SAFEBROWSE_JUDGE, 'options_action_safebrowse_judge'],
      [A.GEOBLOCK_CLASSIFY, 'options_action_geoblock_classify'],
      [A.FEEDBACK_TITLE, 'options_action_feedback_title'],
      [A.EDITOR_TITLE, 'options_action_editor_title'],
      [A.EDITOR_SUMMARY, 'options_action_editor_summary'],
      [A.EDITOR_CHAT, 'options_action_editor_chat'],
      [A.MANAGE_SEARCH, 'options_action_manage_search'],
      [A.ARCHIVE_EMBED, 'options_action_archive_embed'],
      [A.PROVIDER_TEST, 'options_action_provider_test'],
    ];
  }

  // Se il censimento non fosse caricato (test isolati, pagine che non lo includono) si ricade
  // sulle etichette scritte qui, così l'editor funziona comunque.
  function actionLabels() {
    const keys = new Map(labelKeys());
    const Usage = global.SN_MODEL_USAGE;
    const actions = Usage && typeof Usage.userActions === 'function'
      ? Usage.userActions().filter(Boolean)
      : [...keys.keys()];
    const labelOf = (action) => {
      if (keys.has(action)) return keys.get(action);
      // Senza chiave i18n vale il nome del censimento: `t()` su una stringa non tradotta la
      // restituisce identica, quindi la cella mostra il nome giusto invece del codice interno.
      const entry = Usage && typeof Usage.list === 'function'
        ? Usage.list().find((e) => e.ref === action && e.from === 'user')
        : null;
      return (entry && entry.label) || action;
    };
    return actions.map((action) => [action, labelOf(action)]);
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

  // Verifica che il modello soddisfi i requisiti dell'azione (un'azione di testo non può
  // ricevere un modello di sola sintesi vocale). I nickname sconosciuti NON si bloccano:
  // potrebbero essere id grezzi legacy.
  function makeValidator(action, getRegistry) {
    return function (ref) {
      const Caps = global.SN_MODEL_CAPS;
      if (!Caps) return { ok: true };
      const nick = String(ref == null ? '' : ref).trim();
      if (!nick) return { ok: true };
      // Solo il registry CONFIGURATO: quello scritto nel codice validerebbe contro modelli che a
      // runtime non esistono.
      const reg = (getRegistry && getRegistry()) || {};
      const entry = reg[nick];
      if (!entry || !entry.provider || !entry.model) return { ok: true };
      // Le modalità dichiarate dalla voce valgono più del nome: un modello di testo dal nome muto
      // resta fuori dalla lettura ad alta voce, e uno che ascolta va sulla dettatura.
      const C = global.SN_CONST;
      const meta = (C && C.entryModalities) ? C.entryModalities(entry, nick) : null;
      return Caps.modelMatchesAction(entry.provider, entry.model, action, meta || undefined);
    };
  }

  // Gli id grezzi stile provider (con '/' o ':') restano ammessi per retro-compatibilità.
  function makeKnownCheck(getRegistry) {
    return function (ref) {
      const nick = String(ref == null ? '' : ref).trim();
      if (!nick) return true;
      const C = global.SN_CONST;
      if (C && C.isRawModelId && C.isRawModelId(nick)) return true;
      const reg = (getRegistry && getRegistry()) || {};
      // Registry non ancora disponibile: non sappiamo nulla, quindi non accusiamo nessun nickname
      // di non esistere.
      if (!Object.keys(reg).length) return true;
      return Boolean(reg[nick]);
    };
  }

  function showSegMsg(seg, reason) {
    let m = seg.querySelector('.sn-chain-msg');
    if (!m) {
      m = document.createElement('span');
      m.className = 'sn-chain-msg';
      m.style.cssText = 'display:block;color:var(--sn-danger,#c0392b);font-size:11px;margin-top:2px;';
      seg.appendChild(m);
    }
    m.textContent = t('caps_incompatible', reason || '');
  }
  function clearSegMsg(seg) {
    const m = seg.querySelector('.sn-chain-msg');
    if (m) m.remove();
  }

  // I nickname stanno nella <datalist> esposta da entrambe le pagine e restano l'unica
  // sorgente: il dropdown custom la legge, non la duplica.
  function readNicknameOptions() {
    const dl = document.getElementById('nicknames-list');
    if (!dl) return [];
    return Array.from(dl.options).map((o) => ({
      value: o.value,
      label: o.label && o.label !== o.value ? o.label : '',
    }));
  }

  // Dropdown custom al posto del popup nativo della datalist; la logica vive in SN_COMBOBOX,
  // condivisa col campo «stringa modello». Ritorna una funzione per chiudere il popup.
  function attachDropdown(seg, inp, onPick, validate) {
    const Combo = global.SN_COMBOBOX;
    if (!Combo) return () => {};
    return Combo.attach(seg, inp, {
      readOptions: readNicknameOptions,
      onPick,
      validate,
      popClass: 'sn-chain-pop',
      valueClass: 'sn-chain-opt-nick',
      labelClass: 'sn-chain-opt-label',
      sizeInput: true,
    });
  }

  // Ritorna { el, getValue }, dove getValue() torna la stringa «a, b, c».
  function buildChain(value, onChange, ctx) {
    const validate = ctx && ctx.validate;
    const isKnown = (ctx && ctx.isKnown) || (() => true);
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
        // Niente `list="nicknames-list"`: il popup nativo della datalist usa i colori di sistema,
        // fuori palette.
        inp.setAttribute('autocomplete', 'off');
        inp.value = ref;
        inp.placeholder = i === 0 ? t('options_chain_primary') : t('options_chain_fallback');
        fit(inp);
        // Durante la digitazione si è liberi (i valori parziali non sono nickname del registry);
        // alla conferma un modello NON adatto viene rifiutato, si ripristina l'ultimo valore valido
        // e si mostra il motivo, così un abbinamento incompatibile non si può SALVARE.
        let lastGood = ref;
        // Scorciatoia citata ma inesistente: la funzione non partirebbe, quindi si segnala QUI
        // mentre si configura. Il segnale è il CAMPO che diventa rosso, con la spiegazione
        // nell'hover: aggiungere testo sposterebbe i pulsanti «×» e «+» proprio mentre ci stai
        // cliccando sopra. È solo un avviso, il valore resta scritto e modificabile.
        const markUnknown = (val) => {
          const bad = Boolean(val) && !isKnown(val);
          inp.style.color = bad ? 'var(--sn-danger,#c0392b)' : '';
          if (bad) inp.title = t('options_chain_unknown_title');
          else inp.removeAttribute('title');
        };
        const accept = (val) => { clearSegMsg(seg); lastGood = val; refs[i] = val; emit(); markUnknown(val); };
        const reject = (reason) => {
          showSegMsg(seg, reason);
          inp.value = lastGood; fit(inp);
          refs[i] = lastGood; emit();
        };
        inp.addEventListener('input', () => { refs[i] = inp.value; fit(inp); emit(); });
        inp.addEventListener('change', () => {
          const val = inp.value.trim();
          const v = validate ? validate(val) : { ok: true };
          if (v.ok) accept(val); else reject(v.reason);
        });
        seg.appendChild(inp);
        attachDropdown(seg, inp, (value) => {
          const v = validate ? validate(value) : { ok: true };
          if (v.ok) accept(value); else reject(v.reason);
        }, validate);

        // L'ultimo segmento rimasto non si può rimuovere: resterebbe l'azione senza modello.
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
        // Stesso segnale al primo disegno, per i valori che arrivano già salvati.
        markUnknown(ref);
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

  // Ritorna una mappa { action: chain } per leggere i valori dopo.
  function renderGrid(host, opts) {
    const o = opts || {};
    const models = o.models || {};
    const getRegistry = o.getRegistry;
    host.innerHTML = '';
    const chains = {};
    for (const [action, key] of actionLabels()) {
      const cell = document.createElement('div');
      const label = document.createElement('label');
      label.textContent = t(key);
      const chain = buildChain(models[action] || '', o.onChange, {
        validate: makeValidator(action, getRegistry),
        isKnown: makeKnownCheck(getRegistry),
      });
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
