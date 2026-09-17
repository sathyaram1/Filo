// Chiamate di rete della pipeline: best-effort e asincrone, non lanciano mai e non bloccano
// la navigazione — arricchiscono il verdetto, non decidono se caricare. Timeout corti.

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

// Safe Browsing richiede una API key: senza, torna null e gli altri stadi reggono da soli.
const GSB_THREATS = {
  SOCIAL_ENGINEERING: 'phishing',
  MALWARE: 'malware',
  UNWANTED_SOFTWARE: 'unwanted',
  POTENTIALLY_HARMFUL_APPLICATION: 'malware',
};

async function safeBrowsingLookup(rawUrl, apiKey) {
  if (!apiKey || !rawUrl) return null;
  const endpoint = `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(apiKey)}`;
  const body = {
    client: { clientId: 'filo-browser', clientVersion: '0.1' },
    threatInfo: {
      threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
      platformTypes: ['ANY_PLATFORM'],
      threatEntryTypes: ['URL'],
      threatEntries: [{ url: rawUrl }],
    },
  };
  const data = await fetchJson(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!data || !Array.isArray(data.matches) || data.matches.length === 0) {
    return { listed: false };
  }
  const m = data.matches[0];
  return { listed: true, category: GSB_THREATS[m.threatType] || 'phishing', threatType: m.threatType };
}

// rdap.org fa da bootstrap e redirige al registro giusto; null se manca, molti ccTLD non
// espongono RDAP.
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

// Il not_before più vecchio su crt.sh è un proxy dell'età del dominio. Lento: timeout più
// generoso, comunque non bloccante.
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

module.exports = { safeBrowsingLookup, rdapAgeDays, ctFirstSeenDays, fetchJson };
