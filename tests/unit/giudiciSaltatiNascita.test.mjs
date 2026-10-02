// #914: in Gestione un feedback che ha saltato i giudici alla nascita (routine, sessione per le routine, lavoro
// locale) lo dice, e non sembra «da ri-giudicare»; senza mittente provato il segno del pipeline non conta.

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

const pipeline = (skipped) => ({ skipped, verdicts: [], l1Category: null, l2Class: null, action: 'human_review', stage: 'nascita' });
const routine = (over = {}) => ({
  _id: 'r1', status: 'aligned', clientId: 'routine:residuo', senderProof: 'server', pipeline: pipeline('routine_proven'), ...over,
});

test('una routine provata nei Ricevuti: niente «da ri-giudicare», la nota dice perché mancano i giudici', () => {
  const fb = routine();
  assert.equal(MR.classifyLegacyBlock(fb), null);
  assert.match(MR.judgesSkippedText(fb), /routine.*prova del server.*I giudici non servono/);
  const nota = MR.judgesNote(fb);
  assert.match(nota.text, /I giudici non servono\. Aspetta la tua approvazione\./);
  assert.doesNotMatch(nota.text, /Tutti d’accordo/);
  assert.equal(MR.manageTabFor(fb), 'inbox');
});

test('sessione per le routine e lavoro locale hanno la loro frase', () => {
  const sessione = { status: 'todo', clientId: 'local:claude', senderProof: 'admin', pipeline: pipeline('session_proven') };
  assert.match(MR.judgesSkippedText(sessione), /sessione per le routine/);
  assert.equal(MR.classifyLegacyBlock(sessione), null);
  const locale = { ...sessione, pipeline: pipeline('local_proven') };
  assert.match(MR.judgesSkippedText(locale), /Lavoro locale/);
});

test('il segno senza mittente provato, o un valore sconosciuto, non vale', () => {
  for (const fb of [
    routine({ senderProof: undefined }),
    routine({ clientId: 'utente-1' }),
    routine({ pipeline: pipeline('qualunque') }),
    routine({ pipeline: null }),
  ]) {
    assert.equal(MR.judgesSkippedText(fb), '', JSON.stringify(fb));
    const nota = MR.judgesNote(fb);
    assert.doesNotMatch((nota && nota.text) || '', /I giudici non servono/);
  }
  // Fidato senza verdetti e senza segno: resta «da ri-giudicare», come prima.
  assert.equal(MR.classifyLegacyBlock(routine({ pipeline: pipeline(undefined) })).reason, 'unfiltered');
});
