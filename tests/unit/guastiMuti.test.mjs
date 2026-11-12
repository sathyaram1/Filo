// #1479 — Due guasti che si fermavano in silenzio lasciano una riga nel log del main e il conto ai contatori:
// il recupero di una scheda che muore di nuovo appena ricreata, e la versione d'aggiornamento rifiutata (#1119).
// Regole: src/main/tabs/recuperoCrash.js e rifiuta() in src/main/updater.js.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { recuperaScheda, FERMO_MS } = require(join(ROOT, 'src', 'main', 'tabs', 'recuperoCrash.js'));

let righe;
let contati;
const originali = { warn: console.warn, error: console.error, log: console.log };
beforeEach(() => {
  righe = [];
  contati = [];
  for (const k of ['warn', 'error']) console[k] = (...a) => righe.push(a.map(String).join(' '));
  console.log = () => {};
  globalThis.SN_CONTATORI_MAIN = {
    processoMorto: (tipo, motivo, o) => contati.push({ tipo, motivo, ...o }),
    aggiornamento: (evento) => contati.push({ evento }),
  };
});
afterEach(() => {
  Object.assign(console, originali);
  delete globalThis.SN_CONTATORI_MAIN;
});

test('una scheda che muore di nuovo subito dopo il recupero: fermo, una riga col motivo e i tentativi, il conto', () => {
  const tab = { id: 'abcdef123456' };
  assert.equal(recuperaScheda(tab, { motivo: 'crashed', adesso: 1000 }), true, 'la prima morte si recupera');
  assert.deepEqual(righe, [], 'un recupero che parte non è un guasto');
  assert.equal(recuperaScheda(tab, { motivo: 'crashed', incognito: true, adesso: 1000 + FERMO_MS - 1 }), false);
  assert.equal(righe.length, 1, 'il fermo deve lasciare una riga nel log del main');
  assert.match(righe[0], /\[tab:abcdef\] recupero fermato/);
  assert.match(righe[0], /crashed/);
  assert.match(righe[0], /tentativo 1\b/);
  assert.deepEqual(contati, [{ tipo: 'scheda_in_recupero', motivo: 'crashed', incognito: true }]);
});

test('morta di nuovo dopo il tempo di fermo: si recupera ancora, e il fermo dopo conta i tentativi fatti', () => {
  const tab = { id: 'scheda2' };
  assert.equal(recuperaScheda(tab, { motivo: 'oom', adesso: 0 }), true);
  assert.equal(recuperaScheda(tab, { motivo: 'oom', adesso: FERMO_MS + 10 }), true);
  assert.equal(recuperaScheda(tab, { motivo: 'oom', adesso: FERMO_MS + 20 }), false);
  assert.equal(righe.length, 1);
  assert.match(righe[0], /tentativo 2\b/);
});

test('la versione d\'aggiornamento rifiutata lo dice nel log, col numero, l\'etichetta e il motivo, e si conta', async () => {
  const U = require(join(ROOT, 'src', 'main', 'updater.js'));
  const { finto } = U.perProva({ piattaforma: 'linux', versione: '0.2.233', cartella: cartellaTemporanea('filo-guasti-muti-'), avvisoVero: false });

  // Il numero di latest.yml non è quello dell'etichetta della release.
  finto.emit('update-available', { version: '9.9.9', tag: 'v0.2.100' });
  assert.equal(righe.length, 1, 'la versione rifiutata deve lasciare una riga nel log del main');
  assert.match(righe[0], /versione rifiutata/);
  assert.match(righe[0], /9\.9\.9/);
  assert.match(righe[0], /v0\.2\.100/);
  assert.deepEqual(contati, [{ evento: 'versione_rifiutata' }]);

  // Rifiutata dal cancello del controllo: la riga porta il perché.
  righe.length = 0;
  contati.length = 0;
  const motivo = 'release v0.2.101 rifiutata: il tag non è v9.9.8';
  finto.emit('error', Object.assign(new Error(motivo), { rifiutata: '9.9.8' }));
  assert.equal(righe.length, 1);
  assert.ok(righe[0].includes(motivo), righe[0]);
  assert.deepEqual(contati, [{ evento: 'versione_rifiutata' }]);
});
