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
  // Catene lette che la griglia non mostra: il salvataggio riscrive la mappa intera, e senza
  // queste cancellerebbe la scelta di una funzione spostata in Gestione prima che lì la si salvi (#465).
  let hiddenModels = {};

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
    $('h-excluded').textContent = I18n.t('admin_defaults_excluded');
    $('excluded-desc').textContent = I18n.t('admin_defaults_excluded_desc');
    $('addExcludedRow').textContent = I18n.t('admin_defaults_excluded_add');
    $('saveBtn').textContent = I18n.t('admin_defaults_save');
    $('h-delicate').textContent = I18n.t('admin_defaults_delicate');
    $('delicate-desc').textContent = I18n.t('admin_defaults_delicate_desc');
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
      // Testa la riga così com'è scritta (provider + stringa modello), anche
      // prima del salvataggio: il main usa le chiavi predefinite (mai visibili
      // qui). Il nickname viaggia solo come informazione di contorno.
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
      // Salviamo il livello solo se diverso da 'auto' (default): così le voci
      // integrate restano pulite e "auto" non gonfia il doc condiviso.
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

  // ── Fornitori esclusi (politica sui modelli, #421/#518/#541) ─────────────────
  // La lista salvata qui SOSTITUISCE per intero quella scritta nel codice
  // (defaultsStore.get): è voluto — l'owner deve poterla svuotare o riscrivere —
  // ma significa che un'esclusione aggiunta al codice non arriva dove questa
  // lista esiste già. Perciò la pagina confronta le due e lo dice.

  // Fornitori che lo smistatore conosce ([{ name, slug }]); null finché non
  // arrivano o se non arrivano: allora un nome non si può controllare.
  let providerCatalog = null;

  async function ensureProviderCatalog() {
    if (providerCatalog) return;
    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.DEFAULT_PROVIDERS_LIST });
      if (res?.ok && Array.isArray(res.items) && res.items.length) {
        providerCatalog = res.items;
        for (const row of $('excludedList').querySelectorAll('.sn-excluded-row')) checkExcludedName(row);
        renderExcludedDrift();
      }
    } catch (_) { /* senza catalogo il campo resta libero e non si segnala niente */ }
  }

  function readCatalogOptions() {
    return (providerCatalog || []).map((p) => ({ value: p.name, label: '' }));
  }

  // Un nome che non copre nessun fornitore del catalogo non esclude niente: lo
  // si dice sulla riga, con la correzione più probabile a un click.
  function checkExcludedName(row) {
    const C = window.SN_CONST;
    const msg = row.querySelector('.sn-model-row-msg');
    const input = row.querySelector('.sn-excluded-name');
    msg.textContent = '';
    row.classList.remove('sn-row-invalid');
    input.classList.remove('sn-input-invalid');
    const name = input.value.trim();
    if (!name || !providerCatalog || !C || typeof C.providerCoversCatalog !== 'function') return;
    if (C.providerCoversCatalog(name, providerCatalog)) return;
    row.classList.add('sn-row-invalid');
    input.classList.add('sn-input-invalid');
    const text = document.createElement('span');
    text.textContent = I18n.t('admin_defaults_excluded_unknown');
    msg.appendChild(text);
    const guess = C.closestCatalogProvider(name, providerCatalog);
    if (guess) {
      const fix = document.createElement('button');
      fix.type = 'button';
      fix.className = 'sn-excluded-guess';
      fix.textContent = I18n.t('admin_defaults_excluded_guess', guess);
      fix.addEventListener('click', () => {
        input.value = guess;
        adoptDefaultReason(row);
        checkExcludedName(row);
        renderExcludedDrift();
      });
      msg.appendChild(fix);
    }
  }

  function makeExcludedRow(name, reason) {
    const r = reason || {};
    const row = document.createElement('div');
    row.className = 'sn-model-row sn-excluded-row';

    const wrap = document.createElement('div');
    wrap.className = 'sn-model-id-wrap';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'sn-excluded-name';
    input.placeholder = I18n.t('admin_defaults_excluded_name');
    input.setAttribute('autocomplete', 'off');
    input.value = name || '';
    input.addEventListener('input', () => { checkExcludedName(row); renderExcludedDrift(); });
    wrap.appendChild(input);
    if (window.SN_COMBOBOX) {
      window.SN_COMBOBOX.attach(wrap, input, {
        readOptions: readCatalogOptions,
        onPick: () => { adoptDefaultReason(row); checkExcludedName(row); renderExcludedDrift(); },
      });
    }

    const kind = document.createElement('select');
    kind.className = 'sn-excluded-kind';
    for (const k of ['', ...((window.SN_CONST && window.SN_CONST.EXCLUDED_PROVIDER_KINDS) || [])]) {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = I18n.t('admin_defaults_excluded_kind_' + (k || 'none'));
      kind.appendChild(opt);
    }
    kind.value = r.kind || '';

    const note = document.createElement('input');
    note.type = 'text';
    note.className = 'sn-excluded-note';
    note.placeholder = I18n.t('admin_defaults_excluded_note');
    note.setAttribute('autocomplete', 'off');
    note.value = r.note || '';

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sn-btn sn-btn-secondary';
    del.textContent = I18n.t('admin_defaults_excluded_remove');
    del.addEventListener('click', () => { row.remove(); renderExcludedDrift(); });

    const msg = document.createElement('div');
    msg.className = 'sn-model-row-msg';

    row.append(wrap, kind, note, del, msg);
    checkExcludedName(row);
    return row;
  }

  function excludedHead() {
    const head = document.createElement('div');
    head.className = 'sn-model-row sn-model-row-head sn-excluded-head';
    for (const key of ['admin_defaults_excluded_name', 'admin_defaults_excluded_kind', 'admin_defaults_excluded_note', '']) {
      const c = document.createElement('div');
      c.textContent = key ? I18n.t(key) : '';
      head.appendChild(c);
    }
    return head;
  }

  // Com'era all'ultimo caricamento: serve a distinguere "non l'ho toccata" da
  // "l'ho svuotata", per i nomi e per i motivi separatamente.
  let loadedExcluded = [];
  let loadedReasons = '[]';

  function renderExcluded(list, reasons) {
    const host = $('excludedList');
    host.innerHTML = '';
    host.appendChild(excludedHead());
    const byName = new Map((Array.isArray(reasons) ? reasons : [])
      .filter((r) => r && typeof r.name === 'string')
      .map((r) => [r.name.trim().toLowerCase(), r]));
    for (const name of (Array.isArray(list) ? list : [])) {
      if (typeof name !== 'string' || !name.trim()) continue;
      host.appendChild(makeExcludedRow(name.trim(), byName.get(name.trim().toLowerCase())));
    }
    loadedExcluded = collectExcluded();
    loadedReasons = JSON.stringify(collectExcludedReasons());
    renderExcludedDrift();
  }

  // Righe con un nome, una per nome (le maiuscole non contano): la prima vince.
  function excludedRows() {
    const out = [];
    const seen = new Set();
    for (const row of $('excludedList').querySelectorAll('.sn-excluded-row')) {
      const v = row.querySelector('.sn-excluded-name').value.trim();
      if (!v) continue;
      const k = v.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ row, name: v });
    }
    return out;
  }

  function collectExcluded() {
    return excludedRows().map((x) => x.name);
  }

  function collectExcludedReasons() {
    return excludedRows().map(({ row, name }) => ({
      name,
      kind: row.querySelector('.sn-excluded-kind').value,
      note: row.querySelector('.sn-excluded-note').value.trim(),
    }));
  }

  // Voci escluse dal codice che la lista in pagina non copre: se ce ne sono,
  // l'avviso le nomina e offre di rimetterle (un elenco senza il modo di
  // rimediare sarebbe solo una brutta notizia).
  function excludedMissingFromBuild() {
    const C = window.SN_CONST;
    if (!C || typeof C.missingExcludedProviders !== 'function') return [];
    return C.missingExcludedProviders(C.DEFAULT_EXCLUDED_PROVIDERS || [], collectExcluded(), providerCatalog);
  }

  // Un nome scelto dal catalogo che copre una voce del codice ne prende il motivo
  // di serie, se la riga non ne ha già uno: stessa regola dell'avviso sopra.
  function adoptDefaultReason(row) {
    const C = window.SN_CONST || {};
    const kind = row.querySelector('.sn-excluded-kind');
    const note = row.querySelector('.sn-excluded-note');
    if (kind.value || note.value.trim() || typeof C.missingExcludedProviders !== 'function') return;
    const name = row.querySelector('.sn-excluded-name').value.trim();
    const d = (C.DEFAULT_EXCLUDED_PROVIDER_REASONS || [])
      .find((r) => !C.missingExcludedProviders([r.name], [name], providerCatalog).length);
    if (!d) return;
    kind.value = d.kind || '';
    note.value = d.note || '';
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
    const C = window.SN_CONST || {};
    const reasons = typeof C.excludedProviderReasons === 'function'
      ? C.excludedProviderReasons(excludedMissingFromBuild(), [], C.DEFAULT_EXCLUDED_PROVIDER_REASONS)
      : excludedMissingFromBuild().map((name) => ({ name }));
    const host = $('excludedList');
    for (const r of reasons) host.appendChild(makeExcludedRow(r.name, r));
    renderExcludedDrift();
  }

  // ── Modelli per azione (stesso editor a segmenti della pagina Opzioni) ───────
  function renderModelsGrid(models) {
    modelChains = ModelChain.renderGrid($('modelsGrid'), {
      models: models || {},
      getRegistry: () => collectModelRegistry(),
    });
    hiddenModels = Object.fromEntries(Object.entries(models || {})
      .filter(([action, chain]) => !(action in modelChains) && typeof chain === 'string'));
  }

  function collectModels() {
    return { ...hiddenModels, ...ModelChain.collect(modelChains) };
  }

  // ── Pagine delicate (#1004) ─────────────────────────────────────────────────
  let delicateCaricate = {};
  let delicateDiSerie = {};
  const righeSiti = (testo) => [...new Set(String(testo || '').split(/[\n,]+/)
    .map((x) => x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, ''))
    .filter(Boolean))];
  function renderDelicate(elenco, diSerie) {
    delicateCaricate = elenco || {};
    delicateDiSerie = diSerie || {};
    const box = $('delicateLists');
    box.textContent = '';
    for (const k of [...new Set([...Object.keys(delicateDiSerie), ...Object.keys(delicateCaricate)])]) {
      const id = `delicate-${k}`;
      const label = document.createElement('label');
      label.htmlFor = id;
      label.style.marginTop = '12px';
      const nome = I18n.t(`admin_defaults_delicate_${k}`);
      label.textContent = nome && !nome.startsWith('admin_defaults_') ? nome : k;
      const ta = document.createElement('textarea');
      ta.id = id;
      ta.dataset.categoria = k;
      ta.rows = 6;
      ta.style.width = '100%';
      ta.value = (delicateCaricate[k] || []).join('\n');
      box.append(label, ta);
    }
  }
  // Le categorie da salvare: tutte quelle che non sono come nel codice. null = niente di cambiato.
  function collectDelicate() {
    const ora = {};
    for (const ta of $('delicateLists').querySelectorAll('textarea[data-categoria]')) ora[ta.dataset.categoria] = righeSiti(ta.value);
    const uguali = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
    if (Object.keys(ora).every((k) => uguali(ora[k], delicateCaricate[k]))) return null;
    const out = {};
    for (const [k, v] of Object.entries(ora)) if (!uguali(v, delicateDiSerie[k])) out[k] = v;
    return out;
  }

  // ── Load / Save ─────────────────────────────────────────────────────────────
  function applyConfig(cfg) {
    const present = cfg.apiKeysPresent || {};
    $('apiKey-state').textContent = `(${keyStateText(present.openrouter)})`;
    $('apiKeyTavily-state').textContent = `(${keyStateText(present.tavily)})`;
    $('apiKeySafebrowse-state').textContent = `(${keyStateText(cfg.safeBrowsingKeyPresent)})`;
    renderModelRegistry(cfg.modelRegistry || {});
    renderModelsGrid(cfg.models || {});
    // Lista EFFETTIVA (codice ⊕ override remoto): è quella che l'app applica, ed
    // è quella che il salvataggio riscrive per intero.
    renderExcluded(cfg.excludedProviders || [], cfg.excludedProviderReasons || []);
    renderDelicate(cfg.sitiDelicati, cfg.sitiDelicatiDiSerie);
    ensureProviderCatalog();
    // Combobox modelli: semina con gli id già nel registry (compaiono subito),
    // poi carica i cataloghi completi in background (non blocca il render).
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
    // Fornitori esclusi: si invia la lista SOLO se l'owner l'ha toccata (anche
    // per svuotarla: [] è un valore, e viaggia). Salvarla a ogni salvataggio
    // congelerebbe nel doc remoto la lista letta dal codice, e da lì in poi
    // un'esclusione aggiunta con un rilascio non arriverebbe più a nessuno.
    const excluded = collectExcluded();
    if (JSON.stringify(excluded) !== JSON.stringify(loadedExcluded)) {
      config.excludedProviders = excluded;
    }
    // I motivi stanno in un campo a parte e non decidono niente: viaggiano se
    // sono cambiati, o insieme ai nomi.
    const reasons = collectExcludedReasons();
    if (config.excludedProviders || JSON.stringify(reasons) !== loadedReasons) {
      config.excludedProviderReasons = reasons;
    }
    const delicate = collectDelicate();
    if (delicate) config.sitiDelicati = delicate;
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
    $('saveBtn').addEventListener('click', save);
  });
})();
