// handlers.js diviso per dominio (#2489): ogni azione ha un tipo solo e una funzione, ogni dominio dei messaggi si
// registra dall'elenco di handlers/index.js, e le librerie nate dalla divisione non registrano messaggi da sé.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { casiDelleAzioni, percorsiDiHandlers } from '../helpers/sorgenteHandlers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leggi = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

test('ogni tipo di azione sta in una tabella sola, con la sua funzione', () => {
  const casi = casiDelleAzioni();
  const tipi = casi.map((c) => c.tipo);
  assert.ok(tipi.length >= 67, `solo ${tipi.length} tipi nelle tabelle di services/azioni/`);
  assert.deepEqual(tipi.filter((t, i) => tipi.indexOf(t) !== i), [], 'un tipo in due tabelle: vincerebbe l’ultima caricata');
  for (const { tipo, corpo } of casi) assert.match(corpo, /^async function azione\w+\(action\b/, tipo);
  // La tabella non ha prototipo: un tipo come «CONSTRUCTOR» o «__PROTO__» non trova una funzione per caso.
  assert.match(leggi('src', 'main', 'services', 'handlers.js'), /Object\.hasOwn\(AZIONI, type\) \? AZIONI\[type\] : null/);
});

test('ogni dominio sotto handlers/ si registra, una volta e dall’elenco', () => {
  const indice = leggi('src', 'main', 'services', 'handlers', 'index.js');
  const elencati = [...indice.matchAll(/\(\) => require\('\.\/(\w+)'\)/g)].map((m) => m[1]);
  const file = readdirSync(join(ROOT, 'src', 'main', 'services', 'handlers'))
    .filter((f) => f.endsWith('.js') && !['index.js', 'origine.js'].includes(f)).map((f) => f.replace(/\.js$/, ''));
  assert.deepEqual([...elencati].sort(), [...file].sort(), 'un dominio fuori elenco non riceverebbe mai i suoi messaggi');
  assert.equal(new Set(elencati).size, elencati.length);
  assert.doesNotMatch(leggi('src', 'main', 'services', 'handlers.js'), /require\('\.\/handlers\/(?!index'|origine')\w+'\)/,
    'i domini si registrano da handlers/index.js');
});

test('le librerie nate da handlers.js non registrano messaggi: il registro on() sta in handlers.js', () => {
  const librerie = percorsiDiHandlers().filter((p) => !p.endsWith('/handlers.js') && !p.endsWith('/handlers/index.js'));
  assert.ok(librerie.length >= 18, librerie.join(','));
  for (const p of librerie) assert.doesNotMatch(readFileSync(join(ROOT, p), 'utf8'), /\bon\(MSG\.|\bregistry\.set\(/, p);
});
