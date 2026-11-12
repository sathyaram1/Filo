// Il /llms.txt del sito su cui si apre l'Aiuto (https://llmstxt.org), in cache 24 ore per dominio: SN_LLMS_TXT.get.
// Finisce nel prompt di un agente che agisce sulla pagina: si legge solo da quel sito, mai da un redirect verso
// un altro o verso la rete di casa, e lo chiede la scheda dell'Aiuto (#1272). Prove: tests/unit/llmsTxt.test.mjs.

(function (global) {
  'use strict';

  const { leggiTesto } = require('./safe-fetch');
  const { perContoDellaScheda } = require('./perContoDellaScheda');
  const Sito = require('../../shared/stessoSito');

  const STORAGE_KEY = 'sn_llmstxt_cache';
  const TTL_MS = 24 * 60 * 60 * 1000;       // 24h
  const MAX_BYTES = 20 * 1024;              // 20KB
  // Una voce scritta prima del #1082 può essere un servizio della rete di casa raggiunto con un redirect: si rilegge.
  const VERSIONE = 2;
  const FETCH_TIMEOUT_MS = 4000;
  // Bound difensivo sui domini in cache: oltre il tetto si scartano i più vecchi.
  const MAX_DOMAINS_CACHED = 500;

  async function readCache() {
    const r = await chrome.storage.local.get(STORAGE_KEY);
    return (r && r[STORAGE_KEY]) || {};
  }
  async function writeCache(obj) {
    await chrome.storage.local.set({ [STORAGE_KEY]: obj });
  }

  function fresh(entry) {
    return !!entry && entry.v === VERSIONE && (Date.now() - (entry.cachedAt || 0)) < TTL_MS;
  }

  // Si segue un redirect solo dentro il sito di partenza (example.com → www.example.com) e solo in https.
  function stessoSito(partenza, prossimo) {
    if (prossimo.protocol !== 'https:') return false;
    const sito = Sito.sitoDi(partenza.href);
    return !!sito && Sito.sitoDi(prossimo.href) === sito;
  }

  async function fetchOnce(url, sender) {
    const ac = new AbortController();
    // Il tempo copre anche il corpo: un sito che lo manda a gocce non deve tenere ferma la risposta dell'Aiuto.
    const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await perContoDellaScheda(sender, url, { signal: ac.signal, redirectAmmesso: stessoSito, lanSeGiaDiPartenza: true });
      if (!r.ok) { try { r.body?.cancel?.(); } catch (_) {} return { present: false, text: '' }; }
      const ct = r.headers.get('content-type') || '';
      // Una pagina 404 servita come 200 non è un llms.txt.
      if (ct.includes('text/html')) { try { r.body?.cancel?.(); } catch (_) {} return { present: false, text: '' }; }
      const { testo, tagliato } = await leggiTesto(r, MAX_BYTES);
      // Le SPA rispondono con index.html a ogni indirizzo, anche senza dichiararlo.
      if (/^\s*<!DOCTYPE\s+html|^\s*<html[\s>]/i.test(testo)) return { present: false, text: '' };
      return { present: true, text: tagliato ? testo + '\n…[troncato]' : testo };
    } catch (_) {
      return { present: false, text: '' };
    } finally {
      clearTimeout(t);
    }
  }

  async function pruneIfNeeded(cache) {
    const keys = Object.keys(cache);
    if (keys.length <= MAX_DOMAINS_CACHED) return cache;
    const sorted = keys.sort((a, b) => (cache[a].cachedAt || 0) - (cache[b].cachedAt || 0));
    const toRemove = sorted.slice(0, sorted.length - MAX_DOMAINS_CACHED);
    for (const k of toRemove) delete cache[k];
    return cache;
  }

  // { text, present, cachedAt } del dominio: dalla cache se fresca, altrimenti chiesto dalla scheda di `sender`, che
  // esce col suo proxy. Senza una scheda viva non parte niente e non si scrive niente. Non lancia mai.
  async function get(domain, { sender } = {}) {
    if (!domain || typeof domain !== 'string') return { text: '', present: false, cachedAt: 0 };
    const cache = await readCache();
    const cached = cache[domain];
    if (cached && fresh(cached)) return cached;
    const wc = sender && sender.wc;
    if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return { text: '', present: false, cachedAt: 0 };

    const url = `https://${domain}/llms.txt`;
    const fetched = await fetchOnce(url, sender);
    const entry = {
      text: fetched.text,
      present: fetched.present,
      cachedAt: Date.now(),
      v: VERSIONE,
    };
    cache[domain] = entry;
    await writeCache(await pruneIfNeeded(cache));
    return entry;
  }

  global.SN_LLMS_TXT = { get, _internal: { TTL_MS, MAX_BYTES } };
})(typeof globalThis !== 'undefined' ? globalThis : self);
