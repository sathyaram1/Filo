// #914: in Gestione un feedback che ha saltato i giudici alla nascita (routine, sessione per le routine, lavoro
// locale) lo dice, e non sembra «da ri-giudicare»; i ruoli di chi risolve rimandano il lavoro solo locale.

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

// Chi risolve per una routine non apre lavoro locale: rimanda nei Ricevuti col motivo di --serve-locale.
test('i tre ruoli di chi risolve dicono come rimandare un lavoro che si fa solo in locale', async () => {
  const { espandiInclusioni } = await import('../../scripts/lib/role-text.mjs');
  const { readFileSync } = await import('node:fs');
  const dir = join(__dirname, '..', '..', 'routines', 'roles');
  for (const ruolo of ['resolver.md', 'resolver-rebase.md', 'resolver-ripresa.md']) {
    const t = espandiInclusioni(readFileSync(join(dir, ruolo), 'utf8'), dir);
    assert.match(t, /deliver status --status design --reason locale/, ruolo);
    assert.match(t, /le\s+routine non ne aprono/, ruolo);
  }
});

test('«richiede lavoro locale» dice il vero secondo chi ha aperto il feedback', () => {
  const rimandato = (over) => ({ status: 'design', statusReason: 'locale', notes: 'Richiede lavoro locale.', ...over });
  const owner = MR.judgesNote(rimandato({ clientId: 'owner:me', senderProof: 'admin' })).text;
  const sessione = MR.judgesNote(rimandato({ clientId: 'local:claude', senderProof: 'admin' })).text;
  const routine = MR.judgesNote(rimandato({ clientId: 'routine:residuo', senderProof: 'server' })).text;
  const utente = MR.judgesNote(rimandato({ clientId: 'utente-1' })).text;
  const senzaProva = MR.judgesNote(rimandato({ clientId: 'owner:me' })).text;
  const approvato = MR.judgesNote(rimandato({ clientId: 'utente-2', localApproval: { by: 'owner', at: 1 } })).text;
  for (const t of [owner, sessione, approvato]) {
    assert.match(t, /Solo lavoro locale/);
    assert.doesNotMatch(t, /💻 Lavoro locale/);
  }
  // Routine e utenti (#913): la frase porta al sì dell'owner, che è anche il tasto principale nei Ricevuti.
  for (const t of [routine, utente, senzaProva]) {
    assert.match(t, /Con «💻 Lavoro locale» lo lavora e lo chiude una sessione/);
    assert.doesNotMatch(t, /non si lavorano/);
  }
  const tasto = MR.ownerActions(rimandato({ clientId: 'routine:residuo', senderProof: 'server' })).find((a) => a.key === 'accept_local');
  assert.ok(tasto && tasto.primary, 'su una routine rimandata «💻 Lavoro locale» è il tasto principale');
});
