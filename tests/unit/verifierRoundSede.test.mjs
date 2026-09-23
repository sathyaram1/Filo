// La sede di ogni rilievo — interno o esterno — accanto al livello
// (src/shared/verifierRound.js, decisione dell'owner del 2026-09-22). Il giro
// conta solo gli interni; gli esterni escono a parte, ciascuno con la priorità
// uguale al livello. Le stesse regole le incorpora il server al deploy.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
require(resolve(ROOT, 'src', 'shared', 'feedbackTransitions.js'));
require(resolve(ROOT, 'src', 'shared', 'verifierRound.js'));
const R = globalThis.SN_VERIFIER_ROUND;
const CAPS = { cap2: 5, cap1: 2, cap0: 0 };

const f = (level, sede, text, decision = false) => ({ level, sede, text, decision });
const decide = (findings, counts = {}, caps = CAPS) => R.decideRound({ findings, caps, counts });
const livelli = (list) => list.map((x) => `${x.level}${x.sede}`);

// ── Il formato ───────────────────────────────────────────────────────────────

test('parseFindings legge la lettera: i interno, e esterno, il ? dopo la lettera', () => {
  const p = R.parseFindings([
    'Provato: allega un docx e un pdf. Il pdf si allega.',
    '[2i] Il docx non si allega: il pulsante resta grigio.',
    '    Passi: apri l\'editor, trascina un docx.',
    '- [2e] Preferenze aperta in due schede cancella le modifiche fatte altrove.',
    '**[1i?]** Il bordo del riquadro è grigio freddo: caldo come il resto? Scelta di gusto.',
    '[3E] I dati escono con un collegamento scritto in chat.',
  ].join('\n'));
  assert.equal(p.rifiutati.length, 0);
  assert.deepEqual(p.findings.map((x) => [x.level, x.sede, x.decision]), [[2, 'i', false], [2, 'e', false], [1, 'i', true], [3, 'e', false]]);
  assert.match(p.findings[0].text, /^Il docx non si allega[\s\S]*Passi: apri/);
  assert.equal(p.summary, 'Provato: allega un docx e un pdf. Il pdf si allega.');
});

test('il segno ? vale anche prima della lettera: stesso significato, nessun giro perso', () => {
  const p = R.parseFindings('[1?i] scelta di gusto\n[2?e] domanda su un altro lavoro');
  assert.deepEqual(p.findings.map((x) => [x.level, x.sede, x.decision]), [[1, 'i', true], [2, 'e', true]]);
});

