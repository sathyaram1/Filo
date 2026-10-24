// Hash deterministico del clientId: SHA-256 troncato, scritto IN CHIARO accanto al cifrato.
// Con la cifratura attiva la macchina utente non ha la chiave e non può riconoscere i suoi
// feedback: il match usa l'hash. Deterministico e cross-ambiente (WebCrypto).

(function (global) {
  'use strict';

  function subtle() {
    const c = (global && global.crypto) || (typeof crypto !== 'undefined' ? crypto : null);
    if (!c || !c.subtle) {
      throw new Error('WebCrypto non disponibile in questo ambiente');
    }
    return c.subtle;
  }

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

  // Impronta per UNA scheda: `clientIdHash` nudo sarebbe uguale su tutte le schede della
  // stessa installazione, e la bacheca è pubblica — si potrebbero raggruppare (#583).
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

  // Versione SINCRONA per chi PUBBLICA le schede: gira nel main e negli script.
  // In una pagina uno SHA-256 sincrono non esiste, e in pagina nessuno pubblica schede.
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
