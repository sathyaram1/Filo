// La sede di ogni rilievo — interno o esterno — accanto al livello
// (src/shared/verifierRound.js, decisioni dell'owner del 2026-09-22 e #2339). Il giro
// conta solo gli interni; gli esterni non prendono livello ed escono a parte senza priorità.

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
const CAPS = { cap3: 5, cap2: 5, cap1: 2 };

const f = (level, sede, text, decision = false) => ({ level, sede, text, decision });
const decide = (findings, counts = {}, caps = CAPS) => R.decideRound({ findings, caps, counts });
const livelli = (list) => list.map((x) => `${x.level == null ? '' : x.level}${x.sede}`);

// ── Il formato ───────────────────────────────────────────────────────────────

test('parseFindings legge la lettera: i interno col livello, e esterno senza, il ? dopo la lettera', () => {
  const p = R.parseFindings([
    'Provato: allega un docx e un pdf. Il pdf si allega.',
    '[2i] Il docx non si allega: il pulsante resta grigio.',
    '    Passi: apri l\'editor, trascina un docx.',
    '- [e] Preferenze aperta in due schede cancella le modifiche fatte altrove.',
    '**[1i?]** Il bordo del riquadro è grigio freddo: caldo come il resto? Scelta di gusto.',
    '[E] I dati escono con un collegamento scritto in chat.',
  ].join('\n'));
  assert.equal(p.rifiutati.length, 0);
  assert.deepEqual(p.findings.map((x) => [x.level, x.sede, x.decision]), [[2, 'i', false], [null, 'e', false], [1, 'i', true], [null, 'e', false]]);
  assert.match(p.findings[0].text, /^Il docx non si allega[\s\S]*Passi: apri/);
  assert.equal(p.summary, 'Provato: allega un docx e un pdf. Il pdf si allega.');
});

test('il segno ? vale anche prima della lettera: stesso significato, nessun giro perso', () => {
  const p = R.parseFindings('[1?i] scelta di gusto\n[?e] domanda su un altro lavoro');
  assert.deepEqual(p.findings.map((x) => [x.level, x.sede, x.decision]), [[1, 'i', true], [null, 'e', true]]);
});