test('la lettera è obbligatoria: il vecchio «[2] testo» è rifiutato con la spiegazione, non letto come interno', () => {
  const p = R.parseFindings('Provato tutto.\n[2] Il pulsante non salva.\n    Passi: apri, premi Salva.\n[1i] bordo');
  assert.equal(p.findings.length, 1, 'il rilievo senza lettera non è un rilievo');
  assert.equal(p.findings[0].sede, 'i');
  assert.equal(p.rifiutati.length, 1);
  assert.match(p.rifiutati[0], /^\[2\] Il pulsante non salva\. \(manca la sede/);
  assert.match(p.rifiutati[0], /«i»[\s\S]*«e»[\s\S]*\[2i\]/);
  assert.doesNotMatch(p.summary, /pulsante/, 'e non finisce nel riassunto');
  // La stessa riga la elenca chi respinge la registrazione, con la stessa spiegazione.
  const brutte = R.unparsedLevelLines('Provato tutto.\n[2] Il pulsante non salva.\n[1i] bordo');
  assert.equal(brutte.length, 1);
  assert.equal(brutte[0], p.rifiutati[0]);
  // In ogni modo di elencare, e col segno «?».
  for (const riga of ['- [2] x', '1. [3?] x', '### [0] x', '**[1]** x']) {
    assert.equal(R.unparsedLevelLines(riga).length, 1, riga);
    assert.match(R.unparsedLevelLines(riga)[0], /manca la sede/);
  }
});

test('una lettera che non è i né e resta un livello scritto male', () => {
  assert.equal(R.parseFindings('[2x] boh').findings.length, 0);
  assert.equal(R.unparsedLevelLines('[2x] boh').length, 1);
  assert.equal(R.unparsedLevelLines('[2i] bene\n[1e?] bene').length, 0);
});

test('normalizeFindings: un rilievo strutturato senza sede vale interno (client non aggiornati, stato già scritto)', () => {
  const out = R.normalizeFindings([{ level: 2, text: 'vecchio' }, { level: 1, sede: 'E', text: 'nuovo' }, { level: 0, sede: 'boh', text: 'storto' }]);
  assert.deepEqual(out.map((x) => x.sede), ['i', 'e', 'i']);
});

test('formatFinding scrive la lettera, e il ? dopo', () => {
  assert.equal(R.formatFinding(f(2, 'i', 'rotto')), '- [2i] rotto');
  assert.equal(R.formatFinding(f(1, 'e', 'altrove', true)), '- [1e?] altrove');
  assert.equal(R.formatFinding({ level: 0, text: 'senza sede' }), '- [0i] senza sede');
  // Andata e ritorno: quello che scrive, lo rilegge uguale.
  const p = R.parseFindings(R.formatFindings([f(3, 'e', 'grave'), f(1, 'i', 'lieve', true)]));
  assert.deepEqual(p.findings, [f(3, 'e', 'grave'), f(1, 'i', 'lieve', true)]);
});

test('primaFrase: il titolo di un feedback derivato è la prima frase del rilievo', () => {
  assert.equal(R.primaFrase('Il docx non si allega: il pulsante resta grigio. Passi: apri l\'editor.'), 'Il docx non si allega: il pulsante resta grigio.');
  assert.equal(R.primaFrase('Senza punto\nseconda riga'), 'Senza punto');
  assert.equal(R.primaFrase('x'.repeat(300)).length, 120);
});

// ── La regola del giro ───────────────────────────────────────────────────────

test('solo gli interni contano: un 2e non chiede correzione, un 2i sì', () => {
  const soloEsterno = decide([f(2, 'e', 'altrove')]);
  assert.equal(soloEsterno.stop, false);
  assert.deepEqual(soloEsterno.fix, []);
  assert.deepEqual(livelli(soloEsterno.external), ['2e']);
  assert.equal(soloEsterno.consume, null, 'pass: nessun bilancio consumato');
  const interno = decide([f(2, 'i', 'qui')]);
  assert.deepEqual(livelli(interno.fix), ['2i']);
  assert.equal(interno.consume, 'cap2');
});

test('gli esterni tornano a parte, ciascuno con la priorità uguale al livello, in ogni esito', () => {
  const r = decide([f(3, 'e', 'grave altrove'), f(2, 'i', 'qui'), f(0, 'e', 'cosmetico altrove'), f(1, 'e', 'raro altrove', true)]);
  assert.deepEqual(r.external.map((x) => [x.level, x.priority, x.decision]), [[3, 3, false], [0, 0, false], [1, 1, true]]);
  assert.deepEqual(livelli(r.fix), ['2i']);
  // Anche a lavoro fermo: sono di un altro lavoro, e ne escono.
  const fermo = decide([f(2, 'i', 'qui', true), f(2, 'e', 'altrove')]);
  assert.equal(fermo.stop, true);
  assert.deepEqual(livelli(fermo.external), ['2e']);
  assert.equal(fermo.external[0].priority, 2);
});

test('pass con soli esterni: nessun interno da correggere, il lavoro passa', () => {
  const r = decide([f(3, 'e', 'a'), f(2, 'e', 'b'), f(1, 'e', 'c', true)]);
  assert.equal(r.stop, false);
  assert.deepEqual(r.fix, []);
  assert.deepEqual(r.derived, []);
  assert.equal(r.external.length, 3);
  assert.equal(r.consume, null);
  assert.match(R.roundNote({ summary: 'ok', findings: [f(2, 'e', 'b')], decision: r }), /esterno[\s\S]*Nessun rilievo interno: il lavoro prosegue/);
});

test('un esterno col ? non ferma: diventa un derivato con la domanda dentro; un interno col ? di livello 2 ferma', () => {
  const esterno = decide([f(3, 'e', 'scelta su un altro lavoro', true)]);
  assert.equal(esterno.stop, false);
  assert.deepEqual(esterno.blocking, []);
  assert.equal(esterno.external[0].decision, true);
  assert.equal(esterno.external[0].priority, 3);
  const interno = decide([f(2, 'i', 'scelta su questo lavoro', true)]);
  assert.equal(interno.stop, true);
  assert.deepEqual(livelli(interno.blocking), ['2i']);
});

test('i bilanci li consumano solo gli interni: un 2e non paga cap2, un 1e non paga cap1', () => {
  const r = decide([f(2, 'e', 'altrove')], { count2: 4 });
  assert.equal(r.consume, null);
  assert.equal(r.budgets.cap2.left, 1, 'il bilancio dei 2 non si è mosso');
  // A cap2 finito un 2e non ferma niente: non è di questo lavoro.
  const finito = decide([f(2, 'e', 'altrove')], { count2: 5 });
  assert.equal(finito.stop, false);
  assert.equal(finito.external.length, 1);
  // E un 1e da solo non consuma cap1, mentre un 1i lo consuma.
  assert.equal(decide([f(1, 'e', 'altrove')]).consume, null);
  assert.equal(decide([f(1, 'i', 'qui')]).consume, 'cap1');
});

test('gli interni messi da parte dal bilancio portano anche loro la priorità uguale al livello', () => {
  const r = decide([f(1, 'i', 'lieve')], { count1: 2 });
  assert.deepEqual(r.fix, []);
  assert.deepEqual(r.derived.map((x) => [x.level, x.sede, x.priority]), [[1, 'i', 1]]);
  assert.deepEqual(r.external, []);
});

test('roundNote dice quanti esterni escono, e che il lavoro si ferma solo per un interno', () => {
  const fermo = decide([f(2, 'i', 'qui', true), f(2, 'e', 'altrove')]);
  const nota = R.roundNote({ summary: 's', findings: [f(2, 'i', 'qui', true), f(2, 'e', 'altrove')], decision: fermo });
  assert.match(nota, /Un rilievo è esterno/);
  assert.match(nota, /rilievo interno di livello 2 o 3/);
  assert.match(nota, /- \[2i\?\] qui\n- \[2e\] altrove/);
});
