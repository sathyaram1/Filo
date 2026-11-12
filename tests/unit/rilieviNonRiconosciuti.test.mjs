// #2179: una critica senza rilievi col riassunto «… (2865) … Nessun rilievo.» era respinta
// come «rilievi non riconosciuti» senza dire quale pezzo della riga fosse letto come livello.
// Un numero fra tonde non è un livello; e ogni riga respinta mostra il pezzo che la fa scattare.

import '../helpers/senzaSessione.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
process.env.FILO_TOOLS_ROOT = ROOT;
const { VERIFIER_ROUND: R } = await import('../../scripts/dispatch.mjs');

const CRITICA_DEL_CASO = 'Provato: la ricerca regge sui 40 documenti, il conteggio torna (2865) e il tasto destro apre il box giusto in tema chiaro e scuro. Nessun rilievo.';

test('#2179: la critica del caso, con «(2865)» e «Nessun rilievo.», passa intera', () => {
  assert.deepEqual(R.unparsedLevelLines(CRITICA_DEL_CASO), []);
  assert.equal(R.testoRilieviNonRiconosciuti(CRITICA_DEL_CASO), '');
  const p = R.parseFindings(CRITICA_DEL_CASO);
  assert.equal(p.findings.length, 0);
  assert.match(p.summary, /\(2865\)/);
});

test('#2179: un numero di più cifre fra tonde o graffe è testo, una cifra sola resta un livello', () => {
  for (const riga of ['Provato (10) volte.', 'Visto il feedback {2179}.', 'Totale (1.000) righe.', 'Rapporto (2,865).']) {
    assert.deepEqual(R.unparsedLevelLines(`Provato tutto.\n${riga}`), [], riga);
  }
  for (const riga of ['Provato: regge (2) volte.', 'Bordo storto {3}.', 'Visto (2-3) casi.', 'Grave (livello 2).']) {
    assert.deepEqual(R.unparsedLevelLines(`Provato tutto.\n${riga}`), [riga], riga);
  }
});

test('#2179: in testa alla riga vale la stessa regola che a metà riga', () => {
  for (const c of [
    'Visto (2865) chiuso, nessun rilievo.',
    'Provato:\n(2865) è il feedback del conteggio, regge.',
    'Provato:\n- (2865) il conteggio regge\n- tema scuro regge',
    'Ok: (2865) regge.',
    'Provato:\n(10) volte la stessa azione, regge.',
    'Provato:\n(1.000) righe incollate.',
    'Provato:\n{2179} chiuso.',
    'Provato:\n9) nono\n10) decimo punto, regge\n11) undicesimo',
  ]) assert.deepEqual(R.unparsedLevelLines(c), [], c);
  for (const riga of ['(2) bordo storto', '{2} bordo storto', '(2.5) bordo', '(2-3) bordo', '(livello 2) bordo', '(tre) bordo', '[2865] chiuso']) {
    assert.deepEqual(R.unparsedLevelLines(`Provato tutto.\n${riga}`), [riga], riga);
  }
});

test('#2179: il rifiuto dice, sotto ogni riga, il pezzo letto come livello', () => {
  const t = R.testoRilieviNonRiconosciuti('Provato: regge (3) volte.\nRilievo [2]: non salva.\n[1i] bordo [2i] e un secondo\n[2] senza sede');
  assert.match(t, /^rilievi non riconosciuti\./);
  assert.match(t, /Provato: regge \(3\) volte\.\n {4}letto come livello: «\(3\)»/);
  assert.match(t, /Rilievo \[2\]: non salva\.\n {4}letto come livello: «\[2\]»/);
  assert.match(t, /\[1i\] bordo \[2i\] e un secondo\n {4}letto come livello: «\[2i\]»/);
  // La riga senza sede porta già la sua spiegazione, non un pezzo.
  assert.match(t, /\[2\] senza sede \(manca la sede/);
  assert.doesNotMatch(t, /senza sede[^\n]*\n {4}letto come livello/);
});

test('#2179: dispatch e verify-local stampano lo stesso rifiuto, scritto in un posto solo', () => {
  for (const f of ['scripts/dispatch.mjs', 'scripts/verify-local.mjs']) {
    const src = readFileSync(resolve(ROOT, f), 'utf8');
    assert.match(src, /testoRilieviNonRiconosciuti\(/, f);
    assert.doesNotMatch(src, /Righe da sistemare/, f);
  }
});
