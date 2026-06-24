// Unit test per la cifratura end-to-end dei feedback (S1.2 + S1.3).
//
// Asserisce il SUCCESSO (round-trip completo), non solo l'assenza di errori:
// - dopo la cifratura i campi sensibili sono FENC1: (opachi nella history git)
// - dopo la decifratura con la privata tornano identici al plaintext originale
// - i valori in chiaro (feedback vecchi) passano invariati (retrocompatibilità)
// - senza pubkey i valori escono in chiaro (guard, niente crash)
// - senza privkey i campi cifrati diventano il placeholder leggibile
//
// Gira senza Electron in millisecondi (node:test, nessuna dipendenza da UI).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto as crypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const require = createRequire(import.meta.url);

// Helper: converte un path assoluto in file:// URL per import() dinamico su Windows.
function toFileUrl(absPath) { return pathToFileURL(absPath).href; }

// Carica feedbackCrypto direttamente (feedbackPublicKey resta null: la chiave
// di test la passiamo esplicitamente, non usiamo quella del repo).
const C = require(join(ROOT, 'src', 'shared', 'feedbackCrypto.js'));

// Genera una coppia di test (stessa logica di feedbackCrypto.test.mjs).
async function genTestKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privPkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const pub = Buffer.from(pubRaw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const priv = Buffer.from(privPkcs8).toString('base64');
  return { pub, priv };
}

// ─── Test 1: round-trip campi feedback via encryptFieldsForQueue + decryptFeedbackFields ──

test('round-trip: cifra con encryptFieldsForQueue, decifra con decryptFeedbackFields', async () => {
  const { pub, priv } = await genTestKeys();

  // Inietta temporaneamente la pubkey di test su globalThis (simula chiave configurata).
  const savedPub = globalThis.SN_FEEDBACK_PUBKEY;
  globalThis.SN_FEEDBACK_PUBKEY = pub;

  const { encryptFieldsForQueue } = await import(toFileUrl(join(ROOT, 'scripts', 'lib', 'encrypt-feedback-fields.mjs')));
  const { decryptFeedbackFields } = await import(toFileUrl(join(ROOT, 'scripts', 'lib', 'decrypt-feedback-fields.mjs')));

  const entry = { text: 'Il pulsante non funziona quando incollo.', name: 'bug pulsante', notes: 'riprodotto su Mac', extra: 'invariato' };
  const encrypted = await encryptFieldsForQueue(entry, ['text', 'name', 'notes']);

  assert.ok(encrypted, 'encryptFieldsForQueue deve ritornare true con pubkey configurata');
  assert.ok(C.isEncrypted(entry.text), 'text deve essere FENC1: dopo la cifratura');
  assert.ok(C.isEncrypted(entry.name), 'name deve essere FENC1: dopo la cifratura');
  assert.ok(C.isEncrypted(entry.notes), 'notes deve essere FENC1: dopo la cifratura');
  assert.equal(entry.extra, 'invariato', 'i campi non in lista restano invariati');

  // Decifra passando esplicitamente la privata (l'env non è impostato in test).
  const plain = await decryptFeedbackFields(entry, priv);

  // ASSERISCE IL SUCCESSO: il testo decifrato è quello giusto.
  assert.equal(plain.text, 'Il pulsante non funziona quando incollo.', 'text deve tornare identico dopo decifratura');
  assert.equal(plain.name, 'bug pulsante', 'name deve tornare identico dopo decifratura');
  assert.equal(plain.notes, 'riprodotto su Mac', 'notes deve tornare identico dopo decifratura');
  assert.equal(plain.extra, 'invariato', 'i campi non cifrati restano invariati');

  // Ripristina.
  globalThis.SN_FEEDBACK_PUBKEY = savedPub;
});

// ─── Test 2: retrocompatibilità — valori in chiaro passano invariati ────────────

test('retrocompatibilità: valori in chiaro passano invariati attraverso decryptFeedbackFields', async () => {
  const { priv } = await genTestKeys();
  const { decryptFeedbackFields } = await import(toFileUrl(join(ROOT, 'scripts', 'lib', 'decrypt-feedback-fields.mjs')));

  const oldFeedback = { text: 'feedback vecchio in chiaro', name: 'titolo vecchio', notes: 'note vecchie', status: 'done' };
  const plain = await decryptFeedbackFields(oldFeedback, priv);

  assert.equal(plain.text, 'feedback vecchio in chiaro', 'text in chiaro deve passare invariato');
  assert.equal(plain.name, 'titolo vecchio', 'name in chiaro deve passare invariato');
  assert.equal(plain.notes, 'note vecchie', 'notes in chiaro deve passare invariato');
  assert.equal(plain.status, 'done', 'status non è in lista decifratura: invariato');
});

// ─── Test 3: guard senza pubkey — scrive in chiaro, niente crash ────────────────

test('guard senza pubkey: encryptFieldsForQueue ritorna false e lascia in chiaro', async () => {
  // Assicurati che non ci sia una pubkey globale (nella stessa run il test
  // precedente l'ha ripristinata a null; ma per sicurezza).
  const savedPub = globalThis.SN_FEEDBACK_PUBKEY;
  globalThis.SN_FEEDBACK_PUBKEY = null;

  const { encryptFieldsForQueue } = await import(toFileUrl(join(ROOT, 'scripts', 'lib', 'encrypt-feedback-fields.mjs')));

  const entry = { text: 'testo sensibile', name: 'titolo', notes: 'note' };
  const result = await encryptFieldsForQueue(entry, ['text', 'name', 'notes']);

  assert.equal(result, false, 'deve ritornare false quando pubkey non disponibile');
  assert.equal(entry.text, 'testo sensibile', 'text deve restare in chiaro senza pubkey');
  assert.equal(entry.name, 'titolo', 'name deve restare in chiaro senza pubkey');

  globalThis.SN_FEEDBACK_PUBKEY = savedPub;
});

