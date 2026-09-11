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

  // ── L'impronta per UNA scheda pubblica (#583) ─────────────────────────────
  //
  // Sulla scheda pubblica di un fix serve un modo, per chi ha mandato quel
  // feedback, di riconoscerlo come suo quando Filo gli annuncia la ricompensa.
  // Mettere lì `clientIdHash` così com'è funzionerebbe, ma sarebbe lo STESSO
  // valore su tutte le schede della stessa installazione: chiunque legge la
  // bacheca (è pubblica per definizione) potrebbe raggruppare i fix e dire
  // «queste dodici cose le ha mandate la stessa persona».
  //
  // Con l'id della scheda dentro l'impronta, ogni scheda ne ha una diversa e
  // quel raggruppamento non si fa più. Chi ha mandato il feedback la ricalcola
  // lo stesso, perché conosce entrambe le cose: l'id della scheda che sta
  // guardando e l'impronta del proprio clientId.
  function tagInput(docId, clientIdHash) {
    const a = String(docId || '');
    const b = String(clientIdHash || '');
    if (!a || !b) return '';
    return `${a}:${b}`;
  }

  function hexTronco(bytes) {
    let hex = '';
    for (let i = 0; i < 16; i++) hex += bytes[i].toString(16).padStart(2, '0');
    return hex;
  }

  /**
   * Impronta della scheda `docId` per l'installazione il cui clientId ha
   * impronta `clientIdHash`. Torna '' se manca uno dei due.
   * @returns {Promise<string>} 32 char hex
   */
  async function cardTag(docId, clientIdHash) {
    const base = tagInput(docId, clientIdHash);
    if (!base) return '';
    const buf = new TextEncoder().encode(base);
    return hexTronco(new Uint8Array(await subtle().digest('SHA-256', buf)));
  }

  /**
   * La stessa cosa, SINCRONA. La usa chi PUBBLICA le schede, che gira nel
   * processo principale e negli script, dove `require` c'è: in una pagina un
   * SHA-256 sincrono non esiste, e in pagina nessuno pubblica schede.
   * @returns {string} 32 char hex
   */
  function cardTagSync(docId, clientIdHash) {
    const base = tagInput(docId, clientIdHash);
    if (!base) return '';
    let nodeCrypto = null;
    try { nodeCrypto = (typeof require === 'function') ? require('node:crypto') : null; } catch (_) { nodeCrypto = null; }
    if (!nodeCrypto) throw new Error('cardTagSync: serve node:crypto (le schede si pubblicano dal main o dagli script)');
    return nodeCrypto.createHash('sha256').update(base).digest('hex').slice(0, 32);
  }

  global.SN_FEEDBACK_CLIENT_ID_HASH = { hashClientId, cardTag, cardTagSync };
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.SN_FEEDBACK_CLIENT_ID_HASH;
}
