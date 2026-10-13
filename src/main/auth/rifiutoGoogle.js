// La pagina con cui Google rifiuta un accesso fatto dentro Filo (#1123): «browser non sicuro», disallowed_useragent,
// un errore OAuth. Logica pura: chi apre la scheda decide il ripiego. Sentinella: tests/unit/rifiutoGoogle.test.mjs.

'use strict';

const PERCORSI_RIFIUTO = /\/signin\/(v\d\/)?rejected|\/v3\/signin\/rejected|deniedsigninrejected/i;
const PERCORSI_ERRORE = /\/signin\/oauth\/(v\d\/)?error|\/o\/oauth2\/(v\d\/)?error/i;

// Il dettaglio di Google viaggia in `authError`, base64 di un messaggio binario che contiene il codice in chiaro.
function decodifica(v) {
  try { return Buffer.from(String(v || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1'); } catch (_) { return ''; }
}

// `hostAccesso`: l'host delle pagine d'accesso di Google; un indirizzo su un altro host non è mai un rifiuto.
// Torna null, 'disallowed_useragent', 'rifiutato' o 'errore'.
function rifiutoDiGoogle(url, hostAccesso) {
  let u;
  try { u = new URL(String(url || '')); } catch (_) { return null; }
  if (!hostAccesso || u.hostname.toLowerCase() !== String(hostAccesso).toLowerCase()) return null;
  const testo = [...u.searchParams.entries()].map(([k, v]) => `${k}=${v} ${k === 'authError' ? decodifica(v) : ''}`).join(' ');
  if (/disallowed_useragent/i.test(testo)) return 'disallowed_useragent';
  if (PERCORSI_RIFIUTO.test(u.pathname)) return 'rifiutato';
  if (PERCORSI_ERRORE.test(u.pathname)) return 'errore';
  return null;
}

module.exports = { rifiutoDiGoogle };
