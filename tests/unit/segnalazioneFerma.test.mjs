// Sentinelle del giro «il dubbio ferma»: allo stop i rilievi interni non
// bloccanti restano davanti a chi riprende; i testi che insegnano il formato
// della critica portano la sede; il rombo di una pratica ferma non si ripete.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildVerifierBrief } from '../../scripts/verify-local.mjs';
import { verifierReplyText } from '../../scripts/dispatch.mjs';
import { perimetroNote } from '../../scripts/lib/verifier-scope.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED = join(__dirname, '..', '..', 'src', 'shared');
require(join(SHARED, 'feedbackTransitions.js'));
require(join(SHARED, 'verifierRound.js'));
require(join(SHARED, 'feedbackStatus.js'));
require(join(SHARED, 'feedbackThread.js'));
require(join(SHARED, 'manageReview.js'));

const V = globalThis.SN_VERIFIER_ROUND;
const MR = globalThis.SN_MANAGE_REVIEW;
const CAPS = { cap3: 10, cap2: 10, cap1: 1, cap0: 0 };
const F = (s) => V.parseFindings(s).findings;
const decide = (s, counts = {}) => V.decideRound({ findings: F(s), caps: CAPS, counts });

test('allo stop gli altri interni della critica sono «sospesi»: restano con quello che ha fermato, senza pagare niente', () => {
  const d = decide('[2i?] a\n[1i] b\n[0i] c\n[1e] d');
  assert.equal(d.stop, true);
  assert.deepEqual(d.blocking.map((f) => f.text), ['a']);
  assert.deepEqual(d.sospesi.map((f) => f.text), ['b', 'c']);
  assert.deepEqual(d.external.map((f) => f.text), ['d']);
  assert.equal(d.consume, null);
  assert.deepEqual(d.counts, { count2: 0, count1: 0, count0: 0 });
  // A bilancio del 2 esaurito, uguale.
  const d2 = decide('[2i] a\n[1i] b', { count2: 10 });
  assert.deepEqual(d2.sospesi.map((f) => f.text), ['b']);
  // Fuori dallo stop non c'è niente di sospeso.
  assert.deepEqual(decide('[2i] a\n[1i] b').sospesi, []);
});

test('la nota per la chat e la risposta stampata dicono che i sospesi restano davanti a chi riprende', () => {
  const findings = F('[2i?] a\n[1i] b');
  const decision = decide('[2i?] a\n[1i] b');
  assert.match(V.roundNote({ summary: '', findings, decision }), /Un altro rilievo interno resta davanti a chi riprende/);
  const stampa = verifierReplyText({ outcome: 'stop', blocking: decision.blocking, sospesi: decision.sospesi, derived: [] });
  assert.match(stampa, /restano davanti a chi riprende/);
  assert.match(stampa, /\[1i\] b/);
  // Fermo per la segnalazione allegata: lo dice, e i rilievi da correggere restano.
  const perSegnalazione = verifierReplyText({ outcome: 'stop', motivo: 'segnalazione', blocking: [], sospesi: F('[2i] x'), derived: [] });
  assert.match(perSegnalazione, /segnalazione è consegnata all'owner/);
  assert.match(perSegnalazione, /\[2i\] x/);
});

test('il compito della verifica locale insegna il formato che il lettore accetta', () => {
  const brief = buildVerifierBrief({ request: 'Prova.', branch: 'claude/prova', recipe: '', history: [], scope: 'pieno', perimetro: [] });
  const esempi = brief.split('\n').filter((l) => /^\s*\[\d/.test(l));
  assert.ok(esempi.length >= 2, 'il compito porta righe d\'esempio');
  for (const riga of esempi) {
    assert.deepEqual(V.unparsedLevelLines(riga), [], riga);
    assert.equal(V.parseFindings(riga).findings.length, 1, riga);
  }
  assert.doesNotMatch(brief, /`\[1\?\]`/);
  assert.match(brief, /sede/);
});

test('il perimetro del giro stretto scrive i rilievi con la sede, nella forma di ripiego', () => {
  const nota = perimetroNote('chiusura', { rilievi: [{ level: 2, sede: 'e', text: 'x', decision: true }, { level: 1, text: 'y' }] });
  assert.match(nota, /- \[2e\?\] x/);
  assert.match(nota, /- \[1i\] y/);
});

test('rombo di una pratica ferma per una scelta: la segnalazione si legge una volta sola', () => {
  const testo = '## Problema\nDue strade.\n## Scelte\n- A\n- B\n## Cosa ho fatto nel frattempo\nA.';
  const fb = {
    status: 'design', statusReason: 'decisione',
    notes: `Ho implementato il salvataggio.\n\nSegnalazione per l'owner (chi verifica):\n${testo}`,
    livelli: { l3: { esito: 'segnalato', ruolo: 'verifier', at: '2026-09-22T09:15:00.000Z', testo } },
  };
  const forma = MR.livelloL3(fb);
  assert.equal(forma.pannello.testo.split('Due strade.').length - 1, 1);
  assert.doesNotMatch(forma.pannello.testo, /Ho implementato/);
  // Coi soli chiarimenti (nessuna segnalazione registrata) la domanda resta quella della conversazione.
  const chiarimenti = MR.livelloL3({ status: 'design', statusReason: 'clarify', notes: 'Quale dei due nomi preferisci?' });
  assert.match(chiarimenti.pannello.testo, /Quale dei due nomi/);
});
