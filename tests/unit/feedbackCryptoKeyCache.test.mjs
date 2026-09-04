// Unit test per la cache della chiave privata in src/shared/feedbackCrypto.js.
//
// La dashboard decifra centinaia di campi con la STESSA chiave: importarla da
// capo a ogni campo costava più della decifratura. Qui si verifica che:
//   (a) due decifrature con la stessa chiave importano la chiave UNA volta
//       (rosso senza la cache: due import);
//   (b) la cache non confonde chiavi diverse: cambiando chiave si importa la
//       nuova, e la vecchia non decifra quello che è per la nuova.
// Gira via `npm run test:unit`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto as crypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const C = require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackCrypto.js'));

async function genTestKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privPkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const b64url = Buffer.from(pubRaw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64 = Buffer.from(privPkcs8).toString('base64');
  return { pub: b64url, priv: b64 };
}

// Conta gli import della chiave privata (formato pkcs8) sul SubtleCrypto vero.
function countPkcs8Imports(fn) {
  const proto = Object.getPrototypeOf(crypto.subtle);
  const orig = proto.importKey;
  let n = 0;
  proto.importKey = function (format, ...rest) {
    if (format === 'pkcs8') n++;
    return orig.call(this, format, ...rest);
  };
  return fn().then((r) => ({ result: r, imports: n })).finally(() => { proto.importKey = orig; });
}

test('la stessa chiave privata si importa una volta sola per più decifrature', async () => {
  const k = await genTestKeys();
  const c1 = await C.encryptForOwner('primo', k.pub);
  const c2 = await C.encryptForOwner('secondo', k.pub);
  const { result, imports } = await countPkcs8Imports(async () => [
    await C.decrypt(c1, k.priv),
    await C.decrypt(c2, k.priv),
    await C.decrypt(c1, k.priv),
  ]);
  assert.deepEqual(result, ['primo', 'secondo', 'primo']);
  assert.ok(imports <= 1, `attesi al più 1 import, fatti ${imports}`);
});

test('cambiando chiave la cache non confonde: la nuova entra, la vecchia non decifra il suo', async () => {
  const a = await genTestKeys();
  const b = await genTestKeys();
  const perA = await C.encryptForOwner('per A', a.pub);
  const perB = await C.encryptForOwner('per B', b.pub);
  assert.equal(await C.decrypt(perA, a.priv), 'per A');   // A in cache
  assert.equal(await C.decrypt(perB, b.priv), 'per B');   // B sostituisce A
  await assert.rejects(() => C.decrypt(perB, a.priv));    // A non legge B
  assert.equal(await C.decrypt(perA, a.priv), 'per A');   // A torna e legge il suo
});
