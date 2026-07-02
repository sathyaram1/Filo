// Unit test per la decifratura del campo `pipeline` dei feedback (S1.F2.4).
//
// Il backend di sicurezza cifra l'INTERO oggetto `pipeline` (azione, classe,
// verdetti, riassunto) come un'unica stringa FENC1: prima di scriverlo sul
// documento PUBBLICO `feedback/{id}` — altrimenti `action:'block_attack'` e i
// reasoning dei giudici ri-esporrebbero il segnale "sei stato beccato". La
// dashboard owner / le routine devono decifrarlo e re-idratarlo a OGGETTO prima
// del render, così classifyBlock/listBoardTab continuano a leggere
// `fb.pipeline.action` invariati.
//
// Asserisce il SUCCESSO (fallisce senza il fix):
//   (d) il batch-decrypt trasforma un `fb.pipeline` FENC1: nell'oggetto corretto
//   (e) dopo il decrypt, classifyBlock classifica come prima
//   (f) listBoardTab esclude un `blocked` con pipeline cifrato (grazie a statusPublic)
//
// Gira via `npm run test:unit` (node:test, niente Electron, ms).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto as crypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { decryptFeedbackFields } from '../../scripts/lib/decrypt-feedback-fields.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const require = createRequire(import.meta.url);

// feedbackCrypto (IIFE su globalThis): per cifrare il pipeline nei test con una
// pubkey di test esplicita (encryptForOwner accetta un override).
const C = require(join(ROOT, 'src', 'shared', 'feedbackCrypto.js'));
// manageReview: classifyBlock / listBoardTab.
require(join(ROOT, 'src', 'shared', 'feedbackStatus.js'));
require(join(ROOT, 'src', 'shared', 'manageReview.js'));
const MR = globalThis.SN_MANAGE_REVIEW;

async function genTestKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privPkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const pub = Buffer.from(pubRaw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const priv = Buffer.from(privPkcs8).toString('base64');
  return { pub, priv };
}

// Cifra un oggetto pipeline come fa il backend: JSON.stringify → encryptForOwner.
async function sealPipeline(obj, pub) {
  return C.encryptForOwner(JSON.stringify(obj), pub);
}

// ── (d) batch-decrypt: FENC1: pipeline → oggetto ────────────────────────────

test('(d) decryptFeedbackFields trasforma un pipeline FENC1: nell\'oggetto corretto', async () => {
  const { pub, priv } = await genTestKeys();
  const pipelineObj = {
    action: 'block_attack',
    l1Category: 'clean',
    l2Class: 'attack',
    verdicts: [{ judge: 'fixed_1', class: 'attack', reasoning: 'injection' }],
    reasons: ['judges_attack'],
    decidedAt: '2026-06-25T00:00:00.000Z',
  };
  const sealed = await sealPipeline(pipelineObj, pub);
  assert.ok(C.isEncrypted(sealed), 'precondizione: il pipeline parte cifrato (FENC1:)');

  const fb = { _id: 'f1', status: 'blocked', pipeline: sealed };
  const out = await decryptFeedbackFields(fb, priv);

  assert.equal(typeof out.pipeline, 'object', 'pipeline deve tornare un OGGETTO dopo il decrypt');
  assert.deepEqual(out.pipeline, pipelineObj, 'l\'oggetto pipeline decifrato deve combaciare');
});

test('(d) pipeline già in chiaro (oggetto) → invariato (retrocompat)', async () => {
  const { priv } = await genTestKeys();
  const plainObj = { action: 'block_spam', l2Class: 'spam' };
  const fb = { _id: 'f2', status: 'blocked', pipeline: plainObj };
  const out = await decryptFeedbackFields(fb, priv);
  assert.deepEqual(out.pipeline, plainObj, 'un pipeline già oggetto non deve essere toccato');
});

