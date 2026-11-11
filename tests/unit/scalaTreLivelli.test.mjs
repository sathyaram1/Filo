// La scala a tre livelli dei rilievi (decisione dell'owner #2339): [3i] [2i] [1i], esterni [e] senza livello,
// tre bilanci. La scala vecchia (lo 0, il vicino, l'esterno col livello) si respinge dicendo cosa è cambiato.
// Le regole stanno in src/shared/verifierRound.js; la scala per chi verifica in routines/roles/_livelli-e-sede.md.

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
const CAPS = { cap3: 3, cap2: 1, cap1: 0 };
const decide = (testo, counts = {}, caps = CAPS) => R.decideRound({ findings: R.parseFindings(testo).findings, caps, counts });

test('[3i], [2i], [1i] sono rilievi interni col loro livello; [e] è un esterno senza livello', () => {
  const p = R.parseFindings('Provato tutto.\n[3i] perde i dati\n[2i] non salva\n[1i] bordo storto\n[e] il menu altrove');
  assert.deepEqual(p.rifiutati, []);
  assert.deepEqual(p.findings.map((f) => [f.level, f.sede]), [[3, 'i'], [2, 'i'], [1, 'i'], [null, 'e']]);
  assert.deepEqual(R.unparsedLevelLines('Provato.\n[3i] a\n[2i] b\n[1i] c\n[e] d\n[e?] f'), []);
});

test('lo 0, il vicino e l\'esterno col livello sono respinti, e il rifiuto dice cosa è cambiato', () => {
  const casi = [
    ['[0i] caso raro', /il livello 0 non c'è più/],
    ['[0e] caso raro altrove', /il livello 0 non c'è più/],
    ['[0] caso raro', /il livello 0 non c'è più/],
    ['[1v] nel file accanto', /la sede «vicino» non c'è più/],
    ['[2e] altrove', /un rilievo esterno non prende livello/],
  ];
  for (const [riga, perche] of casi) {
    const testo = `Provato tutto quello che la richiesta chiedeva.\n${riga}`;
    const p = R.parseFindings(testo);
    assert.deepEqual(p.findings, [], `${riga}: non è un rilievo`);
    assert.equal(p.rifiutati.length, 1, riga);
    assert.match(p.rifiutati[0], perche, riga);
    const rifiuto = R.testoRilieviNonRiconosciuti(testo);
    assert.notEqual(rifiuto, '', `${riga}: la critica si respinge`);
    assert.match(rifiuto, perche, riga);
    assert.doesNotMatch(p.summary, new RegExp(riga.slice(riga.indexOf(']') + 2)), `${riga}: non finisce nel riassunto`);
  }
});

test('un esterno non prende livello e diventa un feedback nuovo: niente bilancio, niente fermo', () => {
  const d = decide('Provato.\n[e] il menu altrove si chiude\n[e?] scelta su un altro lavoro');
  assert.equal(d.stop, false);
  assert.deepEqual(d.fix, []);
  assert.deepEqual(d.derived, []);
  assert.equal(d.consume, null);
  assert.deepEqual(d.counts, { count3: 0, count2: 0, count1: 0 });
  assert.deepEqual(d.external.map((f) => [f.level, f.priority, f.decision]), [[null, null, false], [null, null, true]]);
  const gruppi = R.derivedGroups(d);
  assert.deepEqual(gruppi.map((g) => [g.tipo, g.priority, g.findings[0].level]), [['esterno', null, null], ['esterno', null, null]]);
  // A bilanci finiti e accanto a un interno che ferma: l'esterno esce lo stesso, e non c'entra col fermo.
  const fermo = decide('Provato.\n[3i] perde i dati\n[e] altrove', { count3: 3, count2: 1 });
  assert.equal(fermo.stop, true);
  assert.deepEqual(fermo.blocking.map((f) => f.sede), ['i']);
  assert.deepEqual(fermo.external.map((f) => [f.level, f.priority]), [[null, null]]);
});

test('bilanci 3/1/0: un 2 apre il giro pagando cap2, il secondo 2 va nei rimasti a priorità 1; un 1 da solo non apre giri', () => {
  const primo = decide('Provato.\n[2i] non salva');
  assert.equal(primo.consume, 'cap2');
  assert.deepEqual(primo.fix.map((f) => f.level), [2]);
  const secondo = decide('Provato.\n[2i] non salva', { count2: 1 });
  assert.deepEqual(secondo.fix, []);
  assert.equal(secondo.consume, null);
  assert.equal(secondo.stop, false);
  assert.deepEqual(secondo.derived.map((f) => [f.level, f.priority]), [[2, 1]]);
  assert.deepEqual(R.derivedGroups(secondo).map((g) => [g.tipo, g.priority]), [['rimasti', 1]]);
  const uno = decide('Provato.\n[1i] bordo storto');
  assert.deepEqual(uno.fix, []);
  assert.equal(uno.consume, null);
  assert.deepEqual(uno.derived.map((f) => [f.level, f.priority]), [[1, 1]]);
});

test('i bilanci sono tre: un cap0 si ignora, e senza cap0 non manca niente', () => {
  assert.deepEqual(R.CAP_KEYS, ['cap3', 'cap2', 'cap1']);
  assert.deepEqual(globalThis.SN_FB_TRANSITIONS.VERIFIER_CAP_KEYS, ['cap3', 'cap2', 'cap1']);
  assert.deepEqual(R.missingCaps({ cap3: 3, cap2: 1, cap1: 0 }), []);
  assert.deepEqual(R.normalizeCaps({ cap3: 3, cap2: 1, cap1: 0, cap0: 9 }), { cap3: 3, cap2: 1, cap1: 0 });
  // Un cap0 alto non fa pagare un giro a chi ha finito gli altri.
  const d = decide('Provato.\n[1i] bordo storto', {}, { ...CAPS, cap0: 9 });
  assert.equal(d.consume, null);
  assert.deepEqual(Object.keys(d.budgets), ['cap3', 'cap2', 'cap1']);
});

test('[1i?!] ferma e va al manutentore; [3i?] ferma e va all\'owner', () => {
  const irreversibile = decide('Provato.\n[1i?!] cambia il formato del registro su disco');
  assert.equal(irreversibile.stop, true);
  assert.deepEqual(irreversibile.blocking.map((f) => [f.level, f.destinatario]), [[1, 'manutentore']]);
  const decisione = decide('Provato.\n[3i?] le chiavi escono: A o B?');
  assert.equal(decisione.stop, true);
  assert.deepEqual(decisione.blocking.map((f) => [f.level, f.destinatario]), [[3, 'owner']]);
});

test('lo stato scritto con la scala vecchia si legge con la regola scritta: 0 interno → 1, vicino → esterno senza livello', () => {
  const vecchi = [
    { level: 0, sede: 'i', text: 'zero interno' },
    { level: 2, sede: 'v', text: 'vicino' },
    { level: 3, sede: 'e', text: 'esterno col livello' },
  ];
  assert.deepEqual(R.normalizeFindings(vecchi).map((f) => [f.level, f.sede]), [[1, 'i'], [null, 'e'], [null, 'e']]);
  assert.deepEqual(R.derivedGroups(vecchi).map((g) => [g.tipo, g.priority, g.findings.map((f) => f.level)]), [
    ['esterno', null, [null]], ['esterno', null, [null]], ['rimasti', 1, [1]],
  ]);
  assert.equal(R.sedeDi('v'), 'e');
});
