// Unit test per il premio alla risoluzione di un feedback con priority CIFRATA
// (feedback #307): dal cutover cifratura `priority` su Firestore è un ciphertext
// FENC1 che la macchina utente non può leggere → il calcolo faceva
// Number(ciphertext)=NaN → 0 → premio SEMPRE minimo (50), per qualunque priorità.
// Il fix introduce il mirror in chiaro `priorityPublic` (pattern statusPublic) e
// lo usa nel calcolo del premio.
//
// Asserisce il SUCCESSO (fallisce senza il fix):
//   a. feedbackRewardPriority: priorityPublic presente → vince (anche con priority FENC1)
//   b. feedbackRewardPriority: priority FENC1 senza mirror → 0 (fascia minima, non NaN)
//   c. feedbackRewardPriority: priority intera legacy senza mirror → usata (retrocompat)
//   d. rewardForPriority(feedbackRewardPriority(doc FENC1 + mirror 2)) = 200 (fine-a-fine)
//   e. buildCreateEntry: l'entry di coda porta il mirror priorityPublic in chiaro
//   f. queueFeedbackCreateEncrypted gate ON: priority nel file è FENC1 ma
//      priorityPublic resta un intero in chiaro
//
// Gira senza Electron in millisecondi (node:test).

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
const tmp = mkdtempSync(join(tmpdir(), 'filo-prio-pub-'));
process.env.FILO_SPOOL_DIR = tmp;
after(() => { rmSync(tmp, { recursive: true, force: true }); });

require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'main', 'services', 'creditStore.js'));
const CR = require(join(ROOT, 'src', 'shared', 'feedbackCrypto.js'));
const C = globalThis.SN_CREDITS;

// Import DOPO aver impostato FILO_SPOOL_DIR (lo script risolve SPOOL_DIR al load).
const { buildCreateEntry, queueFeedbackCreateEncrypted } = await import('../../scripts/queue-feedback.mjs');

async function genTestKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const pub = Buffer.from(pubRaw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { pub };
}

// ─── a. priorityPublic vince, anche con priority cifrata ─────────────────────

test('feedbackRewardPriority: priorityPublic in chiaro vince sulla priority cifrata', () => {
  for (const p of [1, 2, 3]) {
    const fb = { priority: 'FENC1:aaaabbbbcccc', priorityPublic: p };
    assert.equal(C.feedbackRewardPriority(fb), p, `mirror ${p} deve vincere`);
  }
  // Mirror anche come stringa numerica (Firestore integerValue → Number, ma difensivo).
  assert.equal(C.feedbackRewardPriority({ priority: 'FENC1:x', priorityPublic: '3' }), 3);
  // Clamp del mirror fuori scala.
  assert.equal(C.feedbackRewardPriority({ priorityPublic: 7 }), 3);
  assert.equal(C.feedbackRewardPriority({ priorityPublic: -2 }), 0);
});

// ─── b. priority FENC1 senza mirror → 0 (non NaN, non crash) ─────────────────

test('feedbackRewardPriority: priority cifrata senza mirror → fascia 0', () => {
  assert.equal(C.feedbackRewardPriority({ priority: 'FENC1:deadbeef' }), 0);
});

// ─── c. retrocompat: priority intera legacy senza mirror ─────────────────────

test('feedbackRewardPriority: priority in chiaro legacy usata senza mirror', () => {
  for (const p of [0, 1, 2, 3]) {
    assert.equal(C.feedbackRewardPriority({ priority: p }), p);
  }
  // Assente/malformata → 0.
  assert.equal(C.feedbackRewardPriority({}), 0);
  assert.equal(C.feedbackRewardPriority(null), 0);
  assert.equal(C.feedbackRewardPriority({ priority: 'boh' }), 0);
});

// ─── d. fine-a-fine: doc di produzione (priority FENC1 + mirror) → premio giusto ──

test('premio risoluzione: doc con priority FENC1 e priorityPublic 2 → 200 crediti (non 50)', () => {
  const doc = { _id: 'x', statusPublic: 'closed', priority: 'FENC1:ciphertext-opaco', priorityPublic: 2 };
  const credits = C.rewardForPriority(C.feedbackRewardPriority(doc));
  assert.equal(credits, 200, 'priorità 2 deve premiare 200, non la fascia minima');
  // Il caso rotto pre-fix (senza mirror) resta alla fascia minima ma NON NaN.
  const broken = { _id: 'y', statusPublic: 'closed', priority: 'FENC1:ciphertext-opaco' };
  assert.equal(C.rewardForPriority(C.feedbackRewardPriority(broken)), 50);
});

// ─── e. l'entry di coda porta il mirror in chiaro ─────────────────────────────

test('buildCreateEntry: entry con priority 3 porta anche priorityPublic 3', () => {
  const entry = buildCreateEntry({ text: 'test', name: 'titolo', priority: 3 });
  assert.equal(entry.priority, 3);
  assert.equal(entry.priorityPublic, 3, 'il mirror in chiaro deve essere nella entry');
});

// ─── f. gate ON: priority cifrata nel file, mirror in chiaro ──────────────────

test('queueFeedbackCreateEncrypted gate ON: priority FENC1 nel file, priorityPublic resta intero', async () => {
  const { pub } = await genTestKeys();
  const savedPub = globalThis.SN_FEEDBACK_PUBKEY;
  const savedFlag = globalThis.SN_FEEDBACK_ENC_ENABLED;
  globalThis.SN_FEEDBACK_PUBKEY = pub;
  globalThis.SN_FEEDBACK_ENC_ENABLED = true;
  try {
    assert.ok(CR.isEnabled(), 'gate deve essere ON');
    const file = await queueFeedbackCreateEncrypted({
      text: 'test mirror priorità', name: 'test priorityPublic', priority: 2,
    });
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.ok(typeof saved.priority === 'string' && saved.priority.startsWith('FENC1:'),
      'priority nel file deve restare cifrata');
    assert.equal(saved.priorityPublic, 2, 'priorityPublic deve restare 2 in chiaro nel file');
  } finally {
    globalThis.SN_FEEDBACK_PUBKEY = savedPub;
    globalThis.SN_FEEDBACK_ENC_ENABLED = savedFlag;
  }
});
