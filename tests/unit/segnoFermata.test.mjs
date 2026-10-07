// Il segno dei Ricevuti (#603, D93): la forma del livello che ha fermato la pratica, mai il solo colore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackStatus.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'manageReview.js'));
const MR = globalThis.SN_MANAGE_REVIEW;

const forma = (fb, opts) => (MR.segnoFermata(fb, opts) || {}).forma || null;

test('«bloccato dalla sicurezza» e «attacco» hanno lo stesso rosso ma forme diverse', () => {
  const sicurezza = { _id: 'a', seq: 1, status: 'design', statusReason: 'secaudit' };
  const attacco = { _id: 'b', seq: 2, status: 'attack', pipeline: { verdicts: [{ judge: 'x', class: 'attack' }] } };
  assert.equal(MR.classifyBlock(sicurezza).color, MR.classifyBlock(attacco).color);
  assert.equal(forma(sicurezza), 'pentagono');
  assert.equal(forma(attacco), 'cerchio');
  assert.notEqual(MR.segnoFermata(sicurezza).testo, MR.segnoFermata(attacco).testo);
});

test('ogni motivo dei Ricevuti ha un segno, con la forma del suo livello', () => {
  const casi = [
    [{ status: 'design', statusReason: 'l5' }, 'quadrato', 'l5'],
    [{ status: 'design', statusReason: 'clarify' }, 'rombo', 'l3'],
    [{ status: 'design', statusReason: 'decisione' }, 'rombo', 'l3'],
    [{ status: 'design', statusReason: 'loop' }, 'rombo', 'l3'],
    [{ status: 'design', statusReason: 'arenato' }, 'rombo', 'l3'],
    [{ status: 'design', statusReason: 'locale' }, 'rombo', 'l3'],
    [{ status: 'design', statusReason: 'judges' }, 'cerchio', 'l2'],
    [{ status: 'design' }, 'cerchio', 'l2'],
    [{ status: 'attack', pipeline: { action: 'block_attack', l1Category: 'dangerous' } }, 'triangolo', 'l1'],
    [{ status: 'spam', pipeline: { action: 'block_spam' } }, 'triangolo', 'l1'],
    [{ status: 'spam', pipeline: { verdicts: [{ class: 'spam' }] } }, 'cerchio', 'l2'],
    [{ status: 'suspicious_file' }, 'triangolo', 'l1'],
    [{ status: 'unlabeled' }, 'cerchio', 'l2'],
    [{ status: 'aligned', pipeline: { verdicts: [{ class: 'aligned' }] } }, 'cerchio', 'l2'],
  ];
  for (const [fb, f, liv] of casi) {
    const s = MR.segnoFermata(fb);
    assert.ok(s, JSON.stringify(fb));
    assert.equal(s.forma, f, JSON.stringify(fb));
    assert.equal(s.livello, liv, JSON.stringify(fb));
    assert.ok(MR.FORME_SVG[s.forma], s.forma);
    assert.ok(s.testo && !/secaudit|clarify|undefined/.test(s.testo), s.testo);
  }
});

test('una fusione ferma porta il quadrato anche prima che lo stato arrivi al cancello', () => {
  const fb = { _id: 'id-9', seq: 9, status: 'revision_security' };
  assert.equal(forma(fb), null);
  assert.equal(forma(fb, { fusioni: { pending: [{ feedbackId: 'id-9' }] } }), 'quadrato');
});

test('il segno sparisce quando la risposta parte (la pratica torna in coda)', () => {
  const fb = { status: 'design', statusReason: 'clarify' };
  assert.equal(forma(fb), 'rombo');
  for (const status of ['todo', 'working', 'done', 'archived', 'attack_confirmed']) {
    assert.equal(MR.segnoFermata({ ...fb, status }), null, status);
  }
});

test('stato illeggibile o feedback assente: nessun segno inventato', () => {
  assert.equal(MR.segnoFermata(null), null);
  const cifrato = { status: 'FENC1:AAAA', statusPublic: 'open' };
  assert.equal(MR.statusUnreadable(cifrato), true);
  assert.equal(MR.segnoFermata(cifrato), null);
});
