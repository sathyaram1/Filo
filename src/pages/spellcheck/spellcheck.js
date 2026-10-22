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

  async function rileggi() {
    const data = await chrome.storage.local.get([STORAGE_KEYS.AUTOCORRECT, STORAGE_KEYS.PERSONAL_DICT, STORAGE_KEYS.CORRETTORE_IMPARATO]);
    renderAutocorrect(data[STORAGE_KEYS.AUTOCORRECT] || {});
    renderDict(data[STORAGE_KEYS.PERSONAL_DICT] || []);
    renderRifiutate(data[STORAGE_KEYS.CORRETTORE_IMPARATO]);
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
  const Auto = () => window.SN_CORRETTORE_AUTO;
  async function leggiImparato() {
    const d = await chrome.storage.local.get(STORAGE_KEYS.CORRETTORE_IMPARATO);
    return Auto().memoria(d[STORAGE_KEYS.CORRETTORE_IMPARATO]);
  }
  async function scriviImparato(m) {
    await chrome.storage.local.set({ [STORAGE_KEYS.CORRETTORE_IMPARATO]: m });
  }
  async function dimenticaParole(...parole) {
    let m = await leggiImparato();
    for (const p of parole) if (p) m = Auto().dimentica(m, p);
    await scriviImparato(m);
  }

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

  // Una correzione si aggiunge anche dal tasto destro su una parola: se l'elenco
  // cambia da fuori ci si riallinea, ma non mentre il cursore è in una riga,
  // dove ridisegnare butterebbe via quello che si sta scrivendo.
  chrome.storage.onChanged.addListener((changes) => {
    const c = changes && changes[STORAGE_KEYS.AUTOCORRECT];
    if (!c) return;
    const a = document.activeElement;
    if (a && a.closest && a.closest('.sn-spell-row')) return;
    renderAutocorrect(c.newValue || {});
  });

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

  async function removeDictWord(word) {
    const key = String(word || '').toLowerCase();
    const data = await chrome.storage.local.get(STORAGE_KEYS.PERSONAL_DICT);
    const arr = (data[STORAGE_KEYS.PERSONAL_DICT] || []).filter(
      (w) => String(w).toLowerCase() !== key
    );
    await chrome.storage.local.set({ [STORAGE_KEYS.PERSONAL_DICT]: arr });
    renderDict(arr);
    await dimenticaParole(word);
  }

  // La forma nuova prende il posto della vecchia; se la parola c'è già in un'altra riga il cambio non vale.
  async function renameDictWord(vecchia, nuova) {
    const data = await chrome.storage.local.get(STORAGE_KEYS.PERSONAL_DICT);
    const arr = (data[STORAGE_KEYS.PERSONAL_DICT] || []).map(String);
    const da = vecchia.toLowerCase();
    const a = nuova.toLowerCase();
    if (da !== a && arr.some((w) => w.toLowerCase() === a)) {
      showDictConflictMessage(nuova);
      return false;
    }
    const out = arr.filter((w) => w.toLowerCase() !== da);
    out.push(nuova);
    await chrome.storage.local.set({ [STORAGE_KEYS.PERSONAL_DICT]: out });
    await dimenticaParole(vecchia, nuova);
    return true;
  }

  // ----------------------------------------------------------------------
  // Parole da non correggere da sé: quelle di cui l'utente ha annullato la correzione automatica (#1447)
  // ----------------------------------------------------------------------
  function renderRifiutate(memoria) {
    const list = $('rifiutateList');
    list.innerHTML = '';
    const parole = Auto() ? [...Auto().memoria(memoria).rifiutate].sort((a, b) => a.localeCompare(b)) : [];
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
    const m = await leggiImparato();
    const k = Auto().chiave(word);
    m.rifiutate = m.rifiutate.filter((w) => w !== k);
    await scriviImparato(Auto().dimentica(m, word));
    renderRifiutate(m);
  }

  async function renameRifiutata(vecchia, nuova) {
    const m = await leggiImparato();
    const da = Auto().chiave(vecchia);
    const a = Auto().chiave(nuova);
    if (da !== a && m.rifiutate.includes(a)) {
      showInlineMessage('rifiutateConflict', 'rifiutateList', I18n.t('spell_page_dict_conflict', nuova));
      return false;
    }
    m.rifiutate = [...m.rifiutate.filter((w) => w !== da), a];
    await scriviImparato(m);
    return true;
  }

  async function addRifiutataFromInput() {
    const raw = $('newRifiutata').value.trim();
    if (!raw) return;
    if (/\s/.test(raw)) { showInlineMessage('rifiutateConflict', 'rifiutateList', I18n.t('spell_page_una_parola')); return; }
    const m = await leggiImparato();
    const k = Auto().chiave(raw);
    if (m.rifiutate.includes(k)) {
      showInlineMessage('rifiutateConflict', 'rifiutateList', I18n.t('spell_page_dict_conflict', raw));
      $('newRifiutata').select();
      return;
    }
    m.rifiutate = [...m.rifiutate, k];
    await scriviImparato(m);
    renderRifiutate(m);
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
    const data = await chrome.storage.local.get(STORAGE_KEYS.PERSONAL_DICT);
    const existing = data[STORAGE_KEYS.PERSONAL_DICT] || [];
    const present = new Set(existing.map((x) => String(x).toLowerCase()));
    const added = [];
    for (const w of words) {
      const key = w.toLowerCase();
      if (present.has(key)) continue;
      present.add(key);
      existing.push(w); // preserva il casing originale
      added.push(w);
    }
    if (!added.length) {
      // Tutte già presenti: avvisa invece di ingoiare l'input. Il campo non si svuota, così si
      // vede cosa si era digitato.
      showDictConflictMessage(raw);
      $('newDictWord').select();
      return;
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.PERSONAL_DICT]: existing });
    renderDict(existing);
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

    // Aggiornamento live se cambia da un altro tab, o se Filo impara una parola mentre la pagina è aperta.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[STORAGE_KEYS.PERSONAL_DICT] && !siScriveIn('dictList')) {
        renderDict(changes[STORAGE_KEYS.PERSONAL_DICT].newValue || []);
      }
      if (changes[STORAGE_KEYS.CORRETTORE_IMPARATO] && !siScriveIn('rifiutateList')) {
        renderRifiutate(changes[STORAGE_KEYS.CORRETTORE_IMPARATO].newValue);
      }
    });
  });
})();
