// Fetch "SSRF-safe" per le richieste che il MAIN process fa verso URL forniti
// dal renderer (es. anteprima Open Graph di un link). Senza queste guardie, una
// pagina potrebbe far colpire al processo main servizi locali/interni
// (127.0.0.1, 169.254.169.254 metadata cloud, host di rete privata) e leggerne
// parte della risposta.
//
// Difese:
//   - solo schemi http/https;
//   - blocco di loopback / link-local / reti private / multicast, sia per IP
//     letterali sia risolvendo il DNS dell'hostname;
//   - redirect gestiti a mano: OGNI hop viene rivalidato (un redirect verso un
//     IP privato non sfugge come farebbe con redirect:'follow').
//
// Limite residuo noto (accettato per l'alpha): tra la risoluzione DNS e la
// connessione effettiva resta una finestra di DNS-rebinding (TOCTOU); chiuderla
// del tutto richiederebbe di pinnare l'IP risolto sulla connessione.

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
  if (net.isIP(hostname)) {
    if (isPrivateAddr(hostname)) throw new Error('blocked-private-address');
    return;
  }
  const h = String(hostname || '').toLowerCase();
  if (!h) throw new Error('bad-url');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) {
    throw new Error('blocked-private-address');
  }
  const records = await dns.lookup(hostname, { all: true });
  if (!records.length) throw new Error('dns-empty');
  for (const r of records) {
    if (isPrivateAddr(r.address)) throw new Error('blocked-private-address');
  }
}

// GET con validazione anti-SSRF. Ritorna la Response (con body leggibile) come
// fetch. Lancia su schema non http/https, host privato o troppi redirect.
async function safeFetch(rawUrl, { signal, maxRedirects = 5, headers } = {}) {
  let current = String(rawUrl || '');
  for (let i = 0; i <= maxRedirects; i++) {
    let u;
    try { u = new URL(current); } catch (_) { throw new Error('bad-url'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('blocked-scheme');
    await assertPublicHost(u.hostname);
    const res = await fetch(current, { method: 'GET', redirect: 'manual', signal, headers });
    const loc = (res.status >= 300 && res.status < 400) ? res.headers.get('location') : null;
    if (loc) {
      try { res.body?.cancel?.(); } catch (_) {}
      current = new URL(loc, current).href; // risolve redirect relativi; rivalidato al giro dopo
      continue;
    }
    return res;
  }
  throw new Error('too-many-redirects');
}

module.exports = { safeFetch, isPrivateAddr, assertPublicHost };
