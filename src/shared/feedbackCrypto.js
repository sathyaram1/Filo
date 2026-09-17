// Cifratura asimmetrica dei feedback, «sealed box» verso l'owner: chi legge Firestore o il
// repo pubblico non deve leggere testo e verdetti, o `blocked` regala hill-climbing.
// Chi cifra usa SOLO la pubblica e non può rileggere ciò che ha cifrato: è il punto.

(function (global) {
  'use strict';

  const VERSION = 1;
  const STR_PREFIX = 'FENC1:';
  const EPH_LEN = 65; // chiave pubblica P-256 in formato raw (0x04 || X || Y)
  const IV_LEN = 12;  // nonce AES-GCM

  function subtle() {
    const c = (global && global.crypto) || (typeof crypto !== 'undefined' ? crypto : null);
    if (!c || !c.subtle) {
      throw new Error('WebCrypto non disponibile in questo ambiente');
    }
    return c.subtle;
  }
  function randomBytes(n) {
    const c = (global && global.crypto) || crypto;
    const out = new Uint8Array(n);
    c.getRandomValues(out);
    return out;
  }

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const textToBytes = (s) => enc.encode(s);
  const bytesToText = (b) => dec.decode(b);

  function bytesToB64url(bytes) {
    let b64;
    if (typeof Buffer !== 'undefined') {
      b64 = Buffer.from(bytes).toString('base64');
    } else {
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      b64 = btoa(bin);
    }
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64ToBytes(s) {
    const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function importPublicKey(b64url) {
    const raw = b64ToBytes(b64url);
    return subtle().importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  }
  // La privata importata resta in memoria: reimportarla a ogni campo costava più della
  // decifratura stessa. Un import fallito non resta in cache.
  let privKeyCache = null; // { b64, key }
  async function importPrivateKey(b64) {
    if (privKeyCache && privKeyCache.b64 === b64) return privKeyCache.key;
    const pkcs8 = b64ToBytes(b64);
    const key = await subtle().importKey('pkcs8', pkcs8, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    privKeyCache = { b64, key };
    return key;
  }

  // `info` = chiave effimera: lega la chiave derivata a questo specifico messaggio.
  async function deriveAesKey(privateKey, publicKey, info) {
    const bits = await subtle().deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
    const base = await subtle().importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    return subtle().deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  function pack(ephRaw, iv, ct) {
    const out = new Uint8Array(1 + EPH_LEN + IV_LEN + ct.length);
    out[0] = VERSION;
    out.set(ephRaw, 1);
    out.set(iv, 1 + EPH_LEN);
    out.set(ct, 1 + EPH_LEN + IV_LEN);
    return out;
  }
  function unpack(bytes) {
    if (!bytes || bytes.length < 1 + EPH_LEN + IV_LEN || bytes[0] !== VERSION) {
      throw new Error('ciphertext non valido o versione non supportata');
    }
    return {
      eph: bytes.slice(1, 1 + EPH_LEN),
      iv: bytes.slice(1 + EPH_LEN, 1 + EPH_LEN + IV_LEN),
      ct: bytes.slice(1 + EPH_LEN + IV_LEN),
    };
  }

  function resolvePubKey(override) {
    const k = override || global.SN_FEEDBACK_PUBKEY || null;
    if (!k) {
      throw new Error(
        'Nessuna chiave pubblica feedback configurata: genera la coppia con ' +
        '`node scripts/gen-feedback-keys.mjs`'
      );
    }
    return k;
  }

  async function sealBytes(plainBytes, pubKeyB64url) {
    const pub = await importPublicKey(resolvePubKey(pubKeyB64url));
    const eph = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const ephRaw = new Uint8Array(await subtle().exportKey('raw', eph.publicKey));
    const aesKey = await deriveAesKey(eph.privateKey, pub, ephRaw);
    const iv = randomBytes(IV_LEN);
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, aesKey, plainBytes));
    return pack(ephRaw, iv, ct);
  }
  async function openBytes(packed, privKeyB64) {
    const { eph, iv, ct } = unpack(packed);
    const priv = await importPrivateKey(privKeyB64);
    const ephPub = await importPublicKey(bytesToB64url(eph));
    const aesKey = await deriveAesKey(priv, ephPub, eph);
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv }, aesKey, ct);
    return new Uint8Array(pt);
  }

  async function encryptForOwner(plaintext, pubKeyB64url) {
    if (plaintext == null) return plaintext; // null/undefined restano tali
    const packed = await sealBytes(textToBytes(String(plaintext)), pubKeyB64url);
    return STR_PREFIX + bytesToB64url(packed);
  }
  async function decrypt(value, privKeyB64) {
    if (value == null) return value;
    const s = String(value);
    if (!s.startsWith(STR_PREFIX)) {
      throw new Error('stringa non cifrata o formato sconosciuto');
    }
    const packed = b64ToBytes(s.slice(STR_PREFIX.length));
    return bytesToText(await openBytes(packed, privKeyB64));
  }

  async function encryptBytesForOwner(plainBytes, pubKeyB64url) {
    return sealBytes(plainBytes instanceof Uint8Array ? plainBytes : new Uint8Array(plainBytes), pubKeyB64url);
  }
  async function decryptBytes(packed, privKeyB64) {
    return openBytes(packed instanceof Uint8Array ? packed : new Uint8Array(packed), privKeyB64);
  }

  function isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(STR_PREFIX);
  }
  function isEncryptedBytes(bytes) {
    return bytes && bytes.length >= 1 + EPH_LEN + IV_LEN && bytes[0] === VERSION;
  }
  function hasPublicKey() {
    return !!(global.SN_FEEDBACK_PUBKEY);
  }
  // Serve la chiave pubblica E l'interruttore acceso (feedbackPublicKey.js).
  function isEnabled() {
    return hasPublicKey() && !!global.SN_FEEDBACK_ENC_ENABLED;
  }

  global.SN_FEEDBACK_CRYPTO = {
    encryptForOwner,
    decrypt,
    encryptBytesForOwner,
    decryptBytes,
    isEncrypted,
    isEncryptedBytes,
    hasPublicKey,
    isEnabled,
    STR_PREFIX,
    VERSION,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.SN_FEEDBACK_CRYPTO;
}
