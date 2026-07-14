// Unit test per il recupero delle lavorazioni interrotte (scripts/apply-triage.mjs).
//
// Un'istanza cloud può morire a metà implementazione senza lasciare traccia
// (caso reale: crediti/budget esauriti — feedback #286/#304/#331 del 2026-07-14).
// Due difetti lo rendevano invisibile e permanente:
//   1. l'applier rilasciava il claim git anche quando l'entry applicata era
//      proprio `working` (la presa in carico): il lock e la spia "in
//      lavorazione" si spegnevano pochi secondi dopo l'acquisizione;
//   2. un `working` scaduto tornava `todo` senza memoria: un'istanza che muore
//      SEMPRE (crediti finiti) fa ping-pong todo↔working all'infinito.
//
// Senza il fix: claimOutlivesEntry non esisteva (il claim veniva rilasciato per
// ogni entry) e expiryOutcome nemmeno (il reset era un `todo` fisso). Questi
// assert diventano rossi se il claim torna a morire alla presa in carico o se
// le interruzioni ripetute smettono di arrendersi all'owner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  claimOutlivesEntry, expiryOutcome, EXPIRY_RESET_LIMIT,
} from '../../scripts/apply-triage.mjs';

test('il claim sopravvive SOLO alla presa in carico (entry working)', () => {
  assert.equal(claimOutlivesEntry('working'), true);
  // Ogni consegna rilascia il claim: il lavoro su quel feedback è finito.
  for (const s of ['todo', 'revision_capability', 'revision_security', 'done', 'design', 'archived']) {
    assert.equal(claimOutlivesEntry(s), false, `entry ${s} deve rilasciare il claim`);
  }
});

test('prime interruzioni: il feedback torna in coda e il contatore cresce', () => {
  assert.deepEqual(expiryOutcome(0), { status: 'todo', workingResets: 1 });
  assert.deepEqual(expiryOutcome(1), { status: 'todo', workingResets: 2 });
  // Contatore assente/sporco (doc storici senza campo, valori strani) = 0.
  assert.deepEqual(expiryOutcome(undefined), { status: 'todo', workingResets: 1 });
  assert.deepEqual(expiryOutcome(-5), { status: 'todo', workingResets: 1 });
});

test('alla soglia si arrende: design/loop con nota per l\'owner e contatore azzerato', () => {
  const out = expiryOutcome(EXPIRY_RESET_LIMIT - 1);
  assert.equal(out.status, 'design');
  assert.equal(out.reason, 'loop');
  assert.equal(out.workingResets, 0);
  // La nota deve esistere e spiegare il problema in italiano per l'owner
  // (finisce nella chat del feedback in dashboard).
  assert.ok(out.notes && out.notes.length > 50, 'nota per l\'owner mancante');
  // Oltre la soglia (contatore rimasto alto per una run persa): ancora design.
  assert.equal(expiryOutcome(EXPIRY_RESET_LIMIT + 2).status, 'design');
});

test('working→design e working→todo restano transizioni legali per la routine', async () => {
  // L'escalation passa dal validatore della macchina a stati: se queste
  // transizioni venissero ritirate, la riconciliazione fallirebbe in silenzio.
  await import('../../src/shared/feedbackStatus.js');
  const FS = globalThis.SN_FB_STATUS;
  assert.equal(FS.canTransition('working', 'todo', 'routine'), true);
  assert.equal(FS.canTransition('working', 'design', 'routine'), true);
});
