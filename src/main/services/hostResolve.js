// "Questo host esiste davvero?" — risoluzione DNS leggera per la barra comando della dashboard: senza, un dominio inventato porterebbe a una pagina bianca di errore.
// IP letterali, localhost e i nomi della rete locale (nas.lan, raspberrypi.local — SN_URL_NAV.isLocalNetworkName) sono validi SENZA interrogare il DNS: il resolver pubblico non li conosce e risponde ENOTFOUND anche quando il dispositivo è lì e risponde (#433).
// Per gli altri si usa il resolver del sistema. Politica volutamente conservativa: meglio lasciar navigare che bloccare per sbaglio un sito buono.

const dns = require('node:dns').promises;
const net = require('node:net');
// Una sola definizione di "host locale" per tutta l'app: la stessa che sceglie http:// invece di https://.
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
    // SOLO "il dominio non esiste" blocca. Errori di rete o transitori (timeout, EAI_AGAIN) sono un dubbio: si torna "esiste".
    if (err && err.code === 'ENOTFOUND') return false;
    return true;
  }
}

module.exports = { hostResolves, isCheckableHost };
