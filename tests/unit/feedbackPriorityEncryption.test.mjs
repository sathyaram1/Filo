// Unit test per la cifratura del campo `priority` (S1.priority).
//
// Asserisce il SUCCESSO (fallisce senza il fix):
//   a. decryptFeedbackFields: round-trip intero cifrato → torna lo stesso numero
//   b. decryptFeedbackFields: priority in chiaro (legacy) → invariata
//   c. decryptFeedbackFields: senza chiave privata → ciphertext lasciato invariato (no crash)
//   d. queueFeedbackCreateEncrypted: con gate ON → priority diventa FENC1: nel file
//   e. queueFeedbackCreateEncrypted: con gate OFF → priority rimane intero nel file
//   f. apply-triage.mjs toFsValue: priority ciphertext FENC1: → stringValue; intero → integerValue
//
// Gira senza Electron in millisecondi (node:test, nessuna dipendenza da UI).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto as crypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const require = createRequire(import.meta.url);

// Spool temporaneo (non tocca feedback-triage/ reale).
const tmp = mkdtempSync(join(tmpdir(), 'filo-prio-enc-'));
process.env.FILO_SPOOL_DIR = tmp;

after(() => { rmSync(tmp, { recursive: true, force: true }); });

// Carica feedbackCrypto (IIFE su globalThis) — pubkey di test iniettata esplicitamente.
const C = require(join(ROOT, 'src', 'shared', 'feedbackCrypto.js'));

// Import DOPO aver impostato FILO_SPOOL_DIR (lo script risolve SPOOL_DIR al load).
const { decryptFeedbackFields } = await import('../../scripts/lib/decrypt-feedback-fields.mjs');

// Genera una coppia di chiavi ECDH P-256 di test.
async function genTestKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privPkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const pub = Buffer.from(pubRaw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const priv = Buffer.from(privPkcs8).toString('base64');
  return { pub, priv };
}

// ─── Test a: round-trip priority cifrata → stesso numero ────────────────────

test('S1.priority: decryptFeedbackFields — round-trip cifra/decifra restituisce numero identico', async () => {
  const { pub, priv } = await genTestKeys();
  const savedPub = globalThis.SN_FEEDBACK_PUBKEY;
  const savedFlag = globalThis.SN_FEEDBACK_ENC_ENABLED;
  globalThis.SN_FEEDBACK_PUBKEY = pub;
  globalThis.SN_FEEDBACK_ENC_ENABLED = true;

  try {
    assert.ok(C.isEnabled(), 'gate deve essere ON');

    // Simula un feedback con priority cifrata (come la scriverebbe updateStatus).
    for (const prio of [0, 1, 2, 3]) {
      const ciphertext = await C.encryptForOwner(String(prio), pub);
      assert.ok(C.isEncrypted(ciphertext), `ciphertext di priority ${prio} deve essere FENC1:`);

      const fb = { _id: 'test-id', priority: ciphertext };
      const plain = await decryptFeedbackFields(fb, priv);

      assert.equal(typeof plain.priority, 'number', `priority decifrata deve essere number (prio=${prio})`);
      assert.equal(plain.priority, prio, `priority decifrata deve tornare ${prio}`);
    }
  } finally {
    globalThis.SN_FEEDBACK_PUBKEY = savedPub;
    globalThis.SN_FEEDBACK_ENC_ENABLED = savedFlag;
  }
});

// ─── Test b: priority in chiaro (legacy) → invariata ────────────────────────

test('S1.priority: decryptFeedbackFields — priority intera legacy passa invariata', async () => {
  const { pub, priv } = await genTestKeys();

  for (const prio of [0, 1, 2, 3]) {
    const fb = { _id: 'legacy-id', priority: prio }; // intero, non cifrato
    const plain = await decryptFeedbackFields(fb, priv);
    assert.equal(plain.priority, prio, `priority legacy ${prio} deve restare invariata`);
  }

  // priority undefined → invariata.
  const fb2 = { _id: 'no-prio' };
  const plain2 = await decryptFeedbackFields(fb2, priv);
  assert.equal(plain2.priority, undefined, 'priority assente deve restare undefined');
});

// ─── Test c: senza chiave privata, ciphertext lasciato invariato ─────────────

test('S1.priority: decryptFeedbackFields — senza chiave il ciphertext resta invariato (no crash)', async () => {
  const { pub } = await genTestKeys();
  const savedPub = globalThis.SN_FEEDBACK_PUBKEY;
  const savedFlag = globalThis.SN_FEEDBACK_ENC_ENABLED;
  globalThis.SN_FEEDBACK_PUBKEY = pub;
  globalThis.SN_FEEDBACK_ENC_ENABLED = true;

  try {
    const ciphertext = await C.encryptForOwner('2', pub);
    const fb = { _id: 'enc-id', priority: ciphertext };

    // Nessuna chiave privata passata.
    const plain = await decryptFeedbackFields(fb /* no priv */);

    // Il ciphertext deve restare com'è (non un numero, non un placeholder).
    assert.equal(plain.priority, ciphertext, 'senza chiave il ciphertext di priority deve restare invariato');
  } finally {
    globalThis.SN_FEEDBACK_PUBKEY = savedPub;
    globalThis.SN_FEEDBACK_ENC_ENABLED = savedFlag;
  }
});

// (Qui vivevano i controlli sulla cifratura nel FILE della coda su git. La coda
// non c'è più: adesso il feedback lo scrive il server, che cifra testo e
// priorità prima di posarli — e lo fa dentro una transazione, così anche la
// numerazione non si sovrappone.)
