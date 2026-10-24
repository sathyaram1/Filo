// La politica sui modelli come regola: quali modelli girano coi crediti di Filo e quali fornitori li possono servire.
// PURO e autosufficiente (niente require, niente altri SN_*): il server lo incorpora al deploy e ci giudica le sue
// chiamate e il consumo delle chiavi dei crediti (#1520). constants.js lo riespone. Prove: tests/unit/politicaModelli.test.mjs.

(function (global) {
  'use strict';

  // ── Fornitori esclusi ──────────────────────────────────────────────────────
  // Si esclude il PRODUTTORE del modello in quanto fornitore, qualunque modello serva (owner, 06/10/2026): una lista
  // di esclusione regge quando arriva un fornitore indipendente nuovo. Forma BASE del nome («Google» copre «Google
  // Vertex»). Secondo motivo: un host che serve male. Anthropic non c'è: la politica ammette i suoi modelli.
  // L'owner la sostituisce per intero dal doc `config/models` (`excludedProviders`): un nome aggiunto qui va aggiunto
  // anche là. Sentinella sui produttori: tests/unit/produttoriEsclusi.test.mjs.
  const DEFAULT_EXCLUDED_PROVIDERS = [
    'Google',       // produttore di Gemini (copre Google AI Studio / Vertex)
    'OpenAI',
    'xAI',
    'DeepSeek',
    'Mistral',      // copre "Mistral AI"
    'Moonshot AI',
    'MiniMax',
    'Qwen',         // Alibaba/Qwen
    'Alibaba',      // l'host di Alibaba Cloud su OpenRouter: la sola voce "Qwen" lo lasciava passare
    'Cohere',
    'Meta',         // produttore di Llama
    'Z.AI',         // Zhipu / GLM
    'Xiaomi',       // produttore di MiMo
    'NVIDIA',       // produttore di Nemotron
    'Hexgrad',      // produttore di Kokoro
    // Non è un produttore: nel banco di prova del 30/08 ha risposto ad alcune richieste con la risposta di un'ALTRA
    // richiesta in corso. Escluso per tutti i modelli che instrada.
    'Novita',
  ];

  function normalizeProviderName(name) {
    return String(name == null ? '' : name).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Escluso se coincide con una forma base o ne è una variante (base più spazio o
  // separatore): «Google Vertex» cade sotto «Google», «Googleplex-AI» no.
  function isProviderExcluded(served, excluded) {
    return matchesProviderBase(served, excluded);
  }

  function matchesProviderBase(served, bases) {
    const s = normalizeProviderName(served);
    if (!s) return false;
    const list = Array.isArray(bases) ? bases : [];
    return list.some((base) => {
      const b = normalizeProviderName(base);
      if (!b) return false;
      return s === b || s.startsWith(b + ' ') || s.startsWith(b + '/')
        || s.startsWith(b + '-') || s.startsWith(b + ',') || s.startsWith(b + '.');
    });
  }

  // Modelli chiusi che la politica ammette solo comprati dal produttore (#904): il
  // router li fa servire anche da rivenditori (Amazon Bedrock, Azure) che la lista
  // di esclusione non può togliere, perché servono anche modelli a pesi aperti.
  // `only` va a OpenRouter come slug; `hosts` sono i nomi con cui riporta chi ha servito; `nome` è il produttore nelle frasi.
  // Claude Platform on AWS lo gestisce Anthropic (diverso da Bedrock, gestito da AWS).
  const PRODUCER_ONLY_MODELS = [
    { prefix: 'anthropic/', nome: 'Anthropic', only: ['anthropic', 'claude-on-aws'], hosts: ['Anthropic', 'Claude Platform on AWS'] },
  ];

  function producerOnlyRule(modelId) {
    const id = String(modelId == null ? '' : modelId).trim().toLowerCase().replace(/^~/, '');
    if (!id) return null;
    return PRODUCER_ONLY_MODELS.find((r) => id.startsWith(r.prefix)) || null;
  }

  // Perché chi ha servito viola la politica: 'excluded' (è nella lista di
  // esclusione), 'not-producer' (il modello si compra solo dal produttore e
  // l'host non è dei suoi), '' se non la viola o se chi ha servito non si sa. PURA.
  function servedPolicyViolation(servedBy, modelId, excluded) {
    if (!normalizeProviderName(servedBy)) return '';
    if (isProviderExcluded(servedBy, excluded)) return 'excluded';
    const rule = producerOnlyRule(modelId);
    if (rule && !matchesProviderBase(servedBy, [...rule.hosts, ...rule.only])) return 'not-producer';
    return '';
  }

  // I modelli stretti ammessi dalla politica (transparency/models.md, «Ammessi oggi»): pesi chiusi comprati dal
  // produttore, che quindi non va escluso. Una voce qui va anche nel documento (sentinella in openWeightsOnly.test).
  const NARROW_MODEL_PRODUCERS = [{ prefix: 'typesafe/', nome: 'TypeSafe' }];

  // ── Pesi aperti ────────────────────────────────────────────────────────────
  // DIFFIDENTE PER COSTRUZIONE: un modello che non sappiamo classificare vale come proprietario. Ammettere ciò che
  // non riconosciamo trasformerebbe la regola in una promessa a caso.

  // Provider che sono l'API del PRODUTTORE: qualunque cosa servano, i soldi vanno a chi i
  // modelli li fa. Oggi vuota; il meccanismo resta per quando servirà.
  const PRODUCER_DIRECT_PROVIDERS = [];

  // Famiglie a PESI APERTI, lista curabile: un id che non ricade qui è trattato come
  // proprietario. Il confronto è sul nome del modello, non sul percorso del fornitore.
  const OPEN_WEIGHT_MODEL_FAMILIES = [
    'gemma', 'llama', 'qwen', 'deepseek', 'mistral', 'mixtral', 'kimi', 'glm',
    'minimax', 'olmo', 'phi', 'granite', 'nemotron', 'falcon', 'yi', 'command-r',
    'stablelm', 'smollm', 'whisper', 'step', 'kokoro', 'parakeet', 'bge', 'gpt-oss',
    // Coi crediti (#830) un aperto che manca qui viene fermato: le famiglie aperte del catalogo del router.
    'qwq', 'devstral', 'magistral', 'pixtral', 'ministral', 'voxtral', 'hermes', 'deephermes', 'ernie', 'hunyuan',
    'seed-oss', 'longcat', 'jamba', 'lfm2', 'lfm-2', 'intellect', 'ling', 'ring', 'command-a', 'aya', 'trinity',
    'dolphin', 'apriel', 'cogito', 'mimo', 'tongyi', 'ui-tars',
    // Ripiego quando il catalogo del router non si legge (la regola vera è lì, registraCatalogoPesi).
    'wizardlm', 'mythomax', 'l3', 'magnum', 'cydonia', 'rocinante', 'mai-ds', 'tng-r1t', 'deepcoder', 'goliath',
  ];
  // Il catalogo del router dice, per ogni modello a pesi aperti, dove sono pubblicati (`hugging_face_id`): un modello
  // che lo porta è aperto qualunque sia il suo nome; per gli altri restano le famiglie qui sopra (#830). Lo registra
  // chi scarica il catalogo; chi deve decidere prima di spendere può chiederne la lettura (aggiornaCatalogoPesi).
  let catalogoPesiAperti = null;
  let caricatoreCatalogo = null;
  const idDiCatalogo = (id) => String(id == null ? '' : id).trim().toLowerCase().replace(/^~/, '').replace(/:[a-z0-9-]+$/, '');
  function registraCatalogoPesi(voci) {
    const aperti = new Set();
    for (const m of Array.isArray(voci) ? voci : []) {
      const hf = m && typeof m.hugging_face_id === 'string' ? m.hugging_face_id.trim() : '';
      if (hf && m && typeof m.id === 'string') aperti.add(idDiCatalogo(m.id));
    }
    catalogoPesiAperti = aperti;
  }
  function apertoPerCatalogo(id) { return Boolean(catalogoPesiAperti && catalogoPesiAperti.has(idDiCatalogo(id))); }
  function registraCaricatoreCatalogo(fn) { caricatoreCatalogo = typeof fn === 'function' ? fn : null; }
  async function aggiornaCatalogoPesi() {
    if (!caricatoreCatalogo) return false;
    try { await caricatoreCatalogo(); return true; } catch (_) { return false; }
  }

  // Famiglie aperte che vendono anche versioni a pesi CHIUSI, solo via API: una di queste parole nel nome dopo la
  // famiglia la rende chiusa ('qwen3-max', 'mistral-medium-3.1', 'yi-large'). Prove: tests/unit/creditiPolitica.test.mjs.
  const CLOSED_VARIANTS_OF_OPEN_FAMILIES = {
    qwen: ['max', 'plus', 'turbo', 'flash'],
    mistral: ['medium', 'saba'],
    devstral: ['medium'],
    magistral: ['medium'],
    yi: ['large', 'lightning', 'turbo', 'vision'],
    ernie: ['x1', 'turbo'],
    hunyuan: ['t1', 'turbo', 'turbos'],
  };

  // Guarda l'ULTIMO segmento dell'id, il nome vero: il prefisso del fornitore non deve
  // poter far passare per aperto un modello che non lo è.
  function isOpenWeightsModelId(modelId) {
    const raw = String(modelId == null ? '' : modelId).toLowerCase().trim();
    if (!raw) return false;
    if (apertoPerCatalogo(raw)) return true;
    const name = raw.split('/').pop();
    // Il nome può portare la versione attaccata alla famiglia: conta ciò che segue la
    // famiglia, non un separatore fisso.
    return OPEN_WEIGHT_MODEL_FAMILIES.some((fam) => {
      const f = String(fam).toLowerCase();
      if (!name.startsWith(f)) return false;
      const rest = name.slice(f.length);
      if (!(rest === '' || /^[\d\-._:]/.test(rest))) return false;
      const chiuse = CLOSED_VARIANTS_OF_OPEN_FAMILIES[f] || [];
      return !rest.split(/[-._:]/).some((parola) => chiuse.includes(parola));
    });
  }

  // La voce può dichiararlo da sé (`weights`), così l'owner corregge dalla config senza
  // rilasciare codice; in assenza decide il nome. Un provider del produttore mai ammesso.
  function isOpenWeightsEntry(entry) {
    const e = entry || {};
    const provider = e.provider || (e.gemini ? 'gemini' : (e.openrouter ? 'openrouter' : ''));
    if (PRODUCER_DIRECT_PROVIDERS.includes(provider)) return false;
    const declared = String(e.weights == null ? '' : e.weights).toLowerCase().trim();
    if (declared === 'open') return true;
    if (declared === 'proprietary' || declared === 'closed') return false;
    const model = e.model || e.openrouter || e.gemini || '';
    return isOpenWeightsModelId(model);
  }

  // ── Coi crediti di Filo ────────────────────────────────────────────────────
  // Girano solo le tre categorie della politica sui modelli: Anthropic, pesi aperti, modelli stretti ammessi per
  // nome; gli altri solo con la chiave propria (#830). `weights` è quello dichiarato dalla voce del registro, che vince
  // sul nome come per l'interruttore. PURA. Prove: tests/unit/creditiPolitica.test.mjs.
  function creditsAllowModel(modelId, weights) {
    const id = String(modelId == null ? '' : modelId).trim().toLowerCase().replace(/^~/, '');
    if (producerOnlyRule(id)) return true;
    if (NARROW_MODEL_PRODUCERS.some((r) => id.startsWith(r.prefix))) return true;
    return isOpenWeightsEntry({ model: id, weights });
  }
  // Come creditsAllowModel, ma un modello che i nomi non riconoscono lo si cerca anche nel catalogo del router, letto
  // se serve: si paga un'attesa solo sul rifiuto, mai su una richiesta che parte.
  async function creditsAllowModelLetto(modelId, weights) {
    if (creditsAllowModel(modelId, weights)) return true;
    if (!(await aggiornaCatalogoPesi())) return false;
    return creditsAllowModel(modelId, weights);
  }

  // Il giudizio su un uso GIÀ pagato coi crediti, come lo riporta il router (modello e chi l'ha servito): 'model' se
  // il modello è fuori dalle tre categorie, 'excluded' o 'not-producer' se l'ha servito chi la politica non ammette,
  // '' se rientra. È la stessa regola che l'app applica prima della chiamata: il server la usa sul consumo delle
  // chiavi (#1520), dove un uso fuori da Filo non passa da nessun controllo dell'app. PURA.
  function creditsUsageViolation(uso, excluded) {
    const u = uso || {};
    if (!creditsAllowModel(u.model, u.weights)) return 'model';
    return servedPolicyViolation(u.provider, u.model, Array.isArray(excluded) ? excluded : DEFAULT_EXCLUDED_PROVIDERS);
  }

  global.SN_POLITICA_MODELLI = {
    DEFAULT_EXCLUDED_PROVIDERS,
    normalizeProviderName,
    isProviderExcluded,
    matchesProviderBase,
    PRODUCER_ONLY_MODELS,
    producerOnlyRule,
    servedPolicyViolation,
    NARROW_MODEL_PRODUCERS,
    PRODUCER_DIRECT_PROVIDERS,
    OPEN_WEIGHT_MODEL_FAMILIES,
    CLOSED_VARIANTS_OF_OPEN_FAMILIES,
    idDiCatalogo,
    registraCatalogoPesi,
    registraCaricatoreCatalogo,
    aggiornaCatalogoPesi,
    isOpenWeightsModelId,
    isOpenWeightsEntry,
    creditsAllowModel,
    creditsAllowModelLetto,
    creditsUsageViolation,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
