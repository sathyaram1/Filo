// Hash deterministico del clientId (S1.F2.2): SHA-256 troncato a 32 caratteri hex, scritto IN CHIARO accanto al clientId cifrato.
// Serve perché con la cifratura attiva la macchina utente non ha la chiave privata e non può decifrare il clientId per riconoscere «questo feedback è di questa installazione» (popup ricompense C5): il match usa l'hash. Si scrive anche a cifratura dormiente, per uniformità.
// Deterministica (niente salt né nonce) e cross-ambiente: WebCrypto, presente in Node 22+ e nel browser.

(function (global) {
  'use strict';

  function subtle() {
    const c = (global && global.crypto) || (typeof crypto !== 'undefined' ? crypto : null);
    if (!c || !c.subtle) {
      throw new Error('WebCrypto non disponibile in questo ambiente');
    }
    return c.subtle;
  }

  // Primi 32 caratteri hex su 32 byte di digest.
  async function hashClientId(clientId) {
    const s = String(clientId || '');
    const enc = new TextEncoder();
    const buf = enc.encode(s);
    const hashBuf = await subtle().digest('SHA-256', buf);
    const bytes = new Uint8Array(hashBuf);
    let hex = '';
    for (let i = 0; i < 16; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  // L'impronta per UNA scheda pubblica (#583): sulla scheda del fix chi ha mandato il feedback deve riconoscerlo come suo quando Filo gli annuncia la ricompensa.
  // Mettere lì `clientIdHash` com'è darebbe lo stesso valore su tutte le schede della stessa installazione, e chiunque legge la bacheca (che è pubblica) potrebbe dire «queste dodici cose le ha mandate la stessa persona». Con l'id della scheda dentro l'impronta ogni scheda ne ha una diversa, e chi ha mandato il feedback la ricalcola lo stesso perché conosce entrambe le cose.
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

  // Torna '' se manca uno dei due.
  async function cardTag(docId, clientIdHash) {
    const base = tagInput(docId, clientIdHash);
    if (!base) return '';
    const buf = new TextEncoder().encode(base);
    return hexTronco(new Uint8Array(await subtle().digest('SHA-256', buf)));
  }

  // La stessa cosa SINCRONA, per chi PUBBLICA le schede: gira nel main e negli script, dove `require` c'è. In una pagina uno SHA-256 sincrono non esiste, e in pagina nessuno pubblica schede.
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
