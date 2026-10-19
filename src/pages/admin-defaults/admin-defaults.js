// Pagina admin «Modelli predefiniti»: la config condivisa che si propaga a tutti via
// Firestore. Il main rifiuta i non-admin, ma la garanzia forte sono le regole Firestore.
// Le chiavi vere non arrivano mai qui: solo booleani `apiKeysPresent`.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const I18n = window.SN_I18N;
  const Storage = window.SN_STORAGE;
  const ModelChain = window.SN_MODEL_CHAIN;

  let modelChains = {};
  // Catene lette che la griglia non mostra: il salvataggio riscrive la mappa intera, e senza
  // queste cancellerebbe la scelta di una funzione spostata in Gestione prima che lì la si salvi (#465).
  let hiddenModels = {};

  // Cataloghi per provider, recuperati dal MAIN con le chiavi predefinite: questa pagina non
  // vede mai le chiavi. `null` = non ancora caricato.
  const providerModelCache = { openrouter: null };

  // Il tetto delle risposte per famiglia di funzioni (#1097.3): famiglia → campo.
  const CAMPI_LUNGHEZZA = [['conversazioni', 'lunghezzaConversazioni'], ['testi', 'lunghezzaTesti'], ['brevi', 'lunghezzaBrevi']];

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
    if (window.SN_COMBOBOX) window.SN_COMBOBOX.opzioniArrivate();
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
    $('h-delicate').textContent = I18n.t('admin_defaults_delicate');
    $('delicate-desc').textContent = I18n.t('admin_defaults_delicate_desc');
    $('h-contesto').textContent = I18n.t('admin_defaults_contesto');
    $('contesto-desc').textContent = I18n.t('admin_defaults_contesto_desc');
    $('l-contesto-giorni').textContent = I18n.t('admin_defaults_contesto_giorni');
    $('l-contesto-token').textContent = I18n.t('admin_defaults_contesto_token');
    $('h-lunghezza').textContent = I18n.t('admin_defaults_lunghezza');
    $('lunghezza-desc').textContent = I18n.t('admin_defaults_lunghezza_desc');
    for (const [f] of CAMPI_LUNGHEZZA) $(`l-lunghezza-${f}`).textContent = I18n.t(`admin_defaults_lunghezza_${f}`);
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

  function ricontrollaAvvisi() {
    if (modelChains) ModelChain.ricontrolla(modelChains);
    // Una riga del registro cambiata o tolta può essere il sostituto aperto di qualche funzione.
    renderOpenWeightsImpact();
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

    // Livello di reasoning per QUESTO modello (#369). Select nativa, come i controlli fratelli.
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
    del.addEventListener('click', () => { row.remove(); ricontrollaAvvisi(); });
    for (const el of [nickIn, idIn]) el.addEventListener('change', ricontrollaAvvisi);

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
      // Testa la riga com'è scritta, anche prima di salvare: il main usa le chiavi predefinite.
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
    // Ogni cambio della lista passa di qui: l'avviso di voce e dettatura nella griglia la segue.
    ricontrollaAvvisi();
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

  // Modelli per azione: stesso editor a segmenti della pagina Opzioni.
  function renderModelsGrid(models) {
    modelChains = ModelChain.renderGrid($('modelsGrid'), {
      models: models || {},
      getRegistry: () => collectModelRegistry(),
      // Qui si decidono anche i fornitori esclusi: l'avviso li legge dalla pagina, non da quelli in vigore.
      avvisoDi: (action, ref) => ModelChain.avvisoHostAudio(action, ref, collectModelRegistry()[ref], collectExcluded()),
      costoDi: costoModello,
      // Mentre si scrive il segmento è a metà: l'avviso segue solo i valori confermati.
      onChange: (scrivendo) => { if (!scrivendo) renderOpenWeightsImpact(); },
    });
    hiddenModels = Object.fromEntries(Object.entries(models || {})
      .filter(([action, chain]) => !(action in modelChains) && typeof chain === 'string'));
    renderOpenWeightsImpact();
  }

  // Il costo di un uso accanto a ogni modello (#819), come nelle Opzioni. Senza avviso: qui si decide il predefinito,
  // che è proprio il metro dell'avviso.
  let stimaCtx = null;
  async function caricaStime() {
    let ctx = null;
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.STIMA_COSTO_MODELLI });
      if (r && r.ok && r.contesto) ctx = r.contesto;
    } catch (_) { ctx = null; }
    stimaCtx = { ...(ctx || { modo: 'crediti', listino: null, registro: {} }), predefiniti: {} };
    if (modelChains) ModelChain.aggiornaCosti(modelChains);
  }
  function costoModello(action, ref) {
    const S = window.SN_STIMA_COSTO;
    if (!S || !ref) return null;
    if (!stimaCtx) return { breve: '…', testo: 'Sto leggendo il listino di OpenRouter.' };
    return S.valuta(action, ref, collectModelRegistry(), stimaCtx);
  }

  function collectModels() {
    return { ...hiddenModels, ...ModelChain.collect(modelChains) };
  }

  // Cosa trova chi accende «Solo modelli a pesi aperti» con la config com'è sulla pagina, non salvata: lo stesso calcolo
  // delle Opzioni sulle sole funzioni della griglia (#465). È un avviso, il salvataggio resta libero (#833).
  function renderOpenWeightsImpact() {
    const host = $('openWeightsImpact');
    const C = window.SN_CONST;
    if (!host) return;
    const models = ModelChain.collect(modelChains);
    // Senza nessun modello scelto non c'è niente da dire: «partono già da modelli aperti» sarebbe falso.
    const conModello = Object.values(models).some((v) => String(v || '').trim());
    if (!C || typeof C.openWeightsImpact !== 'function' || !conModello) { host.hidden = true; return; }
    const impact = C.openWeightsImpact(models, collectModelRegistry());
    const riga = (testo, cls) => {
      const p = document.createElement('p');
      p.textContent = testo;
      if (cls) p.className = cls;
      return p;
    };
    host.replaceChildren();
    if (!impact.unavailable.length && !impact.substituted.length) {
      host.className = 'sn-muted sn-ow-impact';
      host.appendChild(riga(I18n.t('admin_defaults_open_weights_all_open')));
      host.hidden = false;
      return;
    }
    host.className = 'sn-info-box sn-ow-impact';
    const titolo = document.createElement('div');
    titolo.className = 'sn-info-box-title';
    titolo.textContent = I18n.t('admin_defaults_open_weights_title');
    host.appendChild(titolo);
    if (impact.unavailable.length) {
      const nomi = impact.unavailable.map((u) => ModelChain.etichetta(u.action));
      host.appendChild(riga(I18n.t('options_open_weights_unavailable', nomi.join(', ')), 'sn-ow-stop'));
    }
    const perModello = new Map();
    for (const s of impact.substituted) {
      if (!perModello.has(s.to)) perModello.set(s.to, []);
      perModello.get(s.to).push(ModelChain.etichetta(s.action));
    }
    for (const [to, nomi] of perModello) host.appendChild(riga(I18n.t('admin_defaults_open_weights_to', to, nomi.join(', '))));
    if (!impact.unavailable.length) host.appendChild(riga(I18n.t('admin_defaults_open_weights_none_stop')));
    host.hidden = false;
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

  // ── Quanto ricorda la chat (#868) ───────────────────────────────────────────
  let contestoCaricato = {};
  function renderContesto(salvato, diSerie) {
    contestoCaricato = salvato || {};
    for (const [k, id] of [['giorni', 'contestoGiorni'], ['token', 'contestoToken']]) {
      $(id).value = contestoCaricato[k] != null ? String(contestoCaricato[k]) : '';
      $(id).placeholder = diSerie && diSerie[k] != null ? String(diSerie[k]) : '';
    }
  }
  // Un campo vuoto non si salva: segue il codice. null = niente di cambiato.
  function collectContesto() {
    const ora = {};
    for (const [k, id] of [['giorni', 'contestoGiorni'], ['token', 'contestoToken']]) {
      const v = $(id).value.trim();
      if (v !== '' && Number.isFinite(Number(v))) ora[k] = Number(v);
    }
    return JSON.stringify(ora) === JSON.stringify(contestoCaricato) ? null : ora;
  }

  // ── Quanto può essere lunga una risposta (#1097.3) ─────────────────────────
  let lunghezzaCaricata = {};
  function renderLunghezza(salvato, diSerie) {
    lunghezzaCaricata = salvato || {};
    for (const [f, id] of CAMPI_LUNGHEZZA) {
      $(id).value = lunghezzaCaricata[f] != null ? String(lunghezzaCaricata[f]) : '';
      $(id).placeholder = diSerie && diSerie[f] != null ? String(diSerie[f]) : '';
    }
  }
  // Un campo vuoto non si salva: segue il codice. null = niente di cambiato.
  function collectLunghezza() {
    const ora = {};
    for (const [f, id] of CAMPI_LUNGHEZZA) {
      const v = $(id).value.trim();
      if (v !== '' && Number.isFinite(Number(v))) ora[f] = Number(v);
    }
    return JSON.stringify(ora) === JSON.stringify(lunghezzaCaricata) ? null : ora;
  }

  function applyConfig(cfg) {
    const present = cfg.apiKeysPresent || {};
    $('apiKey-state').textContent = `(${keyStateText(present.openrouter)})`;
    $('apiKeyTavily-state').textContent = `(${keyStateText(present.tavily)})`;
    $('apiKeySafebrowse-state').textContent = `(${keyStateText(cfg.safeBrowsingKeyPresent)})`;
    renderModelRegistry(cfg.modelRegistry || {});
    renderModelsGrid(cfg.models || {});
    caricaStime();
    // Lista EFFETTIVA (codice ⊕ override remoto): è quella che l'app applica, ed
    // è quella che il salvataggio riscrive per intero.
    renderExcluded(cfg.excludedProviders || [], cfg.excludedProviderReasons || []);
    renderDelicate(cfg.sitiDelicati, cfg.sitiDelicatiDiSerie);
    renderContesto(cfg.contestoFilo, cfg.contestoFiloDiSerie);
    renderLunghezza(cfg.lunghezzaRisposte, cfg.lunghezzaRisposteDiSerie);
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
    // La lista si invia SOLO se l'owner l'ha toccata, [] compreso: salvarla sempre congelerebbe
    // nel doc quella letta dal codice, e un'esclusione aggiunta con un rilascio non arriverebbe.
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
    const contesto = collectContesto();
    if (contesto) config.contestoFilo = contesto;
    const lunghezza = collectLunghezza();
    if (lunghezza) config.lunghezzaRisposte = lunghezza;
    if (Object.keys(apiKeys).length) config.apiKeys = apiKeys;
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
