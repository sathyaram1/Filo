// Pagina admin "Modelli predefiniti".
//
// Editor della config condivisa (registry modelli, modelli per azione, chiavi
// API predefinite) che si propaga a TUTTI gli utenti via
// Firestore. Riservata agli admin: il main (handler DEFAULTS_GET/UPDATE) rifiuta
// i non-admin e le regole Firestore sono la garanzia forte. Le chiavi vere non
// arrivano mai qui: il main manda solo `apiKeysPresent` (booleani).

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const I18n = window.SN_I18N;
  const Storage = window.SN_STORAGE;
  const ModelChain = window.SN_MODEL_CHAIN;

  // Mappa azione → editor a segmenti della catena di modelli (popolata in applyConfig()).
  let modelChains = {};

  // Cache dei cataloghi modelli per provider (come nelle Opzioni), ma recuperati
  // dal MAIN con le chiavi predefinite: questa pagina non vede mai le chiavi.
  // `null` = non ancora caricato; lista = caricato.
  const providerModelCache = { openrouter: null };

  function $(id) { return document.getElementById(id); }

  // Id della datalist (combobox) associata a un provider.
  function datalistIdFor(provider) {
    return `models-list-${provider}`;
  }

  // Sorgente delle opzioni per il dropdown custom del campo "stringa modello":
  // le <datalist> per-provider restano l'unica sorgente di verità, il combobox
  // le legge senza duplicarle.
  function readProviderOptions(provider) {
    const dl = $(datalistIdFor(provider));
    if (!dl) return [];
    return Array.from(dl.options).map((o) => ({
      value: o.value,
      label: o.label && o.label !== o.value ? o.label : '',
    }));
  }

  // Popola la datalist di un provider con [{ id, label }] (già ordinati dal più
  // recente e etichettati per categoria dal main).
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

  // Carica (una sola volta) il catalogo di un provider chiedendolo al main.
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

  // Semina i combobox con gli id già nel registry (per provider) così il valore
  // corrente compare subito; il fetch del catalogo completo poi li rimpiazza.
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
    $('providerSortLabel').textContent = I18n.t('admin_defaults_sort_general');
    $('providerSortDesc').textContent = I18n.t('admin_defaults_sort_general_desc');
    riempiSceltaGenerale();
    $('h-excluded').textContent = I18n.t('admin_defaults_excluded');
    $('excluded-desc').textContent = I18n.t('admin_defaults_excluded_desc');
    $('addExcludedRow').textContent = I18n.t('admin_defaults_excluded_add');
    $('saveBtn').textContent = I18n.t('admin_defaults_save');
  }

  function keyStateText(present) {
    return present ? I18n.t('admin_defaults_key_present') : I18n.t('admin_defaults_key_absent');
  }

  // ── Registry editor (stesso schema single-provider della pagina Opzioni) ─────
  // Ogni modello ha UN solo provider e la stringa concreta per chiamarlo.
  function entryToSingle(entry) {
    const e = entry || {};
    if (e.provider && e.model) return { provider: e.provider, model: e.model };
    if (e.openrouter) return { provider: 'openrouter', model: e.openrouter };
    return { provider: 'openrouter', model: '' };
  }

  // Livelli di reasoning esposti nel dropdown (fonte di verità: SN_CONST).
  // 'auto' = nessun override (default, valore assente nella voce salvata).
  const REASONING_LEVELS = (window.SN_CONST && window.SN_CONST.REASONING_LEVELS)
    || ['auto', 'off', 'low', 'medium', 'high'];

  function normReasoning(v) {
    if (window.SN_CONST && window.SN_CONST.normalizeReasoning) {
      return window.SN_CONST.normalizeReasoning(v);
    }
    const s = String(v == null ? '' : v).toLowerCase().trim();
    return s && s !== 'auto' && REASONING_LEVELS.includes(s) ? s : null;
  }

  const PROVIDER_SORTS = (window.SN_CONST && window.SN_CONST.PROVIDER_SORTS)
    || ['auto', 'throughput', 'latency', 'price'];

  // Le misure del «Prova» stanno con chi le ha prese (la config condivisa è di
  // tutti), per nickname, nello stesso posto delle Opzioni: sono la stessa cosa.
  let misureProva = {};

  async function ricordaMisura(nickname, esito) {
    if (!nickname) return;
    misureProva = { ...misureProva, [nickname]: esito };
    try {
      await chrome.runtime.sendMessage({
        type: MSG.UPDATE_SETTINGS,
        settings: { defaultModelTests: misureProva },
      });
    } catch (_) {}
  }

  // Con che modello, ragionamento e ordinamento la riga chiamerebbe adesso:
  // «Automatico» rimanda alla scelta generale, che sta su questa stessa pagina.
  function configurazioneRiga(row) {
    const val = (sel) => { const el = row.querySelector(sel); return el ? el.value : ''; };
    return {
      model: val('.sn-model-id').trim(),
      reasoning: normReasoning(val('.sn-model-reason')),
      sort: window.SN_CONST.ordinamentoEffettivo(val('.sn-model-sort'), $('providerSort').value),
    };
  }

  function mostraMisura(row) {
    const statusEl = row.querySelector('.sn-model-row-status');
    if (!statusEl) return;
    const misura = row._misura;
    if (!window.SN_CONST.misuraValePer(misura, configurazioneRiga(row))) {
      statusEl.textContent = I18n.t('options_model_untested');
      return;
    }
    const giorno = giornoMisura(misura.at);
    statusEl.textContent = I18n.t('options_test_result', misura.ttftMs ?? '—', misura.tokensPerSec ?? '—') + giorno;
  }

  // Il giorno solo se non è oggi: numeri di settimane fa messi accanto a quelli
  // appena presi si leggerebbero allo stesso modo.
  function giornoMisura(at) {
    const d = at ? new Date(at) : null;
    if (!d || Number.isNaN(d.getTime())) return '';
    if (d.toDateString() === new Date().toDateString()) return '';
    return ` · ${d.toLocaleDateString()}`;
  }

  function rinfrescaMisure() {
    for (const row of $('modelRegistryList').querySelectorAll('.sn-model-row:not(.sn-model-row-head)')) {
      mostraMisura(row);
    }
  }

  function normSort(v) {
    if (window.SN_CONST && window.SN_CONST.normalizeProviderSort) {
      return window.SN_CONST.normalizeProviderSort(v);
    }
    const s = String(v == null ? '' : v).toLowerCase().trim();
    return s && s !== 'auto' && PROVIDER_SORTS.includes(s) ? s : null;
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

    // Combobox custom (stile Filo, non il popup nativo della datalist): elenca
    // il catalogo del provider scelto, si filtra digitando, resta libero di
    // accettare un id non in lista. Il wrapper è position:relative per ancorare
    // il popup .sn-select-pop.
    const idWrap = document.createElement('div');
    idWrap.className = 'sn-model-id-wrap';
    const idIn = document.createElement('input');
    idIn.type = 'text';
    idIn.placeholder = I18n.t('options_model_id');
    idIn.setAttribute('autocomplete', 'off');
    idIn.value = single.model;
    idIn.className = 'sn-model-id';
    idWrap.appendChild(idIn);
    // Carica il catalogo la prima volta che l'utente apre il campo.
    idIn.addEventListener('focus', () => ensureProviderModels(provSel.value));
    if (window.SN_COMBOBOX) {
      window.SN_COMBOBOX.attach(idWrap, idIn, {
        readOptions: () => readProviderOptions(provSel.value),
      });
    }

    // Cambiando provider, il combobox legge l'altra lista (e la carica).
    provSel.addEventListener('change', () => {
      ensureProviderModels(provSel.value);
    });

    // Livello di reasoning per QUESTO modello (#369): l'owner può forzarlo quando
    // il modello lo supporta. Native select come il provider accanto → coerente
    // coi controlli fratelli della riga (PATTERNS: controlli custom coerenti).
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

    // Con che criterio OpenRouter sceglie l'host per QUESTO modello: gemello del
    // select del reasoning, perché sono le due manopole della velocità.
    const sortSel = document.createElement('select');
    sortSel.className = 'sn-model-sort';
    sortSel.title = I18n.t('admin_defaults_sort_desc');
    for (const val of PROVIDER_SORTS) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = I18n.t('provider_sort_' + val);
      sortSel.appendChild(opt);
    }
    sortSel.value = normSort(entry && entry.sort) || 'auto';

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sn-btn sn-btn-secondary';
    del.textContent = I18n.t('options_model_remove');
    del.addEventListener('click', () => { row.remove(); });

    const test = document.createElement('button');
    test.type = 'button';
    test.className = 'sn-btn sn-btn-secondary';
    test.textContent = I18n.t('options_model_test');
    test.addEventListener('click', () => runRowTest(nickIn, provSel, idIn, row, test, { reasonSel, sortSel }));

    const status = document.createElement('div');
    status.className = 'sn-model-row-status';

    row.appendChild(nickIn);
    row.appendChild(provSel);
    row.appendChild(idWrap);
    row.appendChild(reasonSel);
    row.appendChild(sortSel);
    row.appendChild(del);
    row.appendChild(test);
    row.appendChild(status);

    // Una misura parla della configurazione con cui è stata presa: toccare la
    // riga la rimette in discussione subito, non al prossimo caricamento.
    row._misura = misureProva[nick] || null;
    for (const [el, evento] of [[nickIn, 'input'], [idIn, 'input'], [reasonSel, 'change'], [sortSel, 'change']]) {
      el.addEventListener(evento, () => {
        if (el === nickIn) row._misura = misureProva[nickIn.value.trim()] || null;
        mostraMisura(row);
      });
    }
    mostraMisura(row);
    return row;
  }

  async function runRowTest(nickIn, provSel, idIn, row, btn, tuning) {
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
      // Testa la riga così com'è scritta (provider + stringa modello), anche
      // prima del salvataggio: il main usa le chiavi predefinite (mai visibili
      // qui). Il nickname viaggia solo come informazione di contorno.
      const res = await chrome.runtime.sendMessage({
        type: MSG.TEST_DEFAULT_MODEL,
        nickname,
        provider,
        model: modelId,
        reasoning: normReasoning(tuning && tuning.reasonSel.value) || '',
        sort: normSort(tuning && tuning.sortSel.value) || '',
      });
      if (!res?.ok) {
        statusEl.textContent = `${provider} · ${modelId} — ${I18n.t('options_test_failed', res?.error || '—')}`;
      } else {
        row._misura = {
          ttftMs: res.ttftMs ?? null,
          tokensPerSec: res.tokensPerSec ?? null,
          at: new Date().toISOString(),
          ...configurazioneRiga(row),
        };
        mostraMisura(row);
        ricordaMisura(nickname, row._misura);
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
      I18n.t('admin_defaults_sort'),
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
      const sortEl = row.querySelector('.sn-model-sort');
      const sort = normSort(sortEl && sortEl.value);
      if (!nick && !model) continue;
      if (!nick) continue;
      if (out[nick]) continue;
      const entry = { provider, model };
      if (label) entry.label = label;
      // Salviamo il livello solo se diverso da 'auto' (default): così le voci
      // integrate restano pulite e "auto" non gonfia il doc condiviso.
      if (reasoning) entry.reasoning = reasoning;
      if (sort) entry.sort = sort;
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

  // ── Fornitori esclusi (politica sui modelli, #421/#518) ─────────────────────
  // La lista salvata qui SOSTITUISCE per intero quella scritta nel codice
  // (defaultsStore.get): è voluto — l'owner deve poterla svuotare o riscrivere —
  // ma significa che un'esclusione aggiunta al codice non arriva dove questa
  // lista esiste già. Perciò la pagina confronta le due e lo dice.
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

  // Lista com'era all'ultimo caricamento: serve a distinguere "non l'ho
  // toccata" da "l'ho svuotata".
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

  // Voci escluse dal codice che la lista in pagina non copre: se ce ne sono,
  // l'avviso le nomina e offre di rimetterle (un elenco senza il modo di
  // rimediare sarebbe solo una brutta notizia).
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

  // ── Modelli per azione (stesso editor a segmenti della pagina Opzioni) ───────
  function renderModelsGrid(models) {
    modelChains = ModelChain.renderGrid($('modelsGrid'), {
      models: models || {},
      getRegistry: () => collectModelRegistry(),
    });
  }

  function collectModels() {
    return ModelChain.collect(modelChains);
  }

  // ── Load / Save ─────────────────────────────────────────────────────────────
  // Le voci della scelta generale sono le stesse delle righe, meno «Automatico»:
  // a livello generale «automatico» vuol dire lasciar scegliere il router.
  function riempiSceltaGenerale() {
    const sel = $('providerSort');
    sel.innerHTML = '';
    for (const val of PROVIDER_SORTS) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val === 'auto'
        ? I18n.t('provider_sort_general_auto')
        : I18n.t('provider_sort_' + val);
      sel.appendChild(opt);
    }
  }

  function applyConfig(cfg) {
    const present = cfg.apiKeysPresent || {};
    $('apiKey-state').textContent = `(${keyStateText(present.openrouter)})`;
    $('apiKeyTavily-state').textContent = `(${keyStateText(present.tavily)})`;
    $('apiKeySafebrowse-state').textContent = `(${keyStateText(cfg.safeBrowsingKeyPresent)})`;
    renderModelRegistry(cfg.modelRegistry || {});
    renderModelsGrid(cfg.models || {});
    // Lista EFFETTIVA (codice ⊕ override remoto): è quella che l'app applica, ed
    // è quella che il salvataggio riscrive per intero.
    renderExcluded(cfg.excludedProviders || []);
    $('providerSort').value = normSort(cfg.providerSort) || 'auto';
    // Combobox modelli: semina con gli id già nel registry (compaiono subito),
    // poi carica i cataloghi completi in background (non blocca il render).
    seedDatalistsFromRegistry(cfg.modelRegistry || {});
    ensureProviderModels('openrouter');
    // Le righe nascono prima che la scelta generale sia in pagina, e senza di
    // quella non sanno a cosa rimanda l'«Automatico» della loro misura.
    rinfrescaMisure();
  }

  async function load() {
    fillStaticText();
    try {
      const settings = await Storage.getSettings();
      window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);
      misureProva = settings.defaultModelTests || {};
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
      providerSort: normSort($('providerSort').value) || '',
    };
    // Fornitori esclusi: si invia la lista SOLO se l'owner l'ha toccata (anche
    // per svuotarla: [] è un valore, e viaggia). Salvarla a ogni salvataggio
    // congelerebbe nel doc remoto la lista letta dal codice, e da lì in poi
    // un'esclusione aggiunta con un rilascio non arriverebbe più a nessuno.
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
      // Svuota i campi chiave dopo il salvataggio (non li riteniamo in pagina) e
      // ri-applica lo stato "configurata/non" dalla config tornata dal main.
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
    $('providerSort').addEventListener('change', rinfrescaMisure);
    $('saveBtn').addEventListener('click', save);
  });
})();
