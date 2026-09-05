// Logica pagina opzioni.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const I18n = window.SN_I18N;
  const Storage = window.SN_STORAGE;
  const ModelChain = window.SN_MODEL_CHAIN;
  const Caps = window.SN_MODEL_CAPS;

  // Mappa azione → editor a segmenti della sua catena di modelli (popolata in load()).
  let modelChains = {};

  // Cache delle liste modelli per provider, usate dal combobox della "stringa
  // modello" di ogni riga del registry. Riempite on-demand: al focus del campo,
  // al cambio provider, o col pulsante "Aggiorna lista modelli". `null` = non
  // ancora caricata (provo a caricarla); `[]` = caricata ma vuota/errore.
  const providerModelCache = { openrouter: null };

  function $(id) { return document.getElementById(id); }

  // Id della datalist (combobox) associata a un provider.
  function datalistIdFor(provider) {
    return `models-list-${provider}`;
  }

  // Sorgente delle opzioni per il dropdown custom del campo "stringa modello":
  // le <datalist> per-provider (popolate da populateDatalist) restano l'unica
  // sorgente di verità, il combobox le legge senza duplicarle. value = id del
  // modello, label = categoria (Testo / Immagini / …).
  function readProviderOptions(provider) {
    const dl = $(datalistIdFor(provider));
    if (!dl) return [];
    return Array.from(dl.options).map((o) => ({
      value: o.value,
      label: o.label && o.label !== o.value ? o.label : '',
    }));
  }

  function fillStaticText() {
    document.title = I18n.t('options_title');
    $('title').textContent = I18n.t('options_title');
    $('useDefaultModels-label').textContent = I18n.t('options_use_default_models');
    $('useDefaultModels-desc').textContent = I18n.t('options_use_default_models_desc');
    $('openWeightsOnly-label').textContent = I18n.t('options_open_weights_only');
    $('openWeightsOnly-desc').textContent = I18n.t('options_open_weights_only_desc');
    $('h-provider').textContent = I18n.t('options_keys');
    $('h-models').textContent = I18n.t('options_models');
    $('h-costs').textContent = I18n.t('options_costs');
    document.querySelector('label[for="apiKey"]').textContent = I18n.t('options_api_key');

    $('lbl-limit').textContent = I18n.t('options_monthly_limit');
    $('lbl-spent').textContent = I18n.t('options_current_spent');

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

  // Elenco (sola lettura) degli ALTRI punti in cui Filo usa un modello: quelli
  // che girano sui suoi server (li imposta chi gestisce Filo) e quelli che un
  // modello non lo usano affatto. Le funzioni impostabili da qui sono già la
  // griglia qui sopra — ripeterle renderebbe la pagina più piena, non più
  // chiara. Sorgente: il censimento condiviso, lo stesso da cui esce la griglia.
  function renderModelUsage() {
    const host = $('modelUsageList');
    const Usage = window.SN_MODEL_USAGE;
    if (!host) return;
    host.innerHTML = '';
    if (!Usage || typeof Usage.byArea !== 'function') return;

    for (const group of Usage.byArea()) {
      const rows = group.entries.filter((e) => e.from !== 'user');
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

  // Quando "usa modelli predefiniti" è ON, nasconde le sezioni di config
  // avanzata (provider/chiavi, registry, modelli per azione): l'utente usa i
  // default condivisi senza dover toccare nulla. OFF = mostra tutto.
  // Mostra/nasconde anche la lista read-only dei modelli predefiniti.
  function applyDefaultModelsVisibility() {
    const useDefault = $('useDefaultModels').checked;
    for (const el of document.querySelectorAll('.sn-advanced-models')) {
      el.hidden = useDefault;
    }
    $('defaultModelsList').hidden = !useDefault;
  }

  // ── "Solo modelli a pesi aperti": cosa cambia davvero ─────────────────────
  // Un interruttore che promette e basta non si può verificare. Appena acceso
  // qui sotto compare quante funzioni cambiano modello (e su quali finiscono) e
  // QUALI si fermano perché un equivalente a pesi aperti non esiste — spegnerlo
  // rimette tutto com'era, quindi la conseguenza si legge sul posto invece di
  // scoprirla usando l'app.
  // Sorgente: la configurazione che l'app userà DAVVERO (quella condivisa se
  // "usa modelli predefiniti" è attivo, la personale altrimenti).

  // Ultima configurazione predefinita letta dal main ({ models, modelRegistry }).
  let defaultModelsPublic = null;

  function effectiveModelConfig() {
    if ($('useDefaultModels').checked) {
      return defaultModelsPublic || { models: {}, modelRegistry: {} };
    }
    return {
      models: ModelChain.collect(modelChains || {}),
      modelRegistry: collectModelRegistry().registry,
    };
  }

  function actionLabelFor(action) {
    const row = (ModelChain.actionLabels() || []).find(([a]) => a === action);
    return row ? I18n.t(row[1]) : action;
  }

  // Un "Prova" è una richiesta vera al modello della riga. Con l'interruttore
  // acceso quelli proprietari restano spenti: il main li rifiuta comunque, ma un
  // bottone premibile che poi dice di no è attrito inutile — e su questa pagina
  // sarebbe pure il bottone che sembra scavalcare l'interruttore acceso due
  // centimetri più su.
  function markTestBlocked(btn, blocked) {
    if (!btn) return;
    btn.disabled = blocked;
    if (blocked) btn.title = I18n.t('options_open_weights_test_blocked');
    else btn.removeAttribute('title');
  }

  // `entry` è la voce intera quando c'è (la lista dei predefiniti la conosce),
  // altrimenti fornitore + stringa del modello: è tutto ciò che una riga scritta
  // a mano contiene. Stessa classificazione del main, così il bottone spento e
  // la richiesta rifiutata dicono la stessa cosa.
  function openWeightsBlocks(entry) {
    if (!$('openWeightsOnly').checked) return false;
    const C = window.SN_CONST;
    if (!C || typeof C.openWeightsBlockKind !== 'function') return false;
    return C.openWeightsBlockKind(true, entry) !== '';
  }

  // Tutti i pulsanti "Prova" della pagina, in un posto solo: le chiavi dei
  // fornitori, le righe dei modelli predefiniti e le righe del registry
  // personale. Sono cammini diversi verso la stessa cosa (una chiamata al
  // modello), quindi la regola dev'essere una sola.
  // Stato dell'interruttore all'ultimo giro, per riconoscere la transizione
  // acceso→spento (vedi in fondo a applyOpenWeightsTestGates).
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

    // Spegnendo l'interruttore il catalogo che era stato saltato torna a
    // caricarsi da solo: se accenderlo lo ferma, spegnerlo deve rimetterlo, o
    // resterebbe muto fino a un ricaricamento della pagina. Solo sulla
    // TRANSIZIONE acceso→spento: questa funzione gira a ogni `change` della
    // pagina, e un catalogo che non risponde verrebbe richiesto all'infinito.
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
      // Le funzioni che cambiano modello sono decine: elencarle una per una
      // sarebbe un muro di testo che nessuno legge. Quello che serve sapere è
      // quante sono e su quali modelli finiscono; l'elenco per funzione è già
      // la griglia dei modelli qui sotto.
      const modelli = [...new Set(impact.substituted.map((s) => s.to))];
      lines.push(I18n.t('options_open_weights_switched', String(impact.substituted.length), modelli.join(', ')));
    }
    if (impact.unavailable.length) {
      const names = impact.unavailable.map((u) => actionLabelFor(u.action));
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

  // ── Lista read-only dei modelli predefiniti con tasto "Prova" ─────────────
  // Quando useDefaultModels è ON, mostra i modelli del registry predefinito
  // (costanti o override Firestore) con un pulsante "Prova" che testa il
  // modello usando le chiavi effettive (le predefinite, non quelle dell'utente).

  async function loadDefaultModels() {
    let registry = {};
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.DEFAULT_MODELS_PUBLIC });
      if (r && r.ok && r.modelRegistry) {
        registry = r.modelRegistry;
        defaultModelsPublic = { models: r.models || {}, modelRegistry: registry };
      }
    } catch (_) {}
    renderDefaultModels(registry);
    // L'effetto dell'interruttore si calcola sulla config VERA: ora che è
    // arrivata, ricalcolalo.
    renderOpenWeightsImpact();
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
    // La voce INTERA sulla riga (non solo fornitore e stringa): il cancello dei
    // "Prova" la classifica come fa il main, dove una `weights` scritta a mano
    // dall'owner conta.
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
    return row;
  }

  async function runDefaultModelTest(nickname, row, btn) {
    const statusEl = row.querySelector('.sn-model-row-status');
    statusEl.textContent = I18n.t('options_test_running');
    btn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({
        type: MSG.TEST_DEFAULT_MODEL,
        nickname,
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
      // Il cancello dei pesi aperti ha l'ultima parola: riabilitare alla cieca
      // rimetterebbe premibile un "Prova" che la politica tiene spento.
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
    // Lista read-only dei modelli predefiniti. Deve mostrare i modelli che l'app
    // userà DAVVERO: li chiediamo al main (config condivisa + eventuali
    // modifiche dell'owner). Se la richiesta non riesce la lista resta vuota
    // invece di mostrare i modelli scritti nel codice: un elenco inventato è
    // peggio di nessun elenco, perché non corrisponde a ciò che gira.
    applyDefaultModelsVisibility();
    loadDefaultModels();
    $('apiKey').value = settings.apiKeys?.openrouter || '';
    $('apiKeyTavily').value = settings.apiKeys?.tavily || '';
    $('monthlyLimit').value = settings.monthlyLimitEur ?? 5;

    // Registry modelli PRIMA dell'editor a segmenti: le righe del registry sono
    // la sorgente dei nickname, e l'editor le legge già al primo render per
    // segnalare i modelli citati ma inesistenti. Renderizzarlo dopo avrebbe
    // fatto apparire l'avviso su TUTTI i segmenti (registry ancora vuoto).
    // Popola anche la datalist dei nickname usata dai segmenti.
    renderModelRegistry(settings.modelRegistry || {});

    // Editor a segmenti "Modelli per azione": una catena di fallback per azione.
    modelChains = ModelChain.renderGrid($('modelsGrid'), {
      models: settings.models || {},
      onChange: saveDebounced,
      // Registry LIVE (dalle righe correnti, anche non salvate) così la
      // validazione modello↔funzione riflette subito le modifiche.
      getRegistry: () => collectModelRegistry().registry,
    });

    // Costi
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.GET_COSTS });
      const eur = r?.monthly?.totalEur || 0;
      $('spentBox').textContent = `€${eur.toFixed(4)}`;
    } catch (_) {}

    // Combobox modelli: prima semina con gli id già nel registry (così il valore
    // corrente compare subito), poi prova a caricare il catalogo completo di
    // ciascun provider in background (non blocca il render).
    seedDatalistsFromRegistry(settings.modelRegistry || {});
    ensureProviderModels('openrouter');

    // Con la config personale l'effetto è calcolabile subito (griglia e registry
    // sono già renderizzati); con quella condivisa lo ricalcola loadDefaultModels
    // appena il main risponde.
    renderOpenWeightsImpact();
  }

  // Normalizza una entry del registry (nuovo schema o vecchio duale) in
  // { provider, model }. Per le vecchie entry duali sceglie un solo provider
  // (OpenRouter): al primo salvataggio diventerà
  // single-provider e l'utente potrà aggiungere il gemello sull'altro provider
  // come riga separata se vuole il fallback.
  function entryToSingle(entry) {
    const e = entry || {};
    if (e.provider && e.model) return { provider: e.provider, model: e.model };
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
    // La voce intera resta appesa alla riga: ciò che la riga non modifica
    // (pesi aperti, cosa sa masticare, esito della prova) sopravvive al salvataggio.
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

    // Stringa concreta per chiamare il modello presso il provider scelto.
    // Il campo è un combobox custom (stile Filo, non il popup nativo della
    // datalist): elenca i modelli del provider scelto, si filtra digitando, e
    // resta libero di accettare un id non in lista. Il wrapper è position:relative
    // perché il popup .sn-select-pop si ancora lì sotto.
    const idWrap = document.createElement('div');
    idWrap.className = 'sn-model-id-wrap';
    const idIn = document.createElement('input');
    idIn.type = 'text';
    idIn.placeholder = I18n.t('options_model_id');
    idIn.setAttribute('autocomplete', 'off');
    idIn.value = single.model;
    idIn.className = 'sn-model-id';
    idWrap.appendChild(idIn);
    // Carica la lista del provider la prima volta che l'utente apre il campo.
    idIn.addEventListener('focus', () => ensureProviderModels(provSel.value));
    if (window.SN_COMBOBOX) {
      window.SN_COMBOBOX.attach(idWrap, idIn, {
        readOptions: () => readProviderOptions(provSel.value),
        onPick: () => save(),
      });
    }

    // Cambiando provider, il combobox legge l'altra lista (e la carica).
    provSel.addEventListener('change', () => {
      ensureProviderModels(provSel.value);
    });

    const status = document.createElement('div');
    status.className = 'sn-model-row-status';

    // Messaggio non bloccante per righe scartate dal salvataggio (nickname
    // mancante o duplicato, #216): a tutta larghezza sotto la riga, popolato/
    // svuotato da markRegistryRowIssues() dopo ogni save().
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

    // Ordine richiesto: nickname · provider · stringa · Rimuovi · Prova, con i
    // dati del test (latenza/token-sec) nella riga a tutta larghezza sotto.
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
      // Editor vuoto: una riga vuota per iniziare.
      host.appendChild(makeModelRow('', {}));
    } else {
      for (const [nick, e] of entries) {
        host.appendChild(makeModelRow(nick, e));
      }
    }
    populateNicknames(registry);
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
      // E ciò che la riga non modifica ma la voce dichiara (pesi aperti,
      // cosa sa masticare): senza, un salvataggio dalle Opzioni lo perderebbe.
      for (const k of ['weights', 'inputs', 'outputs']) {
        if (row._entry && row._entry[k] != null) entry[k] = row._entry[k];
      }
      out[nick] = entry;
    }
    return { registry: out, dups, missingNick, missingNickRows, dupRows };
  }

  // Evidenzia (bordo + messaggio inline sotto la riga, niente alert bloccante)
  // le righe scartate dall'ultimo save(); ripulisce tutte le altre.
  function markRegistryRowIssues(missingNickRows, dupRows) {
    const host = $('modelRegistryList');
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
    const apiKey = providerKey(providerId);
    if (!apiKey) { statusEl.textContent = I18n.t('options_test_no_key'); return; }
    statusEl.textContent = `${providerId} · ${modelId} — ${I18n.t('options_test_running')}`;
    btn.disabled = true;
    try {
      // L'id del registry va passato così com'è: stesso percorso dell'uso reale.
      const res = await chrome.runtime.sendMessage({
        type: MSG.TEST_PROVIDER,
        provider: providerId,
        apiKey,
        model: modelId,
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
      // Il cancello dei pesi aperti ha l'ultima parola: riabilitare alla cieca
      // rimetterebbe premibile un "Prova" che la politica tiene spento.
      applyOpenWeightsTestGates();
    }
  }

  // Popola la datalist di un provider. `items` può essere una lista di stringhe
  // (solo id) o di { id, meta } (meta = oggetto grezzo dell'API, per categoria e
  // data). I modelli sono ordinati col più recente in cima ed etichettati per
  // categoria (Testo / Sintesi vocale / Immagini / Embedding…) via option.label.
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
  }

  // Semina i combobox con gli id già presenti nel registry (divisi per provider)
  // così, anche prima di interrogare l'API, il valore corrente di ogni riga
  // compare nella tendina. L'eventuale fetch successivo lo rimpiazza col catalogo
  // completo del provider.
  function seedDatalistsFromRegistry(registry) {
    const byProv = { openrouter: [] };
    for (const nick of Object.keys(registry || {})) {
      const s = entryToSingle(registry[nick]);
      if (s.model && byProv[s.provider]) byProv[s.provider].push(s.model);
    }
    populateDatalist('openrouter', byProv.openrouter);
  }

  // Il catalogo OpenRouter è PUBBLICO: la chiave non serve per elencarlo (è
  // solo metadati, niente inferenza → gratis). La passiamo se c'è, ma funziona
  // anche senza, così le categorie sono precise da subito.
  // Il catalogo "semplice" del router elenca solo i modelli di testo: voce,
  // dettatura e indicizzazione stanno in liste a parte, per modalità. Si
  // chiedono tutte, così la tendina ha anche quei mestieri con le etichette giuste.
  const OR_CATALOG_QUERIES = ['', '?output_modalities=speech', '?output_modalities=transcription', '?output_modalities=embeddings'];
  async function fetchOpenRouterModels(key) {
    const headers = key ? { Authorization: `Bearer ${key}` } : {};
    const lists = await Promise.all(OR_CATALOG_QUERIES.map(async (q) => {
      const res = await fetch('https://openrouter.ai/api/v1/models' + q, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return (data.data || []).map((m) => ({ id: m.id, meta: m })).filter((it) => it.id);
    }));
    return lists.flat();
  }

  // Gli id del registro che il catalogo non conosce (modelli nuovi, o scritti a
  // mano) restano nella tendina: toglierli farebbe sparire dalla lista proprio
  // il modello che la riga usa.
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

  // Il catalogo è "solo metadati", ma resta una richiesta MANDATA al fornitore
  // con la tua chiave — e questa pagina la faceva da sola al caricamento. Con
  // «Solo modelli a pesi aperti» acceso l'API diretta di chi produce i modelli
  // era l'ultima cosa che partiva verso un escluso da qui: sta spenta come il
  // suo «Prova», altrimenti la pagina dove si accende l'interruttore sarebbe
  // anche l'unica che continua a parlarci.
  function catalogBlocked(provider) {
    if (!$('openWeightsOnly').checked) return false;
    const C = window.SN_CONST;
    const diretti = (C && C.PRODUCER_DIRECT_PROVIDERS) || [];
    return diretti.includes(provider);
  }

  // Carica (una sola volta) il catalogo di un provider nel suo combobox, così
  // ogni modello è subito etichettato per categoria. È solo metadati (gratis):
  //  - OpenRouter: catalogo pubblico → si carica SEMPRE, anche senza chiave.
  // Silenzioso: in caso di errore il campo resta un input libero.
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

  async function save() {
    const apiKey = $('apiKey').value.trim();
    const apiKeyTavily = $('apiKeyTavily').value.trim();

    // Auto-save: persistiamo solo le righe valide. Le righe incomplete
    // (nickname mancante) o duplicate vengono ignorate finché non sono
    // complete — niente alert bloccanti che interromperebbero la digitazione,
    // dato che non c'è più un pulsante "Salva" esplicito. Vengono però
    // evidenziate sul posto e la conferma sotto NON dice più "Salvato" senza
    // qualificarlo, altrimenti l'utente crede (a torto, #216) che sia stato
    // salvato tutto.
    const { registry, missingNickRows, dupRows } = collectModelRegistry();

    const partial = {
      useDefaultModels: $('useDefaultModels').checked,
      openWeightsOnly: $('openWeightsOnly').checked,
      apiKeys: { openrouter: apiKey, tavily: apiKeyTavily },
      modelRegistry: registry,
      models: ModelChain.collect(modelChains),
      monthlyLimitEur: parseFloat($('monthlyLimit').value) || 0,
    };

    await chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: partial });

    // Aggiorna la datalist dei nickname (per-action) col registry appena salvato.
    populateNicknames(registry);
    markRegistryRowIssues(missingNickRows, dupRows);

    const hasDiscarded = (missingNickRows && missingNickRows.length) || (dupRows && dupRows.length);
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
      // Il cancello dei pesi aperti ha l'ultima parola: riabilitare alla cieca
      // rimetterebbe premibile un "Prova" che la politica tiene spento.
      applyOpenWeightsTestGates();
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
    // Qualunque cosa cambi (interruttore, modelli per azione, registry) può
    // cambiare l'effetto di "solo pesi aperti": lo ricalcoliamo sempre.
    $('page').addEventListener('change', renderOpenWeightsImpact);
    $('useDefaultModels').addEventListener('change', applyDefaultModelsVisibility);
    $('loadModels').addEventListener('click', loadModelsFromProvider);
    $('testOpenrouter').addEventListener('click', () => testProvider('openrouter', $('testOpenrouterStatus'), $('testOpenrouter')));
    $('addModelRow').addEventListener('click', () => {
      $('modelRegistryList').appendChild(makeModelRow('', {}));
      // Riga nuova = "Prova" nuovo: passa dallo stesso cancello degli altri.
      applyOpenWeightsTestGates();
    });
    // L'input dentro le righe del registry e i segmenti dei modelli (creati
    // dinamicamente) fanno bubbling del `change` fino a #page → già coperti.
  });
})();
