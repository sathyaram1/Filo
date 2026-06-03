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
  function makeModelRow(nick, entry) {
    const row = document.createElement('div');
    row.className = 'sn-model-row';

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

    const orIn = document.createElement('input');
    orIn.type = 'text';
    orIn.placeholder = I18n.t('options_model_or_id');
    orIn.value = (entry && entry.openrouter) || '';
    orIn.className = 'sn-model-or';

    const gemIn = document.createElement('input');
    gemIn.type = 'text';
    gemIn.placeholder = I18n.t('options_model_gemini_id');
    gemIn.value = (entry && entry.gemini) || '';
    gemIn.className = 'sn-model-gemini';

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sn-btn sn-btn-secondary';
    del.textContent = I18n.t('options_model_remove');
    del.addEventListener('click', () => { row.remove(); });

    row.appendChild(nickIn);
    row.appendChild(labelIn);
    row.appendChild(orIn);
    row.appendChild(gemIn);
    row.appendChild(del);
    return row;
  }

  function renderModelRegistry(registry) {
    const host = $('modelRegistryList');
    host.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'sn-model-row sn-model-row-head';
    ['nickname', 'etichetta', 'id su OpenRouter', 'id su Gemini API', ''].forEach((label) => {
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
      const or = row.querySelector('.sn-model-or').value.trim();
      const gem = row.querySelector('.sn-model-gemini').value.trim();
      if (!nick && !label && !or && !gem) continue;
      if (!nick) continue;
      if (out[nick]) continue;
      out[nick] = { label, openrouter: or, gemini: gem };
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

  // ── Modelli per azione ──────────────────────────────────────────────────────
  function renderModelsGrid(models) {
    const grid = $('modelsGrid');
    grid.innerHTML = '';
    for (const [action, labelKey] of ACTION_LABELS) {
      const cell = document.createElement('div');
      const label = document.createElement('label');
      label.textContent = I18n.t(labelKey);
      label.setAttribute('for', `model-${action}`);
      const input = document.createElement('input');
      input.type = 'text';
      input.id = `model-${action}`;
      input.dataset.action = action;
      input.setAttribute('list', 'nicknames-list');
      input.value = (models && models[action]) || '';
      cell.appendChild(label);
      cell.appendChild(input);
      grid.appendChild(cell);
    }
  }

  function collectModels() {
    const out = {};
    for (const input of $('modelsGrid').querySelectorAll('input[data-action]')) {
      out[input.dataset.action] = input.value.trim();
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

    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.DEFAULTS_UPDATE, config });
      if (!res || !res.ok) throw new Error(res?.error || 'errore sconosciuto');
      // Svuota i campi chiave dopo il salvataggio (non li riteniamo in pagina) e
      // ri-applica lo stato "configurata/non" dalla config tornata dal main.
      $('apiKey').value = '';
      $('apiKeyGemini').value = '';
      $('apiKeyTavily').value = '';
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
