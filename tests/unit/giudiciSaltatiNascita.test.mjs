// #914/#1148: in Gestione un feedback fidato che ha saltato i giudici alla nascita lo dice, e non sembra «da
// ri-giudicare»; senza la fiducia il segno non vale. I ruoli di chi risolve rimandano il lavoro solo locale.

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
  _id: 'r1', status: 'aligned', clientId: 'routine:residuo', senderProof: 'server', fiducia: 'fidato', pipeline: pipeline('routine_proven'), ...over,
});

test('una routine fidata nei Ricevuti: niente «da ri-giudicare», la nota dice perché mancano i giudici', () => {
  const fb = routine();
  assert.equal(MR.classifyLegacyBlock(fb), null);
  assert.equal(MR.judgesSkippedText(fb), 'Aperto da un lavoro fidato: i giudici non servono.');
  const nota = MR.judgesNote(fb);
  assert.equal(nota.text, 'Aperto da un lavoro fidato: i giudici non servono. Aspetta la tua approvazione.');
  assert.doesNotMatch(nota.text, /Tutti d’accordo/);
  assert.equal(MR.manageTabFor(fb), 'inbox');
});

test('il fidato nato da te o da una sessione pulita, il lavoro locale e i documenti di prima hanno la loro frase', () => {
  const sessione = { status: 'todo', clientId: 'local:claude', senderProof: 'admin', fiducia: 'fidato', pipeline: pipeline('fidato') };
  assert.equal(MR.judgesSkippedText(sessione), 'Fidato: i giudici non servono.');
  assert.equal(MR.classifyLegacyBlock(sessione), null);
  assert.equal(MR.judgesSkippedText({ ...sessione, pipeline: pipeline('local_proven') }), 'Lavoro locale fidato: i giudici non servono.');
  assert.match(MR.judgesSkippedText({ ...sessione, pipeline: pipeline('session_proven') }), /^Aperto da una sessione/);
});

test('il segno senza la fiducia, o un valore sconosciuto, non vale; la prova del mittente da sola non basta', () => {
  for (const fb of [
    routine({ fiducia: undefined }),
    routine({ fiducia: 'non_fidato' }),
    routine({ fiducia: 'FIDATO' }),
    routine({ pipeline: pipeline('qualunque') }),
    routine({ pipeline: null }),
  ]) {
    assert.equal(MR.judgesSkippedText(fb), '', JSON.stringify(fb));
    const nota = MR.judgesNote(fb);
    assert.doesNotMatch((nota && nota.text) || '', /I giudici non servono/);
  }
  // Mittente provato senza verdetti e senza segno: resta «da ri-giudicare», come prima.
  assert.equal(MR.classifyLegacyBlock(routine({ pipeline: pipeline(undefined) })).reason, 'unfiltered');
  assert.equal(MR.classifyLegacyBlock(routine({ fiducia: undefined })).reason, 'unfiltered', 'il segno senza fiducia non lo toglie dal ri-giudizio');
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

test('«richiede lavoro locale» dice il vero secondo la fiducia del feedback', () => {
  const rimandato = (over) => ({ status: 'design', statusReason: 'locale', notes: 'Richiede lavoro locale.', ...over });
  const owner = MR.judgesNote(rimandato({ clientId: 'owner:me', senderProof: 'admin', fiducia: 'fidato' })).text;
  const sessione = MR.judgesNote(rimandato({ clientId: 'local:claude', senderProof: 'admin', fiducia: 'fidato' })).text;
  const routine = MR.judgesNote(rimandato({ clientId: 'routine:residuo', senderProof: 'server' })).text;
  const utente = MR.judgesNote(rimandato({ clientId: 'utente-1' })).text;
  const senzaProva = MR.judgesNote(rimandato({ clientId: 'owner:me' })).text;
  const mioNonFidato = MR.judgesNote(rimandato({ clientId: 'owner:me', senderProof: 'admin' })).text;
  const approvato = MR.judgesNote(rimandato({ clientId: 'utente-2', localApproval: { by: 'owner', at: 1 } })).text;
  for (const t of [owner, sessione, approvato]) {
    assert.match(t, /Solo lavoro locale/);
    assert.doesNotMatch(t, /💻 Lavoro locale/);
  }
  // Routine e utenti (#913): la frase porta al sì dell'owner, che è anche il tasto principale nei Ricevuti.
  for (const t of [routine, utente, senzaProva, mioNonFidato]) {
    assert.match(t, /Con «💻 Lavoro locale» lo lavora e lo chiude una sessione/);
    assert.doesNotMatch(t, /non si lavorano/);
  }
  const tasto = MR.ownerActions(rimandato({ clientId: 'routine:residuo', senderProof: 'server' })).find((a) => a.key === 'accept_local');
  assert.ok(tasto && tasto.primary, 'su una routine rimandata «💻 Lavoro locale» è il tasto principale');
});

// Decisione dell'owner del 04/10: un lavoro di routine nato da un feedback d'utente aspetta la sua fusione.
const conOrigine = (status, statusReason, extra = {}) => routine({
  status, statusReason,
  pipeline: { ...pipeline('routine_proven'), origine: { id: 'o1', num: '#700', stato: 'aperta' }, ...extra },
});

test('chi aspetta l’origine lo dice col numero, nei Ricevuti, senza «da ri-giudicare»', () => {
  const fb = conOrigine('unlabeled', 'attesa_origine');
  assert.equal(MR.classifyLegacyBlock(fb), null);
  assert.equal(MR.manageTabFor(fb), 'inbox');
  assert.equal(MR.judgesNote(fb).text, 'Aspetta la fusione di #700, poi entra in coda da solo.');
  assert.equal(MR.reasonText('attesa_origine'), 'aspetta la fusione del feedback da cui nasce');
  // Non è un «non filtrato»: niente bordo bianco né «Ri-valuta», che il server su di lui non rifà.
  assert.equal(MR.classifyBlock(fb), null);
  assert.equal(MR.stateBadge(fb).label, 'In attesa');
  assert.equal(MR.classifyBlock(conOrigine('unlabeled', '')).reason, 'unfiltered');
});

test('bloccato con l’origine: rosso come un blocco di sicurezza, e il triangolo dice perché', () => {
  const fb = conOrigine('design', 'origine_bloccata', { l1Category: 'dangerous', l1Reasons: ['origine_bloccata'] });
  const b = MR.classifyBlock(fb);
  assert.equal(b.reason, 'origine_bloccata');
  assert.equal(b.color, '#c0392b');
  assert.match(MR.judgesNote(fb).text, /^Fermo perché il feedback da cui nasce \(#700\) è stato bloccato: decidi tu\.$/);
  const l1 = MR.livelloL1(fb);
  assert.equal(l1.esito, 'pericoloso');
  assert.ok(l1.pannello.righe.some((r) => r.valore.includes('il feedback da cui nasce è stato bloccato')));
  assert.equal(MR.manageTabFor(fb), 'inbox');
});

test('origine chiusa senza fusione o sparita: nei Ricevuti, e la frase lo dice al posto di «aspetta la tua approvazione»', () => {
  assert.equal(MR.judgesNote(conOrigine('aligned', 'origine_chiusa')).text, 'Il feedback da cui nasce (#700) si è chiuso senza fusione: decidi tu.');
  assert.equal(MR.judgesNote(conOrigine('aligned', 'origine_mancante')).text, 'Il feedback da cui nasce (#700) non c’è più: decidi tu.');
  assert.equal(MR.manageTabFor(conOrigine('aligned', 'origine_chiusa')), 'inbox');
});
