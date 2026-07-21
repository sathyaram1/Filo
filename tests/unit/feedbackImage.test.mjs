// Unit test per src/shared/feedbackImage.js — sniff del MIME dai magic byte +
// conversione a data URL, la logica pura dietro l'handler feedback_decrypt_image
// (S1.2, immagini allegate ai feedback). Include il round-trip che riproduce il
// percorso REALE dell'handler: byte immagine → cifratura sealed-box (come
// avviene all'upload) → decifratura (come nel main) → sniff → data URL.
//
// Prima del fix, le immagini cifrate arrivavano al <img src=URL> come byte
// opachi e mostravano un allegato rotto: questo test asserisce che, dati i byte
// cifrati, si ricostruisce un data URL image/* mostrabile.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto as crypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const IMG = require(join(ROOT, 'src', 'shared', 'feedbackImage.js'));
const C = require(join(ROOT, 'src', 'shared', 'feedbackCrypto.js'));

// Header realistici (primi byte) dei formati che sniffImageMime riconosce.
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2];
const BMP = [0x42, 0x4d, 0, 0, 0, 0];
const SVG = [...Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')];

async function genTestKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privPkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const b64url = Buffer.from(pubRaw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64 = Buffer.from(privPkcs8).toString('base64');
  return { pub: b64url, priv: b64 };
}

test('si registra su globalThis con la sua API', () => {
  assert.ok(IMG, 'SN_FEEDBACK_IMAGE assente');
  assert.equal(typeof IMG.sniffImageMime, 'function');
  assert.equal(typeof IMG.bytesToDataUrl, 'function');
});

test('sniffImageMime riconosce i formati dai magic byte', () => {
  assert.equal(IMG.sniffImageMime(new Uint8Array(PNG)), 'image/png');
  assert.equal(IMG.sniffImageMime(new Uint8Array(JPEG)), 'image/jpeg');
  assert.equal(IMG.sniffImageMime(new Uint8Array(GIF)), 'image/gif');
  assert.equal(IMG.sniffImageMime(new Uint8Array(WEBP)), 'image/webp');
  assert.equal(IMG.sniffImageMime(new Uint8Array(BMP)), 'image/bmp');
  assert.equal(IMG.sniffImageMime(new Uint8Array(SVG)), 'image/svg+xml');
});

test('sniffImageMime ripiega su image/png per byte non riconosciuti', () => {
  assert.equal(IMG.sniffImageMime(new Uint8Array([0, 1, 2, 3])), 'image/png');
  assert.equal(IMG.sniffImageMime(new Uint8Array([])), 'image/png');
});

test('bytesToDataUrl produce un data URL con il MIME indovinato', () => {
  const url = IMG.bytesToDataUrl(new Uint8Array(JPEG));
  assert.ok(url.startsWith('data:image/jpeg;base64,'), url.slice(0, 40));
  // Il base64 decodifica ESATTAMENTE ai byte di partenza.
  const b64 = url.split(',')[1];
  assert.deepEqual(Array.from(Buffer.from(b64, 'base64')), JPEG);
});

test('bytesToDataUrl rispetta un MIME esplicito', () => {
  const url = IMG.bytesToDataUrl(new Uint8Array(PNG), 'image/webp');
  assert.ok(url.startsWith('data:image/webp;base64,'));
});

test('round-trip completo: byte PNG cifrati → decifrati → data URL mostrabile', async () => {
  const { pub, priv } = await genTestKeys();
  // Un PNG "vero abbastanza": header PNG + payload deterministico.
  const original = new Uint8Array(1200);
  original.set(PNG.slice(0, 8), 0);
  for (let i = 8; i < original.length; i++) original[i] = (i * 31) & 0xff;

  // Come all'upload: cifra i byte con la sola chiave pubblica.
  const sealed = await C.encryptBytesForOwner(original, pub);
  // I byte cifrati NON sono più un'immagine (è quello che rompeva il <img>).
  assert.equal(C.isEncryptedBytes(sealed), true);
  assert.notEqual(IMG.sniffImageMime(sealed), 'image/jpeg');

  // Come nell'handler del main: riconosce che è cifrato, decifra, sniffa, serve.
  assert.equal(C.isEncryptedBytes(sealed), true);
  const decrypted = await C.decryptBytes(sealed, priv);
  assert.deepEqual(Array.from(decrypted), Array.from(original));
  const dataUrl = IMG.bytesToDataUrl(decrypted);
  assert.ok(dataUrl.startsWith('data:image/png;base64,'), dataUrl.slice(0, 40));
});

test('immagine NON cifrata (storica) non è scambiata per cifrata', () => {
  // Un PNG in chiaro non deve mai attivare il ramo di decifratura dell'handler.
  const plainPng = new Uint8Array(200);
  plainPng.set(PNG.slice(0, 8), 0);
  assert.equal(C.isEncryptedBytes(plainPng), false);
  assert.equal(IMG.sniffImageMime(plainPng), 'image/png');
});
