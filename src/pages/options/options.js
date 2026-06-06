// Logica pagina opzioni.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const I18n = window.SN_I18N;
  const Storage = window.SN_STORAGE;
  const ModelChain = window.SN_MODEL_CHAIN;

  // Mappa azione → editor a segmenti della sua catena di modelli (popolata in load()).
  let modelChains = {};

  function $(id) { return document.getElementById(id); }

  function fillStaticText() {
    document.title = I18n.t('options_title');
    $('title').textContent = I18n.t('options_title');
    $('useDefaultModels-label').textContent = I18n.t('options_use_default_models');
    $('useDefaultModels-desc').textContent = I18n.t('options_use_default_models_desc');
    $('h-provider').textContent = I18n.t('options_keys');
    $('h-models').textContent = I18n.t('options_models');
    $('h-costs').textContent = I18n.t('options_costs');
    document.querySelector('label[for="apiKey"]').textContent = I18n.t('options_api_key');

    $('lbl-limit').textContent = I18n.t('options_monthly_limit');
    $('lbl-spent').textContent = I18n.t('options_current_spent');

    $('savedHint').textContent = I18n.t('options_saved');

    $('testOpenrouter').textContent = I18n.t('options_test_provider');
    $('testGemini').textContent = I18n.t('options_test_provider');

    $('h-model-registry').textContent = I18n.t('options_h_model_registry');
    $('model-registry-desc').textContent = I18n.t('options_model_registry_desc');
    $('models-desc').textContent = I18n.t('options_models_desc');
    $('addModelRow').textContent = I18n.t('options_model_add');

  }

  // Quando "usa modelli predefiniti" è ON, nasconde le sezioni di config
  // avanzata (provider/chiavi, registry, modelli per azione): l'utente usa i
  // default condivisi senza dover toccare nulla. OFF = mostra tutto.
  function applyDefaultModelsVisibility() {
    const useDefault = $('useDefaultModels').checked;
    for (const el of document.querySelectorAll('.sn-advanced-models')) {
      el.hidden = useDefault;
    }
  }

  async function load() {
    fillStaticText();

    const settings = await Storage.getSettings();
    window.SN_PAGE_THEME = settings.theme;
    window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);

    $('useDefaultModels').checked = settings.useDefaultModels !== false;
    applyDefaultModelsVisibility();
    $('apiKey').value = settings.apiKeys?.openrouter || '';
    $('apiKeyGemini').value = settings.apiKeys?.gemini || '';
    $('apiKeyTavily').value = settings.apiKeys?.tavily || '';
    $('monthlyLimit').value = settings.monthlyLimitEur ?? 5;

    // Editor a segmenti "Modelli per azione": una catena di fallback per azione.
    modelChains = ModelChain.renderGrid($('modelsGrid'), {
      models: settings.models || {},
      onChange: saveDebounced,
    });

    // Costi
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.GET_COSTS });
      const eur = r?.monthly?.totalEur || 0;
      $('spentBox').textContent = `€${eur.toFixed(4)}`;
    } catch (_) {}

    // Datalist modelli (popola con i default + eventualmente API)
    populateDatalist(collectRawModelIds(settings));

    // Registry modelli (popola anche la datalist dei nickname usata dai segmenti)
    renderModelRegistry(settings.modelRegistry || {});
  }

  // Estrae gli id concreti dei modelli noti, per popolare la datalist
  // dell'input "stringa modello" nel registry editor. Gestisce sia il nuovo
  // schema ({ model }) sia il vecchio duale ({ openrouter, gemini }).
  function collectRawModelIds(settings) {
    const out = [];
    const reg = settings.modelRegistry || {};
    for (const nick of Object.keys(reg)) {
      const e = reg[nick] || {};
      if (e.model) out.push(e.model);
      if (e.openrouter) out.push(e.openrouter);
      if (e.gemini) out.push(e.gemini);
    }
    return out;
  }

  // Normalizza una entry del registry (nuovo schema o vecchio duale) in
  // { provider, model }. Per le vecchie entry duali sceglie un solo provider
  // (preferendo Gemini, poi OpenRouter): al primo salvataggio diventerà
  // single-provider e l'utente potrà aggiungere il gemello sull'altro provider
  // come riga separata se vuole il fallback.
  function entryToSingle(entry) {
    const e = entry || {};
    if (e.provider && e.model) return { provider: e.provider, model: e.model };
    if (e.gemini) return { provider: 'gemini', model: e.gemini };
    if (e.openrouter) return { provider: 'openrouter', model: e.openrouter };
    return { provider: 'openrouter', model: '' };
  }

  // Normalizza i risultati di test (nuovo schema flat { ttftMs, tokensPerSec }
  // o vecchio per-provider { openrouter:{...}, gemini:{...} }) nel formato flat,
  // scegliendo il sotto-oggetto del provider attivo per le vecchie entry.
  function normalizeTest(entry, single) {
    const t = entry && entry.test;
    if (!t || typeof t !== 'object') return null;
    if (t.ttftMs != null || t.tokensPerSec != null) return { ...t };
    const sub = t[single.provider];
    return sub ? { ...sub } : null;
  }

  function populateNicknames(registry) {
    const dl = $('nicknames-list');
    if (!dl) return;
    dl.innerHTML = '';
    for (const nick of Object.keys(registry || {})) {
      const opt = document.createElement('option');
      opt.value = nick;
      const entry = registry[nick] || {};
      if (entry.label) opt.label = entry.label;
      dl.appendChild(opt);
    }
  }

  // Formatta un risultato di test salvato (latenza + token/sec) per la riga.
  function formatTestResult(t) {
    if (!t) return '';
    const ttft = t.ttftMs != null ? t.ttftMs : '—';
    const tps = t.tokensPerSec != null ? t.tokensPerSec : '—';
    return I18n.t('options_test_result', ttft, tps);
  }

  // Mostra nel div di stato della riga il risultato di test memorizzato
  // (latenza + token/sec), così la misura resta visibile tra le sessioni.
  function renderRowTest(row) {
    const statusEl = row.querySelector('.sn-model-row-status');
    if (!statusEl) return;
    const hasResult = row._test && (row._test.ttftMs != null || row._test.tokensPerSec != null);
    statusEl.textContent = hasResult ? formatTestResult(row._test) : I18n.t('options_model_untested');
  }

  function makeModelRow(nick, entry) {
    const row = document.createElement('div');
    row.className = 'sn-model-row';
    row.dataset.originalNick = nick || '';
    const single = entryToSingle(entry);
    // Etichetta descrittiva preservata "in silenzio" (non ha più una colonna
    // dedicata, ma serve come hint nella datalist dei nickname per-azione).
    row.dataset.label = (entry && entry.label) || '';
    // Risultato di test persistito (flat): { ttftMs, tokensPerSec, at }.
    row._test = normalizeTest(entry, single);

    const nickIn = document.createElement('input');
    nickIn.type = 'text';
    nickIn.placeholder = I18n.t('options_model_nickname');
    nickIn.value = nick || '';
    nickIn.className = 'sn-model-nick';

    // Un solo provider per modello.
    const provSel = document.createElement('select');
    provSel.className = 'sn-model-provider';
    [['openrouter', 'OpenRouter'], ['gemini', 'Gemini API']].forEach(([val, label]) => {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = label;
      provSel.appendChild(opt);
    });
    provSel.value = single.provider;

    // Stringa concreta per chiamare il modello presso il provider scelto.
    const idIn = document.createElement('input');
    idIn.type = 'text';
    idIn.placeholder = I18n.t('options_model_id');
    idIn.setAttribute('list', 'models-list');
    idIn.value = single.model;
    idIn.className = 'sn-model-id';

    const status = document.createElement('div');
    status.className = 'sn-model-row-status';

    const test = document.createElement('button');
    test.type = 'button';
    test.className = 'sn-btn sn-btn-secondary';
    test.textContent = I18n.t('options_model_test');
    test.addEventListener('click', () => runRowTest(provSel.value, idIn.value.trim(), row, test));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sn-btn sn-btn-secondary';
    del.textContent = I18n.t('options_model_remove');
    del.addEventListener('click', () => { row.remove(); save(); });

    // Ordine richiesto: nickname · provider · stringa · Rimuovi · Prova, con i
    // dati del test (latenza/token-sec) nella riga a tutta larghezza sotto.
    row.appendChild(nickIn);
    row.appendChild(provSel);
    row.appendChild(idIn);
    row.appendChild(del);
    row.appendChild(test);
    row.appendChild(status);
    renderRowTest(row);
    return row;
  }

  function renderModelRegistry(registry) {
    const host = $('modelRegistryList');
    host.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'sn-model-row sn-model-row-head';
    [
      I18n.t('options_model_nickname'),
      I18n.t('options_model_provider'),
      I18n.t('options_model_id'),
      '', '',
    ].forEach((label) => {
      const c = document.createElement('div'); c.textContent = label; head.appendChild(c);
    });
    host.appendChild(head);

    const entries = Object.entries(registry || {});
    if (!entries.length) {
      // Editor vuoto: una riga vuota per iniziare.
      host.appendChild(makeModelRow('', {}));
    } else {
      for (const [nick, e] of entries) {
        host.appendChild(makeModelRow(nick, e));
      }
    }
    populateNicknames(registry);
  }

  function collectModelRegistry() {
    const host = $('modelRegistryList');
    const out = {};
    const dups = [];
    let missingNick = false;
    for (const row of host.querySelectorAll('.sn-model-row:not(.sn-model-row-head)')) {
      const nick = row.querySelector('.sn-model-nick').value.trim();
      const provider = row.querySelector('.sn-model-provider').value;
      const model = row.querySelector('.sn-model-id').value.trim();
      const label = (row.dataset.label || '').trim();
      if (!nick && !model) continue;
      if (!nick) { missingNick = true; continue; }
      if (out[nick]) { dups.push(nick); continue; }
      const entry = { provider, model };
      if (label) entry.label = label;
      // Preserva il risultato di test misurato (latenza/token-sec) tra i salvataggi.
      if (row._test && Object.keys(row._test).length) entry.test = row._test;
      out[nick] = entry;
    }
    return { registry: out, dups, missingNick };
  }

  async function runRowTest(providerId, modelId, row, btn) {
    const statusEl = row.querySelector('.sn-model-row-status');
    if (!modelId) {
      statusEl.textContent = I18n.t('options_model_no_id');
      return;
    }
    const keyEl = providerId === 'gemini' ? $('apiKeyGemini') : $('apiKey');
    const apiKey = keyEl.value.trim();
    if (!apiKey) { statusEl.textContent = I18n.t('options_test_no_key'); return; }
    statusEl.textContent = `${providerId} · ${modelId} — ${I18n.t('options_test_running')}`;
    btn.disabled = true;
    try {
      // Per Gemini il MSG.TEST_PROVIDER si aspetta un id "stile OpenRouter" che
      // poi viene convertito da toGeminiModelId. Per testare un id nativo
      // Gemini (es. "gemini-2.0-flash") lo wrappiamo con il prefisso google/
      // così la conversione lo torna invariato dopo lo strip.
      const modelForApi = providerId === 'gemini' && !modelId.startsWith('google/')
        ? `google/${modelId}`
        : modelId;
      const res = await chrome.runtime.sendMessage({
        type: MSG.TEST_PROVIDER,
        provider: providerId,
        apiKey,
        model: modelForApi,
      });
      if (!res?.ok) {
        statusEl.textContent = `${providerId} · ${modelId} — ${I18n.t('options_test_failed', res?.error || '—')}`;
      } else {
        // Salva il risultato (latenza + token/sec) nella riga e persistilo nel
        // registry, così resta visibile e confrontabile tra le sessioni.
        row._test = {
          ttftMs: res.ttftMs ?? null,
          tokensPerSec: res.tokensPerSec ?? null,
          at: new Date().toISOString(),
        };
        renderRowTest(row);
        save();
      }
    } catch (e) {
      statusEl.textContent = I18n.t('options_test_failed', e?.message || String(e));
    } finally {
      btn.disabled = false;
    }
  }

  function populateDatalist(ids) {
    const dl = $('models-list');
    dl.innerHTML = '';
    const seen = new Set();
    for (const id of ids) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const opt = document.createElement('option');
      opt.value = id;
      dl.appendChild(opt);
    }
  }

  // Popola la datalist di autocomplete della "stringa modello" interrogando
  // TUTTI i provider per cui c'è una chiave (OpenRouter e/o Gemini) e unendo
  // gli id. La datalist è condivisa da tutte le righe del registry; il provider
  // di ciascuna riga lo sceglie l'utente col menu a tendina.
  async function loadModelsFromProvider() {
    $('modelsStatus').textContent = '…';
    const orKey = $('apiKey').value.trim();
    const gemKey = $('apiKeyGemini').value.trim();
    if (!orKey && !gemKey) { $('modelsStatus').textContent = I18n.t('err_no_api_key'); return; }
    const ids = [];
    const errors = [];
    if (gemKey) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(gemKey)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        for (const m of data.models || []) ids.push('google/' + (m.name || '').replace(/^models\//, ''));
      } catch (e) { errors.push(`Gemini: ${e.message || e}`); }
    }
    if (orKey) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/models', {
          headers: { Authorization: `Bearer ${orKey}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        for (const m of data.data || []) ids.push(m.id);
      } catch (e) { errors.push(`OpenRouter: ${e.message || e}`); }
    }
    populateDatalist(ids);
    $('modelsStatus').textContent = errors.length ? errors.join(' · ') : `${ids.length} modelli`;
  }

  async function save() {
    const apiKey = $('apiKey').value.trim();
    const apiKeyGemini = $('apiKeyGemini').value.trim();
    const apiKeyTavily = $('apiKeyTavily').value.trim();

    // Auto-save: persistiamo solo le righe valide. Le righe incomplete
    // (nickname mancante) o duplicate vengono semplicemente ignorate finché
    // non sono complete — niente alert bloccanti che interromperebbero la
    // digitazione, dato che non c'è più un pulsante "Salva" esplicito.
    const { registry } = collectModelRegistry();

    const partial = {
      useDefaultModels: $('useDefaultModels').checked,
      apiKeys: { openrouter: apiKey, gemini: apiKeyGemini, tavily: apiKeyTavily },
      modelRegistry: registry,
      models: ModelChain.collect(modelChains),
      monthlyLimitEur: parseFloat($('monthlyLimit').value) || 0,
    };

    await chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: partial });

    // Aggiorna la datalist dei nickname (per-action) col registry appena salvato.
    populateNicknames(registry);

    const hint = $('savedHint');
    hint.classList.add('sn-show');
    setTimeout(() => hint.classList.remove('sn-show'), 1500);
  }

  async function testProvider(providerId, statusEl, btn) {
    const keyEl = providerId === 'gemini' ? $('apiKeyGemini') : $('apiKey');
    const apiKey = keyEl.value.trim();
    if (!apiKey) { statusEl.textContent = I18n.t('options_test_no_key'); return; }
    statusEl.textContent = I18n.t('options_test_running');
    btn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({
        type: MSG.TEST_PROVIDER,
        provider: providerId,
        apiKey,
      });
      if (!res?.ok) {
        statusEl.textContent = I18n.t('options_test_failed', res?.error || '—');
      } else {
        statusEl.textContent = I18n.t('options_test_result', res.ttftMs ?? '—', res.tokensPerSec ?? '—');
      }
    } catch (e) {
      statusEl.textContent = I18n.t('options_test_failed', e?.message || String(e));
    } finally {
      btn.disabled = false;
    }
  }

  let saveTimer = null;
  function saveDebounced() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    // Niente pulsante "Salva": ogni modifica viene applicata e persistita
    // subito. I controlli testuali salvano allo `change` (cioè al blur), gli
    // altri (select/checkbox) immediatamente.
    $('page').addEventListener('change', () => saveDebounced());
    $('useDefaultModels').addEventListener('change', applyDefaultModelsVisibility);
    $('loadModels').addEventListener('click', loadModelsFromProvider);
    $('testOpenrouter').addEventListener('click', () => testProvider('openrouter', $('testOpenrouterStatus'), $('testOpenrouter')));
    $('testGemini').addEventListener('click', () => testProvider('gemini', $('testGeminiStatus'), $('testGemini')));
    $('addModelRow').addEventListener('click', () => {
      $('modelRegistryList').appendChild(makeModelRow('', {}));
    });
    // L'input dentro le righe del registry e i segmenti dei modelli (creati
    // dinamicamente) fanno bubbling del `change` fino a #page → già coperti.
    $('lnkShortcuts').addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });
  });
})();
