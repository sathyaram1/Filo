// Unit test per src/shared/feedbackCrypto.js — la cifratura "sealed box" dei
// feedback (S1.1). Logica pura, niente Electron: gira in ms con node:test.
//
// I test generano una coppia di chiavi ECDH P-256 al volo (non dipendono dalla
// chiave bakeata in feedbackPublicKey.js, che in repo è null) e verificano il
// round-trip + le proprietà di sicurezza: chi cifra non rilegge, una chiave
// sbagliata non decifra, un ciphertext manomesso viene rifiutato.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto as crypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const C = require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackCrypto.js'));

// Genera una coppia di test ed esporta pub (raw b64url) + priv (pkcs8 base64),
// gli stessi formati che usano gen-feedback-keys.mjs e il modulo.
async function genTestKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privPkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const b64url = Buffer.from(pubRaw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64 = Buffer.from(privPkcs8).toString('base64');
  return { pub: b64url, priv: b64 };
}

test('si registra su globalThis con la sua API', () => {
  assert.ok(C);
  for (const fn of ['encryptForOwner', 'decrypt', 'encryptBytesForOwner', 'decryptBytes', 'isEncrypted', 'hasPublicKey']) {
    assert.equal(typeof C[fn], 'function', `manca ${fn}`);
  }
});

test('round-trip testo: cifra con pubblica, decifra con privata', async () => {
  const { pub, priv } = await genTestKeys();
  const plain = 'Il pulsante X non funziona quando incollo un\'immagine.';
  const ct = await C.encryptForOwner(plain, pub);
  assert.equal(typeof ct, 'string');
  assert.notEqual(ct, plain);
  assert.ok(C.isEncrypted(ct), 'il ciphertext deve essere riconosciuto come cifrato');
  assert.equal(ct.startsWith('FENC1:'), true);
  const back = await C.decrypt(ct, priv);
  assert.equal(back, plain);
});

test('il plaintext non compare nel ciphertext', async () => {
  const { pub } = await genTestKeys();
  const plain = 'segreto-riconoscibile-12345';
  const ct = await C.encryptForOwner(plain, pub);
  assert.equal(ct.includes(plain), false);
});

test('ogni cifratura è diversa (chiave effimera) ma entrambe decifrano', async () => {
  const { pub, priv } = await genTestKeys();
  const plain = 'stesso testo';
  const a = await C.encryptForOwner(plain, pub);
  const b = await C.encryptForOwner(plain, pub);
  assert.notEqual(a, b, 'due cifrature dello stesso testo devono differire');
  assert.equal(await C.decrypt(a, priv), plain);
  assert.equal(await C.decrypt(b, priv), plain);
});

test('testo unicode / emoji sopravvive al round-trip', async () => {
  const { pub, priv } = await genTestKeys();
  const plain = 'àèìòù — 日本語 — 🔐🧵 newline\ne tab\t.';
  const ct = await C.encryptForOwner(plain, pub);
  assert.equal(await C.decrypt(ct, priv), plain);
});

test('una chiave privata sbagliata NON decifra', async () => {
  const { pub } = await genTestKeys();
  const other = await genTestKeys();
  const ct = await C.encryptForOwner('riservato', pub);
  await assert.rejects(() => C.decrypt(ct, other.priv));
});

test('un ciphertext manomesso viene rifiutato (autenticazione AES-GCM)', async () => {
  const { pub, priv } = await genTestKeys();
  const ct = await C.encryptForOwner('integro', pub);
  // flippa un carattere nel corpo base64url (verso la fine = nel ciphertext/tag)
  const body = ct.slice('FENC1:'.length);
  const i = body.length - 3;
  const flipped = body[i] === 'A' ? 'B' : 'A';
  const tampered = 'FENC1:' + body.slice(0, i) + flipped + body.slice(i + 1);
  await assert.rejects(() => C.decrypt(tampered, priv));
});

test('round-trip byte (screenshot)', async () => {
  const { pub, priv } = await genTestKeys();
  const bytes = new Uint8Array(2048);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37) & 0xff;
  const sealed = await C.encryptBytesForOwner(bytes, pub);
  assert.ok(sealed instanceof Uint8Array);
  assert.notDeepEqual(Array.from(sealed.slice(0, bytes.length)), Array.from(bytes));
  const opened = await C.decryptBytes(sealed, priv);
  assert.deepEqual(Array.from(opened), Array.from(bytes));
});

test('encryptForOwner senza chiave configurata lancia un errore esplicito', async () => {
  // nessuna pubkey passata e SN_FEEDBACK_PUBKEY è null in repo
  await assert.rejects(() => C.encryptForOwner('x'), /chiave pubblica/i);
});

test('decrypt di una stringa non cifrata lancia errore', async () => {
  const { priv } = await genTestKeys();
  await assert.rejects(() => C.decrypt('testo in chiaro', priv), /non cifrat/i);
});

test('null/undefined passano invariati (no-op)', async () => {
  assert.equal(await C.encryptForOwner(null), null);
  assert.equal(await C.encryptForOwner(undefined), undefined);
  assert.equal(await C.decrypt(null, 'x'), null);
});

test('isEncrypted distingue cifrato da chiaro', () => {
  assert.equal(C.isEncrypted('FENC1:abc'), true);
  assert.equal(C.isEncrypted('ciao'), false);
  assert.equal(C.isEncrypted(null), false);
  assert.equal(C.isEncrypted(123), false);
});
