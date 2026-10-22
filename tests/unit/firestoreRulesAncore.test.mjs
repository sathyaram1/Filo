// Sentinella sulla regola dell'àncora delle release (#1501): ogni Filo legge documento ed elenco senza accesso, e
// nessun client scrive, nemmeno l'owner. La collezione è quella che legge src/main/updater.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
const { COLLEZIONE_ANCORE } = require(join(ROOT, 'src', 'main', 'aggiornamentoRegole.js'));

function blocco() {
  const righe = RULES.split('\n');
  const i = righe.findIndex((r) => new RegExp(`^ {4}match\\s+/${COLLEZIONE_ANCORE}/\\{`).test(r));
  assert.ok(i >= 0, `manca il blocco match /${COLLEZIONE_ANCORE}: Filo non legge l'àncora e non si aggiorna più`);
  const j = righe.findIndex((r, k) => k > i && /^ {4}\}\s*$/.test(r));
  return righe.slice(i, j + 1).join('\n').replace(/\/\/[^\n]*/g, ' ');
}

test('l\'àncora si legge senza accesso, documento ed elenco, e nessun client la scrive', () => {
  const regole = [...blocco().matchAll(/allow\s+([a-z,\s]+?)\s*:\s*if\s+([\s\S]*?);/g)]
    .map((m) => ({ verbi: m[1].split(',').map((v) => v.trim()), cond: m[2].replace(/\s+/g, ' ').trim() }));
  assert.deepEqual(regole, [
    { verbi: ['read'], cond: 'true' },
    { verbi: ['write'], cond: 'false' },
  ]);
});

test('nessun altro blocco apre la collezione dell\'àncora', () => {
  const aperture = RULES.split('\n').filter((r) => !/^\s*\/\//.test(r) && r.includes(`/${COLLEZIONE_ANCORE}`));
  assert.equal(aperture.length, 1, aperture.join('\n'));
  assert.doesNotMatch(RULES, /match\s+\/\{[a-zA-Z]+=\*\*\}/, 'un jolly ricorsivo darebbe altre regole anche all\'àncora');
});
