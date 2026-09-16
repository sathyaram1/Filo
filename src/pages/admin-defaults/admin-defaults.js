// Pagina admin «Modelli predefiniti»: editor della config condivisa che si propaga a TUTTI
// via Firestore. Riservata agli admin (il main rifiuta i non-admin, le regole Firestore sono
// la garanzia forte). Le chiavi vere non arrivano mai qui: solo booleani `apiKeysPresent`.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const I18n = window.SN_I18N;
  const Storage = window.SN_STORAGE;
  const ModelChain = window.SN_MODEL_CHAIN;

  let modelChains = {};

  // Cache dei cataloghi per provider, recuperati dal MAIN con le chiavi predefinite: questa
  // pagina non vede mai le chiavi. `null` = non ancora caricato.
  const providerModelCache = { openrouter: null };

  function $(id) { return document.getElementById(id); }

  function datalistIdFor(provider) {
    return `models-list-${provider}`;
  }

  // Le <datalist> per-provider sono l'unica sorgente di verità: il combobox non le duplica.
  function readProviderOptions(provider) {
    const dl = $(datalistIdFor(provider));
    if (!dl) return [];
    return Array.from(dl.options).map((o) => ({
      value: o.value,
      label: o.label && o.label !== o.value ? o.label : '',
    }));
  }

  function populateDatalist(provider, items) {
    const dl = $(datalistIdFor(provider));
    if (!dl) return;
    dl.innerHTML = '';
    const seen = new Set();
    for (const it of items || []) {
      const id = typeof it === 'string' ? it : it.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const opt = document.createElement('option');
      opt.value = id;
      if (it && it.label) opt.label = it.label;
      dl.appendChild(opt);
    }
  }

  // Silenzioso: in caso di errore il campo resta un input libero.
  async function ensureProviderModels(provider) {
    if (providerModelCache[provider]) return;
    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.DEFAULT_MODELS_LIST, provider });
      if (res?.ok && Array.isArray(res.items) && res.items.length) {
        providerModelCache[provider] = res.items;
        populateDatalist(provider, res.items);
      }
    } catch (_) { /* lista non disponibile: il campo resta libero */ }
  }

  // Il valore corrente compare subito; il catalogo completo poi lo rimpiazza.
  function seedDatalistsFromRegistry(registry) {
    const byProv = { openrouter: [] };
    for (const nick of Object.keys(registry || {})) {
      const s = entryToSingle(registry[nick]);
      if (s.model && byProv[s.provider]) byProv[s.provider].push(s.model);
    }
    if (!providerModelCache.openrouter) populateDatalist('openrouter', byProv.openrouter);
  }

  function fillStaticText() {
    document.title = I18n.t('admin_defaults_title');
    $('title').textContent = I18n.t('admin_defaults_title');
    $('denied-msg').textContent = I18n.t('admin_defaults_denied');
    $('intro').textContent = I18n.t('admin_defaults_intro');
    $('h-keys').textContent = I18n.t('admin_defaults_keys');
    $('keys-desc').textContent = I18n.t('admin_defaults_keys_desc');
    $('apiKeySafebrowse-desc').textContent = I18n.t('admin_defaults_safebrowse_key_desc');
    $('h-model-registry').textContent = I18n.t('options_h_model_registry');
    $('model-registry-desc').textContent = I18n.t('options_model_registry_desc');
    $('h-models').textContent = I18n.t('options_models');
    $('models-desc').textContent = I18n.t('options_models_desc');
    $('addModelRow').textContent = I18n.t('options_model_add');
    $('h-excluded').textContent = I18n.t('admin_defaults_excluded');
    $('excluded-desc').textContent = I18n.t('admin_defaults_excluded_desc');
    $('addExcludedRow').textContent = I18n.t('admin_defaults_excluded_add');
    $('saveBtn').textContent = I18n.t('admin_defaults_save');
  }

  function keyStateText(present) {
    return present ? I18n.t('admin_defaults_key_present') : I18n.t('admin_defaults_key_absent');
  }

  // Registry: ogni modello ha UN solo provider e la stringa concreta per chiamarlo.
  function entryToSingle(entry) {
    const e = entry || {};
    if (e.provider && e.model) return { provider: e.provider, model: e.model };
    if (e.openrouter) return { provider: 'openrouter', model: e.openrouter };
    return { provider: 'openrouter', model: '' };
  }

  // Fonte di verità SN_CONST; 'auto' = nessun override (valore assente nella voce salvata).
  const REASONING_LEVELS = (window.SN_CONST && window.SN_CONST.REASONING_LEVELS)
    || ['auto', 'off', 'low', 'medium', 'high'];

  function normReasoning(v) {
    if (window.SN_CONST && window.SN_CONST.normalizeReasoning) {
      return window.SN_CONST.normalizeReasoning(v);
    }
    const s = String(v == null ? '' : v).toLowerCase().trim();
    return s && s !== 'auto' && REASONING_LEVELS.includes(s) ? s : null;
  }

  function makeModelRow(nick, entry) {
    const row = document.createElement('div');
    row.className = 'sn-model-row sn-model-row-reason';
    const single = entryToSingle(entry);
    row.dataset.label = (entry && entry.label) || '';
    row._entry = { ...(entry || {}) };

    const nickIn = document.createElement('input');
    nickIn.type = 'text';
    nickIn.placeholder = I18n.t('options_model_nickname');
    nickIn.value = nick || '';
    nickIn.className = 'sn-model-nick';

    const provSel = document.createElement('select');
    provSel.className = 'sn-model-provider';
    [['openrouter', 'OpenRouter']].forEach(([val, label]) => {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = label;
      provSel.appendChild(opt);
    });
    provSel.value = single.provider;

    // Combobox custom (stile Filo, non il popup nativo): filtra digitando e accetta anche un id
    // fuori lista. Il wrapper è position:relative per ancorare .sn-select-pop.
    const idWrap = document.createElement('div');
    idWrap.className = 'sn-model-id-wrap';
    const idIn = document.createElement('input');
    idIn.type = 'text';
    idIn.placeholder = I18n.t('options_model_id');
    idIn.setAttribute('autocomplete', 'off');
    idIn.value = single.model;
    idIn.className = 'sn-model-id';
    idWrap.appendChild(idIn);
    idIn.addEventListener('focus', () => ensureProviderModels(provSel.value));
    if (window.SN_COMBOBOX) {
      window.SN_COMBOBOX.attach(idWrap, idIn, {
        readOptions: () => readProviderOptions(provSel.value),
      });
    }

    provSel.addEventListener('change', () => {
      ensureProviderModels(provSel.value);
    });

    // Livello di reasoning per QUESTO modello (#369). Select nativa, per coerenza coi controlli fratelli.
    const reasonSel = document.createElement('select');
    reasonSel.className = 'sn-model-reason';
    reasonSel.title = I18n.t('admin_defaults_reasoning_desc');
    for (const lvl of REASONING_LEVELS) {
      const opt = document.createElement('option');
      opt.value = lvl;
      opt.textContent = I18n.t('reasoning_' + lvl);
      reasonSel.appendChild(opt);
    }
    reasonSel.value = normReasoning(entry && entry.reasoning) || 'auto';

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sn-btn sn-btn-secondary';
    del.textContent = I18n.t('options_model_remove');
    del.addEventListener('click', () => { row.remove(); });

    const test = document.createElement('button');
    test.type = 'button';
    test.className = 'sn-btn sn-btn-secondary';
    test.textContent = I18n.t('options_model_test');
    test.addEventListener('click', () => runRowTest(nickIn, provSel, idIn, row, test));

    const status = document.createElement('div');
    status.className = 'sn-model-row-status';

    row.appendChild(nickIn);
    row.appendChild(provSel);
    row.appendChild(idWrap);
    row.appendChild(reasonSel);
    row.appendChild(del);
    row.appendChild(test);
    row.appendChild(status);
    return row;
  }

  async function runRowTest(nickIn, provSel, idIn, row, btn) {
    const statusEl = row.querySelector('.sn-model-row-status');
    const nickname = nickIn.value.trim();
    const provider = provSel.value;
    const modelId = idIn.value.trim();
    if (!modelId) {
      statusEl.textContent = I18n.t('options_model_no_id');
      return;
    }
    statusEl.textContent = `${provider} · ${modelId} — ${I18n.t('options_test_running')}`;
    btn.disabled = true;
    try {
      // Testa la riga com'è scritta, anche prima del salvataggio: il main usa le chiavi predefinite.
      const res = await chrome.runtime.sendMessage({
        type: MSG.TEST_DEFAULT_MODEL,
        nickname,
        provider,
        model: modelId,
      });
      if (!res?.ok) {
        statusEl.textContent = `${provider} · ${modelId} — ${I18n.t('options_test_failed', res?.error || '—')}`;
      } else {
        statusEl.textContent = I18n.t('options_test_result', res.ttftMs ?? '—', res.tokensPerSec ?? '—');
      }
    } catch (e) {
      statusEl.textContent = I18n.t('options_test_failed', e?.message || String(e));
    } finally {
      btn.disabled = false;
    }
  }

  function renderModelRegistry(registry) {
    const host = $('modelRegistryList');
    host.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'sn-model-row sn-model-row-head sn-model-row-reason';
    [
      I18n.t('options_model_nickname'),
      I18n.t('options_model_provider'),
      I18n.t('options_model_id'),
      I18n.t('admin_defaults_reasoning'),
      '', '',
    ].forEach((label) => {
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
      const provider = row.querySelector('.sn-model-provider').value;
      const model = row.querySelector('.sn-model-id').value.trim();
      const label = (row.dataset.label || '').trim();
      const reasonEl = row.querySelector('.sn-model-reason');
      const reasoning = normReasoning(reasonEl && reasonEl.value);
      if (!nick && !model) continue;
      if (!nick) continue;
      if (out[nick]) continue;
      const entry = { provider, model };
      if (label) entry.label = label;
      // Il livello si salva solo se diverso da 'auto': «auto» non deve gonfiare il doc condiviso.
      if (reasoning) entry.reasoning = reasoning;
      // Ciò che la riga non modifica ma la voce dichiara resta com'era.
      for (const k of ['weights', 'inputs', 'outputs']) {
        if (row._entry && row._entry[k] != null) entry[k] = row._entry[k];
      }
      out[nick] = entry;
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

  // Fornitori esclusi (#421/#518): la lista salvata qui SOSTITUISCE quella del codice — l'owner
  // deve poterla svuotare — quindi la pagina confronta le due e dice cosa manca.
  function makeExcludedRow(name) {
    const row = document.createElement('div');
    row.className = 'sn-model-row sn-excluded-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'sn-excluded-name';
    input.placeholder = I18n.t('admin_defaults_excluded_name');
    input.setAttribute('autocomplete', 'off');
    input.value = name || '';
    input.addEventListener('input', renderExcludedDrift);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sn-btn sn-btn-secondary';
    del.textContent = I18n.t('admin_defaults_excluded_remove');
    del.addEventListener('click', () => { row.remove(); renderExcludedDrift(); });

    row.appendChild(input);
    row.appendChild(del);
    return row;
  }

  // Lista com'era all'ultimo caricamento: distingue «non l'ho toccata» da «l'ho svuotata».
  let loadedExcluded = [];

  function renderExcluded(list) {
    const host = $('excludedList');
    host.innerHTML = '';
    for (const name of (Array.isArray(list) ? list : [])) {
      if (typeof name === 'string' && name.trim()) host.appendChild(makeExcludedRow(name.trim()));
    }
    loadedExcluded = collectExcluded();
    renderExcludedDrift();
  }

  function collectExcluded() {
    const host = $('excludedList');
    const out = [];
    const seen = new Set();
    for (const input of host.querySelectorAll('.sn-excluded-name')) {
      const v = input.value.trim();
      if (!v) continue;
      const k = v.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    return out;
  }

  // L'avviso le nomina e offre di rimetterle: un elenco senza rimedio è solo una brutta notizia.
  function excludedMissingFromBuild() {
    const C = window.SN_CONST;
    if (!C || typeof C.missingExcludedProviders !== 'function') return [];
    return C.missingExcludedProviders(C.DEFAULT_EXCLUDED_PROVIDERS || [], collectExcluded());
  }

  function renderExcludedDrift() {
    const box = $('excludedDrift');
    if (!box) return;
    const missing = excludedMissingFromBuild();
    if (!missing.length) { box.hidden = true; return; }
    $('excludedDriftTitle').textContent = I18n.t('admin_defaults_excluded_drift_title');
    $('excludedDriftText').textContent = I18n.t('admin_defaults_excluded_drift', missing.join(', '));
    $('excludedDriftFix').textContent = I18n.t('admin_defaults_excluded_drift_fix');
    box.hidden = false;
  }

  function addMissingExcluded() {
    const host = $('excludedList');
    for (const name of excludedMissingFromBuild()) host.appendChild(makeExcludedRow(name));
    renderExcludedDrift();
  }

  // Modelli per azione: stesso editor a segmenti della pagina Opzioni.
  function renderModelsGrid(models) {
    modelChains = ModelChain.renderGrid($('modelsGrid'), {
      models: models || {},
      getRegistry: () => collectModelRegistry(),
    });
  }

  function collectModels() {
    return ModelChain.collect(modelChains);
  }

  function applyConfig(cfg) {
    const present = cfg.apiKeysPresent || {};
    $('apiKey-state').textContent = `(${keyStateText(present.openrouter)})`;
    $('apiKeyTavily-state').textContent = `(${keyStateText(present.tavily)})`;
    $('apiKeySafebrowse-state').textContent = `(${keyStateText(cfg.safeBrowsingKeyPresent)})`;
    renderModelRegistry(cfg.modelRegistry || {});
    renderModelsGrid(cfg.models || {});
    // Lista EFFETTIVA (codice ⊕ override remoto): quella che l'app applica e che il salvataggio riscrive.
    renderExcluded(cfg.excludedProviders || []);
    // Poi i cataloghi completi in background, senza bloccare il render.
    seedDatalistsFromRegistry(cfg.modelRegistry || {});
    ensureProviderModels('openrouter');
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
    const tav = $('apiKeyTavily').value.trim();
    if (or) apiKeys.openrouter = or;
    if (tav) apiKeys.tavily = tav;

    const config = {
      modelRegistry: collectModelRegistry(),
      models: collectModels(),
    };
    // La lista si invia SOLO se l'owner l'ha toccata ([] compreso): salvarla sempre congelerebbe
    // nel doc remoto quella letta dal codice, e un'esclusione aggiunta con un rilascio non arriverebbe più.
    const excluded = collectExcluded();
    if (JSON.stringify(excluded) !== JSON.stringify(loadedExcluded)) {
      config.excludedProviders = excluded;
    }
    if (Object.keys(apiKeys).length) config.apiKeys = apiKeys;
    // La chiave Safe Browsing si invia solo se digitata (vuoto = "non toccare").
    const gsb = $('apiKeySafebrowse').value.trim();
    if (gsb) config.safeBrowsingKey = gsb;

    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.DEFAULTS_UPDATE, config });
      if (!res || !res.ok) throw new Error(res?.error || 'errore sconosciuto');
      // I campi chiave si svuotano dopo il salvataggio; lo stato «configurata» torna dal main.
      $('apiKey').value = '';
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
    $('addExcludedRow').addEventListener('click', () => {
      const row = makeExcludedRow('');
      $('excludedList').appendChild(row);
      row.querySelector('.sn-excluded-name').focus();
    });
    $('excludedDriftFix').addEventListener('click', addMissingExcluded);
    $('saveBtn').addEventListener('click', save);
  });
})();
