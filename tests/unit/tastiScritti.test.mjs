// Sentinella #545: una scorciatoia scritta si legge in un posto solo (SN_TASTI),
// con le stesse regole con cui si riconosce il tasto premuto. Ogni lettura fatta
// in casa ha salvato tasti che poi non partivano mai.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'tasti.js'));
const T = globalThis.SN_TASTI;

test('la pressione descritta da un nome scritto è quella che il tasto vero fa combaciare', () => {
  for (const [scritta, premuta] of [
    ['Ctrl+Minus', { ctrlKey: true, key: '-' }],
    ['Ctrl++', { ctrlKey: true, key: '+' }],
    ['Ctrl+Plus', { ctrlKey: true, key: '=' }],
    ['Cmd+Maiusc+S', { metaKey: true, shiftKey: true, key: 'S', code: 'KeyS' }],
    ['Ctrl+Barra spaziatrice', { ctrlKey: true, key: ' ', code: 'Space' }],
  ]) {
    const p = T.pressioneScritta(scritta);
    assert.ok(p, `${scritta} descrive una pressione`);
    assert.ok(T.combacia(p, scritta), `${scritta}: la pressione descritta combacia col nome`);
    if (premuta.key !== '_') assert.ok(T.combacia(premuta, scritta), `${scritta}: il tasto vero combacia`);
  }
  assert.equal(T.pressioneScritta('Ctrl+Minus').key, '-');
  assert.equal(T.pressioneScritta('Ctrl++').key, '+');
  assert.equal(T.pressioneScritta('Ctrl+=').key, '+');
  assert.equal(T.pressioneScritta('b'), null, 'una lettera nuda non è una scorciatoia');
});

test('l\'Editor non spezza a mano il nome di una scorciatoia', () => {
  const src = readFileSync(join(ROOT, 'src', 'pages', 'editor', 'editor.js'), 'utf8');
  assert.doesNotMatch(src, /split\(\s*['"]\+['"]\s*\)/,
    'il nome di una scorciatoia si legge con SN_TASTI.pressioneScritta, non con uno split fatto in casa');
});
