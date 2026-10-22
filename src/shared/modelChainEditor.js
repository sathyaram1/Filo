// Editor «a segmenti» per la catena di modelli di un'azione: il primo è il principale, gli
// altri i fallback provati in ordine se quello prima fallisce. La catena resta una stringa
// di nickname separati da virgola, così storage e risoluzione lato main non cambiano.

(function (global) {
  'use strict';

  function t(key, ...args) {
    return global.SN_I18N ? global.SN_I18N.t(key, ...args) : key;
  }

  // Qui SOLO le etichette: l'ELENCO delle funzioni viene dal censimento (modelUsage.js), che
  // è la sorgente di verità. Una funzione senza etichetta ricade sul nome del censimento.
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
      [A.SPELLCHECK_CONTEXT, 'spell_action_coerenza_label'],
      [A.HELP_INTENT_GUESS, 'options_action_help_intent_guess'],
      [A.HELP_INTENT_JUDGE, 'options_action_help_intent_judge'],
      [A.FILO_TAB_TRIAGE, 'options_action_tab_triage'],
      [A.FILO_TAB_SUMMARY, 'options_action_tab_summary'],
      [A.FILO_TAB_SEARCH, 'options_action_tab_search'],
      [A.FILO_DASHBOARD, 'options_action_filo_dashboard'],
      [A.FILO_CHAT, 'options_action_filo_chat'],
      [A.FILO_CHAT_TRIAGE, 'options_action_filo_chat_triage'],
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
      [A.ARCHIVE_EMBED, 'options_action_archive_embed'],
      [A.PROVIDER_TEST, 'options_action_provider_test'],
      [A.FILE_NAME, 'options_action_file_name'],
      [A.EMBED_COOKIE_CHECK, 'options_action_embed_cookie_check'],
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

  // Il nome di una funzione com'è scritto nella griglia: chi la nomina altrove (avvisi delle Opzioni e di Modelli
  // predefiniti) lo chiede qui, così le pagine non la chiamano in due modi.
  function etichetta(action) {
    const row = actionLabels().find(([a]) => a === action);
    return row ? t(row[1]) : action;
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

  // Verifica che il modello soddisfi i requisiti dell'azione (un'azione di testo non può avere
  // un modello di sola sintesi vocale). I nickname sconosciuti non si bloccano: forse legacy.
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

  // Sorgente delle opzioni per il dropdown: i nickname del registry, esposti
  // nella <datalist id="nicknames-list"> della pagina (Gestione ne ha due: i
  // Modelli predefiniti passano la loro con `readOptions`). Restano l'unica
  // sorgente di verità: il dropdown custom la legge, non la duplica.
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
  function attachDropdown(seg, inp, onPick, validate, readOptions) {
    const Combo = global.SN_COMBOBOX;
    if (!Combo) return () => {};
    return Combo.attach(seg, inp, {
      readOptions: readOptions || readNicknameOptions,
      onPick,
      validate,
      popClass: 'sn-chain-pop',
      valueClass: 'sn-chain-opt-nick',
      labelClass: 'sn-chain-opt-label',
      extraClass: 'sn-chain-opt-cost',
      sizeInput: true,
    });
  }

  // Il costo accanto al modello (#819): la cifra breve nel segmento, la spiegazione nell'hover.
  function mostraCosto(tag, c) {
    tag.hidden = !c || !c.breve;
    tag.textContent = c && c.breve ? c.breve : '';
    if (c && c.testo) tag.title = c.testo; else tag.removeAttribute('title');
  }

  // Costruisce l'editor a segmenti per UNA azione.
  // Ritorna { el, avviso, getValue, conferma, ricontrolla, imposta } dove getValue() torna la stringa "a, b, c".
  function buildChain(value, onChange, ctx) {
    const validate = ctx && ctx.validate;
    const isKnown = (ctx && ctx.isKnown) || (() => true);
    const avvisoDi = ctx && typeof ctx.avvisoDi === 'function' ? ctx.avvisoDi : null;
    // `costoDi(ref)` → { breve, testo, avviso } | null: sincrona, la pagina ha già il contesto della stima.
    const costoDi = ctx && typeof ctx.costoDi === 'function' ? ctx.costoDi : null;
    const costoSicuro = (ref) => { try { return costoDi ? costoDi(String(ref || '').trim()) : null; } catch (_) { return null; } };
    const leggiOpzioni = (ctx && ctx.readOptions) || readNicknameOptions;
    const opzioniColCosto = costoDi
      ? () => leggiOpzioni().map((o) => { const c = costoSicuro(o.value); return c && c.breve ? { ...o, extra: c.breve } : o; })
      : leggiOpzioni;
    const el = document.createElement('div');
    el.className = 'sn-chain';
    let refs = splitRefs(value);
    if (!refs.length) refs = [''];

    // Avviso che non blocca (#1141): il modello resta scelto, ma con lui la funzione non partirebbe. Sta sotto la
    // pillola, non nel segmento, così non sposta «×» e «+»; vince solo la risposta all'ultima domanda.
    const avviso = document.createElement('div');
    avviso.className = 'sn-chain-warn';
    avviso.setAttribute('role', 'status');
    avviso.hidden = true;
    let giroAvviso = 0;
    // L'avviso del costo informa e non blocca (#819): sta in una riga sua, col colore di Filo e non quello d'errore.
    const costoAvviso = document.createElement('div');
    costoAvviso.className = 'sn-chain-costo';
    costoAvviso.setAttribute('role', 'status');
    costoAvviso.hidden = true;
    function aggiornaCosti() {
      if (!costoDi) return;
      for (const seg of el.querySelectorAll('.sn-chain-seg')) {
        const tag = seg.querySelector('.sn-chain-cost');
        const inp = seg.querySelector('.sn-chain-input');
        if (tag) mostraCosto(tag, costoSicuro(inp ? inp.value : confermati[Number(seg.dataset.i)]));
      }
      const scelti = [...new Set(confermati.map((r) => String(r || '').trim()).filter(Boolean))];
      const righe = [...new Set(scelti.map((r) => (costoSicuro(r) || {}).avviso).filter((x) => typeof x === 'string' && x))];
      costoAvviso.replaceChildren(...righe.map((x) => {
        const p = document.createElement('p');
        p.textContent = x;
        return p;
      }));
      costoAvviso.hidden = !righe.length;
    }
    function ricontrolla() {
      aggiornaCosti();
      if (!avvisoDi) return;
      const mio = ++giroAvviso;
      const scelti = [...new Set(confermati.map((r) => String(r || '').trim()).filter(Boolean))];
      Promise.all(scelti.map((r) => Promise.resolve().then(() => avvisoDi(r)).catch(() => ''))).then((testi) => {
        if (mio !== giroAvviso) return;
        const righe = [...new Set(testi.filter((x) => typeof x === 'string' && x))];
        avviso.replaceChildren(...righe.map((x) => {
          const p = document.createElement('p');
          p.textContent = x;
          return p;
        }));
        avviso.hidden = !righe.length;
      });
    }

    // Ultimo valore accettato per segmento: chi salva prima della conferma (pausa, cambio scheda, Ctrl+W) legge il
    // segmento a metà passato dallo stesso controllo del clic, così le due uscite salvano la stessa cosa (#590.5).
    let confermati = refs.slice();
    const conferme = [];

    // `scrivendo`: il segmento è a metà, non ancora confermato né validato.
    function emit(scrivendo) { if (typeof onChange === 'function') onChange(!!scrivendo); }
    function getValue() {
      return refs.map((s, i) => {
        const v = s.trim();
        if (!v || !validate || validate(v).ok) return v;
        return String(confermati[i] || '').trim();
      }).filter(Boolean).join(', ');
    }
    // All'uscita vera un segmento rimasto a metà si conferma come al clic: accettato, o respinto col suo avviso.
    function conferma() { for (const fn of conferme) fn(); }

    function render(focusIdx) {
      el.innerHTML = '';
      confermati = refs.slice();
      conferme.length = 0;
      refs.forEach((ref, i) => {
        if (i > 0) {
          const sep = document.createElement('span');
          sep.className = 'sn-chain-sep';
          el.appendChild(sep);
        }
        const seg = document.createElement('span');
        seg.className = 'sn-chain-seg';
        seg.dataset.i = String(i);

        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'sn-chain-input';
        // Niente `list="nicknames-list"`: il popup nativo della datalist usa i colori di sistema,
        // fuori palette.
        inp.setAttribute('autocomplete', 'off');
        inp.value = ref;
        inp.placeholder = i === 0 ? t('options_chain_primary') : t('options_chain_fallback');
        fit(inp);
        // Gate di compatibilità modello↔funzione. Durante la digitazione si è
        // liberi (i valori parziali non sono nickname del registry, quindi non
        // vengono bloccati). Alla conferma (blur/scelta) un modello NON adatto
        // viene rifiutato: si ripristina l'ultimo valore valido e si mostra il
        // motivo. Così non è possibile SALVARE un abbinamento incompatibile.
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
        const accept = (val) => {
          clearSegMsg(seg); confermati[i] = val; refs[i] = val; emit(); markUnknown(val); ricontrolla();
        };
        const reject = (reason) => {
          showSegMsg(seg, reason);
          inp.value = confermati[i]; fit(inp);
          refs[i] = confermati[i]; emit();
          const tag = seg.querySelector('.sn-chain-cost');
          if (tag) mostraCosto(tag, costoSicuro(inp.value));
        };
        const confermaSegmento = () => {
          const val = inp.value.trim();
          const v = validate ? validate(val) : { ok: true };
          if (v.ok) accept(val); else reject(v.reason);
        };
        // Il costo segue quello che si scrive, come la larghezza del campo: cambiarlo all'uscita sposterebbe «+» e «×»
        // fra la pressione e il rilascio del clic, e il clic andrebbe perso.
        inp.addEventListener('input', () => {
          refs[i] = inp.value; fit(inp); emit(true);
          const tag = seg.querySelector('.sn-chain-cost');
          if (tag) mostraCosto(tag, costoSicuro(inp.value));
        });
        inp.addEventListener('change', confermaSegmento);
        conferme.push(() => { if (inp.value.trim() !== String(confermati[i] || '').trim()) confermaSegmento(); });
        seg.appendChild(inp);
        if (costoDi) {
          const tag = document.createElement('span');
          tag.className = 'sn-chain-cost';
          seg.appendChild(tag);
          mostraCosto(tag, costoSicuro(ref));
        }
        attachDropdown(seg, inp, (value) => {
          const v = validate ? validate(value) : { ok: true };
          if (v.ok) accept(value); else reject(v.reason);
        }, validate, opzioniColCosto);

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
            ricontrolla();
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

    // Un valore arrivato da fuori riscrive solo questa catena: le altre tengono il messaggio di un rifiuto e il fuoco.
    function imposta(value) {
      refs = splitRefs(value);
      if (!refs.length) refs = [''];
      render();
      ricontrolla();
    }

    render();
    ricontrolla();
    return { el, avviso, costoAvviso, getValue, conferma, ricontrolla, aggiornaCosti, imposta };
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
        avvisoDi: typeof o.avvisoDi === 'function' ? (ref) => o.avvisoDi(action, ref) : null,
        costoDi: typeof o.costoDi === 'function' ? (ref) => o.costoDi(action, ref) : null,
        // Una pagina con due liste di soprannomi (Gestione) dice quale è la sua.
        readOptions: typeof o.readOptions === 'function' ? o.readOptions : null,
      });
      cell.appendChild(label);
      cell.appendChild(chain.el);
      cell.appendChild(chain.avviso);
      cell.appendChild(chain.costoAvviso);
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

  function conferma(chains) {
    for (const action of Object.keys(chains || {})) chains[action].conferma();
  }

  function ricontrolla(chains) {
    for (const action of Object.keys(chains || {})) chains[action].ricontrolla();
  }

  function aggiornaCosti(chains) {
    for (const action of Object.keys(chains || {})) chains[action].aggiornaCosti();
  }

  // Avviso della griglia per voce e dettatura: lo stesso verdetto sui fornitori che le ferma a runtime (#1141).
  // `entry` è la riga del registro com'è sulla pagina, anche non salvata; `excluded`, se c'è, la lista che la
  // pagina sta modificando al posto di quella in vigore.
  function avvisoHostAudio(action, ref, entry, excluded) {
    const C = global.SN_CONST;
    const A = C && C.ACTIONS;
    if (!A || (action !== A.TTS && action !== A.TRANSCRIBE_AUDIO)) return Promise.resolve('');
    if (!entry || !entry.model || typeof chrome === 'undefined' || !chrome.runtime) return Promise.resolve('');
    const msg = {
      type: global.SN_MSG.MSG.AUDIO_HOST_CHECK, action, nickname: ref,
      provider: entry.provider || 'openrouter', model: entry.model, label: entry.label || ref,
    };
    if (Array.isArray(excluded)) msg.excluded = excluded;
    return Promise.resolve(chrome.runtime.sendMessage(msg)).then((r) => (r && r.warning) || '', () => '');
  }

  global.SN_MODEL_CHAIN = {
    buildChain, renderGrid, collect, conferma, ricontrolla, aggiornaCosti, actionLabels, etichetta, makeValidator, makeKnownCheck,
    avvisoHostAudio,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