test('la lettera è obbligatoria: il vecchio «[2] testo» è rifiutato con la spiegazione, non letto come interno', () => {
  const p = R.parseFindings('Provato tutto.\n[2] Il pulsante non salva.\n    Passi: apri, premi Salva.\n[1i] bordo');
  assert.equal(p.findings.length, 1, 'il rilievo senza lettera non è un rilievo');
  assert.equal(p.findings[0].sede, 'i');
  assert.equal(p.rifiutati.length, 1);
  assert.match(p.rifiutati[0], /^\[2\] Il pulsante non salva\. \(manca la sede/);
  assert.match(p.rifiutati[0], /«i»[\s\S]*\[2i\][\s\S]*\[e\], senza livello/);
  assert.doesNotMatch(p.summary, /pulsante/, 'e non finisce nel riassunto');
  // La stessa riga la elenca chi respinge la registrazione, con la stessa spiegazione.
  const brutte = R.unparsedLevelLines('Provato tutto.\n[2] Il pulsante non salva.\n[1i] bordo');
  assert.equal(brutte.length, 1);
  assert.equal(brutte[0], p.rifiutati[0]);
  // In ogni modo di elencare, e col segno «?».
  for (const riga of ['- [2] x', '1. [3?] x', '**[1]** x']) {
    assert.equal(R.unparsedLevelLines(riga).length, 1, riga);
    assert.match(R.unparsedLevelLines(riga)[0], /manca la sede/);
  }
  // Uno 0 senza sede dice prima che il livello 0 non c'è più.
  assert.match(R.unparsedLevelLines('### [0] x')[0], /il livello 0 non c'è più/);
});

test('una lettera che non è i né e resta un livello scritto male', () => {
  assert.equal(R.parseFindings('[2x] boh').findings.length, 0);
  assert.equal(R.unparsedLevelLines('[2x] boh').length, 1);
  assert.equal(R.unparsedLevelLines('[2i] bene\n[e?] bene').length, 0);
});

test('un interno senza livello o un esterno col livello sono respinti, ciascuno col suo perché', () => {
  const p = R.parseFindings('Provato.\n[i] manca il livello\n[2e] esterno col livello\n[1e?] esterno col livello e la domanda');
  assert.deepEqual(p.findings, []);
  assert.equal(p.rifiutati.length, 3);
  assert.match(p.rifiutati[0], /un rilievo interno prende un livello fra 1 e 3/);
  assert.match(p.rifiutati[1], /un rilievo esterno non prende livello/);
  assert.match(p.rifiutati[2], /un rilievo esterno non prende livello/);
  assert.equal(R.unparsedLevelLines('Provato.\n[i] manca il livello\n[2e] col livello').length, 2);
});

test('normalizeFindings: un rilievo strutturato senza sede vale interno; un esterno perde il livello', () => {
  const out = R.normalizeFindings([{ level: 2, text: 'vecchio' }, { level: 1, sede: 'E', text: 'nuovo' }, { level: 1, sede: 'boh', text: 'storto' }]);
  assert.deepEqual(out.map((x) => [x.level, x.sede]), [[2, 'i'], [null, 'e'], [1, 'i']]);
});

test('formatFinding scrive la lettera, il livello solo sugli interni, e il ? dopo', () => {
  assert.equal(R.formatFinding(f(2, 'i', 'rotto')), '- [2i] rotto');
  assert.equal(R.formatFinding(f(null, 'e', 'altrove', true)), '- [e?] altrove');
  assert.equal(R.formatFinding(f(1, 'e', 'stato vecchio')), '- [e] stato vecchio', 'il livello scritto su un esterno non si ristampa');
  assert.equal(R.formatFinding({ level: 1, text: 'senza sede' }), '- [1i] senza sede');
  // Andata e ritorno: quello che scrive, lo rilegge uguale.
  const p = R.parseFindings(R.formatFindings([f(null, 'e', 'grave'), f(1, 'i', 'lieve', true)]));
  assert.deepEqual(p.findings, [f(null, 'e', 'grave'), f(1, 'i', 'lieve', true)]);
});

test('primaFrase: il titolo di un feedback derivato è la prima frase del rilievo', () => {
  assert.equal(R.primaFrase('Il docx non si allega: il pulsante resta grigio. Passi: apri l\'editor.'), 'Il docx non si allega: il pulsante resta grigio.');
  assert.equal(R.primaFrase('Senza punto\nseconda riga'), 'Senza punto');
  assert.equal(R.primaFrase('x'.repeat(300)).length, 120);
});

// ── La regola del giro ───────────────────────────────────────────────────────

test('solo gli interni contano: un esterno non chiede correzione, un 2i sì', () => {
  const soloEsterno = decide([f(null, 'e', 'altrove')]);
  assert.equal(soloEsterno.stop, false);
  assert.deepEqual(soloEsterno.fix, []);
  assert.deepEqual(livelli(soloEsterno.external), ['e']);
  assert.equal(soloEsterno.consume, null, 'pass: nessun bilancio consumato');
  const interno = decide([f(2, 'i', 'qui')]);
  assert.deepEqual(livelli(interno.fix), ['2i']);
  assert.equal(interno.consume, 'cap2');
});

test('gli esterni tornano a parte senza livello né priorità, in ogni esito', () => {
  const r = decide([f(null, 'e', 'grave altrove'), f(2, 'i', 'qui'), f(3, 'e', 'stato vecchio col livello'), f(null, 'e', 'raro altrove', true)]);
  assert.deepEqual(r.external.map((x) => [x.level, x.priority, x.decision]), [[null, null, false], [null, null, false], [null, null, true]]);
  assert.deepEqual(livelli(r.fix), ['2i']);
  // Anche a lavoro fermo: non sono di questo lavoro, e ne escono.
  const fermo = decide([f(3, 'i', 'qui', true), f(null, 'e', 'altrove')]);
  assert.equal(fermo.stop, true);
  assert.deepEqual(livelli(fermo.external), ['e']);
  assert.equal(fermo.external[0].priority, null);
});

test('pass con soli esterni: nessun interno da correggere, il lavoro passa', () => {
  const list = [f(null, 'e', 'a'), f(null, 'e', 'b'), f(null, 'e', 'c', true)];
  const r = decide(list);
  assert.equal(r.stop, false);
  assert.deepEqual(r.fix, []);
  assert.deepEqual(r.derived, []);
  assert.equal(r.external.length, 3);
  assert.equal(r.consume, null);
  assert.match(R.roundNote({ summary: 'ok', findings: list, decision: r }), /3 rilievi sono esterni[\s\S]*Nessun rilievo interno: il lavoro prosegue/);
});

test('un esterno col ? non ferma: diventa un feedback nuovo con la domanda dentro; un interno col ? di livello 3 ferma', () => {
  const esterno = decide([f(null, 'e', 'scelta su un altro lavoro', true)]);
  assert.equal(esterno.stop, false);
  assert.deepEqual(esterno.blocking, []);
  assert.equal(esterno.external[0].decision, true);
  assert.equal(esterno.external[0].priority, null);
  // Nemmeno col «!» di una scelta difficile da disfare: non è di questo lavoro.
  assert.equal(decide([{ ...f(null, 'e', 'formato altrove', true), irreversibile: true }]).stop, false);
  const interno = decide([f(3, 'i', 'scelta su questo lavoro', true)]);
  assert.equal(interno.stop, true);
  assert.deepEqual(livelli(interno.blocking), ['3i']);
});

test('i bilanci li consumano solo gli interni: un esterno non paga niente, nemmeno a bilanci finiti', () => {
  const r = decide([f(null, 'e', 'altrove')], { count2: 4 });
  assert.equal(r.consume, null);
  assert.equal(r.budgets.cap2.left, 1, 'il bilancio dei 2 non si è mosso');
  const finito = decide([f(null, 'e', 'altrove')], { count3: 5, count2: 5, count1: 2 });
  assert.equal(finito.stop, false);
  assert.equal(finito.external.length, 1);
  assert.equal(decide([f(1, 'i', 'qui')]).consume, 'cap1');
});

test('gli interni messi da parte dal bilancio portano la priorità del livello', () => {
  const r = decide([f(1, 'i', 'lieve')], { count1: 2 });
  assert.deepEqual(r.fix, []);
  assert.deepEqual(r.derived.map((x) => [x.level, x.sede, x.priority]), [[1, 'i', 1]]);
  assert.deepEqual(r.external, []);
});

test('roundNote dice quanti esterni escono senza livello, e che il lavoro si ferma solo per un interno', () => {
  const lista = [{ ...f(2, 'i', 'qui', true), irreversibile: true }, f(null, 'e', 'altrove')];
  const nota = R.roundNote({ summary: 's', findings: lista, decision: decide(lista) });
  assert.match(nota, /Un rilievo è esterno \(non riguarda l'obiettivo e non l'ha introdotto il ramo\): diventa un feedback nuovo, senza livello, classificato come ogni altro feedback\./);
  assert.match(nota, /Il lavoro si ferma su una scelta difficile da disfare/);
  assert.match(nota, /- \[2i\?!\] qui\n- \[e\] altrove/);
  const due = [f(null, 'e', 'a'), f(null, 'e', 'b')];
  assert.match(R.roundNote({ findings: due, decision: decide(due) }), /2 rilievi sono esterni [^\n]*: diventano feedback nuovi, senza livello, classificati come ogni altro feedback\./);
});
