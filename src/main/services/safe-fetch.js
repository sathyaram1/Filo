// GET "SSRF-safe" per le richieste che il main fa verso indirizzi scelti da una pagina: solo http/https, niente
// loopback, link-local, reti private o multicast, rivalidando ogni redirect. Resta aperta la finestra di DNS-rebinding
// fra la risoluzione e la connessione (servirebbe pinnare l'IP). Prove: tests/unit/safeFetch.test.mjs.

const dns = require('node:dns').promises;
const net = require('node:net');

function isPrivateIPv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true; // ignoto → tratta come non sicuro
  const [a, b] = p;
  if (a === 0) return true;                     // "this host"
  if (a === 10) return true;                    // 10/8 privata
  if (a === 127) return true;                   // loopback
  if (a === 169 && b === 254) return true;      // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 privata
  if (a === 192 && b === 168) return true;      // 192.168/16 privata
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a >= 224) return true;                    // multicast/riservati
  return false;
}

function isPrivateIPv6(ip) {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (s === '::1' || s === '::') return true;   // loopback / unspecified
  if (s.startsWith('fe80')) return true;        // link-local
  if (s.startsWith('fc') || s.startsWith('fd')) return true; // ULA fc00::/7
  const m = s.match(/(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (m) return isPrivateIPv4(m[1]);
  return false;
}

function isPrivateAddr(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // non riconosciuto → non sicuro
}

async function assertPublicHost(hostname) {
  // URL.hostname tiene le quadre di un IPv6: senza toglierle finirebbe al DNS invece che alla classificazione.
  const nudo = String(hostname || '').replace(/^\[(.*)\]$/, '$1');
  if (net.isIP(nudo)) {
    if (isPrivateAddr(nudo)) throw new Error('blocked-private-address');
    return;
  }
  const h = nudo.toLowerCase();
  if (!h) throw new Error('bad-url');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) {
    throw new Error('blocked-private-address');
  }
  const records = await dns.lookup(h, { all: true });
  if (!records.length) throw new Error('dns-empty');
  for (const r of records) {
    if (isPrivateAddr(r.address)) throw new Error('blocked-private-address');
  }
}

// GET con validazione anti-SSRF; ritorna la Response come fetch e lancia su schema, host privato o troppi redirect.
// `redirectAmmesso(partenza, prossimo)` (due URL) può rifiutare un redirect: 'blocked-redirect'.
// `lanSeGiaDiPartenza`: un host di partenza GIÀ privato (l'utente è su una pagina della sua rete) si legge, ma solo in
// https e restando sulla sua origine: il certificato lega il nome al servizio, così un nome pubblico che il DNS di un
// sito ostile punta sul router non passa, e un redirect non porta altrove nella rete di casa.
async function safeFetch(rawUrl, { signal, maxRedirects = 5, headers, redirectAmmesso, lanSeGiaDiPartenza = false } = {}) {
  let current = String(rawUrl || '');
  let partenza = null;
  let origineLan = null;
  for (let i = 0; i <= maxRedirects; i++) {
    let u;
    try { u = new URL(current); } catch (_) { throw new Error('bad-url'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('blocked-scheme');
    if (!partenza) partenza = u;
    if (origineLan) {
      if (u.origin !== origineLan) throw new Error('blocked-private-address');
    } else {
      try {
        await assertPublicHost(u.hostname);
      } catch (e) {
        const lan = i === 0 && lanSeGiaDiPartenza && u.protocol === 'https:' && e && e.message === 'blocked-private-address';
        if (!lan) throw e;
        origineLan = u.origin;
      }
    }
    const res = await fetch(current, { method: 'GET', redirect: 'manual', signal, headers });
    const loc = (res.status >= 300 && res.status < 400) ? res.headers.get('location') : null;
    if (loc) {
      try { res.body?.cancel?.(); } catch (_) {}
      let prossimo;
      try { prossimo = new URL(loc, current); } catch (_) { throw new Error('bad-url'); }
      if (typeof redirectAmmesso === 'function' && !redirectAmmesso(partenza, prossimo)) throw new Error('blocked-redirect');
      current = prossimo.href; // rivalidato al giro dopo
      continue;
    }
    return res;
  }
  throw new Error('too-many-redirects');
}

// Il corpo come testo, fermandosi a `maxByte`: r.text() leggerebbe tutto quello che il sito decide di mandare.
async function leggiTesto(res, maxByte) {
  const reader = res && res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
  if (!reader) return { testo: '', tagliato: false };
  const dec = new TextDecoder('utf-8', { fatal: false });
  let testo = '';
  let letti = 0;
  let tagliato = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const resto = maxByte - letti;
      if (value.byteLength > resto) {
        testo += dec.decode(value.subarray(0, resto), { stream: true });
        tagliato = true;
        break;
      }
      letti += value.byteLength;
      testo += dec.decode(value, { stream: true });
    }
    // Tagliato, un carattere a metà del taglio si lascia cadere invece di diventare un simbolo sostitutivo.
    if (!tagliato) testo += dec.decode();
  } finally {
    Promise.resolve().then(() => reader.cancel()).catch(() => {});
  }
  return { testo, tagliato };
}

module.exports = { safeFetch, leggiTesto, isPrivateAddr, assertPublicHost };
