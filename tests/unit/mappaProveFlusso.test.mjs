// Il giro della mappa prova → file su GitHub (#2502): la suite registra, ogni parte unisce e carica, il lavoro che
// lo strumento legge per nome la costruisce e la stampa nel suo registro. Un pezzo spostato o rinominato qui è rosso,
// invece di far tornare finish:check in silenzio alla scelta per aree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAVORO_DELLA_MAPPA } from '../../scripts/mappa-prove.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const YML = readFileSync(join(ROOT, '.github/workflows/suite.yml'), 'utf8').replace(/\r\n/g, '\n');

/** Il blocco di un lavoro (dalla sua riga a due spazi alla prossima), senza i commenti. */
function lavoro(nome) {
  const righe = YML.split('\n');
  const da = righe.findIndex((r) => r === `  ${nome}:`);
  assert.ok(da >= 0, `il lavoro ${nome} c'è in suite.yml`);
  let a = righe.findIndex((r, i) => i > da && /^ {2}[\w-]+:\s*$/.test(r));
  if (a < 0) a = righe.length;
  return righe.slice(da + 1, a).filter((r) => !/^\s*#/.test(r)).join('\n');
}

test('la suite registra in una cartella, e ogni parte la unisce e la carica col nome che il verdetto scarica', () => {
  const suite = lavoro('suite');
  const cartella = suite.match(/FILO_COPERTURA:\s*(\S+)/)?.[1];
  assert.ok(cartella, 'il passo della suite accende la registrazione');
  assert.match(suite, new RegExp(`mappa-prove\\.mjs unisci --registrazioni ${cartella} --out (copertura-parte-\\$\\{\\{ matrix\\.parte \\}\\}\\.json)`));
  assert.match(suite, /name: suite-copertura-\$\{\{ matrix\.parte \}\}\n\s+path: copertura-parte-\$\{\{ matrix\.parte \}\}\.json/);
});

test('il lavoro che lo strumento legge per nome scarica le parti, costruisce la mappa e la stampa nel registro', () => {
  const v = lavoro(LAVORO_DELLA_MAPPA);
  assert.ok(!/^ {4}name:/m.test(v), 'un nome diverso dalla chiave lo renderebbe introvabile allo strumento');
  const scaricate = v.match(/pattern: suite-copertura-\*\n\s+path: (\S+)/)?.[1];
  assert.ok(scaricate, 'il verdetto scarica le registrazioni delle parti');
  const costruisci = v.split('\n').find((r) => r.includes('mappa-prove.mjs costruisci'));
  assert.ok(costruisci, 'il verdetto costruisce la mappa');
  assert.match(costruisci, new RegExp(`--registrazioni ${scaricate}(\\s|$)`));
  assert.ok(!/[>|]/.test(costruisci.replace(/^.*run:/, '')), 'le righe della mappa vanno nel registro, non in un file');
});
