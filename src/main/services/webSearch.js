// Web search per la sidebar Aiuto: Tavily come primario, fallback sullo scraping di
// duckduckgo.com/html — gratis ma fragile, si rompe se DDG cambia il markup.
// Non lancia mai: in caso di errore ritorna { ok:false, results:[], reason }.

(function (global) {
  'use strict';

  const TAVILY_URL = 'https://api.tavily.com/search';
  const DDG_URL = 'https://html.duckduckgo.com/html/';
  const TIMEOUT_MS = 6000;
  const MAX_QUERY_LEN = 300;
  const SNIPPET_MAX = 240;

  function clip(s, max) {
    if (typeof s !== 'string') return '';
    s = s.replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max) + '…' : s;
  }

  async function withTimeout(promiseFactory) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      return await promiseFactory(ac.signal);
    } finally {
      clearTimeout(t);
    }
  }

  // Tavily si paga come un modello (#591.6): parte solo sotto il limite di spesa del mese ed entra nel suo conto.
  // Prezzo del credito a consumo del listino pubblico, il più alto: con un piano il conto sbaglia per eccesso, mai sotto.
  const USD_PER_CREDITO_TAVILY = 0.008;
  const AZIONE_RICERCA = 'ricerca_web';

  async function impostazioniDelConto() {
    try { return (await global.SN_STORAGE?.getSettings?.()) || {}; } catch (_) { return {}; }
  }

  function limiteRaggiunto() {
    const G = global.SN_MODEL_GATE;
    if (G && typeof G.limitError === 'function') return G.limitError();
    const e = new Error('Limite di spesa mensile raggiunto.');
    e.code = 'LIMIT_REACHED';
    return e;
  }

  // Il servizio dice i crediti spesi quando li dice; se no una ricerca base ne costa uno, una avanzata due.
  function creditiDi(data, profondita) {
    const detti = Number(data && data.usage && data.usage.credits);
    if (Number.isFinite(detti) && detti >= 0) return detti;
    return profondita === 'advanced' ? 2 : 1;
  }

  async function segnaNelConto(data, profondita, s) {
    const C = global.SN_COSTS;
    if (!C || typeof C.record !== 'function') return;
    const costUsd = creditiDi(data, profondita) * USD_PER_CREDITO_TAVILY;
    if (!(costUsd > 0)) return;
    // `keySource` non è la chiave personale di OpenRouter: il registro d'uso sul server non la scrive come sua.
    try {
      await C.record({ action: AZIONE_RICERCA, provider: 'tavily', model: 'tavily', usage: { costUsd, keySource: 'tavily' }, usdToEur: s.usdToEur });
    } catch (e) { console.warn('[SN] costo della ricerca non registrato:', (e && e.message) || e); }
  }

  // L'unica domanda a Tavily: la usano anche le immagini della chat (#2272), che chiedono `extra` in più.
  async function richiestaTavily({ query, apiKey, maxResults, extra = {}, signal }) {
    const s = await impostazioniDelConto();
    const C = global.SN_COSTS;
    if (C && typeof C.isOverLimit === 'function' && await C.isOverLimit(s.monthlyLimitEur)) throw limiteRaggiunto();
    const r = await fetch(TAVILY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        ...extra,
        api_key: apiKey,
        query,
        max_results: maxResults,
        search_depth: 'basic',
        include_answer: false,
      }),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      throw new Error(`tavily ${r.status}: ${errText.slice(0, 200)}`);
    }
    return r.json();
  }

  async function searchTavily({ query, apiKey, maxResults }) {
    return withTimeout(async (signal) => {
      const data = await richiestaTavily({ query, apiKey, maxResults, signal });
      const results = (data.results || []).slice(0, maxResults).map((row) => ({
        title: clip(row.title, 200),
        url: row.url || '',
        snippet: clip(row.content || row.snippet || '', SNIPPET_MAX),
      }));
      return { ok: true, provider: 'tavily', results };
    });
  }

  // Regex e non DOMParser, che in un service worker non c'è. Best-effort.
  async function searchDuckDuckGo({ query, maxResults }) {
    return withTimeout(async (signal) => {
      const body = `q=${encodeURIComponent(query)}`;
      const r = await fetch(DDG_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // UA "neutro": senza User-Agent DDG a volte risponde 403.
          'User-Agent': 'Mozilla/5.0 (compatible; Filo/0.1)',
        },
        signal,
        body,
      });
      if (!r.ok) throw new Error(`ddg ${r.status}`);
      const html = await r.text();
      const results = [];
      // Match più tollerante possibile: il markup DDG cambia ogni tanto.
      const blockRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:result__snippet[^>]*>([\s\S]*?)<\/a>)?/gi;
      let m;
      while ((m = blockRe.exec(html)) && results.length < maxResults) {
        const rawUrl = m[1] || '';
        const title = clip(m[2].replace(/<[^>]+>/g, ''), 200);
        const snippet = clip((m[3] || '').replace(/<[^>]+>/g, ''), SNIPPET_MAX);
        // DDG redireziona via uddg=…: si estrae l'URL originale quando si può.
        let url = rawUrl;
        const uddg = /[?&]uddg=([^&]+)/.exec(rawUrl);
        if (uddg) {
          try { url = decodeURIComponent(uddg[1]); } catch (_) {}
        }
        if (url && title) results.push({ title, url, snippet });
      }
      return { ok: true, provider: 'duckduckgo', results };
    });
  }

  // Il pavimento della privacy (#1589): una domanda con una password, una carta, un codice usa e getta o una chiave non
  // esce, chiunque l'abbia scritta. Si dice, invece di cercare un'altra cosa.
  const FRASE_PAVIMENTO = 'La ricerca conteneva un dato riservato (una password, una carta, un codice o una chiave): Filo non l\'ha mandata.';
  function conDatoRiservato(q) {
    const P = global.SN_PAVIMENTO || (typeof require === 'function' ? require('../../shared/pavimento.js') : null);
    try { return Boolean(P && P.trova(q).length); } catch (_) { return true; }
  }

  // Ogni ricerca che Filo fa sul web (la chat, l'Aiuto) entra nel filo da qui, una volta, riuscita o no (#1561).
  // `da`: chi cerca, dall'elenco dei contatori (SN_CONTATORI.DA_RICERCA): ogni ricerca si conta qui, da qualunque strada (#1467).
  async function search({ query, tavilyKey, maxResults = 5, da = '' }) {
    const q = (query || '').trim().slice(0, MAX_QUERY_LEN);
    if (!q) return { ok: false, results: [], reason: 'query vuota' };
    if (conDatoRiservato(String(query || ''))) return { ok: false, results: [], reason: FRASE_PAVIMENTO, pavimento: true };
    const r = await cerca(q, { tavilyKey, maxResults });
    annota(q, r && r.provider, r && Array.isArray(r.results) ? r.results.length : 0);
    try { global.SN_CONTATORI_MAIN?.attivita('ricercaWeb', { da, ...global.SN_CONTATORI.esitoRicerca(r) }); } catch (_) {}
    return r;
  }

  // Anche la ricerca di immagini della chat (#2272) entra nel filo da qui, e col suo stesso pavimento.
  function annota(testo, motore, risultati) {
    try { global.SN_ACCADUTI?.ricerca({ testo, motore, risultati }); } catch (_) {}
  }
  const riservata = (q) => (conDatoRiservato(String(q || '')) ? FRASE_PAVIMENTO : '');

  async function cerca(q, { tavilyKey, maxResults }) {
    // `ripiego`: Tavily c'era e non ha risposto (lo contano i contatori, #1467).
    let ripiego = false;
    if (tavilyKey) {
      try {
        return await searchTavily({ query: q, apiKey: tavilyKey, maxResults });
      } catch (e) {
        console.warn('[SN] tavily failed, fallback ddg:', e.message || e);
        ripiego = true;
      }
    }
    try {
      return { ...(await searchDuckDuckGo({ query: q, maxResults })), ...(ripiego ? { ripiego } : {}) };
    } catch (e) {
      return { ok: false, results: [], reason: `tutti i provider hanno fallito: ${e.message || e}`, ...(ripiego ? { ripiego } : {}) };
    }
  }

  global.SN_WEB_SEARCH = { search, annota, riservata, richiestaTavily };
})(typeof globalThis !== 'undefined' ? globalThis : self);
