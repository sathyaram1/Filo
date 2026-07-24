// Logica pura del riordino schede (§2.1). Sta a parte da tabs.js così è
// testabile senza Electron (vedi tests/unit/tabTriage.test.mjs).
//
// Due responsabilità:
//   1. decidere quali schede sono "candidabili" al riordino — non solo i siti
//      web ma anche le pagine interne EFFIMERE di Filo (la home/nuova scheda e
//      le impostazioni), che prima venivano ignorate del tutto: perciò il
//      riordino chiudeva un sito (es. YouTube) ma mai le impostazioni aperte o
//      le home duplicate;
//   2. individuare in modo DETERMINISTICO i duplicati esatti (stessa pagina
//      aperta più volte) così che le "home duplicate" e i doppioni vengano
//      sempre collassati, senza dipendere dal giudizio dell'LLM.

(function (global) {
  // Pagine interne filo:// che sono "effimere": la home/nuova scheda e le
  // impostazioni. Sono SEMPRE raggiungibili dall'app, quindi durante il riordino
  // possono essere chiuse senza perdere nulla (non serve nemmeno archiviarle).
  // Le altre pagine interne (editor, board, decks, cronologia…) restano fuori:
  // potrebbero contenere lavoro in corso o essere una superficie di lavoro.
  const EPHEMERAL_INTERNAL_HOSTS = new Set(['newtab', 'options', 'preferences']);

  function internalHostOf(url) {
    const m = /^filo:\/\/([^/?#]+)/i.exec(String(url || ''));
    return m ? m[1].toLowerCase() : '';
  }

  function isEphemeralInternalUrl(url) {
    return EPHEMERAL_INTERNAL_HOSTS.has(internalHostOf(url));
  }

  // Candidabile al riordino = sito web (http/https) OPPURE pagina interna
  // effimera (home/impostazioni).
  function isTriageableUrl(url) {
    return /^https?:\/\//i.test(String(url || '')) || isEphemeralInternalUrl(url);
  }

  // Normalizza per il confronto "è la stessa scheda?" (dedup): via il fragment
  // (#...), via lo slash finale, schema+host minuscoli. Path e query restano
  // significativi (due ricerche diverse NON sono duplicati).
  function normalizeForDedup(url) {
    let u = String(url || '').trim();
    if (!u) return '';
    u = u.replace(/#.*$/, '');
    u = u.replace(/\/+$/, '');
    return u.replace(/^([a-z]+:\/\/[^/]*)/i, (m) => m.toLowerCase());
  }

  // Individua i DUPLICATI esatti fra le schede candidate (stesso URL
  // normalizzato). La scheda ATTIVA (`activeUrl`, mai chiusa) "occupa" già il suo
  // URL: perciò tutte le candidate con quell'URL sono duplicati da chiudere.
  // Per ogni gruppo si tiene la scheda con interazione più recente e si marcano
  // le altre. Le schede con un form non inviato (`formDirty`) non sono mai
  // trattate come doppioni usa-e-getta.
  //
  // `tabs`: [{ url, formDirty, lastInteractionAt }]. Ritorna un Set di indici
  // (riferiti all'array `tabs`) da archiviare/chiudere perché duplicati.
  function findDuplicateIndices(tabs, activeUrl) {
    const list = Array.isArray(tabs) ? tabs : [];
    const seen = new Set();
    const active = normalizeForDedup(activeUrl);
    if (active) seen.add(active);
    // Ordina per interazione più recente: teniamo la copia più "fresca" del
    // gruppo e marchiamo le più vecchie.
    const order = list.map((_, i) => i).sort((a, b) => {
      const la = Number(list[a] && list[a].lastInteractionAt) || 0;
      const lb = Number(list[b] && list[b].lastInteractionAt) || 0;
      return lb - la;
    });
    const dup = new Set();
    for (const i of order) {
      const t = list[i] || {};
      if (t.formDirty) continue;
      const key = normalizeForDedup(t.url);
      if (!key) continue;
      if (seen.has(key)) dup.add(i);
      else seen.add(key);
    }
    return dup;
  }

  global.SN_TAB_TRIAGE = {
    isEphemeralInternalUrl,
    isTriageableUrl,
    normalizeForDedup,
    findDuplicateIndices,
    EPHEMERAL_INTERNAL_HOSTS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
