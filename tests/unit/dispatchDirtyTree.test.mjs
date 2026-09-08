// La critica del verificatore vale per un commit: se nella directory ci sono
// file che il salvataggio automatico committerebbe DOPO, la registrazione
// rifiuta prima (#256: le spec temporanee tolte tredici secondi dopo il pass
// spostavano la punta, e il cancello respingeva il lavoro per due giorni).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { dirtyTreeLines, dirtyTreeText } = await import('../../scripts/dispatch.mjs');

test('dirtyTreeLines: le righe di git status --porcelain diventano percorsi', () => {
  const out = ' M scripts/dispatch.mjs\n?? tests/verify-256-giro5.spec.mjs\n D tests/verify-256-giro5d.spec.mjs\n?? "tests/con spazio.spec.mjs"\n';
  assert.deepEqual(dirtyTreeLines(out), [
    'scripts/dispatch.mjs',
    'tests/verify-256-giro5.spec.mjs',
    'tests/verify-256-giro5d.spec.mjs',
    'tests/con spazio.spec.mjs',
  ]);
});

test('dirtyTreeLines: directory pulita = niente', () => {
  assert.deepEqual(dirtyTreeLines(''), []);
  assert.deepEqual(dirtyTreeLines('\n\r\n'), []);
  assert.deepEqual(dirtyTreeLines(undefined), []);
});

test('dirtyTreeText: dice cosa fare e elenca i file, con il conto di quelli oltre i trenta', () => {
  const uno = dirtyTreeText(['tests/verify-1.spec.mjs']);
  assert.match(uno, /critica non registrata/);
  assert.match(uno, /salvataggio automatico/);
  assert.match(uno, /riprova con la stessa critica/);
  assert.match(uno, /\n  tests\/verify-1\.spec\.mjs$/);
  const tanti = dirtyTreeText(Array.from({ length: 33 }, (_, i) => `f${i}`));
  assert.match(tanti, /… e altri 3$/);
  assert.doesNotMatch(tanti, /f32/);
});
