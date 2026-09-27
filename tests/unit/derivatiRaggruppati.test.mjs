// Le stampe delle routine (dispatch) e della verifica locale dicono i feedback
// derivati per gruppi, come li apre il server (derivedGroups), e trattano la
// sede `v` come il lettore della critica (decisione dell'owner del 2026-09-27).

import test from 'node:test';
import assert from 'node:assert/strict';

const { derivatiAperti, verifierReplyText } = await import('../../scripts/dispatch.mjs');
const VL = await import('../../scripts/verify-local.mjs');
const { perimetroNote } = await import('../../scripts/lib/verifier-scope.mjs');

const f = (level, sede, text, decision = false) => ({ level, sede, text, decision });

test('derivatiAperti: i rilievi con lo stesso numero sono UN feedback, col tipo del gruppo', () => {
  const voci = derivatiAperti([
    { ...f(2, 'i', 'Non salva.'), priority: 3, num: '#7.3', tipo: 'rimasti' },
    { ...f(1, 'e', 'Altrove.'), priority: 1, num: '#7.1' },
    { ...f(3, 'v', 'Vicino.'), priority: 3, num: '#7.3', tipo: 'rimasti' },
    { ...f(1, 'i', 'Scelta?', true), priority: 1, num: '#7.2' },
  ]);
  assert.deepEqual(voci.map((v) => [v.num, v.tipo, v.priority, v.rilievi.length]), [
    ['#7.3', 'rimasti', 3, 2],
    ['#7.1', 'esterno', 1, 1],
    ['#7.2', 'decisione', 1, 1],
  ]);
  // Anche voci già raggruppate, e il server vecchio (un oggetto solo).
  const gruppo = derivatiAperti([{ tipo: 'rimasti', num: '#8.1', priority: 2, findings: [f(2, 'i', 'a'), f(0, 'v', 'b')] }]);
  assert.deepEqual(gruppo.map((v) => [v.num, v.rilievi.length]), [['#8.1', 2]]);
  assert.equal(derivatiAperti({ num: '#42.1' }).length, 1);
});

test('verifierReplyText: il feedback dei rimasti si stampa una volta, coi suoi rilievi e una prova da togliere per rilievo', () => {
  const pass = verifierReplyText({
    outcome: 'pass',
    derived: [
      { ...f(2, 'i', 'Non salva.'), priority: 3, num: '#7.3', tipo: 'rimasti', n: 1 },
      { ...f(3, 'v', 'Vicino rotto.'), priority: 3, num: '#7.3', tipo: 'rimasti', n: 3 },
    ],
  });
  assert.match(pass, /- r1 \[2i\] Non salva\.\n- r3 \[3v\] Vicino rotto\.\n {2}→ feedback #7\.3, priorità 3, rimasti del giro: 2 rilievi \(\[2i\], \[3v\]\)/);
  assert.equal(pass.match(/→ feedback #7\.3/g).length, 1, 'un feedback, una riga');
  // Ogni rilievo accorpato ha le sue prove, riconosciute dal suo numero nella critica.
  assert.match(pass, /· le prove con r1 nel nome, per #7\.3: Non salva\.\n {2}· le prove con r3 nel nome, per #7\.3: Vicino rotto\./);
  assert.match(pass, /il rilievo interno di livello 2 rimasto è entrato nel feedback dei rimasti/);
});

test('verify-local: i rilievi non corretti si stampano raggruppati come li aprirà il server', () => {
  const testo = VL.derivatiText([f(2, 'i', 'a'), f(3, 'v', 'b'), f(1, 'e', 'c'), f(1, 'i', 'd', true)]);
  assert.equal(testo, [
    '- [1e] c',
    '  → feedback a parte, priorità 1 (esterno)',
    '- [1i?] d',
    '  → feedback a parte, priorità 1 (interno, da decidere)',
    '- [2i] a',
    '- [3v] b',
    '  → un solo feedback per questi 2 rilievi, priorità 3 (rimasti del giro: 2 rilievi ([2i], [3v]))',
  ].join('\n'));
  assert.equal(VL.derivatiText([]), '  (nessuno)');
  assert.equal(VL.dueDaParteText([f(2, 'v', 'vicino')]), '', 'un vicino di livello scritto 2 non è il bilancio dei 2');
  assert.match(VL.dueDaParteText([f(2, 'i', 'x')]), /entra nel feedback dei rimasti/);
});

test('verify-local: un vicino di livello scritto 3 lasciato non corretto non ferma il lavoro', () => {
  const SHA = 'a'.repeat(40);
  const caps = { cap3: 5, cap2: 5, cap1: 2, cap0: 0 };
  let s = VL.withRequest({}, 'r', { request: 'x', sha: SHA });
  const r = VL.withCritique(s, 'r', { critique: 'Provato tutto il resto: regge.\n[1i] lieve\n[3v] grave nel file vicino', sha: SHA, caps });
  assert.equal(r.outcome, 'fix');
  const c = VL.withFixed(r.state, 'r', { report: 'niente di nuovo', sha: SHA });
  assert.equal(c.outcome, 'pass', 'nessun commit nuovo e solo un 1i e un vicino in sospeso: non si ferma');
  assert.deepEqual(c.derived.map((x) => `${x.level}${x.sede}`), ['1i', '3v']);
});

test('i rifiuti di formato e il perimetro della chiusura conoscono la sede v', () => {
  const SHA = 'a'.repeat(40);
  const s = VL.withRequest({}, 'r', { request: 'x', sha: SHA });
  const r = VL.withCritique(s, 'r', { critique: 'Provato.\n[2] senza sede', sha: SHA, caps: { cap3: 1, cap2: 1, cap1: 1, cap0: 1 } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /«v» se è di un altro lavoro ma sta in un file che il ramo modifica già/);
  assert.match(perimetroNote('chiusura', { rilievi: [f(2, 'v', 'vicino')], shaPrima: SHA }), /- \[2v\] vicino/);
});
