// Web search per la sidebar Aiuto. Provider primario: Tavily (API pensata
// per LLM, snippet già "rilevanti"). Fallback: scraping di duckduckgo.com/html
// (gratis, fragile — può rompersi se DDG cambia il markup).
//
// L'API non lancia mai: in caso di errore ritorna { ok:false, results:[],
// reason }. Il consumer (sidebar via background) inietterà i risultati come
// system note nel turno successivo dell'AI.
//
// Espone SN_WEB_SEARCH = { search({query, tavilyKey, maxResults}) }.

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

  async function searchTavily({ query, apiKey, maxResults }) {
    return withTimeout(async (signal) => {
      const r = await fetch(TAVILY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
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
      const data = await r.json();
      const results = (data.results || []).slice(0, maxResults).map((row) => ({
        title: clip(row.title, 200),
        url: row.url || '',
        snippet: clip(row.content || row.snippet || '', SNIPPET_MAX),
      }));
      return { ok: true, provider: 'tavily', results };
    });
  }

  // DuckDuckGo HTML: parsiamo i risultati con regex perché in service worker
  // non abbiamo DOMParser. Cerca i blocchi <a class="result__a" ...>title</a>
  // e <a class="result__snippet">snippet</a>. Best-effort.
  async function searchDuckDuckGo({ query, maxResults }) {
    return withTimeout(async (signal) => {
      const body = `q=${encodeURIComponent(query)}`;
      const r = await fetch(DDG_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // UA "neutro": senza un User-Agent DDG a volte ritorna 403.
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
        // DDG redireziona via uddg=...; estraiamo l'URL originale se possibile.
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

  async function search({ query, tavilyKey, maxResults = 5 }) {
    const q = (query || '').trim().slice(0, MAX_QUERY_LEN);
    if (!q) return { ok: false, results: [], reason: 'query vuota' };

    if (tavilyKey) {
      try {
        return await searchTavily({ query: q, apiKey: tavilyKey, maxResults });
      } catch (e) {
        console.warn('[SN] tavily failed, fallback ddg:', e.message || e);
      }
    }
    try {
      return await searchDuckDuckGo({ query: q, maxResults });
    } catch (e) {
      return { ok: false, results: [], reason: `tutti i provider hanno fallito: ${e.message || e}` };
    }
  }

  global.SN_WEB_SEARCH = { search };
})(typeof globalThis !== 'undefined' ? globalThis : self);
