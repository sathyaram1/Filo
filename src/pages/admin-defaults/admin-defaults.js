// Pagina admin "Modelli predefiniti".
//
// Editor della config condivisa (provider, geminiDirect, registry, modelli per
// azione, chiavi API predefinite) che si propaga a TUTTI gli utenti via
// Firestore. Riservata agli admin: il main (handler DEFAULTS_GET/UPDATE) rifiuta
// i non-admin e le regole Firestore sono la garanzia forte. Le chiavi vere non
// arrivano mai qui: il main manda solo `apiKeysPresent` (booleani).

(function () {
  'use strict';

  const { ACTIONS } = window.SN_CONST;
  const { MSG } = window.SN_MSG;
  const I18n = window.SN_I18N;
  const Storage = window.SN_STORAGE;

  function $(id) { return document.getElementById(id); }

  // Azione → chiave i18n per l'etichetta (riusa le stringhe della pagina Opzioni).
  const ACTION_LABELS = [
    [ACTIONS.EXPLAIN, 'options_action_explain'],
    [ACTIONS.EXPLAIN_DEEP, 'options_action_explain_deep'],
    [ACTIONS.TRANSLATE_SELECTION, 'options_action_translate_sel'],
    [ACTIONS.TRANSLATE_PAGE, 'options_action_translate_page'],
    [ACTIONS.HELP, 'options_action_help'],
    [ACTIONS.CATEGORIZE, 'options_action_categorize'],
    [ACTIONS.DESCRIBE_IMAGE, 'options_action_describe_image'],
    [ACTIONS.TRANSCRIBE_IMAGE, 'options_action_transcribe_image'],
    [ACTIONS.TRANSCRIBE_AUDIO, 'options_action_transcribe_audio'],
    [ACTIONS.SPELLCHECK_SEMANTIC, 'spell_action_semantic_label'],
    [ACTIONS.SPELLCHECK_WORD, 'spell_action_word_label'],
    [ACTIONS.HELP_INTENT_GUESS, 'options_action_help_intent_guess'],
    [ACTIONS.HELP_INTENT_JUDGE, 'options_action_help_intent_judge'],
  ];

  function fillStaticText() {
    document.title = I18n.t('admin_defaults_title');
    $('title').textContent = I18n.t('admin_defaults_title');
    $('denied-msg').textContent = I18n.t('admin_defaults_denied');
    $('intro').textContent = I18n.t('admin_defaults_intro');
    $('h-provider').textContent = I18n.t('options_provider');
    $('lbl-provider').textContent = I18n.t('options_provider');
    $('geminiDirect-label').textContent = I18n.t('admin_defaults_gemini_direct');
    $('h-keys').textContent = I18n.t('admin_defaults_keys');
    $('keys-desc').textContent = I18n.t('admin_defaults_keys_desc');
    $('apiKeySafebrowse-desc').textContent = I18n.t('admin_defaults_safebrowse_key_desc');
    $('h-model-registry').textContent = I18n.t('options_h_model_registry');
    $('model-registry-desc').textContent = I18n.t('options_model_registry_desc');
    $('h-models').textContent = I18n.t('options_models');
    $('models-desc').textContent = I18n.t('options_models_desc');
    $('addModelRow').textContent = I18n.t('options_model_add');
    $('saveBtn').textContent = I18n.t('admin_defaults_save');
  }

  function keyStateText(present) {
    return present ? I18n.t('admin_defaults_key_present') : I18n.t('admin_defaults_key_absent');
  }

  // ── Registry editor (stesso schema della pagina Opzioni) ────────────────────
  // Migra una entry legacy duale { openrouter, gemini } allo schema nuovo
  // { provider, model } per la visualizzazione (Gemini preferito se presente).
  function normalizeEntry(entry) {
    const e = entry || {};
    if (e.provider) return { provider: e.provider, model: e.model || '' };
    if (e.gemini) return { provider: 'gemini', model: e.gemini };
    if (e.openrouter) return { provider: 'openrouter', model: e.openrouter };
    return { provider: 'gemini', model: '' };
  }

  function makeModelRow(nick, entry) {
    const row = document.createElement('div');
    row.className = 'sn-model-row';
    const norm = normalizeEntry(entry);

    const nickIn = document.createElement('input');
    nickIn.type = 'text';
    nickIn.placeholder = I18n.t('options_model_nickname');
    nickIn.value = nick || '';
    nickIn.className = 'sn-model-nick';

    const labelIn = document.createElement('input');
    labelIn.type = 'text';
    labelIn.placeholder = I18n.t('options_model_label');
    labelIn.value = (entry && entry.label) || '';
    labelIn.className = 'sn-model-label';

    const provSel = document.createElement('select');
    provSel.className = 'sn-model-provider';
    for (const [val, txt] of [['openrouter', 'OpenRouter'], ['gemini', 'Google Gemini']]) {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = txt;
      provSel.appendChild(opt);
    }
    provSel.value = norm.provider;

    const modelIn = document.createElement('input');
    modelIn.type = 'text';
    modelIn.placeholder = I18n.t('options_model_full_id');
    modelIn.value = norm.model;
    modelIn.className = 'sn-model-id';

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sn-btn sn-btn-secondary';
    del.textContent = I18n.t('options_model_remove');
    del.addEventListener('click', () => { row.remove(); });

    row.appendChild(nickIn);
    row.appendChild(labelIn);
    row.appendChild(provSel);
    row.appendChild(modelIn);
    row.appendChild(del);
    return row;
  }

  function renderModelRegistry(registry) {
    const host = $('modelRegistryList');
    host.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'sn-model-row sn-model-row-head';
    [I18n.t('options_model_nickname'), I18n.t('options_model_label'), I18n.t('options_model_provider'), I18n.t('options_model_full_id'), ''].forEach((label) => {
      const c = document.createElement('div'); c.textContent = label; head.appendChild(c);
    });
    host.appendChild(head);

    const entries = Object.entries(registry || {});
    if (!entries.length) {
      host.appendChild(makeModelRow('', {}));
    } else {
      for (const [nick, e] of entries) host.appendChild(makeModelRow(nick, e));
    }
    populateNicknames(registry);
  }

  function collectModelRegistry() {
    const host = $('modelRegistryList');
    const out = {};
    for (const row of host.querySelectorAll('.sn-model-row:not(.sn-model-row-head)')) {
      const nick = row.querySelector('.sn-model-nick').value.trim();
      const label = row.querySelector('.sn-model-label').value.trim();
      const provider = row.querySelector('.sn-model-provider').value;
      const model = row.querySelector('.sn-model-id').value.trim();
      if (!nick && !label && !model) continue;
      if (!nick) continue;
      if (out[nick]) continue;
      out[nick] = { label, provider, model };
    }
    return out;
  }

  function populateNicknames(registry) {
    const dl = $('nicknames-list');
    dl.innerHTML = '';
    for (const nick of Object.keys(registry || {})) {
      const opt = document.createElement('option');
      opt.value = nick;
      const entry = registry[nick] || {};
      if (entry.label) opt.label = entry.label;
      dl.appendChild(opt);
    }
  }

  // ── Modelli per azione (slot primario + fallback) ──────────────────────────
  function makeSlot(value, isPrimary) {
    const slot = document.createElement('div');
    slot.className = 'sn-model-slot';

    const order = document.createElement('span');
    order.className = 'sn-slot-order';
    order.textContent = isPrimary ? '1' : '';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'sn-slot-input';
    input.setAttribute('list', 'nicknames-list');
    input.placeholder = isPrimary ? I18n.t('options_model_primary_ph') : I18n.t('options_model_fallback_ph');
    input.value = value || '';

    slot.appendChild(order);
    slot.appendChild(input);

    if (!isPrimary) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'sn-slot-remove';
      rm.textContent = '×';
      rm.title = I18n.t('options_model_remove_fallback');
      rm.addEventListener('click', () => {
        const cell = slot.parentElement?.parentElement;
        slot.remove();
        if (cell) renumberSlots(cell);
      });
      slot.appendChild(rm);
    }
    return slot;
  }

  function renumberSlots(cell) {
    cell.querySelectorAll('.sn-model-slot').forEach((s, i) => {
      const order = s.querySelector('.sn-slot-order');
      if (order) order.textContent = String(i + 1);
    });
  }

  function renderModelsGrid(models) {
    const grid = $('modelsGrid');
    grid.innerHTML = '';
    for (const [action, labelKey] of ACTION_LABELS) {
      const cell = document.createElement('div');
      cell.dataset.action = action;

      const label = document.createElement('label');
      label.textContent = I18n.t(labelKey);
      cell.appendChild(label);

      const slots = document.createElement('div');
      slots.className = 'sn-model-slots';
      const refs = window.SN_CONST.parseModelRefs(models && models[action]);
      const list = refs.length ? refs : [''];
      list.forEach((ref, i) => slots.appendChild(makeSlot(ref, i === 0)));
      cell.appendChild(slots);

      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'sn-add-fallback';
      add.textContent = I18n.t('options_model_add_fallback');
      add.addEventListener('click', () => {
        slots.appendChild(makeSlot('', false));
        renumberSlots(cell);
        const inputs = slots.querySelectorAll('.sn-slot-input');
        inputs[inputs.length - 1]?.focus();
      });
      cell.appendChild(add);

      grid.appendChild(cell);
    }
  }

  function collectModels() {
    const out = {};
    for (const cell of $('modelsGrid').querySelectorAll('[data-action]')) {
      const refs = [...cell.querySelectorAll('.sn-slot-input')]
        .map((i) => i.value.trim())
        .filter(Boolean);
      out[cell.dataset.action] = refs.join(', ');
    }
    return out;
  }

  // ── Load / Save ─────────────────────────────────────────────────────────────
  function applyConfig(cfg) {
    $('provider').value = cfg.provider || 'openrouter';
    $('geminiDirect').checked = cfg.geminiDirect !== false;
    const present = cfg.apiKeysPresent || {};
    $('apiKey-state').textContent = `(${keyStateText(present.openrouter)})`;
    $('apiKeyGemini-state').textContent = `(${keyStateText(present.gemini)})`;
    $('apiKeyTavily-state').textContent = `(${keyStateText(present.tavily)})`;
    $('apiKeySafebrowse-state').textContent = `(${keyStateText(cfg.safeBrowsingKeyPresent)})`;
    renderModelRegistry(cfg.modelRegistry || {});
    renderModelsGrid(cfg.models || {});
  }

  async function load() {
    fillStaticText();
    try {
      const settings = await Storage.getSettings();
      window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);
    } catch (_) {}

    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: MSG.DEFAULTS_GET });
    } catch (e) {
      res = { ok: false, error: e?.message || String(e) };
    }
    if (!res || !res.ok) {
      $('sec-denied').hidden = false;
      $('editor').hidden = true;
      return;
    }
    $('sec-denied').hidden = true;
    $('editor').hidden = false;
    applyConfig(res.config || {});
  }

  async function save() {
    const status = $('saveStatus');
    const btn = $('saveBtn');
    btn.disabled = true;
    status.classList.remove('sn-error');
    status.textContent = I18n.t('admin_defaults_saving');

    // Per le chiavi: invia solo i campi non vuoti (vuoto = "non toccare").
    const apiKeys = {};
    const or = $('apiKey').value.trim();
    const gem = $('apiKeyGemini').value.trim();
    const tav = $('apiKeyTavily').value.trim();
    if (or) apiKeys.openrouter = or;
    if (gem) apiKeys.gemini = gem;
    if (tav) apiKeys.tavily = tav;

    const config = {
      provider: $('provider').value,
      geminiDirect: $('geminiDirect').checked,
      modelRegistry: collectModelRegistry(),
      models: collectModels(),
    };
    if (Object.keys(apiKeys).length) config.apiKeys = apiKeys;
    // La chiave Safe Browsing si invia solo se digitata (vuoto = "non toccare").
    const gsb = $('apiKeySafebrowse').value.trim();
    if (gsb) config.safeBrowsingKey = gsb;

    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.DEFAULTS_UPDATE, config });
      if (!res || !res.ok) throw new Error(res?.error || 'errore sconosciuto');
      // Svuota i campi chiave dopo il salvataggio (non li riteniamo in pagina) e
      // ri-applica lo stato "configurata/non" dalla config tornata dal main.
      $('apiKey').value = '';
      $('apiKeyGemini').value = '';
      $('apiKeyTavily').value = '';
      $('apiKeySafebrowse').value = '';
      applyConfig(res.config || {});
      status.textContent = I18n.t('admin_defaults_saved');
    } catch (e) {
      status.classList.add('sn-error');
      status.textContent = I18n.t('admin_defaults_save_fail', e?.message || String(e));
    } finally {
      btn.disabled = false;
      clearTimeout(save._t);
      save._t = setTimeout(() => { status.textContent = ''; status.classList.remove('sn-error'); }, 4000);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    $('addModelRow').addEventListener('click', () => {
      $('modelRegistryList').appendChild(makeModelRow('', {}));
    });
    $('saveBtn').addEventListener('click', save);
  });
})();
