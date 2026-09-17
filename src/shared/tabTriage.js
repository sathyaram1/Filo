// Logica pura del riordino schede (§2.1), fuori da tabs.js per provarla senza Electron.
// Candidabili anche le pagine interne effimere: ignorarle faceva chiudere un sito ma mai
// le home duplicate. I duplicati esatti si trovano senza il giudizio dell'LLM.

(function (global) {
  // Pagine interne effimere: sempre riaperte dall'app, quindi chiudibili senza archiviare.
  // Editor, board, decks e cronologia restano fuori: possono contenere lavoro in corso.
  const EPHEMERAL_INTERNAL_HOSTS = new Set(['newtab', 'options', 'preferences']);

  function internalHostOf(url) {
    const m = /^filo:\/\/([^/?#]+)/i.exec(String(url || ''));
    return m ? m[1].toLowerCase() : '';
  }

  function isEphemeralInternalUrl(url) {
    return EPHEMERAL_INTERNAL_HOSTS.has(internalHostOf(url));
  }

  function isTriageableUrl(url) {
    return /^https?:\/\//i.test(String(url || '')) || isEphemeralInternalUrl(url);
  }

  // Normalizza per il dedup: via fragment e slash finale, schema+host minuscoli.
  // Path e query restano significativi (due ricerche diverse non sono duplicati).
  function normalizeForDedup(url) {
    let u = String(url || '').trim();
    if (!u) return '';
    u = u.replace(/#.*$/, '');
    u = u.replace(/\/+$/, '');
    return u.replace(/^([a-z]+:\/\/[^/]*)/i, (m) => m.toLowerCase());
  }

  // La scheda ATTIVA occupa già il suo URL: tutte le candidate con quell'URL sono duplicati.
  // Per gruppo si tiene la più recente; con un form non inviato non è mai un doppione.
  function findDuplicateIndices(tabs, activeUrl) {
    const list = Array.isArray(tabs) ? tabs : [];
    const seen = new Set();
    const active = normalizeForDedup(activeUrl);
    if (active) seen.add(active);
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
