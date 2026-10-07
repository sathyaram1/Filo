// Chiamate di rete della pipeline (stage 1 + parte di stage 3): best-effort, non lanciano mai e non bloccano la
// navigazione. Timeout corti; RDAP e CT distinguono «non si sa» (null) da «non ha risposto» (TRANSIENT); Safe Browsing
// dice l'errore, che non vale «pulito».

'use strict';

const TIMEOUT_MS = 6000;

async function fetchJson(url, opts = {}, timeoutMs = TIMEOUT_MS) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── Google Safe Browsing v5, hashes.search (stage 1: blacklist) ─────────
// L'unico punto che conosce indirizzo e formato del servizio: passare a Web Risk vuol dire riscrivere solo questo.
// Escono soltanto prefissi di 4 byte (gsb.js). Senza chiave → null, e non parte nessuna richiesta.
const GSB_SEARCH = 'https://safebrowsing.googleapis.com/v5/hashes:search';
const GSB_THREATS = {
  SOCIAL_ENGINEERING: 'phishing',
  MALWARE: 'malware',
  UNWANTED_SOFTWARE: 'unwanted',
  POTENTIALLY_HARMFUL_APPLICATION: 'malware',
};

function durationMs(d) {
  const m = /^(\d+(?:\.\d+)?)s$/.exec(String(d || ''));
  return m ? Math.round(Number(m[1]) * 1000) : 0;
}

// → { ok:true, matches:[{ hash, threatType, category }], cacheMs } | { ok:false, status } | null.
async function hashesSearch(prefixes, apiKey) {
  if (!apiKey || !Array.isArray(prefixes) || !prefixes.length) return null;
  const q = new URLSearchParams({ key: apiKey, alt: 'json' });
  for (const p of prefixes) q.append('hashPrefixes', p);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let data;
  try {
    const r = await fetch(`${GSB_SEARCH}?${q}`, { signal: ac.signal });
    if (!r.ok) return { ok: false, status: r.status || 0 };
    data = await r.json();
  } catch (_) {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(t);
  }
  const matches = [];
  for (const fh of (data && Array.isArray(data.fullHashes)) ? data.fullHashes : []) {
    if (!fh || typeof fh.fullHash !== 'string' || Buffer.from(fh.fullHash, 'base64').length !== 32) continue;
    const hash = Buffer.from(fh.fullHash, 'base64').toString('base64');
    for (const d of Array.isArray(fh.fullHashDetails) ? fh.fullHashDetails : []) {
      // Un attributo (CANARY, FRAME_ONLY o sconosciuto) toglie valore al dettaglio per una pagina intera: lo dice il protocollo.
      if (!d || !GSB_THREATS[d.threatType] || (Array.isArray(d.attributes) && d.attributes.length)) continue;
      matches.push({ hash, threatType: d.threatType, category: GSB_THREATS[d.threatType] });
    }
  }
  return { ok: true, matches, cacheMs: durationMs(data && data.cacheDuration) };
}

// Una risposta che non è arrivata (rete, tempo scaduto, servizio sovraccarico): si richiede presto, non fra un giorno.
const TRANSIENT = Object.freeze({ transient: true });
// crt.sh di un sito grande sono decine di megabyte: oltre il tetto il sito ha migliaia di certificati e l'età resta «non si sa».
const CT_MAX_BYTES = 3 * 1024 * 1024;
const CT_TIMEOUT_MS = 8000;

// { data } | { missing } (il servizio ha risposto: non lo sa) | { tooBig } | TRANSIENT.
async function fetchOutcome(url, opts = {}, timeoutMs = TIMEOUT_MS, maxBytes = Infinity) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });
    if (r.status === 429 || r.status >= 500) return TRANSIENT;
    if (!r.ok) return { missing: true };
    if (Number(r.headers.get('content-length')) > maxBytes) { ac.abort(); return { tooBig: true }; }
    let text = '';
    if (r.body && typeof r.body.getReader === 'function') {
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { ac.abort(); return { tooBig: true }; }
        text += dec.decode(value, { stream: true });
      }
      text += dec.decode();
    } else {
      text = await r.text();
      if (text.length > maxBytes) return { tooBig: true };
    }
    try { return { data: JSON.parse(text) }; } catch (_) { return { missing: true }; }
  } catch (_) {
    return TRANSIENT;
  } finally {
    clearTimeout(t);
  }
}

// ── RDAP: età del dominio (stage 3) ───────────────────────────────────────
// rdap.org redirige al registro giusto. Età in giorni; null se il registro non la dà (molti ccTLD non hanno RDAP).
async function rdapAgeDays(registrable) {
  if (!registrable) return null;
  const out = await fetchOutcome(`https://rdap.org/domain/${encodeURIComponent(registrable)}`, {
    headers: { Accept: 'application/rdap+json' },
  });
  if (out.transient) return TRANSIENT;
  const data = out.data;
  if (!data || !Array.isArray(data.events)) return null;
  const reg = data.events.find((e) => e.eventAction === 'registration');
  if (!reg || !reg.eventDate) return null;
  const ts = Date.parse(reg.eventDate);
  if (Number.isNaN(ts)) return null;
  const days = (Date.now() - ts) / (24 * 60 * 60 * 1000);
  return days >= 0 ? days : null;
}

// ── Certificate Transparency: età del primo certificato (stage 3) ─────────
// Il not_before più vecchio su crt.sh come stima dell'età; null se non si sa.
async function ctFirstSeenDays(registrable) {
  if (!registrable) return null;
  const out = await fetchOutcome(
    `https://crt.sh/?q=${encodeURIComponent(registrable)}&output=json&deduplicate=Y`,
    { headers: { Accept: 'application/json' } },
    CT_TIMEOUT_MS,
    CT_MAX_BYTES,
  );
  if (out.transient) return TRANSIENT;
  const data = out.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  let oldest = Infinity;
  for (const row of data) {
    const ts = Date.parse(row && row.not_before);
    if (!Number.isNaN(ts) && ts < oldest) oldest = ts;
  }
  if (!Number.isFinite(oldest)) return null;
  const days = (Date.now() - oldest) / (24 * 60 * 60 * 1000);
  return { firstSeenDays: days >= 0 ? days : 0 };
}

module.exports = { hashesSearch, rdapAgeDays, ctFirstSeenDays, fetchJson, fetchOutcome, TRANSIENT, CT_MAX_BYTES };
