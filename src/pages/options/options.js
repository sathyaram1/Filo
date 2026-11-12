// Logica pagina opzioni.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const I18n = window.SN_I18N;
  const Storage = window.SN_STORAGE;
  const ModelChain = window.SN_MODEL_CHAIN;
  const Caps = window.SN_MODEL_CAPS;
  const staUsandoAdesso = (el) => {
    const B = window.SN_PAGE_BOOTSTRAP;
    return !!(B && B.staUsandoAdesso && B.staUsandoAdesso(el));
  };

  let modelChains = {};

  // Cache delle liste modelli per provider, riempita on-demand (focus, cambio provider,
  // «Aggiorna lista»). `null` = non ancora caricata; `[]` = caricata ma vuota o in errore.
  const providerModelCache = { openrouter: null };

  function $(id) { return document.getElementById(id); }

  function datalistIdFor(provider) {
    return `models-list-${provider}`;
  }

  // Le <datalist> per-provider sono l'unica sorgente di verità: value = id, label = categoria.
  function readProviderOptions(provider) {
    const dl = $(datalistIdFor(provider));
    if (!dl) return [];
    return Array.from(dl.options).map((o) => ({
      value: o.value,
      label: o.label && o.label !== o.value ? o.label : '',
    }));
  }

  // L'interruttore della chiave propria (#962) segue la chiave SALVATA, da qui o da Crediti: senza non ha effetto.
  function mostraChiavePropria(settings) {
    $('sec-own-key-providers').hidden = !window.SN_CONST.hasOwnOpenrouterKey(settings);
  }

  function fillStaticText() {
    document.title = I18n.t('options_title');
    $('title').textContent = I18n.t('options_title');
    $('useDefaultModels-label').textContent = I18n.t('options_use_default_models');
    $('useDefaultModels-desc').textContent = I18n.t('options_use_default_models_desc');
    $('openWeightsOnly-label').textContent = I18n.t('options_open_weights_only');
    $('openWeightsOnly-desc').textContent = I18n.t('options_open_weights_only_desc');
    $('ownKeyAllProviders-label').textContent = I18n.t('options_own_key_all_providers');
    $('ownKeyAllProviders-desc').textContent = I18n.t('options_own_key_all_providers_desc');
    $('ordineHost-label').textContent = I18n.t('options_host_order');
    $('ordineHost-desc').textContent = I18n.t('options_host_order_desc');
    riempiOrdineHost();
    $('h-provider').textContent = I18n.t('options_keys');
    $('h-models').textContent = I18n.t('options_models');
    $('h-costs').textContent = I18n.t('options_costs');
    document.querySelector('label[for="apiKey"]').textContent = I18n.t('options_api_key');

    $('lbl-limit').textContent = I18n.t('options_monthly_limit');
    $('lbl-spent').textContent = I18n.t('options_current_spent');
    $('lbl-cost-warn').textContent = I18n.t('options_cost_warn_ratio');

    $('savedHint').textContent = I18n.t('options_saved');

    $('testOpenrouter').textContent = I18n.t('options_test_provider');

    $('h-model-registry').textContent = I18n.t('options_h_model_registry');
    $('model-registry-desc').textContent = I18n.t('options_model_registry_desc');
    $('models-desc').textContent = I18n.t('options_models_desc');
    $('addModelRow').textContent = I18n.t('options_model_add');
    $('h-model-usage').textContent = I18n.t('options_h_model_usage');
    $('model-usage-desc').textContent = I18n.t('options_model_usage_desc');
    renderModelUsage();
  }

  // Gli ALTRI punti in cui Filo usa un modello, in sola lettura: le funzioni impostabili da qui
  // sono già la griglia sopra. Fonte: il censimento condiviso.
  function renderModelUsage() {
    const host = $('modelUsageList');
    const Usage = window.SN_MODEL_USAGE;
    if (!host) return;
    host.innerHTML = '';
    if (!Usage || typeof Usage.byArea !== 'function') return;

    for (const group of Usage.byArea()) {
      // Una funzione che usa solo chi gestisce Filo (`action`) qui è rumore (#465).
      const rows = group.entries.filter((e) => e.from !== 'user' && !e.action);
      if (!rows.length) continue;

      const head = document.createElement('div');
      head.className = 'sn-usage-area';
      head.textContent = group.area;
      host.appendChild(head);

      for (const e of rows) {
        const row = document.createElement('div');
        row.className = 'sn-usage-row';

        const name = document.createElement('span');
        name.textContent = e.label;
        row.appendChild(name);

        const where = document.createElement('span');
        where.className = 'sn-usage-where';
        where.textContent = e.from === 'owner'
          ? I18n.t('options_model_usage_owner')
          : I18n.t('options_model_usage_none');
        row.appendChild(where);

        if (e.note) {
          const note = document.createElement('span');
          note.className = 'sn-usage-note';
          note.textContent = e.note;
          row.appendChild(note);
        }
        host.appendChild(row);
      }
    }
  }

  function applyDefaultModelsVisibility() {
    const useDefault = $('useDefaultModels').checked;
    for (const el of document.querySelectorAll('.sn-advanced-models')) {
      el.hidden = useDefault;
    }
    $('defaultModelsList').hidden = !useDefault;
  }

  // Un interruttore che promette e basta non si può verificare: acceso, qui sotto compare
  // quante funzioni cambiano modello, su quali finiscono e quali si fermano.

  // Ultima configurazione predefinita letta dal main ({ models, modelRegistry }).
  let defaultModelsPublic = null;

  function effectiveModelConfig() {
    if ($('useDefaultModels').checked) {
      const cfg = defaultModelsPublic || { models: {}, modelRegistry: {} };
      // La config condivisa può portare ancora funzioni che qui non ci sono più (#465).
      const qui = new Set((ModelChain.actionLabels() || []).map(([a]) => a));
      return { ...cfg, models: Object.fromEntries(Object.entries(cfg.models || {}).filter(([a]) => qui.has(a))) };
    }
    return {
      models: ModelChain.collect(modelChains || {}),
      modelRegistry: collectModelRegistry().registry,
    };
  }

  // Un "Prova" è una richiesta vera al modello della riga. Con l'interruttore
  // acceso quelli proprietari restano spenti: il main li rifiuta comunque, ma un
  // bottone premibile che poi dice di no è attrito inutile — e su questa pagina
  // sarebbe pure il bottone che sembra scavalcare l'interruttore acceso due
  // centimetri più su.
  function markTestBlocked(btn, blocked) {
    if (!btn) return;
    // Una prova in corso resta spenta: il cancello gira a ogni modifica della pagina e la riaccendeva a metà.
    btn.disabled = blocked || btn.dataset.inCorso === '1';
    if (blocked) btn.title = I18n.t('options_open_weights_test_blocked');
    else btn.removeAttribute('title');
  }

  // `entry` è la voce intera quando c'è, altrimenti fornitore più stringa: tutto ciò che una
  // riga scritta a mano contiene. Stessa classificazione del main, o i due direbbero cose diverse.
  function openWeightsBlocks(entry) {
    if (!$('openWeightsOnly').checked) return false;
    const C = window.SN_CONST;
    if (!C || typeof C.openWeightsBlockKind !== 'function') return false;
    return C.openWeightsBlockKind(true, entry) !== '';
  }

  // Tutti i «Prova» della pagina in un posto solo: sono cammini diversi verso la stessa
  // chiamata, quindi la regola dev'essere una sola.
  let openWeightsWasOn = null;

  function applyOpenWeightsTestGates() {
    const on = $('openWeightsOnly').checked;
    // Prova della chiave: il router prova un modello ammesso, quindi resta vivo.
    for (const row of $('defaultModelsList').querySelectorAll('.sn-default-model-row')) {
      const btn = row.querySelector('.sn-model-test');
      if (!btn) continue;
      markTestBlocked(btn, openWeightsBlocks(row._entry || {}));
    }
    for (const row of $('modelRegistryList').querySelectorAll('.sn-model-row:not(.sn-model-row-head)')) {
      const btn = row.querySelector('.sn-model-test');
      const prov = row.querySelector('.sn-model-provider');
      const id = row.querySelector('.sn-model-id');
      if (!btn || !prov || !id) continue;
      markTestBlocked(btn, openWeightsBlocks({ provider: prov.value, model: id.value.trim() }));
    }

    // Spegnendo l'interruttore il catalogo saltato torna a caricarsi da solo, o resterebbe muto
    // fino a un ricaricamento. Solo sulla TRANSIZIONE, o verrebbe richiesto all'infinito.
    const eraAcceso = openWeightsWasOn;
    openWeightsWasOn = on;
    if (eraAcceso === true && !on) ensureProviderModels('openrouter');
  }

  function renderOpenWeightsImpact() {
    const host = $('openWeightsImpact');
    if (!host) return;
    applyOpenWeightsTestGates();

    host.innerHTML = '';
    if (!$('openWeightsOnly').checked) { host.hidden = true; return; }

    const C = window.SN_CONST;
    const { models, modelRegistry } = effectiveModelConfig();
    if (!C || typeof C.openWeightsImpact !== 'function' || !Object.keys(models || {}).length) {
      host.hidden = true;
      return;
    }
    const impact = C.openWeightsImpact(models, modelRegistry);
    const lines = [];
    if (impact.substituted.length) {
      // Le funzioni sono decine: serve quante sono e su quali finiscono, l'elenco per funzione è
      // già la griglia qui sotto.
      const modelli = [...new Set(impact.substituted.map((s) => s.to))];
      lines.push(I18n.t('options_open_weights_switched', String(impact.substituted.length), modelli.join(', ')));
    }
    if (impact.unavailable.length) {
      const names = impact.unavailable.map((u) => ModelChain.etichetta(u.action));
      lines.push(I18n.t('options_open_weights_unavailable', names.join(', ')));
    }
    if (!lines.length) { host.hidden = true; return; }

    for (const line of lines) {
      const p = document.createElement('p');
      p.textContent = line;
      host.appendChild(p);
    }
    host.hidden = false;
  }

  // Lista read-only dei predefiniti quando useDefaultModels è ON: il «Prova» testa il modello
  // con le chiavi effettive, quelle predefinite e non quelle dell'utente.

  // Le misure dei modelli predefiniti si salvano da sole: la lista è in sola
  // lettura e non passa dal salvataggio della pagina, che le azzererebbe quando
  // la lista non è renderizzata.
  let defaultModelTests = {};

  async function saveDefaultModelTest(nickname, esito) {
    defaultModelTests = { ...defaultModelTests, [nickname]: esito };
    try {
      await chrome.runtime.sendMessage({
        type: MSG.UPDATE_SETTINGS,
        settings: { defaultModelTests },
      });
    } catch (_) {}
  }

  async function loadDefaultModels() {
    let registry = {};
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.DEFAULT_MODELS_PUBLIC });
      if (r && r.ok && r.modelRegistry) {
        registry = r.modelRegistry;
        defaultModelsPublic = { models: r.models || {}, modelRegistry: registry };
        sceltaGeneraleHost = r.providerSort || '';
      }
    } catch (_) {}
    renderDefaultModels(registry);
    // L'effetto si calcola sulla config VERA: ora che è arrivata, ricalcolalo.
    renderOpenWeightsImpact();
    // La scelta generale è arrivata adesso: le righe disegnate prima hanno
    // giudicato la loro misura senza sapere a cosa rimandava «Automatico».
    rinfrescaMisure();
  }

  // «Lo sceglie Filo» al posto di «Automatico»: qui non c'è una scelta generale più in alto a cui rimandare.
  function riempiOrdineHost() {
    const sel = $('ordineHost');
    sel.innerHTML = '';
    for (const val of window.SN_CONST.PROVIDER_SORTS) {
      const opt = document.createElement('option');
      opt.value = val === 'auto' ? '' : val;
      opt.textContent = I18n.t(val === 'auto' ? 'options_host_order_filo' : 'provider_sort_' + val);
      sel.appendChild(opt);
    }
  }

  // Una riga chiama con l'ordinamento suo, o con quello generale se resta su
  // «Automatico»: è quello a cui una misura deve corrispondere per valere.
  let sceltaGeneraleHost = '';

  function rinfrescaMisure() {
    for (const row of document.querySelectorAll('.sn-model-row')) {
      if (row.querySelector('.sn-model-row-status')) renderRowTest(row);
    }
  }

  function renderDefaultModels(registry) {
    const host = $('defaultModelsList');
    host.innerHTML = '';
    const entries = Object.entries(registry || {});
    if (!entries.length) return;

    const head = document.createElement('div');
    head.className = 'sn-model-row sn-model-row-head sn-default-model-row';
    [
      I18n.t('options_model_nickname'),
      I18n.t('options_model_provider'),
      I18n.t('options_model_id'),
      '',
    ].forEach((label) => {
      const c = document.createElement('div'); c.textContent = label; head.appendChild(c);
    });
    host.appendChild(head);

    for (const [nick, entry] of entries) {
      host.appendChild(makeDefaultModelRow(nick, entry));
    }
  }

  function makeDefaultModelRow(nick, entry) {
    const row = document.createElement('div');
    row.className = 'sn-model-row sn-default-model-row';
    const single = entryToSingle(entry);
    // La voce INTERA sulla riga, non solo fornitore e stringa: il cancello dei «Prova» la
    // classifica come fa il main, dove una `weights` scritta a mano dall'owner conta.
    row._entry = { ...(entry || {}), provider: single.provider, model: single.model };

    const nickEl = document.createElement('div');
    nickEl.className = 'sn-default-model-cell';
    nickEl.textContent = nick;

    const provEl = document.createElement('div');
    provEl.className = 'sn-default-model-cell sn-muted';
    provEl.textContent = 'OpenRouter';

    const modelEl = document.createElement('div');
    modelEl.className = 'sn-default-model-cell sn-muted';
    modelEl.textContent = single.model;

    const testBtn = document.createElement('button');
    testBtn.type = 'button';
    testBtn.className = 'sn-btn sn-btn-secondary sn-model-test';
    testBtn.textContent = I18n.t('options_model_test');
    testBtn.addEventListener('click', () => runDefaultModelTest(nick, row, testBtn));

    const status = document.createElement('div');
    status.className = 'sn-model-row-status';

    row.appendChild(nickEl);
    row.appendChild(provEl);
    row.appendChild(modelEl);
    row.appendChild(testBtn);
    row.appendChild(status);
    row._test = defaultModelTests[nick] || null;
    renderRowTest(row);
    return row;
  }

  async function runDefaultModelTest(nickname, row, btn) {
    const statusEl = row.querySelector('.sn-model-row-status');
    statusEl.textContent = I18n.t('options_test_running');
    btn.disabled = true;
    btn.dataset.inCorso = '1';
    // Fissata al clic e mandata con la richiesta: la tendina cambiata mentre la prova gira non si prende i suoi numeri.
    const conf = configurazioneRiga(row);
    try {
      const res = await chrome.runtime.sendMessage({
        type: MSG.TEST_DEFAULT_MODEL,
        nickname,
        sort: conf.sort || '',
      });
      if (!res?.ok) {
        statusEl.textContent = I18n.t('options_test_failed', res?.error || '—');
      } else {
        row._test = {
          ttftMs: res.ttftMs ?? null,
          tokensPerSec: res.tokensPerSec ?? null,
          at: new Date().toISOString(),
          ...conf,
        };
        renderRowTest(row);
        saveDefaultModelTest(nickname, row._test);
      }
    } catch (e) {
      statusEl.textContent = I18n.t('options_test_failed', e?.message || String(e));
    } finally {
      delete btn.dataset.inCorso;
      btn.disabled = false;
      applyOpenWeightsTestGates();
    }
  }

  async function load() {
    fillStaticText();

    const settings = await Storage.getSettings();
    window.SN_PAGE_THEME = settings.theme;
    window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);

    $('useDefaultModels').checked = settings.useDefaultModels !== false;
    $('openWeightsOnly').checked = settings.openWeightsOnly === true;
    $('ownKeyAllProviders').checked = settings.ownKeyAllProviders === true;
    mostraChiavePropria(settings);
    $('ordineHost').value = window.SN_CONST.normalizeProviderSort(settings.ordineHost) || '';
    // Lista read-only dei modelli predefiniti. Deve mostrare i modelli che l'app
    // userà DAVVERO: li chiediamo al main (config condivisa + eventuali
    // modifiche dell'owner). Se la richiesta non riesce la lista resta vuota
    // invece di mostrare i modelli scritti nel codice: un elenco inventato è
    // peggio di nessun elenco, perché non corrisponde a ciò che gira.
    applyDefaultModelsVisibility();
    defaultModelTests = settings.defaultModelTests || {};
    loadDefaultModels();
    $('apiKey').value = settings.apiKeys?.openrouter || '';
    $('apiKeyTavily').value = settings.apiKeys?.tavily || '';
    $('monthlyLimit').value = settings.monthlyLimitEur ?? 5;
    $('costWarnRatio').value = String(window.SN_STIMA_COSTO.soglia(settings));
    chiaveDelleStime = settings.apiKeys?.openrouter || '';
    caricaStime();

    // Registry PRIMA dell'editor a segmenti: le righe sono la sorgente dei nickname, e senza
    // l'avviso «modello inesistente» apparirebbe su TUTTI i segmenti.
    renderModelRegistry(settings.modelRegistry || {});

    modelChains = ModelChain.renderGrid($('modelsGrid'), {
      models: settings.models || {},
      // Mentre si scrive in un segmento basta l'`input` che sale alla pagina; una scelta dalla tendina, un segmento
      // aggiunto o tolto e un valore confermato o respinto partono subito.
      onChange: (scrivendo) => { if (!scrivendo) { caselle.cambiato('pagina'); caselle.subito(true); } },
      // Registry LIVE (dalle righe correnti, anche non salvate) così la
      // validazione modello↔funzione riflette subito le modifiche.
      getRegistry: () => collectModelRegistry().registry,
      avvisoDi: avvisoModello,
      costoDi: costoModello,
    });

    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.GET_COSTS });
      const eur = r?.monthly?.totalEur || 0;
      $('spentBox').textContent = `€${eur.toFixed(4)}`;
    } catch (_) {}

    // Il valore corrente compare subito; i cataloghi completi arrivano in background.
    seedDatalistsFromRegistry(settings.modelRegistry || {});
    ensureProviderModels('openrouter');

    // Con la config condivisa l'effetto lo ricalcola loadDefaultModels quando il main risponde.
    renderOpenWeightsImpact();
  }

  // Entry duali: si tiene un solo provider e al primo salvataggio diventano single-provider;
  // il gemello si aggiunge come riga separata se serve il fallback.
  function entryToSingle(entry) {
    const e = entry || {};
    if (e.provider && e.model) return { provider: e.provider, model: e.model };
    if (e.openrouter) return { provider: 'openrouter', model: e.openrouter };
    return { provider: 'openrouter', model: '' };
  }

  // Normalizza i risultati di test (flat o per-provider) in flat, col provider attivo.
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

  function formatTestResult(t) {
    if (!t) return '';
    const ttft = t.ttftMs != null ? t.ttftMs : '—';
    const tps = t.tokensPerSec != null ? t.tokensPerSec : '—';
    return I18n.t('options_test_result', ttft, tps);
  }

  // Con che modello, ragionamento e ordinamento degli host la riga chiamerebbe
  // adesso: è la configurazione a cui una misura deve corrispondere per valere.
  // La scelta personale vince sull'ordinamento delle voci predefinite, non su quello che l'utente dà alle sue.
  function sortDellaRiga(row, entrySort) {
    const C = window.SN_CONST;
    const personale = $('ordineHost') ? $('ordineHost').value : '';
    return row.classList.contains('sn-default-model-row')
      ? C.ordinamentoPerUtente(personale, entrySort, sceltaGeneraleHost)
      : C.ordinamentoEffettivo(entrySort, C.normalizeProviderSort(personale) || sceltaGeneraleHost);
  }

  function configurazioneRiga(row) {
    const campo = row.querySelector('.sn-model-id');
    const e = row._entry || {};
    return {
      model: campo ? campo.value.trim() : (e.model || ''),
      reasoning: e.reasoning,
      sort: sortDellaRiga(row, e.sort),
    };
  }

  // Giorno della misura, ma solo se non è oggi: numeri di settimane fa messi
  // accanto a quelli appena presi si leggerebbero allo stesso modo.
  function giornoMisura(at) {
    const d = at ? new Date(at) : null;
    if (!d || Number.isNaN(d.getTime())) return '';
    if (d.toDateString() === new Date().toDateString()) return '';
    return ` · ${d.toLocaleDateString()}`;
  }

  // Mostra nel div di stato della riga il risultato di test memorizzato
  // (latenza + token/sec), così la misura resta visibile tra le sessioni.
  function renderRowTest(row) {
    const statusEl = row.querySelector('.sn-model-row-status');
    if (!statusEl) return;
    const vale = window.SN_CONST.misuraValePer(row._test, configurazioneRiga(row));
    statusEl.textContent = vale
      ? formatTestResult(row._test) + giornoMisura(row._test.at)
      : I18n.t('options_model_untested');
  }

  function makeModelRow(nick, entry) {
    const row = document.createElement('div');
    row.className = 'sn-model-row';
    row.dataset.originalNick = nick || '';
    const single = entryToSingle(entry);
    // L'etichetta non ha una colonna, ma serve come hint nella datalist: si preserva.
    row.dataset.label = (entry && entry.label) || '';
    // Ciò che la riga non modifica sopravvive al salvataggio: la voce intera resta appesa.
    row._entry = { ...(entry || {}) };
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
    [['openrouter', 'OpenRouter']].forEach(([val, label]) => {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = label;
      provSel.appendChild(opt);
    });
    provSel.value = single.provider;

    // Combobox custom (non il popup nativo): filtra digitando e accetta un id fuori lista.
    // Il wrapper è position:relative perché .sn-select-pop si ancora lì.
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
    // Riscritto il modello, la misura di prima non riguarda più questa riga:
    // sparisce mentre si scrive, non al ricaricamento.
    idIn.addEventListener('input', () => renderRowTest(row));
    if (window.SN_COMBOBOX) {
      window.SN_COMBOBOX.attach(idWrap, idIn, {
        readOptions: () => readProviderOptions(provSel.value),
        onPick: () => save(),
      });
    }

    provSel.addEventListener('change', () => {
      ensureProviderModels(provSel.value);
    });

    const status = document.createElement('div');
    status.className = 'sn-model-row-status';

    // Righe scartate dal salvataggio (nickname mancante o duplicato, #216): messaggio non
    // bloccante, popolato da markRegistryRowIssues() dopo ogni save().
    const msg = document.createElement('div');
    msg.className = 'sn-model-row-msg';

    const test = document.createElement('button');
    test.type = 'button';
    test.className = 'sn-btn sn-btn-secondary sn-model-test';
    test.textContent = I18n.t('options_model_test');
    test.addEventListener('click', () => runRowTest(provSel.value, idIn.value.trim(), row, test));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sn-btn sn-btn-secondary';
    del.textContent = I18n.t('options_model_remove');
    del.addEventListener('click', () => { row.remove(); save(); });

    row.appendChild(nickIn);
    row.appendChild(provSel);
    row.appendChild(idWrap);
    row.appendChild(del);
    row.appendChild(test);
    row.appendChild(status);
    row.appendChild(msg);
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
      host.appendChild(makeModelRow('', {}));
    } else {
      for (const [nick, e] of entries) {
        host.appendChild(makeModelRow(nick, e));
      }
    }
    populateNicknames(registry);
  }

  function avvisoModello(action, ref) {
    return ModelChain.avvisoHostAudio(action, ref, collectModelRegistry().registry[ref]);
  }

  // ── Il costo accanto a ogni modello e nella tendina (#819) ─────────────────
  // Listino, saldo, tariffa e token medi li dà il main; la stima è quella di SN_STIMA_COSTO, la stessa della chat.
  // Registro e soglia si leggono dalla pagina, così una riga appena scritta ha già il suo costo.
  let stimaCtx = null;
  let stimaGiro = 0;
  let chiaveDelleStime = null;
  async function caricaStime(opts) {
    const mio = ++stimaGiro;
    if (!stimaCtx && modelChains) ModelChain.aggiornaCosti(modelChains);
    let ctx = null;
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.STIMA_COSTO_MODELLI, forzaListino: Boolean(opts && opts.forza) });
      if (r && r.ok && r.contesto) ctx = r.contesto;
    } catch (_) { ctx = null; }
    if (mio !== stimaGiro) return;
    // Il main non ha risposto: niente stima inventata, le righe lo dicono.
    stimaCtx = ctx || { modo: 'crediti', listino: null, registro: {}, predefiniti: {}, saldo: null };
    if (modelChains) ModelChain.aggiornaCosti(modelChains);
  }
  function sogliaDellaPagina() {
    const v = $('costWarnRatio').value.trim();
    return window.SN_STIMA_COSTO.soglia({ costoModelli: { soglia: v === '' ? undefined : Number(v) } });
  }
  function costoModello(action, ref) {
    const S = window.SN_STIMA_COSTO;
    if (!S || !ref) return null;
    if (!stimaCtx) return { breve: '…', testo: 'Sto leggendo il listino di OpenRouter.' };
    return S.valuta(action, ref, collectModelRegistry().registry, { ...stimaCtx, soglia: sogliaDellaPagina() });
  }

  // Oltre al registry valido, ritorna le righe DOM scartate (nickname mancante
  // o duplicato di una riga precedente) così save() può segnalarle sul posto
  // invece di ignorarle in silenzio dietro un "Salvato" che non le riguarda
  // (#216: l'utente perdeva la riga senza nessun avviso).
  function collectModelRegistry() {
    const host = $('modelRegistryList');
    const out = {};
    const dups = [];
    const missingNickRows = [];
    const dupRows = [];
    let missingNick = false;
    for (const row of host.querySelectorAll('.sn-model-row:not(.sn-model-row-head)')) {
      const nick = row.querySelector('.sn-model-nick').value.trim();
      const provider = row.querySelector('.sn-model-provider').value;
      const model = row.querySelector('.sn-model-id').value.trim();
      const label = (row.dataset.label || '').trim();
      if (!nick && !model) continue;
      if (!nick) { missingNick = true; missingNickRows.push(row); continue; }
      if (out[nick]) { dups.push(nick); dupRows.push({ row, nick }); continue; }
      const entry = { provider, model };
      if (label) entry.label = label;
      // Preserva il risultato di test misurato (latenza/token-sec) tra i salvataggi.
      if (row._test && Object.keys(row._test).length) entry.test = row._test;
      // E ciò che la riga non modifica: ordinamento e ragionamento sempre, ciò che la voce dichiara del modello (pesi
      // aperti, cosa sa masticare) solo se il modello è ancora quello.
      for (const k of ['reasoning', 'sort']) {
        if (row._entry && row._entry[k] != null) entry[k] = row._entry[k];
      }
      Object.assign(entry, window.SN_CONST.dichiarazioniPerModello(row._entry, model));
      out[nick] = entry;
    }
    return { registry: out, dups, missingNick, missingNickRows, dupRows };
  }

  // Evidenzia (bordo + messaggio inline sotto la riga, niente alert bloccante)
  // le righe scartate dall'ultimo save(); ripulisce tutte le altre. Con
  // `soloTogliere` (mentre si scrive) una riga corretta si ripulisce ma una
  // nuova non si accende: a metà, una riga senza nickname è solo incompleta.
  function markRegistryRowIssues(missingNickRows, dupRows, soloTogliere) {
    const host = $('modelRegistryList');
    const gia = soloTogliere ? new Set(host.querySelectorAll('.sn-model-row.sn-row-invalid')) : null;
    if (gia) {
      missingNickRows = (missingNickRows || []).filter((row) => gia.has(row));
      dupRows = (dupRows || []).filter((d) => gia.has(d.row));
    }
    for (const row of host.querySelectorAll('.sn-model-row:not(.sn-model-row-head)')) {
      row.classList.remove('sn-row-invalid');
      row.querySelector('.sn-model-nick').classList.remove('sn-input-invalid');
      const msg = row.querySelector('.sn-model-row-msg');
      if (msg) msg.textContent = '';
    }
    for (const row of missingNickRows || []) {
      row.classList.add('sn-row-invalid');
      row.querySelector('.sn-model-nick').classList.add('sn-input-invalid');
      const msg = row.querySelector('.sn-model-row-msg');
      if (msg) msg.textContent = I18n.t('options_model_nickname_required');
    }
    for (const { row, nick } of dupRows || []) {
      row.classList.add('sn-row-invalid');
      row.querySelector('.sn-model-nick').classList.add('sn-input-invalid');
      const msg = row.querySelector('.sn-model-row-msg');
      if (msg) msg.textContent = I18n.t('options_model_nickname_duplicate', nick);
    }
  }

  async function runRowTest(providerId, modelId, row, btn) {
    const statusEl = row.querySelector('.sn-model-row-status');
    if (!modelId) {
      statusEl.textContent = I18n.t('options_model_no_id');
      return;
    }
    // Senza una chiave scritta qui la prova usa quella con cui la funzione pagherebbe, i crediti di Filo (#830).
    const apiKey = providerKey(providerId);
    statusEl.textContent = `${providerId} · ${modelId} — ${I18n.t('options_test_running')}`;
    btn.disabled = true;
    btn.dataset.inCorso = '1';
    // Come per le righe predefinite: la prova chiama, e la misura si attribuisce, con la configurazione del clic.
    const conf = configurazioneRiga(row);
    try {
      // L'id del registry va passato così com'è: stesso percorso dell'uso reale.
      const res = await chrome.runtime.sendMessage({
        type: MSG.TEST_PROVIDER,
        provider: providerId,
        apiKey,
        ...(apiKey ? {} : { chiaveDellUso: true }),
        model: modelId,
        sort: conf.sort || '',
        reasoning: conf.reasoning || '',
      });
      if (!res?.ok && res?.code === 'NO_API_KEY') {
        statusEl.textContent = I18n.t('options_test_no_key');
      } else if (!res?.ok) {
        statusEl.textContent = `${providerId} · ${modelId} — ${I18n.t('options_test_failed', res?.error || '—')}`;
      } else {
        // Salva il risultato (latenza + token/sec) nella riga e persistilo nel
        // registry, così resta visibile e confrontabile tra le sessioni.
        // Con la misura si scrive su COSA è stata presa: senza, cambiando
        // modello quei numeri resterebbero a parlare di un altro.
        row._test = {
          ttftMs: res.ttftMs ?? null,
          tokensPerSec: res.tokensPerSec ?? null,
          at: new Date().toISOString(),
          ...conf,
        };
        renderRowTest(row);
        save();
      }
    } catch (e) {
      statusEl.textContent = I18n.t('options_test_failed', e?.message || String(e));
    } finally {
      delete btn.dataset.inCorso;
      btn.disabled = false;
      applyOpenWeightsTestGates();
    }
  }

  // `items`: lista di id o di { id, meta } (meta = oggetto grezzo dell'API), già ordinati col
  // più recente in cima ed etichettati per categoria.
  function populateDatalist(provider, items) {
    const dl = $(datalistIdFor(provider));
    if (!dl) return;
    const norm = (items || [])
      .map((it) => (typeof it === 'string' ? { id: it } : it))
      .filter((it) => it && it.id)
      .map((it) => ({ id: it.id, provider, meta: it.meta }));
    const sorted = Caps ? Caps.sortByRecency(norm) : norm;
    dl.innerHTML = '';
    const seen = new Set();
    for (const it of sorted) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      const opt = document.createElement('option');
      opt.value = it.id;
      if (Caps) opt.label = Caps.categoryLabel(provider, it.id, it.meta);
      dl.appendChild(opt);
    }
    if (window.SN_COMBOBOX) window.SN_COMBOBOX.opzioniArrivate();
  }

  // Il valore corrente compare anche prima di interrogare l'API; il fetch lo rimpiazza.
  function seedDatalistsFromRegistry(registry) {
    const byProv = { openrouter: [] };
    for (const nick of Object.keys(registry || {})) {
      const s = entryToSingle(registry[nick]);
      if (s.model && byProv[s.provider]) byProv[s.provider].push(s.model);
    }
    populateDatalist('openrouter', byProv.openrouter);
  }

  // Il catalogo OpenRouter è PUBBLICO: la chiave non serve (metadati, niente inferenza). Il
  // catalogo «semplice» elenca i soli modelli di testo: le altre modalità si chiedono a parte.
  const OR_CATALOG_QUERIES = ['', '?output_modalities=speech', '?output_modalities=transcription', '?output_modalities=embeddings'];
  async function fetchOpenRouterModels(key) {
    const headers = key ? { Authorization: `Bearer ${key}` } : {};
    const lists = await Promise.all(OR_CATALOG_QUERIES.map(async (q) => {
      const res = await fetch('https://openrouter.ai/api/v1/models' + q, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return (data.data || []).map((m) => ({ id: m.id, meta: m })).filter((it) => it.id);
    }));
    // Gli avvisi di questa pagina riconoscono i pesi aperti come il main, che legge lo stesso catalogo.
    try { window.SN_CONST.registraCatalogoPesi(lists.flat().map((it) => it.meta)); } catch (_) {}
    return lists.flat();
  }

  // Gli id che il catalogo non conosce restano in tendina: toglierli farebbe sparire quello
  // in uso.
  function withRegistryIds(provider, catalog) {
    const known = new Set(catalog.map((it) => it.id));
    const extra = [];
    try {
      const reg = collectModelRegistry().registry || {};
      for (const nick of Object.keys(reg)) {
        const s = entryToSingle(reg[nick]);
        if (s.provider === provider && s.model && !known.has(s.model)) {
          known.add(s.model);
          extra.push(s.model);
        }
      }
    } catch (_) {}
    return catalog.concat(extra);
  }

  function providerKey(provider) {
    return provider === 'openrouter' ? $('apiKey').value.trim() : '';
  }

  // Il catalogo è «solo metadati», ma resta una richiesta mandata al fornitore con la tua
  // chiave: con «Solo modelli a pesi aperti» acceso sta spenta come il suo «Prova».
  function catalogBlocked(provider) {
    if (!$('openWeightsOnly').checked) return false;
    const C = window.SN_CONST;
    const diretti = (C && C.PRODUCER_DIRECT_PROVIDERS) || [];
    return diretti.includes(provider);
  }

  // Una volta sola, e senza chiave per OpenRouter; in errore il campo resta un input libero.
  async function ensureProviderModels(provider) {
    if (providerModelCache[provider]) return;
    if (catalogBlocked(provider)) return;
    if (provider !== 'openrouter') return;
    const key = providerKey(provider);
    try {
      const ids = await fetchOpenRouterModels(key);
      providerModelCache[provider] = ids;
      populateDatalist(provider, withRegistryIds(provider, ids));
    } catch (_) { /* lista non disponibile: il campo resta libero */ }
  }

  // Ricarica (forzando) il catalogo dei modelli. È pubblico → si ricarica sempre.
  async function loadModelsFromProvider() {
    $('modelsStatus').textContent = '…';
    const orKey = $('apiKey').value.trim();
    const errors = [];
    let total = 0;
    {
      try {
        const ids = await fetchOpenRouterModels(orKey);
        providerModelCache.openrouter = ids;
        populateDatalist('openrouter', withRegistryIds('openrouter', ids));
        total += ids.length;
      } catch (e) { errors.push(`OpenRouter: ${e.message || e}`); }
    }
    $('modelsStatus').textContent = errors.length ? errors.join(' · ') : `${total} modelli`;
  }

  // Con `avvisi: false` (mentre si scrive) le righe scartate non si dicono ancora.
  async function save(opts) {
    const biglietto = caselle.spedita('pagina');
    const avvisi = !(opts && opts.avvisi === false);
    const apiKey = $('apiKey').value.trim();
    const apiKeyTavily = $('apiKeyTavily').value.trim();

    // Si salvano le sole righe valide: le incomplete restano ignorate — niente alert mentre si
    // digita — ma evidenziate, e la conferma non dice «Salvato» secco.
    const { registry, missingNickRows, dupRows } = collectModelRegistry();

    const partial = {
      useDefaultModels: $('useDefaultModels').checked,
      openWeightsOnly: $('openWeightsOnly').checked,
      ownKeyAllProviders: $('ownKeyAllProviders').checked,
      ordineHost: $('ordineHost').value,
      apiKeys: { openrouter: apiKey, tavily: apiKeyTavily },
      modelRegistry: registry,
      models: ModelChain.collect(modelChains),
      monthlyLimitEur: parseFloat($('monthlyLimit').value) || 0,
    };
    // Una soglia scritta a metà o storta non si salva: resta quella di prima.
    const soglia = $('costWarnRatio').value.trim();
    if (soglia !== '' && Number.isFinite(Number(soglia)) && Number(soglia) >= 0) {
      partial.costoModelli = { soglia: window.SN_STIMA_COSTO.soglia({ costoModelli: { soglia: Number(soglia) } }) };
    }

    await chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: partial });
    // La chiave messa o tolta qui decide crediti o dollari accanto ai modelli.
    if (apiKey !== chiaveDelleStime) { chiaveDelleStime = apiKey; caricaStime(); }

    populateNicknames(registry);
    markRegistryRowIssues(missingNickRows, dupRows, !avvisi);

    // Arrivata un'altra modifica mentre questa viaggiava, la conferma la scrive il salvataggio che chiude la fila.
    if (!caselle.aggiornata('pagina', biglietto)) return;

    const hasDiscarded = (missingNickRows && missingNickRows.length) || (dupRows && dupRows.length);
    if (hasDiscarded && !avvisi) return;
    const hint = $('savedHint');
    hint.textContent = hasDiscarded ? I18n.t('options_model_row_not_saved') : I18n.t('options_saved');
    hint.classList.toggle('sn-hint-warn', !!hasDiscarded);
    hint.classList.add('sn-show');
    setTimeout(() => hint.classList.remove('sn-show'), hasDiscarded ? 3000 : 1500);
  }

  async function testProvider(providerId, statusEl, btn) {
    const apiKey = providerKey(providerId);
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
      applyOpenWeightsTestGates();
    }
  }

  // Chiavi, limite di spesa, righe del registro e modelli per azione non hanno un «Salva», e chiudere o cambiare
  // scheda non avvisa la pagina (#590.5): tutto parte da qui. Uscendo si accendono gli avvisi sulle righe scartate.
  const caselle = window.SN_CASELLE.crea({
    uscita() {
      if (modelChains) ModelChain.conferma(modelChains);
      const { missingNickRows, dupRows } = collectModelRegistry();
      markRegistryRowIssues(missingNickRows, dupRows);
    },
    spegni: () => $('savedHint').classList.remove('sn-show'),
  });
  caselle.registra('pagina', (avvisi) => save({ avvisi }));
  const CASELLA = /^(text|password|number|search|url|email)$/;

  // La chiave OpenRouter si mette e si toglie anche dalla pagina Crediti
  // (#629), e questa pagina risalva TUTTO il modulo a ogni modifica: con la
  // fotografia di quando è stata aperta, un cambio qualunque qui riportava la
  // chiave a com'era prima (o la cancellava, se all'apertura non c'era). Al
  // cambio arrivato da fuori il campo si riallinea, a meno che l'utente ci
  // stia scrivendo dentro proprio adesso.
  // Lo stesso per gli altri campi semplici, che la chat cambia a parole (#949): le voci le dà la fonte unica.
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      // Il saldo è cambiato (una chiamata, la quota del giorno): i messaggi che bastano si ricontano.
      if (msg && msg.type === MSG.CREDITS_CHANGED) { caricaStime(); return; }
      if (!msg || msg.type !== MSG.SETTINGS_UPDATED || !msg.settings) return;
      const toccati = window.SN_VOCI_IMPOSTAZIONI.riallineaPagina('options', msg.settings, {
        salta: (id, percorso, el) => staUsandoAdesso(el),
      });
      if (toccati.includes('useDefaultModels')) applyDefaultModelsVisibility();
      mostraChiavePropria(msg.settings);
      if (toccati.length) renderOpenWeightsImpact();
      // Una chiave messa o tolta cambia crediti e dollari; la soglia cambia gli avvisi.
      if (toccati.includes('apiKey') || toccati.includes('useDefaultModels')) caricaStime();
      else if (toccati.includes('costWarnRatio')) ModelChain.aggiornaCosti(modelChains || {});
      if (toccati.includes('ordineHost')) rinfrescaMisure();
      // Il modello di un'azione si sceglie anche dal tasto destro di una pagina (la dettatura): senza riallineare
      // la griglia il salvataggio dopo lo rimanderebbe indietro. Si riscrive solo la catena cambiata, e non quella
      // in cui si sta scrivendo: ridisegnare tutto portava via la spiegazione del modello appena respinto (#667.7).
      const s = msg.settings;
      const inUso = staUsandoAdesso(document.activeElement) ? document.activeElement : null;
      const catena = (v) => String(v == null ? '' : v).split(',').map((x) => x.trim()).filter(Boolean).join(', ');
      for (const [azione, ch] of Object.entries(modelChains || {})) {
        const daFuori = s.models && !(inUso && ch.el.contains(inUso)) && catena(ch.getValue()) !== catena(s.models[azione]);
        // Il modello di una riga del registro può cambiare sotto lo stesso nome: l'avviso si rifà anche così.
        if (daFuori) ch.imposta(s.models[azione]); else ch.ricontrolla();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    // Niente pulsante "Salva": un `change` (interruttore, tendina, campo lasciato) parte subito. Qui ogni casella a
    // metà ha effetto (il tetto «1» scrivendo «15» ferma le richieste, una chiave tronca viene rifiutata, un modello
    // che non esiste fallisce), quindi aspetta la pausa lunga; incollare parte subito.
    $('page').addEventListener('input', (e) => {
      const t = e.target;
      if (!t || !(t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && CASELLA.test(t.type)))) return;
      caselle.cambiato('pagina', e, { pausa: window.SN_CASELLE.PAUSA_LUNGA_MS });
      // L'avviso di una riga del registro si toglie mentre la si corregge; uno nuovo aspetta l'uscita.
      if (t.closest('.sn-model-row.sn-row-invalid')) {
        const { missingNickRows, dupRows } = collectModelRegistry();
        markRegistryRowIssues(missingNickRows, dupRows, true);
      }
    });
    // L'editor dei modelli per azione dice da sé quando un segmento è confermato.
    $('page').addEventListener('change', (e) => {
      if (e.target && e.target.closest && e.target.closest('.sn-chain')) return;
      caselle.cambiato('pagina');
      caselle.subito(true);
    });
    // Qualunque cosa cambi (interruttore, modelli per azione, registry) può
    // cambiare l'effetto di "solo pesi aperti": lo ricalcoliamo sempre.
    $('page').addEventListener('change', renderOpenWeightsImpact);
    $('useDefaultModels').addEventListener('change', applyDefaultModelsVisibility);
    // Le misure prese con un altro ordinamento non parlano più di come chiamerebbero le righe.
    $('ordineHost').addEventListener('change', rinfrescaMisure);
    $('loadModels').addEventListener('click', () => { loadModelsFromProvider(); caricaStime({ forza: true }); });
    $('costWarnRatio').addEventListener('input', () => ModelChain.aggiornaCosti(modelChains || {}));
    $('testOpenrouter').addEventListener('click', () => testProvider('openrouter', $('testOpenrouterStatus'), $('testOpenrouter')));
    $('addModelRow').addEventListener('click', () => {
      $('modelRegistryList').appendChild(makeModelRow('', {}));
      // Riga nuova = "Prova" nuovo: passa dallo stesso cancello degli altri.
      applyOpenWeightsTestGates();
    });
    // Gli input creati dinamicamente fanno bubbling del `change` fino a #page: già coperti.
  });
})();
