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

  // Etichetta (chiave i18n) per ogni funzione mostrata nell'editor.
  //
  // L'ELENCO delle funzioni NON si decide qui: viene dal censimento
  // (`modelUsage.js`), che è la sorgente di verità di "dove Filo usa un
  // modello". Prima le due liste erano scritte a mano una accanto all'altra e
  // potevano divergere: una funzione dimenticata qui restava senza un posto
  // dove impostarla, cioè esattamente il problema che il censimento risolve.
  // Qui restano solo le etichette; l'ordine e la completezza li dà il
  // censimento, e una funzione senza etichetta ricade sul nome del censimento
  // invece di sparire.
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
      // Funzioni che prima non comparivano qui: giravano su un modello scelto
      // dal codice e nessuno poteva vederlo né cambiarlo. Ora una funzione senza
      // modello si ferma e lo dice, quindi DEVE esistere il posto dove
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

  // Le funzioni esposte nell'editor, nell'ordine del censimento, ciascuna con la
  // chiave i18n della sua etichetta. Se il censimento non fosse caricato (test
  // isolati, pagine che non lo includono) si ricade sulle etichette scritte qui,
  // così l'editor funziona comunque.
  function actionLabels() {
    const keys = new Map(labelKeys());
    const Usage = global.SN_MODEL_USAGE;
    const actions = Usage && typeof Usage.userActions === 'function'
      ? Usage.userActions().filter(Boolean)
      : [...keys.keys()];
    const labelOf = (action) => {
      if (keys.has(action)) return keys.get(action);
      // Nessuna chiave i18n: usiamo il nome del censimento come testo. `t()` su
      // una stringa non tradotta la restituisce identica, quindi la cella mostra
      // il nome giusto invece del codice interno.
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

  // Validatore per una funzione: dato un nickname del registry, verifica che il
  // suo modello soddisfi i requisiti dell'azione (es. un'azione di testo non può
  // ricevere un modello di sola sintesi vocale). Nickname sconosciuti (non nel
  // registry) NON vengono bloccati: potrebbero essere id grezzi legacy.
  function makeValidator(action, getRegistry) {
    return function (ref) {
      const Caps = global.SN_MODEL_CAPS;
      if (!Caps) return { ok: true };
      const nick = String(ref == null ? '' : ref).trim();
      if (!nick) return { ok: true };
      // Solo il registry CONFIGURATO: quello scritto nel codice non deve
      // decidere niente qui, o l'editor validerebbe contro modelli che a runtime
      // non esistono.
      const reg = (getRegistry && getRegistry()) || {};
      const entry = reg[nick];
      if (!entry || !entry.provider || !entry.model) return { ok: true };
      // Le modalità dichiarate dalla voce (o note per il nickname) valgono
      // più del nome: così un modello di testo dal nome muto resta fuori
      // dalla lettura ad alta voce, e uno che ascolta va sulla dettatura.
      const C = global.SN_CONST;
      const meta = (C && C.entryModalities) ? C.entryModalities(entry, nick) : null;
      return Caps.modelMatchesAction(entry.provider, entry.model, action, meta || undefined);
    };
  }

  // Il nickname citato esiste davvero fra i modelli configurati? Gli id grezzi
  // stile provider (con '/' o ':') restano ammessi per retro-compatibilità.
  function makeKnownCheck(getRegistry) {
    return function (ref) {
      const nick = String(ref == null ? '' : ref).trim();
      if (!nick) return true;
      const C = global.SN_CONST;
      if (C && C.isRawModelId && C.isRawModelId(nick)) return true;
      const reg = (getRegistry && getRegistry()) || {};
      // Registry non ancora disponibile: non sappiamo nulla, quindi non
      // accusiamo nessun nickname di non esistere.
      if (!Object.keys(reg).length) return true;
      return Boolean(reg[nick]);
    };
  }

  // Mostra/azzera il messaggio di blocco sotto un segmento (modello non adatto).
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
  // a un input di segmento, al posto del popup nativo della <datalist>. La
  // logica vive in SN_COMBOBOX (condivisa col campo "stringa modello" del
  // registry); qui passiamo solo la sorgente delle opzioni (i nickname), il
  // validatore di compatibilità e le classi/posizionamento del segmento.
  // Ritorna una funzione per chiudere il popup.
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

  // Costruisce l'editor a segmenti per UNA azione.
  // Ritorna { el, getValue } dove getValue() torna la stringa "a, b, c".
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
        // Niente più `list="nicknames-list"`: il popup nativo della datalist usa
        // i colori di sistema, fuori palette. Lo sostituiamo con un dropdown
        // custom .sn-select-* coerente con gli altri menu a tendina di Filo.
        inp.setAttribute('autocomplete', 'off');
        inp.value = ref;
        inp.placeholder = i === 0 ? t('options_chain_primary') : t('options_chain_fallback');
        fit(inp);
        // Gate di compatibilità modello↔funzione. Durante la digitazione si è
        // liberi (i valori parziali non sono nickname del registry, quindi non
        // vengono bloccati). Alla conferma (blur/scelta) un modello NON adatto
        // viene rifiutato: si ripristina l'ultimo valore valido e si mostra il
        // motivo. Così non è possibile SALVARE un abbinamento incompatibile.
        let lastGood = ref;
        // Scorciatoia citata ma inesistente (mai definita, rinominata o
        // eliminata): la funzione non partirebbe, quindi lo segnaliamo QUI,
        // mentre si configura, invece di lasciarlo scoprire a chi la usa.
        // Il segnale è il CAMPO che diventa rosso, con la spiegazione
        // nell'hover: aggiungere testo sposterebbe i pulsanti «×» e «+» proprio
        // mentre ci stai cliccando sopra. È solo un avviso: il valore resta
        // scritto e modificabile.
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

  // Popola un host (.sn-grid-2) con una cella per azione: etichetta + editor a
  // segmenti. Ritorna una mappa { action: chain } per leggere i valori dopo.
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
