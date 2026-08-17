// Unit test per la cifratura end-to-end dei feedback (S1.2 + S1.3).
//
// Asserisce il SUCCESSO (round-trip completo), non solo l'assenza di errori:
// - dopo la cifratura i campi sensibili sono FENC1: (opachi nella history git)
// - dopo la decifratura con la privata tornano identici al plaintext originale
// - i valori in chiaro (feedback vecchi) passano invariati (retrocompatibilità)
// - senza pubkey i valori escono in chiaro (guard, niente crash)
// - senza privkey i campi cifrati diventano il placeholder leggibile
//
// NOTA PARALLELISMO: i test di questa suite girano in parallelo con altri file
// (node --test con glob). Per evitare interferenze su globalThis.SN_FEEDBACK_PUBKEY,
// i test usano il parametro pubKeyOverride di encryptFieldsForQueue e passano
// la chiave di test ESPLICITAMENTE, senza toccare globalThis.
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

// Import una volta sola (caching ESM: stessa istanza per tutti i test).
const { encryptFieldsForQueue } = await import(toFileUrl(join(ROOT, 'scripts', 'lib', 'encrypt-feedback-fields.mjs')));
const { decryptFeedbackFields, decryptFeedbackList } = await import(toFileUrl(join(ROOT, 'scripts', 'lib', 'decrypt-feedback-fields.mjs')));

// ─── Test 1: round-trip campi feedback ────────────────────────────────────────

test('round-trip: cifra con encryptFieldsForQueue, decifra con decryptFeedbackFields', async () => {
  const { pub, priv } = await genTestKeys();

  // Passa la pubkey di test ESPLICITAMENTE (non toccare globalThis — parallelismo).
  const entry = { text: 'Il pulsante non funziona quando incollo.', name: 'bug pulsante', notes: 'riprodotto su Mac', extra: 'invariato' };
  const encrypted = await encryptFieldsForQueue(entry, ['text', 'name', 'notes'], pub);

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
});

// ─── Test 2: retrocompatibilità — valori in chiaro passano invariati ────────────

test('retrocompatibilità: valori in chiaro passano invariati attraverso decryptFeedbackFields', async () => {
  const { priv } = await genTestKeys();

  const oldFeedback = { text: 'feedback vecchio in chiaro', name: 'titolo vecchio', notes: 'note vecchie', status: 'done' };
  const plain = await decryptFeedbackFields(oldFeedback, priv);

  assert.equal(plain.text, 'feedback vecchio in chiaro', 'text in chiaro deve passare invariato');
  assert.equal(plain.name, 'titolo vecchio', 'name in chiaro deve passare invariato');
  assert.equal(plain.notes, 'note vecchie', 'notes in chiaro deve passare invariato');
  assert.equal(plain.status, 'done', 'status non è in lista decifratura: invariato');
});

// ─── Test 3: guard senza pubkey — scrive in chiaro, niente crash ────────────────

test('guard senza pubkey: encryptFieldsForQueue ritorna false e lascia in chiaro', async () => {
  // Non passa pubkey: né override né globalThis.SN_FEEDBACK_PUBKEY se è null.
  // Forziamo il caso senza pubkey passando undefined + assicurando che globalThis sia null.
  const savedPub = globalThis.SN_FEEDBACK_PUBKEY;
  globalThis.SN_FEEDBACK_PUBKEY = null;

  const entry = { text: 'testo sensibile', name: 'titolo', notes: 'note' };
  // Senza override e senza globalThis.SN_FEEDBACK_PUBKEY: deve ritornare false.
  const result = await encryptFieldsForQueue(entry, ['text', 'name', 'notes']); // nessun override

  assert.equal(result, false, 'deve ritornare false quando pubkey non disponibile');
  assert.equal(entry.text, 'testo sensibile', 'text deve restare in chiaro senza pubkey');
  assert.equal(entry.name, 'titolo', 'name deve restare in chiaro senza pubkey');

  globalThis.SN_FEEDBACK_PUBKEY = savedPub;
});

// ─── Test 4: placeholder senza privkey — i campi cifrati diventano leggibili ────

test('senza privkey: campi cifrati diventano placeholder leggibile, niente crash', async () => {
  const { pub } = await genTestKeys();

  const entry = { text: 'testo cifrato', name: 'titolo cifrato', notes: '' };
  await encryptFieldsForQueue(entry, ['text', 'name', 'notes'], pub);

  // Decifra SENZA passare la privata (e senza FILO_FEEDBACK_PRIVKEY in env).
  const savedEnv = process.env.FILO_FEEDBACK_PRIVKEY;
  delete process.env.FILO_FEEDBACK_PRIVKEY;

  const plain = await decryptFeedbackFields(entry); // nessuna privata

  assert.ok(typeof plain.text === 'string', 'text deve essere una stringa (placeholder)');
  assert.ok(plain.text.includes('cifrato'), 'placeholder deve menzionare "cifrato"');
  assert.ok(!C.isEncrypted(plain.text), 'il placeholder NON deve essere FENC1: (deve essere leggibile)');

  if (savedEnv !== undefined) process.env.FILO_FEEDBACK_PRIVKEY = savedEnv;
});

// ─── Test 5: queueFeedbackCreateEncrypted scrive file con campi cifrati ─────────

// (Qui viveva il controllo sulla cifratura nel FILE della coda su git. La coda
// non c'è più: il feedback lo scrive il server, che cifra testo e priorità
// prima di posarli sul documento pubblico.)

// ─── Test 7: gate di attivazione dormiente — pubkey presente ma flag OFF ────────

