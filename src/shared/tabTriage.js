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

  // «Tieni sempre aperto X» (#823): la voce è un host, e copre anche i suoi sottodomini. Il sito registrabile
  // sarebbe troppo largo: «tieni aperto Google Docs» non deve tenere aperte anche le ricerche su google.com.
  // Un nome senza punto è una macchina (localhost, il NAS dell'ufficio) solo detto come indirizzo, con schema o
  // porta: «whatsapp» da solo è un nome di servizio, e salvarlo non terrebbe aperto niente.
  function hostTenuto(v) {
    let s = String(v == null ? '' : v).trim().toLowerCase();
    if (!s) return '';
    const conSchema = /^[a-z][a-z0-9+.-]*:\/\//.test(s);
    if (!conSchema) s = `https://${s}`;
    let host;
    let porta;
    try {
      const u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      host = u.hostname;
      porta = u.port;
    } catch (_) { return ''; }
    host = host.replace(/\.$/, '').replace(/^www\./, '');
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || /^\[[0-9a-f:.]+\]$/.test(host)) return host;
    return /^[a-z0-9-]+$/.test(host) && (host === 'localhost' || conSchema || porta) ? host : '';
  }

  function copreHost(voce, host) {
    return !!voce && !!host && (host === voce || host.endsWith(`.${voce}`));
  }

  // La voce salvata che tiene aperta `url`, o null.
  function voceTenuta(url, voci) {
    if (!/^https?:\/\//i.test(String(url || ''))) return null;
    const host = hostTenuto(url);
    let presa = null;
    for (const v of (Array.isArray(voci) ? voci : [])) {
      if (copreHost(v, host) && (!presa || v.length > presa.length)) presa = v;
    }
    return presa;
  }

  // Le voci che «non tenere più aperto X» toglie: quelle che coprono X e quelle che X copre
  // (salvato web.whatsapp.com, l'utente dice whatsapp.com).
  function vociDaTogliere(input, voci) {
    const host = hostTenuto(input);
    if (!host) return [];
    return (Array.isArray(voci) ? voci : []).filter((v) => copreHost(v, host) || copreHost(host, v));
  }

  // L'avviso dopo un giro di pulizia, o '' se non se ne mostra. Alla riapertura c'è sempre (#349): senza, «ho
  // guardato e tenuto tutto» e «non sono partito» si confondevano. Negli altri giri solo se si è chiuso qualcosa.
  function testoEsito({ trigger = '', archiviate = 0, riordinate = false, giudizioMancato = false, valutate = 0 } = {}) {
    const n = Math.max(0, Number(archiviate) || 0);
    const riapertura = trigger === 'reopen';
    if (!n && !(riapertura && (valutate > 0 || riordinate))) return '';
    if (n) {
      const chiuse = giudizioMancato
        ? `${n} ${n === 1 ? 'doppione chiuso' : 'doppioni chiusi'}`
        : `${n} ${n === 1 ? 'chiusa' : 'chiuse'}`;
      const coda = giudizioMancato ? '. Le altre non sono riuscito a valutarle' : '';
      return `Schede riordinate: ${chiuse}, restano nel filo della home${coda}`;
    }
    if (giudizioMancato) {
      return riordinate
        ? 'Schede riordinate, ma non sono riuscito a valutare quali chiudere'
        : 'Non sono riuscito a valutare quali schede chiudere';
    }
    return riordinate ? 'Schede riordinate, nessuna da chiudere' : 'Schede già in ordine, nessuna da chiudere';
  }

  global.SN_TAB_TRIAGE = {
    isEphemeralInternalUrl,
    isTriageableUrl,
    normalizeForDedup,
    findDuplicateIndices,
    EPHEMERAL_INTERNAL_HOSTS,
    hostTenuto,
    voceTenuta,
    vociDaTogliere,
    testoEsito,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
