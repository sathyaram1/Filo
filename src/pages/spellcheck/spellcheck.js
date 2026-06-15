// Pagina "Gestisci correttore": gestione autocorrect e dizionario personale.
// Lettura/scrittura diretta su chrome.storage.local; il content script reagisce
// in tempo reale via chrome.storage.onChanged.

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

    const data = await chrome.storage.local.get([STORAGE_KEYS.AUTOCORRECT, STORAGE_KEYS.PERSONAL_DICT]);
    renderAutocorrect(data[STORAGE_KEYS.AUTOCORRECT] || {});
    renderDict(data[STORAGE_KEYS.PERSONAL_DICT] || []);
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
  }

  // ----------------------------------------------------------------------
  // Autocorrect
  // ----------------------------------------------------------------------
  function renderAutocorrect(map) {
    const list = $('autocorrectList');
    list.innerHTML = '';
    const keys = Object.keys(map || {}).sort((a, b) => a.localeCompare(b));
    if (!keys.length) {
      $('autocorrectEmpty').hidden = false;
      return;
    }
    $('autocorrectEmpty').hidden = true;

    // Header
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
      if (!newKey || !newVal) return;
      if (oldKey === newKey && correction === newVal) return;
      await updateAutocorrect(oldKey, newKey, newVal);
    };
    wIn.addEventListener('change', commit);
    cIn.addEventListener('change', commit);

    return row;
  }

  async function updateAutocorrect(oldKey, newKey, newVal, opts = {}) {
    const data = await chrome.storage.local.get(STORAGE_KEYS.AUTOCORRECT);
    const map = { ...(data[STORAGE_KEYS.AUTOCORRECT] || {}) };
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
    const data = await chrome.storage.local.get(STORAGE_KEYS.AUTOCORRECT);
    const map = { ...(data[STORAGE_KEYS.AUTOCORRECT] || {}) };
    delete map[key];
    await chrome.storage.local.set({ [STORAGE_KEYS.AUTOCORRECT]: map });
    renderAutocorrect(map);
  }

  async function addAutocorrectFromInputs() {
    const w = $('newWord').value.trim().toLowerCase();
    const c = $('newCorrection').value.trim();
    if (!w || !c) return;
    await updateAutocorrect('', w, c);
    $('newWord').value = '';
    $('newCorrection').value = '';
    $('newWord').focus();
  }

  // ----------------------------------------------------------------------
  // Dizionario personale
  // ----------------------------------------------------------------------
  function renderDict(words) {
    const list = $('dictList');
    list.innerHTML = '';
    // Dedup case-insensitive: tenere la prima occorrenza trovata (preserva il casing originale).
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
      list.appendChild(dictRow(w));
    }
  }

  function dictRow(word) {
    const row = document.createElement('div');
    row.className = 'sn-spell-row sn-spell-row-dict';

    const span = document.createElement('span');
    span.className = 'sn-spell-word';
    span.textContent = word;
    row.appendChild(span);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'sn-btn sn-btn-secondary';
    removeBtn.type = 'button';
    removeBtn.textContent = I18n.t('spell_page_remove');
    removeBtn.addEventListener('click', () => removeDictWord(word));
    row.appendChild(removeBtn);

    return row;
  }

  async function removeDictWord(word) {
    const key = String(word || '').toLowerCase();
    const data = await chrome.storage.local.get(STORAGE_KEYS.PERSONAL_DICT);
    const arr = (data[STORAGE_KEYS.PERSONAL_DICT] || []).filter(
      (w) => String(w).toLowerCase() !== key
    );
    await chrome.storage.local.set({ [STORAGE_KEYS.PERSONAL_DICT]: arr });
    renderDict(arr);
  }

  async function addDictFromInput() {
    const w = $('newDictWord').value.trim();
    if (!w) return;
    const data = await chrome.storage.local.get(STORAGE_KEYS.PERSONAL_DICT);
    const existing = data[STORAGE_KEYS.PERSONAL_DICT] || [];
    // Dedup case-insensitive: se esiste già una parola con lo stesso casing diverso, non aggiungerla.
    const alreadyExists = existing.some((x) => String(x).toLowerCase() === w.toLowerCase());
    if (!alreadyExists) {
      existing.push(w); // preserva il casing originale
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.PERSONAL_DICT]: existing });
    renderDict(existing);
    $('newDictWord').value = '';
    $('newDictWord').focus();
  }

  // ----------------------------------------------------------------------
  // Boot
  // ----------------------------------------------------------------------
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
    $('back').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    // Aggiornamento live se cambia da un altro tab.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[STORAGE_KEYS.AUTOCORRECT]) {
        renderAutocorrect(changes[STORAGE_KEYS.AUTOCORRECT].newValue || {});
      }
      if (changes[STORAGE_KEYS.PERSONAL_DICT]) {
        renderDict(changes[STORAGE_KEYS.PERSONAL_DICT].newValue || []);
      }
    });
  });
})();
