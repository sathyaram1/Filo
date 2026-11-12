// «Questo host esiste?» — risoluzione DNS leggera per la barra comando della dashboard.
// IP, localhost e nomi di rete locale valgono senza DNS: il resolver pubblico risponde
// ENOTFOUND anche se il dispositivo c'è. Meglio lasciar navigare che bloccare un sito buono.

const dns = require('node:dns').promises;
const net = require('node:net');
// Una sola definizione di «host locale» in tutta l'app: la stessa che sceglie http://.
require('../../shared/urlNav.js');

function isCheckableHost(host) {
  const h = String(host == null ? '' : host).trim().toLowerCase();
  if (!h) return false;
  if (net.isIP(h)) return false;
  const nav = globalThis.SN_URL_NAV;
  if (nav && nav.isLocalHost(h)) return false;
  // Deve assomigliare a un dominio: almeno un punto e nessun carattere strano.
  if (!/^[a-z0-9._-]+$/.test(h)) return false;
  if (!h.includes('.')) return false;
  return true;
}

// `lookup` iniettabile per i test (default: dns.lookup).
async function hostResolves(host, { lookup = dns.lookup } = {}) {
  const h = String(host == null ? '' : host).trim().toLowerCase();
  if (!h) return false;
  if (!isCheckableHost(h)) return true; // IP/localhost/non-dominio → non bloccare
  try {
    await lookup(h);
    return true;
  } catch (err) {
    // Blocca solo «il dominio non esiste»: un errore transitorio è un dubbio, e passa.
    if (err && err.code === 'ENOTFOUND') return false;
    return true;
  }
}

module.exports = { hostResolves, isCheckableHost };
