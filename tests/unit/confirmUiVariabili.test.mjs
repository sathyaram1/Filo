// Sentinella #592.7: sui siti il popup di conferma fissa ogni variabile --sn-*
// che usa, coi valori di Filo; una variabile nuova nel suo CSS lasciata
// all'eredità tornerebbe nelle mani della pagina.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const shared = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'shared');
require(join(shared, 'themeTokens.js'));
require(join(shared, 'confirmUi.js'));
const variabili = globalThis.SN_CONFIRM_UI._test.variabili;

test('ogni variabile --sn-* del CSS del popup è fissata', () => {
  const usate = new Set([...readFileSync(join(shared, 'confirmUi.js'), 'utf8').matchAll(/var\((--sn-[\w-]+)/g)].map((m) => m[1]));
  const fisse = variabili({}, 'light');
  for (const v of usate) assert.ok(fisse[v], `${v} resta all'eredità della pagina`);
});

test('i valori sono quelli del tema di Filo e seguono tema e token dell’utente', () => {
  const chiaro = variabili({}, 'light');
  const scuro = variabili({}, 'dark');
  assert.equal(chiaro['--sn-accent'], '#c45a3b');
  assert.equal(chiaro['--sn-overlay-bg'], 'rgba(248, 246, 240, 0.98)');
  assert.equal(scuro['--sn-overlay-bg'], 'rgba(30, 29, 27, 0.98)');
  assert.equal(scuro['--sn-fg'], '#e5e3dc');
  const verde = variabili({ accent: '#2e7d32', text: '#101010' }, 'light');
  assert.equal(verde['--sn-accent'], '#2e7d32');
  assert.equal(verde['--sn-btn-bg'], '#101010', 'il bottone eredita dal testo come in theme.css');
  assert.match(verde['--sn-selection-bg'], /#2e7d32 25%/);
});

test('un token dell’utente che non è un colore non entra nel popup', () => {
  assert.equal(variabili({ accent: 'nessuno' }, 'light')['--sn-accent'], '#c45a3b');
});
