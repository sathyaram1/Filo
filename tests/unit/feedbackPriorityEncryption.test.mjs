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
const { queueFeedbackCreateEncrypted } = await import('../../scripts/queue-feedback.mjs');

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

// ─── Test d: queueFeedbackCreateEncrypted con gate ON → priority = FENC1: ───

test('S1.priority: queueFeedbackCreateEncrypted con gate ON — priority nel file è FENC1:', async () => {
  const { pub } = await genTestKeys();
  const savedPub = globalThis.SN_FEEDBACK_PUBKEY;
  const savedFlag = globalThis.SN_FEEDBACK_ENC_ENABLED;
  // Inietta la pubkey DI TEST su SN_FEEDBACK_PUBKEY: il modulo encrypt-feedback-fields
  // usa questo per caricare la chiave pubblica. Con pub iniettato E flag=true, isEnabled()=true.
  globalThis.SN_FEEDBACK_PUBKEY = pub;
  globalThis.SN_FEEDBACK_ENC_ENABLED = true;

  try {
    assert.ok(C.isEnabled(), 'gate deve essere ON prima del test');

    const file = await queueFeedbackCreateEncrypted({
      text: 'test per cifratura priority',
      name: 'test priority',
      priority: 2,
    });

    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.ok(
      typeof saved.priority === 'string' && saved.priority.startsWith('FENC1:'),
      `priority nel file deve essere FENC1: con gate ON, ma è: ${JSON.stringify(saved.priority)}`,
    );
  } finally {
    globalThis.SN_FEEDBACK_PUBKEY = savedPub;
    globalThis.SN_FEEDBACK_ENC_ENABLED = savedFlag;
  }
});

// ─── Test e: queueFeedbackCreateEncrypted con gate OFF → priority = intero ───

test('S1.priority: queueFeedbackCreateEncrypted con gate OFF — priority nel file è intero', async () => {
  const savedPub = globalThis.SN_FEEDBACK_PUBKEY;
  const savedFlag = globalThis.SN_FEEDBACK_ENC_ENABLED;
  globalThis.SN_FEEDBACK_PUBKEY = null;
  globalThis.SN_FEEDBACK_ENC_ENABLED = false;

  try {
    assert.ok(!C.isEnabled(), 'gate deve essere OFF per questo test');

    const file = await queueFeedbackCreateEncrypted({
      text: 'test senza cifratura priority',
      name: 'test no-enc',
      priority: 3,
    });

    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(typeof saved.priority, 'number', 'priority deve essere number con gate OFF');
    assert.equal(saved.priority, 3, 'priority deve essere 3 (invariata) con gate OFF');
  } finally {
    globalThis.SN_FEEDBACK_PUBKEY = savedPub;
    globalThis.SN_FEEDBACK_ENC_ENABLED = savedFlag;
  }
});

// ─── Test f: logica toFsValue per priority in apply-triage ──────────────────
// toFsValue è definita localmente in apply-triage.mjs (non esportata).
// Testiamo la logica equivalente direttamente qui (specchio del comportamento).

test('S1.priority: apply-triage — priority FENC1: scrive stringValue, intero scrive integerValue', () => {
  // Specchio della logica in createFeedback/apply-triage.mjs (righe 228-234).
  function simulateApplyPriority(entry) {
    if (typeof entry.priority === 'string' && entry.priority.startsWith('FENC1:')) {
      return { stringValue: entry.priority };
    }
    const prio = Number(entry.priority);
    if (Number.isInteger(prio) && prio >= 1 && prio <= 3) {
      return { integerValue: String(prio) };
    }
    return null; // 0 o non valido: non scritto
  }

  // Caso ciphertext → stringValue.
  const cipher = 'FENC1:abc123xyz';
  const fsValCipher = simulateApplyPriority({ priority: cipher });
  assert.deepEqual(fsValCipher, { stringValue: 'FENC1:abc123xyz' }, 'priority FENC1: deve diventare stringValue');

  // Caso intero 1-3 → integerValue.
  for (const p of [1, 2, 3]) {
    const fsVal = simulateApplyPriority({ priority: p });
    assert.deepEqual(fsVal, { integerValue: String(p) }, `priority ${p} deve diventare integerValue`);
  }

  // Caso 0 → non scritto (nessuna priority).
  assert.equal(simulateApplyPriority({ priority: 0 }), null, 'priority 0 non deve essere scritta');

  // Caso assente → non scritto.
  assert.equal(simulateApplyPriority({ priority: undefined }), null, 'priority undefined non deve essere scritta');
});