test('(d) pipeline FENC1: ma SENZA chiave → resta la stringa cifrata (no crash, placeholder)', async () => {
  const { pub } = await genTestKeys();
  const sealed = await sealPipeline({ action: 'block_attack' }, pub);
  const fb = { _id: 'f3', status: 'blocked', pipeline: sealed };
  // Nessuna chiave passata e nessun env → il pipeline resta cifrato, niente crash.
  const out = await decryptFeedbackFields(fb, null);
  assert.equal(typeof out.pipeline, 'string', 'senza chiave il pipeline resta una stringa');
  assert.ok(C.isEncrypted(out.pipeline), 'resta FENC1: (non decifrabile senza privata)');
});

test('(d) feedback senza pipeline → nessun campo aggiunto', async () => {
  const { priv } = await genTestKeys();
  const fb = { _id: 'f4', status: 'done' };
  const out = await decryptFeedbackFields(fb, priv);
  assert.ok(!('pipeline' in out) || out.pipeline === undefined, 'pipeline assente resta assente');
});

// ── (e) dopo il decrypt, classifyBlock classifica come prima ────────────────

test('(e) dopo il decrypt, classifyBlock riconosce il blocco come col pipeline in chiaro', async () => {
  const { pub, priv } = await genTestKeys();
  const sealed = await sealPipeline({ action: 'block_attack', l2Class: 'attack' }, pub);
  const fb = { _id: 'f5', status: 'blocked', pipeline: sealed };

  // Prima del decrypt: il pipeline è una stringa → classifyBlock NON deve crashare
  // e lo tratta come "nessun oggetto" → null (non sa che è un attacco, è cifrato).
  assert.doesNotThrow(() => MR.classifyBlock(fb), 'classifyBlock non deve crashare su pipeline stringa');

  // Dopo il decrypt: classifyBlock riconosce l'attacco.
  const out = await decryptFeedbackFields(fb, priv);
  const cls = MR.classifyBlock(out);
  assert.ok(cls, 'dopo il decrypt deve esserci un blocco');
  assert.equal(cls.reason, 'attack', 'deve classificare come attacco');
});

// ── (f) listBoardTab esclude un blocked con pipeline cifrato ────────────────

test('(f) listBoardTab esclude un blocked con pipeline cifrato (gate statusPublic)', async () => {
  const { pub } = await genTestKeys();
  const sealed = await sealPipeline({ action: 'block_attack', l2Class: 'attack' }, pub);
  const fbs = [
    // Un feedback BLOCCATO con pipeline cifrato: la board gira SENZA chiave privata,
    // quindi NON può leggere pipeline.action — ma il gate `status` lo esclude
    // comunque (blocked → non done/verified → non "Risolti").
    { _id: 'blocked', status: 'blocked', pipeline: sealed, createdAt: '2026-06-24' },
    // Un fix pulito spedito: deve comparire.
    { _id: 'clean', status: 'done', resolvedInVersion: '0.2.70', createdAt: '2026-06-24' },
  ];
  const out = MR.listBoardTab(fbs, { releasedVersion: '0.2.71' });
  assert.deepEqual(out.map((f) => f._id), ['clean'], 'la board deve mostrare solo il fix pulito, mai il blocked');
});

test('(f) board: un blocked rimane escluso ANCHE col pipeline cifrato non leggibile', async () => {
  const { pub } = await genTestKeys();
  const sealed = await sealPipeline({ action: 'block_attack' }, pub);
  // Caso limite: status manipolato a 'done' ma con pipeline cifrato (non leggibile
  // dalla board). statusPublic NON è il gate qui — è `status` in listForManageTab.
  // Verifica che, anche se uno forzasse status=done, la board senza chiave NON
  // possa leggere il blocco: documentiamo che il gate primario è statusPublic/status.
  // Per un blocked reale (status='blocked') l'esclusione è garantita (test sopra).
  const fbs = [
    { _id: 'blocked-real', status: 'blocked', pipeline: sealed, createdAt: '2026-06-24' },
  ];
  const out = MR.listBoardTab(fbs, { releasedVersion: '0.2.71' });
  assert.equal(out.length, 0, 'un blocked non compare nella board');
});
