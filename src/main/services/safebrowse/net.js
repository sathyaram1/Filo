// Chiamate di rete della pipeline (stage 1 + parte di stage 3): best-effort, asincrone, timeout corti, non lanciano mai
// e NON bloccano mai la navigazione. RDAP e CT danno null su errore; Safe Browsing dice l'errore, che non vale «pulito».

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

// ── RDAP: età del dominio (stage 3) ───────────────────────────────────────
// rdap.org fa da bootstrap e redirige al server RDAP del registro giusto.
// Cerca l'evento "registration". Ritorna l'età in giorni, o null se non
// disponibile (molti ccTLD non espongono RDAP).
async function rdapAgeDays(registrable) {
  if (!registrable) return null;
  const data = await fetchJson(`https://rdap.org/domain/${encodeURIComponent(registrable)}`, {
    headers: { Accept: 'application/rdap+json' },
  });
  if (!data || !Array.isArray(data.events)) return null;
  const reg = data.events.find((e) => e.eventAction === 'registration');
  if (!reg || !reg.eventDate) return null;
  const ts = Date.parse(reg.eventDate);
  if (Number.isNaN(ts)) return null;
  const days = (Date.now() - ts) / (24 * 60 * 60 * 1000);
  return days >= 0 ? days : null;
}

// ── Certificate Transparency: età del primo certificato (stage 3) ─────────
// crt.sh espone JSON. Prendiamo il not_before più vecchio come "prima volta che
// il dominio ha avuto un certificato" — proxy dell'età. Best-effort, lento:
// timeout più generoso ma comunque non bloccante.
async function ctFirstSeenDays(registrable) {
  if (!registrable) return null;
  const data = await fetchJson(
    `https://crt.sh/?q=${encodeURIComponent(registrable)}&output=json`,
    { headers: { Accept: 'application/json' } },
    8000,
  );
  if (!Array.isArray(data) || data.length === 0) return null;
  let oldest = Infinity;
  for (const row of data) {
    const ts = Date.parse(row.not_before);
    if (!Number.isNaN(ts) && ts < oldest) oldest = ts;
  }
  if (!Number.isFinite(oldest)) return null;
  const days = (Date.now() - oldest) / (24 * 60 * 60 * 1000);
  return { firstSeenDays: days >= 0 ? days : 0 };
}

module.exports = { hashesSearch, rdapAgeDays, ctFirstSeenDays, fetchJson };
