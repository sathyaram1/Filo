// Helper PKCE (RFC 7636) per il login OAuth desktop.
// Un'app nativa non può custodire un secret: il code_verifier non lascia il processo main,
// così un codice intercettato è inutilizzabile. Funzioni pure, testabili senza Electron.

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
