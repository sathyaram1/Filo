// Le stampe delle routine (dispatch) e della verifica locale dicono i feedback
// derivati per gruppi, come li apre il server (derivedGroups), e leggono lo stato
// della scala vecchia come il lettore della critica: il vicino è esterno (#2339).

import test from 'node:test';
import assert from 'node:assert/strict';

const { derivatiAperti, verifierReplyText } = await import('../../scripts/dispatch.mjs');
const VL = await import('../../scripts/verify-local.mjs');
const { perimetroNote } = await import('../../scripts/lib/verifier-scope.mjs');

const f = (level, sede, text, decision = false) => ({ level, sede, text, decision });

test('derivatiAperti: i rilievi con lo stesso numero sono UN feedback, col tipo del gruppo; l\'esterno senza priorità', () => {
  const voci = derivatiAperti([
    { ...f(2, 'i', 'Non salva.'), priority: 3, num: '#7.3', tipo: 'rimasti' },
    { ...f(null, 'e', 'Altrove.'), priority: null, num: '#7.1' },
    { ...f(1, 'i', 'Bordo.'), priority: 3, num: '#7.3', tipo: 'rimasti' },
    { ...f(1, 'i', 'Scelta?', true), priority: 1, num: '#7.2' },
  ]);
  assert.deepEqual(voci.map((v) => [v.num, v.tipo, v.priority, v.rilievi.length]), [
    ['#7.3', 'rimasti', 3, 2],
    ['#7.1', 'esterno', null, 1],
    ['#7.2', 'decisione', 1, 1],
  ]);
  // Anche voci già raggruppate, e il server vecchio (un oggetto solo).
  const gruppo = derivatiAperti([{ tipo: 'rimasti', num: '#8.1', priority: 2, findings: [f(2, 'i', 'a'), f(1, 'i', 'b')] }]);
  assert.deepEqual(gruppo.map((v) => [v.num, v.rilievi.length]), [['#8.1', 2]]);
  assert.equal(derivatiAperti({ num: '#42.1' }).length, 1);
});

test('verifierReplyText: il feedback dei rimasti si stampa una volta, coi suoi rilievi e una prova da togliere per rilievo', () => {
  const pass = verifierReplyText({
    outcome: 'pass',
    derived: [
      { ...f(2, 'i', 'Non salva.'), priority: 3, num: '#7.3', tipo: 'rimasti', n: 1 },
      { ...f(1, 'i', 'Bordo storto.'), priority: 3, num: '#7.3', tipo: 'rimasti', n: 3 },
      { ...f(null, 'e', 'Altrove.'), priority: null, num: '#7.1', n: 2 },
    ],
  });
  assert.match(pass, /- r1 \[2i\] Non salva\.\n- r3 \[1i\] Bordo storto\.\n {2}→ feedback #7\.3, priorità 3, rimasti del giro: 2 rilievi \(\[2i\], \[1i\]\)/);
  assert.equal(pass.match(/→ feedback #7\.3/g).length, 1, 'un feedback, una riga');
  // L'esterno esce senza livello né priorità: lo classifica chi classifica gli altri feedback.
  assert.match(pass, /- r2 \[e\] Altrove\.\n {2}→ feedback #7\.1, esterno, senza livello/);
  assert.doesNotMatch(pass, /priorità (null|0)/);
  // Ogni rilievo accorpato ha le sue prove, riconosciute dal suo numero nella critica.
  assert.match(pass, /· le prove con r1 nel nome, per #7\.3: Non salva\.\n {2}· le prove con r3 nel nome, per #7\.3: Bordo storto\./);
  assert.match(pass, /il rilievo interno di livello 2 rimasto non ferma il lavoro ed entra nel feedback dei rimasti/);
});

test('verify-local: i rilievi non corretti si stampano raggruppati come li aprirà il server', () => {
  const testo = VL.derivatiText([f(2, 'i', 'a'), f(1, 'i', 'b'), f(null, 'e', 'c'), f(1, 'i', 'd', true)]);
  assert.equal(testo, [
    '- [e] c',
    '  → feedback a parte, senza livello (esterno)',
    '- [1i?] d',
    '  → feedback a parte, priorità 1 (interno, da decidere)',
    '- [2i] a',
    '- [1i] b',
    '  → un solo feedback per questi 2 rilievi, priorità 1 (rimasti del giro: 2 rilievi ([2i], [1i]))',
  ].join('\n'));
  // Un vicino dello stato vecchio è un esterno, non un rimasto.
  assert.equal(VL.derivatiText([f(3, 'v', 'vecchio')]), '- [e] vecchio\n  → feedback a parte, senza livello (esterno)');
  assert.equal(VL.derivatiText([]), '  (nessuno)');
  assert.equal(VL.dueDaParteText([f(2, 'v', 'vicino')]), '', 'un vicino di livello scritto 2 è esterno, non il bilancio dei 2');
  assert.match(VL.dueDaParteText([f(2, 'i', 'x')]), /entra nel feedback dei rimasti/);
});

test('verify-local: un esterno lasciato lì non ferma il lavoro, e un vicino nello stato vecchio nemmeno', () => {
  const SHA = 'a'.repeat(40);
  const caps = { cap3: 5, cap2: 5, cap1: 2 };
  const s = VL.withRequest({}, 'r', { request: 'x', sha: SHA });
  const r = VL.withCritique(s, 'r', { critique: 'Provato tutto il resto: regge.\n[1i] lieve\n[e] grave in un file che il ramo modifica', sha: SHA, caps });
  assert.equal(r.outcome, 'fix');
  const c = VL.withFixed(r.state, 'r', { report: 'niente di nuovo', sha: SHA });
  assert.equal(c.outcome, 'pass', 'nessun commit nuovo e solo un 1i in sospeso: non si ferma');
  // Lo stato scritto prima del #2339 con un vicino di livello 3 in sospeso: si legge esterno, e non ferma.
  const vecchio = JSON.parse(JSON.stringify(r.state));
  vecchio.r.pending.findings = [...vecchio.r.pending.findings, f(3, 'v', 'grave nel file vicino')];
  const v = VL.withFixed(vecchio, 'r', { report: 'niente di nuovo', sha: SHA });
  assert.equal(v.outcome, 'pass');
});

test('i rifiuti di formato spiegano la scala a tre livelli, e il perimetro della chiusura scrive gli esterni senza livello', () => {
  const SHA = 'a'.repeat(40);
  const s = VL.withRequest({}, 'r', { request: 'x', sha: SHA });
  const caps = { cap3: 1, cap2: 1, cap1: 1 };
  const senzaSede = VL.withCritique(s, 'r', { critique: 'Provato.\n[2] senza sede', sha: SHA, caps });
  assert.equal(senzaSede.ok, false);
  assert.match(senzaSede.reason, /tutto il resto è esterno e si scrive \[e\], senza livello/);
  const vicino = VL.withCritique(s, 'r', { critique: 'Provato.\n[1v] nel file accanto', sha: SHA, caps });
  assert.equal(vicino.ok, false);
  assert.match(vicino.reason, /la sede «vicino» non c'è più/);
  assert.match(perimetroNote('chiusura', { rilievi: [f(2, 'i', 'int'), f(null, 'e', 'est'), f(2, 'v', 'vicino')], shaPrima: SHA }),
    /- \[2i\] int\n- \[e\] est\n- \[e\] vicino/);
});
