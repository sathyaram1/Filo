// "Questo host esiste davvero?" — risoluzione DNS leggera per la barra comando
// della dashboard. Quando l'utente digita "/dominio.tld", prima di navigare (e
// per colorare di rosso l'input mentre scrive) verifichiamo che l'host risolva:
// un dominio inventato come "nonesistedavvero.io" porterebbe altrimenti a una
// pagina bianca di errore.
//
// POLITICA (volutamente conservativa: meglio lasciar navigare che bloccare per
// sbaglio un sito buono):
//   • IP letterale (1.2.3.4, ::1), localhost / *.localhost, oppure un nome della
//     rete locale (nas.lan, raspberrypi.local, fritz.box — vedi
//     SN_URL_NAV.isLocalNetworkName) → consideralo valido SENZA interrogare il
//     DNS. Il resolver pubblico non li conosce per definizione: chiederglielo
//     restituisce ENOTFOUND anche quando il dispositivo è lì e risponde (#433).
//   • host normale → `dns.lookup` (lo stesso resolver del sistema operativo che
//     userebbe il browser per navigare). SOLO un esito ENOTFOUND ("il dominio
//     non esiste") conta come "non esiste". Qualsiasi altro errore — rete giù,
//     timeout, EAI_AGAIN transitorio — è un DUBBIO: torniamo "esiste" per non
//     bloccare una navigazione legittima.

const dns = require('node:dns').promises;
const net = require('node:net');

// Vero se ha senso interrogare il DNS per questo host. IP letterali e localhost
// non vanno risolti: sono validi per definizione.
function isCheckableHost(host) {
  const h = String(host == null ? '' : host).trim().toLowerCase();
  if (!h) return false;
  if (net.isIP(h)) return false;
  if (h === 'localhost' || h.endsWith('.localhost')) return false;
  // Deve assomigliare a un dominio: almeno un punto e nessun carattere strano.
  if (!/^[a-z0-9._-]+$/.test(h)) return false;
  if (!h.includes('.')) return false;
  return true;
}

// Esistenza dell'host. `lookup` iniettabile per i test (default: dns.lookup).
async function hostResolves(host, { lookup = dns.lookup } = {}) {
  const h = String(host == null ? '' : host).trim().toLowerCase();
  if (!h) return false;
  if (!isCheckableHost(h)) return true; // IP/localhost/non-dominio → non bloccare
  try {
    await lookup(h);
    return true;
  } catch (err) {
    // SOLO "il dominio non esiste" blocca. Errori di rete/transitori → dubbio.
    if (err && err.code === 'ENOTFOUND') return false;
    return true;
  }
}

module.exports = { hostResolves, isCheckableHost };
