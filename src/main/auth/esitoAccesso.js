// La frase per chi ha chiesto l'accesso e non ci è arrivato: cosa è successo e
// cosa può fare, mai il messaggio tecnico. Logica pura, senza Electron.
// La causa la mette google-auth in `e.code`; gli errori di rete di fetch no.

const FRASI = {
  rete: 'Accesso non riuscito: manca la connessione. Riprova quando sei in rete.',
  annullato: 'Accesso annullato nel browser: riprova quando vuoi.',
  scaduto: 'L\'accesso nel browser non è stato completato: riprova.',
  sostituito: 'Accesso sostituito da quello appena richiesto.',
  'non-configurato': 'In questa versione di Filo l\'accesso non è disponibile.',
  servizio: 'Il servizio di accesso non ha risposto: riprova tra poco.',
};

const CODICI_RETE = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH',
  'EHOSTUNREACH', 'ENETDOWN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
]);

function erroreDiRete(e) {
  if (!e) return false;
  if (CODICI_RETE.has(e.code) || CODICI_RETE.has(e.cause && e.cause.code)) return true;
  return e.name === 'TypeError' && /fetch failed|network/i.test(String(e.message || ''));
}

function spiegaErroreAccesso(e) {
  let code = e && typeof e.code === 'string' && FRASI[e.code] ? e.code : null;
  if (!code) code = erroreDiRete(e) ? 'rete' : 'servizio';
  return { code, error: FRASI[code] };
}

module.exports = { spiegaErroreAccesso, FRASI };
