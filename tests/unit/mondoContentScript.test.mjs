// Il mondo isolato dei content script ha un numero solo: il main lo legge da src/preload/mondo-esente.js, e le copie
// dei preload (che non possono richiederlo) devono coincidere. Una copia rimasta indietro spegne in silenzio chi ci entra.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { MONDO } = require(join(ROOT, 'src/preload/mondo-esente.js'));

function jsSotto(dir) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...jsSotto(p));
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

test('il main non scrive a mano il numero del mondo dei content script', () => {
  const scritto = new RegExp(`(MONDO\\w*\\s*=\\s*${MONDO}\\b|executeJavaScriptInIsolatedWorld\\(\\s*${MONDO}\\b)`);
  const colpevoli = jsSotto(join(ROOT, 'src/main')).filter((f) => scritto.test(readFileSync(f, 'utf8')));
  assert.deepEqual(colpevoli.map((f) => f.slice(ROOT.length + 1)), []);
});

test('le copie dei preload coincidono col numero di mondo-esente', () => {
  for (const [file, nome] of [['src/preload/page-preload.js', 'MONDO_DEL_PRELOAD'], ['src/preload/wheel-zoom.js', 'MONDO_FILO']]) {
    const m = readFileSync(join(ROOT, file), 'utf8').match(new RegExp(`${nome}\\s*=\\s*(\\d+)`));
    assert.ok(m, `${file}: ${nome} non trovato`);
    assert.equal(Number(m[1]), MONDO, file);
  }
});
