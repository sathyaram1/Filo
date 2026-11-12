// Pagina "Gestisci correttore": le correzioni automatiche dell'utente, le parole imparate (il dizionario personale) e
// quelle da non correggere più da sé (#1447). Scrive in chrome.storage.local; i content script seguono da onChanged.

(function () {
  'use strict';

  const { STORAGE_KEYS } = window.SN_CONST;
  const I18n = window.SN_I18N;
  const Storage = window.SN_STORAGE;

  function $(id) { return document.getElementById(id); }

  async function loadAll() {
    const settings = await Storage.getSettings();
    window.SN_PAGE_THEME = settings.theme;
    window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);

    fillStaticText();

    await rileggi();
  }

  // Una lista dove si sta scrivendo non si ridisegna.
  async function rileggi() {
    const data = await chrome.storage.local.get([STORAGE_KEYS.AUTOCORRECT, STORAGE_KEYS.PERSONAL_DICT, STORAGE_KEYS.CORRETTORE_IMPARATO]);
    if (!siScriveIn('autocorrectList')) renderAutocorrect(data[STORAGE_KEYS.AUTOCORRECT] || {});
    if (!siScriveIn('dictList')) renderDict(data[STORAGE_KEYS.PERSONAL_DICT] || []);
    if (!siScriveIn('rifiutateList')) renderRifiutate(data[STORAGE_KEYS.CORRETTORE_IMPARATO]);
  }

  function fillStaticText() {
    document.title = I18n.t('spell_page_title');
    $('title').textContent = I18n.t('spell_page_heading');
    $('back').textContent = I18n.t('spell_page_back');

    $('h-autocorrect').textContent = I18n.t('spell_page_autocorrect_h');
    $('desc-autocorrect').textContent = I18n.t('spell_page_autocorrect_desc');
    $('autocorrectEmpty').textContent = I18n.t('spell_page_autocorrect_empty');
    $('newWord').placeholder = I18n.t('spell_page_placeholder_word');
    $('newCorrection').placeholder = I18n.t('spell_page_placeholder_correction');
    $('addAutocorrect').textContent = I18n.t('spell_page_add');

    $('h-dict').textContent = I18n.t('spell_page_dict_h');
    $('desc-dict').textContent = I18n.t('spell_page_dict_desc');
    $('dictEmpty').textContent = I18n.t('spell_page_dict_empty');
    $('newDictWord').placeholder = I18n.t('spell_page_placeholder_dict_word');
    $('addDict').textContent = I18n.t('spell_page_add');

    $('h-rifiutate').textContent = I18n.t('spell_page_rifiutate_h');
    $('desc-rifiutate').textContent = I18n.t('spell_page_rifiutate_desc');
    $('rifiutateEmpty').textContent = I18n.t('spell_page_rifiutate_empty');
    $('newRifiutata').placeholder = I18n.t('spell_page_placeholder_dict_word');
    $('addRifiutata').textContent = I18n.t('spell_page_add');
  }

  const inlineTimers = Object.create(null);
  function showInlineMessage(id, anchorId, text) {
    let el = $(id);
    if (!el) {
      el = document.createElement('p');
      el.id = id;
      el.className = 'sn-muted';
      el.style.cssText = 'color:var(--sn-danger,#c0392b);margin:4px 0 0';
      const anchor = $(anchorId);
      anchor.parentElement.insertBefore(el, anchor);
    }
    el.textContent = text;
    el.hidden = false;
    clearTimeout(inlineTimers[id]);
    inlineTimers[id] = setTimeout(() => { el.hidden = true; }, 3500);
  }

  function showConflictMessage(conflictKey) {
    showInlineMessage('autocorrectConflict', 'autocorrectList', I18n.t('spell_page_conflict', conflictKey));
  }

  // Svuotare parola o correzione non è un salvataggio valido: stesso slot d'avviso del
  // conflitto, e si indirizza l'utente al bottone «Rimuovi».
  function showEmptyFieldMessage() {
    showInlineMessage('autocorrectConflict', 'autocorrectList', I18n.t('spell_page_empty'));
  }

  function showDictConflictMessage(word) {
    showInlineMessage('dictConflict', 'dictList', I18n.t('spell_page_dict_conflict', word));
  }

  // ----------------------------------------------------------------------
  // Quello che il correttore impara (#1447): tolta o cambiata una parola, Filo ricomincia da zero su di lei.
  // ----------------------------------------------------------------------
  // Si scrive dalla fila del main, la stessa delle schede che imparano (src/main/services/correttoreImpara.js).
  const passo = (q) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.CORRETTORE_IMPARA, ...q });

  // Una riga con una parola sola, che si cambia scrivendoci e si toglie con «Rimuovi». `rinomina(vecchia, nuova)` dice
  // se il cambio è valido; uno scartato rimette la parola com'era.
  function rigaParola(word, { rinomina, togli, avviso }) {
    const row = document.createElement('div');
    row.className = 'sn-spell-row sn-spell-row-dict';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'sn-spell-word';
    input.spellcheck = false;
    input.value = word;
    row.appendChild(input);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'sn-btn sn-btn-secondary';
    removeBtn.type = 'button';
    removeBtn.textContent = I18n.t('spell_page_remove');
    removeBtn.addEventListener('click', () => togli(word));
    row.appendChild(removeBtn);

    const commit = async () => {
      const nuova = input.value.trim();
      if (nuova === word) return;
      if (!nuova || /\s/.test(nuova)) {
        input.value = word;
        avviso(I18n.t(nuova ? 'spell_page_una_parola' : 'spell_page_word_empty'));
        return;
      }
      if (await rinomina(word, nuova)) word = nuova;
      else input.value = word;
    };
    input.addEventListener('input', () => campoAlVolo.scrivendo(commit));
    input.addEventListener('change', () => { campoAlVolo.confermato(); commit(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    return row;
  }

  // Una lista non si ridisegna mentre ci si scrive dentro: butterebbe via quello che si sta scrivendo.
  function siScriveIn(listId) {
    const a = document.activeElement;
    return !!(a && a.closest && a.closest(`#${listId}`));
  }

  // ----------------------------------------------------------------------
  // Autocorrect
  // ----------------------------------------------------------------------
  // Le correzioni che la pagina sta mostrando, cioè quelle su cui si scrive.
  let mappaMostrata = {};

  // Un campo si conferma quando il cursore ne esce: registrato qui, si conferma
  // anche se la scheda si chiude prima.
  const campoAlVolo = window.SN_CASELLE.alVolo();

  // Una correzione arriva anche dal tasto destro, o imparata scrivendo: la spinta del main (in fondo) ridisegna
  // l'elenco, ma non mentre il cursore è in una riga, dove butterebbe via quello che si sta scrivendo.

  function renderAutocorrect(map) {
    mappaMostrata = { ...(map || {}) };
    const list = $('autocorrectList');
    list.innerHTML = '';
    const keys = Object.keys(map || {}).sort((a, b) => a.localeCompare(b));
    if (!keys.length) {
      $('autocorrectEmpty').hidden = false;
      return;
    }
    $('autocorrectEmpty').hidden = true;

    const header = document.createElement('div');
    header.className = 'sn-spell-row sn-spell-row-head';
    header.innerHTML =
      `<span>${I18n.t('spell_page_col_word')}</span>` +
      `<span class="sn-spell-arrow">→</span>` +
      `<span>${I18n.t('spell_page_col_correction')}</span>` +
      `<span></span>`;
    list.appendChild(header);

    for (const k of keys) {
      list.appendChild(autocorrectRow(k, map[k]));
    }
  }

  function autocorrectRow(word, correction) {
    const row = document.createElement('div');
    row.className = 'sn-spell-row';

    const wIn = document.createElement('input');
    wIn.type = 'text';
    wIn.value = word;
    wIn.dataset.original = word;
    row.appendChild(wIn);

    const arrow = document.createElement('span');
    arrow.className = 'sn-spell-arrow';
    arrow.textContent = '→';
    row.appendChild(arrow);

    const cIn = document.createElement('input');
    cIn.type = 'text';
    cIn.value = correction;
    row.appendChild(cIn);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'sn-btn sn-btn-secondary';
    removeBtn.type = 'button';
    removeBtn.textContent = I18n.t('spell_page_remove');
    removeBtn.addEventListener('click', () => removeAutocorrect(word));
    row.appendChild(removeBtn);

    const commit = async () => {
      const oldKey = (wIn.dataset.original || '').toLowerCase();
      const newKey = wIn.value.trim().toLowerCase();
      const newVal = cIn.value.trim();
      if (!newKey || !newVal) {
        // Campo svuotato: non è un salvataggio né una rimozione implicita. Si ripristina il valore
        // reale e si spiega come rimuovere, o la regola resterebbe attiva col campo vuoto.
        wIn.value = wIn.dataset.original || oldKey;
        cIn.value = correction;
        showEmptyFieldMessage();
        return;
      }
      if (oldKey === newKey && correction === newVal) return;
      const ok = await updateAutocorrect(oldKey, newKey, newVal, {
        onConflict: (conflictKey) => {
          wIn.value = wIn.dataset.original || oldKey;
          showConflictMessage(conflictKey);
        },
      });
      if (ok) {
        wIn.dataset.original = newKey;
      }
    };
    for (const el of [wIn, cIn]) {
      el.addEventListener('input', () => campoAlVolo.scrivendo(commit));
      el.addEventListener('change', () => { campoAlVolo.confermato(); commit(); });
    }

    return row;
  }

  // Si parte da quello che la pagina ha in mano, non da una rilettura: chiudendo
  // la scheda c'è tempo per UN messaggio solo, e un giro in più lo mangia.
  async function updateAutocorrect(oldKey, newKey, newVal, opts = {}) {
    const map = { ...mappaMostrata };
    // Controllo conflitto: se stiamo rinominando (oldKey diverso da newKey) e
    // newKey esiste già in un'altra riga, blocca la modifica e avvisa l'utente.
    if (newKey && oldKey !== newKey && Object.prototype.hasOwnProperty.call(map, newKey)) {
      if (opts.onConflict) opts.onConflict(newKey);
      return false;
    }
    if (oldKey && oldKey !== newKey) delete map[oldKey];
    map[newKey] = newVal;
    await chrome.storage.local.set({ [STORAGE_KEYS.AUTOCORRECT]: map });
    renderAutocorrect(map);
    return true;
  }

  async function removeAutocorrect(word) {
    const key = String(word || '').toLowerCase();
    const map = { ...mappaMostrata };
    delete map[key];
    await chrome.storage.local.set({ [STORAGE_KEYS.AUTOCORRECT]: map });
    renderAutocorrect(map);
  }

  async function addAutocorrectFromInputs() {
    const w = $('newWord').value.trim().toLowerCase();
    const c = $('newCorrection').value.trim();
    if (!w || !c) return;
    const ok = await updateAutocorrect('', w, c, {
      onConflict: (conflictKey) => showConflictMessage(conflictKey),
    });
    if (ok) {
      $('newWord').value = '';
      $('newCorrection').value = '';
      $('newWord').focus();
    }
  }

  function renderDict(words) {
    const list = $('dictList');
    list.innerHTML = '';
    // Dedup case-insensitive tenendo la prima occorrenza: preserva il casing originale.
    const seen = new Set();
    const deduped = [];
    for (const w of (words || [])) {
      const s = String(w);
      const key = s.toLowerCase();
      if (!seen.has(key)) { seen.add(key); deduped.push(s); }
    }
    const sorted = deduped.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    if (!sorted.length) {
      $('dictEmpty').hidden = false;
      return;
    }
    $('dictEmpty').hidden = true;

    for (const w of sorted) {
      list.appendChild(rigaParola(w, {
        rinomina: renameDictWord,
        togli: removeDictWord,
        avviso: (t) => showInlineMessage('dictConflict', 'dictList', t),
      }));
    }
  }

  // Tolta o cambiata una parola, Filo ricomincia da zero su di lei (lo fa la fila del main).
  async function removeDictWord(word) {
    const r = await passo({ passo: 'togliParola', parola: word });
    if (r && r.ok) renderDict(r.parole);
  }

  // La forma nuova prende il posto della vecchia; se la parola c'è già in un'altra riga il cambio non vale.
  async function renameDictWord(vecchia, nuova) {
    const r = await passo({ passo: 'rinominaParola', parola: vecchia, nuova });
    if (!r || !r.ok) return false;
    if (r.gia) {
      showDictConflictMessage(nuova);
      return false;
    }
    return true;
  }

  // ----------------------------------------------------------------------
  // Parole da non correggere da sé: quelle di cui l'utente ha annullato la correzione automatica (#1447)
  // ----------------------------------------------------------------------
  function renderRifiutate(memoria) {
    const list = $('rifiutateList');
    list.innerHTML = '';
    const parole = (Array.isArray(memoria && memoria.rifiutate) ? memoria.rifiutate.map(String) : []).sort((a, b) => a.localeCompare(b));
    $('rifiutateEmpty').hidden = parole.length > 0;
    for (const w of parole) {
      list.appendChild(rigaParola(w, {
        rinomina: renameRifiutata,
        togli: removeRifiutata,
        avviso: (t) => showInlineMessage('rifiutateConflict', 'rifiutateList', t),
      }));
    }
  }

  async function removeRifiutata(word) {
    const r = await passo({ passo: 'togliRifiutata', parola: word });
    if (r && r.ok) renderRifiutate({ rifiutate: r.rifiutate });
  }

  async function renameRifiutata(vecchia, nuova) {
    const r = await passo({ passo: 'rinominaRifiutata', parola: vecchia, nuova });
    if (!r || !r.ok) return false;
    if (r.gia) {
      showInlineMessage('rifiutateConflict', 'rifiutateList', I18n.t('spell_page_dict_conflict', nuova));
      return false;
    }
    return true;
  }

  async function addRifiutataFromInput() {
    const raw = $('newRifiutata').value.trim();
    if (!raw) return;
    if (/\s/.test(raw)) { showInlineMessage('rifiutateConflict', 'rifiutateList', I18n.t('spell_page_una_parola')); return; }
    const r = await passo({ passo: 'rifiuta', parola: raw });
    if (!r || !r.ok) return;
    if (r.gia) {
      showInlineMessage('rifiutateConflict', 'rifiutateList', I18n.t('spell_page_dict_conflict', raw));
      $('newRifiutata').select();
      return;
    }
    renderRifiutate({ rifiutate: r.rifiutate });
    $('newRifiutata').value = '';
    $('newRifiutata').focus();
  }

  async function addDictFromInput() {
    const raw = $('newDictWord').value.trim();
    if (!raw) return;
    // Il dizionario si confronta parola per parola: una voce con spazi non incontrerebbe mai
    // un token e resterebbe inerte, quindi si spezza in voci separate.
    const words = raw.split(/\s+/).filter(Boolean);
    if (!words.length) return;
    // Una alla volta dalla fila del main, che non aggiunge le già presenti (anche con le maiuscole diverse).
    const added = [];
    let parole = null;
    for (const w of words) {
      const r = await passo({ passo: 'aggiungiParola', parola: w });
      if (!r || !r.ok) continue;
      parole = r.parole;
      if (!r.gia) added.push(w);
    }
    if (!added.length) {
      // Tutte già presenti: avvisa invece di ingoiare l'input. Il campo non si svuota, così si
      // vede cosa si era digitato.
      showDictConflictMessage(raw);
      $('newDictWord').select();
      return;
    }
    renderDict(parole);
    $('newDictWord').value = '';
    $('newDictWord').focus();
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadAll();
    $('addAutocorrect').addEventListener('click', addAutocorrectFromInputs);
    $('addDict').addEventListener('click', addDictFromInput);
    $('newCorrection').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addAutocorrectFromInputs();
    });
    $('newWord').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('newCorrection').focus();
    });
    $('newDictWord').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addDictFromInput();
    });
    $('addRifiutata').addEventListener('click', addRifiutataFromInput);
    $('newRifiutata').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addRifiutataFromInput();
    });
    $('back').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    // Un backup importato in un'altra scheda porta parole sue: compaiono senza riaprire la pagina (#1256).
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== window.SN_MSG.MSG.DATI_IMPORTATI) return;
      rileggi().catch(() => {});
    });

    // Quello che Filo impara scrivendo in un'altra scheda arriva spinto dal main (#1447), e si rilegge tornando qui.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) rileggi().catch(() => {}); });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === window.SN_MSG.MSG.CORRETTORE_MEMORIE) rileggi().catch(() => {});
    });
  });
})();