// ─── Test 4: placeholder senza privkey — i campi cifrati diventano leggibili ────

test('senza privkey: campi cifrati diventano placeholder leggibile, niente crash', async () => {
  const { pub } = await genTestKeys();
  const savedPub = globalThis.SN_FEEDBACK_PUBKEY;
  globalThis.SN_FEEDBACK_PUBKEY = pub;

  const { encryptFieldsForQueue } = await import(toFileUrl(join(ROOT, 'scripts', 'lib', 'encrypt-feedback-fields.mjs')));
  const { decryptFeedbackFields } = await import(toFileUrl(join(ROOT, 'scripts', 'lib', 'decrypt-feedback-fields.mjs')));

  const entry = { text: 'testo cifrato', name: 'titolo cifrato', notes: '' };
  await encryptFieldsForQueue(entry, ['text', 'name', 'notes']);

  // Decifra SENZA passare la privata (e senza FILO_FEEDBACK_PRIVKEY in env).
  const savedEnv = process.env.FILO_FEEDBACK_PRIVKEY;
  delete process.env.FILO_FEEDBACK_PRIVKEY;

  const plain = await decryptFeedbackFields(entry); // nessuna privata

  assert.ok(typeof plain.text === 'string', 'text deve essere una stringa (placeholder)');
  assert.ok(plain.text.includes('cifrato'), 'placeholder deve menzionare "cifrato"');
  assert.ok(!C.isEncrypted(plain.text), 'il placeholder NON deve essere FENC1: (deve essere leggibile)');

  if (savedEnv !== undefined) process.env.FILO_FEEDBACK_PRIVKEY = savedEnv;
  globalThis.SN_FEEDBACK_PUBKEY = savedPub;
});

// ─── Test 5: queueFeedbackCreateEncrypted scrive file con campi cifrati ─────────

test('queueFeedbackCreateEncrypted: il file scritto ha i campi sensibili cifrati', async () => {
  const { pub, priv } = await genTestKeys();
  const savedPub = globalThis.SN_FEEDBACK_PUBKEY;
  globalThis.SN_FEEDBACK_PUBKEY = pub;

  const tmp = mkdtempSync(join(tmpdir(), 'filo-enc-test-'));
  const savedSpool = process.env.FILO_SPOOL_DIR;
  process.env.FILO_SPOOL_DIR = tmp;

  try {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { queueFeedbackCreateEncrypted } = await import(join(ROOT, 'scripts', 'queue-feedback.mjs'));
    const { decryptFeedbackFields } = await import(toFileUrl(join(ROOT, 'scripts', 'lib', 'decrypt-feedback-fields.mjs')));

    await queueFeedbackCreateEncrypted({
      text: 'Fix critico nel gestore eventi',
      name: 'gestore eventi rotto',
      notes: 'riprodotto su Windows',
      status: 'todo',
    });

    const files = readdirSync(tmp).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 1, 'deve essere stato creato esattamente un file');

    const entry = JSON.parse(readFileSync(join(tmp, files[0]), 'utf8'));
    assert.ok(C.isEncrypted(entry.text), 'text nel file deve essere FENC1:');
    assert.ok(C.isEncrypted(entry.name), 'name nel file deve essere FENC1:');
    assert.ok(C.isEncrypted(entry.notes), 'notes nel file deve essere FENC1:');

    // Decifra e verifica round-trip.
    const plain = await decryptFeedbackFields(entry, priv);
    assert.equal(plain.text, 'Fix critico nel gestore eventi', 'text decifrato deve tornare al valore originale');
    assert.equal(plain.name, 'gestore eventi rotto', 'name decifrato deve tornare al valore originale');
    assert.equal(plain.notes, 'riprodotto su Windows', 'notes decifrato deve tornare al valore originale');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    if (savedSpool !== undefined) process.env.FILO_SPOOL_DIR = savedSpool;
    else delete process.env.FILO_SPOOL_DIR;
    globalThis.SN_FEEDBACK_PUBKEY = savedPub;
  }
});

// ─── Test 6: decryptFeedbackList — lista mista in chiaro+cifrato ─────────────────

test('decryptFeedbackList: lista mista (vecchi in chiaro + nuovi cifrati)', async () => {
  const { pub, priv } = await genTestKeys();
  const savedPub = globalThis.SN_FEEDBACK_PUBKEY;
  globalThis.SN_FEEDBACK_PUBKEY = pub;

  const { decryptFeedbackList } = await import(toFileUrl(join(ROOT, 'scripts', 'lib', 'decrypt-feedback-fields.mjs')));

  const ctOld = await C.encryptForOwner('testo cifrato', pub);
  const list = [
    { text: 'vecchio in chiaro', name: 'titolo', _id: 'old1' },
    { text: ctOld, name: 'titolo cifrato', _id: 'new1' },
  ];

  const result = await decryptFeedbackList(list, priv);
  assert.equal(result.length, 2);
  assert.equal(result[0].text, 'vecchio in chiaro', 'il vecchio feedback resta in chiaro');
  assert.equal(result[1].text, 'testo cifrato', 'il nuovo feedback viene decifrato');

  globalThis.SN_FEEDBACK_PUBKEY = savedPub;
});