test('gate dormiente: con pubkey presente ma SN_FEEDBACK_ENC_ENABLED OFF non si cifra nulla', async () => {
  const { pub } = await genTestKeys();
  const savedPub = globalThis.SN_FEEDBACK_PUBKEY;
  const savedFlag = globalThis.SN_FEEDBACK_ENC_ENABLED;
  globalThis.SN_FEEDBACK_PUBKEY = pub;     // chiave presente…
  globalThis.SN_FEEDBACK_ENC_ENABLED = false; // …ma attivazione spenta

  try {
    assert.equal(C.isEnabled(), false, 'isEnabled deve essere false con flag OFF anche se la pubkey c\'è');
    // Senza override, encryptFieldsForQueue rispetta il gate → non cifra.
    const entry = { text: 'contenuto' };
    const result = await encryptFieldsForQueue(entry, ['text']); // nessun override
    assert.equal(result, false, 'non deve cifrare con gate dormiente');
    assert.equal(entry.text, 'contenuto', 'text resta in chiaro con gate dormiente');
  } finally {
    globalThis.SN_FEEDBACK_PUBKEY = savedPub;
    globalThis.SN_FEEDBACK_ENC_ENABLED = savedFlag;
  }
});

// ─── Test 6: decryptFeedbackList — lista mista in chiaro+cifrato ─────────────────

test('decryptFeedbackList: lista mista (vecchi in chiaro + nuovi cifrati)', async () => {
  const { pub, priv } = await genTestKeys();

  // Cifra con pubkey esplicita (no globalThis).
  const ctOld = await C.encryptForOwner('testo cifrato', pub);
  const list = [
    { text: 'vecchio in chiaro', name: 'titolo', _id: 'old1' },
    { text: ctOld, name: 'titolo cifrato', _id: 'new1' },
  ];

  const result = await decryptFeedbackList(list, priv);
  assert.equal(result.length, 2);
  assert.equal(result[0].text, 'vecchio in chiaro', 'il vecchio feedback resta in chiaro');
  assert.equal(result[1].text, 'testo cifrato', 'il nuovo feedback viene decifrato');
});

// ─── Test 8: batch IPC handler — decryptFeedbackList decifra tutti i campi rilevanti

test('batch IPC handler: decryptFeedbackList decifra text/url/name/title/notes/reviewComment, ignora il resto', async () => {
  const { pub, priv } = await genTestKeys();

  // Simula tre feedback come li riceverebbe il renderer da Firestore,
  // uno per ogni caso: tutto cifrato, misto, e tutto in chiaro.
  const [ctText, ctUrl, ctName, ctTitle, ctNotes, ctReviewComment] = await Promise.all([
    C.encryptForOwner('Testo feedback cifrato', pub),
    C.encryptForOwner('https://example.com/pagina?q=riservata', pub),
    C.encryptForOwner('Nome tester riservato', pub),
    C.encryptForOwner('Titolo breve cifrato', pub),
    C.encryptForOwner('Note di triage riservate', pub),
    C.encryptForOwner('Commento review riservato', pub),
  ]);

  const input = [
    // tutti e 6 i campi cifrati
    { _id: 'fb1', text: ctText, url: ctUrl, name: ctName, title: ctTitle, notes: ctNotes, reviewComment: ctReviewComment, status: 'todo', priority: 2 },
    // misto: solo text cifrato, il resto in chiaro
    { _id: 'fb2', text: ctText, url: 'https://chiaro.it', name: 'Mario', title: 'titolo', notes: '', reviewComment: null, status: 'done' },
    // tutti in chiaro (feedback vecchio retrocompat)
    { _id: 'fb3', text: 'vecchio in chiaro', url: null, name: 'Utente', title: '', notes: 'no', reviewComment: undefined, status: 'new' },
  ];

  // Il batch handler decifra ogni oggetto in sequenza (stesso pattern di auth.js).
  const result = await decryptFeedbackList(input, priv);

  assert.equal(result.length, 3, 'il numero di feedback deve restare invariato');

  // fb1: tutti i 6 campi decifrati
  assert.equal(result[0].text,          'Testo feedback cifrato',              'fb1.text decifrato');
  assert.equal(result[0].url,           'https://example.com/pagina?q=riservata', 'fb1.url decifrata');
  assert.equal(result[0].name,          'Nome tester riservato',               'fb1.name decifrato');
  assert.equal(result[0].title,         'Titolo breve cifrato',                'fb1.title decifrato');
  assert.equal(result[0].notes,         'Note di triage riservate',            'fb1.notes decifrate');
  assert.equal(result[0].reviewComment, 'Commento review riservato',           'fb1.reviewComment decifrato');
  // i campi non testuali restano invariati
  assert.equal(result[0].status,   'todo', 'fb1.status non viene toccato');
  assert.equal(result[0].priority, 2,      'fb1.priority non viene toccata');

  // fb2: solo text era cifrato
  assert.equal(result[1].text, 'Testo feedback cifrato', 'fb2.text decifrato');
  assert.equal(result[1].url,  'https://chiaro.it',      'fb2.url in chiaro rimane invariato');
  assert.equal(result[1].name, 'Mario',                  'fb2.name in chiaro rimane invariato');

  // fb3: tutti in chiaro — retrocompatibilità
  assert.equal(result[2].text, 'vecchio in chiaro', 'fb3.text in chiaro rimane invariato');
  assert.equal(result[2].status, 'new',             'fb3.status non viene toccato');

  // Nessun campo deve essere ancora FENC1: dopo la decifratura
  for (const fb of result) {
    for (const field of ['text', 'url', 'name', 'title', 'notes', 'reviewComment']) {
      const v = fb[field];
      assert.ok(!C.isEncrypted(v), `${fb._id}.${field} non deve restare FENC1: dopo la decifratura`);
    }
  }
});
