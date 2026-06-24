// Hash deterministico del clientId (S1.F2.2).
//
// PERCHÉ ESISTE
//   Con la cifratura attiva (S1.2), `clientId` viene cifrato nel documento
//   feedback. Ma la macchina utente NON ha la chiave privata → non può decifrarlo
//   per il match "questo feedback è dell'install corrente" (popup ricompense C5).
//   Soluzione: conservare accanto al clientId cifrato un `clientIdHash` SHA-256
//   troncato a 32 char hex (16 byte), IN CHIARO. Il match C5 usa l'hash.
//   Con cifratura DORMIENTE il clientId resta in chiaro, ma `clientIdHash` viene
//   comunque scritto per uniformità (il match può essere basato solo sull'hash).
//
// DETERMINISTICA: stesso input → stesso output sempre (no salt, no nonce).
// Cross-ambiente: usa WebCrypto (disponibile in Node 22+ e browser).

(function (global) {
  'use strict';

  function subtle() {
    const c = (global && global.crypto) || (typeof crypto !== 'undefined' ? crypto : null);
    if (!c || !c.subtle) {
      throw new Error('WebCrypto non disponibile in questo ambiente');
    }
    return c.subtle;
  }

  /**
   * Calcola SHA-256 del clientId e ritorna i primi 32 caratteri hex (16 byte).
   * Deterministica: stesso input → stesso output.
   *
   * @param {string} clientId
   * @returns {Promise<string>} 32 char hex (es. "a3f1e2b8c4d5...")
   */
  async function hashClientId(clientId) {
    const s = String(clientId || '');
    const enc = new TextEncoder();
    const buf = enc.encode(s);
    const hashBuf = await subtle().digest('SHA-256', buf);
    const bytes = new Uint8Array(hashBuf);
    // Converti in hex e tronca a 32 char (16 byte su 32 totali)
    let hex = '';
    for (let i = 0; i < 16; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  global.SN_FEEDBACK_CLIENT_ID_HASH = { hashClientId };
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.SN_FEEDBACK_CLIENT_ID_HASH;
}
