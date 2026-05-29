// Helper PKCE (RFC 7636) per il login OAuth desktop.
//
// Le app native non possono custodire un client secret: PKCE lega la richiesta
// di autorizzazione allo scambio del codice tramite un segreto generato al
// volo (`code_verifier`), così un codice intercettato è inutilizzabile senza
// il verifier che non lascia mai il processo main.
//
// Pure functions, nessuna dipendenza Electron → testabili in isolamento.

const crypto = require('node:crypto');

// base64url senza padding, come richiesto da RFC 7636 §4.1 / RFC 4648 §5.
function base64url(buf) {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// code_verifier: stringa random ad alta entropia, lunghezza 43..128 nel
// charset [A-Za-z0-9-._~]. 32 byte random → 43 caratteri base64url.
function createVerifier() {
  return base64url(crypto.randomBytes(32));
}

// code_challenge = BASE64URL(SHA256(ASCII(code_verifier))). Metodo "S256".
function challengeFromVerifier(verifier) {
  const hash = crypto.createHash('sha256').update(verifier, 'ascii').digest();
  return base64url(hash);
}

// `state` anti-CSRF: legato alla singola richiesta, va riconfrontato col
// parametro che torna sul redirect.
function createState() {
  return base64url(crypto.randomBytes(24));
}

// Crea l'insieme completo di parametri per una nuova richiesta di login.
function createPkce() {
  const verifier = createVerifier();
  return {
    verifier,
    challenge: challengeFromVerifier(verifier),
    method: 'S256',
    state: createState(),
  };
}

module.exports = {
  base64url,
  createVerifier,
  challengeFromVerifier,
  createState,
  createPkce,
};
